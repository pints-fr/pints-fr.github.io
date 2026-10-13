import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
// The shared instance, not a second getStorage(app): only that one has been
// pointed at the emulator when a page asks for it.
import { storage } from "./firebase.js";
import { ARCHIVE, FIGURE, HERO, PAGE_IMAGE } from "./config.mjs";
import { figurePath, outputType, targetSize } from "./figure-utils.mjs";
import { heroPath } from "./hero-utils.mjs";
import { archivePath } from "./album-utils.mjs";
import { pageImagePath } from "./page-image-utils.mjs";

export { storage };

/**
 * Downscale in a canvas before upload.
 *
 * Two reasons this is not optional. A phone photograph of a plot is routinely
 * 6 MB, which storage.rules rejects outright; and every accepted figure is
 * fetched by every visitor to abstracts.html, so the page weight is the real
 * cost, not the bucket. Resolves to a Blob of `outputType(file.type)`.
 *
 * maxEdge is a parameter because hero photographs want a wider cap than figures
 * do -- see HERO in js/config.mjs.
 */
async function downscale(file, maxEdge = FIGURE.maxEdge) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const type = outputType(file.type);
  // White behind a transparent source, so a JPEG re-encode does not go black.
  const ctx = canvas.getContext("2d");
  if (type !== "image/png") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, type, type === "image/png" ? undefined : 0.85));
  // A canvas that fails to encode returns null; fall back to the original file
  // rather than losing the figure altogether.
  return blob ?? file;
}

/** Upload (replacing any previous figure at the same path). -> { url, path }. */
export async function uploadFigure(uid, abstractId, file) {
  const path = figurePath(uid, abstractId);
  const blob = await downscale(file);
  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, blob, { contentType: blob.type || outputType(file.type) });
  return { url: await getDownloadURL(objectRef), path };
}

/**
 * Upload one hero photograph. -> { url, path }.
 *
 * A new id per upload rather than one object per slot: the admin tab reorders
 * and removes photographs, and a slot-keyed path would mean rewriting several
 * objects to move one photo up the list.
 */
export async function uploadHeroPhoto(uid, id, file) {
  const path = heroPath(uid, id);
  const blob = await downscale(file, HERO.maxEdge);
  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, blob, { contentType: blob.type || outputType(file.type) });
  return { url: await getDownloadURL(objectRef), path };
}

/**
 * Upload one archive photograph. -> { url, path }.
 *
 * Same shape as uploadHeroPhoto, and deliberately a separate prefix rather than
 * a shared one: js/album-utils.mjs ownsObject() reads the prefix to decide
 * whether removing a photograph from an album may delete the object behind it,
 * and an imported hero photograph must survive that.
 */
export async function uploadArchivePhoto(uid, id, file) {
  const path = archivePath(uid, id);
  const blob = await downscale(file, ARCHIVE.maxEdge);
  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, blob, { contentType: blob.type || outputType(file.type) });
  return { url: await getDownloadURL(objectRef), path };
}

/**
 * Upload one image for page copy (the Pages tab). -> { url, path }.
 *
 * Same shape as uploadArchivePhoto, under its own prefix. Nothing deletes these
 * later: the only reference to one is a markdown link inside a page, and an
 * image an organizer cut from the copy is a few hundred KB nobody pays for.
 */
export async function uploadPageImage(uid, id, file) {
  const path = pageImagePath(uid, id);
  const blob = await downscale(file, PAGE_IMAGE.maxEdge);
  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, blob, { contentType: blob.type || outputType(file.type) });
  return { url: await getDownloadURL(objectRef), path };
}

/**
 * Delete an uploaded figure. A missing object is not an error worth surfacing:
 * the caller's goal is "no figure here", which is already true.
 *
 * Hero photographs go through here too -- the path is the only thing that
 * differs, and a second copy of this would be a second place to forget the
 * object-not-found case.
 */
export async function deleteFigure(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (err) {
    if (err?.code !== "storage/object-not-found") throw err;
  }
}

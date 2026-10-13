/**
 * Paths and markdown for images uploaded into page copy from the Pages tab.
 *
 * Pure, so it is testable under Node; the upload itself is in js/storage.js.
 */

/**
 * Storage object path for a page image.
 *
 * The uid is in the path for the same reason it is in heroPath(): storage rules
 * cannot read Firestore, so they cannot ask whether the uploader is an
 * organizer. Putting an image on a public page still needs a write to
 * pages/{slug}, which firestore.rules gates on isAdmin().
 */
export function pageImagePath(uid, id) {
  return `page_images/${uid}/${id}`;
}

/** A fresh object id. Two organizers uploading at once must not collide. */
export function pageImageId() {
  return crypto.randomUUID();
}

/**
 * `![alt](url)`, safe to drop into the editor.
 *
 * Brackets in the alt text would close it early, and a space or a parenthesis
 * in the URL would end the destination early; the angle-bracket form takes
 * both. A Firebase download URL has neither (its slashes are %2F-encoded), so
 * it comes through as a plain destination.
 */
export function imageMarkdown(alt, url) {
  const text = String(alt ?? "").replace(/[\[\]\\]/g, "\\$&").replace(/\s+/g, " ").trim();
  const dest = String(url ?? "");
  const wrapped = /[\s()<>]/.test(dest) ? `<${dest.replace(/[<>]/g, encodeURIComponent)}>` : dest;
  return `![${text}](${wrapped})`;
}

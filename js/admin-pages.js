import { LIMITS, PAGE_IMAGE, PAGES } from "./config.mjs";
import { renderPageHtml } from "./markdown.js";
import { getPage, savePage } from "./db.js";
import { uploadPageImage } from "./storage.js";
import { validateFigure } from "./figure-utils.mjs";
import { imageMarkdown, pageImageId } from "./page-image-utils.mjs";

/**
 * Edit page copy from the site.
 *
 * Firestore is the only thing this writes. The markdown committed under
 * content/ stays in the repo as the seed and the read fallback — a page nobody
 * has edited here is served from its file, and so is a page whose Firestore
 * read fails (see js/content-hydrate.js). Once a page has been saved here the
 * Firestore copy wins for good; there is no revert, and no commit back.
 */
export async function mountPagesTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="pg-msg" class="msg" role="status" aria-live="polite"></div>

    <label for="pg-select">Page</label>
    <select id="pg-select"></select>
    <p id="pg-source" class="muted"></p>

    <label for="pg-text">Markdown
      <span class="hint">Headings, lists, links, tables, and images. For anything
        markdown cannot express, write plain HTML inline — for example
        <code>&lt;span style="color: red"&gt;registration closes soon&lt;/span&gt;</code>
        for red text, or <code>&lt;div style="text-align: center"&gt;…&lt;/div&gt;</code>
        to centre a block. Inside a <code>&lt;div&gt;</code>, leave a blank line above
        and below your text or markdown stops working there. The preview below
        shows exactly what the page will do.
        <strong>Insert image</strong> uploads a photograph and puts its markdown at the
        cursor; wrap several in <code>&lt;div class="photo-row"&gt;…&lt;/div&gt;</code>
        to set them side by side.
        Saving publishes immediately — there is no commit and no review.
        <span id="pg-count"></span></span>
    </label>
    <div class="actions">
      <button type="button" id="pg-image" class="secondary">Insert image…</button>
      <input type="file" id="pg-image-file" accept="${PAGE_IMAGE.types.join(",")}" hidden>
    </div>
    <textarea id="pg-text" rows="20" style="min-height:24rem"></textarea>

    <h3>Preview</h3>
    <div id="pg-preview" class="prose card"></div>

    <div class="actions">
      <button type="button" id="pg-save">Save and publish</button>
    </div>`;

  const msg = host.querySelector("#pg-msg");
  const select = host.querySelector("#pg-select");
  const source = host.querySelector("#pg-source");
  const text = host.querySelector("#pg-text");
  const preview = host.querySelector("#pg-preview");
  const count = host.querySelector("#pg-count");
  const saveBtn = host.querySelector("#pg-save");
  const imageBtn = host.querySelector("#pg-image");
  const imageFile = host.querySelector("#pg-image-file");

  const say = (text_, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text_;
  };

  for (const page of PAGES) {
    const option = document.createElement("option");
    option.value = page.slug;
    option.textContent = page.label;
    select.append(option);
  }

  const current = () => PAGES.find((p) => p.slug === select.value) ?? PAGES[0];

  const refreshPreview = () => {
    preview.innerHTML = renderPageHtml(text.value);
    count.textContent = `${text.value.length} / ${LIMITS.pageMarkdown}`;
  };
  text.addEventListener("input", refreshPreview);

  async function load() {
    const page = current();
    text.value = "";
    source.textContent = "Loading…";
    try {
      const doc = await getPage(page.slug);
      if (doc?.markdown != null) {
        text.value = doc.markdown;
        source.textContent = `Edited on this site${
          doc.updatedAt?.toDate ? ` on ${doc.updatedAt.toDate().toLocaleString("en-GB")}` : ""}.`;
      } else {
        const res = await fetch(page.file, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        text.value = await res.text();
        source.textContent = `Never edited here — showing ${page.file} from the repository.`;
      }
      say("", "ok");
    } catch (err) {
      source.textContent = "";
      say(`Could not load ${page.label}.`, "err");
      console.error("[pints] admin pages load", err);
    }
    refreshPreview();
  }

  select.addEventListener("change", load);

  // Uploads straight to Storage but only edits the textarea: like any other
  // edit, the image reaches the public page on "Save and publish".
  imageBtn.addEventListener("click", () => imageFile.click());
  imageFile.addEventListener("change", async () => {
    const file = imageFile.files?.[0];
    imageFile.value = "";
    if (!file) return;
    const { valid } = validateFigure({ type: file.type, size: file.size }, PAGE_IMAGE);
    if (!valid) {
      const mb = Math.round(PAGE_IMAGE.maxBytes / (1024 * 1024));
      return say(`${file.name} must be a PNG, JPEG, or WebP image under ${mb} MB.`, "err");
    }
    imageBtn.disabled = true;
    say(`Uploading ${file.name}…`, "ok");
    try {
      const { url } = await uploadPageImage(adminUid, pageImageId(), file);
      const alt = file.name.replace(/\.[^.]+$/, "");
      text.focus();
      text.setRangeText(`\n${imageMarkdown(alt, url)}\n`, text.selectionStart, text.selectionEnd, "end");
      refreshPreview();
      say("Image inserted. Edit its description in the brackets, then save to publish.", "ok");
    } catch (err) {
      say("Could not upload the image.", "err");
      console.error("[pints] uploadPageImage", err);
    } finally {
      imageBtn.disabled = false;
    }
  });

  saveBtn.addEventListener("click", async () => {
    const page = current();
    if (text.value.length > LIMITS.pageMarkdown) {
      return say(`That is longer than the ${LIMITS.pageMarkdown} character limit.`, "err");
    }
    saveBtn.disabled = true;
    try {
      await savePage(page.slug, text.value, adminUid);
      say(`${page.label} published. Reload the public page to see it.`, "ok");
      await load();
    } catch (err) {
      say("Could not save the page.", "err");
      console.error("[pints] savePage", err);
    } finally {
      saveBtn.disabled = false;
    }
  });

  await load();
}

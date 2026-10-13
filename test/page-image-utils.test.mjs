import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { marked } from "../vendor/marked.esm.js";
import createDOMPurify from "../vendor/purify.es.mjs";
import { installStyleFilter, renderPage } from "../js/markdown-render-utils.mjs";
import { imageMarkdown, pageImageId, pageImagePath } from "../js/page-image-utils.mjs";

const { window } = new JSDOM("");
// Wired as js/markdown.js wires it, so the round trip below is the site's own.
const purify = installStyleFilter(createDOMPurify(window));
const deps = {
  parse: (src) => marked.parse(src),
  sanitize: (html, config) => purify.sanitize(html, config),
};

const imgOf = (md) => {
  const host = window.document.createElement("div");
  host.innerHTML = renderPage(md, deps);
  return host.querySelector("img");
};

const FIREBASE_URL = "https://firebasestorage.googleapis.com/v0/b/pints.appspot.com/o/"
  + "page_images%2Folivia%2Fabc?alt=media&token=1234-abcd";

test("pageImagePath puts the uploader's uid in the path", () => {
  assert.equal(pageImagePath("olivia", "abc"), "page_images/olivia/abc");
});

test("pageImageId is fresh every time", () => {
  assert.notEqual(pageImageId(), pageImageId());
});

test("imageMarkdown leaves a Firebase download URL as a plain destination", () => {
  assert.equal(imageMarkdown("Dancefloor", FIREBASE_URL), `![Dancefloor](${FIREBASE_URL})`);
});

test("imageMarkdown escapes brackets in the alt text", () => {
  const img = imgOf(imageMarkdown("DJ [set] 2", "https://x/a.jpg"));
  assert.equal(img.getAttribute("alt"), "DJ [set] 2");
  assert.equal(img.getAttribute("src"), "https://x/a.jpg");
});

test("imageMarkdown wraps a URL holding spaces or parentheses", () => {
  const url = "https://x/party (1).jpg";
  assert.equal(imageMarkdown("a", url), `![a](<${url}>)`);
  assert.equal(imgOf(imageMarkdown("a", url)).getAttribute("src"), "https://x/party%20(1).jpg");
});

test("a Firebase image survives the page pipeline intact", () => {
  const img = imgOf(imageMarkdown("Dancefloor", FIREBASE_URL));
  assert.equal(img.getAttribute("src"), FIREBASE_URL);
  assert.equal(img.getAttribute("alt"), "Dancefloor");
});

test("imageMarkdown keeps the alt text on one line", () => {
  assert.equal(imageMarkdown("  a\nb  ", "https://x/a.jpg"), "![a b](https://x/a.jpg)");
});

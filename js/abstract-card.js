import { TOPIC_LABELS } from "./config.mjs";
import {
  authorLineParts, submissionStatusTone, summaryAuthorLine,
} from "./abstract-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";

// One abstract, drawn in one place. The public list, the live preview inside the
// submission form, the confirmation after a submission and the shared-link page
// all render through here — "what you see is what gets published" is a promise
// the form cannot keep if a second, simpler renderer lives next door.
//
// `abstract` is either a stored document or a draft straight out of the form, so
// every field is optional and `figureUrl` may be an object: URL that exists only
// in this tab.
//
// The parts below are separate because the list needs them in two groups: what
// goes in a collapsed row, and what waits behind the disclosure.

/** Poster board number or talk pill, then the title. Nodes, not an element. */
function headingParts(abstract) {
  const parts = [];
  if (abstract.type === "poster" && abstract.posterNumber) {
    const number = document.createElement("span");
    number.className = "poster-no";
    number.textContent = `P${abstract.posterNumber} `;
    parts.push(number);
  } else if (abstract.type === "talk") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "talk";
    parts.push(pill, document.createTextNode(" "));
  }
  // textContent for the title: untrusted input.
  parts.push(document.createTextNode(abstract.title ?? ""));
  return parts;
}

/** Every author, with their affiliation superscripts; the presenter in bold. */
function bylineEl(abstract) {
  const byline = document.createElement("p");
  byline.className = "byline";
  authorLineParts(abstract.authors).forEach((part, i) => {
    if (i) byline.append(document.createTextNode(", "));
    const name = document.createElement(part.presenting ? "strong" : "span");
    name.textContent = part.name;
    byline.append(name);
    if (part.marks) {
      const sup = document.createElement("sup");
      sup.textContent = part.marks;
      byline.append(sup);
    }
  });
  return byline;
}

function affiliationsEl(abstract) {
  const affil = document.createElement("p");
  affil.className = "byline";
  affil.textContent = (abstract.affiliations ?? []).map((a, i) => `${i + 1}. ${a}`).join("   ");
  return affil;
}

/**
 * The abstract text, or — on a public copy published without it (see
 * publicMode() in abstract-utils.mjs) — a line saying why it is missing, so an
 * empty space does not read as a broken page.
 */
function bodyEl(abstract) {
  if (abstract.publishMode === "titleOnly" || abstract.publishMode === "pending") {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = abstract.publishMode === "titleOnly"
      ? "The authors have chosen to share only the title and authors."
      : "The abstract will be published here soon.";
    return note;
  }
  const body = document.createElement("div");
  // The only innerHTML here, and only through the tight untrusted allowlist.
  body.innerHTML = renderAbstractHtml(abstract.body);
  return body;
}

/**
 * The status, in its colour. Exported because the review console shows the same
 * three states and must not invent its own palette for them.
 */
export function statusPill(label, status) {
  const pill = document.createElement("span");
  pill.className = `pill status status-${submissionStatusTone(status)}`;
  pill.textContent = label;
  return pill;
}

function topicPill(abstract) {
  if (!abstract.topic) return null;
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = TOPIC_LABELS[abstract.topic] ?? abstract.topic;
  return pill;
}

/** Status, topic and the share link, on one line. */
function metaEl(abstract, { statusLabel, permalink, topic = true }) {
  const meta = document.createElement("p");
  meta.className = "card-meta";
  if (statusLabel) {
    meta.append(statusPill(statusLabel, abstract.status), " ");
  }
  const topicEl = topic ? topicPill(abstract) : null;
  if (topicEl) meta.append(topicEl, " ");
  if (permalink) {
    const link = document.createElement("a");
    link.className = "permalink";
    link.href = permalink;
    link.textContent = "Link to this abstract";
    meta.append(link);
  }
  return meta;
}

/**
 * The figure and its caption.
 *
 * Built with createElement, never through the markdown renderer:
 * ABSTRACT_ALLOWLIST forbids <img> in a submitted body and must keep doing so.
 * The caption is participant input too, so it goes in as text, not markup.
 */
function figureEl(abstract) {
  const figure = document.createElement("figure");
  if (!abstract.figureUrl) return figure;
  const img = document.createElement("img");
  img.src = abstract.figureUrl;
  img.alt = abstract.figureCaption || `Figure for “${abstract.title ?? "this abstract"}”`;
  // Deliberately NOT loading="lazy", which was here and was actively broken. An
  // unloaded image with no width/height collapses to 0x0, and a zero-area target
  // never registers as on-screen, so a figure revealed by opening a disclosure
  // would sit blank until something else forced a layout — and would print
  // blank, which defeats the whole point of the print handler. Every caller now
  // renders exactly one abstract's figure at a time, or has already deferred the
  // work by not building the disclosure body, so there is nothing left to defer.
  img.decoding = "async";
  figure.append(img);
  if (abstract.figureCaption) {
    const caption = document.createElement("figcaption");
    caption.textContent = abstract.figureCaption;
    figure.append(caption);
  }
  return figure;
}

/**
 * The whole abstract, open: heading, meta, authors, body, figure.
 *
 * Options:
 *   statusLabel  a pill above the title ("In review", "Accepted as a talk")
 *   permalink    href for a "Link to this abstract" control
 *   headingLevel "h1" for a page that is one abstract, "h3" inside a list
 *   extra        a node appended last, for a page's own controls (the
 *                best-poster vote button)
 */
export function abstractCard(abstract, {
  statusLabel = null,
  permalink = null,
  headingLevel = "h3",
  extra = null,
} = {}) {
  const article = document.createElement("article");
  article.className = "card";
  const heading = document.createElement(headingLevel);
  heading.append(...headingParts(abstract));
  article.append(
    heading,
    metaEl(abstract, { statusLabel, permalink }),
    bylineEl(abstract),
    affiliationsEl(abstract),
    bodyEl(abstract),
    figureEl(abstract),
  );
  if (extra) article.append(extra);
  return article;
}

/**
 * A collapsible row: a summary you always pay for, a body you pay for on first
 * open.
 *
 * **The lazy body is the whole point.** Collapsed markup is not a deferred
 * download — a `<details>` that already contains its `<img>` fetches it anyway —
 * so a list of hundreds has to not build the bodies at all. Both the public
 * abstract list and the review console are such a list, and they share this
 * rather than each getting it slightly wrong.
 *
 * `summary` is the nodes for the closed row; `buildBody` returns the element to
 * reveal, and is called at most once.
 */
export function disclosureShell({ summary, buildBody, className = "abstract" }) {
  const details = document.createElement("details");
  details.className = className;

  const summaryEl = document.createElement("summary");
  summaryEl.append(...summary);
  details.append(summaryEl);

  let built = false;
  // Setting `open` in script fires toggle too, so expand-all, the before-print
  // handler and the console's restore-open-rows pass come through here as well.
  details.addEventListener("toggle", () => {
    if (!details.open || built) return;
    built = true;
    details.append(buildBody());
  });
  return details;
}

/**
 * One abstract as a row of the public list: poster number or talk pill, title,
 * and the presenting author.
 *
 * `extra` returns a node for the end of the body. A function, because the body
 * is built on first open and the node should be too.
 */
export function abstractDisclosure(abstract, { permalink = null, extra = null } = {}) {
  const title = document.createElement("span");
  title.className = "summary-title";
  title.append(...headingParts(abstract));
  const summary = [title];

  const authors = summaryAuthorLine(abstract.authors);
  if (authors) {
    const who = document.createElement("span");
    who.className = "summary-authors";
    who.textContent = authors;
    summary.push(who);
  }
  // No topic pill: the list groups under topic headings, so every row in a group
  // would carry the same one.

  return disclosureShell({
    summary,
    buildBody: () => {
      const body = document.createElement("div");
      body.className = "abstract-body";
      body.append(
        bylineEl(abstract),
        affiliationsEl(abstract),
        bodyEl(abstract),
        figureEl(abstract),
        // topic:false — the list prints a topic heading above each group, so a
        // pill here would repeat it on every row of that group.
        metaEl(abstract, { statusLabel: null, permalink, topic: false }),
      );
      const tail = extra?.();
      if (tail) body.append(tail);
      return body;
    },
  });
}

/** Where an accepted abstract lives, for sharing. Relative, like every link here. */
export const abstractPermalink = (id) => `abstracts.html?a=${encodeURIComponent(id)}`;

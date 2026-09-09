import {
  ABSTRACT_STATUSES, ABSTRACT_TOPICS, ABSTRACT_TYPES, STATUS_LABELS, TOPIC_LABELS,
} from "./config.mjs";
import {
  authorLineParts, filterAdminAbstracts, groupByTopic, nextPosterNumber,
  submissionStatusLabel, summaryAuthorLine,
} from "./abstract-utils.mjs";
import { disclosureShell, statusPill } from "./abstract-card.js";
import {
  ABSTRACT_EXPORT_COLUMNS, abstractExportRows, annotateAbstracts,
} from "./abstract-export-utils.mjs";
import {
  describeReviewStats, reviewScoreMatrix, reviewStats, reviewerList, scoreOptions,
  sortByMeanScore, sortByTitle, summariseScore,
} from "./review-utils.mjs";
import { abstractDeletionPlan, describeAbstractDeletion } from "./deletion-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import { mountAbstractForm } from "./abstract-form.js";
import { confirmChoice } from "./confirm-dialog.js";
import { deleteAbstractCompletely } from "./functions.js";
import { toCsv } from "./csv-utils.mjs";
import { download } from "./download.js";
import {
  listAbstracts,
  listAdmins,
  listPublicAbstracts,
  listReviews,
  listUsers,
  publishAbstract,
  recordDecision,
  saveMyReview,
  setAbstractStatus,
  returnToReview,
} from "./db.js";

/** Author names with superscript affiliation marks, presenting author in bold. */
function authorsLine(abstract) {
  const span = document.createElement("span");
  authorLineParts(abstract.authors).forEach((part, i) => {
    if (i) span.append(document.createTextNode(", "));
    // textContent on a fresh element: author names are untrusted input.
    const name = document.createElement(part.presenting ? "strong" : "span");
    name.textContent = part.name;
    span.append(name);
    if (part.marks) {
      const sup = document.createElement("sup");
      sup.textContent = part.marks;
      span.append(sup);
    }
  });
  return span;
}

/** A labelled <select>, since this tab builds five of them. */
function picker({ label, options, value = "" }) {
  const wrapper = document.createElement("label");
  wrapper.className = "filter";
  wrapper.textContent = label;
  const select = document.createElement("select");
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.append(el);
  }
  select.value = value;
  wrapper.append(select);
  return { wrapper, select };
}

export async function mountAbstractsTab(host, { adminUid, user }) {
  // Two message lines, not one. #adm-msg reports what a button did and must
  // survive the re-render that follows it; #adm-empty describes the list itself
  // and has to disappear the moment the list stops being empty. Sharing one
  // element meant "No abstracts match these filters" outliving the filter that
  // caused it, and a save confirmation being wiped by the reload it triggered.
  host.innerHTML = `
    <div id="adm-msg" class="msg" role="status" aria-live="polite"></div>
    <div id="adm-filters" class="filters"></div>
    <div class="actions" id="adm-exports"></div>
    <p id="adm-summary" class="muted"></p>
    <p id="adm-empty" class="msg warn" hidden></p>
    <div id="adm-list"></div>`;

  const msg = host.querySelector("#adm-msg");
  const listEl = host.querySelector("#adm-list");
  const summary = host.querySelector("#adm-summary");
  const emptyEl = host.querySelector("#adm-empty");

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  // Which abstract is open in the editor. Exactly one at a time: two editors on
  // the same review screen means two drafts of the same pile, and a save from
  // either silently discarding the other.
  let editingId = null;

  // Which rows the organizer has open. Kept here rather than read off the DOM
  // because render() replaces every node, and the state has to outlive them.
  const openIds = new Set();

  const toggleAll = document.createElement("button");
  toggleAll.type = "button";
  toggleAll.className = "secondary";
  toggleAll.id = "adm-expand-all";
  toggleAll.textContent = "Expand all";
  // Derived from the rows rather than from the label, so the button cannot get
  // out of step with a list that re-renders after every action.
  toggleAll.addEventListener("click", () => {
    const rows = [...listEl.querySelectorAll("details.admin-abstract")];
    expandAll(!rows.every((el) => el.open));
  });

  const filters = { q: "", status: "", type: "", topic: "", talk: "" };

  // Not part of `filters`: it changes the order, not the set, and Clear filters
  // should not silently reshuffle the list. Highest first by default — before
  // this the order was whatever Firestore returned, which is to say arbitrary.
  let sortBy = "score-desc";

  // What the last render fetched. The export buttons read it rather than
  // re-fetching, so what lands in the spreadsheet is exactly what is on screen.
  let shown = [];
  let reviewsById = new Map();
  let reviewers = [];

  buildFilters();
  buildExports();

  function buildFilters() {
    const bar = host.querySelector("#adm-filters");

    const search = document.createElement("label");
    search.className = "filter";
    search.textContent = "Search";
    const q = document.createElement("input");
    q.type = "text";
    q.autocomplete = "off";
    q.placeholder = "title, author, affiliation, text";
    search.append(q);

    const status = picker({
      label: "Status",
      options: [{ value: "", label: "Any status" },
        ...ABSTRACT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))],
    });

    // Poster vs talk lives on the published copy, so "not published yet" is one
    // of the choices rather than the absence of one — it is how the committee
    // finds what it has still to decide.
    const type = picker({
      label: "Presentation",
      options: [
        { value: "", label: "Any" },
        { value: "talk", label: "Talk" },
        { value: "poster", label: "Poster" },
        { value: "unpublished", label: "Not published yet" },
      ],
    });

    // The submitter's own wish, which the type filter cannot express: an abstract
    // can be "still a poster" because nobody has decided, or because its author
    // asked not to be considered.
    const talk = picker({
      label: "Talk opt-out",
      options: [
        { value: "", label: "Any" },
        { value: "considered", label: "Happy to give a talk" },
        { value: "optedout", label: "Asked not to" },
      ],
    });

    const topic = picker({
      label: "Topic",
      options: [{ value: "", label: "All topics" },
        ...ABSTRACT_TOPICS.map((t) => ({ value: t, label: TOPIC_LABELS[t] ?? t }))],
    });

    // Within a topic, always: a mean of 7.4 in cognitive against 7.6 in systems
    // compares two panels' scoring habits, not two abstracts.
    const sort = picker({
      label: "Sort within topic",
      value: sortBy,
      options: [
        { value: "score-desc", label: "Score, highest first" },
        { value: "score-asc", label: "Score, lowest first" },
        { value: "title", label: "Title" },
      ],
    });
    sort.select.addEventListener("change", () => {
      sortBy = sort.select.value;
      render();
    });

    const reset = document.createElement("button");
    reset.className = "secondary";
    reset.type = "button";
    reset.textContent = "Clear filters";

    q.addEventListener("input", () => { filters.q = q.value; render(); });
    for (const [key, control] of Object.entries({ status, type, topic, talk })) {
      control.select.addEventListener("change", () => {
        filters[key] = control.select.value;
        render();
      });
    }
    reset.addEventListener("click", () => {
      q.value = "";
      for (const control of [status, type, topic, talk]) control.select.value = "";
      Object.assign(filters, { q: "", status: "", type: "", topic: "", talk: "" });
      render();
    });

    bar.append(search, status.wrapper, type.wrapper, talk.wrapper, topic.wrapper,
      sort.wrapper, reset);
  }

  function buildExports() {
    const bar = host.querySelector("#adm-exports");

    const abstractsBtn = document.createElement("button");
    abstractsBtn.className = "secondary";
    abstractsBtn.id = "adm-export-abstracts";
    abstractsBtn.textContent = "Export abstracts (CSV)";
    abstractsBtn.addEventListener("click", () =>
      download("pints-abstracts.csv",
        toCsv(abstractExportRows(shown), ABSTRACT_EXPORT_COLUMNS)));

    const scoresBtn = document.createElement("button");
    scoresBtn.className = "secondary";
    scoresBtn.id = "adm-export-scores";
    scoresBtn.textContent = "Export reviewer scores (CSV)";
    scoresBtn.addEventListener("click", () => {
      const { columns, rows } = reviewScoreMatrix(shown, { reviewsById, reviewers });
      download("pints-reviewer-scores.csv", toCsv(rows, columns));
    });

    const note = document.createElement("span");
    note.className = "muted";
    note.id = "adm-export-note";

    bar.append(toggleAll, abstractsBtn, scoresBtn, note);
  }

  /**
   * Open or close every row currently on screen.
   *
   * The DOM is set and the rows' own toggle listeners update `openIds`, so there
   * is one place that decides what "open" means and it cannot drift from what a
   * click does. Collapsing leaves the row being edited alone: the editor is
   * mounted inside the body, and closing it would hide a half-typed draft.
   */
  function expandAll(open) {
    for (const el of listEl.querySelectorAll("details.admin-abstract")) {
      if (!open && el.dataset.abstractId === editingId) continue;
      el.open = open;
    }
    syncToggleAll();
  }

  /** The label follows the list, not the last click: a render can change both. */
  function syncToggleAll() {
    const rows = [...listEl.querySelectorAll("details.admin-abstract")];
    const allOpen = rows.length > 0 && rows.every((el) => el.open);
    toggleAll.textContent = allOpen ? "Collapse all" : "Expand all";
    toggleAll.hidden = rows.length === 0;
  }

  /**
   * One organizer's own score and note, plus what everybody else thinks.
   *
   * Every review on the page arrives in the single listReviews() read, so
   * nothing here is loaded asynchronously after the card is drawn. That is not
   * only cheaper: the old shared note was fetched per card and written back by
   * the accept button, so a fast click saved an empty textarea over a note that
   * had not arrived yet.
   */
  function reviewBlock(abstract) {
    const section = document.createElement("div");
    section.className = "review";

    const stored = reviewsById.get(abstract.id) ?? {};
    const stats = reviewStats(stored.reviews);
    const mine = stored.reviews?.[adminUid] ?? {};

    const headline = document.createElement("p");
    headline.className = "muted";
    headline.textContent = describeReviewStats(stats, reviewers.length || 1);
    section.append(headline);

    // A note written before reviews were per organizer. Shown read-only rather
    // than migrated: it belongs to whoever wrote it, and nobody can say who.
    if (typeof stored.note === "string" && stored.note.trim()) {
      const legacy = document.createElement("p");
      legacy.className = "muted";
      legacy.textContent = `Earlier shared note: ${stored.note}`;
      section.append(legacy);
    }

    const score = picker({
      label: "Your score",
      options: [{ value: "", label: "—" },
        ...scoreOptions().map((n) => ({ value: String(n), label: String(n) }))],
      value: Number.isInteger(mine.score) ? String(mine.score) : "",
    });
    score.wrapper.title = "1 to 10. Leave blank to review without scoring.";

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Your note (never visible to the submitter)";
    const note = document.createElement("textarea");
    note.rows = 2;
    note.style.minHeight = "4rem";
    note.value = mine.note ?? "";

    const save = document.createElement("button");
    save.className = "secondary";
    save.textContent = "Save review";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await saveMyReview(abstract.id, adminUid, {
          score: score.select.value ? Number(score.select.value) : null,
          note: note.value,
        });
        say("Review saved.", "ok");
        await render();
      } catch (err) {
        say("Could not save your review.", "err");
        console.error("[pints] saveMyReview", err);
        save.disabled = false;
      }
    });

    section.append(score.wrapper, noteLabel, note, save);

    const others = stats.entries.filter((entry) => entry.uid !== adminUid);
    if (others.length) {
      const details = document.createElement("details");
      const summaryEl = document.createElement("summary");
      summaryEl.textContent =
        `Other organizers (${others.length})`;
      details.append(summaryEl);
      const nameOf = new Map(reviewers.map((r) => [r.uid, r.name]));
      for (const entry of others) {
        const line = document.createElement("p");
        line.className = "muted";
        line.textContent = `${nameOf.get(entry.uid) ?? entry.uid}: `
          + `${entry.score ?? "no score"}${entry.note ? ` — ${entry.note}` : ""}`;
        details.append(line);
      }
      section.append(details);
    }

    return section;
  }

  /**
   * One row of the review console: the decision, the title, who submitted it,
   * and how it scored — the four things a decision meeting reads off the list
   * without opening anything.
   */
  function row(abstract, published, refresh) {
    const stats = reviewStats(reviewsById.get(abstract.id)?.reviews);

    const title = document.createElement("span");
    title.className = "summary-title";
    title.textContent = abstract.title ?? "(untitled)";

    const who = document.createElement("span");
    who.className = "summary-authors";
    who.textContent = summaryAuthorLine(abstract.authors);

    const score = document.createElement("span");
    score.className = "summary-score";
    score.textContent = summariseScore(stats);

    const details = disclosureShell({
      className: "abstract admin-abstract",
      summary: [
        statusPill(submissionStatusLabel(abstract.status, {
          type: abstract.publicType, posterNumber: abstract.posterNumber,
        }), abstract.status),
        title,
        who,
        score,
      ],
      buildBody: () => card(abstract, published, refresh),
    });

    details.dataset.abstractId = abstract.id;

    // Open rows survive the re-render that follows every action on this tab.
    // Without this, accepting one abstract slams shut whatever the organizer was
    // reading, which on a hundred-row list is worse than the long page was.
    details.addEventListener("toggle", () => {
      if (details.open) openIds.add(abstract.id);
      else openIds.delete(abstract.id);
      syncToggleAll();
    });
    // The editor lives inside the body, so a row holding it cannot be closed.
    if (openIds.has(abstract.id) || editingId === abstract.id) details.open = true;
    return details;
  }

  function card(abstract, published, refresh) {
    const article = document.createElement("div");
    article.className = "abstract-body";

    const from = document.createElement("p");
    from.className = "muted";
    from.textContent = abstract.submitterName || abstract.submitterEmail
      ? `Submitted by ${abstract.submitterName || "unknown"}`
        + ` (${abstract.submitterEmail || "no email"})`
      : `Submitted by uid ${abstract.ownerUid}`;

    // The full author line: the summary above carries only the presenting one.
    const byline = document.createElement("p");
    byline.className = "byline";
    byline.append(authorsLine(abstract));

    const affil = document.createElement("p");
    affil.className = "byline";
    affil.textContent = (abstract.affiliations ?? [])
      .map((a, i) => `${i + 1}. ${a}`).join("   ");

    const meta = document.createElement("p");
    const topic = TOPIC_LABELS[abstract.topic] ?? abstract.topic;
    if (topic) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = topic;
      meta.append(pill, " ");
    }
    if (abstract.talkConsidered === false) {
      const optOut = document.createElement("span");
      optOut.className = "muted";
      optOut.textContent = "the submitter asked not to be considered for a talk";
      meta.append(optOut);
    }

    const body = document.createElement("div");
    // The one innerHTML on this page, through the unit-tested tight allowlist.
    body.innerHTML = renderAbstractHtml(abstract.body);

    // createElement, not markdown: ABSTRACT_ALLOWLIST forbids <img> in the body
    // and must keep doing so. The figure is a separate, validated field, and its
    // caption is untrusted text like everything else the submitter wrote.
    const figure = document.createElement("figure");
    if (abstract.figureUrl) {
      const link = document.createElement("a");
      link.href = abstract.figureUrl;
      link.target = "_blank";
      link.rel = "noopener";
      const img = document.createElement("img");
      img.src = abstract.figureUrl;
      img.alt = abstract.figureCaption || "Submitted figure";
      img.loading = "lazy";
      img.style.maxWidth = "20rem";
      img.style.height = "auto";
      link.append(img);
      figure.append(link);
      if (abstract.figureCaption) {
        const caption = document.createElement("figcaption");
        caption.textContent = abstract.figureCaption;
        figure.append(caption);
      }
    } else {
      // Required since 2026 unless the submitter opted out of a talk, so a
      // missing figure is either that opt-out or a record that predates the
      // rule (or one an organizer wrote by hand). Say so rather than showing
      // a silently empty space.
      const missing = document.createElement("p");
      missing.className = "muted";
      missing.textContent = abstract.talkConsidered === false
        ? "No figure — not required, since the submitter opted out of a talk."
        : "No figure — this abstract predates the figure requirement.";
      figure.append(missing);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    // Poster vs talk is the committee's call, not the submitter's: everything
    // arrives as a poster and some are promoted here.
    const isPublished = Boolean(abstract.publicType);
    const typeSelect = document.createElement("select");
    typeSelect.title = "Present as";
    typeSelect.style.maxWidth = "6.5rem";
    for (const type of ABSTRACT_TYPES) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type === "poster" ? "Poster" : "Talk";
      typeSelect.append(option);
    }
    typeSelect.value = abstract.publicType ?? "poster";
    if (abstract.talkConsidered === false) {
      typeSelect.title = "The submitter asked not to be considered for a talk";
    }

    const posterInput = document.createElement("input");
    posterInput.type = "number";
    posterInput.min = "1";
    // Three digits is plenty: PINTS is one day and one poster hall.
    posterInput.max = "999";
    posterInput.style.maxWidth = "4.5rem";
    posterInput.title = "Poster board number";
    posterInput.value = String(abstract.posterNumber ?? nextPosterNumber(published));
    const syncPosterInput = () => { posterInput.hidden = typeSelect.value !== "poster"; };
    typeSelect.addEventListener("change", syncPosterInput);
    syncPosterInput();

    const guarded = (label, className, fn) => {
      const button = document.createElement("button");
      button.textContent = label;
      if (className) button.className = className;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await fn();
          await refresh();
        } catch (err) {
          // The Cloud Function's refusals are written for a human — "revoke
          // their admin rights first" — and are worth far more than a generic
          // apology, so they are shown as-is.
          say(err?.userFacing ? err.message : `Could not ${label.toLowerCase()}.`, "err");
          console.error("[pints] admin abstracts", err);
          button.disabled = false;
        }
      });
      return button;
    };

    // On an already-accepted abstract this is not a second acceptance: it is how
    // poster becomes talk, how a board number changes, and how an edit made
    // anywhere else reaches the public list. `acceptedAt` is carried through so
    // it keeps meaning "when this was accepted" rather than "when somebody last
    // touched it".
    const accept = guarded(
      isPublished ? "Update published copy" : "Accept & publish", "",
      async () => {
        if (typeSelect.value === "talk" && !(abstract.figureUrl && abstract.figureCaption)) {
          const err = new Error(
            "This abstract has no figure and caption, which talks require. "
            + "Add them from Edit, or publish it as a poster instead.");
          err.userFacing = true;
          throw err;
        }
        await recordDecision(abstract.id, adminUid);
        await publishAbstract(abstract.id, abstract, {
          type: typeSelect.value,
          posterNumber: Number(posterInput.value),
          acceptedAt: abstract.acceptedAt ?? null,
        });
        say(`Published “${abstract.title}”.`, "ok");
      });
    accept.title = isPublished
      ? "Rewrite the public copy with the type and board number selected here"
      : "Accept this abstract and put it on the public list";

    const reject = guarded("Reject", "secondary", async () => {
      await recordDecision(abstract.id, adminUid);
      await setAbstractStatus(abstract.id, "rejected");
      say(`Rejected “${abstract.title}”. The submitter can revise and resubmit.`, "warn");
    });

    // Undoing an acceptance, not a fourth status: the abstract goes back to
    // where it was before the committee touched it. `secondary`, not `danger` —
    // it is reversible in one click, and red should keep meaning Delete.
    const pull = guarded("Return to review", "secondary", async () => {
      await returnToReview(abstract.id);
      say(`“${abstract.title}” is back in review and off the public list.`, "warn");
    });
    pull.title = "Remove this abstract from the public list and undo the acceptance";
    pull.hidden = abstract.status !== "accepted";

    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = editingId === abstract.id ? "Close editor" : "Edit";
    edit.addEventListener("click", () => {
      editingId = editingId === abstract.id ? null : abstract.id;
      refresh();
    });

    const remove = guarded("Delete", "danger", async () => {
      if (!(await confirmDelete(abstract, published))) return;
      await deleteAbstractCompletely(abstract.id);
      editingId = editingId === abstract.id ? null : editingId;
      say(`Deleted “${abstract.title}”.`, "warn");
    });

    actions.append(typeSelect, posterInput, accept, reject, edit, pull, remove);

    // The editor is mounted into the card it belongs to, in the same panel the
    // account page uses, so the form is never far from the abstract it edits.
    const editHost = document.createElement("div");
    editHost.className = "panel";
    editHost.hidden = true;

    article.append(byline, from, affil, meta, body, figure,
      reviewBlock(abstract), actions, editHost);

    if (editingId === abstract.id) {
      mountEditor(abstract, published, refresh, editHost).catch((err) => {
        say("Could not open the editor.", "err");
        console.error("[pints] admin edit", err);
      });
    }

    return article;
  }

  async function confirmDelete(abstract, published) {
    const choice = await confirmChoice({
      title: "Delete abstract",
      message: describeAbstractDeletion(abstract.title, abstractDeletionPlan(abstract, published)),
      choices: [
        { value: "delete", label: "Delete permanently", className: "danger" },
        { value: "cancel", label: "Cancel", className: "secondary" },
      ],
    });
    return choice === "delete";
  }

  async function mountEditor(abstract, published, refresh, editHost) {
    editHost.hidden = false;

    const head = document.createElement("div");
    head.className = "panel-head";
    head.textContent = `Editing “${abstract.title ?? "(untitled)"}”`;
    const slot = document.createElement("div");
    slot.className = "panel-body";
    editHost.replaceChildren(head, slot);

    // An accepted abstract's public copy is rewritten in the same batch as the
    // private one, so its type and board number have to survive the edit. This
    // is also what unlocks the form: without it an accepted abstract stays
    // read-only, which is the right way to fail.
    await mountAbstractForm(slot, {
      user,
      isAdmin: true,
      abstract,
      republish: abstract.publicType
        ? {
          type: abstract.publicType,
          posterNumber: abstract.posterNumber,
          acceptedAt: abstract.acceptedAt,
        }
        : null,
      onCancel: () => { editingId = null; refresh(); },
      onDelete: async () => {
        if (!(await confirmDelete(abstract, published))) return;
        try {
          await deleteAbstractCompletely(abstract.id);
          editingId = null;
          say(`Deleted “${abstract.title}”.`, "warn");
          await refresh();
        } catch (err) {
          say(err?.userFacing ? err.message : "Could not delete the abstract.", "err");
        }
      },
      onSaved: async () => { editingId = null; await refresh(); },
    });
  }

  function sortShown(list) {
    if (sortBy === "title") return sortByTitle(list);
    return sortByMeanScore(list, {
      reviewsById, direction: sortBy === "score-asc" ? "asc" : "desc",
    });
  }

  async function render() {
    // One read each for the whole page, joined in memory — far cheaper than a
    // per-card lookup, and it is what lets a card draw its reviews synchronously.
    const [abstracts, published, users, reviews, admins] = await Promise.all([
      listAbstracts(), listPublicAbstracts(), listUsers(), listReviews(), listAdmins(),
    ]);

    reviewsById = reviews;
    const usersById = new Map(users.map((u) => [u.id, u]));
    reviewers = reviewerList(admins, usersById);

    const annotated = annotateAbstracts(abstracts, { published, users });
    // Sorted before grouping: groupByTopic preserves input order, so ordering
    // the flat list here is what orders each topic. The exports read `shown`,
    // so a CSV comes out in the order on screen.
    shown = sortShown(filterAdminAbstracts(annotated, filters));

    const counts = {};
    for (const a of abstracts) counts[a.status] = (counts[a.status] ?? 0) + 1;
    // Anything not decided is in review, which sweeps up a legacy `withdrawn`
    // rather than leaving it uncounted.
    const decided = (counts.accepted ?? 0) + (counts.rejected ?? 0);
    const totals =
      `${abstracts.length} abstracts · ${counts.accepted ?? 0} accepted · ` +
      `${counts.rejected ?? 0} not accepted · ${abstracts.length - decided} in review`;
    summary.textContent = shown.length === abstracts.length
      ? totals
      : `${totals} — showing ${shown.length}`;

    host.querySelector("#adm-export-note").textContent = shown.length === abstracts.length
      ? ""
      : `Exports cover the ${shown.length} shown, not all ${abstracts.length}.`;

    // Grouped by topic: the committee reviews a topic at a time, and comparing
    // submissions within a topic is the whole job.
    listEl.replaceChildren();
    for (const { topic, items } of groupByTopic(shown, ABSTRACT_TOPICS)) {
      const heading = document.createElement("h3");
      heading.textContent =
        `${topic ? TOPIC_LABELS[topic] ?? topic : "Other"} (${items.length})`;
      listEl.append(heading);
      for (const a of items) listEl.append(row(a, published, render));
    }

    syncToggleAll();

    emptyEl.textContent = !abstracts.length ? "No abstracts have been submitted yet."
      : !shown.length ? "No abstracts match these filters."
      : "";
    emptyEl.hidden = emptyEl.textContent === "";
  }

  try {
    await render();
  } catch (err) {
    say("Could not load abstracts.", "err");
    console.error("[pints] admin abstracts", err);
  }
}

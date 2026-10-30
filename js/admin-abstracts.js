import {
  ABSTRACT_STATUSES, ABSTRACT_TOPICS, ABSTRACT_TYPES, POSTER_SESSIONS, POSTER_SESSION_LABELS,
  STATUS_LABELS, TOPIC_LABELS,
} from "./config.mjs";
import {
  authorLineParts, displayOrder, filterAdminAbstracts, groupByTopic, inReview,
  lighterSession, nextPosterNumber, renumberWithinSessions,
  splitPosterSessions, submissionStatusLabel, submissionWindows, summaryAuthorLine,
} from "./abstract-utils.mjs";
import { disclosureShell, statusPill } from "./abstract-card.js";
import {
  ABSTRACT_EXPORT_COLUMNS, BLIND_EXPORT_COLUMNS, abstractExportRows, annotateAbstracts,
  blindExportRows, stripAuthors,
} from "./abstract-export-utils.mjs";
import {
  countReviews, describeReviewStats, myScoreSummary, reviewScoreMatrix, reviewStats,
  reviewerLabels, reviewerList, SCORE_LABELS, isRetiredScore, isScore, scoreLabel,
  scoreOptions, sortByMeanScore, sortByTitle, summariseScore,
} from "./review-utils.mjs";
import { abstractDeletionPlan, describeAbstractDeletion } from "./deletion-utils.mjs";
import { renderAbstractHtml } from "./markdown.js";
import { mountAbstractForm } from "./abstract-form.js";
import { confirmChoice } from "./confirm-dialog.js";
import { deleteAbstractCompletely } from "./functions.js";
import { toCsv } from "./csv-utils.mjs";
import { download } from "./download.js";
import {
  clearAllReviews,
  getSiteConfig,
  listAbstracts,
  listAdmins,
  listPublicAbstracts,
  listReviews,
  listUsers,
  publishAbstract,
  publishAbstracts,
  recordDecision,
  saveMyReview,
  saveSiteConfig,
  setAbstractStatus,
  setPosterNumbers,
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
    <div class="checkline">
      <input id="adm-blind-mode" type="checkbox">
      <label for="adm-blind-mode">Reviewer mode (blind review)
        <span class="hint">For every organizer: hides who wrote each abstract and where they
          work, and shows only your own score and comment — not the mean, and not anybody
          else's. Exporting abstracts then gives your own review and no names. Untick it for
          the decision meeting.</span>
      </label>
    </div>
    <p id="adm-blind" class="msg warn" hidden>Reviewer mode is on: authors, affiliations and
      other organizers' reviews are hidden, and only your own score is shown.</p>
    <div id="adm-filters" class="filters"></div>
    <div class="actions" id="adm-exports"></div>
    <div class="actions" id="adm-bulk"></div>
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
  let annotated = [];
  let published = [];
  let reviewsById = new Map();
  let reviewers = [];
  let labels = new Map();

  // Reviewer mode, from config/site. Read on every render rather than once, so
  // another organizer flipping it reaches this tab on the next action. Hiding is
  // all it does, because any organizer can turn it off with the checkbox above,
  // so the rules have nothing to enforce.
  let blind = false;
  // Whether the editing window has closed, which is what decides how an
  // unconfirmed publish setting is published (publicMode() in abstract-utils).
  let editClosed = false;
  const blindToggle = host.querySelector("#adm-blind-mode");

  // Saved straight away rather than behind a Save button: it is one switch, and
  // a checkbox that showed one mode while the list showed the other would be
  // worse than an accidental click, which the same click undoes.
  blindToggle.addEventListener("change", async () => {
    const on = blindToggle.checked;
    blindToggle.disabled = true;
    try {
      await saveSiteConfig({ reviewerMode: on });
    } catch (err) {
      blindToggle.checked = !on;
      blindToggle.disabled = false;
      say("Could not change the review mode.", "err");
      console.error("[pints] saveSiteConfig reviewerMode", err);
      return;
    }
    try {
      await render();
      say(on
        ? "Reviewer mode is on for every organizer."
        : "Reviewer mode is off. Authors and the committee's reviews are visible again.", "ok");
    } catch (err) {
      say("Saved, but could not reload the abstracts. Reload the page.", "err");
      console.error("[pints] admin abstracts", err);
    } finally {
      blindToggle.disabled = false;
    }
  });

  buildFilters();
  buildExports();
  const bulk = buildBulkActions();

  function buildFilters() {
    const bar = host.querySelector("#adm-filters");

    const search = document.createElement("label");
    search.className = "filter";
    search.textContent = "Search";
    const q = document.createElement("input");
    q.type = "text";
    q.autocomplete = "off";
    q.placeholder = "title, author, affiliation, text";
    q.id = "adm-search";
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
    // In reviewer mode the same button gives the blind version: no names, and
    // the exporting organizer's own review alongside each abstract.
    abstractsBtn.addEventListener("click", () => {
      if (blind) {
        download("pints-abstracts-blind.csv", toCsv(
          blindExportRows(shown, { reviewsById, uid: adminUid }), BLIND_EXPORT_COLUMNS));
      } else {
        download("pints-abstracts.csv",
          toCsv(abstractExportRows(shown), ABSTRACT_EXPORT_COLUMNS));
      }
    });

    // Everybody's review, so it has no place in reviewer mode; render() hides it.
    const scoresBtn = document.createElement("button");
    scoresBtn.className = "secondary";
    scoresBtn.id = "adm-export-scores";
    scoresBtn.textContent = "Export reviewer scores and comments (CSV)";
    scoresBtn.addEventListener("click", () => {
      if (blind) return;
      const { columns, rows } = reviewScoreMatrix(shown, { reviewsById, labels });
      download("pints-reviewer-scores-comments.csv", toCsv(rows, columns));
    });

    // Everybody's review again, so hidden in reviewer mode like the export.
    const clearBtn = document.createElement("button");
    clearBtn.className = "danger";
    clearBtn.id = "adm-clear-reviews";
    clearBtn.textContent = "Delete all review scores and comments";
    clearBtn.title = "Remove every organizer's score and comment on every abstract. "
      + "Accept and reject decisions are kept.";
    clearBtn.addEventListener("click", async () => {
      if (blind) return;
      clearBtn.disabled = true;
      try {
        await clearReviews();
      } catch (err) {
        say("Could not delete the review scores and comments.", "err");
        console.error("[pints] clearAllReviews", err);
      } finally {
        clearBtn.disabled = false;
      }
    });

    const note = document.createElement("span");
    note.className = "muted";
    note.id = "adm-export-note";

    bar.append(toggleAll, abstractsBtn, scoresBtn, clearBtn, note);
  }

  /**
   * Every review by every organizer on every abstract — not just the ones the
   * filters show, which is why the confirmation names the total. Counted from a
   * fresh read, so the number promised is the number deleted.
   */
  async function clearReviews() {
    const { reviews, abstracts } = countReviews(await listReviews());
    if (!reviews) {
      say("There are no review scores or comments to delete.", "ok");
      return;
    }
    const choice = await confirmChoice({
      title: "Delete all review scores and comments",
      message: `Delete ${reviews} review${reviews === 1 ? "" : "s"} on ${abstracts} `
        + `abstract${abstracts === 1 ? "" : "s"} — every organizer's scores and comments? `
        + "Accept and reject decisions are kept. This cannot be undone.",
      choices: [
        { value: "delete", label: "Delete all scores and comments", className: "danger" },
        { value: "cancel", label: "Cancel", className: "secondary" },
      ],
    });
    if (choice !== "delete") return;
    const result = await clearAllReviews();
    say(`Deleted ${result.reviews} review${result.reviews === 1 ? "" : "s"} `
      + `on ${result.abstracts} abstract${result.abstracts === 1 ? "" : "s"}.`, "warn");
    await render();
  }

  /**
   * The decision-meeting shortcuts. Both act on what the last render drew, and
   * both are hidden in reviewer mode, like the per-card Accept: scoring is not
   * deciding.
   */
  function buildBulkActions() {
    const bar = host.querySelector("#adm-bulk");

    const run = async (button, fn) => {
      button.disabled = true;
      try {
        await fn();
        await render();
      } catch (err) {
        say(`Could not ${button.textContent.toLowerCase()}.`, "err");
        console.error("[pints] admin bulk", err);
      } finally {
        button.disabled = false;
      }
    };

    const confirmed = async (title, message, label) => (await confirmChoice({
      title,
      message,
      choices: [
        { value: "go", label },
        { value: "cancel", label: "Cancel", className: "secondary" },
      ],
    })) === "go";

    // Only the abstracts on screen, like the exports: filter to a topic and this
    // accepts that topic. Each goes to whichever session keeps its topic most
    // even, numbered after the last board in use there, so an earlier
    // acceptance keeps its number.
    const acceptAll = document.createElement("button");
    acceptAll.id = "adm-accept-all";
    acceptAll.addEventListener("click", () => run(acceptAll, async () => {
      const pending = displayOrder(inReview(shown), ABSTRACT_TOPICS);
      if (!pending.length) return;
      const placed = [...published];
      const entries = pending.map((abstract) => {
        const posterSession = lighterSession(placed, abstract.topic);
        const posterNumber = nextPosterNumber(placed, posterSession);
        placed.push({ type: "poster", topic: abstract.topic, posterSession, posterNumber });
        return { abstract, posterSession, posterNumber };
      });
      const perSession = POSTER_SESSIONS
        .map((s) => [s, entries.filter((e) => e.posterSession === s).length])
        .filter(([, n]) => n)
        .map(([s, n]) => `${n} to ${POSTER_SESSION_LABELS[s]}`)
        .join(", ");
      const ok = await confirmed("Accept as posters",
        `Accept the ${pending.length} abstract${pending.length === 1 ? "" : "s"} still in review `
        + `that ${pending.length === 1 ? "is" : "are"} shown, as posters (${perSession}), `
        + "and publish them? Talks can still be promoted one by one afterwards.",
        "Accept and publish");
      if (!ok) return;
      await publishAbstracts(entries, adminUid, { editClosed });
      say(`Accepted ${pending.length} as posters (${perSession}).`, "ok");
    }));

    // Both work on every accepted poster, not just those shown: renumbering a
    // filtered subset from 1 would hand out numbers the hidden posters still
    // hold.
    const acceptedPosters = () => displayOrder(
      sortShown(annotated.filter((a) => a.status === "accepted" && a.publicType === "poster")),
      ABSTRACT_TOPICS);

    const split = document.createElement("button");
    split.className = "secondary";
    split.id = "adm-split";
    split.textContent = "Split posters into two sessions";
    split.title = "Deal every accepted poster into poster sessions 1 and 2, each topic split "
      + "evenly, and number them P1-1… and P2-1…, topic by topic in the current sort order";
    split.addEventListener("click", () => run(split, async () => {
      const posters = acceptedPosters();
      if (!posters.length) return;
      const ok = await confirmed("Split posters into two sessions",
        `Split all ${posters.length} accepted posters evenly between the two poster sessions, `
        + "each topic half and half, and number them P1-1… and P2-1… in the current sort order? "
        + "Filters are ignored, and every existing session and board number changes.",
        "Split and renumber");
      if (!ok) return;
      const assignments = splitPosterSessions(posters, ABSTRACT_TOPICS);
      await setPosterNumbers(assignments);
      const counts = POSTER_SESSIONS.map((s) =>
        assignments.filter((a) => a.posterSession === s).length);
      say(`Split ${posters.length} posters: ${counts.join(" and ")}.`, "ok");
    }));

    // After posters were moved by hand: keeps every session, closes the gaps.
    const renumber = document.createElement("button");
    renumber.className = "secondary";
    renumber.id = "adm-renumber";
    renumber.textContent = "Renumber within sessions";
    renumber.title = "Keep each poster in its session and number each session from 1, "
      + "topic by topic in the current sort order";
    renumber.addEventListener("click", () => run(renumber, async () => {
      const posters = acceptedPosters();
      if (!posters.length) return;
      const ok = await confirmed("Renumber within sessions",
        `Renumber all ${posters.length} accepted posters from 1 within each poster session, `
        + "topic by topic in the current sort order? Sessions stay as they are; filters are "
        + "ignored, and existing board numbers change.",
        "Renumber");
      if (!ok) return;
      await setPosterNumbers(renumberWithinSessions(posters, ABSTRACT_TOPICS));
      say(`Renumbered ${posters.length} posters within their sessions.`, "ok");
    }));

    bar.append(acceptAll, split, renumber);

    return function sync() {
      const pending = inReview(shown).length;
      acceptAll.textContent = `Accept ${pending} in review as posters`;
      acceptAll.hidden = blind || pending === 0;
      const anyPoster = annotated.some((a) => a.status === "accepted" && a.publicType === "poster");
      split.hidden = blind || !anyPoster;
      renumber.hidden = blind || !anyPoster;
    };
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

    // Reviewer mode shows none of the committee's opinion: not the mean, not the
    // legacy note, not the others' reviews. Only the organizer's own slot below.
    if (!blind) {
      const headline = document.createElement("p");
      headline.className = "muted";
      headline.textContent = describeReviewStats(stats, reviewers.length || 1);
      section.append(headline);
    }

    // A note written before reviews were per organizer. Shown read-only rather
    // than migrated: it belongs to whoever wrote it, and nobody can say who.
    if (!blind && typeof stored.note === "string" && stored.note.trim()) {
      const legacy = document.createElement("p");
      legacy.className = "muted";
      legacy.textContent = `Earlier shared note: ${stored.note}`;
      section.append(legacy);
    }

    const score = picker({
      label: "Your score",
      options: [{ value: "", label: "—" },
        ...scoreOptions().map((n) => ({ value: String(n), label: `${n} — ${SCORE_LABELS[n]}` }))],
      value: isScore(mine.score) ? String(mine.score) : "",
    });
    score.wrapper.title = "1 is a veto. Leave blank to review without scoring.";

    // A 5–10 from before the four-point scale no longer counts toward anything.
    // Said out loud, so the organizer knows to rescore rather than assuming the
    // blank picker lost their review.
    if (isRetiredScore(mine.score)) {
      const retired = document.createElement("p");
      retired.className = "msg warn";
      retired.textContent = `You scored this ${mine.score} out of 10 on the old scale. `
        + "That no longer counts: choose a score from 1 to 4.";
      section.append(retired);
    }

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

    // Anonymous even outside reviewer mode: the committee sees what was said,
    // not who said it. The labels are page-wide, so one reviewer is the same
    // number on every card and in the scores export.
    const others = stats.entries.filter((entry) => entry.uid !== adminUid);
    if (!blind && others.length) {
      const details = document.createElement("details");
      const summaryEl = document.createElement("summary");
      summaryEl.textContent =
        `Other organizers (${others.length})`;
      details.append(summaryEl);
      for (const entry of others) {
        const line = document.createElement("p");
        line.className = "muted";
        line.textContent = `${labels.get(entry.uid) ?? "Reviewer"}: `
          + `${scoreLabel(entry.score) || "no score"}${entry.note ? ` — ${entry.note}` : ""}`;
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
    const reviews = reviewsById.get(abstract.id)?.reviews;

    const title = document.createElement("span");
    title.className = "summary-title";
    title.textContent = abstract.title ?? "(untitled)";

    // Left empty rather than removed in reviewer mode, so the score column
    // stays where the eye expects it.
    const who = document.createElement("span");
    who.className = "summary-authors";
    who.textContent = blind ? "" : summaryAuthorLine(abstract.authors);

    const score = document.createElement("span");
    score.className = "summary-score";
    score.textContent = blind
      ? myScoreSummary(reviews, adminUid)
      : summariseScore(reviewStats(reviews));

    const details = disclosureShell({
      className: "abstract admin-abstract",
      summary: [
        statusPill(submissionStatusLabel(abstract.status, {
          type: abstract.publicType,
          posterSession: abstract.posterSession,
          posterNumber: abstract.posterNumber,
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
    if (abstract.talkConsidered === false) meta.append(" · ");
    const publishing = document.createElement("span");
    publishing.className = "muted";
    publishing.textContent = abstract.publishConfirmed !== true
      ? "public listing not confirmed"
      : abstract.publishChoice === "titleOnly"
        ? "public listing: title and authors only"
        : "public listing: full abstract";
    meta.append(publishing);

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
    // Moving a poster to the other session is picking it here: the number then
    // jumps to the next free board there, and "Update published copy" writes
    // both. "Renumber within sessions" closes the gap it leaves behind.
    const sessionSelect = document.createElement("select");
    sessionSelect.title = "Poster session";
    sessionSelect.style.maxWidth = "9.5rem";
    for (const s of POSTER_SESSIONS) {
      const option = document.createElement("option");
      option.value = String(s);
      option.textContent = POSTER_SESSION_LABELS[s];
      sessionSelect.append(option);
    }
    const startSession = POSTER_SESSIONS.includes(abstract.posterSession)
      ? abstract.posterSession
      : lighterSession(published, abstract.topic);
    sessionSelect.value = String(startSession);
    posterInput.value = String(
      POSTER_SESSIONS.includes(abstract.posterSession) && Number.isInteger(abstract.posterNumber)
        ? abstract.posterNumber
        : nextPosterNumber(published, startSession));
    sessionSelect.addEventListener("change", () => {
      const s = Number(sessionSelect.value);
      posterInput.value = String(s === abstract.posterSession && abstract.posterNumber
        ? abstract.posterNumber
        : nextPosterNumber(published.filter((a) => a.id !== abstract.id), s));
    });
    const syncPosterInput = () => {
      posterInput.hidden = typeSelect.value !== "poster";
      sessionSelect.hidden = typeSelect.value !== "poster";
    };
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
          posterSession: Number(sessionSelect.value),
          posterNumber: Number(posterInput.value),
          acceptedAt: abstract.acceptedAt ?? null,
          editClosed,
        });
        say(`Published “${abstract.title}”.`, "ok");
      });
    accept.title = isPublished
      ? "Rewrite the public copy with the type, poster session and board number selected here"
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

    // Hidden in reviewer mode: the form lists every author and affiliation.
    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.hidden = blind;
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

    // Reviewer mode is for scoring, not deciding: no accepting, rejecting or
    // deleting while the committee is still reading.
    accept.hidden = blind;
    reject.hidden = blind;
    remove.hidden = blind;

    actions.append(typeSelect, sessionSelect, posterInput, accept, reject, edit, pull, remove);

    // The editor is mounted into the card it belongs to, in the same panel the
    // account page uses, so the form is never far from the abstract it edits.
    const editHost = document.createElement("div");
    editHost.className = "panel";
    editHost.hidden = true;

    // Reviewer mode: who wrote it, who submitted it and where they work all stay
    // off the card. The title, topic, text and figure are what gets reviewed.
    if (blind) article.append(meta, body, figure, reviewBlock(abstract), actions, editHost);
    else article.append(byline, from, affil, meta, body, figure,
      reviewBlock(abstract), actions, editHost);

    if (editingId === abstract.id && !blind) {
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
          posterSession: abstract.posterSession,
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
      reviewsById,
      direction: sortBy === "score-asc" ? "asc" : "desc",
      // The mean is the committee's opinion; in reviewer mode the order would
      // leak it, so "score" means the organizer's own.
      uid: blind ? adminUid : null,
    });
  }

  async function render() {
    // One read each for the whole page, joined in memory — far cheaper than a
    // per-card lookup, and it is what lets a card draw its reviews synchronously.
    const [abstracts, publicCopies, users, reviews, admins, config] = await Promise.all([
      listAbstracts(), listPublicAbstracts(), listUsers(), listReviews(), listAdmins(),
      getSiteConfig(),
    ]);
    published = publicCopies;

    blind = config?.reviewerMode === true;
    editClosed = !submissionWindows(config).editOpen;
    blindToggle.checked = blind;
    host.querySelector("#adm-blind").hidden = !blind;
    host.querySelector("#adm-search").placeholder = blind
      ? "title, text"
      : "title, author, affiliation, text";
    host.querySelector("#adm-export-scores").hidden = blind;
    host.querySelector("#adm-clear-reviews").hidden = blind;
    if (blind) editingId = null;

    reviewsById = reviews;
    const usersById = new Map(users.map((u) => [u.id, u]));
    reviewers = reviewerList(admins, usersById);
    labels = reviewerLabels(reviewers, reviewsById);

    annotated = annotateAbstracts(abstracts, { published, users });
    // Sorted before grouping: groupByTopic preserves input order, so ordering
    // the flat list here is what orders each topic. The exports read `shown`,
    // so a CSV comes out in the order on screen.
    //
    // In reviewer mode the search runs on author-less copies, so typing a
    // colleague's name cannot single out their abstract; the full records are
    // what get drawn and exported (the blind export strips them itself).
    const matching = blind
      ? new Set(filterAdminAbstracts(annotated.map(stripAuthors), filters).map((a) => a.id))
      : null;
    shown = sortShown(matching
      ? annotated.filter((a) => matching.has(a.id))
      : filterAdminAbstracts(annotated, filters));

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
    bulk();

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

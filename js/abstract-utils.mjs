import { POSTER_SESSIONS, POSTER_SESSION_LABELS } from "./config.mjs";

const collator = new Intl.Collator("en", { sensitivity: "base" });

/** Author names with their 1-based affiliation superscript marks. */
export function authorLineParts(authors) {
  return (authors ?? []).map((author) => ({
    name: String(author?.name ?? "").trim(),
    marks: (author?.affiliationIndexes ?? []).map((i) => i + 1).join(","),
    presenting: Boolean(author?.presenting),
  }));
}

/**
 * The one name a collapsed list row shows: "Ana Ferreira et al."
 *
 * The presenting author, because they are who stands at the poster and who a
 * reader is looking for; the first author when nobody is marked, so a malformed
 * record still names somebody. "et al." counts *authors*, not presenters — two
 * people marked presenting is a data error, and swallowing the second one would
 * hide it. Empty string for no authors at all, so the caller can skip the line.
 */
export function summaryAuthorLine(authors) {
  const list = (authors ?? []).filter((a) => String(a?.name ?? "").trim());
  if (!list.length) return "";
  const lead = list.find((a) => a?.presenting) ?? list[0];
  const name = String(lead.name).trim();
  return list.length > 1 ? `${name} et al.` : name;
}

/**
 * The next free board number. With `session`, the next one within that poster
 * session, since numbering restarts in each: P1-1… and P2-1….
 */
export function nextPosterNumber(publicAbstracts, session = null) {
  const used = (publicAbstracts ?? [])
    .filter((a) => session === null || a?.posterSession === session)
    .map((a) => a?.posterNumber)
    .filter((n) => Number.isInteger(n));
  return used.length ? Math.max(...used) + 1 : 1;
}

// --------------------------------------------------------- poster sessions

const isSession = (n) => POSTER_SESSIONS.includes(n);

/**
 * A poster's board code: "P1-3" is session 1, third board. A poster numbered
 * before the sessions existed has no session and keeps its old "P3", so a
 * board printed then still reads correctly. Empty for anything without a
 * number, talks included.
 */
export function posterCode(abstract) {
  if (abstract?.type && abstract.type !== "poster") return "";
  const n = abstract?.posterNumber;
  if (!Number.isInteger(n) || n < 1) return "";
  return isSession(abstract.posterSession) ? `P${abstract.posterSession}-${n}` : `P${n}`;
}

/**
 * Deal posters into the two sessions: topic by topic in the order given,
 * alternating 1, 2, 1, 2… on ONE counter that runs across topics. Each topic
 * then splits within one poster of even, and so do the two sessions overall.
 * Numbers restart in each session and follow the same order, so inside a
 * session the boards still run topic by topic.
 */
export function splitPosterSessions(posters, topics) {
  const next = new Map(POSTER_SESSIONS.map((s) => [s, 1]));
  return displayOrder(posters, topics).map((a, i) => {
    const posterSession = POSTER_SESSIONS[i % POSTER_SESSIONS.length];
    const posterNumber = next.get(posterSession);
    next.set(posterSession, posterNumber + 1);
    return { id: a.id, posterSession, posterNumber };
  });
}

/**
 * Close the gaps a move between sessions leaves: every poster keeps its
 * session and is numbered 1… within it, topic by topic in the order given. A
 * poster with no session yet goes to the lighter one.
 */
export function renumberWithinSessions(posters, topics) {
  const placed = [];
  for (const a of displayOrder(posters, topics)) {
    const posterSession = isSession(a.posterSession)
      ? a.posterSession
      : lighterSession(placed, a.topic);
    placed.push({ id: a.id, topic: a.topic, posterSession });
  }
  const next = new Map(POSTER_SESSIONS.map((s) => [s, 1]));
  return placed.map(({ id, posterSession }) => {
    const posterNumber = next.get(posterSession);
    next.set(posterSession, posterNumber + 1);
    return { id, posterSession, posterNumber };
  });
}

/**
 * Where one more poster of `topic` should go to keep the split even: the
 * session holding fewer posters of that topic, then fewer posters overall,
 * then session 1. Talks are not counted.
 */
export function lighterSession(publicAbstracts, topic) {
  const posters = (publicAbstracts ?? []).filter((a) => a?.type !== "talk");
  const count = (s, sameTopic) => posters.filter((a) =>
    a?.posterSession === s && (!sameTopic || a?.topic === topic)).length;
  return [...POSTER_SESSIONS].sort((a, b) =>
    count(a, true) - count(b, true) || count(a, false) - count(b, false) || a - b)[0];
}

/**
 * The public list's sections: talks first, then each poster session in turn,
 * then any poster not yet given a session. Input order is kept within each,
 * and empty sections are dropped.
 */
export function groupBySession(list) {
  const groups = [
    { key: "talks", label: "Talks", items: [] },
    ...POSTER_SESSIONS.map((s) => ({ key: s, label: POSTER_SESSION_LABELS[s], items: [] })),
    { key: "unassigned", label: "Posters", items: [] },
  ];
  const byKey = new Map(groups.map((g) => [g.key, g]));
  for (const a of list ?? []) {
    const key = a?.type === "talk" ? "talks"
      : isSession(a?.posterSession) ? a.posterSession : "unassigned";
    byKey.get(key).items.push(a);
  }
  return groups.filter((g) => g.items.length);
}

/** The heading a poster session carries on the public list, and its link. */
export const posterSessionAnchor = (session) => `poster-session-${session}`;
export const posterSessionLink = (session) => `abstracts.html#${posterSessionAnchor(session)}`;

/** Free-text search over title, body, author names, and affiliations. */
export function filterAbstracts(list, term) {
  const needle = String(term ?? "").trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter((a) => {
    const haystack = [
      a?.title ?? "",
      a?.body ?? "",
      a?.topic ?? "",
      ...(a?.authors ?? []).map((author) => author?.name ?? ""),
      ...(a?.affiliations ?? []),
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Narrow the review pile.
 *
 * `type` is the PRESENTATION type, which lives only on the published copy, so
 * the caller annotates each abstract with `publicType` first (see
 * annotateAbstracts in abstract-export-utils.mjs). "unpublished" is a real
 * choice rather than an absence: "what have we not decided on yet" is the
 * question the committee actually asks.
 */
export function filterAdminAbstracts(
  list,
  { q = "", status = "", type = "", topic = "", talk = "" } = {},
) {
  const matched = (list ?? []).filter((a) =>
    (!status || a?.status === status)
    && (!topic || a?.topic === topic)
    && matchesType(a?.publicType ?? null, type)
    && matchesTalk(a?.talkConsidered, talk));
  return filterAbstracts(matched, q);
}

function matchesType(publicType, wanted) {
  if (!wanted) return true;
  if (wanted === "unpublished") return !publicType;
  return publicType === wanted;
}

/**
 * The submitter's talk opt-out, which is the committee's shortlist in reverse:
 * promoting somebody who ticked "not for a talk" is the one mistake this filter
 * exists to prevent.
 *
 * Only an explicit `false` is an opt-out. A missing field means the question was
 * never asked, and treating that as a refusal would hide abstracts from the very
 * list they belong on.
 */
function matchesTalk(talkConsidered, wanted) {
  if (!wanted) return true;
  return wanted === "optedout" ? talkConsidered === false : talkConsidered !== false;
}

/**
 * Talks first, then posters by session (none last) and board number; ties
 * broken on title.
 */
export function sortPublicAbstracts(list) {
  const rank = (a) => (a?.type === "talk" ? 0 : 1);
  const session = (a) => (isSession(a?.posterSession) ? a.posterSession : Number.MAX_SAFE_INTEGER);
  return [...list].sort((a, b) =>
    rank(a) - rank(b) ||
    session(a) - session(b) ||
    (a?.posterNumber ?? Number.MAX_SAFE_INTEGER) - (b?.posterNumber ?? Number.MAX_SAFE_INTEGER) ||
    collator.compare(String(a?.title ?? ""), String(b?.title ?? "")));
}

/**
 * Group abstracts by topic for the review console, in the order topics are
 * declared in config. Anything with an unrecognised or missing topic lands in a
 * final "Other" bucket rather than vanishing — an abstract the reviewers cannot
 * see is worse than an untidy heading. Empty topics are dropped.
 */
export function groupByTopic(list, topics) {
  const buckets = new Map(topics.map((topic) => [topic, []]));
  const other = [];
  for (const abstract of list ?? []) {
    const bucket = buckets.get(abstract?.topic);
    (bucket ?? other).push(abstract);
  }
  const groups = [...buckets.entries()]
    .filter(([, items]) => items.length)
    .map(([topic, items]) => ({ topic, items }));
  if (other.length) groups.push({ topic: null, items: other });
  return groups;
}

/**
 * The flat order the review console draws: topic by topic, each topic in the
 * order it was given. Board numbers follow this, so P1, P2… read down the
 * screen the committee was looking at when it pressed the button.
 */
export function displayOrder(list, topics) {
  return groupByTopic(list, topics).flatMap((group) => group.items);
}

/**
 * Everything the committee has not decided on. Mirrors the console's "in
 * review" count, which also sweeps up a legacy `withdrawn`.
 */
export function inReview(list) {
  return (list ?? []).filter((a) => a?.status !== "accepted" && a?.status !== "rejected");
}

/** Consecutive board numbers from `start`, in list order. */
export function posterNumbering(list, start = 1) {
  return (list ?? []).map((a, i) => ({ id: a.id, posterNumber: start + i }));
}

/**
 * Speaker and affiliation for a program slot linked to an abstract: the
 * presenting author (the first author when nobody is marked) and their first
 * affiliation. Empty strings rather than undefined, so a form can take them
 * as they are.
 */
export function presenterOf(abstract) {
  const authors = (abstract?.authors ?? []).filter((a) => String(a?.name ?? "").trim());
  const lead = authors.find((a) => a?.presenting) ?? authors[0];
  if (!lead) return { speaker: "", affiliation: "" };
  const index = (lead.affiliationIndexes ?? [])[0];
  return {
    speaker: String(lead.name).trim(),
    affiliation: String(abstract.affiliations?.[index] ?? "").trim(),
  };
}

/**
 * A stable string standing in for the editable content of one draft.
 *
 * The account page has to know whether an open editor holds unsaved work before
 * it offers to save it, and the only honest answer is "does it still match what
 * was loaded". Comparing a fingerprint rather than the object keeps key order
 * out of it, so a draft rebuilt from the DOM compares equal to the one that
 * seeded it. Figure changes live outside the form fields and are tracked
 * separately by the caller.
 */
export function draftFingerprint(draft) {
  const authors = (draft?.authors ?? []).map((author) => [
    String(author?.name ?? "").trim(),
    (author?.affiliationIndexes ?? []).join(","),
    author?.presenting ? "1" : "0",
  ].join("␟"));
  return JSON.stringify([
    String(draft?.title ?? "").trim(),
    String(draft?.topic ?? ""),
    (draft?.affiliations ?? []).map((a) => String(a).trim()),
    authors,
    String(draft?.body ?? ""),
    draft?.talkConsidered !== false,
    String(draft?.figureCaption ?? "").trim(),
    draft?.publishChoice === "titleOnly" ? "titleOnly" : "full",
    draft?.publishConfirmed === true,
  ]);
}

/**
 * Where a submission stands, in words its author can act on.
 *
 * `status` is the private document's; `published` is the `abstracts_public`
 * copy, which is the only place the poster/talk decision and the board number
 * live. An accepted abstract with no public copy is a half-finished
 * acceptance in the console, so it says only "Accepted".
 *
 * Anything unrecognised reads as "In review" deliberately: a wrong label here
 * is a promise to a participant, and under-claiming is the safe direction.
 */
export function submissionStatusLabel(status, published = null) {
  if (status === "accepted") {
    if (published?.type === "talk") return "Accepted as a talk";
    if (published?.type === "poster") {
      const code = posterCode(published);
      return code ? `Accepted as poster ${code}` : "Accepted as a poster";
    }
    return "Accepted";
  }
  if (status === "rejected") return "Not accepted";
  return "In review";
}

/**
 * Which of the three colours the status pill takes.
 *
 * Split from the label rather than returned with it so the label stays a plain
 * string for the dozen places that only want the words. The two agree by
 * construction: everything that is not a decision is "review", which is also
 * what a legacy `withdrawn` document lands on.
 */
export function submissionStatusTone(status) {
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "rejected";
  return "review";
}

// ------------------------------------------- windows and the public listing

/** A Firestore Timestamp, a Date, or nothing, as a Date or null. */
const asDate = (value) => value?.toDate?.() ?? (value instanceof Date ? value : null);

/**
 * Which of the two windows in config/site are open.
 *
 * `submitOpen` is the original window, the checkbox and its deadline, and it now
 * governs only CREATING an abstract. A missing deadline counts as no deadline,
 * as it always has on the client.
 *
 * `editOpen` governs editing and retracting an existing abstract, and choosing
 * how it is published. It is the editing checkbox and deadline OR the
 * submission window: somebody who submitted five minutes ago can always fix a
 * typo, and a config written before the editing fields existed behaves exactly
 * as it did then. Missing editing fields mean closed, never open.
 *
 * Mirrors submissionWindowOpen() and editWindowOpen() in firestore.rules, which
 * are the real boundary; this only decides what the pages offer.
 */
export function submissionWindows(config, now = new Date()) {
  const deadline = asDate(config?.submissionDeadline);
  const editingDeadline = asDate(config?.editingDeadline);
  const submitOpen = Boolean(config?.submissionsOpen) && (!deadline || now < deadline);
  const editingOpen = config?.editingOpen === true
    && Boolean(editingDeadline) && now < editingDeadline;
  return {
    submitOpen,
    editOpen: submitOpen || editingOpen,
    deadline,
    editingDeadline,
  };
}

/**
 * What a participant may do to their own abstract right now.
 *
 * Everything hangs on the editing window. Inside it, an abstract still in
 * review (or rejected) can be edited and retracted; an accepted one can be
 * edited only when its public copy exists, because every save has to rewrite
 * that copy too; and a TALK can never be retracted, since the programme is
 * built around it. Mirrors the owner rules on abstracts/{uid} in
 * firestore.rules.
 */
export function ownerCan(abstract, published, windows) {
  if (!abstract || !windows?.editOpen) return { edit: false, retract: false };
  if (abstract.status !== "accepted") return { edit: true, retract: true };
  if (!published) return { edit: false, retract: false };
  return { edit: true, retract: published.type === "poster" };
}

/**
 * How an accepted abstract appears on the public list.
 *
 *   full       title, authors and the abstract text
 *   titleOnly  title and authors, by the author's confirmed choice
 *   pending    title and authors, because the author has not confirmed yet
 *
 * An unconfirmed choice is held back until the editing window closes, and only
 * then falls to the default, `full`. Nothing here ever publishes the figure.
 * firestore.rules expectedMode() is the owner-side half of the same function:
 * an owner can only write while editing is open, so for them it is never
 * `full` by default.
 */
export function publicMode(abstract, { editClosed = false } = {}) {
  if (abstract?.publishConfirmed === true) {
    return abstract.publishChoice === "titleOnly" ? "titleOnly" : "full";
  }
  return editClosed ? "full" : "pending";
}

/**
 * The content half of an abstracts_public document: what the public may read
 * of an abstract under `mode`. The figure and its caption are deliberately
 * absent — they are for the organizers and reviewers only.
 */
export function publicFields(abstract, mode) {
  return {
    title: abstract?.title ?? "",
    affiliations: abstract?.affiliations ?? [],
    authors: abstract?.authors ?? [],
    topic: abstract?.topic ?? null,
    body: mode === "full" ? (abstract?.body ?? "") : null,
    publishMode: mode,
  };
}

/**
 * The confirmation a participant answers before retracting. Shared with the
 * Retract button on abstracts.html, so both say the same thing — including,
 * once submissions have closed, that there is no second attempt.
 */
export function retractQuestion(abstract, windows) {
  return `Retract “${abstract?.title ?? "your abstract"}”? `
    + "If you retract the poster you won’t be able to present it at PINTS. "
    + (windows?.submitOpen ? "" : "Submissions are closed, so you can’t submit a new one. ")
    + "This cannot be undone.";
}

/**
 * The id a row of the public list carries, and the link that opens it there.
 * A hash rather than ?a=: it lands on the row in its place among the others,
 * which is what the program wants — a talk read alongside its session.
 */
export const abstractAnchor = (id) => `abstract-${id}`;
export const abstractListLink = (id) => `abstracts.html#${encodeURIComponent(abstractAnchor(id))}`;

/**
 * Reviewer scores and notes.
 *
 * Every organizer holds their own score and their own note, stored as a map
 * keyed by reviewer uid inside abstract_reviews/{abstractId}. A map rather than
 * a subcollection because the console shows every review on every card, and a
 * subcollection would be one extra read per abstract for data that is never
 * fetched separately.
 *
 * Pure: no DOM, no Firestore. db.js owns the merge write that keeps two
 * organizers reviewing at once from overwriting each other.
 */

/**
 * The committee's four-point scale. A number per answer, so a mean still makes
 * sense and the spreadsheet sorts, but every place a score is shown to a person
 * carries its word as well: "3" alone does not say whether that is praise.
 *
 * 1 is a veto, not merely a low mark — see `vetoes` in reviewStats().
 */
export const SCORE_LABELS = Object.freeze({
  1: "veto: reject",
  2: "ok",
  3: "good",
  4: "accept",
});

export const SCORE_MIN = 1;
export const SCORE_MAX = 4;
export const VETO = 1;

/**
 * Scores are whole numbers 1–4. Anything else is treated as "not scored" —
 * including a 5–10 left over from the old ten-point scale, which cannot be
 * read as a point on this one.
 */
export const isScore = (value) =>
  Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX;

/** A score saved under the old 1–10 scale, which no longer counts. */
export const isRetiredScore = (value) =>
  Number.isInteger(value) && value > SCORE_MAX && value <= 10;

/** The 1–4 options, for building a <select>. */
export const scoreOptions = () =>
  Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);

/** "3 (good)" — a score as a person reads it. */
export const scoreLabel = (score) =>
  (isScore(score) ? `${score} (${SCORE_LABELS[score]})` : "");

/**
 * Read one abstract's reviews map into something sortable and displayable.
 *
 * An entry with a note but no score still counts as a review — an organizer who
 * writes "conflict of interest, abstaining" has reviewed it — so `entries` and
 * `count` are deliberately different numbers.
 */
export function reviewStats(reviews) {
  const entries = Object.entries(reviews ?? {})
    .map(([uid, review]) => ({
      uid,
      score: isScore(review?.score) ? review.score : null,
      note: String(review?.note ?? ""),
    }))
    .filter((entry) => entry.score !== null || entry.note.trim() !== "")
    .sort((a, b) => a.uid.localeCompare(b.uid));

  const scored = entries.filter((entry) => entry.score !== null);
  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  return {
    entries,
    count: scored.length,
    // One decimal: a mean of 2.333… reads as false precision on a 1–4 scale
    // with three reviewers.
    mean: scored.length ? Math.round((total / scored.length) * 10) / 10 : null,
    // Counted separately because a mean hides them: three 4s and a veto
    // average 3.3, which reads as "good" about an abstract somebody rejected.
    vetoes: scored.filter((entry) => entry.score === VETO).length,
  };
}

const vetoText = (vetoes) => (vetoes ? ` · ${vetoes} veto${vetoes === 1 ? "" : "es"}` : "");

/** "Mean 2.7 · 3 of 5 organizers scored · 1 veto" — or plain English when nobody has. */
export function describeReviewStats({ mean, count, vetoes = 0 }, reviewerCount) {
  if (!count) return "Not scored yet.";
  return `Mean ${mean.toFixed(1)} · ${count} of ${reviewerCount} organizer`
    + `${reviewerCount === 1 ? "" : "s"} scored${vetoText(vetoes)}`;
}

/**
 * "2.7 · 3 scored · 1 veto" — the same numbers as describeReviewStats, short
 * enough to sit in a collapsed list row beside a title.
 *
 * `count` is how many organizers put a number on it, which is not how many
 * wrote something: a note without a score is an opinion, not a vote.
 */
export function summariseScore({ mean, count, vetoes = 0 } = {}) {
  if (!count) return "not scored";
  return `${mean.toFixed(1)} · ${count} scored${vetoText(vetoes)}`;
}

/** One organizer's own score on one abstract, or null. */
export const myScore = (reviews, uid) => {
  const score = reviews?.[uid]?.score;
  return isScore(score) ? score : null;
};

/** "your score 3 (good)" — the collapsed row in reviewer mode, where the mean is hidden. */
export function myScoreSummary(reviews, uid) {
  const score = myScore(reviews, uid);
  return score === null ? "not scored by you" : `your score ${scoreLabel(score)}`;
}

/**
 * "Reviewer 1", "Reviewer 2"… — who wrote a review, without saying who.
 *
 * Numbered in uid order, NOT name order: `reviewers` is sorted by name, and
 * numbering it as-is would make "Reviewer 1" the alphabetically first organizer
 * on every abstract. One map for the whole page, so a label means the same
 * person on every card and in the export.
 *
 * Someone who reviewed and has since lost admin rights still wrote a review; a
 * uid found in `reviewsById` but not among `reviewers` is numbered after them.
 */
export function reviewerLabels(reviewers, reviewsById = new Map()) {
  const uids = new Set((reviewers ?? []).map((r) => r.uid));
  const strays = new Set();
  for (const stored of reviewsById?.values?.() ?? []) {
    for (const uid of Object.keys(stored?.reviews ?? {})) {
      if (!uids.has(uid)) strays.add(uid);
    }
  }
  const ordered = [...[...uids].sort(), ...[...strays].sort()];
  return new Map(ordered.map((uid, i) => [uid, `Reviewer ${i + 1}`]));
}

/**
 * How many comments "Delete all review comments" would remove, and from how
 * many abstracts — counted the way db.js clearAllReviewNotes() counts them, so
 * the confirmation does not promise a number the deletion then contradicts.
 */
export function countReviewNotes(reviewsById = new Map()) {
  let notes = 0;
  let abstracts = 0;
  for (const stored of reviewsById?.values?.() ?? []) {
    const here = Object.values(stored?.reviews ?? {})
      .filter((review) => String(review?.note ?? "").trim()).length
      + (String(stored?.note ?? "").trim() ? 1 : 0);
    notes += here;
    if (here) abstracts += 1;
  }
  return { notes, abstracts };
}

const collator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * Order abstracts by what the committee thought of them.
 *
 * `groupByTopic` preserves input order, so sorting the flat list before grouping
 * is what makes the order hold *within* each topic — which is the only place it
 * means anything, since comparing a cognitive abstract's 7.4 against a systems
 * one's 7.6 is comparing two different panels' habits.
 *
 * **Unscored abstracts sort last in both directions.** "No score" is not a low
 * score, and in "lowest first" they would otherwise fill the top of every topic
 * and bury the abstract the committee actually rated worst. Ties break on title,
 * so the order is stable across renders — this list re-renders after every
 * action and rows must not shuffle under the cursor.
 */
export function sortByMeanScore(list, { reviewsById = new Map(), direction = "desc", uid = null } = {}) {
  const sign = direction === "asc" ? 1 : -1;
  // `uid` is reviewer mode: sort by that organizer's own score, since the mean
  // is everybody else's opinion and must not leak through the order.
  const meanOf = uid
    ? (abstract) => myScore(reviewsById.get(abstract?.id)?.reviews, uid)
    : (abstract) => reviewStats(reviewsById.get(abstract?.id)?.reviews).mean;
  return [...(list ?? [])].sort((a, b) => {
    const [ma, mb] = [meanOf(a), meanOf(b)];
    if (ma === null && mb === null) return byTitle(a, b);
    if (ma === null) return 1;
    if (mb === null) return -1;
    return sign * (ma - mb) || byTitle(a, b);
  });
}

/** Alphabetical, the fallback order and the tie-break for every other one. */
export function sortByTitle(list) {
  return [...(list ?? [])].sort(byTitle);
}

const byTitle = (a, b) => collator.compare(String(a?.title ?? ""), String(b?.title ?? ""));

/**
 * The whole committee's scores and comments as a spreadsheet: one row per
 * abstract, a score column and a comment column per organizer, then the mean,
 * how many scored it, and how many vetoed it. Scores are bare numbers here, not
 * "3 (good)": a spreadsheet has to be able to sort and average them.
 *
 * The columns are headed with `labels` ("Reviewer 2"), not names: reviews are
 * anonymous to the committee, in the export as on screen. They are ordered by
 * label, so "Reviewer 1" comes first. Every reviewer still gets their pair of
 * columns when they have scored nothing — an empty column is a fact worth
 * seeing when you are chasing people for reviews.
 */
export function reviewScoreMatrix(
  annotated,
  { reviewsById = new Map(), reviewers = [], labels = reviewerLabels(reviewers, reviewsById) } = {},
) {
  const uids = [...labels.keys()];
  const columns = [
    { key: "title", label: "Title" },
    { key: "topic", label: "Topic" },
    { key: "status", label: "Status" },
    { key: "type", label: "Presentation" },
    { key: "submitter", label: "Submitted by" },
    ...uids.flatMap((uid) => [
      { key: `r:${uid}`, label: `${labels.get(uid)} score` },
      { key: `c:${uid}`, label: `${labels.get(uid)} comment` },
    ]),
    { key: "mean", label: "Mean" },
    { key: "count", label: "Scores" },
    { key: "vetoes", label: "Vetoes" },
  ];

  const rows = (annotated ?? []).map((abstract) => {
    const stats = reviewStats(reviewsById.get(abstract.id)?.reviews);
    const byUid = new Map(stats.entries.map((entry) => [entry.uid, entry]));
    const row = {
      title: abstract.title ?? "",
      topic: abstract.topic ?? "",
      status: abstract.status ?? "",
      type: abstract.publicType ?? "",
      submitter: abstract.submitterName ?? "",
      mean: stats.mean ?? "",
      count: stats.count,
      vetoes: stats.vetoes,
    };
    for (const uid of uids) {
      row[`r:${uid}`] = byUid.get(uid)?.score ?? "";
      row[`c:${uid}`] = byUid.get(uid)?.note ?? "";
    }
    return row;
  });

  return { columns, rows };
}

/**
 * Who the score columns belong to.
 *
 * An organizer is normally a participant too, so their profile carries a real
 * name; fall back to the email on their admins document, and to the raw uid
 * only if neither exists. A column headed with a uid is useless but still
 * better than a column headed with nothing.
 */
export function reviewerList(adminDocs, usersById) {
  return (adminDocs ?? [])
    .map((admin) => ({
      uid: admin.id,
      name: usersById?.get(admin.id)?.displayName || admin.email || admin.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

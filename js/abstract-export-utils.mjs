import { TOPIC_LABELS } from "./config.mjs";

/**
 * Flattening for the review console: joins, projections, and CSV shapes.
 *
 * Pure on purpose. Everything here is the kind of code that is wrong in a way
 * nobody notices until an organizer opens the spreadsheet the night before the
 * meeting and a column is off by one.
 */

/** A Firestore Timestamp, a Date, or nothing -> "YYYY-MM-DD" or "". */
export function isoDate(value) {
  const date = typeof value?.toDate === "function" ? value.toDate()
    : value instanceof Date ? value
    : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

/**
 * Join each abstract to its published copy and its submitter, once.
 *
 * The console needs the presentation type to filter on, the board number to
 * show, and the submitter's name to display — all three from other collections.
 * Doing the join here means the cards, the filter and both exports read the
 * same fields and cannot disagree about them.
 */
export function annotateAbstracts(abstracts, { published = [], users = [] } = {}) {
  const publicById = new Map((published ?? []).map((p) => [p.id, p]));
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  return (abstracts ?? []).map((abstract) => {
    const live = publicById.get(abstract.id) ?? null;
    const submitter = userById.get(abstract.ownerUid) ?? null;
    return {
      ...abstract,
      publicType: live?.type ?? null,
      posterNumber: live?.posterNumber ?? null,
      acceptedAt: live?.acceptedAt ?? null,
      submitterName: submitter?.displayName ?? "",
      submitterEmail: submitter?.email ?? "",
    };
  });
}

/** "Alice Dupont (1), Bob Martin (1,2)" — the affiliation marks readers expect. */
export function authorsCell(authors) {
  return (authors ?? []).map((author) => {
    const marks = (author?.affiliationIndexes ?? []).map((i) => i + 1).join(",");
    return marks ? `${author?.name ?? ""} (${marks})` : String(author?.name ?? "");
  }).join("; ");
}

export const presentingAuthor = (authors) =>
  (authors ?? []).find((a) => a?.presenting)?.name ?? "";

export const ABSTRACT_EXPORT_COLUMNS = [
  { key: "title", label: "Title" },
  { key: "topic", label: "Topic" },
  { key: "status", label: "Status" },
  { key: "type", label: "Presentation" },
  { key: "posterNumber", label: "Poster number" },
  { key: "presenting", label: "Presenting author" },
  { key: "authors", label: "Authors" },
  { key: "affiliations", label: "Affiliations" },
  { key: "submitterName", label: "Submitted by" },
  { key: "submitterEmail", label: "Submitter email" },
  { key: "talkConsidered", label: "Considered for a talk" },
  { key: "figureCaption", label: "Figure caption" },
  { key: "figureUrl", label: "Figure URL" },
  { key: "createdAt", label: "Submitted on" },
  { key: "updatedAt", label: "Last edited" },
  { key: "body", label: "Abstract" },
];

/** One row per abstract, in the order ABSTRACT_EXPORT_COLUMNS declares. */
export function abstractExportRows(annotated) {
  return (annotated ?? []).map((a) => ({
    title: a.title ?? "",
    topic: TOPIC_LABELS[a.topic] ?? a.topic ?? "",
    status: a.status ?? "",
    // Blank, not "poster": everything is submitted as a poster, and printing
    // that for an undecided abstract would read as a decision nobody made.
    type: a.publicType ?? "",
    posterNumber: a.publicType === "poster" && a.posterNumber ? a.posterNumber : "",
    presenting: presentingAuthor(a.authors),
    authors: authorsCell(a.authors),
    affiliations: (a.affiliations ?? []).map((x, i) => `${i + 1}. ${x}`).join("; "),
    submitterName: a.submitterName ?? "",
    submitterEmail: a.submitterEmail ?? "",
    talkConsidered: a.talkConsidered === false ? "no" : "yes",
    figureCaption: a.figureCaption ?? "",
    figureUrl: a.figureUrl ?? "",
    createdAt: isoDate(a.createdAt),
    updatedAt: isoDate(a.updatedAt),
    body: a.body ?? "",
  }));
}

// ------------------------------------------------------------ reviewer mode

/** Who wrote it, and where from: everything reviewer mode keeps off the screen. */
const IDENTIFYING_KEYS = ["presenting", "authors", "affiliations", "submitterName", "submitterEmail"];

/**
 * The abstracts export in reviewer mode: no authors, no affiliations, no
 * submitter, and the exporting organizer's OWN score and comment — never
 * anybody else's, which is the other half of a blind review.
 *
 * toCsv() writes only the declared columns, so dropping them here is what
 * keeps the names out of the file; the rows may still carry them.
 */
export const BLIND_EXPORT_COLUMNS = [
  ...ABSTRACT_EXPORT_COLUMNS.filter((c) => !IDENTIFYING_KEYS.includes(c.key)),
  { key: "myScore", label: "My score" },
  { key: "myComment", label: "My comment" },
];

export function blindExportRows(annotated, { reviewsById = new Map(), uid } = {}) {
  return abstractExportRows((annotated ?? []).map(stripAuthors)).map((row, i) => {
    const mine = reviewsById.get(annotated[i].id)?.reviews?.[uid] ?? {};
    return {
      ...row,
      myScore: Number.isInteger(mine.score) ? mine.score : "",
      myComment: String(mine.note ?? ""),
    };
  });
}

/**
 * A copy of an abstract with every identifying field removed.
 *
 * Search runs on these in reviewer mode. Hiding the names but still matching on
 * them would let anybody find out which abstract is a colleague's by typing
 * the colleague's name into the box.
 */
export function stripAuthors(abstract) {
  const { authors, affiliations, submitterName, submitterEmail, ...rest } = abstract ?? {};
  return { ...rest, authors: [], affiliations: [], submitterName: "", submitterEmail: "" };
}

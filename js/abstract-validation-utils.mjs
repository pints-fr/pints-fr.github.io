import { ABSTRACT_TOPICS, LIMITS } from "./config.mjs";

/** One affiliation per line; blanks dropped. */
export function parseAffiliations(text) {
  return String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

/** "1,2" (what the author types) -> [0,1] (what we store). */
export function parseAffiliationIndexes(input) {
  return String(input ?? "").trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((token) => Number(token) - 1);
}

/**
 * Validate an abstract before writing it.
 *
 * firestore.rules enforces the same limits server-side; this exists to give
 * people a readable list of problems instead of a PERMISSION_DENIED.
 */
export function validateAbstract(
  input,
  { now = new Date(), submissionsOpen = true, deadline = null } = {},
) {
  const errors = [];
  const title = String(input?.title ?? "").trim();
  const body = String(input?.body ?? "").trim();
  const authors = Array.isArray(input?.authors) ? input.authors : [];
  const affiliations = Array.isArray(input?.affiliations) ? input.affiliations : [];

  if (!submissionsOpen) errors.push("Submissions are closed.");
  if (deadline && now > new Date(deadline)) errors.push("The submission deadline has passed.");

  if (!title) errors.push("Title is required.");
  else if (title.length > LIMITS.title) {
    errors.push(`Title must be ${LIMITS.title} characters or fewer.`);
  }

  if (!body) errors.push("Abstract body is required.");
  else if (body.length > LIMITS.body) {
    errors.push(`Abstract must be ${LIMITS.body} characters or fewer.`);
  }

  if (affiliations.length > LIMITS.affiliations) {
    errors.push(`No more than ${LIMITS.affiliations} affiliations.`);
  }

  if (authors.length === 0) errors.push("At least one author is required.");
  else if (authors.length > LIMITS.authors) {
    errors.push(`No more than ${LIMITS.authors} authors.`);
  }

  authors.forEach((author, i) => {
    if (!String(author?.name ?? "").trim()) errors.push(`Author ${i + 1} needs a name.`);
    for (const index of author?.affiliationIndexes ?? []) {
      if (!Number.isInteger(index) || index < 0 || index >= affiliations.length) {
        errors.push(`Author ${i + 1} refers to affiliation ${index + 1}, which does not exist.`);
      }
    }
  });

  const presenting = authors.filter((a) => a?.presenting).length;
  if (presenting === 0) errors.push("Mark one presenting author.");
  else if (presenting > 1) errors.push("There can be only one presenting author.");

  if (!ABSTRACT_TOPICS.includes(input?.topic)) {
    errors.push("Choose a topic: cognitive, systems, or computational.");
  }

  // The figure lives outside the form fields — it is a File waiting to upload,
  // or a URL already in Storage — so the form reduces it to these two flags
  // before calling. Keeping the check here rather than in the DOM is what makes
  // it testable, and it mirrors validAbstract() in firestore.rules.
  //
  // Only required while the submission is still in the running for a talk —
  // a missing talkConsidered counts as willing, same as everywhere else this
  // flag is read (see abstract-utils.mjs's matchesTalk). Someone who has opted
  // out stays poster-only and needs neither.
  const requiresFigure = input?.talkConsidered !== false;
  const caption = String(input?.figureCaption ?? "").trim();
  if (requiresFigure && input?.hasFigure !== true) {
    errors.push("A figure is required to be considered for a talk.");
  }
  if (requiresFigure && !caption) {
    errors.push("The figure needs a caption to be considered for a talk.");
  }
  if (caption.length > LIMITS.figureCaption) {
    errors.push(`The figure caption must be ${LIMITS.figureCaption} characters or fewer.`);
  }

  return { valid: errors.length === 0, errors };
}

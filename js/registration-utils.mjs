// Whether new people may register, read off config/site.
//
// A missing document or a missing field counts as OPEN: the switch was added
// after the site went live, and a config written before it must not quietly
// close registration. firestore.rules reads the field the same way
// (registrationOpen()), so the page and the database agree on the default.

/** True unless an organizer has explicitly closed registration. */
export function isRegistrationOpen(config) {
  return config?.registrationOpen !== false;
}

// ------------------------------------------------- late-registration links
//
// An organizer can let one person in after registration has closed by sending
// them a link generated in Admin > Settings. Each link works once and expires.
// firestore.rules (redeemsLink() and registration_links/) is what enforces
// that; these helpers only describe it to the pages.

/** The validity choices the settings tab offers. */
export const LINK_DURATIONS = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
];

/** "missing", "used", "expired" or "valid", for a registration_links or submission_links document. */
export function linkStatus(link, now = new Date()) {
  if (!link) return "missing";
  if (link.usedBy) return "used";
  const expires = link.expiresAt?.toDate?.() ?? link.expiresAt;
  if (!(expires instanceof Date) || expires <= now) return "expired";
  return "valid";
}

/** Random bytes as lowercase hex: the token, and the document id. */
export function newLinkToken(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The address to send, resolved against the page generating it. */
export function registrationLinkUrl(baseHref, token) {
  const url = new URL("register.html", baseHref);
  url.searchParams.set("link", token);
  return url.href;
}

// ---------------------------------------------------- late-submission links
//
// The same single-use links for abstracts (submission_links/{token}, honoured
// by redeemsSubmissionLink() in firestore.rules): one new abstract, once,
// after submissions have closed. linkStatus() and newLinkToken() serve both.

/** The address to send, resolved against the page generating it. */
export function submissionLinkUrl(baseHref, token) {
  const url = new URL("submit.html", baseHref);
  url.searchParams.set("link", token);
  return url.href;
}

// ------------------------------------------------------ late-editing links
//
// The editing counterpart, also from Admin > Settings: a grant that reopens
// editing for ONE participant until it expires (edit_grants/{uid}, honoured by
// lateEditGranted() in firestore.rules). The grant is the capability, so the
// link itself is just the editor's address: forwarded, it opens nothing.

/** "active" or "expired", for an edit_grants document. */
export function grantStatus(grant, now = new Date()) {
  const expires = grant?.expiresAt?.toDate?.() ?? grant?.expiresAt;
  return expires instanceof Date && expires > now ? "active" : "expired";
}

/** The address to send with a grant, resolved against the page generating it. */
export function editLinkUrl(baseHref) {
  const url = new URL("submit.html", baseHref);
  url.searchParams.set("edit", "1");
  return url.href;
}

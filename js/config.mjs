// Single source of truth for edition-scoped and site-wide constants.
// Never hardcode any of these values elsewhere.

export const CURRENT_EDITION = "pints2026";
export const SITE_NAME = "PINTS";
export const SITE_TAGLINE = "Paris Île-de-France Neuroscience, Theory, and Systems";

// The current edition's date, time, and venue, as content/venue.md states them.
// The home page's "Add to calendar" links are built from this so they cannot
// drift from the copy. Times carry an explicit Paris offset -- Nov 6 falls
// after DST ends, so this is +01:00 -- which calendar-utils.mjs converts to
// UTC for Google/Outlook/ICS, letting every calendar app show it correctly
// converted to the viewer's own timezone.
export const EVENT = {
  title: "PINTS 2026",
  description: "Paris Île-de-France Neuroscience, Theory, and Systems.",
  location: "Daniel Cohen Amphitheater, ENS, 48 Bd Jourdan, 75014 Paris, France",
  start: "2026-11-06T09:00:00+01:00",
  end: "2026-11-06T18:00:00+01:00",
  url: "https://pints.fr/",
  // Scoped to the edition, not the shared url -- see calendar-utils.mjs.
  uid: CURRENT_EDITION,
};

export const NAV = [
  { href: "index.html", label: "Home" },
  { href: "program.html", label: "Program" },
  { href: "party.html", label: "Party" },
  { href: "abstracts.html", label: "Abstracts" },
  { href: "participants.html", label: "Participants" },
  { href: "venue.html", label: "Venue" },
  { href: "previous.html", label: "Archive" },
  { href: "about.html", label: "About" },
];

export const LIMITS = {
  displayName: 80,
  affiliation: 120,
  email: 200,
  title: 200,
  body: 2500,
  authors: 20,
  affiliations: 10,
  figureCaption: 600,
  pageMarkdown: 20000,
  contactMessage: 4000,
};

// The organizers' vocabulary, assigned when an abstract is accepted. Submitters
// no longer choose: everything is submitted as a poster, and the program
// committee promotes some of them to talks.
export const ABSTRACT_TYPES = ["poster", "talk"];
// "withdrawn" was retired: it existed only so the admin's Withdraw button had
// somewhere to put an abstract it pulled off the public list, and that action now
// returns it to review. A document that still holds it reads as "In review"
// (submissionStatusLabel) and normalises on the next save.
export const ABSTRACT_STATUSES = ["submitted", "accepted", "rejected"];
export const STATUS_LABELS = {
  submitted: "In review",
  accepted: "Accepted",
  rejected: "Not accepted",
};

export const ABSTRACT_TOPICS = ["cognitive", "systems", "computational"];
export const TOPIC_LABELS = {
  cognitive: "Cognitive",
  systems: "Systems",
  computational: "Computational",
};

// What a visitor is writing to the organizers about. The ids are stored and
// also appear in firestore.rules, which cannot import this file — the same
// hand-kept duplication ABSTRACT_TOPICS carries in validAbstract(). Changing
// this list means changing that one too, or the write is refused.
export const CONTACT_TOPICS = [
  "registration", "abstracts", "program", "venue", "website", "other",
];
export const CONTACT_TOPIC_LABELS = {
  registration: "Registration",
  abstracts: "Abstract submission",
  program: "Program and schedule",
  venue: "Venue and travel",
  website: "A problem with the website",
  other: "Something else",
};

export const SCHEDULE_KINDS = ["keynote", "talk", "poster", "break", "lunch", "social", "other"];

// Program sessions: the three abstract topics plus the invited block. A session
// is what a topic becomes once it is scheduled, so the ids are deliberately the
// same strings — an item tagged "systems" sits under the same banner as the
// abstracts filed under "systems". An item with no session (coffee, lunch, the
// poster slot) simply carries no `session` field and renders between the blocks.
export const SCHEDULE_SESSIONS = [...ABSTRACT_TOPICS, "keynote"];
export const SESSION_LABELS = {
  cognitive: "Cognitive Neuroscience",
  systems: "Systems Neuroscience",
  computational: "Computational Neuroscience",
  keynote: "Keynote Lectures",
};

// Figure uploads. maxEdge is applied by the client before upload; maxBytes is
// the hard limit that storage.rules also enforces.
export const FIGURE = {
  maxBytes: 5 * 1024 * 1024,
  maxEdge: 1600,
  types: ["image/png", "image/jpeg", "image/webp"],
};

// The photographs behind the home page hero.
//
// maxEdge is larger than a figure's: a figure is capped at the 62rem prose
// column, while the hero band is as wide as the window. maxPhotos is a limit on
// taste as much as on bytes -- a visitor sees one slide every intervalMs and
// leaves long before a twelfth would come round.
export const HERO = {
  maxBytes: 5 * 1024 * 1024,
  maxEdge: 1800,
  types: ["image/png", "image/jpeg", "image/webp"],
  maxPhotos: 12,
  intervalMs: 7000,
};

// Photographs of previous editions, uploaded from the admin console.
//
// maxEdge matches HERO's so that a photograph imported from the home page and
// one uploaded straight into an album are the same size on the page. maxPhotos
// is the ceiling firestore.rules already puts on gallery/{year}.photos, repeated
// here so the admin console can refuse the 201st before Firestore does.
export const ARCHIVE = {
  maxBytes: 5 * 1024 * 1024,
  maxEdge: 1800,
  types: ["image/png", "image/jpeg", "image/webp"],
  maxPhotos: 200,
  // Matches HERO.intervalMs: the two slideshows advance at the same pace, and
  // one number that means "long enough to look at a photograph" is easier to
  // retune than two. Unlike the hero's, this timer stops for good the moment a
  // reader touches the controls -- see mountSlideshow().
  intervalMs: 7000,
};

// Images uploaded from the Pages tab into page copy (the party photographs, for
// instance). maxEdge matches HERO's and ARCHIVE's: a photograph in a .photo-row
// can span the whole prose column, which is as wide as either of those gets.
export const PAGE_IMAGE = {
  maxBytes: 5 * 1024 * 1024,
  maxEdge: 1800,
  types: ["image/png", "image/jpeg", "image/webp"],
};

/**
 * Editable pages. `file` is the copy committed to the repo, which is both the
 * seed for a page that has never been edited on the site and the fallback when
 * the Firestore document is missing.
 */
export const PAGES = [
  { slug: "home", label: "Home", file: "content/home.md" },
  { slug: "about", label: "About", file: "content/about.md" },
  { slug: "venue", label: "Venue", file: "content/venue.md" },
  { slug: "party", label: "Party", file: "content/party.md" },
  { slug: "previous-editions", label: "Archive", file: "content/previous-editions.md" },
  { slug: "poster-guidelines", label: "Poster guidelines", file: "content/poster-guidelines.md" },
];

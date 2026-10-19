import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db, publicDb } from "./firebase.js";
import { CURRENT_EDITION } from "./config.mjs";
import { newLinkToken } from "./registration-utils.mjs";
import { publicFields, publicMode } from "./abstract-utils.mjs";

const snapData = (snap) => ({ id: snap.id, ...snap.data() });

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snapData(snap) : null;
}

/** The public half of a profile. One place builds it, so the two cannot drift. */
const publicProjection = (displayName, affiliation) => ({
  displayName: String(displayName ?? "").trim(),
  affiliation: String(affiliation ?? "").trim(),
  edition: CURRENT_EDITION,
  updatedAt: serverTimestamp(),
});

/**
 * Save the profile, and — unless told not to — its public projection, in a
 * single batch.
 *
 * Firestore rules cannot expose only some fields of users/{uid} — a read is
 * all-or-nothing — so the public name list is a separate collection written
 * here. Registering IS the consent; there is no opt-out to reconcile. What
 * `publish` gates is not consent but *readiness*: an address nobody has proved
 * they own should not put a name on a public page, so registration passes
 * false and the account page publishes once verification comes back true.
 *
 * `registrationLink` is for registering after registration has closed: the
 * profile records the token, and the same batch spends the link.
 * firestore.rules accepts the profile only if both happen together
 * (redeemsLink()).
 */
export async function saveProfile(
  uid,
  { email, displayName, affiliation },
  { publish = true, registrationLink = null } = {},
) {
  const clean = {
    email,
    displayName: displayName.trim(),
    affiliation: (affiliation ?? "").trim(),
    edition: CURRENT_EDITION,
    updatedAt: serverTimestamp(),
  };
  if (registrationLink) {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), { ...clean, registrationLink }, { merge: true });
    batch.update(doc(db, "registration_links", registrationLink),
      { usedBy: uid, usedAt: serverTimestamp() });
    if (publish) {
      batch.set(doc(db, "participants_public", uid),
        publicProjection(clean.displayName, clean.affiliation));
    }
    await batch.commit();
    return;
  }
  if (!publish) {
    await setDoc(doc(db, "users", uid), clean, { merge: true });
    return;
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "users", uid), clean, { merge: true });
  batch.set(doc(db, "participants_public", uid),
    publicProjection(clean.displayName, clean.affiliation));
  await batch.commit();
}

/**
 * Put someone on the public participant list.
 *
 * Idempotent, and called on every account-page load once the email is verified,
 * so a registration that was interrupted between the two writes heals itself
 * the next time the person opens the page.
 */
export const publishParticipant = (uid, { displayName, affiliation }) =>
  setDoc(doc(db, "participants_public", uid), publicProjection(displayName, affiliation));

// publicDb, not db: this is `allow read: if true` in firestore.rules and has
// no admin writer to reconcile with — see the comment on publicDb in
// firebase.js for why that split matters here.
export async function listPublicParticipants() {
  const q = query(collection(publicDb, "participants_public"), where("edition", "==", CURRENT_EDITION));
  const snap = await getDocs(q);
  return snap.docs.map(snapData);
}

// publicDb: `allow read: if true` in firestore.rules — see the comment on
// publicDb in firebase.js. Writes still go through saveSiteConfig() on db.
export async function getSiteConfig() {
  const snap = await getDoc(doc(publicDb, "config", "site"));
  return snap.exists() ? snap.data() : null;
}

// ---------------------------------------------------------------- abstracts

/**
 * One abstract per participant, keyed on their uid — so this is a direct get,
 * not a query. That is deliberate: firestore.rules grants `list` on abstracts to
 * organizers only, and a get needs no index, no edition filter, and no way to
 * see anybody else's submission.
 *
 * Returns null when they have not submitted, and also when the abstract belongs
 * to a previous edition: next year is a one-line change to CURRENT_EDITION, and
 * the old submission must not reappear in this year's form.
 */
export async function getMyAbstract(uid) {
  const snap = await getDoc(doc(db, "abstracts", uid));
  if (!snap.exists()) return null;
  const abstract = snapData(snap);
  return abstract.edition === CURRENT_EDITION ? abstract : null;
}

/**
 * Create or replace one abstract.
 *
 * setDoc without merge is deliberate: the rules validate the whole document on
 * every write, so a full replace is simpler than reasoning about partial
 * updates. Resubmitting after a rejection resets status to "submitted", which
 * the rules permit for any status except "accepted".
 *
 * `ownerUid` is the SUBMITTER, never necessarily the person saving: an organizer
 * fixing a typo in somebody else's abstract must not take it over. `status`
 * likewise has to be carried through, or that same fix would quietly un-accept
 * an accepted abstract.
 *
 * `republish` carries the public projection's type and poster number when an
 * already-accepted abstract is edited — by an organizer, or by its owner while
 * the editing window is open — so both copies are rewritten in one batch.
 * Without it abstracts_public would keep serving the old text. Its `editClosed`
 * decides what an unconfirmed publish setting becomes (see publicMode()).
 */
export async function saveAbstract(
  id,
  ownerUid,
  {
    title, affiliations, authors, body, topic, talkConsidered,
    figureUrl, figurePath, figureCaption, publishChoice, publishConfirmed,
  },
  { status = "submitted", createdAt = null, republish = null } = {},
) {
  const record = {
    ownerUid,
    edition: CURRENT_EDITION,
    title: title.trim(),
    affiliations,
    authors,
    body: body.trim(),
    topic,
    talkConsidered: Boolean(talkConsidered),
    figureUrl: figureUrl ?? null,
    figurePath: figurePath ?? null,
    figureCaption: (figureCaption ?? "").trim(),
    publishChoice: publishChoice === "titleOnly" ? "titleOnly" : "full",
    publishConfirmed: Boolean(publishConfirmed),
    status,
    // Preserved rather than reset: revising a rejected abstract in November did
    // not make it a submission from November.
    createdAt: createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (!republish) {
    await setDoc(doc(db, "abstracts", id), record);
    return;
  }

  const batch = writeBatch(db);
  batch.set(doc(db, "abstracts", id), record);
  batch.set(doc(db, "abstracts_public", id),
    publicAbstract(record, {
      type: republish.type,
      posterNumber: republish.posterNumber,
      acceptedAt: republish.acceptedAt,
      editClosed: republish.editClosed,
    }));
  await batch.commit();
}

/**
 * The public projection of an abstract. One builder, used by both routes that
 * write abstracts_public, so an organizer's edit and an acceptance cannot
 * disagree about what the public list holds.
 *
 * What the public may read comes from publicFields(), under the author's
 * publish setting: never the figure, and the text only when they chose (or
 * defaulted to) the full abstract. `status`, `ownerUid` and `talkConsidered`
 * are review material, not programme material.
 *
 * firestore.rules publicMatches() checks an owner's write against this same
 * shape, so a key added here has to be added there too.
 */
const publicAbstract = (abstract, { type, posterNumber, acceptedAt = null, editClosed = false }) => ({
  ...publicFields(abstract, publicMode(abstract, { editClosed })),
  type,
  posterNumber: type === "poster" ? posterNumber : null,
  edition: CURRENT_EDITION,
  acceptedAt: acceptedAt ?? serverTimestamp(),
});

/**
 * A participant retracting their own abstract. One batch, because an accepted
 * poster has a public copy too, and firestore.rules lets the owner remove the
 * private document only in the same write that removes the public one — a
 * retracted poster must not linger on the public list.
 */
export async function retractAbstract(id, { published = false } = {}) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "abstracts", id));
  if (published) batch.delete(doc(db, "abstracts_public", id));
  await batch.commit();
}

export async function listAbstracts() {
  const q = query(collection(db, "abstracts"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

/**
 * One published abstract, for a shared link.
 *
 * A direct get rather than a filter over listPublicAbstracts(): a link that
 * lands on one abstract should cost one read, not the whole collection. Returns
 * null both when the id is unknown and when it belongs to another edition, so a
 * link shared last year does not surface the wrong meeting's poster.
 */
// publicDb below: `allow read: if true` in firestore.rules — see the comment
// on publicDb in firebase.js. Writes still go through db (saveAbstract,
// publishAbstract, returnToReview).
export async function getPublicAbstract(id) {
  const snap = await getDoc(doc(publicDb, "abstracts_public", id));
  if (!snap.exists()) return null;
  const abstract = snapData(snap);
  return abstract.edition === CURRENT_EDITION ? abstract : null;
}

export async function listPublicAbstracts() {
  const q = query(collection(publicDb, "abstracts_public"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

/**
 * Every review on every abstract, in one read.
 *
 * The console shows the whole committee's scores on every card and exports them
 * as a matrix, so fetching them per abstract would be one round trip per card
 * for data that is always wanted together. Admin-only, per the rules.
 */
export async function listReviews() {
  const snap = await getDocs(collection(db, "abstract_reviews"));
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

/**
 * Save one organizer's score and note.
 *
 * A merge into a nested map, NOT a whole-document set: each organizer owns one
 * slot of `reviews`, and two of them reviewing the same abstract at the same
 * time must not overwrite each other. A full set would make the last save win
 * and silently discard the other's opinion.
 */
export const saveMyReview = (abstractId, reviewerUid, { score, note }) =>
  setDoc(doc(db, "abstract_reviews", abstractId), {
    reviews: {
      [reviewerUid]: {
        // null rather than absent, so clearing a score is a real edit the merge
        // will carry through instead of leaving the old one in place.
        score: Number.isInteger(score) ? score : null,
        note: String(note ?? ""),
        at: serverTimestamp(),
      },
    },
  }, { merge: true });

/**
 * Wipe every organizer's comment on every abstract, keeping their scores.
 *
 * Read fresh rather than from the console's last render, so a comment saved by
 * another organizer a minute ago is not left behind. A field-path update per
 * note, not a set: the score, `at`, and the decision fields beside each note
 * must come through untouched. The legacy shared `note` goes too — it is a
 * review comment like the others, just one nobody can attribute.
 *
 * Batches hold 500 writes; each abstract is one write however many notes it
 * carries.
 */
export async function clearAllReviewNotes() {
  const snap = await getDocs(collection(db, "abstract_reviews"));
  const updates = [];
  let notes = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const pairs = [];
    for (const [uid, review] of Object.entries(data.reviews ?? {})) {
      if (String(review?.note ?? "").trim()) {
        pairs.push(new FieldPath("reviews", uid, "note"), "");
        notes += 1;
      }
    }
    if (typeof data.note === "string") {
      pairs.push(new FieldPath("note"), deleteField());
      if (data.note.trim()) notes += 1;
    }
    if (pairs.length) updates.push([d.ref, pairs]);
  }
  for (let i = 0; i < updates.length; i += 500) {
    const batch = writeBatch(db);
    for (const [ref, [field, value, ...more]] of updates.slice(i, i + 500)) {
      batch.update(ref, field, value, ...more);
    }
    await batch.commit();
  }
  return { notes, abstracts: updates.length };
}

/**
 * Confirm a participant's publish setting without opening the editor — the
 * "Publish title and authors only" shortcut on their submission card.
 *
 * Only the two setting fields change, so the status is left exactly as it is,
 * which is what the owner update rule asks of a write outside the submission
 * window. An accepted abstract's public copy is rewritten in the same batch,
 * from `published`'s type, board number and acceptance date, because the rules
 * refuse to let the two copies disagree.
 */
export async function confirmPublishSetting(
  abstract, choice, { published = null, editClosed = false } = {},
) {
  const setting = { publishChoice: choice, publishConfirmed: true };
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", abstract.id), { ...setting, updatedAt: serverTimestamp() });
  if (published) {
    batch.set(doc(db, "abstracts_public", abstract.id),
      publicAbstract({ ...abstract, ...setting }, {
        type: published.type,
        posterNumber: published.posterNumber ?? null,
        acceptedAt: published.acceptedAt ?? null,
        editClosed,
      }));
  }
  await batch.commit();
}

/** Record who accepted or rejected an abstract, without touching anyone's review. */
export const recordDecision = (abstractId, decidedBy) =>
  setDoc(doc(db, "abstract_reviews", abstractId), {
    decidedBy,
    decidedAt: serverTimestamp(),
  }, { merge: true });

export const setAbstractStatus = (id, status) =>
  updateDoc(doc(db, "abstracts", id), { status, updatedAt: serverTimestamp() });

/**
 * Accept: flip the private status and write the public projection together.
 *
 * `type` is the organizers' decision, not the submitter's — everything is
 * submitted as a poster and the committee promotes some of them to talks.
 *
 * `acceptedAt` is carried by the caller when this is a re-publish rather than a
 * first acceptance. Without it the timestamp restamped itself every time an
 * organizer changed a board number, and "when was this accepted" became "when
 * did somebody last touch it".
 */
export async function publishAbstract(
  id, abstract, { type, posterNumber, acceptedAt = null, editClosed = false },
) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", id), { status: "accepted", updatedAt: serverTimestamp() });
  batch.set(doc(db, "abstracts_public", id),
    publicAbstract(abstract, { type, posterNumber, acceptedAt, editClosed }));
  await batch.commit();
}

/**
 * Rewrite every public copy from its private abstract, keeping each one's type,
 * board number and acceptance date. Returns how many it rewrote.
 *
 * Two jobs. Once the editing window has closed (`editClosed`), it publishes the
 * default — the full abstract — for everybody who never confirmed a publish
 * setting, which nothing else would do on its own. And it migrates copies
 * written before figures were taken off the public list.
 *
 * A public copy whose private abstract is gone or no longer accepted is left
 * alone: deciding what to do with it is a console decision, not a sweep's.
 */
export async function republishAll(editClosed) {
  const [abstracts, published] = await Promise.all([listAbstracts(), listPublicAbstracts()]);
  const byId = new Map(abstracts.map((a) => [a.id, a]));
  const batch = writeBatch(db);
  let count = 0;
  for (const pub of published) {
    const abstract = byId.get(pub.id);
    if (abstract?.status !== "accepted") continue;
    batch.set(doc(db, "abstracts_public", pub.id), publicAbstract(abstract, {
      type: pub.type,
      posterNumber: pub.posterNumber ?? null,
      acceptedAt: pub.acceptedAt ?? null,
      editClosed,
    }));
    count += 1;
  }
  if (count) await batch.commit();
  return count;
}

/**
 * Un-accept: take the abstract off the public list and put it back in review.
 *
 * This used to write a `withdrawn` status, which existed only to be the result
 * of this one button. Undoing an acceptance leaves the abstract exactly where it
 * was before the acceptance — waiting on the committee — so that is what it now
 * says, and the vocabulary is three states instead of four.
 */
export async function returnToReview(id) {
  const batch = writeBatch(db);
  batch.update(doc(db, "abstracts", id), { status: "submitted", updatedAt: serverTimestamp() });
  batch.delete(doc(db, "abstracts_public", id));
  await batch.commit();
}

export async function listUsers() {
  const q = query(collection(db, "users"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

// ------------------------------------------------------------------ contact

/**
 * A message from the contact page, on its way to every organizer's inbox.
 *
 * A plain Firestore write rather than a callable, deliberately. The mail is
 * sent by the mailContactMessage trigger in functions/, and a callable would
 * make the whole page inert whenever that function is not deployed — whereas
 * this records the message the moment the rules ship, and mail is the layer on
 * top. It is also the reason nothing here reports "sent": the write is the
 * promise this side of the site can actually keep.
 *
 * Not edition-scoped. "When does registration open for next year?" is a
 * question about the site, not about pints2026, and the created timestamp is
 * the only ordering an inbox needs.
 *
 * `authorUid` is recorded only when somebody is signed in, and firestore.rules
 * pins it to their own uid — it tells an organizer that the sender is a
 * registered participant rather than a stranger, which changes how a "I never
 * got my confirmation email" message is read.
 */
export const sendContactMessage = ({ name, email, topic, message, authorUid = null }) =>
  addDoc(collection(db, "contact_messages"), {
    name: name.trim(),
    email: email.trim(),
    topic,
    message: message.trim(),
    // Omitted rather than null when signed out: the rules allow the field only
    // when it equals request.auth.uid, and null is not that.
    ...(authorUid ? { authorUid } : {}),
    createdAt: serverTimestamp(),
  });

// -------------------------------------------------------------------- pages

/**
 * Editable page copy. Not edition-scoped: the venue and about text carry from
 * one year to the next, and an organizer who edits a page means to edit the
 * page, not this year's copy of it.
 */
// publicDb: `allow read: if true` in firestore.rules — see the comment on
// publicDb in firebase.js. Writes still go through savePage() on db.
export async function getPage(slug) {
  const snap = await getDoc(doc(publicDb, "pages", slug));
  return snap.exists() ? snap.data() : null;
}

export const savePage = (slug, markdown, adminUid) =>
  setDoc(doc(db, "pages", slug), {
    markdown,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

// ----------------------------------------------------------------- schedule

// publicDb: `allow read: if true` in firestore.rules — see the comment on
// publicDb in firebase.js. Writes still go through db (saveScheduleItem,
// deleteScheduleItem).
export async function listSchedule() {
  const q = query(collection(publicDb, "schedule"), where("edition", "==", CURRENT_EDITION));
  return (await getDocs(q)).docs.map(snapData);
}

/** `id` null creates; otherwise replaces. Resolves to the document id. */
export async function saveScheduleItem(id, data) {
  const payload = { ...data, edition: CURRENT_EDITION };
  const ref = doc(db, "schedule", id ?? doc(collection(db, "schedule")).id);
  await setDoc(ref, payload);
  return ref.id;
}

export const deleteScheduleItem = (id) => deleteDoc(doc(db, "schedule", id));

// -------------------------------------------------- late-registration links

/**
 * Make a single-use link for somebody who missed the registration deadline.
 * The document id is the token, so it is drawn from crypto, not addDoc().
 */
export async function createRegistrationLink(adminUid, hours) {
  const token = newLinkToken(crypto.getRandomValues(new Uint8Array(16)));
  await setDoc(doc(db, "registration_links", token), {
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + hours * 3600_000),
  });
  return token;
}

// publicDb: register.html reads this signed out, and it is `allow get: if true`.
export async function getRegistrationLink(token) {
  const snap = await getDoc(doc(publicDb, "registration_links", token));
  return snap.exists() ? snapData(snap) : null;
}

export async function listRegistrationLinks() {
  return (await getDocs(collection(db, "registration_links"))).docs.map(snapData);
}

/** Revoke a link. Deleting it is all revoking takes. */
export const deleteRegistrationLink = (token) =>
  deleteDoc(doc(db, "registration_links", token));

// ----------------------------------------------------------------- settings

/**
 * Partial update of config/site. Undefined keys are stripped, because the
 * settings tab saves the meeting date and the submission window independently
 * and Firestore rejects an undefined field value outright.
 */
export function saveSiteConfig(patch) {
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined));
  return setDoc(doc(db, "config", "site"),
    { ...clean, edition: CURRENT_EDITION }, { merge: true });
}

/**
 * The photographs behind the home page hero.
 *
 * Its own document rather than a field on config/site, so the landing page can
 * fetch it without also pulling the submission window, and so a malformed hero
 * write can never take the deadline down with it.
 *
 * Returns null when nobody has set any: js/hero-slider.js treats that as "leave
 * the hero exactly as it is", which is the correct behaviour and also what
 * every visitor sees before an organizer uploads anything.
 */
// publicDb: `allow read: if true` in firestore.rules — see the comment on
// publicDb in firebase.js. Writes still go through saveHeroPhotos() on db.
export async function getHeroPhotos() {
  const snap = await getDoc(doc(publicDb, "config", "hero"));
  return snap.exists() ? snap.data() : null;
}

/**
 * Replace the hero list wholesale.
 *
 * Not a merge, unlike saveSiteConfig: `photos` is an array, and Firestore
 * replaces a merged array wholesale anyway, so a merge would only add the
 * chance of a stale key surviving a save. The caller passes the full list it
 * just edited.
 */
export const saveHeroPhotos = (photos, adminUid) =>
  setDoc(doc(db, "config", "hero"), {
    photos,
    updatedAt: serverTimestamp(),
    updatedBy: adminUid,
  });

export const addAdmin = (uid, email, addedBy) =>
  setDoc(doc(db, "admins", uid), { email, addedBy, addedAt: serverTimestamp() });

/**
 * The uids of every organizer. Admin-only, per the rules.
 *
 * The participants tab needs it to refuse to offer a delete button for an
 * organizer. deleteParticipant refuses server-side too — this is so the console
 * does not present an action that is going to be rejected.
 */
export async function listAdminUids() {
  const snap = await getDocs(collection(db, "admins"));
  return new Set(snap.docs.map((d) => d.id));
}

/** Every organizer, with the email recorded when they were added. Admin-only. */
export async function listAdmins() {
  const snap = await getDocs(collection(db, "admins"));
  return snap.docs.map(snapData);
}

// ------------------------------------------------------------------ gallery

/**
 * Photographs of previous editions, one document per edition.
 *
 * Not edition-scoped in the CURRENT_EDITION sense: the whole point is the years
 * that are not this one. The `year` field carries which is which.
 */
// publicDb below: `allow read: if true` in firestore.rules — see the comment
// on publicDb in firebase.js. Writes still go through db (saveGalleryPhotos,
// deleteGalleryYear).
export async function listGallery() {
  const snap = await getDocs(collection(publicDb, "gallery"));
  return snap.docs.map(snapData);
}

export async function getGalleryYear(year) {
  const snap = await getDoc(doc(publicDb, "gallery", String(year)));
  return snap.exists() ? snapData(snap) : null;
}

/**
 * Save the captions an organizer typed, leaving everything the sync wrote alone.
 *
 * A merge would not do: `photos` is an array, and a merged array is replaced
 * wholesale anyway, so the caller passes the full list it just edited.
 */
export const saveGalleryPhotos = (year, folderUrl, photos, adminUid) =>
  setDoc(doc(db, "gallery", String(year)), {
    year: Number(year),
    folderUrl: folderUrl ?? "",
    photos,
    syncedAt: serverTimestamp(),
    syncedBy: adminUid,
  });

export const deleteGalleryYear = (year) => deleteDoc(doc(db, "gallery", String(year)));

// Work the browser cannot do: admin-only destructive operations, the
// participant backfill, and the contact-form mailer.
//
// Everything else on this site is a static page talking straight to Firestore,
// with firestore.rules as the only authorization boundary. Deletion cannot work
// that way, for two reasons:
//
//  1. A Firebase Auth account can only be deleted by its owner from a browser.
//     Removing somebody else's login needs the Admin SDK.
//  2. storage.rules keys figure deletion to the uploader's uid and cannot read
//     Firestore, so there is no isAdmin() to appeal to. Rather than bake a list
//     of admin uids into the rules, figure deletion happens here, where the
//     Admin SDK ignores rules entirely.
//
// The participant backfill is here for the same reason: it writes on behalf of
// somebody who is signed in nowhere, which only the Admin SDK can do.
//
// The test for whether something belongs in this file is narrow — does it need
// to bypass the rules, or hold a secret the browser must not? Ordinary reads and
// writes belong in firestore.rules, or the site stops being a static site.
//
// mailContactMessage is here on the second justification: SMTP credentials.
// A static page cannot hold a password that sends mail as the organizers.
//
// NOT here, for now: syncDropboxGallery, the archive photo sync. It is the one
// function that needs the second justification — a Dropbox token — and it
// cannot deploy until DROPBOX_APP_KEY, DROPBOX_APP_SECRET and
// DROPBOX_REFRESH_TOKEN exist in Secret Manager. An undeployable function fails
// the whole `firebase deploy --only functions`, so it was taken out to let the
// rest ship. Restore it with `git revert` of the commit that removed it, once
// the secrets are set; the browser half is untouched and still waiting for it.
//
// THE SAME TRAP APPLIES TO mailContactMessage. It binds CONTACT_SMTP_USER and
// CONTACT_SMTP_PASSWORD, so deploying this file before those two secrets exist
// fails the whole deploy and takes the deletes and the backfill down with it.
// Set them first — see "Contacting the organizers" in the README. The contact
// page itself does not care: it writes to Firestore, which works whether or not
// anything here is deployed, and only the mail waits on this.
//
// Because the Admin SDK ignores rules, EVERY function below must check the
// caller itself. A callable's request.auth is set by the platform from a
// verified ID token and is trustworthy; nothing the client says about itself is.

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import nodemailer from "nodemailer";

initializeApp();

const db = getFirestore();

// Paris, not the us-central1 default: participant names and email addresses
// should not round-trip to Iowa.
const REGION = "europe-west1";

/** Throw unless the caller is signed in and listed in admins/. */
async function requireAdmin(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "Organizers only.");
  return uid;
}

/** Delete a Storage object, treating "already gone" as success. */
async function deleteObject(path) {
  if (!path) return;
  try {
    await getStorage().bucket().file(path).delete();
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}

/**
 * Remove one abstract and everything that points at it.
 *
 * Shared by both callables, so deleting a participant and deleting a single
 * abstract cannot drift apart in what they clean up.
 */
async function purgeAbstract(abstractId) {
  const snap = await db.doc(`abstracts/${abstractId}`).get();
  const data = snap.data();

  const batch = db.batch();
  batch.delete(db.doc(`abstracts/${abstractId}`));
  batch.delete(db.doc(`abstracts_public/${abstractId}`));
  batch.delete(db.doc(`abstract_reviews/${abstractId}`));
  await batch.commit();

  // After the documents, so a Storage failure cannot leave an abstract pointing
  // at a figure that no longer exists. An orphaned object is invisible and
  // costs pennies; a broken image on the public list is not.
  await deleteObject(data?.figurePath);
  return Boolean(snap.exists);
}

export const deleteAbstractCompletely = onCall({ region: REGION }, async (request) => {
  const adminUid = await requireAdmin(request);
  const abstractId = String(request.data?.abstractId ?? "");
  if (!abstractId) throw new HttpsError("invalid-argument", "abstractId is required.");

  const existed = await purgeAbstract(abstractId);
  logger.info("abstract deleted", { abstractId, by: adminUid, existed });
  return { deleted: existed };
});

export const deleteParticipant = onCall({ region: REGION }, async (request) => {
  const adminUid = await requireAdmin(request);
  const uid = String(request.data?.uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");

  // An organizer deleting their own account mid-session leaves the console in
  // an undefined state, and is almost always a mis-click.
  if (uid === adminUid) {
    throw new HttpsError("failed-precondition",
      "You cannot delete your own account from the admin console.");
  }

  // One mis-click must not be able to decapitate the organizing committee.
  if ((await db.doc(`admins/${uid}`).get()).exists) {
    throw new HttpsError("failed-precondition",
      "That participant is an organizer. Revoke their admin rights in Settings first.");
  }

  const owned = await db.collection("abstracts").where("ownerUid", "==", uid).get();
  for (const abstract of owned.docs) await purgeAbstract(abstract.id);

  const batch = db.batch();
  batch.delete(db.doc(`users/${uid}`));
  batch.delete(db.doc(`participants_public/${uid}`));
  await batch.commit();

  // Auth last. If this run dies part-way the account still exists, so the
  // participant is still listed in the console and the whole thing can simply
  // be retried. Deleting the login first would leave invisible orphaned data.
  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }

  logger.info("participant deleted", { uid, by: adminUid, abstracts: owned.size });
  return { deleted: true, abstracts: owned.size };
});

// -------------------------------------------------- hand-confirming an email

/**
 * Which registered uids Firebase Auth has not marked email-confirmed.
 *
 * `users/{uid}` — what the Participants tab otherwise reads — has no verified
 * flag; `email_verified` lives only on the Auth account, and listing Auth
 * accounts in bulk needs the Admin SDK. Without this, the tab could not tell
 * "Confirm email" apart from a button that does nothing, so it would have to
 * offer that button on every row instead of only where it acts on something.
 */
export const listUnverifiedParticipants = onCall({ region: REGION }, async (request) => {
  await requireAdmin(request);
  const unverified = [];
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const user of page.users) if (!user.emailVerified) unverified.push(user.uid);
    pageToken = page.pageToken;
  } while (pageToken);
  return { uids: unverified };
});

/**
 * Mark a participant's email confirmed without them ever clicking the link.
 *
 * The one case "send it again" cannot fix: mail a gateway drops outright rather
 * than quarantines. Measured 2026-08-19 against a @cnrs.fr address (see
 * submit.html's verify-gate) — resending changes nothing when nothing arrives
 * in the first place, so the panel points stuck participants at the
 * organizers instead. This is what answers that: Firebase Auth only lets an
 * account confirm itself from a client, so an organizer confirming somebody
 * else's address needs the Admin SDK, same as the deletes above.
 */
export const verifyParticipantEmail = onCall({ region: REGION }, async (request) => {
  const adminUid = await requireAdmin(request);
  const uid = String(request.data?.uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");

  const user = await getAuth().updateUser(uid, { emailVerified: true });

  // Publish immediately rather than leaving them for the next backfillParticipants
  // sweep: an organizer who just fixed this by hand is the wrong moment to make
  // that person wait up to five more minutes to appear on the public list.
  const edition = (await db.doc("config/site").get()).data()?.edition;
  const profile = (await db.doc(`users/${uid}`).get()).data();
  let published = false;
  if (edition && profile?.displayName && profile.edition === edition) {
    try {
      // create(), not set(): see backfillParticipants below for why an
      // organizer's correction to the name must never be clobbered.
      await db.doc(`participants_public/${uid}`).create({
        displayName: profile.displayName,
        affiliation: profile.affiliation ?? "",
        edition,
        updatedAt: FieldValue.serverTimestamp(),
      });
      published = true;
    } catch (err) {
      if (err?.code !== 6) throw err; // ALREADY_EXISTS: already published.
    }
  }

  logger.info("email confirmed by organizer", { uid, by: adminUid, published });
  return { email: user.email };
});

// ------------------------------------------------------ the listing backfill

/**
 * Put verified participants on the public list even if they never load a page.
 *
 * account.html publishes the moment a fresh token says the address is confirmed,
 * and for most people that is instant — the verification link lands there. Two
 * routes miss it entirely:
 *
 *  - opening the link on a phone, or any device where they are not signed in.
 *    The page redirects to sign-in and the write never happens, so their name
 *    appears only after they next log in somewhere.
 *  - submitting an abstract without registering. Those people are sent a
 *    "set your password" mail rather than a verification one, so they never
 *    pass through account.html at all — and completing a password reset is
 *    exactly what marks their address verified.
 *
 * Neither can be fixed in the browser: participants_public may be written only
 * by its owner or an organizer, and the person in question is signed in
 * nowhere. The Admin SDK ignores rules, which is what makes this function the
 * place for it — the same admission test as the deletes above.
 *
 * Every five minutes rather than every minute. The client-side path already
 * covers the common case immediately, so this is a safety net, and a net that
 * sweeps the whole participant list twelve times an hour is a bill for nothing.
 */
export const backfillParticipants = onSchedule(
  { region: REGION, schedule: "every 5 minutes" },
  async () => {
    // The edition is read, not hardcoded: js/config.mjs is the single source of
    // truth for it and this package cannot import from the site. The settings
    // tab writes it here on every save.
    const edition = (await db.doc("config/site").get()).data()?.edition;
    if (!edition) {
      logger.error("config/site has no edition; refusing to guess", {});
      return;
    }

    // One pass over who is already listed, so the common case — nobody new —
    // costs one query and no writes.
    const listed = new Set((await db.collection("participants_public").get()).docs
      .map((doc) => doc.id));

    let published = 0;
    let scanned = 0;
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      scanned += page.users.length;
      for (const user of page.users) {
        if (!user.emailVerified || listed.has(user.uid)) continue;

        const profile = (await db.doc(`users/${user.uid}`).get()).data();
        // No profile means they have an account but never gave a name, and a
        // different edition means they registered for a previous year — neither
        // belongs on this year's list.
        if (!profile?.displayName || profile.edition !== edition) continue;

        try {
          // create(), not set(): it fails if the document is already there, so
          // "never overwrite" is enforced by the database rather than by the
          // freshness of the set read above. An organizer may have corrected
          // this person's name, and a race with the client's own publish is
          // entirely possible.
          await db.doc(`participants_public/${user.uid}`).create({
            displayName: profile.displayName,
            affiliation: profile.affiliation ?? "",
            edition,
            updatedAt: FieldValue.serverTimestamp(),
          });
          published += 1;
        } catch (err) {
          // 6 is ALREADY_EXISTS: somebody else won the race, which is the
          // outcome we wanted anyway.
          if (err?.code !== 6) throw err;
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);

    // Debug on every sweep, info only when it did something. A periodic job that
    // is silent while idle is indistinguishable from one that has stopped
    // firing, and "is the backfill alive?" has to be answerable without adding
    // a test participant to see whether they appear.
    logger.debug("participant sweep", { listed: listed.size, scanned, published });
    if (published) logger.info("participants backfilled", { published });
  },
);

// -------------------------------------------------------- the contact mailer

const SMTP_USER = defineSecret("CONTACT_SMTP_USER");
const SMTP_PASSWORD = defineSecret("CONTACT_SMTP_PASSWORD");

// Copied from CONTACT_TOPIC_LABELS in js/config.mjs. functions/ is a separate
// npm package and cannot import from the site — the same reason
// backfillParticipants reads the edition out of config/site rather than
// importing CURRENT_EDITION. An id with no entry here still sends; it just
// appears in the subject line as itself.
const TOPIC_LABELS = {
  registration: "Registration",
  abstracts: "Abstract submission",
  program: "Program and schedule",
  venue: "Venue and travel",
  website: "A problem with the website",
  other: "Something else",
};

// The most messages that may be MAILED in one hour, across all senders.
//
// contact_messages is the one collection an anonymous visitor may write, so a
// script holding the public API key can fill it as fast as Firestore accepts
// writes. firestore.rules bounds how big one message can be and can do nothing
// about how many arrive — rules cannot count documents. This is that half:
// past the cap the documents still land and are still readable, but the
// organizers' inboxes stop. Twenty an hour is far above any real day for a
// meeting this size and far below what makes an inbox unusable.
const MAX_MAILED_PER_HOUR = 20;

// Where every contact-form message goes: the conference's shared inbox, so
// what one organizer answers the others can see, and granting someone admin
// rights no longer decides who is mailed.
const CONTACT_RECIPIENT = "pints.conference@gmail.com";

/** Plain text, because this is a message to read and reply to, not a page. */
function messageBody(data, id) {
  const topic = TOPIC_LABELS[data.topic] ?? data.topic;
  return [
    `From:    ${data.name} <${data.email}>`,
    `About:   ${topic}`,
    data.authorUid
      ? `Account: registered participant (uid ${data.authorUid})`
      : "Account: not signed in when they wrote this",
    "",
    data.message,
    "",
    "--",
    "Sent from the contact form at https://pints.fr/contact.html",
    `Reply to this mail and it goes to ${data.email}, not to the website.`,
    `Message id: ${id}`,
  ].join("\n");
}

/**
 * Mail a contact-form message to the conference inbox, CONTACT_RECIPIENT.
 *
 * A Firestore trigger rather than a callable, and that is the whole design.
 * contact.html writes to contact_messages the way every other page on this site
 * writes to Firestore, so the page works — validates, stores, confirms — with
 * nothing in this file deployed at all. Mail is the layer on top. A callable
 * would have made an undeployed function into a contact page that does nothing.
 *
 * It follows that a failure here must never be silent: the visitor has already
 * been told their message is on its way. So the outcome is stamped back onto
 * the document, and `deliveredAt` missing on a message is the signal that
 * somebody has to be answered by hand.
 */
export const mailContactMessage = onDocumentCreated(
  {
    region: REGION,
    document: "contact_messages/{id}",
    secrets: [SMTP_USER, SMTP_PASSWORD],
    // One attempt. A retry storm on a transient SMTP failure would mail the
    // same message repeatedly, and the stored document plus the missing
    // deliveredAt is a better safety net than an automatic redelivery nobody
    // can see.
    retry: false,
  },
  async (event) => {
    const id = event.params.id;
    const data = event.data?.data();
    if (!data?.email) {
      logger.error("contact message has no sender address", { id });
      return;
    }

    const ref = db.doc(`contact_messages/${id}`);
    const stamp = (fields) => ref.set(fields, { merge: true });

    // Counted over the whole hour rather than per sender: an address on a
    // contact form is unverified, so per-sender limiting is one edit to evade.
    const hourAgo = new Date(Date.now() - 3600_000);
    const recent = await db.collection("contact_messages")
      .where("createdAt", ">", hourAgo)
      .count().get();
    if (recent.data().count > MAX_MAILED_PER_HOUR) {
      logger.warn("contact mail rate limit hit; storing without sending", {
        id, lastHour: recent.data().count, cap: MAX_MAILED_PER_HOUR,
      });
      await stamp({ deliveryError: "rate limit" });
      return;
    }

    const to = [CONTACT_RECIPIENT];

    // Gmail, and the From below stays a @gmail.com address ON PURPOSE.
    //
    // pints.fr now publishes an SPF record and DKIM keys for Firebase's mail
    // servers, so that verification mail is signed as pints.fr — see the README.
    // NONE OF THAT APPLIES HERE. This transport is Gmail, which can only sign as
    // gmail.com. Changing `from` to something @pints.fr would send mail claiming
    // a domain whose SPF record does not list Gmail and whose DKIM keys Gmail
    // does not hold: it would fail DMARC outright and land in exactly the spam
    // folder the pints.fr work exists to escape. Moving this to @pints.fr means
    // moving off Gmail first.
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASSWORD.value() },
    });

    try {
      await transport.sendMail({
        from: { name: "PINTS website", address: SMTP_USER.value() },
        to,
        // The point of the whole feature: hitting reply answers the visitor
        // rather than the mailbox the site sends from. `from` cannot be their
        // address — mail claiming to be from a domain Google may not sign fails
        // DMARC, which is the very problem this account exists to avoid.
        //
        // An object, not `"Name <addr>"`. A visitor who writes their name as
        // "Dupont, Alice" turns that string into two addresses as far as a mail
        // parser is concerned, and the reply goes nowhere. nodemailer quotes a
        // name it is handed separately.
        replyTo: { name: data.name, address: data.email },
        subject: `[PINTS contact] ${TOPIC_LABELS[data.topic] ?? data.topic} — ${data.name}`,
        text: messageBody(data, id),
      });
    } catch (err) {
      logger.error("contact mail failed", { id, message: err?.message });
      await stamp({ deliveryError: String(err?.message ?? err).slice(0, 500) });
      return;
    }

    logger.info("contact message mailed", { id, to });
    await stamp({ deliveredAt: FieldValue.serverTimestamp() });
  },
);

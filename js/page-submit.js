import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { checkIsAdmin, refreshVerification, requireUser, sendVerification } from "./auth.js";
import { getMyAbstract, getProfile, getPublicAbstract, getSiteConfig } from "./db.js";
import { ownerCan, submissionWindows } from "./abstract-utils.mjs";
import { mountAbstractForm } from "./abstract-form.js";
import { mountSubmissionCard } from "./submission-view.js";

/**
 * Submitting an abstract: register first, then submit.
 *
 * Two gates, in order, and both are real rather than decorative. requireUser()
 * bounces a signed-out visitor to login.html carrying `?next=submit.html`, so
 * they come back here instead of landing on a generic account page with no clue
 * what they came for. Then the address has to be confirmed, because
 * firestore.rules requires `email_verified` on an abstract write — showing the
 * form to somebody who would only collect a PERMISSION_DENIED at the end of it
 * would waste the one thing they came to do.
 *
 * The token is refreshed before that second check: clicking the verification
 * link does NOT update the token a tab already holds, and a stale token is what
 * used to make a first submission fail and then "fix itself" an hour later.
 */
mountLayout();

const msg = document.getElementById("msg");
const host = document.getElementById("form-host");
const submittedEl = document.getElementById("submitted");
const intro = document.getElementById("intro");
const gate = document.getElementById("verify-gate");

const say = (text, kind = "ok") => {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
};

// Everything mount() learned, so the card and the editor can be swapped without
// re-reading the profile each time. `windows` is submissionWindows() of the
// site config, which decides what the card offers.
const state = { user: null, isAdmin: false, profile: null, windows: null };

if (!warnIfUnconfigured(msg)) {
  const user = await requireUser();
  const isAdmin = await checkIsAdmin(user.uid);
  setAuthLink({ signedIn: true, isAdmin });

  try {
    await mount(user, isAdmin);
  } catch (err) {
    say("Could not open the submission form. Please reload the page.", "err");
    console.error("[pints] submit", err);
  }
}

async function mount(user, isAdmin) {
  const [profile, mine, config] = await Promise.all([
    getProfile(user.uid), getMyAbstract(user.uid), getSiteConfig(),
  ]);

  state.user = user;
  state.isAdmin = isAdmin;
  state.profile = profile;
  state.windows = submissionWindows(config);

  // Clicking the verification link does not update the token this tab already
  // holds, so ask for a fresh one before deciding anything on it.
  if (!await refreshVerification(user)) showVerifyGate(user);

  // An abstract already on file is a thing to read, not a form to fill. The
  // editor is one button away, which is the right ratio: most visits after the
  // first are to check what was sent, not to change it. Shown whatever the
  // address's state — reading is never gated, and the form behind that button
  // is where abstract-form says what is closed and why.
  //
  // ?edit=1 skips straight to the editor instead: it is how the "Edit
  // submission" button on abstracts.html's card arrives here, and landing on
  // the same card a second time would just be an extra click to the thing the
  // visitor already asked for. Still falls back to the card for a frozen or
  // unverified abstract, where showForm would have nothing to offer anyway.
  if (mine) {
    const published = await publicCopyOf(mine);
    const wantsEdit = new URLSearchParams(location.search).get("edit") === "1";
    if (wantsEdit && ownerCan(mine, published, state.windows).edit && user.emailVerified) {
      return showForm(mine, published);
    }
    return showSubmitted(mine);
  }

  if (user.emailVerified) await showForm(null);
}

/**
 * The public copy of an accepted abstract, or null. Only an accepted one has
 * one, so anything else costs no read.
 */
async function publicCopyOf(abstract) {
  if (abstract?.status !== "accepted") return null;
  return getPublicAbstract(abstract.id).catch((err) => {
    console.error("[pints] getPublicAbstract", err);
    return null;
  });
}

/**
 * The editor. `abstract` null is a first submission; otherwise an edit.
 *
 * `published` is the public copy of an accepted abstract. Handing the form its
 * type and board number as `republish` is what unlocks it: every save then
 * rewrites that copy as well, which is the only way firestore.rules lets the
 * owner touch an accepted abstract at all.
 */
async function showForm(abstract, published = null) {
  submittedEl.replaceChildren();
  await mountAbstractForm(host, {
    user: state.user,
    isAdmin: state.isAdmin,
    abstract,
    republish: published
      ? {
        type: published.type,
        posterSession: published.posterSession ?? null,
        posterNumber: published.posterNumber ?? null,
        acceptedAt: published.acceptedAt ?? null,
      }
      : null,
    defaultAuthorName: state.profile?.displayName ?? "",
    defaultAffiliation: state.profile?.affiliation ?? "",
    // Only when editing: on a first submission there is nothing to go back to.
    onCancel: abstract ? () => showSubmitted(abstract) : null,
    onSaved: async () => {
      // Re-read rather than reuse the draft: the record that matters is the one
      // Firestore actually holds, and the confirmation should show that.
      const saved = await getMyAbstract(state.user.uid);
      // Two cases send them to abstracts.html instead of showing the card here:
      // a delete (onSaved fires with nothing left to hand back — `saved` is
      // null, and leaving the just-deleted abstract sitting filled-in in a
      // form whose Save button still works is worse than leaving the page),
      // and a first submission (`abstract` was null going in) — abstracts.html
      // shows their own card the same way this page does, and is where the
      // home page's "Submit an abstract" button now points once someone has
      // an abstract on file, so a first save should land them exactly where
      // later visits will.
      if (!saved || !abstract) {
        location.href = "abstracts.html";
        return;
      }
      say("Abstract updated.", "ok");
      await showSubmitted(saved);
    },
  });
}

/** The abstract as submitted, with the editor one button away. */
async function showSubmitted(abstract) {
  host.replaceChildren();
  host.hidden = true;
  intro.textContent = "One abstract per person.";
  await mountSubmissionCard(submittedEl, abstract, {
    windows: state.windows,
    onEdit: async () => {
      host.hidden = false;
      await showForm(abstract, await publicCopyOf(abstract));
    },
  });
}

/**
 * The stop between having an account and being able to use it.
 *
 * A panel rather than a status line, and it carries its own resend button:
 * the moment somebody discovers the mail never arrived is right now, on the page
 * they came to use, not on a later visit to account.html. It names the sender
 * domain because institutional filters quarantine it — the measured problem in
 * the README — and that is the first place to look.
 */
function showVerifyGate(user) {
  intro.textContent = "One abstract per person, and you need a confirmed email "
    + "address to send one.";

  const head = document.createElement("div");
  head.className = "panel-head";
  head.textContent = "Confirm your email address first";

  const body = document.createElement("div");
  body.className = "panel-body";

  const first = document.createElement("p");
  first.textContent = `You are signed in as ${user.email}, but that address is not `
    + "confirmed yet. We emailed you a link when you registered — open it, then "
    + "reload this page.";

  const why = document.createElement("p");
  why.textContent = "Until you do, your name is not on the public participant "
    + "list and the submission form stays closed.";

  const where = document.createElement("p");
  where.className = "muted";
  // Deliberately does not name the sending domain. It changes when the pints.fr
  // custom domain is applied in the console (see the README), and copy that has
  // to be edited in step with a console setting is copy that will be wrong.
  where.textContent = "Check your spam or quarantine folder if it has not "
    + "arrived: some university mail servers hold it there.";

  // Measured 2026-08-19: a @cnrs.fr address received nothing at all — not a
  // quarantined copy, nothing. Resending cannot fix a gateway that drops the
  // mail, so the panel needs an exit that does not depend on email arriving.
  const stuck = document.createElement("p");
  stuck.className = "muted";
  stuck.append("Still nothing after a few minutes? ");
  const ask = document.createElement("a");
  ask.href = "contact.html";
  ask.textContent = "Tell the organizers";
  stuck.append(ask, " and we will confirm your address by hand.");

  const resend = document.createElement("button");
  resend.type = "button";
  resend.className = "secondary";
  resend.textContent = "Send it again";
  const resendMsg = document.createElement("span");
  resendMsg.className = "muted";
  resend.addEventListener("click", async () => {
    resend.disabled = true;
    resendMsg.textContent = "";
    try {
      await sendVerification(user);
      resendMsg.textContent = `Sent again to ${user.email}.`;
    } catch (err) {
      // The code matters here: auth/too-many-requests is common and clears by
      // itself, and telling somebody to keep clicking would be useless advice.
      resendMsg.textContent =
        `Could not send it (${err?.code ?? "unknown"}). Ask an organizer if this persists.`;
      console.error("[pints] resend verification email", err);
    } finally {
      resend.disabled = false;
    }
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(resend, resendMsg);

  body.append(first, why, where, actions, stuck);
  gate.replaceChildren(head, body);
  gate.hidden = false;
}

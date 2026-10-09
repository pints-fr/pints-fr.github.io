import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { friendlyAuthError, onUser, signUp } from "./auth.js";
import { getRegistrationLink, getSiteConfig, saveProfile } from "./db.js";
import { destinationAfterAuth, withNext } from "./redirect-utils.mjs";
import { LIMITS } from "./config.mjs";
import { isRegistrationOpen, linkStatus } from "./registration-utils.mjs";

mountLayout();

const form = document.getElementById("register-form");
const msg = document.getElementById("msg");
const nameEl = document.getElementById("displayName");
const affEl = document.getElementById("affiliation");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const rememberEl = document.getElementById("remember");
const submitBtn = document.getElementById("register");

const params = new URLSearchParams(location.search);
const next = params.get("next");
// A late-registration link from the organizers (Admin > Settings). Only spent
// when registration is actually closed; while it is open the link is ignored,
// so it stays good for later.
const linkToken = params.get("link");
document.getElementById("to-login").href = withNext("login.html", next);

const say = (text, kind = "err") => {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
};

if (warnIfUnconfigured(msg)) {
  form.hidden = true;
} else {
  // Creating the account changes auth state, which would redirect away and take
  // the "check your inbox" message with it. Hold the new registrant here until
  // they choose to move on, exactly as the sign-in page does.
  let justRegistered = false;
  // Set once the link has been checked and is needed: registration is closed
  // and this link still works.
  let usingLink = null;

  onUser(({ user, isAdmin }) => {
    setAuthLink({ signedIn: Boolean(user), isAdmin });
    if (user && !justRegistered) location.replace(destinationAfterAuth(next, { isAdmin }));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const displayName = nameEl.value.trim();
    const affiliation = affEl.value.trim();
    const email = emailEl.value.trim();
    if (!displayName) return say("Your full name is required.");
    if (displayName.length > LIMITS.displayName) {
      return say(`Your name must be ${LIMITS.displayName} characters or fewer.`);
    }
    if (!affiliation) return say("Your affiliation is required.");
    if (affiliation.length > LIMITS.affiliation) {
      return say(`Your affiliation must be ${LIMITS.affiliation} characters or fewer.`);
    }
    if (!email) return say("Your email address is required.");

    submitBtn.disabled = true;
    let created = null;
    try {
      justRegistered = true;
      created = await signUp(email, passwordEl.value, rememberEl.checked);
    } catch (err) {
      justRegistered = false;
      submitBtn.disabled = false;
      console.error("[pints] signUp", err);
      return say(friendlyAuthError(err));
    }

    // The account exists from here on, so nothing below may be reported as a
    // failed registration — it would send people back to "Create an account"
    // and into auth/email-already-in-use, from which they conclude the site is
    // broken.
    const { user, verificationSent } = created;
    let profileSaved = true;
    try {
      // publish:false — the public list waits for the address to be confirmed.
      // account.html publishes as soon as a fresh token says it has been.
      await saveProfile(user.uid, { email: user.email, displayName, affiliation },
        { publish: false, registrationLink: usingLink });
    } catch (err) {
      profileSaved = false;
      console.error("[pints] saveProfile during registration", err);
    }

    form.hidden = true;
    finish({ verificationSent, profileSaved });
  });

  // Checked after the form is wired, so a slow read never delays a registration
  // that is allowed. A failed read fails OPEN: firestore.rules refuses the
  // profile write when registration is closed, so this page is a courtesy, not
  // the gate.
  const config = await getSiteConfig().catch((err) => {
    console.error("[pints] getSiteConfig", err);
    return null;
  });
  if (!isRegistrationOpen(config)) {
    const link = linkToken
      ? await getRegistrationLink(linkToken).catch((err) => {
        console.error("[pints] getRegistrationLink", err);
        return null;
      })
      : null;
    const status = linkToken ? linkStatus(link) : null;
    if (status === "valid") {
      usingLink = linkToken;
      const until = link.expiresAt.toDate().toLocaleString(undefined,
        { dateStyle: "long", timeStyle: "short" });
      say(`Registration is closed, but this personal link from the organizers lets you `
        + `register until ${until}. It works once.`, "warn");
    } else {
      showClosed({
        used: "This registration link has already been used. ",
        expired: "This registration link has expired. ",
        missing: "This registration link is not valid. ",
      }[status] ?? "");
    }
  }
}

/** Registration has been closed by the organizers: say so, and point onwards. */
function showClosed(reason = "") {
  form.hidden = true;
  document.getElementById("intro").hidden = true;

  const signIn = document.createElement("a");
  signIn.href = withNext("login.html", next);
  signIn.textContent = "Sign in";
  const contact = document.createElement("a");
  contact.href = "contact.html";
  contact.textContent = "contact the organizers";

  msg.className = "msg warn";
  msg.replaceChildren(
    document.createTextNode(`${reason}Registration for PINTS is closed. Already registered? `),
    signIn,
    document.createTextNode(". Need help? Please "),
    contact,
    document.createTextNode("."));
}

/** Say what actually happened, and give one link onwards. */
function finish({ verificationSent, profileSaved }) {
  const link = document.createElement("a");
  link.href = destinationAfterAuth(next, { isAdmin: false });
  link.textContent = "Go to my account";

  const parts = [];
  if (verificationSent) {
    msg.className = "msg ok";
    parts.push("Account created. Check your inbox — and your spam or quarantine "
      + "folder, since some university mail servers hold it there — and click the "
      + "link to confirm your address. Your name goes on the participant list as "
      + "soon as you do. ");
  } else {
    msg.className = "msg warn";
    parts.push("Account created, but the confirmation email could not be sent. "
      + "You are signed in — open your account and use “Resend the verification "
      + "email”. ");
  }
  if (!profileSaved) {
    msg.className = "msg warn";
    parts.push("Your name and affiliation could not be saved, though: please "
      + "re-enter them on your account page. ");
  }
  msg.replaceChildren(document.createTextNode(parts.join("")), link,
    document.createTextNode("."));
}

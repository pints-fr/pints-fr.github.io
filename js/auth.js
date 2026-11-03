import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db, isConfigured } from "./firebase.js";
import { currentPageFile } from "./nav-utils.mjs";
import { nextValue, withNext } from "./redirect-utils.mjs";

const persistenceFor = (remember) =>
  setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);

/**
 * Where Firebase sends people after they click a verification link. Without
 * this they land on a bare Firebase-hosted confirmation page with no way back
 * to the site. The host must be listed under Auth → Authorized domains.
 */
const returnToAccount = () => ({
  url: new URL("account.html", location.href).href,
  handleCodeInApp: false,
});

export const sendVerification = (user) => sendEmailVerification(user, returnToAccount());

/**
 * Create the account, then try to send the verification email.
 *
 * A mail failure must NOT look like a signup failure: the account already
 * exists at that point, so surfacing the error as-is sends people back to
 * "Create an account", where they hit `auth/email-already-in-use` and conclude
 * the site is broken. Resolves with a flag instead so the caller can say what
 * actually happened.
 */
export async function signUp(email, password, remember) {
  await persistenceFor(remember);
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  try {
    await sendVerification(user);
    return { user, verificationSent: true };
  } catch (err) {
    console.error("[pints] sendEmailVerification failed after signup", err);
    return { user, verificationSent: false, error: err };
  }
}

export async function signIn(email, password, remember) {
  await persistenceFor(remember);
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

export const signOutNow = () => signOut(auth);
export const sendReset = (email) => sendPasswordResetEmail(auth, email);

/**
 * Pull a fresh ID token so request.auth.token.email_verified reflects reality.
 *
 * Clicking the verification link does NOT update the token already held by this
 * tab: it stays false for up to an hour. Without this, someone who verifies and
 * immediately submits gets a PERMISSION_DENIED that "fixes itself" later.
 */
export async function refreshVerification(user) {
  if (!user) return false;
  await user.reload();
  await user.getIdToken(true);
  return user.emailVerified;
}

export async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch {
    // Rules allow reading only your own admins document, so a denial here just
    // means "not an admin". Never treat it as an error worth surfacing.
    return false;
  }
}

/** Subscribe to auth state, resolving admin status before each callback. */
export function onUser(callback) {
  if (!isConfigured) {
    callback({ user: null, isAdmin: false });
    return () => {};
  }
  return onAuthStateChanged(auth, async (user) => {
    callback({ user, isAdmin: user ? await checkIsAdmin(user.uid) : false });
  });
}

/**
 * Resolve with the signed-in user, or redirect to the sign-in page.
 *
 * The redirect carries where we were as `?next=`, so somebody who followed
 * "Submit an abstract" from the home page lands back on the abstract form after
 * signing in or registering rather than on a generic account page with no clue
 * what they came for. page-login.js and page-register.js validate the value
 * before following it.
 *
 * Resolves `null` when Firebase is not configured — callers MUST handle that,
 * or call warnIfUnconfigured() before reaching here. Without this guard the
 * page hangs forever: getAuth() with a placeholder key never fires the callback,
 * so the user stares at a spinner with no explanation.
 */
export function requireUser() {
  return new Promise((resolve) => {
    if (!isConfigured) {
      console.warn("[pints] requireUser() called before Firebase is configured");
      resolve(null);
      return;
    }
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      if (user) resolve(user);
      else {
        location.replace(withNext("login.html",
          nextValue(currentPageFile(location.pathname), location.hash, location.search)));
      }
    });
  });
}

const MESSAGES = {
  "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
  "auth/invalid-email": "That does not look like a valid email address.",
  "auth/missing-password": "Enter a password.",
  "auth/weak-password": "Passwords must be at least 6 characters.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/unauthorized-domain":
    "This site is not an authorized domain for the Firebase project. An organizer " +
    "needs to add it under Authentication → Settings → Authorized domains.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/operation-not-allowed":
    "Email/password sign-in is not enabled for this Firebase project yet.",
};

export const friendlyAuthError = (err) =>
  MESSAGES[err?.code] ?? `Something went wrong (${err?.code ?? "unknown"}).`;

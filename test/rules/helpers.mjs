import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

export const PROJECT_ID = "demo-pints-rules";

export function makeTestEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}

/** A signed-in user. `verified` drives request.auth.token.email_verified. */
export function asUser(env, uid, { verified = true, email = `${uid}@example.org` } = {}) {
  return env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}

export function asAnon(env) {
  return env.unauthenticatedContext().firestore();
}

/** Write fixture data with rules turned off. */
export function seed(env, fn) {
  return env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
}

/** Make `uid` an admin. */
export function seedAdmin(env, uid) {
  return seed(env, (fs) =>
    setDoc(doc(fs, "admins", uid), {
      email: `${uid}@example.org`,
      addedBy: "seed",
      addedAt: new Date(),
    }));
}

/** Open the submission window. Phase 2 rules read this document. */
//
// `editing` and `editDeadline` are the separate editing window; left out, the
// document has no editing fields at all, which is what every config written
// before that window existed looks like.
export function seedConfig(
  env,
  { open = true, deadline = new Date(Date.now() + 30 * 864e5), editing, editDeadline } = {},
) {
  return seed(env, (fs) =>
    setDoc(doc(fs, "config", "site"), {
      submissionsOpen: open,
      submissionDeadline: deadline,
      ...(editing === undefined ? {} : { editingOpen: editing }),
      ...(editDeadline === undefined ? {} : { editingDeadline: editDeadline }),
      edition: "pints2026",
    }));
}

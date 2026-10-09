import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const profile = (over = {}) => ({
  email: "alice@example.org",
  displayName: "Alice Dupont",
  affiliation: "ENS",
  showPublicly: true,
  edition: "pints2026",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("a user can create their own profile", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertSucceeds(setDoc(doc(fs, "users", "alice"), profile()));
});

test("a user cannot create a profile under someone else's uid", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "bob"), profile()));
});

test("a user cannot claim an email that is not theirs", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ email: "boss@example.org" })));
});

test("a user cannot smuggle unknown fields into their profile", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ role: "admin" })));
});

test("a user cannot set an over-long display name or affiliation", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ displayName: "x".repeat(81) })));
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ affiliation: "y".repeat(121) })));
});

test("a user cannot create a profile with an empty display name", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ displayName: "" })));
});

test("a user cannot read another user's profile", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "bob"), profile({ email: "bob@example.org" })));
  await assertFails(getDoc(doc(asUser(env, "alice"), "users", "bob")));
});

test("anonymous visitors cannot read any profile", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "bob"), profile()));
  await assertFails(getDoc(doc(asAnon(env), "users", "bob")));
});

test("an admin can read any profile", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "users", "bob"), profile()));
  await assertSucceeds(getDoc(doc(asUser(env, "boss"), "users", "bob")));
});

test("a user can update their own profile but not change their email", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"), profile()));
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertSucceeds(updateDoc(doc(fs, "users", "alice"), {
    affiliation: "Sorbonne", updatedAt: new Date(),
  }));
  await assertFails(updateDoc(doc(fs, "users", "alice"), { email: "someone@else.org" }));
});

test("a user can read their own admins document but not another's", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(getDoc(doc(asUser(env, "alice"), "admins", "alice")));
  await assertFails(getDoc(doc(asUser(env, "alice"), "admins", "boss")));
});

test("a non-admin cannot make themselves an admin", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "admins", "alice"), {
    email: "alice@example.org", addedBy: "self", addedAt: new Date(),
  }));
});

test("an anonymous visitor cannot read or write the admin registry", async () => {
  await seedAdmin(env, "boss");
  await assertFails(getDoc(doc(asAnon(env), "admins", "boss")));
  await assertFails(setDoc(doc(asAnon(env), "admins", "mallory"), { email: "m@x.org" }));
});

test("an admin can add another admin", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "admins", "alice"), {
    email: "alice@example.org", addedBy: "boss", addedAt: new Date(),
  }));
});

// ---------------------------------------------------- organizer deletes a user
//
// The console's "delete participant" rests on `allow write: if isAdmin()` over
// users/{uid}. The Cloud Function uses the Admin SDK and bypasses rules, but the
// rule is still the boundary for anything reaching Firestore from a browser.

test("an admin can delete another participant's profile", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"), profile()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "olivia"), "users", "alice")));
});

test("an ordinary participant cannot delete somebody else's profile", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"), profile()));
  await assertFails(deleteDoc(doc(asUser(env, "mallory"), "users", "alice")));
});

// Organizers may remove a participant, but must not be able to rewrite what
// somebody said about themselves. There is no admin UI for it; this pins the
// intent so nobody adds one by accident.
test("an admin can read every profile, which an ordinary participant cannot", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"), profile()));
  await assertSucceeds(getDoc(doc(asUser(env, "olivia"), "users", "alice")));
  await assertFails(getDoc(doc(asUser(env, "mallory"), "users", "alice")));
});

// Closing registration refuses new profiles and nothing else: people already
// registered keep editing theirs, and organizers can still add one by hand.
const closeRegistration = () =>
  seed(env, (fs) => setDoc(doc(fs, "config", "site"), { registrationOpen: false }));

test("nobody new can create a profile while registration is closed", async () => {
  await closeRegistration();
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile()));
});

test("a config without the switch leaves registration open", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "config", "site"), { submissionsOpen: true }));
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertSucceeds(setDoc(doc(fs, "users", "alice"), profile()));
});

test("an existing participant can still edit their profile while registration is closed", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"), profile()));
  await closeRegistration();
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertSucceeds(setDoc(doc(fs, "users", "alice"),
    profile({ affiliation: "Institut Pasteur" }), { merge: true }));
});

test("an admin can still create a profile while registration is closed", async () => {
  await seedAdmin(env, "boss");
  await closeRegistration();
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "users", "alice"), profile()));
});

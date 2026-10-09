import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const pub = (over = {}) => ({
  displayName: "Alice Dupont",
  affiliation: "ENS",
  edition: "pints2026",
  updatedAt: new Date(),
  ...over,
});

test("anyone can list public participants", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(getDocs(collection(asAnon(env), "participants_public")));
});

test("a user can publish their own name", async () => {
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"), pub()));
});

test("a user cannot publish someone else's name", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "bob"), pub()));
});

test("an anonymous visitor cannot publish a name", async () => {
  await assertFails(setDoc(doc(asAnon(env), "participants_public", "mallory"), pub()));
});

test("a user cannot smuggle extra fields into the public projection", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"),
    pub({ email: "alice@example.org" })));
});

test("a user cannot publish an over-long display name or affiliation", async () => {
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "participants_public", "alice"), pub({ displayName: "x".repeat(81) })));
  await assertFails(setDoc(doc(fs, "participants_public", "alice"), pub({ affiliation: "y".repeat(121) })));
});

test("a user cannot publish an empty display name", async () => {
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"),
    pub({ displayName: "" })));
});

test("an affiliation is optional", async () => {
  const { affiliation, ...withoutAffiliation } = pub();
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"),
    withoutAffiliation));
});

test("a user can withdraw their own name", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "participants_public", "alice")));
});

test("a user cannot delete someone else's public entry", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "bob"), pub()));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "participants_public", "bob")));
});

test("an admin can remove any public entry", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "bob"), pub()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "boss"), "participants_public", "bob")));
});

// These two exercise exactly what js/db.js saveProfile() does. They are the
// reason the participants_public rule deliberately has no get() on
// users/{uid}.showPublicly: a get() reads pre-batch committed state, so the
// very first opt-in — where the profile does not exist yet — would be denied.
const profile = (over = {}) => ({
  email: "alice@example.org",
  displayName: "Alice Dupont",
  affiliation: "ENS",
  showPublicly: true,
  edition: "pints2026",
  updatedAt: new Date(),
  ...over,
});

test("opting in writes the profile and the public entry in one batch", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  const batch = writeBatch(fs);
  batch.set(doc(fs, "users", "alice"), profile(), { merge: true });
  batch.set(doc(fs, "participants_public", "alice"), pub());
  await assertSucceeds(batch.commit());
});

test("opting out clears the profile flag and deletes the public entry in one batch", async () => {
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "users", "alice"), profile());
    await setDoc(doc(fs, "participants_public", "alice"), pub());
  });
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  const batch = writeBatch(fs);
  batch.set(doc(fs, "users", "alice"), profile({ showPublicly: false }), { merge: true });
  batch.delete(doc(fs, "participants_public", "alice"));
  await assertSucceeds(batch.commit());
});

// An organizer removing a participant has to take the public listing with them,
// or the participant list keeps showing somebody who has been deleted.
test("an admin can delete another participant's public listing", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(deleteDoc(doc(asUser(env, "olivia"), "participants_public", "alice")));
});

// Organizers can correct a name or an affiliation from the admin console.
test("an admin can rewrite another participant's public listing", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertSucceeds(setDoc(
    doc(asUser(env, "olivia"), "participants_public", "alice"),
    pub({ displayName: "Alice Dupont-Martin" })));
});

// Being an organizer is permission to fix a typo, not permission to put
// arbitrary data in a world-readable document. The field validation is the same
// for them as for the owner.
test("an admin's rewrite is validated exactly like the owner's", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  const fs = asUser(env, "olivia");

  await assertFails(setDoc(doc(fs, "participants_public", "alice"), pub({ displayName: "" })));
  await assertFails(setDoc(doc(fs, "participants_public", "alice"),
    pub({ displayName: "x".repeat(81) })));
  await assertFails(setDoc(doc(fs, "participants_public", "alice"),
    pub({ affiliation: "x".repeat(121) })));
  await assertFails(setDoc(doc(fs, "participants_public", "alice"),
    { ...pub(), email: "alice@example.org" }));
});

test("an ordinary participant still cannot rewrite somebody else's listing", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "participants_public", "alice"), pub()));
  await assertFails(setDoc(
    doc(asUser(env, "mallory"), "participants_public", "alice"),
    pub({ displayName: "Renamed by a stranger" })));
});

// While registration is closed, a listing needs a profile behind it.
const closeRegistration = () =>
  seed(env, (fs) => setDoc(doc(fs, "config", "site"), { registrationOpen: false }));

test("a bare account cannot publish a name while registration is closed", async () => {
  await closeRegistration();
  await assertFails(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"), pub()));
});

test("someone who registered before it closed can still publish their name", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"), profile()));
  await closeRegistration();
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "participants_public", "alice"), pub()));
});

test("the registration batch cannot sneak a listing through while closed", async () => {
  await closeRegistration();
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  const batch = writeBatch(fs);
  batch.set(doc(fs, "users", "alice"), profile(), { merge: true });
  batch.set(doc(fs, "participants_public", "alice"), pub());
  await assertFails(batch.commit());
});

test("an admin can still list somebody while registration is closed", async () => {
  await seedAdmin(env, "boss");
  await closeRegistration();
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "participants_public", "alice"), pub()));
});

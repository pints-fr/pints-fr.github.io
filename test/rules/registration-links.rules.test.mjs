import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const TOKEN = "0123456789abcdef0123456789abcdef";
const inADay = () => new Date(Date.now() + 864e5);

// What js/db.js saveProfile() writes during registration, publish:false.
const profile = (over = {}) => ({
  email: "alice@example.org",
  displayName: "Alice Dupont",
  affiliation: "ENS",
  edition: "pints2026",
  updatedAt: serverTimestamp(),
  ...over,
});

const closeRegistration = () =>
  seed(env, (fs) => setDoc(doc(fs, "config", "site"), { registrationOpen: false }));

const seedLink = (over = {}) =>
  seed(env, (fs) => setDoc(doc(fs, "registration_links", TOKEN), {
    createdBy: "boss", createdAt: new Date(), expiresAt: inADay(), ...over,
  }));

/** The batch saveProfile() commits when it is handed a registrationLink. */
function redeem(uid, token = TOKEN) {
  const fs = asUser(env, uid, { email: `${uid}@example.org` });
  const batch = writeBatch(fs);
  batch.set(doc(fs, "users", uid),
    profile({ email: `${uid}@example.org`, registrationLink: token }), { merge: true });
  batch.update(doc(fs, "registration_links", token),
    { usedBy: uid, usedAt: serverTimestamp() });
  return batch.commit();
}

test("a valid link lets somebody register while registration is closed", async () => {
  await closeRegistration();
  await seedLink();
  await assertSucceeds(redeem("alice"));
});

test("a link works once: a second person cannot reuse it", async () => {
  await closeRegistration();
  await seedLink();
  await assertSucceeds(redeem("alice"));
  await assertFails(redeem("bob"));
});

test("an expired link is refused", async () => {
  await closeRegistration();
  await seedLink({ expiresAt: new Date(Date.now() - 1000) });
  await assertFails(redeem("alice"));
});

test("a token with no link behind it is refused", async () => {
  await closeRegistration();
  await assertFails(redeem("alice"));
});

test("naming a link without spending it is refused", async () => {
  await closeRegistration();
  await seedLink();
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"), profile({ registrationLink: TOKEN })));
});

test("a link cannot be spent except by registering", async () => {
  await seedLink();
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(updateDoc(doc(fs, "registration_links", TOKEN),
    { usedBy: "alice", usedAt: serverTimestamp() }));
});

test("a link cannot be spent on somebody else's behalf", async () => {
  await closeRegistration();
  await seedLink();
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  const batch = writeBatch(fs);
  batch.set(doc(fs, "users", "alice"), profile({ registrationLink: TOKEN }), { merge: true });
  batch.update(doc(fs, "registration_links", TOKEN),
    { usedBy: "bob", usedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("the owner cannot rewrite which link let them in", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "users", "alice"),
    profile({ updatedAt: new Date(), registrationLink: TOKEN })));
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertFails(setDoc(doc(fs, "users", "alice"),
    profile({ registrationLink: "somethingelse" }), { merge: true }));
  await assertSucceeds(setDoc(doc(fs, "users", "alice"),
    profile({ affiliation: "Institut Pasteur" }), { merge: true }));
});

test("registering while open needs no link", async () => {
  const fs = asUser(env, "alice", { email: "alice@example.org" });
  await assertSucceeds(setDoc(doc(fs, "users", "alice"), profile(), { merge: true }));
});

test("anyone holding the token can read the link; nobody but an organizer can list them", async () => {
  await seedLink();
  await seedAdmin(env, "boss");
  await assertSucceeds(getDoc(doc(asAnon(env), "registration_links", TOKEN)));
  await assertFails(getDocs(collection(asUser(env, "alice"), "registration_links")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "registration_links")));
});

test("only an organizer can create or revoke a link", async () => {
  await seedAdmin(env, "boss");
  const link = (uid) => ({ createdBy: uid, createdAt: serverTimestamp(), expiresAt: inADay() });
  await assertFails(setDoc(doc(asUser(env, "alice"), "registration_links", TOKEN), link("alice")));
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "registration_links", TOKEN), link("boss")));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "registration_links", TOKEN)));
  await assertSucceeds(deleteDoc(doc(asUser(env, "boss"), "registration_links", TOKEN)));
});

test("an organizer cannot create a link that is already spent", async () => {
  await seedAdmin(env, "boss");
  await assertFails(setDoc(doc(asUser(env, "boss"), "registration_links", TOKEN), {
    createdBy: "boss", expiresAt: inADay(), usedBy: "alice",
  }));
});

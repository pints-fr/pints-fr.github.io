import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin, seedConfig } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const TOKEN = "0123456789abcdef0123456789abcdef";
const PAST = new Date(Date.now() - 864e5);
const FUTURE = new Date(Date.now() + 30 * 864e5);
const inADay = () => new Date(Date.now() + 864e5);

// What js/db.js saveAbstract() writes on a first submission, nulls included.
const abstract = (uid, over = {}) => ({
  ownerUid: uid,
  edition: "pints2026",
  title: "Recurrent dynamics in mouse V1",
  affiliations: ["ENS"],
  authors: [{ name: "Alice Dupont", affiliationIndexes: [0], presenting: true }],
  body: "We recorded from V1.",
  topic: "systems",
  talkConsidered: false,
  figureUrl: null,
  figurePath: null,
  figureCaption: "",
  publishChoice: "full",
  publishConfirmed: false,
  status: "submitted",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over,
});

const closeSubmissions = () => seedConfig(env, { open: false, deadline: PAST });

const seedLink = (over = {}) =>
  seed(env, (fs) => setDoc(doc(fs, "submission_links", TOKEN), {
    createdBy: "boss", createdAt: new Date(), expiresAt: inADay(), ...over,
  }));

/** The batch saveAbstract() commits with spendLink. */
function redeem(uid, { token = TOKEN, verified = true } = {}) {
  const fs = asUser(env, uid, { verified });
  const batch = writeBatch(fs);
  batch.set(doc(fs, "abstracts", uid), abstract(uid, { submissionLink: token }));
  batch.update(doc(fs, "submission_links", token),
    { usedBy: uid, usedAt: serverTimestamp() });
  return batch.commit();
}

test("a valid link lets somebody submit while submissions are closed", async () => {
  await closeSubmissions();
  await seedLink();
  await assertSucceeds(redeem("alice"));
});

test("a link works once: a second person cannot reuse it", async () => {
  await closeSubmissions();
  await seedLink();
  await assertSucceeds(redeem("alice"));
  await assertFails(redeem("bob"));
});

test("an expired link is refused", async () => {
  await closeSubmissions();
  await seedLink({ expiresAt: new Date(Date.now() - 1000) });
  await assertFails(redeem("alice"));
});

test("a token with no link behind it is refused", async () => {
  await closeSubmissions();
  await assertFails(redeem("alice"));
});

test("an unconfirmed address is refused even with a link", async () => {
  await closeSubmissions();
  await seedLink();
  await assertFails(redeem("alice", { verified: false }));
});

test("naming a link without spending it is refused", async () => {
  await closeSubmissions();
  await seedLink();
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract("alice", { submissionLink: TOKEN })));
});

test("a link cannot be spent except by submitting", async () => {
  await seedLink();
  await assertFails(updateDoc(doc(asUser(env, "alice"), "submission_links", TOKEN),
    { usedBy: "alice", usedAt: serverTimestamp() }));
});

test("a link cannot be spent on somebody else's behalf", async () => {
  await closeSubmissions();
  await seedLink();
  const fs = asUser(env, "alice");
  const batch = writeBatch(fs);
  batch.set(doc(fs, "abstracts", "alice"), abstract("alice", { submissionLink: TOKEN }));
  batch.update(doc(fs, "submission_links", TOKEN),
    { usedBy: "bob", usedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test("the owner cannot rewrite or drop which link let them in", async () => {
  await seedConfig(env, { open: false, deadline: PAST, editing: true, editDeadline: FUTURE });
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"),
    abstract("alice", { submissionLink: TOKEN, createdAt: new Date(), updatedAt: new Date() })));
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"),
    abstract("alice", { submissionLink: "somethingelse" })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract("alice")));
  await assertSucceeds(setDoc(doc(fs, "abstracts", "alice"),
    abstract("alice", { submissionLink: TOKEN, title: "Fixed a typo" })));
});

test("submitting while open needs no link", async () => {
  await seedConfig(env, { open: true, deadline: FUTURE });
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract("alice")));
});

test("anyone holding the token can read the link; nobody but an organizer can list them", async () => {
  await seedLink();
  await seedAdmin(env, "boss");
  await assertSucceeds(getDoc(doc(asAnon(env), "submission_links", TOKEN)));
  await assertFails(getDocs(collection(asUser(env, "alice"), "submission_links")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "submission_links")));
});

test("only an organizer can create or revoke a link", async () => {
  await seedAdmin(env, "boss");
  const link = (uid) => ({ createdBy: uid, createdAt: serverTimestamp(), expiresAt: inADay() });
  await assertFails(setDoc(doc(asUser(env, "alice"), "submission_links", TOKEN), link("alice")));
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "submission_links", TOKEN), link("boss")));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "submission_links", TOKEN)));
  await assertSucceeds(deleteDoc(doc(asUser(env, "boss"), "submission_links", TOKEN)));
});

test("an organizer cannot create a link that is already spent", async () => {
  await seedAdmin(env, "boss");
  await assertFails(setDoc(doc(asUser(env, "boss"), "submission_links", TOKEN), {
    createdBy: "boss", expiresAt: inADay(), usedBy: "alice",
  }));
});

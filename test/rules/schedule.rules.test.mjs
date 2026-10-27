import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const item = (over = {}) => ({
  edition: "pints2026",
  start: "09:30",
  end: "10:30",
  title: "Opening keynote",
  speaker: "Julijana Gjorgjieva",
  affiliation: "TU Munich",
  kind: "keynote",
  ...over,
});

test("anyone can read the schedule", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "schedule", "s1"), item()));
  await assertSucceeds(getDocs(collection(asAnon(env), "schedule")));
});

test("a signed-in non-admin cannot add or delete schedule items", async () => {
  await assertFails(addDoc(collection(asUser(env, "alice"), "schedule"), item()));
  await seed(env, (fs) => setDoc(doc(fs, "schedule", "s1"), item()));
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "schedule", "s1")));
  await assertFails(setDoc(doc(asUser(env, "alice"), "schedule", "s1"), item({ title: "Mine" })));
});

test("an anonymous visitor cannot write the schedule", async () => {
  await assertFails(addDoc(collection(asAnon(env), "schedule"), item()));
});

test("an admin can add, edit, and delete schedule items", async () => {
  await seedAdmin(env, "boss");
  const fs = asUser(env, "boss");
  await assertSucceeds(setDoc(doc(fs, "schedule", "s1"), item()));
  await assertSucceeds(setDoc(doc(fs, "schedule", "s1"), item({ title: "Renamed" })));
  await assertSucceeds(deleteDoc(doc(fs, "schedule", "s1")));
});

test("an admin can add an item with only the required fields", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "schedule", "s1"), {
    edition: "pints2026", title: "Coffee", kind: "break",
  }));
});

test("an admin can tag an item with a session, or leave it out", async () => {
  await seedAdmin(env, "boss");
  const fs = asUser(env, "boss");
  for (const session of ["cognitive", "systems", "computational", "keynote"]) {
    await assertSucceeds(setDoc(doc(fs, "schedule", "s1"), item({ session })));
  }
  await assertSucceeds(setDoc(doc(fs, "schedule", "s1"), item()));
});

test("an admin cannot invent a session outside the vocabulary", async () => {
  await seedAdmin(env, "boss");
  const fs = asUser(env, "boss");
  // Including "": the editor drops the field rather than storing a blank, and a
  // blank would otherwise print an unnamed banner on the public page.
  for (const session of ["", "astrology", "Cognitive", 3, null]) {
    await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ session })));
  }
});

test("an admin cannot write a malformed schedule item", async () => {
  await seedAdmin(env, "boss");
  const fs = asUser(env, "boss");
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ kind: "banquet" })));
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ title: "" })));
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ title: "x".repeat(201) })));
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ surprise: true })));

  const { title, ...noTitle } = item();
  await assertFails(setDoc(doc(fs, "schedule", "s1"), noTitle));
});

// PINTS is one day in one venue. These three fields were dropped, so writing
// them must now fail rather than silently persisting dead data.
test("day, location, and order are no longer accepted", async () => {
  await seedAdmin(env, "boss");
  const fs = asUser(env, "boss");
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ day: "2026-11-12" })));
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ location: "Amphi A" })));
  await assertFails(setDoc(doc(fs, "schedule", "s1"), item({ order: 0 })));
});
test("an admin can link a program item to an abstract", async () => {
  await seedAdmin(env, "boss");
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "schedule", "s1"),
    item({ kind: "talk", abstractId: "alice" })));
});

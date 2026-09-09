import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin, seedConfig } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const PAST = new Date(Date.now() - 864e5);

// One abstract per participant, and the document id IS the owner's uid — so
// every path below is `abstracts/<uid>`, and there is no such thing as a second
// document to test against.
const abstract = (over = {}) => ({
  ownerUid: "alice",
  edition: "pints2026",
  title: "Recurrent dynamics in mouse V1",
  affiliations: ["ENS"],
  authors: [{ name: "Alice Dupont", affiliationIndexes: [0], presenting: true }],
  body: "We recorded from V1.",
  topic: "systems",
  talkConsidered: true,
  figureUrl: "https://example.org/f.png",
  figurePath: "abstract_figures/alice/alice",
  figureCaption: "Tuning curves for 120 neurons.",
  status: "submitted",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("a verified owner can submit while the window is open", async () => {
  await seedConfig(env);
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

// The whole point of keying the document on the uid: there is no second slot to
// create, so "one abstract per person" needs no rule that counts anything.
test("a participant has exactly one slot, and it is named by their uid", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  await assertSucceeds(setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertFails(setDoc(doc(fs, "abstracts", "alice-2"), abstract({ title: "Second" })));
  await assertFails(setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob" })));
  await assertFails(setDoc(doc(fs, "abstracts", "bob"), abstract()));
});

// Register first, then submit. This is the gate the whole flow is built around:
// the home page sends a signed-out visitor to sign in, and submit.html shows a
// "confirm your address" panel instead of the form. Checked here because none of
// that is an authorization boundary — this is.
test("an unverified user cannot submit, or revise", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice", { verified: false });
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract()));

  await seed(env, (db) => setDoc(doc(db, "abstracts", "alice"), abstract()));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ title: "Revised" })));
});

test("an unverified user cannot submit as somebody else either", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice", { verified: false });
  await assertFails(setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob" })));
});

// Reading is not gated on it: somebody whose address lapsed still gets to see
// what is on file, which is what submit.html shows them behind the panel.
test("an unverified owner can still read their own abstract", async () => {
  await seedConfig(env);
  await seed(env, (db) => setDoc(doc(db, "abstracts", "alice"), abstract()));
  const fs = asUser(env, "alice", { verified: false });
  await assertSucceeds(getDoc(doc(fs, "abstracts", "alice")));
});

test("an anonymous visitor cannot submit", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asAnon(env), "abstracts", "alice"), abstract()));
});

test("nobody can submit once submissions are toggled closed", async () => {
  await seedConfig(env, { open: false });
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("nobody can submit once the deadline has passed, even if the toggle was forgotten", async () => {
  await seedConfig(env, { open: true, deadline: PAST });
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

test("ownerUid must agree with the document id", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ ownerUid: "bob" })));
});

test("a user cannot self-accept", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "accepted" })));
});

test("oversized fields, unknown keys, and bad types are rejected", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  const bad = (over) => assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract(over)));
  await bad({ title: "x".repeat(201) });
  await bad({ body: "y".repeat(2501) });
  await bad({ posterNumber: 3 });
  await bad({ authors: [] });
  await bad({ figureUrl: "u".repeat(501) });
  await bad({ talkConsidered: "no" });
});

test("the topic must be one of the three the site offers", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ topic: "quantum" })));
  for (const topic of ["cognitive", "systems", "computational"]) {
    await assertSucceeds(setDoc(doc(fs, "abstracts", "alice"), abstract({ topic })));
  }
});

test("the submitter cannot set a presentation type — that is the committee's call", async () => {
  await seedConfig(env);
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ type: "talk" })));
});

// A poster with no figure is not a poster, and a figure nobody captioned cannot
// go in the booklet. Both are required, and both are checked here rather than
// only in the browser, where anyone holding the public API key can skip them.
test("a figure and its caption are required", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ figureUrl: null })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ figureCaption: "" })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"),
    abstract({ figureCaption: "c".repeat(601) })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ figureCaption: 42 })));

  const { figureCaption, ...noCaption } = abstract();
  await assertFails(setDoc(doc(fs, "abstracts", "alice"), noCaption));
});

// Once a submitter opts out of a talk, the abstract stays poster-only and
// neither field has anywhere to be used.
test("figure and caption become optional once the submitter opts out of a talk", async () => {
  await seedConfig(env);
  const fs = asUser(env, "alice");
  const { figureUrl, figurePath, figureCaption, ...noFigureAtAll } =
    abstract({ talkConsidered: false });
  await assertSucceeds(setDoc(doc(fs, "abstracts", "alice"), noFigureAtAll));
});

test("an owner can edit their abstract while it is still submitted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ title: "A better title" })));
});

test("an owner CANNOT edit or delete once accepted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "accepted" })));
  const fs = asUser(env, "alice");
  await assertFails(setDoc(doc(fs, "abstracts", "alice"),
    abstract({ status: "accepted", title: "Sneaky" })));
  await assertFails(setDoc(doc(fs, "abstracts", "alice"),
    abstract({ status: "submitted", title: "Sneaky" })));
  await assertFails(deleteDoc(doc(fs, "abstracts", "alice")));
});

// Only `accepted` is frozen. With a single slot per person this matters more
// than ever: freezing a rejection would leave them unable to revise, delete, or
// replace it — there is nowhere else to put a second attempt.
test("an owner can revise and resubmit after a rejection", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "rejected" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "submitted", title: "Revised after review" })));
});

test("an owner can still edit a document left on the retired 'withdrawn' status", async () => {
  // Nothing writes 'withdrawn' any more — the admin's button now writes
  // 'submitted' — but a document from before the change must not be frozen out
  // of its owner's hands. The rule tolerates it as a PREVIOUS status only.
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "withdrawn" })));
  await assertSucceeds(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    abstract({ status: "submitted", title: "Back again" })));
});

test("an owner still cannot write a status of their own choosing", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "submitted" })));
  const fs = asUser(env, "alice");
  for (const status of ["accepted", "rejected", "withdrawn"]) {
    await assertFails(setDoc(doc(fs, "abstracts", "alice"), abstract({ status })));
  }
});

test("returning an accepted abstract to review is an admin write", async () => {
  // What the console's "Return to review" button does: status back to
  // submitted, public copy gone. Both halves are admin-only.
  await seedAdmin(env, "boss");
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "accepted" }));
    await setDoc(doc(fs, "abstracts_public", "alice"), { edition: "pints2026", title: "T" });
  });
  await assertFails(updateDoc(doc(asUser(env, "alice"), "abstracts", "alice"),
    { status: "submitted" }));
  const boss = asUser(env, "boss");
  await assertSucceeds(updateDoc(doc(boss, "abstracts", "alice"), { status: "submitted" }));
  await assertSucceeds(deleteDoc(doc(boss, "abstracts_public", "alice")));
});

test("an owner can delete an abstract that has not been accepted", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "rejected" })));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "abstracts", "alice")));
});

test("a user cannot read, edit, or delete somebody else's abstract", async () => {
  await seedConfig(env);
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob" })));
  const fs = asUser(env, "alice");
  await assertFails(getDoc(doc(fs, "abstracts", "bob")));
  await assertFails(getDoc(doc(asAnon(env), "abstracts", "bob")));
  await assertFails(setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob" })));
  await assertFails(deleteDoc(doc(fs, "abstracts", "bob")));
});

// This is the load-bearing one. A participant reads their own with a direct get,
// so `list` belongs to organizers alone — a query is the only shape that could
// sweep in the rest of the submission pile, and there is nothing it would buy
// its owner that the get does not.
test("only an admin can query the abstracts collection at all", async () => {
  await seedAdmin(env, "boss");
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "abstracts", "alice"), abstract());
    await setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob" }));
  });
  const fs = asUser(env, "alice");
  await assertSucceeds(getDoc(doc(fs, "abstracts", "alice")));
  await assertFails(getDocs(collection(fs, "abstracts")));
  await assertFails(getDocs(query(collection(fs, "abstracts"), where("ownerUid", "==", "alice"))));
  await assertFails(getDocs(collection(asAnon(env), "abstracts")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "abstracts")));
});

test("an admin can change status after the deadline", async () => {
  await seedConfig(env, { open: true, deadline: PAST });
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(updateDoc(doc(asUser(env, "boss"), "abstracts", "alice"),
    { status: "accepted" }));
});

test("reviews are admin-only, even for the abstract's owner", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstract_reviews", "alice"),
    { reviews: { boss: { score: 4, note: "weak methods" } } }));
  await assertFails(getDoc(doc(asUser(env, "alice"), "abstract_reviews", "alice")));
  await assertFails(getDoc(doc(asAnon(env), "abstract_reviews", "alice")));
  await assertFails(getDocs(collection(asUser(env, "alice"), "abstract_reviews")));
  await assertSucceeds(getDoc(doc(asUser(env, "boss"), "abstract_reviews", "alice")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "abstract_reviews")));
});

// Scores are per organizer, so two of them reviewing at once must not overwrite
// each other. The write shape that makes that true is a merge into a nested map;
// this asserts the rules permit it and that a non-admin still cannot.
test("an organizer writes only their own slot of the reviews map", async () => {
  await seedAdmin(env, "boss");
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "abstract_reviews", "alice"),
    { reviews: { boss: { score: 9, note: "strong" } } }));

  await assertSucceeds(setDoc(doc(asUser(env, "olivia"), "abstract_reviews", "alice"),
    { reviews: { olivia: { score: 6, note: "mixed" } } }, { merge: true }));
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstract_reviews", "alice"),
    { reviews: { alice: { score: 10, note: "brilliant, obviously" } } }, { merge: true }));

  const snap = await getDoc(doc(asUser(env, "boss"), "abstract_reviews", "alice"));
  const { reviews } = snap.data();
  if (reviews.boss?.score !== 9 || reviews.olivia?.score !== 6) {
    throw new Error(`merge lost a reviewer: ${JSON.stringify(reviews)}`);
  }
});

test("published abstracts are world-readable but admin-write only", async () => {
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts_public", "alice"),
    { title: "T", type: "poster", posterNumber: 1, edition: "pints2026" }));
  await assertSucceeds(getDocs(collection(asAnon(env), "abstracts_public")));
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts_public", "alice"),
    { title: "Mine now" }));
  await assertSucceeds(setDoc(doc(asUser(env, "boss"), "abstracts_public", "alice"),
    { title: "T2", type: "talk", edition: "pints2026" }));
});

test("a missing config/site denies submission rather than allowing it", async () => {
  // No seedConfig here on purpose: get() on a missing document makes the rule
  // error, and an erroring rule must fail closed.
  await assertFails(setDoc(doc(asUser(env, "alice"), "abstracts", "alice"), abstract()));
});

// ------------------------------------------------- organizer edit and delete
//
// Accept, reject, withdraw and update-published are all an admin writing
// somebody else's abstract document, and they rest entirely on `allow write: if
// isAdmin()`. Nothing else asserts it, so a later tightening of these rules
// would break the review console silently.

test("an admin can edit an abstract they do not own", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(setDoc(
    doc(asUser(env, "olivia"), "abstracts", "alice"),
    abstract({ title: "Recurrent dynamics in mouse V1 (corrected)" }),
  ));
});

// "Update published copy" writes an already-accepted abstract, which its owner
// cannot do: the freeze that stops abstracts_public going stale is a rule about
// owners.
test("an admin can write an accepted abstract, which its owner cannot", async () => {
  await seedConfig(env);
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract({ status: "accepted" })));

  await assertFails(setDoc(
    doc(asUser(env, "alice"), "abstracts", "alice"), abstract({ title: "Sneaky rewrite" })));
  await assertSucceeds(setDoc(
    doc(asUser(env, "olivia"), "abstracts", "alice"),
    abstract({ status: "accepted", title: "Fixed by an organizer" })));
});

// The submission window gates participants, never organizers: acceptances are
// decided long after the deadline has passed.
test("an admin can write an abstract after the deadline has passed", async () => {
  await seedConfig(env, { open: false, deadline: PAST });
  await seedAdmin(env, "olivia");
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertSucceeds(setDoc(
    doc(asUser(env, "olivia"), "abstracts", "alice"), abstract({ title: "Late fix" })));
});

test("an admin can delete any abstract, including an accepted one", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "abstracts", "alice"), abstract());
    await setDoc(doc(fs, "abstracts", "bob"), abstract({ ownerUid: "bob", status: "accepted" }));
  });
  const fs = asUser(env, "olivia");
  await assertSucceeds(deleteDoc(doc(fs, "abstracts", "alice")));
  await assertSucceeds(deleteDoc(doc(fs, "abstracts", "bob")));
});

test("an ordinary participant cannot delete someone else's abstract", async () => {
  await seed(env, (fs) => setDoc(doc(fs, "abstracts", "alice"), abstract()));
  await assertFails(deleteDoc(doc(asUser(env, "mallory"), "abstracts", "alice")));
});

test("an admin can delete the published copy and the review", async () => {
  await seedAdmin(env, "olivia");
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "abstracts_public", "alice"), { title: "Published", edition: "pints2026" });
    await setDoc(doc(fs, "abstract_reviews", "alice"), { reviews: { olivia: { score: 8 } } });
  });
  const fs = asUser(env, "olivia");
  await assertSucceeds(deleteDoc(doc(fs, "abstracts_public", "alice")));
  await assertSucceeds(deleteDoc(doc(fs, "abstract_reviews", "alice")));
});

import test, { after, before, beforeEach } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc,
} from "firebase/firestore";
import { asAnon, asUser, makeTestEnv, seed, seedAdmin } from "./helpers.mjs";

let env;
before(async () => { env = await makeTestEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// Exactly what js/db.js castVote() writes.
const ballot = (posterId, over = {}) => ({
  posterId,
  edition: "pints2026",
  updatedAt: serverTimestamp(),
  ...over,
});

/**
 * Voting open; alice and bob registered; bob owns accepted poster "bob",
 * carol owns accepted talk "carol". Anything else is opt-out per test.
 */
async function seedWorld({ votingOpen = true, config = true } = {}) {
  await seed(env, async (fs) => {
    if (config) {
      await setDoc(doc(fs, "config", "site"), {
        edition: "pints2026",
        // null: a config from before the switch existed, with no field at all.
        ...(votingOpen === null ? {} : { votingOpen }),
      });
    }
    for (const uid of ["alice", "bob"]) {
      await setDoc(doc(fs, "users", uid), {
        email: `${uid}@example.org`, displayName: uid, edition: "pints2026",
      });
    }
    await setDoc(doc(fs, "abstracts_public", "bob"),
      { edition: "pints2026", title: "Bob's poster", type: "poster", posterNumber: 1 });
    await setDoc(doc(fs, "abstracts_public", "carol"),
      { edition: "pints2026", title: "Carol's talk", type: "talk" });
  });
}

const vote = (fs, uid, posterId, over) =>
  setDoc(doc(fs, "poster_votes", uid), ballot(posterId, over));

test("a registered participant can vote for somebody else's poster", async () => {
  await seedWorld();
  await assertSucceeds(vote(asUser(env, "alice"), "alice", "bob"));
});

test("a voter can change their vote while voting is open", async () => {
  await seedWorld();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts_public", "dave"),
    { edition: "pints2026", title: "Dave's poster", type: "poster", posterNumber: 2 }));
  const fs = asUser(env, "alice");
  await assertSucceeds(vote(fs, "alice", "bob"));
  await assertSucceeds(vote(fs, "alice", "dave"));
});

test("nobody can vote for their own poster", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "bob"), "bob", "bob"));
});

test("a talk is not a candidate", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "alice"), "alice", "carol"));
});

test("a poster that does not exist is not a candidate", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "alice"), "alice", "nobody"));
});

test("a poster from another edition is not a candidate", async () => {
  await seedWorld();
  await seed(env, (fs) => setDoc(doc(fs, "abstracts_public", "old"),
    { edition: "pints2025", title: "Old", type: "poster" }));
  await assertFails(vote(asUser(env, "alice"), "alice", "old"));
});

test("voting is refused while closed", async () => {
  await seedWorld({ votingOpen: false });
  await assertFails(vote(asUser(env, "alice"), "alice", "bob"));
});

test("a config without the voting switch means closed", async () => {
  await seedWorld({ votingOpen: null });
  await assertFails(vote(asUser(env, "alice"), "alice", "bob"));
});

test("no config at all means closed", async () => {
  await seedWorld({ config: false });
  await assertFails(vote(asUser(env, "alice"), "alice", "bob"));
});

test("an unconfirmed address cannot vote", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "alice", { verified: false }), "alice", "bob"));
});

test("an account with no profile cannot vote", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "mallory"), "mallory", "bob"));
});

test("an anonymous visitor cannot vote", async () => {
  await seedWorld();
  await assertFails(vote(asAnon(env), "alice", "bob"));
});

test("nobody can cast a ballot in somebody else's name", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "alice"), "bob", "bob"));
});

test("a ballot cannot carry extra fields", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "alice"), "alice", "bob", { weight: 10 }));
});

test("a ballot cannot be backdated", async () => {
  await seedWorld();
  await assertFails(vote(asUser(env, "alice"), "alice", "bob", { updatedAt: new Date(0) }));
});

test("a voter can read their own ballot but not anybody else's", async () => {
  await seedWorld();
  await seed(env, async (fs) => {
    await setDoc(doc(fs, "poster_votes", "alice"), { posterId: "bob", edition: "pints2026" });
    await setDoc(doc(fs, "poster_votes", "bob"), { posterId: "x", edition: "pints2026" });
  });
  const fs = asUser(env, "alice");
  await assertSucceeds(getDoc(doc(fs, "poster_votes", "alice")));
  await assertFails(getDoc(doc(fs, "poster_votes", "bob")));
});

test("only an organizer can list the ballots", async () => {
  await seedWorld();
  await seedAdmin(env, "boss");
  await assertFails(getDocs(collection(asUser(env, "alice"), "poster_votes")));
  await assertSucceeds(getDocs(collection(asUser(env, "boss"), "poster_votes")));
});

test("a voter can withdraw while open, but not after it closes", async () => {
  await seedWorld();
  await seed(env, (fs) => setDoc(doc(fs, "poster_votes", "alice"),
    { posterId: "bob", edition: "pints2026" }));
  await assertSucceeds(deleteDoc(doc(asUser(env, "alice"), "poster_votes", "alice")));

  await seed(env, async (fs) => {
    await setDoc(doc(fs, "poster_votes", "alice"), { posterId: "bob", edition: "pints2026" });
    await setDoc(doc(fs, "config", "site"), { edition: "pints2026", votingOpen: false });
  });
  await assertFails(deleteDoc(doc(asUser(env, "alice"), "poster_votes", "alice")));
});

test("an organizer can clear any ballot, open or closed", async () => {
  await seedWorld({ votingOpen: false });
  await seedAdmin(env, "boss");
  await seed(env, (fs) => setDoc(doc(fs, "poster_votes", "alice"),
    { posterId: "bob", edition: "pints2026" }));
  await assertSucceeds(deleteDoc(doc(asUser(env, "boss"), "poster_votes", "alice")));
});

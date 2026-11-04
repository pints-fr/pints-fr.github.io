import test from "node:test";
import assert from "node:assert/strict";
import {
  ballotRows, canVoteFor, eligiblePosters, isPosterAuthor, nameKey, posterLabel, tallyVotes,
  votingOpen, votingStats,
} from "../js/vote-utils.mjs";

const poster = (id, posterNumber, over = {}) =>
  ({ id, type: "poster", posterNumber, title: `Poster ${id}`, authors: [{ name: id }], ...over });
const talk = (id) => ({ id, type: "talk", title: `Talk ${id}` });

test("votingOpen fails closed", () => {
  assert.equal(votingOpen(null), false);
  assert.equal(votingOpen({}), false);
  assert.equal(votingOpen({ votingOpen: "yes" }), false);
  assert.equal(votingOpen({ votingOpen: true }), true);
});

const me = { uid: "me", name: "Zoé Martin" };

test("eligiblePosters drops talks and the voter's own poster, in board order", () => {
  const list = [poster("c", 3), talk("t"), poster("a", 1), poster("me", 2)];
  assert.deepEqual(eligiblePosters(list, me).map((p) => p.id), ["a", "c"]);
  assert.deepEqual(eligiblePosters(undefined, me), []);
});

test("eligiblePosters drops posters the voter co-authored", () => {
  const coAuthored = poster("b", 2, { authors: [{ name: "Bea" }, { name: "Zoe  MARTIN" }] });
  const list = [poster("a", 1), coAuthored];
  assert.deepEqual(eligiblePosters(list, me).map((p) => p.id), ["a"]);
});

test("canVoteFor mirrors eligiblePosters for one abstract", () => {
  assert.equal(canVoteFor(poster("a", 1), me), true);
  assert.equal(canVoteFor(poster("me", 1), me), false);
  assert.equal(canVoteFor(poster("a", 1, { authors: [{ name: "zoe martin" }] }), me), false);
  assert.equal(canVoteFor(talk("t"), me), false);
  assert.equal(canVoteFor(poster("a", 1), null), false);
  assert.equal(canVoteFor(poster("a", 1), { uid: null, name: "Zoé Martin" }), false);
});

test("nameKey ignores case, accents, hyphens and spacing but not initials", () => {
  assert.equal(nameKey("  Jean-Pierre   Dupré "), "jean pierre dupre");
  assert.equal(nameKey("JEAN PIERRE DUPRE"), "jean pierre dupre");
  assert.notEqual(nameKey("J. Dupré"), nameKey("Jean Dupré"));
  assert.equal(nameKey(undefined), "");
});

test("isPosterAuthor: submitter by uid, co-author by name, nobody on an empty name", () => {
  const p = poster("sub", 1, { authors: [{ name: "Sub" }, { name: "Zoé Martin" }] });
  assert.equal(isPosterAuthor(p, { uid: "sub", name: "Someone Else" }), true);
  assert.equal(isPosterAuthor(p, me), true);
  assert.equal(isPosterAuthor(p, { uid: "x", name: "Other Person" }), false);
  assert.equal(isPosterAuthor(poster("a", 1, { authors: [{ name: "" }] }), { uid: "x", name: "" }),
    false);
  assert.equal(isPosterAuthor(undefined, me), false);
});

test("posterLabel names a poster, or says it is gone", () => {
  assert.equal(posterLabel(poster("a", 4)), "P4 · Poster a");
  assert.equal(posterLabel(poster("a", 4, { posterSession: 2 })), "P2-4 · Poster a");
  assert.equal(posterLabel({ title: "No number" }), "No number");
  assert.match(posterLabel(null), /no longer listed/);
});

test("tallyVotes ranks by count, keeps zero-vote posters, and shares ranks on ties", () => {
  const posters = [poster("a", 1), poster("b", 2), poster("c", 3), poster("d", 4), talk("t")];
  const votes = [
    { id: "v1", posterId: "b" }, { id: "v2", posterId: "b" },
    { id: "v3", posterId: "c" }, { id: "v4", posterId: "a" },
  ];
  const { rows, orphaned, counted } = tallyVotes(votes, posters);
  assert.equal(counted, 4);
  assert.deepEqual(orphaned, []);
  assert.deepEqual(rows.map((r) => [r.poster.id, r.count, r.rank, r.tied]), [
    ["b", 2, 1, false],
    ["a", 1, 2, true],
    ["c", 1, 2, true],
    ["d", 0, 4, false],
  ]);
  assert.equal(rows[0].share, 0.5);
  assert.deepEqual(rows[0].voters, ["v1", "v2"]);
});

test("tallyVotes sets aside ballots for posters that are gone", () => {
  const { rows, orphaned, counted } = tallyVotes(
    [{ id: "v1", posterId: "a" }, { id: "v2", posterId: "gone" }, { id: "v3", posterId: "t" }],
    [poster("a", 1), talk("t")]);
  assert.equal(counted, 1);
  assert.deepEqual(orphaned.map((v) => v.id), ["v2", "v3"]);
  assert.equal(rows[0].share, 1);
});

test("a tie for first is flagged", () => {
  const { rows } = tallyVotes(
    [{ id: "v1", posterId: "a" }, { id: "v2", posterId: "b" }],
    [poster("a", 1), poster("b", 2)]);
  assert.deepEqual(rows.map((r) => [r.rank, r.tied]), [[1, true], [1, true]]);
});

test("votingStats reports turnout over registered participants", () => {
  const posters = [poster("a", 1), poster("b", 2)];
  const votes = [{ id: "u1", posterId: "a" }, { id: "u2", posterId: "gone" }];
  const stats = votingStats(votes, [{ id: "u1" }, { id: "u2" }, { id: "u3" }, { id: "u4" }],
    tallyVotes(votes, posters));
  assert.deepEqual(stats, {
    cast: 2, registered: 4, turnout: 0.5, postersWithVotes: 1, candidates: 2, orphaned: 1,
  });
  assert.equal(votingStats([], [], tallyVotes([], [])).turnout, 0);
});

test("ballotRows joins voter and poster, ordered by poster then voter", () => {
  const rows = ballotRows(
    [{ id: "u2", posterId: "b" }, { id: "u1", posterId: "b" }, { id: "u3", posterId: "a" },
      { id: "ghost", posterId: "gone" }],
    [{ id: "u1", displayName: "Zed", email: "z@x" }, { id: "u2", displayName: "Amy" },
      { id: "u3", displayName: "Bob" }],
    [poster("a", 1), poster("b", 2)]);
  assert.deepEqual(rows.map((r) => [r.posterNumber, r.voterName]), [
    ["P1", "Bob"], ["P2", "Amy"], ["P2", "Zed"], ["", "(no profile)"],
  ]);
  assert.equal(rows[3].posterTitle, "(no longer listed)");
});

test("ballotRows flags a ballot for a poster the voter is an author of", () => {
  const rows = ballotRows(
    [{ id: "u1", posterId: "a" }, { id: "u2", posterId: "a" }],
    [{ id: "u1", displayName: "Zoé Martin" }, { id: "u2", displayName: "Amy" }],
    [poster("a", 1, { authors: [{ name: "a" }, { name: "Zoe Martin" }] })]);
  assert.deepEqual(rows.map((r) => [r.voterName, r.ownPoster]),
    [["Amy", false], ["Zoé Martin", true]]);
});

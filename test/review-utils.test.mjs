import test from "node:test";
import assert from "node:assert/strict";
import {
  countReviewNotes, describeReviewStats, isScore, myScore, myScoreSummary, reviewScoreMatrix,
  reviewStats, reviewerLabels, reviewerList, scoreOptions, sortByMeanScore, sortByTitle,
  summariseScore,
} from "../js/review-utils.mjs";
import { toCsv } from "../js/csv-utils.mjs";

test("only whole numbers 1 to 10 count as a score", () => {
  for (const good of [1, 5, 10]) assert.equal(isScore(good), true, `${good}`);
  for (const bad of [0, 11, -1, 7.5, "8", null, undefined, NaN]) {
    assert.equal(isScore(bad), false, String(bad));
  }
  assert.deepEqual(scoreOptions(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("reviewStats averages the scores and rounds to one decimal", () => {
  const stats = reviewStats({
    olivia: { score: 7 }, boss: { score: 8 }, kai: { score: 7 },
  });
  assert.equal(stats.count, 3);
  assert.equal(stats.mean, 7.3);
});

test("reviewStats treats a note without a score as a review, not a zero", () => {
  const stats = reviewStats({
    olivia: { score: 9, note: "strong" },
    boss: { note: "conflict of interest, abstaining" },
  });
  assert.equal(stats.entries.length, 2, "both organizers reviewed it");
  assert.equal(stats.count, 1, "only one of them scored it");
  assert.equal(stats.mean, 9, "the abstention must not drag the mean down");
});

// Junk can only get in by hand-editing the document, but a mean is the kind of
// number people act on, so it must not quietly absorb one.
test("reviewStats drops entries with neither a valid score nor a note", () => {
  const stats = reviewStats({
    olivia: { score: 42 },
    boss: { score: "9" },
    kai: { score: null, note: "   " },
    ada: { score: 6 },
    zoe: { score: 99, note: "typo in my score, meant 9" },
  });
  assert.equal(stats.count, 1);
  assert.equal(stats.mean, 6);
  assert.deepEqual(stats.entries.map((e) => e.uid), ["ada", "zoe"],
    "a junk score with a note survives as a note; a junk score alone does not");
  assert.equal(stats.entries.find((e) => e.uid === "zoe").score, null);
});

test("reviewStats on nothing at all", () => {
  for (const empty of [undefined, null, {}]) {
    const stats = reviewStats(empty);
    assert.deepEqual(stats, { entries: [], count: 0, mean: null });
  }
});

test("describeReviewStats says something useful either way", () => {
  assert.equal(describeReviewStats(reviewStats({}), 4), "Not scored yet.");
  assert.equal(describeReviewStats(reviewStats({ a: { score: 8 } }), 4),
    "Mean 8.0 · 1 of 4 organizers scored");
  assert.equal(describeReviewStats(reviewStats({ a: { score: 8 } }), 1),
    "Mean 8.0 · 1 of 1 organizer scored");
});

test("reviewerList prefers a real name, then an email, then the uid", () => {
  const users = new Map([["olivia", { displayName: "Olivia Nero" }]]);
  assert.deepEqual(
    reviewerList([
      { id: "zed", email: "zed@ens.psl.eu" },
      { id: "olivia", email: "olivia@ens.psl.eu" },
      { id: "ghost" },
    ], users),
    [
      { uid: "ghost", name: "ghost" },
      { uid: "olivia", name: "Olivia Nero" },
      { uid: "zed", name: "zed@ens.psl.eu" },
    ]);
});

const reviewers = [{ uid: "boss", name: "Ada Boss" }, { uid: "olivia", name: "Olivia Nero" }];

const annotated = [
  {
    id: "alice", title: "Recurrent dynamics", topic: "systems",
    status: "accepted", publicType: "talk", submitterName: "Alice Dupont",
  },
  {
    id: "bob", title: "Grid cells", topic: "cognitive",
    status: "submitted", publicType: null, submitterName: "Bob Martin",
  },
];

const reviewsById = new Map([
  ["alice", { reviews: { boss: { score: 9 }, olivia: { score: 8, note: "clear and novel" } } }],
  ["bob", { reviews: { boss: { score: 4 } } }],
]);

test("reviewScoreMatrix gives every organizer an anonymous score and comment column", () => {
  const { columns } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  assert.deepEqual(columns.map((c) => c.label), [
    "Title", "Topic", "Status", "Presentation", "Submitted by",
    "Reviewer 1 score", "Reviewer 1 comment", "Reviewer 2 score", "Reviewer 2 comment",
    "Mean", "Scores",
  ]);
});

test("reviewScoreMatrix headers never carry a reviewer's name", () => {
  const { columns } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  for (const name of ["Ada", "Boss", "Olivia", "Nero"]) {
    assert.ok(!columns.some((c) => c.label.includes(name)), name);
  }
});

test("reviewScoreMatrix puts each organizer's comment beside their score", () => {
  const { rows } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  assert.equal(rows[0]["c:olivia"], "clear and novel");
  assert.equal(rows[0]["c:boss"], "", "a score without a note leaves the comment blank");
  assert.equal(rows[1]["c:olivia"], "");
});

test("reviewScoreMatrix leaves a reviewer's cell blank when they have not scored", () => {
  const { rows } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  assert.equal(rows[0]["r:boss"], 9);
  assert.equal(rows[0]["r:olivia"], 8);
  assert.equal(rows[0].mean, 8.5);
  assert.equal(rows[1]["r:olivia"], "", "Olivia has not scored this one");
  assert.equal(rows[1].count, 1);
});

test("an organizer who has scored nothing still gets a column", () => {
  const { columns, rows } = reviewScoreMatrix(annotated, {
    reviewsById,
    reviewers: [...reviewers, { uid: "ghost", name: "Never Reviews" }],
  });
  assert.ok(columns.some((c) => c.key === "r:ghost"));
  assert.equal(rows[0]["r:ghost"], "");
});

test("an unreviewed abstract still gets a row", () => {
  const { rows } = reviewScoreMatrix(annotated, { reviewsById: new Map(), reviewers });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mean, "");
  assert.equal(rows[0].count, 0);
});

test("the matrix feeds toCsv unchanged", () => {
  const { columns, rows } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  const csv = toCsv(rows, columns);
  const [header, first] = csv.trim().split("\r\n");
  assert.equal(header, "Title,Topic,Status,Presentation,Submitted by,"
    + "Reviewer 1 score,Reviewer 1 comment,Reviewer 2 score,Reviewer 2 comment,Mean,Scores");
  assert.equal(first, "Recurrent dynamics,systems,accepted,talk,Alice Dupont,9,,8,clear and novel,8.5,2");
});

test("summariseScore fits the mean and the count into a list row", () => {
  assert.equal(summariseScore({ mean: 7.3, count: 3 }), "7.3 · 3 scored");
  assert.equal(summariseScore({ mean: 9, count: 1 }), "9.0 · 1 scored");
});

test("summariseScore says so when nobody has scored", () => {
  assert.equal(summariseScore({ mean: null, count: 0 }), "not scored");
  assert.equal(summariseScore({}), "not scored");
  assert.equal(summariseScore(), "not scored");
});

test("summariseScore takes reviewStats output directly", () => {
  const stats = reviewStats({ a: { score: 8 }, b: { score: 7 }, c: { note: "no number" } });
  // Three organizers said something, two put a number on it.
  assert.equal(summariseScore(stats), "7.5 · 2 scored");
});

const scored = (pairs) => new Map(Object.entries(pairs).map(([id, scores]) => [
  id,
  { reviews: Object.fromEntries(scores.map((score, i) => [`r${i}`, { score }])) },
]));

test("sortByMeanScore puts the best first", () => {
  const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  const reviewsById = scored({ a: [5, 5], b: [9, 8], c: [7] });
  assert.deepEqual(sortByMeanScore(list, { reviewsById }).map((x) => x.id), ["b", "c", "a"]);
});

test("sortByMeanScore reverses on request", () => {
  const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  const reviewsById = scored({ a: [5, 5], b: [9, 8], c: [7] });
  assert.deepEqual(
    sortByMeanScore(list, { reviewsById, direction: "asc" }).map((x) => x.id),
    ["a", "c", "b"]);
});

test("sortByMeanScore keeps unscored abstracts last in BOTH directions", () => {
  // "No score" is not a low score: ascending must not bury the worst-rated
  // abstract under everything nobody has looked at yet.
  const list = [{ id: "none", title: "Unscored" }, { id: "low", title: "Low" },
    { id: "high", title: "High" }];
  const reviewsById = scored({ low: [2], high: [9] });
  assert.deepEqual(sortByMeanScore(list, { reviewsById }).map((x) => x.id),
    ["high", "low", "none"]);
  assert.deepEqual(sortByMeanScore(list, { reviewsById, direction: "asc" }).map((x) => x.id),
    ["low", "high", "none"]);
});

test("sortByMeanScore breaks ties on title, so renders are stable", () => {
  const list = [{ id: "b", title: "Beta" }, { id: "a", title: "Alpha" }];
  const reviewsById = scored({ a: [7], b: [7] });
  assert.deepEqual(sortByMeanScore(list, { reviewsById }).map((x) => x.id), ["a", "b"]);
  // Unscored ties too.
  assert.deepEqual(sortByMeanScore(list, { reviewsById: new Map() }).map((x) => x.id),
    ["a", "b"]);
});

test("sortByMeanScore ignores notes without a number", () => {
  const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
  const reviewsById = new Map([
    ["a", { reviews: { r0: { note: "interesting" } } }],
    ["b", { reviews: { r0: { score: 4 } } }],
  ]);
  // `a` has an opinion but no vote, so it sorts as unscored.
  assert.deepEqual(sortByMeanScore(list, { reviewsById }).map((x) => x.id), ["b", "a"]);
});

test("sortByMeanScore does not mutate its input, and survives nothing", () => {
  const list = [{ id: "b", title: "B" }, { id: "a", title: "A" }];
  sortByMeanScore(list, { reviewsById: new Map() });
  assert.deepEqual(list.map((x) => x.id), ["b", "a"]);
  assert.deepEqual(sortByMeanScore([]), []);
  assert.deepEqual(sortByMeanScore(null), []);
});

test("sortByTitle is alphabetical and case-insensitive", () => {
  const list = [{ title: "beta" }, { title: "Alpha" }, { title: "Gamma" }];
  assert.deepEqual(sortByTitle(list).map((x) => x.title), ["Alpha", "beta", "Gamma"]);
});

// ------------------------------------------------------------ anonymity

test("reviewerLabels numbers organizers by uid, not by name", () => {
  // Name order is Ada Zed, Bea Adams; uid order is "aaa", "zzz". Numbering by
  // name would make "Reviewer 1" the alphabetically first organizer everywhere.
  const labels = reviewerLabels([
    { uid: "zzz", name: "Ada Zed" }, { uid: "aaa", name: "Bea Adams" },
  ]);
  assert.equal(labels.get("aaa"), "Reviewer 1");
  assert.equal(labels.get("zzz"), "Reviewer 2");
});

test("reviewerLabels numbers a former organizer's review after the current ones", () => {
  const labels = reviewerLabels(reviewers, new Map([
    ["x", { reviews: { aaron: { score: 3 }, boss: { score: 5 } } }],
  ]));
  assert.deepEqual([...labels], [
    ["boss", "Reviewer 1"], ["olivia", "Reviewer 2"], ["aaron", "Reviewer 3"],
  ]);
});

test("myScore and myScoreSummary read only the one organizer's slot", () => {
  const reviews = { boss: { score: 9 }, olivia: { note: "no number" } };
  assert.equal(myScore(reviews, "boss"), 9);
  assert.equal(myScore(reviews, "olivia"), null);
  assert.equal(myScore(undefined, "boss"), null);
  assert.equal(myScoreSummary(reviews, "boss"), "your score 9");
  assert.equal(myScoreSummary(reviews, "olivia"), "not scored by you");
});

test("sortByMeanScore with a uid sorts by that organizer's score, not the mean", () => {
  const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  const byId = new Map([
    // The mean puts "a" first (8.5 vs 6); boss's own scores put "b" first.
    ["a", { reviews: { boss: { score: 7 }, olivia: { score: 10 } } }],
    ["b", { reviews: { boss: { score: 9 }, olivia: { score: 3 } } }],
    ["c", { reviews: { olivia: { score: 10 } } }],
  ]);
  assert.deepEqual(sortByMeanScore(list, { reviewsById: byId }).map((a) => a.id), ["c", "a", "b"]);
  assert.deepEqual(
    sortByMeanScore(list, { reviewsById: byId, uid: "boss" }).map((a) => a.id),
    ["b", "a", "c"], "c is unscored by boss, so it goes last");
  assert.deepEqual(
    sortByMeanScore(list, { reviewsById: byId, uid: "boss", direction: "asc" }).map((a) => a.id),
    ["a", "b", "c"]);
});

test("countReviewNotes counts every non-blank comment, legacy ones included", () => {
  assert.deepEqual(countReviewNotes(new Map([
    ["a", { reviews: { boss: { score: 7, note: "fine" }, olivia: { note: "  " } } }],
    ["b", { note: "old shared note", reviews: { boss: { note: "weak" } } }],
    ["c", { reviews: { boss: { score: 4 } } }],
  ])), { notes: 3, abstracts: 2 });
  assert.deepEqual(countReviewNotes(new Map()), { notes: 0, abstracts: 0 });
});

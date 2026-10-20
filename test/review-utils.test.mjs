import test from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_LABELS, countReviews, describeReviewStats, isRetiredScore, isScore, myScore,
  myScoreSummary, reviewScoreMatrix, reviewStats, reviewerLabels, reviewerList, scoreLabel,
  scoreOptions, sortByMeanScore, sortByTitle, summariseScore,
} from "../js/review-utils.mjs";
import { toCsv } from "../js/csv-utils.mjs";

test("only whole numbers 1 to 4 count as a score", () => {
  for (const good of [1, 2, 3, 4]) assert.equal(isScore(good), true, `${good}`);
  for (const bad of [0, 5, 10, -1, 2.5, "3", null, undefined, NaN]) {
    assert.equal(isScore(bad), false, String(bad));
  }
  assert.deepEqual(scoreOptions(), [1, 2, 3, 4]);
});

test("every score has its word, and 1 is the veto", () => {
  assert.deepEqual(scoreOptions().map((n) => SCORE_LABELS[n]),
    ["veto: reject", "ok", "good", "accept"]);
  assert.equal(scoreLabel(1), "1 (veto: reject)");
  assert.equal(scoreLabel(3), "3 (good)");
  assert.equal(scoreLabel(7), "", "an old ten-point score has no word on this scale");
  assert.equal(scoreLabel(null), "");
});

test("a 5 to 10 is recognised as a score from the old ten-point scale", () => {
  for (const old of [5, 7, 10]) assert.equal(isRetiredScore(old), true, `${old}`);
  for (const not of [1, 4, 11, 42, null, "7"]) assert.equal(isRetiredScore(not), false, `${not}`);
});

test("reviewStats averages the scores and rounds to one decimal", () => {
  const stats = reviewStats({
    olivia: { score: 3 }, boss: { score: 4 }, kai: { score: 3 },
  });
  assert.equal(stats.count, 3);
  assert.equal(stats.mean, 3.3);
});

test("reviewStats treats a note without a score as a review, not a zero", () => {
  const stats = reviewStats({
    olivia: { score: 3, note: "strong" },
    boss: { note: "conflict of interest, abstaining" },
  });
  assert.equal(stats.entries.length, 2, "both organizers reviewed it");
  assert.equal(stats.count, 1, "only one of them scored it");
  assert.equal(stats.mean, 3, "the abstention must not drag the mean down");
});

// Junk can only get in by hand-editing the document, but a mean is the kind of
// number people act on, so it must not quietly absorb one.
test("reviewStats drops entries with neither a valid score nor a note", () => {
  const stats = reviewStats({
    olivia: { score: 42 },
    boss: { score: "3" },
    kai: { score: null, note: "   " },
    ada: { score: 2 },
    zoe: { score: 99, note: "typo in my score, meant 3" },
    // From the old ten-point scale: a 7 there is not a 7 here, or anything else.
    sam: { score: 7 },
  });
  assert.equal(stats.count, 1);
  assert.equal(stats.mean, 2);
  assert.deepEqual(stats.entries.map((e) => e.uid), ["ada", "zoe"],
    "a junk score with a note survives as a note; a junk score alone does not");
  assert.equal(stats.entries.find((e) => e.uid === "zoe").score, null);
});

test("reviewStats on nothing at all", () => {
  for (const empty of [undefined, null, {}]) {
    const stats = reviewStats(empty);
    assert.deepEqual(stats, { entries: [], count: 0, mean: null, vetoes: 0 });
  }
});

test("describeReviewStats says something useful either way", () => {
  assert.equal(describeReviewStats(reviewStats({}), 4), "Not scored yet.");
  assert.equal(describeReviewStats(reviewStats({ a: { score: 3 } }), 4),
    "Mean 3.0 · 1 of 4 organizers scored");
  assert.equal(describeReviewStats(reviewStats({ a: { score: 3 } }), 1),
    "Mean 3.0 · 1 of 1 organizer scored");
});

// Three accepts and a veto average 3.3 — "good" — about an abstract one
// organizer rejected outright. The mean alone must not be the whole story.
test("a veto is counted on its own, because the mean hides it", () => {
  const stats = reviewStats({ a: { score: 4 }, b: { score: 4 }, c: { score: 4 }, d: { score: 1 } });
  assert.equal(stats.vetoes, 1);
  assert.equal(describeReviewStats(stats, 4), "Mean 3.3 · 4 of 4 organizers scored · 1 veto");
  assert.equal(summariseScore(stats), "3.3 · 4 scored · 1 veto");
  assert.equal(summariseScore(reviewStats({ a: { score: 1 }, b: { score: 1 } })),
    "1.0 · 2 scored · 2 vetoes");
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
  ["alice", { reviews: { boss: { score: 4 }, olivia: { score: 3, note: "clear and novel" } } }],
  ["bob", { reviews: { boss: { score: 1 } } }],
]);

test("reviewScoreMatrix gives every organizer an anonymous score and comment column", () => {
  const { columns } = reviewScoreMatrix(annotated, { reviewsById, reviewers });
  assert.deepEqual(columns.map((c) => c.label), [
    "Title", "Topic", "Status", "Presentation", "Submitted by",
    "Reviewer 1 score", "Reviewer 1 comment", "Reviewer 2 score", "Reviewer 2 comment",
    "Mean", "Scores", "Vetoes",
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
  assert.equal(rows[0]["r:boss"], 4);
  assert.equal(rows[0]["r:olivia"], 3);
  assert.equal(rows[0].mean, 3.5);
  assert.equal(rows[0].vetoes, 0);
  assert.equal(rows[1]["r:olivia"], "", "Olivia has not scored this one");
  assert.equal(rows[1].count, 1);
  assert.equal(rows[1].vetoes, 1);
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
    + "Reviewer 1 score,Reviewer 1 comment,Reviewer 2 score,Reviewer 2 comment,Mean,Scores,Vetoes");
  assert.equal(first, "Recurrent dynamics,systems,accepted,talk,Alice Dupont,4,,3,clear and novel,3.5,2,0");
});

test("summariseScore fits the mean and the count into a list row", () => {
  assert.equal(summariseScore({ mean: 2.3, count: 3 }), "2.3 · 3 scored");
  assert.equal(summariseScore({ mean: 4, count: 1 }), "4.0 · 1 scored");
});

test("summariseScore says so when nobody has scored", () => {
  assert.equal(summariseScore({ mean: null, count: 0 }), "not scored");
  assert.equal(summariseScore({}), "not scored");
  assert.equal(summariseScore(), "not scored");
});

test("summariseScore takes reviewStats output directly", () => {
  const stats = reviewStats({ a: { score: 4 }, b: { score: 3 }, c: { note: "no number" } });
  // Three organizers said something, two put a number on it.
  assert.equal(summariseScore(stats), "3.5 · 2 scored");
});

const scored = (pairs) => new Map(Object.entries(pairs).map(([id, scores]) => [
  id,
  { reviews: Object.fromEntries(scores.map((score, i) => [`r${i}`, { score }])) },
]));

test("sortByMeanScore puts the best first", () => {
  const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  const reviewsById = scored({ a: [2, 2], b: [4, 3], c: [3] });
  assert.deepEqual(sortByMeanScore(list, { reviewsById }).map((x) => x.id), ["b", "c", "a"]);
});

test("sortByMeanScore reverses on request", () => {
  const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  const reviewsById = scored({ a: [2, 2], b: [4, 3], c: [3] });
  assert.deepEqual(
    sortByMeanScore(list, { reviewsById, direction: "asc" }).map((x) => x.id),
    ["a", "c", "b"]);
});

test("sortByMeanScore keeps unscored abstracts last in BOTH directions", () => {
  // "No score" is not a low score: ascending must not bury the worst-rated
  // abstract under everything nobody has looked at yet.
  const list = [{ id: "none", title: "Unscored" }, { id: "low", title: "Low" },
    { id: "high", title: "High" }];
  const reviewsById = scored({ low: [2], high: [4] });
  assert.deepEqual(sortByMeanScore(list, { reviewsById }).map((x) => x.id),
    ["high", "low", "none"]);
  assert.deepEqual(sortByMeanScore(list, { reviewsById, direction: "asc" }).map((x) => x.id),
    ["low", "high", "none"]);
});

test("sortByMeanScore breaks ties on title, so renders are stable", () => {
  const list = [{ id: "b", title: "Beta" }, { id: "a", title: "Alpha" }];
  const reviewsById = scored({ a: [3], b: [3] });
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
    ["x", { reviews: { aaron: { score: 3 }, boss: { score: 2 } } }],
  ]));
  assert.deepEqual([...labels], [
    ["boss", "Reviewer 1"], ["olivia", "Reviewer 2"], ["aaron", "Reviewer 3"],
  ]);
});

test("myScore and myScoreSummary read only the one organizer's slot", () => {
  const reviews = { boss: { score: 3 }, olivia: { note: "no number" }, kai: { score: 7 } };
  assert.equal(myScore(reviews, "boss"), 3);
  assert.equal(myScore(reviews, "olivia"), null);
  assert.equal(myScore(reviews, "kai"), null, "an old ten-point score is not a score");
  assert.equal(myScore(undefined, "boss"), null);
  assert.equal(myScoreSummary(reviews, "boss"), "your score 3 (good)");
  assert.equal(myScoreSummary(reviews, "kai"), "not scored by you");
  assert.equal(myScoreSummary(reviews, "olivia"), "not scored by you");
});

test("sortByMeanScore with a uid sorts by that organizer's score, not the mean", () => {
  const list = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  const byId = new Map([
    // The mean puts "a" above "b" (3 vs 2); boss's own scores put "b" first.
    ["a", { reviews: { boss: { score: 2 }, olivia: { score: 4 } } }],
    ["b", { reviews: { boss: { score: 3 }, olivia: { score: 1 } } }],
    ["c", { reviews: { olivia: { score: 4 } } }],
  ]);
  assert.deepEqual(sortByMeanScore(list, { reviewsById: byId }).map((a) => a.id), ["c", "a", "b"]);
  assert.deepEqual(
    sortByMeanScore(list, { reviewsById: byId, uid: "boss" }).map((a) => a.id),
    ["b", "a", "c"], "c is unscored by boss, so it goes last");
  assert.deepEqual(
    sortByMeanScore(list, { reviewsById: byId, uid: "boss", direction: "asc" }).map((a) => a.id),
    ["a", "b", "c"]);
});

test("countReviews counts every score or comment, legacy ones included", () => {
  assert.deepEqual(countReviews(new Map([
    ["a", { reviews: { boss: { score: 3, note: "fine" }, olivia: { note: "  " } } }],
    ["b", { note: "old shared note", reviews: { boss: { note: "weak" } } }],
    ["c", { reviews: { boss: { score: 4 } } }],
    ["d", { reviews: { kai: { score: 7 } } }],
    ["e", { reviews: { kai: { score: null, note: "" } }, decidedBy: "boss" }],
  ])), { reviews: 5, abstracts: 4 });
  assert.deepEqual(countReviews(new Map()), { reviews: 0, abstracts: 0 });
});

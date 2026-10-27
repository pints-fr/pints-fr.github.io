import test from "node:test";
import assert from "node:assert/strict";
import {
  authorLineParts,
  displayOrder,
  draftFingerprint,
  filterAbstracts,
  filterAdminAbstracts,
  groupByTopic,
  inReview,
  nextPosterNumber,
  ownerCan,
  posterNumbering,
  presenterOf,
  publicFields,
  publicMode,
  sortPublicAbstracts,
  submissionWindows,
  submissionStatusLabel,
  submissionStatusTone,
  summaryAuthorLine,
} from "../js/abstract-utils.mjs";

test("authorLineParts renders 1-based affiliation marks", () => {
  assert.deepEqual(
    authorLineParts([
      { name: " Alice Dupont ", affiliationIndexes: [0], presenting: true },
      { name: "Bob Martin", affiliationIndexes: [0, 1], presenting: false },
      { name: "Cleo Ba", affiliationIndexes: [], presenting: false },
    ]),
    [
      { name: "Alice Dupont", marks: "1", presenting: true },
      { name: "Bob Martin", marks: "1,2", presenting: false },
      { name: "Cleo Ba", marks: "", presenting: false },
    ],
  );
});

test("authorLineParts tolerates missing input", () => {
  assert.deepEqual(authorLineParts(undefined), []);
  assert.deepEqual(authorLineParts([{}]), [{ name: "", marks: "", presenting: false }]);
});

test("nextPosterNumber starts at 1 and fills after the highest", () => {
  assert.equal(nextPosterNumber([]), 1);
  assert.equal(nextPosterNumber(undefined), 1);
  assert.equal(nextPosterNumber([{ posterNumber: 1 }, { posterNumber: 4 }]), 5);
  assert.equal(nextPosterNumber([{ posterNumber: null }, { posterNumber: 2 }]), 3);
});

test("filterAbstracts matches title, author names, affiliations, and body", () => {
  const list = [
    {
      title: "Recurrent dynamics", body: "V1 recordings",
      authors: [{ name: "Alice Dupont" }], affiliations: ["ENS"],
    },
    {
      title: "Dendritic computation", body: "modelling",
      authors: [{ name: "Bob Martin" }], affiliations: ["Sorbonne"],
    },
  ];
  assert.equal(filterAbstracts(list, "recurrent").length, 1);
  assert.equal(filterAbstracts(list, "DUPONT").length, 1);
  assert.equal(filterAbstracts(list, "modelling").length, 1);
  assert.equal(filterAbstracts(list, "sorbonne").length, 1);
  assert.equal(filterAbstracts(list, "").length, 2);
  assert.equal(filterAbstracts(list, "   ").length, 2);
  assert.equal(filterAbstracts(list, "nothing here").length, 0);
});

test("filterAbstracts does not mutate its input", () => {
  const list = [{ title: "A" }, { title: "B" }];
  filterAbstracts(list, "");
  assert.equal(list.length, 2);
});

test("sortPublicAbstracts puts talks before posters, then orders by poster number", () => {
  const sorted = sortPublicAbstracts([
    { type: "poster", posterNumber: 2, title: "B" },
    { type: "talk", posterNumber: null, title: "Z" },
    { type: "poster", posterNumber: 1, title: "A" },
    { type: "talk", posterNumber: null, title: "A" },
  ]);
  assert.deepEqual(
    sorted.map((a) => `${a.type}:${a.title}`),
    ["talk:A", "talk:Z", "poster:A", "poster:B"],
  );
});

test("sortPublicAbstracts does not mutate its input", () => {
  const input = [{ type: "poster", posterNumber: 2 }, { type: "talk" }];
  sortPublicAbstracts(input);
  assert.deepEqual(input.map((a) => a.type), ["poster", "talk"]);
});

test("groupByTopic orders groups as config declares them", () => {
  const groups = groupByTopic(
    [{ topic: "systems" }, { topic: "cognitive" }, { topic: "computational" }],
    ["cognitive", "systems", "computational"],
  );
  assert.deepEqual(groups.map((g) => g.topic), ["cognitive", "systems", "computational"]);
});

test("groupByTopic drops empty topics but keeps every abstract", () => {
  const groups = groupByTopic(
    [{ id: 1, topic: "systems" }, { id: 2, topic: "systems" }],
    ["cognitive", "systems", "computational"],
  );
  assert.deepEqual(groups.map((g) => g.topic), ["systems"]);
  assert.deepEqual(groups[0].items.map((a) => a.id), [1, 2]);
});

// An abstract the reviewers cannot see is worse than an untidy heading.
test("groupByTopic sweeps missing and unknown topics into a final bucket", () => {
  const groups = groupByTopic(
    [{ id: 1, topic: "systems" }, { id: 2 }, { id: 3, topic: "phrenology" }],
    ["cognitive", "systems", "computational"],
  );
  assert.equal(groups.at(-1).topic, null);
  assert.deepEqual(groups.at(-1).items.map((a) => a.id), [2, 3]);
});

test("groupByTopic handles an empty list and a nullish list", () => {
  assert.deepEqual(groupByTopic([], ["cognitive"]), []);
  assert.deepEqual(groupByTopic(undefined, ["cognitive"]), []);
});

// --------------------------------------------------------- draftFingerprint

const draft = () => ({
  title: "Grid cells in the dark",
  topic: "systems",
  affiliations: ["École normale supérieure", "Collège de France"],
  authors: [
    { name: "Kai Chen", affiliationIndexes: [0], presenting: true },
    { name: "A Colleague", affiliationIndexes: [0, 1], presenting: false },
  ],
  body: "We recorded from medial entorhinal cortex in darkness.",
  talkConsidered: true,
});

test("draftFingerprint matches for an unchanged draft rebuilt from the DOM", () => {
  assert.equal(draftFingerprint(draft()), draftFingerprint(draft()));
});

test("draftFingerprint ignores key order", () => {
  const a = draft();
  const b = {
    talkConsidered: true,
    body: a.body,
    authors: a.authors,
    affiliations: a.affiliations,
    topic: a.topic,
    title: a.title,
  };
  assert.equal(draftFingerprint(a), draftFingerprint(b));
});

// Whitespace the parsers already trim must not read as an unsaved change, or
// every editor would prompt on open.
test("draftFingerprint ignores whitespace the parsers strip", () => {
  const padded = draft();
  padded.title = "  Grid cells in the dark  ";
  padded.affiliations = padded.affiliations.map((a) => `  ${a} `);
  padded.authors = padded.authors.map((x) => ({ ...x, name: ` ${x.name}` }));
  assert.equal(draftFingerprint(padded), draftFingerprint(draft()));
});

test("draftFingerprint changes on every editable field", () => {
  const base = draftFingerprint(draft());
  const changed = [
    { ...draft(), title: "Grid cells in the light" },
    { ...draft(), topic: "computational" },
    { ...draft(), affiliations: [...draft().affiliations, "Sorbonne"] },
    { ...draft(), authors: [...draft().authors].reverse() },
    { ...draft(), body: `${draft().body} Then we did it again.` },
    { ...draft(), talkConsidered: false },
  ];
  for (const d of changed) assert.notEqual(draftFingerprint(d), base);
});

test("draftFingerprint distinguishes affiliation marks and the presenting author", () => {
  const base = draftFingerprint(draft());
  const remarked = draft();
  remarked.authors[0].affiliationIndexes = [0, 1];
  assert.notEqual(draftFingerprint(remarked), base);

  const represented = draft();
  represented.authors[0].presenting = false;
  represented.authors[1].presenting = true;
  assert.notEqual(draftFingerprint(represented), base);
});

test("draftFingerprint tolerates an empty draft", () => {
  assert.equal(draftFingerprint({}), draftFingerprint({ authors: [], affiliations: [] }));
});

// ------------------------------------------------------- admin console filter

const pile = [
  { id: "a", title: "Recurrent dynamics", body: "V1 recordings", topic: "systems",
    status: "accepted", publicType: "talk", talkConsidered: true,
    authors: [{ name: "Alice Dupont" }], affiliations: ["ENS"] },
  { id: "b", title: "Grid cells", body: "entorhinal", topic: "systems",
    status: "accepted", publicType: "poster", talkConsidered: false,
    authors: [{ name: "Bob Martin" }], affiliations: ["Sorbonne"] },
  { id: "c", title: "Working memory", body: "delay activity", topic: "cognitive",
    status: "submitted", publicType: null, talkConsidered: true,
    authors: [{ name: "Chloe Roy" }], affiliations: ["ENS"] },
  { id: "d", title: "Spiking networks", body: "balanced", topic: "computational",
    status: "rejected", publicType: null,
    authors: [{ name: "Dan Lee" }], affiliations: ["Inria"] },
];

const ids = (list) => list.map((a) => a.id);

test("filterAdminAbstracts with nothing set returns everything", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, {})), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile)), ["a", "b", "c", "d"]);
  assert.deepEqual(filterAdminAbstracts(undefined), []);
});

test("filterAdminAbstracts narrows by presentation type", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { type: "talk" })), ["a"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { type: "poster" })), ["b"]);
});

// "Not published yet" is the question the committee actually asks, so it is a
// choice rather than the absence of one.
test("filterAdminAbstracts can single out what has not been published", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { type: "unpublished" })), ["c", "d"]);
});

test("filterAdminAbstracts narrows by status and by topic", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { status: "accepted" })), ["a", "b"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { topic: "cognitive" })), ["c"]);
});

test("filterAdminAbstracts combines every filter with the free-text search", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { status: "accepted", topic: "systems", type: "poster" })), ["b"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { q: "dupont" })), ["a"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { q: "ens", type: "unpublished" })), ["c"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { status: "accepted", q: "nothing matches this" })), []);
});

test("filterAdminAbstracts narrows by the submitter's talk opt-out", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile, { talk: "optedout" })), ["b"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile, { talk: "considered" })), ["a", "c", "d"]);
});

// An abstract with no talkConsidered field at all was submitted before the
// question was asked. Counting that as a refusal would hide it from the very
// shortlist it belongs on.
test("a missing talk opt-out counts as willing, not as a refusal", () => {
  const legacy = [{ id: "old", title: "Legacy", authors: [], affiliations: [] }];
  assert.deepEqual(ids(filterAdminAbstracts(legacy, { talk: "considered" })), ["old"]);
  assert.deepEqual(ids(filterAdminAbstracts(legacy, { talk: "optedout" })), []);
});

test("the talk filter combines with the others", () => {
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { talk: "considered", status: "accepted" })), ["a"]);
  assert.deepEqual(ids(filterAdminAbstracts(pile,
    { talk: "optedout", type: "talk" })), [],
  "somebody who opted out and was promoted anyway would show up here");
});

test("submissionStatusLabel names the decision once one has been taken", () => {
  assert.equal(submissionStatusLabel("submitted"), "In review");
  assert.equal(submissionStatusLabel("rejected"), "Not accepted");
  assert.equal(submissionStatusLabel("accepted", { type: "talk" }), "Accepted as a talk");
  assert.equal(submissionStatusLabel("accepted", { type: "poster" }), "Accepted as a poster");
  assert.equal(
    submissionStatusLabel("accepted", { type: "poster", posterNumber: 12 }),
    "Accepted as poster P12");
});

test("submissionStatusLabel says only 'Accepted' with no published copy to read", () => {
  assert.equal(submissionStatusLabel("accepted"), "Accepted");
  assert.equal(submissionStatusLabel("accepted", null), "Accepted");
  assert.equal(submissionStatusLabel("accepted", { type: "poster", posterNumber: "3" }),
    "Accepted as a poster");
});

test("submissionStatusLabel under-claims on anything it does not recognise", () => {
  for (const odd of ["", null, undefined, "banquet"]) {
    assert.equal(submissionStatusLabel(odd), "In review");
  }
});

test("summaryAuthorLine names the presenting author", () => {
  const authors = [
    { name: "Liang Wei" },
    { name: "Ana Ferreira", presenting: true },
    { name: "Priya Nair" },
  ];
  assert.equal(summaryAuthorLine(authors), "Ana Ferreira et al.");
});

test("summaryAuthorLine falls back to the first author when none is marked", () => {
  assert.equal(summaryAuthorLine([{ name: "Liang Wei" }, { name: "Priya Nair" }]),
    "Liang Wei et al.");
});

test("summaryAuthorLine drops 'et al.' for a sole author", () => {
  assert.equal(summaryAuthorLine([{ name: "Ana Ferreira", presenting: true }]), "Ana Ferreira");
  assert.equal(summaryAuthorLine([{ name: "Ana Ferreira" }]), "Ana Ferreira");
});

test("summaryAuthorLine takes the first of several marked presenting", () => {
  // Two presenters is a data error; showing one of them beats hiding the row.
  const authors = [{ name: "Ana Ferreira", presenting: true }, { name: "Liang Wei", presenting: true }];
  assert.equal(summaryAuthorLine(authors), "Ana Ferreira et al.");
});

test("summaryAuthorLine ignores blank names, including when counting", () => {
  assert.equal(summaryAuthorLine([{ name: "Ana Ferreira" }, { name: "   " }]), "Ana Ferreira");
  assert.equal(summaryAuthorLine([{ name: "  Ana Ferreira  " }]), "Ana Ferreira");
});

test("summaryAuthorLine says nothing about an abstract with no authors", () => {
  for (const empty of [[], null, undefined, [{}], [{ name: "" }]]) {
    assert.equal(summaryAuthorLine(empty), "", `expected "" for ${JSON.stringify(empty)}`);
  }
});

test("submissionStatusLabel reads a retired 'withdrawn' as In review", () => {
  // The status was removed; a document that still holds it must read as the
  // state it will normalise to on the next save, not as a fourth thing.
  assert.equal(submissionStatusLabel("withdrawn"), "In review");
  assert.equal(submissionStatusTone("withdrawn"), "review");
});

test("submissionStatusTone gives each decision its colour", () => {
  assert.equal(submissionStatusTone("submitted"), "review");
  assert.equal(submissionStatusTone("accepted"), "accepted");
  assert.equal(submissionStatusTone("rejected"), "rejected");
});

test("submissionStatusTone falls back to review, like the label", () => {
  for (const odd of ["", null, undefined, "banquet"]) {
    assert.equal(submissionStatusTone(odd), "review");
    assert.equal(submissionStatusLabel(odd), "In review");
  }
});

test("draftFingerprint notices a change of publish setting", () => {
  const base = draftFingerprint(draft());
  assert.notEqual(draftFingerprint({ ...draft(), publishChoice: "titleOnly" }), base);
  assert.notEqual(draftFingerprint({ ...draft(), publishConfirmed: true }), base);
  assert.equal(draftFingerprint({ ...draft(), publishChoice: "full" }), base);
});

// ------------------------------------------------------- submissionWindows

const NOW = new Date("2026-10-15T12:00:00Z");
const BEFORE = new Date("2026-10-20T00:00:00Z");
const PAST = new Date("2026-10-10T00:00:00Z");
// What getSiteConfig() actually hands back: Firestore Timestamps, not Dates.
const ts = (date) => ({ toDate: () => date });

test("submissionWindows: a config from before the editing window behaves as before", () => {
  assert.deepEqual(
    pick(submissionWindows({ submissionsOpen: true, submissionDeadline: ts(BEFORE) }, NOW)),
    { submitOpen: true, editOpen: true });
  assert.deepEqual(
    pick(submissionWindows({ submissionsOpen: true, submissionDeadline: ts(PAST) }, NOW)),
    { submitOpen: false, editOpen: false });
});

test("submissionWindows: editing outlives submissions until its own deadline", () => {
  const cfg = {
    submissionsOpen: true, submissionDeadline: ts(PAST),
    editingOpen: true, editingDeadline: ts(BEFORE),
  };
  assert.deepEqual(pick(submissionWindows(cfg, NOW)), { submitOpen: false, editOpen: true });
  assert.deepEqual(pick(submissionWindows({ ...cfg, editingDeadline: ts(PAST) }, NOW)),
    { submitOpen: false, editOpen: false });
  assert.deepEqual(pick(submissionWindows({ ...cfg, editingOpen: false }, NOW)),
    { submitOpen: false, editOpen: false });
});

test("submissionWindows: editing ticked without a deadline is closed, not open", () => {
  assert.equal(submissionWindows({ editingOpen: true }, NOW).editOpen, false);
});

test("submissionWindows: the submission checkbox controls only new abstracts", () => {
  const cfg = {
    submissionsOpen: false, submissionDeadline: ts(BEFORE),
    editingOpen: true, editingDeadline: ts(BEFORE),
  };
  assert.deepEqual(pick(submissionWindows(cfg, NOW)), { submitOpen: false, editOpen: true });
});

test("submissionWindows: a missing config is closed", () => {
  assert.deepEqual(pick(submissionWindows(null, NOW)), { submitOpen: false, editOpen: false });
});

function pick({ submitOpen, editOpen }) { return { submitOpen, editOpen }; }

// ----------------------------------------------------------------- ownerCan

const open = { editOpen: true };
const closed = { editOpen: false };

test("ownerCan: anything still in review can be edited and retracted while editing is open", () => {
  for (const status of ["submitted", "rejected", "withdrawn"]) {
    assert.deepEqual(ownerCan({ status }, null, open), { edit: true, retract: true });
    assert.deepEqual(ownerCan({ status }, null, closed), { edit: false, retract: false });
  }
});

test("ownerCan: an accepted poster is self-service, a talk cannot be retracted", () => {
  assert.deepEqual(ownerCan({ status: "accepted" }, { type: "poster" }, open),
    { edit: true, retract: true });
  assert.deepEqual(ownerCan({ status: "accepted" }, { type: "talk" }, open),
    { edit: true, retract: false });
  assert.deepEqual(ownerCan({ status: "accepted" }, { type: "talk" }, closed),
    { edit: false, retract: false });
});

test("ownerCan: a half-finished acceptance with no public copy stays locked", () => {
  assert.deepEqual(ownerCan({ status: "accepted" }, null, open), { edit: false, retract: false });
});

test("ownerCan: no abstract, nothing to do", () => {
  assert.deepEqual(ownerCan(null, null, open), { edit: false, retract: false });
});

// ------------------------------------------------------ publicMode / Fields

test("publicMode: a confirmed choice is honoured", () => {
  assert.equal(publicMode({ publishConfirmed: true, publishChoice: "titleOnly" }), "titleOnly");
  assert.equal(publicMode({ publishConfirmed: true, publishChoice: "full" }), "full");
  assert.equal(publicMode({ publishConfirmed: true }), "full");
});

test("publicMode: an unconfirmed choice is held back until editing closes", () => {
  const unconfirmed = { publishConfirmed: false, publishChoice: "titleOnly" };
  assert.equal(publicMode(unconfirmed), "pending");
  assert.equal(publicMode(unconfirmed, { editClosed: true }), "full");
  assert.equal(publicMode({}, { editClosed: true }), "full");
});

test("publicFields never carries the figure, and carries the body only in full mode", () => {
  const abstract = {
    ...draft(), figureUrl: "https://x/f.png", figurePath: "p", figureCaption: "c",
  };
  for (const mode of ["full", "titleOnly", "pending"]) {
    const fields = publicFields(abstract, mode);
    assert.equal("figureUrl" in fields, false);
    assert.equal("figureCaption" in fields, false);
    assert.equal(fields.publishMode, mode);
    assert.equal(fields.body, mode === "full" ? abstract.body : null);
    assert.equal(fields.title, abstract.title);
  }
});

test("displayOrder flattens topic groups, keeping order within each and Other last", () => {
  const list = [
    { id: "x", topic: "nope" },
    { id: "s1", topic: "systems" },
    { id: "c1", topic: "cognitive" },
    { id: "s2", topic: "systems" },
  ];
  assert.deepEqual(
    displayOrder(list, ["cognitive", "systems"]).map((a) => a.id),
    ["c1", "s1", "s2", "x"]);
});

test("inReview keeps undecided abstracts, including a legacy withdrawn", () => {
  const list = [
    { id: "a", status: "accepted" },
    { id: "r", status: "rejected" },
    { id: "s", status: "submitted" },
    { id: "w", status: "withdrawn" },
  ];
  assert.deepEqual(inReview(list).map((a) => a.id), ["s", "w"]);
  assert.deepEqual(inReview(null), []);
});

test("posterNumbering numbers consecutively from start", () => {
  assert.deepEqual(posterNumbering([{ id: "a" }, { id: "b" }]),
    [{ id: "a", posterNumber: 1 }, { id: "b", posterNumber: 2 }]);
  assert.deepEqual(posterNumbering([{ id: "a" }], 7), [{ id: "a", posterNumber: 7 }]);
});

test("presenterOf picks the presenting author and their first affiliation", () => {
  assert.deepEqual(presenterOf({
    affiliations: ["ENS", "Institut Pasteur"],
    authors: [
      { name: "Ana", affiliationIndexes: [0] },
      { name: " Bo ", affiliationIndexes: [1, 0], presenting: true },
    ],
  }), { speaker: "Bo", affiliation: "Institut Pasteur" });
  assert.deepEqual(presenterOf({ authors: [{ name: "Ana" }] }),
    { speaker: "Ana", affiliation: "" });
  assert.deepEqual(presenterOf({}), { speaker: "", affiliation: "" });
});

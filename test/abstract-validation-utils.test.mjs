import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAffiliationIndexes,
  parseAffiliations,
  validateAbstract,
} from "../js/abstract-validation-utils.mjs";
import { LIMITS } from "../js/config.mjs";

const good = (over = {}) => ({
  title: "Recurrent dynamics in mouse V1",
  affiliations: ["ENS", "Sorbonne"],
  authors: [
    { name: "Alice Dupont", affiliationIndexes: [0], presenting: true },
    { name: "Bob Martin", affiliationIndexes: [0, 1], presenting: false },
  ],
  body: "We recorded from mouse V1 and found *structure*.",
  topic: "systems",
  talkConsidered: true,
  hasFigure: true,
  figureCaption: "Tuning curves for 120 neurons.",
  ...over,
});

const openNow = {
  now: new Date("2026-09-01"),
  submissionsOpen: true,
  deadline: new Date("2026-10-01"),
};

test("parseAffiliations splits lines and drops blanks", () => {
  assert.deepEqual(parseAffiliations("ENS\n\n  Sorbonne  \n"), ["ENS", "Sorbonne"]);
  assert.deepEqual(parseAffiliations(""), []);
  assert.deepEqual(parseAffiliations(undefined), []);
});

test("parseAffiliationIndexes converts 1-based input to 0-based indexes", () => {
  assert.deepEqual(parseAffiliationIndexes("1,2"), [0, 1]);
  assert.deepEqual(parseAffiliationIndexes(" 3 "), [2]);
  assert.deepEqual(parseAffiliationIndexes(""), []);
  assert.deepEqual(parseAffiliationIndexes("2 1"), [1, 0]);
});

test("a well-formed abstract validates", () => {
  assert.deepEqual(validateAbstract(good(), openNow), { valid: true, errors: [] });
});

test("title and body are required", () => {
  const { errors } = validateAbstract(good({ title: "   ", body: "" }), openNow);
  assert.ok(errors.some((e) => /Title is required/.test(e)));
  assert.ok(errors.some((e) => /body is required/i.test(e)));
});

test("title and body respect the configured limits", () => {
  const { errors } = validateAbstract(
    good({ title: "x".repeat(201), body: "y".repeat(2501) }), openNow);
  assert.ok(errors.some((e) => /Title must be 200/.test(e)));
  assert.ok(errors.some((e) => /2500/.test(e)));
});

test("at least one author is required and each needs a name", () => {
  assert.ok(validateAbstract(good({ authors: [] }), openNow)
    .errors.some((e) => /At least one author/.test(e)));
  assert.ok(validateAbstract(good({
    authors: [{ name: "  ", affiliationIndexes: [], presenting: true }],
  }), openNow).errors.some((e) => /Author 1 needs a name/.test(e)));
});

test("an author cannot point at a non-existent affiliation", () => {
  const { errors } = validateAbstract(
    good({ authors: [{ name: "Alice", affiliationIndexes: [5], presenting: true }] }), openNow);
  assert.ok(errors.some((e) => /Author 1 refers to affiliation 6/.test(e)));
});

test("exactly one presenting author is required", () => {
  assert.ok(validateAbstract(good({
    authors: [{ name: "A", affiliationIndexes: [], presenting: false }],
  }), openNow).errors.some((e) => /Mark one presenting author/.test(e)));

  assert.ok(validateAbstract(good({
    authors: [
      { name: "A", affiliationIndexes: [], presenting: true },
      { name: "B", affiliationIndexes: [], presenting: true },
    ],
  }), openNow).errors.some((e) => /only one presenting author/i.test(e)));
});

test("a topic is required and must be one of the three", () => {
  assert.ok(validateAbstract(good({ topic: "quantum" }), openNow)
    .errors.some((e) => /topic/i.test(e)));
  assert.ok(validateAbstract(good({ topic: "" }), openNow)
    .errors.some((e) => /topic/i.test(e)));
  for (const topic of ["cognitive", "systems", "computational"]) {
    assert.ok(validateAbstract(good({ topic }), openNow).valid, `${topic} should validate`);
  }
});

test("figure and caption are required only while still considered for a talk", () => {
  const optedOut = { talkConsidered: false, hasFigure: false, figureCaption: "" };
  assert.ok(validateAbstract(good(optedOut), openNow).valid);

  // Missing talkConsidered counts as willing, same as everywhere else this
  // flag is read (see abstract-utils.mjs's matchesTalk), so it still needs one.
  const stillConsidered = validateAbstract(
    good({ talkConsidered: undefined, hasFigure: false, figureCaption: "" }), openNow);
  assert.equal(stillConsidered.valid, false);
  assert.ok(stillConsidered.errors.includes("A figure is required to be considered for a talk."));
});

test("submissions closed and passed deadlines are rejected", () => {
  assert.ok(validateAbstract(good(), { ...openNow, submissionsOpen: false })
    .errors.some((e) => /closed/i.test(e)));
  assert.ok(validateAbstract(good(), { ...openNow, now: new Date("2026-10-02") })
    .errors.some((e) => /deadline/i.test(e)));
});

test("too many authors or affiliations is rejected", () => {
  const authors = Array.from({ length: 21 }, (_, i) => ({
    name: `A${i}`, affiliationIndexes: [], presenting: i === 0,
  }));
  assert.ok(validateAbstract(good({ authors }), openNow).errors.some((e) => /20 authors/.test(e)));

  const affiliations = Array.from({ length: 11 }, (_, i) => `Lab ${i}`);
  assert.ok(validateAbstract(good({ affiliations }), openNow)
    .errors.some((e) => /10 affiliations/.test(e)));
});

test("validateAbstract tolerates entirely missing input", () => {
  const { valid, errors } = validateAbstract(undefined, openNow);
  assert.equal(valid, false);
  assert.ok(errors.length > 0);
});

test("a figure is required, and so is its caption", () => {
  const noFigure = validateAbstract(good({ hasFigure: false }), openNow);
  assert.equal(noFigure.valid, false);
  assert.ok(noFigure.errors.includes("A figure is required to be considered for a talk."));

  const noCaption = validateAbstract(good({ figureCaption: "   " }), openNow);
  assert.equal(noCaption.valid, false);
  assert.ok(noCaption.errors.includes("The figure needs a caption to be considered for a talk."));

  // Missing entirely, not merely blank: an older draft has neither field.
  const neither = validateAbstract(
    good({ hasFigure: undefined, figureCaption: undefined }), openNow);
  assert.equal(neither.valid, false);
  assert.equal(neither.errors.length, 2);
});

test("a caption longer than the limit is rejected", () => {
  const { valid, errors } = validateAbstract(
    good({ figureCaption: "x".repeat(LIMITS.figureCaption + 1) }), openNow);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes(`${LIMITS.figureCaption} characters or fewer`)));

  assert.equal(
    validateAbstract(good({ figureCaption: "x".repeat(LIMITS.figureCaption) }), openNow).valid,
    true);
});

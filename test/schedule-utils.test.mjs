import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDayHeading,
  formatTimeRange,
  groupScheduleBySession,
  parseTime,
  programAbstractLinks,
  romanNumeral,
  sortScheduleItems,
} from "../js/schedule-utils.mjs";

test("parseTime converts HH:MM to minutes", () => {
  assert.equal(parseTime("00:00"), 0);
  assert.equal(parseTime("09:30"), 570);
  assert.equal(parseTime("23:59"), 1439);
});

test("parseTime rejects malformed input", () => {
  for (const bad of ["", "9:30", "24:00", "12:60", "noon", null, undefined, "1230", "09:30:00"]) {
    assert.equal(parseTime(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("formatTimeRange joins start and end with an en dash", () => {
  assert.equal(formatTimeRange("09:30", "10:30"), "09:30–10:30");
  assert.equal(formatTimeRange("09:30", ""), "09:30");
  assert.equal(formatTimeRange("09:30", "bogus"), "09:30");
  assert.equal(formatTimeRange("bogus", "10:30"), "");
});

test("sortScheduleItems orders by start time", () => {
  const sorted = sortScheduleItems([
    { title: "Afternoon", start: "14:00" },
    { title: "Lunch", start: "12:30" },
    { title: "Opening", start: "09:00" },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["Opening", "Lunch", "Afternoon"]);
});

test("sortScheduleItems breaks a shared start time on the end time", () => {
  const sorted = sortScheduleItems([
    { title: "Long", start: "09:00", end: "10:00" },
    { title: "Short", start: "09:00", end: "09:15" },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["Short", "Long"]);
});

test("sortScheduleItems falls back to the title when times are identical", () => {
  const sorted = sortScheduleItems([
    { title: "Beta", start: "09:00", end: "10:00" },
    { title: "Alpha", start: "09:00", end: "10:00" },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["Alpha", "Beta"]);
});

test("sortScheduleItems pushes items with unparseable times to the end", () => {
  const sorted = sortScheduleItems([{ title: "No time" }, { title: "Timed", start: "10:00" }]);
  assert.deepEqual(sorted.map((i) => i.title), ["Timed", "No time"]);
});

test("sortScheduleItems does not mutate its input", () => {
  const input = [{ start: "12:00" }, { start: "09:00" }];
  sortScheduleItems(input);
  assert.deepEqual(input.map((i) => i.start), ["12:00", "09:00"]);
});

test("sortScheduleItems handles an empty program", () => {
  assert.deepEqual(sortScheduleItems([]), []);
});

test("formatDayHeading renders a readable date and falls back on bad input", () => {
  assert.match(formatDayHeading("2026-11-12"), /Thursday/);
  assert.match(formatDayHeading("2026-11-12"), /November/);
  assert.match(formatDayHeading("2026-11-12"), /2026/);
  assert.equal(formatDayHeading("not-a-date"), "not-a-date");
  assert.equal(formatDayHeading(""), "");
});

test("formatDayHeading is timezone-stable", () => {
  // Fixed to UTC so a late-evening local time cannot roll the date back a day.
  assert.match(formatDayHeading("2026-01-01"), /1 January 2026/);
});

test("romanNumeral covers the range a one-day program can reach", () => {
  const got = [1, 2, 3, 4, 5, 9, 10, 14, 39].map(romanNumeral);
  assert.deepEqual(got, ["I", "II", "III", "IV", "V", "IX", "X", "XIV", "XXXIX"]);
});

test("romanNumeral falls back to a plain number outside that range", () => {
  assert.equal(romanNumeral(0), "0");
  assert.equal(romanNumeral(-1), "-1");
  assert.equal(romanNumeral(40), "40");
  assert.equal(romanNumeral(1.5), "1.5");
});

test("groupScheduleBySession numbers sessions in time order", () => {
  const blocks = groupScheduleBySession([
    { title: "Coffee", start: "09:00" },
    { title: "Dehaene", start: "10:00", session: "cognitive" },
    { title: "Contributed 1", start: "10:30", session: "cognitive" },
    { title: "Break", start: "11:00" },
    { title: "Monasson", start: "11:30", session: "computational" },
  ]);
  assert.deepEqual(blocks.map((b) => b.type), ["item", "session", "item", "session"]);
  assert.equal(blocks[1].numeral, "I");
  assert.equal(blocks[1].label, "Cognitive Neuroscience");
  assert.deepEqual(blocks[1].items.map((i) => i.title), ["Dehaene", "Contributed 1"]);
  assert.equal(blocks[3].numeral, "II");
  assert.equal(blocks[3].label, "Computational Neuroscience");
});

test("groupScheduleBySession keeps one numeral when a session is split", () => {
  const blocks = groupScheduleBySession([
    { title: "First half", start: "10:00", session: "systems" },
    { title: "Interlude", start: "10:30" },
    { title: "Second half", start: "11:00", session: "systems" },
  ]);
  assert.deepEqual(blocks.map((b) => b.type), ["session", "item", "session"]);
  assert.equal(blocks[0].numeral, "I");
  assert.equal(blocks[2].numeral, "I");
});

test("groupScheduleBySession never reorders the day", () => {
  const blocks = groupScheduleBySession([
    { title: "Late stray", start: "17:00", session: "cognitive" },
    { title: "Lunch", start: "12:30" },
    { title: "Early", start: "10:00", session: "cognitive" },
  ]);
  const titles = blocks.flatMap((b) => (b.type === "item" ? [b.item.title] : b.items.map((i) => i.title)));
  assert.deepEqual(titles, ["Early", "Lunch", "Late stray"]);
});

test("groupScheduleBySession treats an unknown or missing session as none", () => {
  const blocks = groupScheduleBySession([
    { title: "Stale", start: "09:00", session: "astrology" },
    { title: "Blank", start: "09:30", session: "" },
    { title: "Absent", start: "10:00" },
  ]);
  assert.deepEqual(blocks.map((b) => b.type), ["item", "item", "item"]);
});

test("groupScheduleBySession handles an empty program", () => {
  assert.deepEqual(groupScheduleBySession([]), []);
});

test("programAbstractLinks prefers explicit links, then matches talk titles", () => {
  const published = [
    { id: "a1", type: "talk", title: "Grid cells in  the dark" },
    { id: "a2", type: "poster", title: "A poster" },
    { id: "a3", type: "talk", title: "Twin" },
    { id: "a4", type: "talk", title: "twin" },
  ];
  const links = programAbstractLinks([
    { id: "s1", kind: "talk", title: "grid cells in the dark" },
    { id: "s2", kind: "talk", title: "A poster" },
    { id: "s3", kind: "keynote", title: "Grid cells in the dark" },
    { id: "s4", kind: "other", title: "Anything", abstractId: "a2" },
    { id: "s5", kind: "talk", title: "Twin" },
    { id: "s6", kind: "talk", title: "Grid cells in the dark", abstractId: "gone" },
  ], published);
  assert.deepEqual([...links], [["s1", "a1"], ["s4", "a2"]]);
});

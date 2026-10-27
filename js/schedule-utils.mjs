import { SESSION_LABELS } from "./config.mjs";

const LATEST = Number.MAX_SAFE_INTEGER;
const collator = new Intl.Collator("en", { sensitivity: "base" });

/** "09:30" -> 570 minutes. Returns null for anything malformed. */
export function parseTime(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatTimeRange(start, end) {
  if (parseTime(start) === null) return "";
  return parseTime(end) === null ? String(start) : `${start}–${end}`;
}

/**
 * Start time, then end time, then title. Returns a new array.
 *
 * PINTS runs for a single day, so the start time is the whole ordering: there
 * is no manual rank field to tie-break on any more. Items with no usable start
 * time sort last rather than first, so a half-filled draft item does not jump
 * to the top of the published program.
 */
export function sortScheduleItems(items) {
  return [...items].sort((a, b) =>
    (parseTime(a?.start) ?? LATEST) - (parseTime(b?.start) ?? LATEST) ||
    (parseTime(a?.end) ?? LATEST) - (parseTime(b?.end) ?? LATEST) ||
    collator.compare(String(a?.title ?? ""), String(b?.title ?? "")));
}

/**
 * "2026-11-12" -> "Thursday, 12 November 2026".
 *
 * Parsed and formatted in UTC on purpose: with local time, a user east of
 * Greenwich late in the evening can see the heading roll back a day.
 */
export function formatDayHeading(isoDay, locale = "en-GB") {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(isoDay);
  return date.toLocaleDateString(locale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

const ROMAN = [
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

/** 1 -> "I", 4 -> "IV", 14 -> "XIV". Anything else comes back as a plain number. */
export function romanNumeral(n) {
  if (!Number.isInteger(n) || n < 1 || n > 39) return String(n);
  let rest = n;
  let out = "";
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

/**
 * Lay the program out as the printed grid does: a run of items sharing a
 * `session` becomes one titled block, everything else stays a loose row.
 *
 * Returns `[{ type: "item", item }, { type: "session", session, label,
 * numeral, items }]` in display order.
 *
 * Grouping is by *contiguous run*, not by session id, so the result can never
 * reorder the day — time order is the one thing a program must not break. If
 * the same session appears twice with something else in between (a data-entry
 * slip, or a session deliberately split around a break) it renders as two
 * blocks carrying the same numeral, which shows the split rather than hiding
 * it by dragging the stray item back up the page.
 */
export function groupScheduleBySession(items) {
  const blocks = [];
  const numerals = new Map();
  let open = null;

  for (const item of sortScheduleItems(items)) {
    // An unknown session id is treated as none: the vocabulary can shrink
    // between editions and a stale value must not print a blank banner.
    const session = Object.hasOwn(SESSION_LABELS, item?.session) ? item.session : null;
    if (!session) {
      open = null;
      blocks.push({ type: "item", item });
      continue;
    }
    if (open?.session !== session) {
      if (!numerals.has(session)) numerals.set(session, romanNumeral(numerals.size + 1));
      open = {
        type: "session",
        session,
        label: SESSION_LABELS[session],
        numeral: numerals.get(session),
        items: [],
      };
      blocks.push(open);
    }
    open.items.push(item);
  }
  return blocks;
}

const titleKey = (title) => String(title ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Which published abstract each program item presents, as `Map<itemId,
 * abstractId>`.
 *
 * An organizer's explicit link wins. Otherwise a talk is matched to a published
 * talk with the same title, ignoring case and spacing, so a program typed in
 * before the links existed still points somewhere. Only an unambiguous match
 * counts: two talks sharing a title would make any guess a wrong link half the
 * time. An explicit link to an abstract no longer published is dropped, since
 * it would land on nothing.
 */
export function programAbstractLinks(items, published) {
  const live = new Set((published ?? []).map((a) => a.id));
  const byTitle = new Map();
  for (const a of published ?? []) {
    if (a?.type !== "talk") continue;
    const key = titleKey(a.title);
    byTitle.set(key, byTitle.has(key) ? null : a.id);
  }
  const links = new Map();
  for (const item of items ?? []) {
    const id = item?.abstractId
      ? (live.has(item.abstractId) ? item.abstractId : null)
      : item?.kind === "talk" ? byTitle.get(titleKey(item.title)) : null;
    if (id) links.set(item.id, id);
  }
  return links;
}

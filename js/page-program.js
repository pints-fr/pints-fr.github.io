import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { getSiteConfig, listPublicAbstracts, listSchedule } from "./db.js";
import { abstractListLink, posterSessionLink } from "./abstract-utils.mjs";
import { POSTER_SESSION_LABELS } from "./config.mjs";
import {
  formatDayHeading,
  formatTimeRange,
  groupScheduleBySession,
  programAbstractLinks,
  programPosterSessions,
} from "./schedule-utils.mjs";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

const programEl = document.getElementById("program");
const msg = document.getElementById("msg");

function itemRow(item, { links, posterSessions }) {
  const tr = document.createElement("tr");
  tr.className = `kind-${item.kind ?? "other"}`;

  const time = document.createElement("td");
  time.className = "time";
  time.textContent = formatTimeRange(item.start, item.end);

  const what = document.createElement("td");
  what.className = "what";
  // textContent: organizer-entered, but still never trusted into innerHTML.
  // A talk carries a link to its abstract on its title, which opens it in
  // place on the abstracts page.
  const abstractId = links.get(item.id);
  if (abstractId) {
    const link = document.createElement("a");
    link.href = abstractListLink(abstractId);
    link.textContent = item.title ?? "";
    what.append(link);
  } else {
    what.textContent = item.title ?? "";
  }
  if (item.kind === "keynote") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "keynote";
    what.append(" ", pill);
  }
  // A poster slot links to its own half of the posters when it is known which
  // half that is, and to the whole list otherwise.
  if (item.kind === "poster") {
    const session = posterSessions.get(item.id);
    const link = document.createElement("a");
    link.href = session ? posterSessionLink(session) : "abstracts.html";
    link.textContent = session
      ? `see ${POSTER_SESSION_LABELS[session]} abstracts`
      : "see abstracts";
    what.append(" — ", link);
  }
  if (item.kind === "social") {
    const link = document.createElement("a");
    link.href = "party.html";
    link.textContent = "details";
    what.append(" — ", link);
  }

  const who = document.createElement("td");
  who.textContent = [item.speaker, item.affiliation].filter(Boolean).join(" — ");

  tr.append(time, what, who);
  return tr;
}

/**
 * The banner row that opens a session: "Session II | Computational
 * Neuroscience | chaired by: Name", the chair only once one is set.
 */
function sessionHead(block, chairs) {
  const tr = document.createElement("tr");
  tr.className = "session-head";
  const numeral = document.createElement("th");
  numeral.scope = "rowgroup";
  numeral.textContent = `Session ${block.numeral}`;
  const label = document.createElement("td");
  label.colSpan = 2;
  label.textContent = block.label;
  const chair = String(chairs?.[block.session] ?? "").trim();
  if (chair) {
    const by = document.createElement("span");
    by.className = "session-chair";
    by.textContent = ` | chaired by: ${chair}`;
    label.append(by);
  }
  tr.append(numeral, label);
  return tr;
}

function programTable(items, { links, posterSessions, chairs }) {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "program";
  table.innerHTML = `<thead><tr>
    <th scope="col">Time</th><th scope="col">Title</th>
    <th scope="col">Speaker</th></tr></thead>`;

  // One <tbody> per block. A session is a row group in the markup as well as in
  // the design, which is what lets the tint and the banner be styled as a unit
  // and what tells a screen reader the rows below the banner belong to it.
  let loose = null;
  for (const block of groupScheduleBySession(items)) {
    if (block.type === "session") {
      loose = null;
      const body = document.createElement("tbody");
      body.className = `session session-${block.session}`;
      body.append(sessionHead(block, chairs));
      for (const item of block.items) body.append(itemRow(item, { links, posterSessions }));
      table.append(body);
    } else {
      if (!loose) table.append(loose = document.createElement("tbody"));
      loose.append(itemRow(block.item, { links, posterSessions }));
    }
  }

  wrap.append(table);
  return wrap;
}

if (!warnIfUnconfigured(msg)) {
  try {
    // One day, one table. The date is a single site setting rather than a field
    // on every item, so it cannot drift between rows.
    // The abstracts are only for linking talks, so a failure there costs the
    // links, not the program.
    const [config, items, published] = await Promise.all([
      getSiteConfig(), listSchedule(),
      listPublicAbstracts().catch((err) => {
        console.error("[pints] program abstracts", err);
        return [];
      }),
    ]);

    if (!items.length) {
      msg.className = "msg warn";
      msg.textContent = "The program is not published yet. Check back soon.";
    } else {
      if (config?.eventDate) {
        const h2 = document.createElement("h2");
        h2.textContent = formatDayHeading(config.eventDate);
        programEl.append(h2);
      }
      programEl.append(programTable(items, {
        links: programAbstractLinks(items, published),
        posterSessions: programPosterSessions(items),
        chairs: config?.sessionChairs,
      }));
    }
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the program.";
    console.error("[pints] program", err);
  }
}

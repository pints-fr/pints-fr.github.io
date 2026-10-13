import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { getSiteConfig, listSchedule } from "./db.js";
import {
  formatDayHeading,
  formatTimeRange,
  groupScheduleBySession,
} from "./schedule-utils.mjs";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

const programEl = document.getElementById("program");
const msg = document.getElementById("msg");

function itemRow(item) {
  const tr = document.createElement("tr");
  tr.className = `kind-${item.kind ?? "other"}`;

  const time = document.createElement("td");
  time.className = "time";
  time.textContent = formatTimeRange(item.start, item.end);

  const what = document.createElement("td");
  what.className = "what";
  // textContent: organizer-entered, but still never trusted into innerHTML.
  what.textContent = item.title ?? "";
  if (item.kind === "keynote") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "keynote";
    what.append(" ", pill);
  }
  if (item.kind === "poster") {
    const link = document.createElement("a");
    link.href = "abstracts.html";
    link.textContent = "see abstracts";
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

/** The banner row that opens a session: "Session II | Computational Neuroscience". */
function sessionHead(block) {
  const tr = document.createElement("tr");
  tr.className = "session-head";
  const numeral = document.createElement("th");
  numeral.scope = "rowgroup";
  numeral.textContent = `Session ${block.numeral}`;
  const label = document.createElement("td");
  label.colSpan = 2;
  label.textContent = block.label;
  tr.append(numeral, label);
  return tr;
}

function programTable(items) {
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
      body.append(sessionHead(block));
      for (const item of block.items) body.append(itemRow(item));
      table.append(body);
    } else {
      if (!loose) table.append(loose = document.createElement("tbody"));
      loose.append(itemRow(block.item));
    }
  }

  wrap.append(table);
  return wrap;
}

if (!warnIfUnconfigured(msg)) {
  try {
    // One day, one table. The date is a single site setting rather than a field
    // on every item, so it cannot drift between rows.
    const [config, items] = await Promise.all([getSiteConfig(), listSchedule()]);

    if (!items.length) {
      msg.className = "msg warn";
      msg.textContent = "The program is not published yet. Check back soon.";
    } else {
      if (config?.eventDate) {
        const h2 = document.createElement("h2");
        h2.textContent = formatDayHeading(config.eventDate);
        programEl.append(h2);
      }
      programEl.append(programTable(items));
    }
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the program.";
    console.error("[pints] program", err);
  }
}

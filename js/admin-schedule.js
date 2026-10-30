import {
  POSTER_SESSIONS, POSTER_SESSION_LABELS, SCHEDULE_KINDS, SCHEDULE_SESSIONS, SESSION_LABELS,
} from "./config.mjs";
import {
  formatTimeRange, groupScheduleBySession, programPosterSessions,
} from "./schedule-utils.mjs";
import {
  abstractListLink, posterCode, posterSessionLink, presenterOf, sortPublicAbstracts,
} from "./abstract-utils.mjs";
import {
  deleteScheduleItem, getSiteConfig, listPublicAbstracts, listSchedule, saveScheduleItem,
  saveSiteConfig,
} from "./db.js";

// PINTS is one day in one venue, so there is no date, no room, and no manual
// rank: the start time is the whole ordering. The event date itself lives in
// config/site and is edited on the Settings tab.
// step 300 = five minutes. Sessions are never scheduled to the minute, and the
// coarser picker is much faster to operate than a free-typing time field.
const FIELDS = [
  { key: "start", label: "Start", type: "time", step: 300 },
  { key: "end", label: "End", type: "time", step: 300 },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "speaker", label: "Speaker", type: "text" },
  { key: "affiliation", label: "Affiliation", type: "text" },
];

export async function mountScheduleTab(host) {
  host.innerHTML = `
    <div id="s-msg" class="msg" role="status" aria-live="polite"></div>
    <h2 id="s-form-heading">Add an item</h2>
    <form id="s-form" novalidate></form>
    <h2>Current program</h2>
    <div id="s-list"></div>
    <h2>Session chairs</h2>
    <p class="muted">Shown on each session's banner in the program:
      “Session I | Cognitive Neuroscience | chaired by: …”. Leave a box empty for no chair.</p>
    <form id="s-chairs" novalidate></form>`;

  const msg = host.querySelector("#s-msg");
  const form = host.querySelector("#s-form");
  const heading = host.querySelector("#s-form-heading");
  const listEl = host.querySelector("#s-list");
  let editingId = null;

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  // Start and end share one row: both are a handful of digits, and stacked
  // full-width like the text fields below them they wasted most of a line
  // each.
  const timeRow = document.createElement("div");
  timeRow.className = "field-row";
  for (const spec of FIELDS) {
    const label = document.createElement("label");
    label.setAttribute("for", `s-${spec.key}`);
    label.textContent = spec.label;
    const input = document.createElement("input");
    input.id = `s-${spec.key}`;
    input.type = spec.type;
    if (spec.step) input.step = String(spec.step);
    if (spec.required) input.required = true;
    if (spec.key === "start" || spec.key === "end") {
      const field = document.createElement("div");
      field.append(label, input);
      timeRow.append(field);
      if (spec.key === "end") form.append(timeRow);
    } else {
      form.append(label, input);
    }
  }

  // Optional on purpose: coffee, lunch and the poster slot belong to no session
  // and print between the blocks, exactly as they do on the printed grid. The
  // numeral is not stored — it comes from where the block lands in the day, so
  // inserting a session never means renumbering the ones after it by hand.
  const sessionLabel = document.createElement("label");
  sessionLabel.setAttribute("for", "s-session");
  sessionLabel.textContent = "Session";
  const sessionSelect = document.createElement("select");
  sessionSelect.id = "s-session";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— no session —";
  sessionSelect.append(none);
  for (const id of SCHEDULE_SESSIONS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = SESSION_LABELS[id];
    sessionSelect.append(option);
  }
  const sessionField = document.createElement("div");
  sessionField.append(sessionLabel, sessionSelect);

  const kindLabel = document.createElement("label");
  kindLabel.setAttribute("for", "s-kind");
  kindLabel.textContent = "Kind";
  const kindSelect = document.createElement("select");
  kindSelect.id = "s-kind";
  for (const kind of SCHEDULE_KINDS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  const kindField = document.createElement("div");
  kindField.append(kindLabel, kindSelect);

  // Which of the two poster sessions a poster slot is, so the program can link
  // it to that half of the posters. Left empty, poster slots count as session
  // 1, 2… in time order (programPosterSessions).
  const posterSessionLabel = document.createElement("label");
  posterSessionLabel.setAttribute("for", "s-poster-session");
  posterSessionLabel.textContent = "Poster session";
  const posterSessionSelect = document.createElement("select");
  posterSessionSelect.id = "s-poster-session";
  const byOrder = document.createElement("option");
  byOrder.value = "";
  byOrder.textContent = "— by time order —";
  posterSessionSelect.append(byOrder);
  for (const n of POSTER_SESSIONS) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = POSTER_SESSION_LABELS[n];
    posterSessionSelect.append(option);
  }
  const posterSessionField = document.createElement("div");
  posterSessionField.append(posterSessionLabel, posterSessionSelect);
  const syncPosterSession = () => { posterSessionField.hidden = kindSelect.value !== "poster"; };
  kindSelect.addEventListener("change", syncPosterSession);

  const kindSessionRow = document.createElement("div");
  kindSessionRow.className = "field-row";
  kindSessionRow.append(sessionField, kindField, posterSessionField);
  form.append(kindSessionRow);

  // A talk slot can point at the abstract it presents, and the public program
  // then links its title there. Only published abstracts are offered: the link
  // goes to the public page, which shows nothing else.
  const abstractLabel = document.createElement("label");
  abstractLabel.setAttribute("for", "s-abstract");
  abstractLabel.textContent = "Linked abstract";
  const abstractSelect = document.createElement("select");
  abstractSelect.id = "s-abstract";
  form.append(abstractLabel, abstractSelect);
  let abstractsById = new Map();

  function fillAbstractOptions(list) {
    abstractsById = new Map(list.map((a) => [a.id, a]));
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— none —";
    abstractSelect.replaceChildren(none);
    for (const a of sortPublicAbstracts(list)) {
      const option = document.createElement("option");
      option.value = a.id;
      const tag = a.type === "talk" ? "Talk" : posterCode(a) || "Poster";
      option.textContent = `${tag} · ${a.title ?? "(untitled)"}`;
      abstractSelect.append(option);
    }
  }

  // Fills only what is still empty, so picking an abstract for a slot already
  // typed in never overwrites the organizer's wording.
  abstractSelect.addEventListener("change", () => {
    const abstract = abstractsById.get(abstractSelect.value);
    if (!abstract) return;
    const { speaker, affiliation } = presenterOf(abstract);
    const fill = { title: abstract.title ?? "", speaker, affiliation };
    for (const [key, value] of Object.entries(fill)) {
      if (!field(key).value.trim()) field(key).value = value;
    }
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Add item";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancel edit";
  cancel.hidden = true;
  actions.append(save, cancel);
  form.append(actions);

  const field = (key) => host.querySelector(`#s-${key}`);

  function resetForm() {
    editingId = null;
    for (const spec of FIELDS) field(spec.key).value = "";
    kindSelect.value = "talk";
    sessionSelect.value = "";
    posterSessionSelect.value = "";
    syncPosterSession();
    abstractSelect.value = "";
    heading.textContent = "Add an item";
    save.textContent = "Add item";
    cancel.hidden = true;
  }

  function loadIntoForm(item) {
    editingId = item.id;
    for (const spec of FIELDS) field(spec.key).value = item[spec.key] ?? "";
    kindSelect.value = item.kind ?? "talk";
    sessionSelect.value = SCHEDULE_SESSIONS.includes(item.session) ? item.session : "";
    posterSessionSelect.value = POSTER_SESSIONS.includes(item.posterSession)
      ? String(item.posterSession) : "";
    syncPosterSession();
    // A link to an abstract since un-accepted shows as none rather than as a
    // blank select; saving then drops it, which is what it should be.
    abstractSelect.value = abstractsById.has(item.abstractId) ? item.abstractId : "";
    heading.textContent = `Editing: ${item.title}`;
    save.textContent = "Save changes";
    cancel.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function row(item, refresh, posterSessions) {
    const tr = document.createElement("tr");
    tr.className = `kind-${item.kind ?? "other"}`;

    const time = document.createElement("td");
    time.className = "time";
    time.textContent = formatTimeRange(item.start, item.end);

    const what = document.createElement("td");
    what.className = "what";
    what.textContent = item.title ?? "";
    if (item.abstractId) {
      const link = document.createElement("a");
      link.href = abstractListLink(item.abstractId);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "abstract ↗";
      what.append(" — ", link);
    }
    const posterSession = posterSessions.get(item.id);
    if (posterSession) {
      const link = document.createElement("a");
      link.href = posterSessionLink(posterSession);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `${POSTER_SESSION_LABELS[posterSession]} ↗`;
      what.append(" — ", link);
    }

    const who = document.createElement("td");
    who.textContent = [item.speaker, item.affiliation].filter(Boolean).join(" — ");

    const kind = document.createElement("td");
    kind.textContent = item.kind ?? "other";

    const tools = document.createElement("td");
    tools.className = "tools";
    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => loadIntoForm(item));

    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete “${item.title}”?`)) return;
      remove.disabled = true;
      try {
        await deleteScheduleItem(item.id);
        say("Item deleted.", "warn");
        await refresh();
      } catch (err) {
        say("Could not delete the item.", "err");
        console.error("[pints] deleteScheduleItem", err);
        remove.disabled = false;
      }
    });
    tools.append(edit, " ", remove);

    tr.append(time, what, who, kind, tools);
    return tr;
  }

  // The chairs as last saved, for the banners below.
  let chairs = {};

  function sessionHead(block) {
    const tr = document.createElement("tr");
    tr.className = "session-head";
    const numeral = document.createElement("th");
    numeral.scope = "rowgroup";
    numeral.textContent = `Session ${block.numeral}`;
    const label = document.createElement("td");
    label.colSpan = 4;
    label.textContent = block.label;
    const chair = String(chairs[block.session] ?? "").trim();
    if (chair) {
      const by = document.createElement("span");
      by.className = "session-chair";
      by.textContent = ` | chaired by: ${chair}`;
      label.append(by);
    }
    tr.append(numeral, label);
    return tr;
  }

  async function render() {
    const items = await listSchedule();
    listEl.replaceChildren();
    if (!items.length) {
      say("The program is empty. Add the first item above.", "warn");
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "program";
    table.innerHTML =
      "<thead><tr><th>Time</th><th>What</th><th>Who</th><th>Kind</th><th></th></tr></thead>";

    // Grouped the same way the public page groups it, so this list is a preview
    // of the program rather than a second view of it that has to be reconciled.
    const posterSessions = programPosterSessions(items);
    let loose = null;
    for (const block of groupScheduleBySession(items)) {
      if (block.type === "session") {
        loose = null;
        const body = document.createElement("tbody");
        body.className = `session session-${block.session}`;
        body.append(sessionHead(block));
        for (const item of block.items) body.append(row(item, render, posterSessions));
        table.append(body);
      } else {
        if (!loose) table.append(loose = document.createElement("tbody"));
        loose.append(row(block.item, render, posterSessions));
      }
    }

    wrap.append(table);
    listEl.append(wrap);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(FIELDS.map((s) => [s.key, field(s.key).value.trim()]));
    if (!data.title) return say("A title is required.", "err");
    data.kind = kindSelect.value;
    // Absent rather than empty: `session` is optional in firestore.rules, and a
    // stored "" would have to be special-cased by every reader.
    if (sessionSelect.value) data.session = sessionSelect.value;
    if (abstractSelect.value) data.abstractId = abstractSelect.value;
    if (data.kind === "poster" && posterSessionSelect.value) {
      data.posterSession = Number(posterSessionSelect.value);
    }

    save.disabled = true;
    try {
      await saveScheduleItem(editingId, data);
      say(editingId ? "Item updated." : "Item added.", "ok");
      resetForm();
      await render();
    } catch (err) {
      say("Could not save the item.", "err");
      console.error("[pints] saveScheduleItem", err);
    } finally {
      save.disabled = false;
    }
  });

  cancel.addEventListener("click", resetForm);
  fillAbstractOptions([]);
  resetForm();

  // Session chairs: one box per session, kept in config/site.sessionChairs.
  // A whole map is saved each time, so clearing a box clears that chair.
  const chairsForm = host.querySelector("#s-chairs");
  const chairInputs = new Map();
  for (const id of SCHEDULE_SESSIONS) {
    const label = document.createElement("label");
    label.setAttribute("for", `s-chair-${id}`);
    label.textContent = SESSION_LABELS[id];
    const input = document.createElement("input");
    input.id = `s-chair-${id}`;
    input.type = "text";
    input.maxLength = 200;
    input.placeholder = "Chair's name";
    chairInputs.set(id, input);
    chairsForm.append(label, input);
  }
  const chairActions = document.createElement("div");
  chairActions.className = "actions";
  const saveChairs = document.createElement("button");
  saveChairs.type = "submit";
  saveChairs.textContent = "Save chairs";
  chairActions.append(saveChairs);
  chairsForm.append(chairActions);

  chairsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = Object.fromEntries(
      [...chairInputs].map(([id, input]) => [id, input.value.trim()]));
    saveChairs.disabled = true;
    try {
      await saveSiteConfig({ sessionChairs: next });
      chairs = next;
      say("Session chairs saved.", "ok");
      await render();
    } catch (err) {
      say("Could not save the session chairs.", "err");
      console.error("[pints] saveSiteConfig sessionChairs", err);
    } finally {
      saveChairs.disabled = false;
    }
  });

  try {
    chairs = (await getSiteConfig())?.sessionChairs ?? {};
    for (const [id, input] of chairInputs) input.value = chairs[id] ?? "";
  } catch (err) {
    console.error("[pints] getSiteConfig sessionChairs", err);
  }

  try {
    fillAbstractOptions(await listPublicAbstracts());
  } catch (err) {
    console.error("[pints] listPublicAbstracts", err);
  }

  try {
    await render();
  } catch (err) {
    say("Could not load the program.", "err");
    console.error("[pints] listSchedule", err);
  }
}

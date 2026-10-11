import {
  addAdmin, createRegistrationLink, deleteRegistrationLink, getSiteConfig,
  listRegistrationLinks, listUsers, saveSiteConfig,
} from "./db.js";
import {
  isRegistrationOpen, LINK_DURATIONS, linkStatus, registrationLinkUrl,
} from "./registration-utils.mjs";

export async function mountSettingsTab(host, { adminUid }) {
  host.innerHTML = `
    <div id="cfg-msg" class="msg" role="status" aria-live="polite"></div>

    <h2>The meeting</h2>
    <form id="date-form" novalidate>
      <label for="cfg-date">Date
        <span class="hint">PINTS is a single day. This is the heading shown above the program.</span>
      </label>
      <input id="cfg-date" type="date">
      <div class="actions"><button type="submit" id="date-save">Save date</button></div>
    </form>

    <h2>Registration</h2>
    <form id="reg-form" novalidate>
      <div class="checkline">
        <input id="reg-open" type="checkbox">
        <label for="reg-open">Registration is open
          <span class="hint">Untick to stop new accounts. People who already registered can
            still sign in, edit their profile, and submit an abstract while submissions are
            open. Enforced by the security rules as well as the registration page.</span>
        </label>
      </div>
      <div class="actions"><button type="submit" id="reg-save">Save registration</button></div>
    </form>

    <h3>Late registration link</h3>
    <p class="muted">For somebody who missed the deadline. Each link lets one person register,
      once, until it expires — whether or not registration is open. Send it to them yourself.</p>
    <form id="link-form" novalidate>
      <label for="link-hours">Valid for</label>
      <select id="link-hours">
        ${LINK_DURATIONS.map((d) => `<option value="${d.hours}">${d.label}</option>`).join("")}
      </select>
      <div class="actions"><button type="submit" id="link-make">Generate link</button></div>
    </form>
    <div id="link-out" hidden>
      <label for="link-url">New link</label>
      <input id="link-url" type="text" readonly>
      <div class="actions"><button type="button" id="link-copy" class="secondary">Copy link</button></div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Created</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody id="link-rows"></tbody>
      </table>
    </div>

    <h2>Submission window</h2>
    <form id="cfg-form" novalidate>
      <div class="checkline">
        <input id="cfg-open" type="checkbox">
        <label for="cfg-open">Submissions are open</label>
      </div>
      <label for="cfg-deadline">Deadline
        <span class="hint">Enforced by the security rules as well as the form, so submissions
          close on time even if the checkbox above is forgotten.</span>
      </label>
      <input id="cfg-deadline" type="datetime-local">
      <div class="actions"><button type="submit" id="cfg-save">Save settings</button></div>
    </form>

    <h2>Add an organizer</h2>
    <p class="muted">Find the person's UID under <strong>Authentication → Users</strong> in the
      Firebase console. They must already have an account on this site.</p>
    <form id="adm-form" novalidate>
      <label for="adm-uid">User UID</label>
      <input id="adm-uid" type="text" required autocomplete="off">
      <label for="adm-email">Their email (for the record)</label>
      <input id="adm-email" type="email" required autocomplete="off">
      <div class="actions"><button type="submit" id="adm-save">Grant admin rights</button></div>
    </form>`;

  const msg = host.querySelector("#cfg-msg");
  const openEl = host.querySelector("#cfg-open");
  const regOpenEl = host.querySelector("#reg-open");
  const dateEl = host.querySelector("#cfg-date");
  const deadlineEl = host.querySelector("#cfg-deadline");
  const cfgSave = host.querySelector("#cfg-save");
  const admSave = host.querySelector("#adm-save");

  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };

  try {
    const config = await getSiteConfig();
    openEl.checked = Boolean(config?.submissionsOpen);
    regOpenEl.checked = isRegistrationOpen(config);
    dateEl.value = config?.eventDate ?? "";
    const deadline = config?.submissionDeadline?.toDate?.();
    if (deadline) {
      // datetime-local wants local wall-clock time, not UTC.
      const offset = deadline.getTimezoneOffset() * 60000;
      deadlineEl.value = new Date(deadline.getTime() - offset).toISOString().slice(0, 16);
    }
  } catch (err) {
    say("Could not load the current settings.", "err");
    console.error("[pints] getSiteConfig", err);
  }

  host.querySelector("#date-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dateSave = host.querySelector("#date-save");
    dateSave.disabled = true;
    try {
      // Stored as the plain ISO day the <input type=date> produces. Never a
      // Date: a timestamp would acquire a timezone and the program heading
      // could then show the wrong day to someone reading it from abroad.
      await saveSiteConfig({ eventDate: dateEl.value });
      say(dateEl.value ? "Meeting date saved." : "Meeting date cleared.", "ok");
    } catch (err) {
      say("Could not save the meeting date.", "err");
      console.error("[pints] saveSiteConfig eventDate", err);
    } finally {
      dateSave.disabled = false;
    }
  });

  host.querySelector("#reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const regSave = host.querySelector("#reg-save");
    regSave.disabled = true;
    try {
      await saveSiteConfig({ registrationOpen: regOpenEl.checked });
      say(regOpenEl.checked
        ? "Saved. Registration is open."
        : "Saved. Registration is closed.", "ok");
    } catch (err) {
      say("Could not save the registration setting.", "err");
      console.error("[pints] saveSiteConfig registrationOpen", err);
    } finally {
      regSave.disabled = false;
    }
  });

  const linkOut = host.querySelector("#link-out");
  const linkUrl = host.querySelector("#link-url");
  const linkRows = host.querySelector("#link-rows");
  const when = (value) => value?.toDate?.().toLocaleString(undefined,
    { dateStyle: "medium", timeStyle: "short" }) ?? "—";

  /** Every link ever generated, newest first, with who spent each one. */
  async function renderLinks() {
    const [links, users] = await Promise.all([listRegistrationLinks(), listUsers()]);
    const names = new Map(users.map((u) => [u.id, u.displayName || u.email]));
    links.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

    linkRows.replaceChildren();
    for (const link of links) {
      const status = linkStatus(link);
      const tr = document.createElement("tr");
      const label = status === "used"
        ? `Used by ${names.get(link.usedBy) ?? link.usedBy} on ${when(link.usedAt)}`
        : status === "expired" ? "Expired" : "Not used yet";
      for (const value of [when(link.createdAt), when(link.expiresAt), label]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      const td = document.createElement("td");
      td.className = "tools";
      if (status === "valid") {
        const copy = document.createElement("button");
        copy.className = "secondary";
        copy.textContent = "Copy";
        copy.addEventListener("click", () => copyLink(registrationLinkUrl(location.href, link.id)));
        const revoke = document.createElement("button");
        revoke.className = "secondary";
        revoke.textContent = "Revoke";
        revoke.addEventListener("click", async () => {
          revoke.disabled = true;
          try {
            await deleteRegistrationLink(link.id);
            if (linkUrl.value.endsWith(link.id)) linkOut.hidden = true;
            say("Link revoked. It no longer works.", "ok");
            await renderLinks();
          } catch (err) {
            say("Could not revoke that link.", "err");
            console.error("[pints] deleteRegistrationLink", err);
            revoke.disabled = false;
          }
        });
        td.append(copy, " ", revoke);
      }
      tr.append(td);
      linkRows.append(tr);
    }
    if (!links.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "muted";
      td.textContent = "No links generated yet.";
      tr.append(td);
      linkRows.append(tr);
    }
  }

  // The Clipboard API needs a secure context and a permission some browsers
  // withhold; when it is refused, the text is selected so Ctrl/Cmd-C works.
  async function copyLink(url) {
    linkUrl.value = url;
    linkOut.hidden = false;
    try {
      await navigator.clipboard.writeText(url);
      say("Link copied. It works once, for one person.", "ok");
    } catch {
      linkUrl.select();
      say("Could not copy automatically. The link is selected: copy it by hand.", "warn");
    }
  }

  renderLinks().catch((err) => {
    say("Could not load the registration links.", "err");
    console.error("[pints] listRegistrationLinks", err);
  });

  host.querySelector("#link-copy").addEventListener("click", () => copyLink(linkUrl.value));

  host.querySelector("#link-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const linkMake = host.querySelector("#link-make");
    linkMake.disabled = true;
    try {
      const hours = Number(host.querySelector("#link-hours").value);
      const token = await createRegistrationLink(adminUid, hours);
      // Shown and listed before the copy is attempted: a clipboard permission
      // prompt can leave writeText() pending, and the link must not wait on it.
      const url = registrationLinkUrl(location.href, token);
      linkUrl.value = url;
      linkOut.hidden = false;
      say("Link generated. It works once, for one person.", "ok");
      await renderLinks();
      copyLink(url);
    } catch (err) {
      say("Could not generate a link.", "err");
      console.error("[pints] createRegistrationLink", err);
    } finally {
      linkMake.disabled = false;
    }
  });

  host.querySelector("#cfg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!deadlineEl.value) return say("Set a deadline before saving.", "err");
    cfgSave.disabled = true;
    try {
      await saveSiteConfig({
        submissionsOpen: openEl.checked,
        submissionDeadline: new Date(deadlineEl.value),
      });
      say(openEl.checked
        ? "Saved. Submissions are open."
        : "Saved. Submissions are closed.", "ok");
    } catch (err) {
      say("Could not save settings.", "err");
      console.error("[pints] saveSiteConfig", err);
    } finally {
      cfgSave.disabled = false;
    }
  });

  host.querySelector("#adm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const uid = host.querySelector("#adm-uid").value.trim();
    const email = host.querySelector("#adm-email").value.trim();
    if (!uid || !email) return say("Both the UID and the email are required.", "err");
    admSave.disabled = true;
    try {
      await addAdmin(uid, email, adminUid);
      say(`${email} is now an organizer.`, "ok");
      e.target.reset();
    } catch (err) {
      say("Could not grant admin rights. Check the UID is correct.", "err");
      console.error("[pints] addAdmin", err);
    } finally {
      admSave.disabled = false;
    }
  });
}

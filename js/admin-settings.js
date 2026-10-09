import { addAdmin, getSiteConfig, saveSiteConfig } from "./db.js";
import { isRegistrationOpen } from "./registration-utils.mjs";

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

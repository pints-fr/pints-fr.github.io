import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { checkIsAdmin, requireUser } from "./auth.js";

mountLayout();

const guard = document.getElementById("guard");
const consoleEl = document.getElementById("console");

// requireUser() resolves null rather than redirecting when Firebase is not
// configured; without this check the page would sit on "Checking your
// permissions…" forever.
if (!warnIfUnconfigured(guard)) {
  const user = await requireUser();
  const isAdmin = user ? await checkIsAdmin(user.uid) : false;
  setAuthLink({ signedIn: Boolean(user), isAdmin });

  if (!isAdmin) {
    guard.className = "msg err";
    guard.textContent =
      "You are not an organizer. If that is wrong, ask an existing admin to add you.";
  } else {
    guard.hidden = true;
    consoleEl.hidden = false;

    const loaders = {
      abstracts: () => import("./admin-abstracts.js").then((m) => m.mountAbstractsTab),
      schedule: () => import("./admin-schedule.js").then((m) => m.mountScheduleTab),
      pages: () => import("./admin-pages.js").then((m) => m.mountPagesTab),
      participants: () => import("./admin-participants.js").then((m) => m.mountParticipantsTab),
      voting: () => import("./admin-voting.js").then((m) => m.mountVotingTab),
      hero: () => import("./admin-hero.js").then((m) => m.mountHeroTab),
      archive: () => import("./admin-archive.js").then((m) => m.mountArchiveTab),
      settings: () => import("./admin-settings.js").then((m) => m.mountSettingsTab),
    };
    const mounted = new Set();

    async function show(name) {
      for (const tab of document.querySelectorAll("[role=tab]")) {
        tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
      }
      for (const panel of document.querySelectorAll("[role=tabpanel]")) {
        panel.hidden = panel.id !== `panel-${name}`;
      }
      if (!mounted.has(name)) {
        mounted.add(name);
        const mount = await loaders[name]();
        await mount(document.getElementById(`panel-${name}`), { adminUid: user.uid, user });
      }
    }

    for (const tab of document.querySelectorAll("[role=tab]")) {
      tab.addEventListener("click", () => show(tab.dataset.tab));
    }
    await show("abstracts");
  }
}

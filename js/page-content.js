import { mountLayout, setAuthLink } from "./layout.js";
import { onUser } from "./auth.js";
import { hydrateMarkdownHosts } from "./content-hydrate.js";
import { getHeroPhotos, getMyAbstract, getSiteConfig } from "./db.js";
import { mountHeroSlider } from "./hero-slider.js";
import { heroPhotos } from "./hero-utils.mjs";
import { withNext } from "./redirect-utils.mjs";
import { isRegistrationOpen } from "./registration-utils.mjs";
import { submissionWindows } from "./abstract-utils.mjs";
import { EVENT } from "./config.mjs";
import { googleCalendarUrl, outlookCalendarUrl, icsContent } from "./calendar-utils.mjs";
import { download } from "./download.js";

mountLayout();

// The home page's "Submit an abstract" button. Submitting requires an account
// with a confirmed address, so a signed-out visitor is sent to sign in and
// carried back here afterwards rather than bounced off submit.html on arrival.
//
// The static href stays `submit.html`, which is the correct destination for
// everybody else and the correct fallback for a click that lands before
// Firebase has resolved: submit.html redirects a signed-out visitor to exactly
// the same place. Nothing depends on this rewrite happening in time.
const submitCta = document.getElementById("submit-cta");

// Keep the header's "Sign in" link in step with auth state on the static pages.
let submitCtaToken = 0;
onUser(({ user, isAdmin }) => {
  setAuthLink({ signedIn: Boolean(user), isAdmin });
  updateSubmitCta(user).catch((err) => console.error("[pints] submit cta", err));
});

// Someone who already has an abstract on file is not here to submit a first
// one — abstracts.html is where they can see it (and its Edit button), so the
// button sends them there instead of back into a blank first-submission form.
async function updateSubmitCta(user) {
  if (!submitCta) return;
  const token = ++submitCtaToken;
  if (!user) {
    submitCta.href = withNext("login.html", "submit.html");
    return;
  }
  const mine = await getMyAbstract(user.uid).catch((err) => {
    console.error("[pints] getMyAbstract", err);
    return null;
  });
  if (token !== submitCtaToken) return; // superseded by a later auth state
  submitCta.href = mine ? "abstracts.html" : "submit.html";
}

// The home page's "Register" and "Submit an abstract" buttons, each taken down
// while its window is closed. Not awaited: they are two buttons, and the page
// copy should not wait on them. A failed read leaves both up, and the pages
// behind them say they are closed.
const registerCta = document.getElementById("register-cta");
if (registerCta || submitCta) {
  getSiteConfig()
    .then((config) => {
      if (registerCta) registerCta.hidden = !isRegistrationOpen(config);
      if (submitCta) submitCta.hidden = !submissionWindows(config).submitOpen;
    })
    .catch((err) => console.error("[pints] home ctas", err));
}

await hydrateMarkdownHosts();

// The home page's hero photographs. This module is shared by several static
// pages and only index.html carries the element, hence the guard.
//
// The copy first, and the photographs second and in a try: they are decoration
// on top of a band that is already the right colour, so a Firestore outage
// leaves the hero looking exactly as it did before there were any photographs
// rather than leaving a hole in the landing page.
const heroHost = document.getElementById("hero-photos");
if (heroHost) {
  try {
    // The Archive link is part of the photographs, not part of the band, so it
    // hangs off the slider's own answer to "did any arrive?" rather than off a
    // second look at the list.
    if (mountHeroSlider(heroHost, heroPhotos(await getHeroPhotos()))) {
      document.getElementById("hero-link")?.removeAttribute("hidden");
    }
  } catch (err) {
    console.error("[pints] hero", err);
  }
}

// "Add to calendar". The trigger only ever opens this one panel (unlike the
// account dropdown in js/layout.js, whose click also signs out), so a click
// just toggles [data-open] outright rather than needing that trigger's
// hover-vs-touch branch.
const calendarDropdown = document.getElementById("add-to-calendar");
if (calendarDropdown) {
  const trigger = calendarDropdown.querySelector("button");
  const menu = calendarDropdown.querySelector(".nav-dropdown-menu");

  // .hero clips absolutely-positioned descendants (it needs that to crop the
  // photo slider), which would cut this panel off before the third link. Fixed
  // positioning, placed from the trigger's own rect, escapes that clip -- .hero
  // sets no transform, so the containing block for `fixed` stays the viewport.
  // Reapplied on every reveal (hover included) and on scroll/resize so the
  // panel tracks the trigger instead of the pre-scroll spot it opened at.
  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    menu.style.position = "fixed";
    // Flush with the trigger's own bottom edge, same as the stylesheet's
    // `top: 100%` -- the gap down to the visible panel is the menu's own
    // `padding-top` (see the CSS comment above .nav-dropdown-menu). Any extra
    // offset here reintroduces the dead space that CSS was written to avoid:
    // :hover is lost crossing it, and the panel closes before the pointer
    // arrives.
    menu.style.top = `${rect.bottom}px`;
    // Right-aligned to the trigger by default (matches the stylesheet's own
    // `right: 0`), but .actions wraps on a narrow screen and the trigger can
    // end up near the left edge -- clamped so the panel's own ~163px
    // (min-width: max-content) never runs past the left edge of the viewport.
    const rightAligned = viewportWidth - rect.right;
    const menuWidth = menu.getBoundingClientRect().width;
    menu.style.right = `${Math.min(rightAligned, viewportWidth - menuWidth - 8)}px`;
  };
  calendarDropdown.addEventListener("mouseenter", positionMenu);
  trigger.addEventListener("focus", positionMenu);
  window.addEventListener("scroll", positionMenu, { passive: true });
  window.addEventListener("resize", positionMenu);

  trigger.addEventListener("click", () => {
    const open = calendarDropdown.getAttribute("data-open") === "true";
    if (open) calendarDropdown.removeAttribute("data-open");
    else {
      positionMenu();
      calendarDropdown.setAttribute("data-open", "true");
    }
    trigger.setAttribute("aria-expanded", String(!open));
  });
  // Tapping elsewhere closes an open panel on touch, same as the account menu.
  document.addEventListener("click", (e) => {
    if (calendarDropdown.getAttribute("data-open") === "true" && !calendarDropdown.contains(e.target)) {
      calendarDropdown.removeAttribute("data-open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  document.getElementById("calendar-google").href = googleCalendarUrl(EVENT);
  document.getElementById("calendar-outlook").href = outlookCalendarUrl(EVENT);
  document.getElementById("calendar-ics").addEventListener("click", (e) => {
    e.preventDefault();
    download("pints-2026.ics", icsContent(EVENT), "text/calendar;charset=utf-8");
  });
}

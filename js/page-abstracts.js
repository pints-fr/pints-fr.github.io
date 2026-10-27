import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import {
  getMyAbstract, getPublicAbstract, getSiteConfig, listPublicAbstracts, retractAbstract,
} from "./db.js";
import {
  abstractAnchor, filterAbstracts, groupByTopic, retractQuestion, sortPublicAbstracts,
  submissionWindows,
} from "./abstract-utils.mjs";
import { abstractCard, abstractDisclosure, abstractPermalink } from "./abstract-card.js";
import { mountSubmissionCard } from "./submission-view.js";
import { deleteFigure } from "./storage.js";
import { ABSTRACT_TOPICS, SITE_NAME, TOPIC_LABELS } from "./config.mjs";
import { hydrateMarkdownHosts } from "./content-hydrate.js";
import { withNext } from "./redirect-utils.mjs";

mountLayout();

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const msg = document.getElementById("msg");
const queryEl = document.getElementById("q");
const topicEl = document.getElementById("topic");
const filtersEl = document.getElementById("filters");
const guidelinesEl = document.getElementById("guidelines");
const headingEl = document.querySelector("main h1");
const submitPanelEl = document.getElementById("submit-panel");
const submitCtaBlockEl = document.getElementById("submit-cta-block");
const submitCta = document.getElementById("submit-cta");
const myAbstractEl = document.getElementById("my-abstract");

// onAuthStateChanged can fire more than once (sign-out elsewhere, a token
// refresh), so this has to be a full re-render, not a one-way reveal — or a
// stale card would survive a sign-out on this same page.
let submitPanelToken = 0;
onUser(({ user, isAdmin }) => {
  setAuthLink({ signedIn: Boolean(user), isAdmin });
  renderSubmitPanel(user).catch((err) => console.error("[pints] submit panel", err));
});

async function renderSubmitPanel(user) {
  const token = ++submitPanelToken;
  submitCta.href = user ? "submit.html" : withNext("login.html", "submit.html");

  // The config is read signed out too: it is what says whether the submit
  // button should be offered at all.
  const [mine, config] = await Promise.all([
    user
      ? getMyAbstract(user.uid).catch((err) => {
        console.error("[pints] getMyAbstract", err);
        return null;
      })
      : null,
    getSiteConfig().catch((err) => {
      console.error("[pints] getSiteConfig", err);
      return null;
    }),
  ]);

  if (token !== submitPanelToken) return; // superseded by a later auth state

  if (mine) {
    submitCtaBlockEl.hidden = true;
    const windows = submissionWindows(config);
    await mountSubmissionCard(myAbstractEl, mine, {
      windows,
      onEdit: () => { location.href = "submit.html?edit=1"; },
      onRetract: () => retractMyAbstract(user, mine, windows),
    });
  } else {
    // Gone once submissions close: the intro invites a submission too. A failed
    // config read leaves it up, and submit.html says the window is closed.
    submitCtaBlockEl.hidden = config ? !submissionWindows(config).submitOpen : false;
    myAbstractEl.replaceChildren();
  }
}

/**
 * Retract the signed-in visitor's own abstract, then fall back to the CTA. An
 * accepted poster takes its public copy down in the same batch; the page is
 * then reloaded, because the list below still holds it.
 */
async function retractMyAbstract(user, mine, windows) {
  if (!confirm(retractQuestion(mine, windows))) return;
  try {
    const published = mine.status === "accepted";
    await retractAbstract(mine.id, { published });
    // Best-effort: an orphaned figure is invisible and costs nothing, whereas
    // failing the delete over it would leave the abstract in place.
    await deleteFigure(mine.figurePath).catch((err) => console.error("[pints] deleteFigure", err));
    if (published) {
      location.reload();
      return;
    }
    await renderSubmitPanel(user);
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not retract your abstract. Please try again.";
    console.error("[pints] retractAbstract", err);
  }
}

// ?a=<id> asks for one abstract by itself, which is what a shared link is. The
// list is the default, so an absent or unknown parameter degrades to it rather
// than to an error page.
const wanted = new URLSearchParams(location.search).get("a");

if (wanted) await mountOne(wanted);
else await mountList();

/** A shared link: one abstract, no filters, and a way back to the rest. */
async function mountOne(id) {
  // The poster guidelines are advice for people about to submit, not context for
  // a shared abstract, so this view drops them rather than hydrating them.
  guidelinesEl.remove();
  submitPanelEl.hidden = true;
  filtersEl.hidden = true;
  countEl.hidden = true;

  if (warnIfUnconfigured(msg)) return;
  try {
    const abstract = await getPublicAbstract(id);
    if (!abstract) {
      headingEl.textContent = "Abstract not found";
      msg.className = "msg warn";
      // Deliberately vague about which: abstracts_public holds only accepted
      // ones, so "no such abstract" and "not accepted (yet)" are the same read,
      // and guessing between them would leak a decision that is not ours to
      // announce.
      msg.textContent = "That abstract is not in the public list. Only accepted "
        + "abstracts are published here.";
      listEl.append(backLink());
      return;
    }
    // The card's own heading becomes the page heading, rather than printing the
    // title twice: it is the same string, and only the card's version carries
    // the poster number and the talk pill.
    headingEl.remove();
    // The tab and any link preview should name the abstract, not the section.
    document.title = `${abstract.title ?? "Abstract"} — ${SITE_NAME}`;
    listEl.replaceChildren(
      abstractCard(abstract, { headingLevel: "h1" }),
      backLink(),
    );
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load that abstract.";
    console.error("[pints] abstract", err);
  }
}

function backLink() {
  const p = document.createElement("p");
  const a = document.createElement("a");
  a.href = "abstracts.html";
  a.textContent = "← All abstracts";
  p.append(a);
  return p;
}

async function mountList() {
  await hydrateMarkdownHosts();

  const anyTopic = document.createElement("option");
  anyTopic.value = "";
  anyTopic.textContent = "All topics";
  topicEl.append(anyTopic);
  for (const topic of ABSTRACT_TOPICS) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = TOPIC_LABELS[topic] ?? topic;
    topicEl.append(option);
  }

  // Reading the whole list end to end is a real use — the committee does it, and
  // so does anyone printing an abstract book — and hundreds of collapsed rows
  // would otherwise mean hundreds of clicks.
  const expandAll = (open) => {
    for (const row of listEl.querySelectorAll("details.abstract")) row.open = open;
    toggleAll.textContent = open ? "Collapse all" : "Expand all";
    toggleAll.dataset.open = String(open);
  };
  const toggleAll = document.createElement("button");
  toggleAll.type = "button";
  toggleAll.className = "secondary";
  toggleAll.id = "expand-all";
  toggleAll.textContent = "Expand all";
  toggleAll.addEventListener("click", () => expandAll(toggleAll.dataset.open !== "true"));
  countEl.after(toggleAll);

  // A collapsed row prints as a title and nothing else, and the bodies are built
  // lazily so there is nothing for a print stylesheet to reveal. Opening them
  // here builds them, which is what makes the printed page an abstract book.
  window.addEventListener("beforeprint", () => expandAll(true));

  if (warnIfUnconfigured(msg)) return;

  let all = [];
  const draw = () => {
    const byTopic = topicEl.value ? all.filter((a) => a.topic === topicEl.value) : all;
    const shown = filterAbstracts(byTopic, queryEl.value);
    countEl.textContent = `${shown.length} of ${all.length} shown.`;

    // groupByTopic keeps input order inside each bucket, so talks-first-then-
    // board-number survives within a topic, and it sweeps an unknown topic into
    // a trailing group rather than dropping the abstract.
    const nodes = [];
    for (const group of groupByTopic(shown, ABSTRACT_TOPICS)) {
      const h2 = document.createElement("h2");
      h2.className = "topic-heading";
      h2.textContent = group.topic ? (TOPIC_LABELS[group.topic] ?? group.topic) : "Other";
      const count = document.createElement("span");
      count.className = "muted";
      count.textContent = ` ${group.items.length}`;
      h2.append(count);
      nodes.push(h2, ...group.items.map((a) => {
        const row = abstractDisclosure(a, { permalink: abstractPermalink(a.id) });
        row.id = abstractAnchor(a.id);
        return row;
      }));
    }
    listEl.replaceChildren(...nodes);
    // A redraw destroys every open row, so the control must not still say
    // "Collapse all".
    expandAll(false);
    toggleAll.hidden = !shown.length;
  };

  // #abstract-<id>, which is how the program links a talk: open that row and
  // bring it into view. The browser's own jump to the hash fires before the
  // list exists, so it is done here, after the draw. A filter that hides the
  // row is cleared rather than leaving the link to land on nothing.
  const reveal = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    let row = document.getElementById(id);
    if (!row && (queryEl.value || topicEl.value)) {
      queryEl.value = "";
      topicEl.value = "";
      draw();
      row = document.getElementById(id);
    }
    if (!(row instanceof HTMLDetailsElement)) return;
    row.open = true;
    row.scrollIntoView({ block: "start" });
  };

  try {
    all = sortPublicAbstracts(await listPublicAbstracts());
    if (!all.length) {
      msg.className = "msg warn";
      msg.textContent = "No abstracts have been accepted yet.";
    }
    draw();
    reveal();
    queryEl.addEventListener("input", draw);
    topicEl.addEventListener("change", draw);
    window.addEventListener("hashchange", reveal);
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the abstract list.";
    console.error("[pints] abstracts", err);
  }
}

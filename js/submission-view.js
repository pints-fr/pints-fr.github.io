import { confirmPublishSetting, getPublicAbstract } from "./db.js";
import { ownerCan, submissionStatusLabel } from "./abstract-utils.mjs";
import { abstractCard, abstractPermalink } from "./abstract-card.js";

/**
 * A participant's own abstract, shown back to them as the organizers will read
 * it, with where it stands and a way into the editor.
 *
 * Two pages need this and used to disagree: `submit.html` showed the card while
 * `account.html` dropped straight into the form. Two answers to "what is my
 * submission" is how a site starts contradicting itself, so there is one.
 *
 * Showing the filled-in form after a save answers "did it work?" with the same
 * screen that was already there — the green line is the only difference and it
 * is easy to miss. The record is the better answer.
 *
 * `onEdit` is called when the button is pressed; the caller owns swapping in
 * `mountAbstractForm`, because the two pages mount it into different hosts with
 * different options.
 *
 * `onRetract`, if given, adds a "Retract this abstract" button beside Edit. It
 * is optional rather than always-on: abstracts.html has nowhere else for a
 * retraction to happen, so it wires this up, while submit.html already offers
 * it from inside the editor and does not need it twice.
 *
 * `windows` is submissionWindows() of the site config. What the buttons offer
 * comes from ownerCan(), the client half of the owner rules in firestore.rules.
 *
 * "Publish title and authors only" is a shortcut for the publish setting in the
 * editor. It saves on the spot and redraws this card, so it needs nothing from
 * the caller. It is hidden once that is already the confirmed setting.
 */
export async function mountSubmissionCard(host, abstract, options) {
  const { onEdit, onRetract = null, windows = null } = options;
  // The poster/talk decision and the board number live only on the public copy,
  // so a decided abstract costs one extra read and an undecided one costs none.
  const published = abstract.status === "accepted"
    ? await getPublicAbstract(abstract.id).catch((err) => {
      console.error("[pints] getPublicAbstract", err);
      return null;
    })
    : null;

  const card = abstractCard(abstract, {
    statusLabel: submissionStatusLabel(abstract.status, published),
    // Only once it is public. A link to an abstract still in review resolves for
    // its author and for nobody else, which is a worse thing to hand somebody
    // than no link at all.
    permalink: published ? abstractPermalink(abstract.id) : null,
    headingLevel: "h2",
  });

  card.append(publishLine(abstract, windows));

  const actions = document.createElement("div");
  actions.className = "actions";
  const can = ownerCan(abstract, published, windows);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit submission";
  edit.disabled = !can.edit;
  edit.addEventListener("click", () => onEdit());
  actions.append(edit);

  const titleOnly = abstract.publishConfirmed === true && abstract.publishChoice === "titleOnly";
  const shortcutMsg = document.createElement("p");
  shortcutMsg.className = "msg";
  shortcutMsg.setAttribute("role", "status");
  if (!titleOnly) {
    const shortcut = document.createElement("button");
    shortcut.type = "button";
    shortcut.className = "secondary";
    shortcut.textContent = "Publish title and authors only";
    shortcut.title = "Keep your abstract text off the public list. The figure is never public.";
    shortcut.disabled = !can.edit;
    shortcut.addEventListener("click", async () => {
      if (!confirm("Publish only the title and authors of your abstract? The abstract text "
        + "will not appear on the public list. You can change this from Edit submission "
        + "while editing is open.")) return;
      shortcut.disabled = true;
      try {
        await confirmPublishSetting(abstract, "titleOnly", {
          published, editClosed: !windows?.editOpen,
        });
        await mountSubmissionCard(host,
          { ...abstract, publishChoice: "titleOnly", publishConfirmed: true }, options);
      } catch (err) {
        shortcutMsg.className = "msg err";
        shortcutMsg.textContent = "Could not save your publish setting. Please try again.";
        console.error("[pints] confirmPublishSetting", err);
        shortcut.disabled = false;
      }
    });
    actions.append(shortcut);
  }

  if (onRetract) {
    const retract = document.createElement("button");
    retract.type = "button";
    retract.className = "danger";
    retract.textContent = "Retract this abstract";
    retract.disabled = !can.retract;
    retract.addEventListener("click", () => onRetract());
    actions.append(retract);
  }

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = actionNote(abstract, published, windows, can);
  card.append(actions, shortcutMsg);
  if (note.textContent) card.append(note);
  host.replaceChildren(card);
  return card;
}

/**
 * Why a button is greyed out, or what pressing Retract costs. Empty when
 * there is nothing to say.
 */
function actionNote(abstract, published, windows, can) {
  if (!windows?.editOpen) return "Editing is closed.";
  if (abstract.status === "accepted" && !published) {
    return "Your abstract is being scheduled. Ask an organizer if you need to change it.";
  }
  if (!can.retract) {
    return "Talks cannot be retracted. Contact the organizers if you cannot give yours.";
  }
  const until = windows.editingDeadline && !windows.submitOpen
    ? ` You can edit or retract it until ${windows.editingDeadline.toLocaleString("en-GB")}.`
    : "";
  return `If you retract the poster you won’t be able to present it.${until}`;
}

/** Where the author's publish setting leaves the public listing. */
function publishLine(abstract, windows) {
  const line = document.createElement("p");
  line.className = "muted";
  const choice = abstract.publishChoice === "titleOnly"
    ? "title and authors only"
    : "title, authors and the full abstract";
  if (abstract.publishConfirmed === true) {
    line.textContent = `Public listing: ${choice} (confirmed). The figure is never public.`;
  } else if (!windows?.editOpen) {
    line.textContent = "Public listing: title, authors and the full abstract — the "
      + "default, as no choice was confirmed. The figure is never public.";
  } else {
    const deadline = windows?.editingDeadline;
    line.textContent = "Public listing: not confirmed yet. Until "
      + (deadline ? deadline.toLocaleString("en-GB") : "the editing deadline")
      + " only the title and authors are public; after that, the full abstract "
      + "(never the figure). Edit your submission to confirm a choice.";
  }
  return line;
}

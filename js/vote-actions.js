import { refreshVerification } from "./auth.js";
import { castVote, clearMyVote, getMyVote, getProfile, getSiteConfig } from "./db.js";
import { canVoteFor, posterLabel, votingOpen } from "./vote-utils.mjs";

// The best-poster ballot, shared by vote.html and the buttons on
// abstracts.html. Both pages are a demo of where voting could live; keeping
// every vote write here means dropping either one is deleting its page code,
// not untangling this.

/**
 * Everything a page needs to know about the visitor's ballot.
 *
 * `reason` is why they cannot vote, null when they can. The checks mirror
 * poster_votes/ in firestore.rules — open, confirmed address, a profile — so a
 * page never offers a vote the database is going to refuse.
 */
export async function loadBallot(user) {
  const config = await getSiteConfig().catch((err) => {
    console.error("[pints] getSiteConfig", err);
    return null;
  });
  const ballot = { uid: user?.uid ?? null, open: votingOpen(config), vote: null, reason: null };
  if (!ballot.open) return { ...ballot, reason: "closed" };
  if (!user) return { ...ballot, reason: "signedOut" };
  if (!await refreshVerification(user)) return { ...ballot, reason: "unverified" };
  const [profile, vote] = await Promise.all([getProfile(user.uid), getMyVote(user.uid)]);
  if (!profile) return { ...ballot, reason: "unregistered" };
  return { ...ballot, vote };
}

/** One sentence on why `reason` stops a vote. */
export function ballotBlockedText(reason) {
  switch (reason) {
    case "closed": return "Voting for the best poster is not open right now.";
    case "signedOut": return "Sign in with your registered account to vote for the best poster.";
    case "unverified": return "Confirm your email address to vote: open the link we sent "
      + "when you registered, then reload this page.";
    case "unregistered": return "Only registered participants can vote. Finish your "
      + "registration on your account page first.";
    default: return "";
  }
}

/** "You voted for P12 · Title." or the invitation, for a status line. */
export function ballotStatusText(ballot, posters) {
  if (!ballot.vote) return "You have not voted yet. You have one vote, and can change it "
    + "until voting closes.";
  // Not in `posters` is usually just a page that has not loaded the whole list
  // (a shared single-abstract link), so say less rather than "no longer listed".
  const poster = posters?.find((p) => p.id === ballot.vote.posterId);
  return poster
    ? `Your vote: ${posterLabel(poster)}. You can change it until voting closes.`
    : "You have voted. You can change your vote until voting closes.";
}

/** Cast (or move) the ballot; updates `ballot.vote` on success. */
export async function voteFor(ballot, posterId) {
  await castVote(ballot.uid, posterId);
  ballot.vote = { id: ballot.uid, posterId };
}

export async function withdrawVote(ballot) {
  await clearMyVote(ballot.uid);
  ballot.vote = null;
}

/**
 * The control inside one abstract on abstracts.html: a vote button, or a
 * "your vote" marker with a withdraw link. null when this abstract takes no
 * vote from this visitor (a talk, their own poster, voting closed).
 *
 * `onChange` runs after a successful write so the page can redraw every row —
 * moving a vote changes two of them.
 */
export function voteControl(abstract, ballot, { onChange, onError }) {
  if (!ballot?.open || ballot.reason || !canVoteFor(abstract, ballot.uid)) return null;
  const box = document.createElement("p");
  box.className = "vote-control";

  const run = (button, action) => async () => {
    button.disabled = true;
    try {
      await action();
      onChange();
    } catch (err) {
      console.error("[pints] vote", err);
      onError(err);
      button.disabled = false;
    }
  };

  if (ballot.vote?.posterId === abstract.id) {
    const mark = document.createElement("strong");
    mark.className = "vote-mine";
    mark.textContent = "★ Your vote for best poster";
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "secondary";
    undo.textContent = "Withdraw vote";
    undo.addEventListener("click", run(undo, () => withdrawVote(ballot)));
    box.append(mark, " ", undo);
  } else {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = ballot.vote ? "Move my vote here" : "Vote for best poster";
    button.addEventListener("click", run(button, () => voteFor(ballot, abstract.id)));
    box.append(button);
  }
  return box;
}

/**
 * What to tell the visitor when a write is refused. The likely cause is that
 * an organizer closed voting while the page was open.
 */
export const voteErrorText = (err) => (err?.code === "permission-denied"
  ? "That vote was refused. Voting may have just closed — reload the page to check."
  : "Could not save your vote. Please try again.");

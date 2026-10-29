import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { checkIsAdmin, requireUser } from "./auth.js";
import { listPublicAbstracts } from "./db.js";
import { filterAbstracts, sortPublicAbstracts, summaryAuthorLine } from "./abstract-utils.mjs";
import {
  ballotBlockedText, ballotStatusText, loadBallot, voteErrorText, voteFor, withdrawVote,
} from "./vote-actions.js";
import { canVoteFor } from "./vote-utils.mjs";

mountLayout();

const msg = document.getElementById("msg");
const statusEl = document.getElementById("status");
const form = document.getElementById("ballot");
const queryEl = document.getElementById("q");
const choicesEl = document.getElementById("choices");
const castEl = document.getElementById("cast");
const withdrawEl = document.getElementById("withdraw");

const say = (text, kind = "ok") => {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
};

if (!warnIfUnconfigured(msg)) {
  const user = await requireUser();
  setAuthLink({ signedIn: true, isAdmin: await checkIsAdmin(user.uid) });
  try {
    await mount(user);
  } catch (err) {
    say("Could not open the ballot. Please reload the page.", "err");
    console.error("[pints] vote", err);
  }
}

async function mount(user) {
  const [ballot, published] = await Promise.all([loadBallot(user), listPublicAbstracts()]);
  if (ballot.reason) return say(ballotBlockedText(ballot.reason), "warn");

  // Every poster is listed, the visitor's own included, so a presenter looking
  // for their board does not conclude it is missing; theirs is just disabled.
  const posters = sortPublicAbstracts(published.filter((a) => a.type === "poster"));
  if (!posters.length) return say("There are no posters to vote for yet.", "warn");

  // The radio selection survives filtering, so typing a search after choosing
  // does not throw the choice away.
  let selected = ballot.vote?.posterId ?? null;

  const draw = () => {
    const term = queryEl.value.trim();
    // "12" or "P12" is a board number: that is what people read off the board.
    const number = /^p?(\d+)$/i.exec(term)?.[1];
    const shown = number
      ? posters.filter((p) => String(p.posterNumber) === number)
      : filterAbstracts(posters, term);
    choicesEl.replaceChildren(...shown.map((p) => choiceRow(p, user.uid, ballot, selected)));
    if (!shown.length) {
      const none = document.createElement("p");
      none.className = "muted";
      none.textContent = "No poster matches that search.";
      choicesEl.append(none);
    }
    statusEl.textContent = ballotStatusText(ballot, posters);
    castEl.textContent = ballot.vote ? "Change my vote" : "Cast my vote";
    castEl.disabled = !selected || selected === ballot.vote?.posterId;
    withdrawEl.hidden = !ballot.vote;
  };

  choicesEl.addEventListener("change", (e) => {
    selected = e.target.value;
    draw();
  });
  queryEl.addEventListener("input", draw);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selected) return;
    castEl.disabled = true;
    try {
      await voteFor(ballot, selected);
      say("Thank you — your vote is saved.", "ok");
    } catch (err) {
      say(voteErrorText(err), "err");
      console.error("[pints] castVote", err);
    }
    draw();
  });

  withdrawEl.addEventListener("click", async () => {
    withdrawEl.disabled = true;
    try {
      await withdrawVote(ballot);
      selected = null;
      say("Your vote is withdrawn. You can vote again until voting closes.", "ok");
    } catch (err) {
      say(voteErrorText(err), "err");
      console.error("[pints] clearMyVote", err);
    } finally {
      withdrawEl.disabled = false;
    }
    draw();
  });

  form.hidden = false;
  draw();
}

function choiceRow(poster, uid, ballot, selected) {
  const own = !canVoteFor(poster, uid);
  const label = document.createElement("label");
  label.className = "vote-choice";
  if (poster.id === ballot.vote?.posterId) label.classList.add("is-current");

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "poster";
  radio.value = poster.id;
  radio.checked = poster.id === selected;
  radio.disabled = own;

  const text = document.createElement("span");
  const title = document.createElement("span");
  title.className = "vote-title";
  if (poster.posterNumber) {
    const no = document.createElement("span");
    no.className = "poster-no";
    no.textContent = `P${poster.posterNumber} `;
    title.append(no);
  }
  title.append(poster.title ?? "");
  const who = document.createElement("span");
  who.className = "vote-authors";
  who.textContent = summaryAuthorLine(poster.authors)
    + (own ? " — your poster" : "")
    + (poster.id === ballot.vote?.posterId ? " — your current vote" : "");
  text.append(title, who);

  label.append(radio, text);
  return label;
}

import {
  clearAllVotes, getSiteConfig, listPublicAbstracts, listUsers, listVotes, saveSiteConfig,
} from "./db.js";
import { summaryAuthorLine } from "./abstract-utils.mjs";
import { ballotRows, posterLabel, tallyVotes, votingOpen, votingStats } from "./vote-utils.mjs";
import { confirmChoice } from "./confirm-dialog.js";
import { toCsv } from "./csv-utils.mjs";
import { download } from "./download.js";

const BALLOT_COLUMNS = [
  { key: "posterNumber", label: "Poster" },
  { key: "posterTitle", label: "Poster title" },
  { key: "presenter", label: "Presenter" },
  { key: "voterName", label: "Voter" },
  { key: "voterAffiliation", label: "Voter affiliation" },
  { key: "voterEmail", label: "Voter email" },
  { key: "votedAtText", label: "Voted at" },
];

const percent = (x) => `${Math.round(x * 100)}%`;
const when = (date) => (date ? date.toLocaleString("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}) : "");

/**
 * The best-poster vote: the open/close switch, the ranking, and who voted for
 * whom. Who voted for whom is organizers-only by the rules (poster_votes list
 * is admin-only), so nothing on this tab can leak through another page.
 *
 * Read on demand, not live: a "Refresh" button is cheaper than a listener and
 * the count only matters at the moment somebody announces it.
 */
export async function mountVotingTab(host) {
  host.innerHTML = `
    <div id="v-msg" class="msg" role="status" aria-live="polite"></div>
    <form id="v-form" novalidate>
      <div class="checkline">
        <input id="v-open" type="checkbox">
        <label for="v-open">Best-poster voting is open
          <span class="hint">Registered participants with a confirmed email can vote once for an
            accepted poster that is not their own, and change their vote while this is ticked.
            Untick to freeze the ballots. Enforced by the security rules.</span>
        </label>
      </div>
      <div class="actions"><button type="submit" id="v-save">Save</button></div>
    </form>

    <div class="actions">
      <button type="button" id="v-refresh" class="secondary">Refresh results</button>
      <button type="button" id="v-export" class="secondary">Export ballots (CSV)</button>
      <button type="button" id="v-reset" class="danger">Delete all votes</button>
    </div>
    <div id="v-stats" class="vote-stats"></div>

    <h2>Ranking</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Rank</th><th>Poster</th><th>Votes</th><th>Share</th><th></th></tr></thead>
        <tbody id="v-rank"></tbody>
      </table>
    </div>

    <h2>Every ballot</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Voter</th><th>Affiliation</th><th>Voted for</th><th>When</th></tr></thead>
        <tbody id="v-ballots"></tbody>
      </table>
    </div>`;

  const msg = host.querySelector("#v-msg");
  const say = (text, kind = "ok") => {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  };
  const openEl = host.querySelector("#v-open");
  let ballots = [];

  openEl.checked = votingOpen(await getSiteConfig());

  host.querySelector("#v-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const save = host.querySelector("#v-save");
    save.disabled = true;
    try {
      await saveSiteConfig({ votingOpen: openEl.checked });
      say(openEl.checked
        ? "Voting is open. Participants vote on vote.html or from the abstracts page."
        : "Voting is closed. Ballots are frozen.", "ok");
    } catch (err) {
      say("Could not save the voting switch.", "err");
      console.error("[pints] saveSiteConfig voting", err);
    } finally {
      save.disabled = false;
    }
  });

  async function render() {
    const [votes, users, published] = await Promise.all([
      listVotes(), listUsers(), listPublicAbstracts(),
    ]);
    const tally = tallyVotes(votes, published);
    const stats = votingStats(votes, users, tally);
    const userById = new Map(users.map((u) => [u.id, u]));
    const posterById = new Map(published.map((p) => [p.id, p]));
    const voterName = (uid) => userById.get(uid)?.displayName ?? "(no profile)";

    host.querySelector("#v-stats").replaceChildren(
      stat(stats.cast, "votes cast"),
      stat(stats.registered, "registered participants"),
      stat(percent(stats.turnout), "turnout"),
      stat(`${stats.postersWithVotes} / ${stats.candidates}`, "posters with a vote"),
      ...(stats.orphaned ? [stat(stats.orphaned, "for posters no longer listed")] : []),
    );

    const top = tally.rows[0];
    if (top?.count && top.tied) {
      say(`Tie for first place at ${top.count} ${top.count === 1 ? "vote" : "votes"}.`, "warn");
    }

    host.querySelector("#v-rank").replaceChildren(...tally.rows.map((row) => {
      const tr = document.createElement("tr");
      const rank = cell(row.count ? `${row.rank}${row.tied ? "=" : ""}` : "–");
      rank.className = "num";

      const what = document.createElement("td");
      const title = document.createElement("div");
      title.textContent = posterLabel(row.poster);
      const presenter = document.createElement("div");
      presenter.className = "muted";
      presenter.textContent = summaryAuthorLine(row.poster.authors);
      what.append(title, presenter);
      if (row.count) {
        const voters = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Who voted";
        const list = document.createElement("ul");
        list.className = "vote-voters";
        for (const uid of row.voters.toSorted((a, b) => voterName(a).localeCompare(voterName(b)))) {
          const li = document.createElement("li");
          const u = userById.get(uid);
          li.textContent = [voterName(uid), u?.affiliation, u?.email].filter(Boolean).join(" · ");
          list.append(li);
        }
        voters.append(summary, list);
        what.append(voters);
      }

      const count = cell(row.count);
      count.className = "num";
      const share = cell(percent(row.share));
      share.className = "num";

      const barCell = document.createElement("td");
      const track = document.createElement("span");
      track.className = "vote-bar-track";
      const bar = document.createElement("span");
      bar.className = "vote-bar";
      bar.style.width = percent(row.share);
      if (row.count) track.append(bar);
      barCell.append(track);

      tr.append(rank, what, count, share, barCell);
      return tr;
    }));

    ballots = ballotRows(votes, users, published)
      .map((r) => ({ ...r, votedAtText: r.votedAt ? r.votedAt.toISOString() : "" }));
    const byVoter = votes.toSorted((a, b) => voterName(a.id).localeCompare(voterName(b.id)));
    host.querySelector("#v-ballots").replaceChildren(...byVoter.map((vote) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(voterName(vote.id)),
        cell(userById.get(vote.id)?.affiliation ?? ""),
        cell(posterLabel(posterById.get(vote.posterId))),
        cell(when(vote.updatedAt)),
      );
      return tr;
    }));

    if (!tally.rows.length) say("There are no accepted posters yet.", "warn");
  }

  host.querySelector("#v-refresh").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      say("", "");
      await render();
    } catch (err) {
      say("Could not load the votes.", "err");
      console.error("[pints] admin voting", err);
    } finally {
      button.disabled = false;
    }
  });

  host.querySelector("#v-export").addEventListener("click", () =>
    download("pints-best-poster-ballots.csv", toCsv(ballots, BALLOT_COLUMNS)));

  host.querySelector("#v-reset").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    const choice = await confirmChoice({
      title: "Delete all votes",
      message: `This permanently deletes all ${ballots.length} ballots for this edition. `
        + "Export them first if you may need them. Voting stays open or closed as it is.",
      choices: [
        { value: "delete", label: "Delete all votes", className: "danger" },
        { value: "cancel", label: "Cancel", className: "secondary" },
      ],
    });
    if (choice !== "delete") return;
    button.disabled = true;
    try {
      const n = await clearAllVotes();
      say(`Deleted ${n} ${n === 1 ? "vote" : "votes"}.`, "warn");
      await render();
    } catch (err) {
      say("Could not delete the votes.", "err");
      console.error("[pints] clearAllVotes", err);
    } finally {
      button.disabled = false;
    }
  });

  try {
    await render();
  } catch (err) {
    say("Could not load the votes.", "err");
    console.error("[pints] admin voting", err);
  }
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = String(text ?? "");
  return td;
}

function stat(value, label) {
  const box = document.createElement("div");
  box.className = "vote-stat";
  const strong = document.createElement("strong");
  strong.textContent = String(value);
  const span = document.createElement("span");
  span.textContent = label;
  box.append(strong, span);
  return box;
}

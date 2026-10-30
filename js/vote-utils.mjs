import { posterCode, sortPublicAbstracts, summaryAuthorLine } from "./abstract-utils.mjs";

// The best-poster vote, as pure functions so the rules' decisions and the
// admin tally can be tested without a browser. firestore.rules poster_votes/
// is the authority; everything here mirrors it so the UI never offers a vote
// the database is going to refuse.

/**
 * Whether config/site says the vote is open. Fails CLOSED, the same as
 * votingOpen() in firestore.rules: a missing config or field means not yet.
 */
export const votingOpen = (config) => config?.votingOpen === true;

/**
 * The posters `voterUid` may vote for: accepted posters only (talks excluded),
 * never their own. An abstract's id is its submitter's uid, which is the whole
 * of the "own poster" test. Board order, as on the abstracts page.
 */
export function eligiblePosters(publicAbstracts, voterUid) {
  return sortPublicAbstracts((publicAbstracts ?? [])
    .filter((a) => a?.type === "poster" && a.id !== voterUid));
}

/** Whether this one abstract would take a vote from `voterUid`. */
export const canVoteFor = (abstract, voterUid) =>
  abstract?.type === "poster" && Boolean(voterUid) && abstract.id !== voterUid;

/** "P1-12 · Title", for one-line mentions of a poster. */
export function posterLabel(poster) {
  if (!poster) return "a poster that is no longer listed";
  const code = posterCode(poster);
  return `${code ? `${code} · ` : ""}${poster.title ?? "Untitled"}`;
}

/**
 * The ranked result.
 *
 * Every candidate poster appears, zero votes included, so the organizers can
 * see who got nothing as well as who won. `rank` is competition ranking
 * (1, 1, 3): a tie shares a rank and `tied` says so, because a tie for first is
 * the one result the committee has to act on.
 *
 * A ballot whose poster is gone (retracted, or turned into a talk) counts
 * towards nobody; it is returned in `orphaned` rather than silently dropped.
 */
export function tallyVotes(votes, posters) {
  const candidates = (posters ?? []).filter((p) => p?.type === "poster");
  const byId = new Map(candidates.map((p) => [p.id, { poster: p, voters: [] }]));
  const orphaned = [];
  for (const vote of votes ?? []) {
    const row = byId.get(vote?.posterId);
    if (row) row.voters.push(vote.id);
    else orphaned.push(vote);
  }

  const counted = (votes?.length ?? 0) - orphaned.length;
  const rows = sortPublicAbstracts(candidates)
    .map((p) => byId.get(p.id))
    .map((row) => ({
      ...row,
      count: row.voters.length,
      share: counted ? row.voters.length / counted : 0,
    }))
    // Stable: equal counts keep board order.
    .sort((a, b) => b.count - a.count);

  rows.forEach((row, i) => {
    row.rank = i && rows[i - 1].count === row.count ? rows[i - 1].rank : i + 1;
  });
  for (const row of rows) {
    row.tied = row.count > 0 && rows.some((r) => r !== row && r.count === row.count);
  }
  return { rows, orphaned, counted };
}

/**
 * The headline numbers. `users` is the registration list (users/), so turnout
 * is ballots over registered participants — not over verified ones, which only
 * a callable can tell apart, and the difference is small enough not to matter
 * for a headline.
 */
export function votingStats(votes, users, tally) {
  const cast = votes?.length ?? 0;
  const registered = users?.length ?? 0;
  return {
    cast,
    registered,
    turnout: registered ? cast / registered : 0,
    postersWithVotes: tally.rows.filter((r) => r.count > 0).length,
    candidates: tally.rows.length,
    orphaned: tally.orphaned.length,
  };
}

/** Rows for the "who voted for whom" CSV, ordered by poster then voter name. */
export function ballotRows(votes, users, posters) {
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const posterById = new Map((posters ?? []).map((p) => [p.id, p]));
  // Board order, the order sortPublicAbstracts gives; a vote for a poster no
  // longer listed goes last.
  const boardOrder = new Map(sortPublicAbstracts(posters ?? []).map((p, i) => [p.id, i]));
  return (votes ?? []).map((vote) => {
    const voter = userById.get(vote.id);
    const poster = posterById.get(vote.posterId);
    return {
      voterName: voter?.displayName ?? "(no profile)",
      voterEmail: voter?.email ?? "",
      voterAffiliation: voter?.affiliation ?? "",
      posterNumber: poster ? posterCode(poster) : "",
      order: boardOrder.get(vote.posterId) ?? Infinity,
      posterTitle: poster?.title ?? "(no longer listed)",
      presenter: poster ? summaryAuthorLine(poster.authors) : "",
      votedAt: vote.updatedAt ?? null,
    };
  }).sort((a, b) =>
    a.order - b.order || String(a.voterName).localeCompare(String(b.voterName)))
    .map(({ order, ...row }) => row);
}

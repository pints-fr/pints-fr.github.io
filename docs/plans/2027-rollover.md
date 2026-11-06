# PINTS 2027 website: rollover plan

> Save this plan in the repo as `docs/plans/2027-rollover.md` once it is approved. **Don't implement anything until the user says to.**

## Context

PINTS 2026 took place on 2026-11-06. The same site has to host the 2027 meeting. These things stay the same:

- The domain, `pints.fr`.
- GitHub Pages hosting from `pints-fr/pints-fr.github.io`.
- The Firebase project `pints-conference`.
- The DNS and email setup.

The work is a **rollover**, not a rebuild:

1. Refresh the page content for 2027.
2. Move 2026's pages, program, abstracts and photos into the Archive (`previous.html`).
3. Keep people's logins, but make each returning person **confirm** registration for 2027.

The user's decisions:

- **2026 program and abstracts:** a static snapshot committed to the repo.
- **Re-registration:** one click for returning participants. Their verified email carries over.
- **2026 private data** (all abstracts, reviews, scores, votes, figures): export it offline, then delete it from Firestore.
- **Archived abstract text:** follow each author's publish choice, exactly as `abstracts.html` shows it today. No figures.

### Why this is more than changing `CURRENT_EDITION`

The data is scoped by an `edition` field, but several collections hold **one document per person, with the person's uid as the document ID**. The `edition` field doesn't separate those across years:

| Collection | What breaks for a returning person in 2027 |
|---|---|
| `abstracts/{uid}`, `abstracts_public/{uid}` | Their 2026 abstract fills the only slot. `getMyAbstract` returns null, because the edition differs, so the form offers to create one. But the write is evaluated as an *update* of the 2026 document, and the rules refuse it, especially for accepted abstracts. |
| `poster_votes/{uid}`, `edit_grants/{uid}` | Same collision. A stale grant could also reopen editing. |
| `users/{uid}` | `saveProfile()` (`js/db.js:49`) always writes `edition: CURRENT_EDITION`. `page-account.js:85` publishes the participant on **every** visit. So just opening `account.html` would quietly register a 2026 person for 2027, which is the opposite of "confirmation required". |
| `participants_public/{uid}` | It is already filtered by edition, so 2026 names disappear from the list on their own. Nothing to fix. |

So the rollover is: archive, then export and clear the per-person collections, then change the code so that "registered this year" is an explicit act. The rest of the site already filters by edition (`schedule`, the lists, the votes query).

---

## Phase A: Archive 2026 (do this right after the conference)

**A1. Snapshot script** `scripts/archive-edition.mjs` (Node, run once by an organizer, not part of the site).
- It reads the live data with the Admin SDK, using the organizer's `gcloud`/Firebase login or a service-account file that is never committed:
  - `schedule` where `edition == pints2026`
  - `abstracts_public` where `edition == pints2026`
  - `config/site` (meeting date, session chairs)
- It writes `archive/2026/program.json` and `archive/2026/abstracts.json`.
  - Abstracts: only the fields `abstracts_public` already holds (title, authors, affiliations, topic, type, posterSession, posterNumber, publishMode, body).
  - `body` is already null where the author chose "title and authors only", so the snapshot follows the publish choice automatically.
  - No figures, no emails, no reviews.
- It copies the current `pages/*` copy into `archive/2026/pages/*.md` (home, venue, party, about) as a record of how the pages read.

**A2. Archive pages**
- Add `archive/2026/index.html`. Because it lives in a subfolder, it needs `../` relative paths, or a `<base href="/">` like `404.html`. Choose `<base>` so the layout and CSS imports work unchanged.
- Render the program and abstracts from the JSON, reusing the existing renderers:
  - `groupScheduleBySession()` and the program table code from `js/page-program.js`. Factor out a `renderProgram(items, config)` that takes data instead of fetching it.
  - `abstract-card.js` + `abstractDisclosure` + `groupByTopic`, the session grouping from `js/page-abstracts.js`. Factor out a render function that takes a list in the same way.
- The page states that it is read-only: no vote buttons and no "your submission" view.
- Keep program-to-abstract anchor links working within the archive page.

**A3. `previous.html` / `content/previous-editions.md`**
- Add a `## PINTS 2026` section at the top: date, venue, keynotes, a link to `archive/2026/`, and the sponsor strip.
- Photos: create album `gallery/2026` from Admin › Archive. The existing `yearInHeading()` puts it under the 2026 heading automatically.
  - Upload the conference photos.
  - "Import from home photos" shares the hero photos without copying them.
- Keep the 2026 assets (`assets/pints-2026-header.svg`, `sponsors-2026.png`, `assets/speakers/*`, `assets/party/*`). The archive refers to them.

**A4. Private backup**
- Extend the script with a `--private` mode that writes to a local folder **outside the repo**:
  - `abstracts`, `abstract_reviews`, `poster_votes`, `users`, `registration_links`, `submission_links`, `edit_grants`, `contact_messages`
  - figures from `abstract_figures/`
- The existing CSV exports in the admin console are a second copy.
- Hand the backup to the organizers. Write down where it is stored.

## Phase B: Clear the 2026 per-person slots

**B1.** Run `scripts/clear-edition.mjs --edition pints2026` (Admin SDK, with a dry run first that prints counts). It deletes:
- `abstracts`, `abstracts_public`, `abstract_reviews`
- `poster_votes`, `edit_grants`
- `registration_links`, `submission_links`
- `abstract_figures/**` in Storage

It **keeps**:
- Auth accounts, `users/*` (still marked `edition: pints2026`), `admins/*`
- `participants_public/*`, which the list hides by edition. Optionally delete these for tidiness, since they get rewritten on confirmation.
- `gallery/*`, `config/hero`, `pages/*`
- `schedule` 2026 items. They are filtered out, but deleting them after the snapshot avoids confusion in the Schedule tab.

**B2.** Run this only after A1–A4 are committed and checked. The README gets a "yearly rollover" section with the order of steps.

## Phase C: Code changes for 2027

**C1. Edition bump**
- `js/config.mjs`: `CURRENT_EDITION = "pints2027"`, plus `EVENT` (date, time, venue, uid) and topics or sessions if they change.
- `config/site.edition = "pints2027"`. Reset the windows and switches: submissions, editing, registration, voting off, reviewerMode off, sessionChairs cleared.
- `scripts/logo/build_logo.py`: new `DATE`, then regenerate `assets/pints-2027-header.svg`. Update the `index.html` `<img>` and alt text.
- Calendar file name `pints-2026.ics` in `js/page-content.js:156`: derive it from `CURRENT_EDITION`.

**C2. Registration counts only when confirmed**
- Add `isRegisteredFor(profile, edition)` in `js/registration-utils.mjs`: returns `profile?.edition === edition`. Unit-test it.
- `saveProfile()` (`js/db.js`): stop writing `edition` on ordinary profile edits. Add `confirmRegistration(uid, profile, {registrationLink})`, which sets `edition: CURRENT_EDITION` and `confirmedAt`. When the address is verified, it publishes `participants_public` in the same batch.
- `page-account.js`:
  - If the profile is from an earlier edition, show a **"Register for PINTS 2027"** panel: name and affiliation prefilled and editable, plus a Confirm button.
  - Publish to the list only when `isRegisteredFor(...)`. Remove the unconditional publish on every visit for previous-edition profiles. It still heals interrupted registrations for this edition.
  - If registration is closed, show the closed message. A late registration link `?link=` also works here.
- `register.html`: when sign-up fails with `auth/email-already-in-use`, say "You already have an account from a previous PINTS. Sign in to confirm your registration for 2027", with a link to `login.html?next=account.html`.
- `submit.html`, `vote.html`, the abstracts-page vote buttons: a previous-edition user sees "Confirm your 2027 registration first", linking to the account page.
- Admin › Participants: it already queries `users` by `edition == CURRENT_EDITION`, so only confirmed people appear. Add an optional "Returning, not yet confirmed" count for reminder emails, built from a second query with `edition != current`, or an export of all users.

**C3. `firestore.rules`** (deploy by hand, before the push; see `notes/05`)
- `users/{uid}` update: changing `edition` needs `registrationOpen()` or a spent registration link.
  - `redeemsLink()` currently expects a `registrationLink` field on the profile, and that field is pinned on update. **Allow replacing it when `edition` changes**, so a 2026 link user can spend a 2027 link.
  - Allow the new `confirmedAt` field.
- Add `function registeredThisEdition(uid)`: `get(users/uid).data.edition == get(config/site).data.edition`. Require it on `abstracts` create and on `poster_votes` create and update. This closes the "accepted looseness" in design-notes §4.1, because `config/site.edition` is the source of truth the rules can read.
- `participants_public` create and update: require `request.resource.data.edition == config/site.edition`, so a stale client can't list someone under the old year.
- Rules tests:
  - A returning user can confirm while registration is open and is refused while it is closed.
  - A returning user can confirm with a link.
  - A 2026-edition profile can't submit or vote.
  - An ordinary profile edit doesn't change `edition`.
  - The exact client payloads, with nulls included.

**C4. Admin console polish**
- Settings: show the current edition (read-only, from `config/site`) and a warning if it differs from `CURRENT_EDITION` in the code.
- Optional "Remind returning participants" CSV: email and name of profiles from a previous edition.

## Phase D: Page content for 2027

- `content/home.md`, `venue.md`, `about.md`, `party.md`, `poster-guidelines.md`: new dates, venue, keynotes, speakers, sponsors, deadlines.
- Then **sync the live copies**: edit them in Admin › Pages, or delete `pages/{slug}` so the new committed file applies. Remember that the live Firestore copy overrides the committed `.md`.
- `index.html`: speaker photos (`assets/speakers/`), sponsor strip (`assets/sponsors/sponsors-2027.png`), "Add to calendar" (from `EVENT`).
- Home hero photos: keep them, or replace them with 2026 photos.
- Clear 2026-specific program items. Organizers build the 2027 program in Admin › Schedule.
- Remove stale 2026 notices, such as the red "open until 06/10/2026" line in `home.md`.

## Phase E: Launch checklist

1. Make sure Phase A is merged and the archive is live and checked, before anything is cleared.
2. Phase B dry run, then the real run.
3. Deploy the rules (C3), then push C1, C2 and D together.
4. In Admin › Settings, set `config/site.edition = pints2027` and the windows, then open registration.
5. Email past participants (from the CSV) that registration is open and that they only need to sign in and click Confirm.

## Critical files

- `js/config.mjs`, `js/db.js` (`saveProfile`, `publishParticipant`, new `confirmRegistration`)
- `js/page-account.js`, `js/page-register.js`, `js/page-submit.js`, `js/page-vote.js`
- `js/registration-utils.mjs`
- `firestore.rules`, `test/rules/users.rules.test.mjs`, `participants.rules.test.mjs`, `abstracts.rules.test.mjs`, `poster-votes.rules.test.mjs`
- `js/page-program.js`, `js/page-abstracts.js` (extract render-from-data), new `archive/2026/index.html`, a new archive page module
- `content/previous-editions.md`, `content/*.md`, `index.html`, `scripts/logo/build_logo.py`
- New scripts: `scripts/archive-edition.mjs`, `scripts/clear-edition.mjs`
- `README.md`: a "Yearly rollover" section. `notes/08-new-site-checklist.md`: link to it.

## Verification

- `npm test` (new tests for `isRegisteredFor`, the program and abstract renderers working from data) and `npm run test:rules` (the cases in C3).
- Emulator rehearsal (`?emulator`, seeded through REST as in `notes/06`):
  1. Seed a 2026 world: users, accepted and rejected abstracts, votes, schedule, `config/site.edition=pints2026`.
  2. Run the archive script against the emulator and open `archive/2026/` to check the program, the abstracts (titles only where chosen), and the anchors.
  3. Run the clear script, then bump to 2027.
  4. As a returning user: open the account page. They are **not** listed. Click Confirm and they are listed. Submit an abstract (works). Vote (works once voting is open).
  5. As an unconfirmed returning user: submit and vote are refused by the page **and** the rules.
  6. New user: the register flow is unchanged.
  7. Registration closed: Confirm is refused, and a late link works.
- On production after launch:
  - Run the curl probes from `notes/05`.
  - Check `previous.html` shows the 2026 section with its album.
  - Check `participants.html` is empty until someone confirms.
  - Check the console is clean on each page at phone width.

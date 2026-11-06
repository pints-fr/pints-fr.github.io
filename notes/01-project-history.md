# Project history: PINTS 2026 website

This timeline comes from the git history (122 commits, 2026-07-29 → 2026-11-06), from the Claude Code session transcripts saved for this project, and from `docs/design-notes.md`. The conference took place on **2026-11-06**.

## The starting brief (CLAUDE.md)

- Priority: logins for participants and admins, each with different rights.
- Priority: abstract submission.
- A list of registered participants' names.
- A schedule that is easy to edit, and better than an Excel screenshot.
- A poster list with abstracts.
- Standalone pages that organizers can edit, ideally in Markdown.
- Bonus: managing a mailing list.
- Constraints: Firebase for logins and data, hosted on GitHub Pages.
- Reference sites: `jmourabarbosa/compneuroparis` and `gnt20.github.io`. Both are no-build static sites in the same academic community. That they had both settled on this setup is what decided the stack.

## Phase 0 to 3: the initial build (2026-07-29 → 07-30)

Work followed a written spec and plan (`docs/superpowers/specs|plans/2026-07-29-*`). The plan used test-driven tasks, done in this order:

1. **Phase 0: static site.** Scaffold, `config.mjs` + nav utilities, a Node test loop, vendored `marked` + `DOMPurify` with two allowlists (trusted pages vs untrusted abstracts), a shared header and footer injected by `layout.js`, and Markdown-rendered pages. A self-contained `404.html` was needed for Pages.
2. **Phase 1: accounts.** Firestore rules for `config`, `admins`, `users`, plus the public projection `participants_public`. Auth, profiles, and the public participant list.
3. **Phase 2: abstracts.** Rules for the submission window and for freezing an abstract once accepted. The submission form, the admin review console, and the public poster list.
4. **Phase 3: schedule and settings.** The schedule editor, a settings tab, and the public program page.
5. Follow-up fixes:
   - Admins are also participants and needed their own account page.
   - Bugs in the email-verification gate.
   - A stale dynamic `import()`.
   - The web API key was explained as public.
   - Content was migrated from the 2025 site.
   - The first `design-notes.md` was written.

## Rework round (2026-08-16 → 08-22)

The organizers tried the site and asked for changes, some of which reversed earlier decisions:

- **Abstract IDs went back and forth.** One per person (`abstracts/{uid}`) became many per person (auto ID), then one per person again. The last switch was made because only a uid-keyed document lets the *rules* enforce "one each".
- **Page-copy write-back to GitHub** (a token in the browser) was built, shipped, and then removed. Page copy now lives in Firestore, and `content/*.md` is only the seed and fallback.
- **Guest submission** (submitting without an account) was built, then removed. The site went back to "register first, verify your email, then submit". Abstracts tied to unverified accounts left organizers unable to reach their authors.
- **Organizer delete** required the first Cloud Functions, because only the Admin SDK can delete someone else's Auth account and Storage rules cannot read Firestore. Functions became the home for "needs to bypass the rules or keep a secret" and nothing more.
- **Per-organizer review** was introduced: a score and private note per reviewer in a map, merged on save.
- Abstracts gained **figures** (Storage, which moved the project to the paid **Blaze** plan), a topic, an opt-out from talk consideration, statuses `submitted` / `accepted` / `rejected` (`withdrawn` was retired), and collapsible lists with figures that load only when a row is opened.
- New features in this round:
  - Program **sessions** derived from runs of consecutive items.
  - A **logo** with its text converted to outlines.
  - A slideshow of **home hero photos**.
  - **Archive albums** for each past edition.
  - A **contact form** (a function sends the mail).
  - An "Add to calendar" menu.
  - Speaker photos.
  - A hamburger menu for small screens.
  - A sign-out dropdown.
- **Moving to the `pints-fr` org and the `pints.fr` domain** (08-19), which involved:
  - GoDaddy DNS records.
  - Firebase custom email domain so mail is sent as `pints.fr`.
  - Adding an **MX record**. Without it, `@cnrs.fr` received nothing.
  - A failed attempt to host the email action handler (Firebase allows only its two default URLs).
- Speed: committed Markdown now renders before Firestore loads, and public reads use a **separate Firestore client that never touches Auth**.

## Operating season (2026-09 → 11), feature requests during the live call for abstracts

Each request was handled in its own Claude Code session. The usual loop was: build it, run it locally on the emulators for the user to try, deploy the rules if needed, then commit and push.

| Date | Request | Result |
|---|---|---|
| 09-09 | Figure only needed if the abstract is up for a talk | Figure and caption required only while it is being considered for a talk |
| 09-23 | "Could not save your abstract" for a test participant | Rules rejected the `null` figure the client sends, and admins never noticed because they bypass validation. Fixed the rules and added a test that uses the exact client payload. Lesson: the local checkout was behind origin |
| 10-09 | Close registration; admins can edit abstracts after the deadline | `registrationOpen` switch; admin edits no longer blocked by the window |
| 10-09 | Late registration link | Single-use, expiring `registration_links/{token}`, spent in the same batch that creates the profile |
| 10-11 | Blind reviewer mode | Authors hidden, other reviewers anonymized, export limited to your own review. Toggle moved to the Abstracts tab; **1–4 scale** (veto / ok / good / accept) with a veto count |
| 10-12/20 | Delete-all-reviews button | Removed, then restored (now clears scores and comments, after a confirmation with live counts) |
| 10-13 | Party page | `party.html` editable by admins, an "Insert image…" uploader in the Pages editor, linked from program items of kind `social` |
| 10-19 | Edit after the deadline but not create | A separate **editing window**. Participants can **Retract** (accepted talks cannot). **Per-abstract publish settings** (full abstract vs title and authors only). Figures are never public |
| 10-27 | Bulk poster acceptance, renumbering, program→abstract links | "Accept N as posters", "Renumber", and a "Linked abstract" on program items. Submit button hidden while submissions are closed |
| 10-29 | Best-poster voting | `poster_votes/{uid}` (one vote each), `vote.html`, admin Voting tab, and a home-page button while voting is open |
| 10-30 | Two poster sessions, session chairs, contact mail to one inbox | Posters dealt alternately into sessions P1-x / P2-x; abstracts page grouped by session |
| 11-02 | Late editing for one person | `edit_grants/{uid}` with an expiry; the grant itself is the permission, so the link can't be passed on |
| 11-03 | Single-use late *submission* link | `submission_links/{token}`, the same pattern as registration links |
| 11-04 | Delete individual votes; block co-authors from voting for their own poster | The name is matched in both page code and rules (rules cannot strip accents, so the admin tab flags those ballots) |
| 11-04 | Abstracts for invited talks | An `abstract` field on program items, shown in Keynotes and Invited talks sections of the abstracts page and linked from the program |
| 11-05 | Hide posters with no votes in the ranking | — |
| 11-05/06 | Sponsor logo and text swap (IHU FOReSIGHT) | Edited the combined sponsor PNG and `home.md` |
| 11-04 | *(Stopped by the user)* Guess each participant's lab to block votes for their own lab's posters | Not built |

## What changed direction, and why it matters for the next site

1. **One record per person, keyed by uid**, came up three times: abstracts, votes, and edit grants. Decide this early, because it is the cheapest way to make a limit that the rules can enforce.
2. **Gates moved more than once**: verification moved off submission, then back on. Expect the organizers to change policy, and keep each gate in one rule function plus one page-side check.
3. **Every deadline grew an exception**: late registration links, late submission links, an editing window, and edit grants for one person. Build the "window + exception token" pattern once and reuse it (see 03 and 04).
4. **Review needs kept growing**: a shared note became per-reviewer scores, then blind mode, a 1–4 scale with vetoes, bulk actions, sessions, and voting. Plan the review console as the site's most-used admin screen.

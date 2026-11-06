# Feature recipes

For each feature: what it does, how it is built, and the details that mattered. File names refer to this repo.

---

## Accounts and registration

**Pages:** `register.html` (name, affiliation, email, password), `login.html` (sign in and password reset only), `account.html`.

1. Register: `createUserWithEmailAndPassword`, then send the verification email, then write `users/{uid}`, which is private.
2. **The public listing waits for verification.** The verification link lands on `account.html`, which forces a fresh token (`user.reload()` + `getIdToken(true)`, because `email_verified` in the token is stale for up to an hour) and then writes `participants_public/{uid}`. The write is idempotent and runs on every load, so an interrupted registration fixes itself.
3. A **scheduled function** (`backfillParticipants`, every 5 minutes) publishes verified users who never reopened `account.html`, for example someone who opened the link on another device. It uses `create()`, so it never overwrites an organizer's correction.
4. Report "account created" and "verification email failed" **as two separate outcomes**. Otherwise people try to sign up again, get `email-already-in-use`, and conclude the site is broken.
5. Every page that is waiting on verification has a **resend button** and a link to the contact form. Organizers can also confirm an address by hand (callable `verifyParticipantEmail`) when an institutional filter eats the mail.
6. `?next=` carries the target page through login and registration. `redirect-utils.mjs` accepts only "one page of this site + optional #fragment", so the parameter can't be used as an open redirect.
7. **Closing registration:** `config/site.registrationOpen`. The rules refuse new `users/` docs, and the page shows "Registration is closed". It can't stop Firebase Auth from creating a bare account (that would need an Identity Platform blocking function). Such an account just never gets a profile or a public listing.
8. **Late registration links:** see 03 §5. Admin › Settings has "Valid for 24h / 3d / 7d", Generate, Copy, Revoke, and a table showing who used each link. `register.html?link=…` keeps the form open for one registration. While registration is open, a link is ignored and not spent.

**Organizers are participants too.** The nav must show both "Admin" and their own account and abstract.

---

## Abstract submission

**Pages:** `submit.html` and `abstracts.html` (signed-in owners also manage their abstract there). Logic lives in `abstract-form.js`, `abstract-validation-utils.mjs`, `submission-view.js`, and `db.js`.

- **Register first, verify, then submit.** The rules require `isVerified()`. Guest submission was tried and dropped (01-project-history).
- One abstract per person: `abstracts/{uid}`.
- Fields:
  - Title, authors (with affiliation indices; can be reordered), affiliations.
  - Body (restricted Markdown, ≤2500 characters).
  - Topic.
  - `talkConsidered` (an opt-out from being considered for a talk).
  - Figure + caption. **Required only while being considered for a talk.**
  - Publish choice.
- **Validate twice.** A pure validator gives readable errors, and the rules check the same thing for anyone calling the API directly.
- **The live preview is the real card.** Use the same `abstract-card.js`, and point the figure at an `objectURL`. Listen for `input` on the **form**, not on each field, because author rows are added after the page loads.
- **After submitting, show the stored record**, read back from Firestore, as a card with Edit and Retract buttons. Pages that show "your submission" must use one shared view (`submission-view.js`). Otherwise two pages disagree.
- **Statuses:** `submitted` ("In review"), `accepted`, `rejected` ("Not accepted"). `withdrawn` was retired, and the admin button that used to set it is now "Return to review".
- **Windows:**
  - The *submission window* (`submissionsOpen` + `submissionDeadline`) controls creating and resubmitting.
  - The *editing window* (`editingOpen` + `editingDeadline`) controls editing, retracting, and the publish choice.
  - After submissions close, an edit keeps the current status, so a rejected abstract can't re-enter review.
  - Accepted posters can be retracted. Accepted talks can't, because the program depends on them.
- **Exceptions to the windows:**
  - Late submission links: `submission_links/{token}`, `submit.html?link=…`, one *new* abstract.
  - Late editing grants: `edit_grants/{uid}`, `submit.html?edit=1`.
  - Admins can always edit, and the console rewrites the public copy in the same batch.
- **Publish settings:**
  - Owners choose either "title, authors and abstract" or "title and authors only", and tick a box to confirm.
  - Accepted abstracts with no confirmed choice are shown as title + authors (`pending`) until the editing deadline.
  - After that, an organizer clicks "Apply publish settings" to apply the default (`full`).
  - A one-click "Publish title and authors only" shortcut sits on the card.
  - **Figures are never public.** Only reviewers see them.
- **Hide the Submit buttons while submissions are closed.** If the config read fails, leave them visible: `submit.html` explains the situation anyway.

---

## Review console (Admin › Abstracts)

- **Reviews are per reviewer.** They are stored in `abstract_reviews/{id}` as a map keyed by reviewer uid and **merged**, never set, so that two reviewers saving at the same moment don't overwrite each other.
  - Accept and reject record who decided and when. They never touch reviews. (Once, a shared note loaded asynchronously and was written back on Accept, wiping it.)
- **Scale: 1–4** (1 veto: reject · 2 ok · 3 good · 4 accept).
  - Show the **veto count** next to the mean, because a mean of 3.3 hides a veto.
  - A note with no score counts as a review but doesn't affect the mean.
  - Scores from the old 1–10 scale above 4 are ignored, and the reviewer is asked to rescore.
- **Sorting:** by mean score **within each topic, never across topics**. **Unscored abstracts sort last in both directions.** Ties are broken by title, so rows don't shuffle on re-render.
- **Filters:** text, status, talk/poster, talk opt-out, topic. The console has collapsible rows with "Expand all", and remembers which rows are open across re-renders.
- **Blind reviewer mode** (`config/site.reviewerMode`, a toggle at the top of the Abstracts tab):
  - Authors and affiliations are hidden, other reviewers' scores and comments are hidden, and the export contains only your own review.
  - Accept, reject, delete, and bulk actions are hidden.
  - **This is a UI convention, not access control.** Any admin can turn it off. Say so plainly to organizers.
  - Outside blind mode, other reviewers appear as "Reviewer n".
- **Exports:** abstracts CSV, scores-and-comments CSV.
  - "Delete all review scores and comments" first counts what will be deleted and asks for confirmation. Export before using it.
- **Bulk tools:**
  - "Accept N in review as posters" accepts in on-screen order and numbers after the last board in use.
  - "Renumber posters in this order".
  - "Split posters into two sessions" deals posters alternately within each topic.
  - "Renumber within sessions".
  - A session select on each card. Board codes look like `P1-3`.
- **Open item:** poster numbers aren't enforced as unique. That's fine for one organizer working at a time. Use a transaction if several organizers will do this at once.

---

## Public lists

- `participants.html` reads `participants_public` (with a load timeout and a loading state).
- `abstracts.html`:
  - Collapsed rows: board or talk badge, title, "First Author et al.".
  - Grouped as Keynotes → Invited talks → Talks → Poster session 1 → Poster session 2. Search and topic filter.
  - The body is built only when a row is opened.
  - Remove `loading="lazy"` from figures revealed by a disclosure: a 0×0 image never counts as intersecting, so it never loads.
  - `beforeprint` opens all rows.
  - `?a=<id>` deep links open and scroll to an abstract. Only accepted abstracts are public. An unknown ID and an unaccepted one get the same answer, so a missing page never gives away a decision.

---

## Program / schedule

- `schedule/{autoId}` with `start`/`end` (one day, one room, so `start` alone sets the order), `title`, `speaker`, `affiliation`, `kind` (`keynote|talk|poster|break|lunch|social|other`), optional `session`, `abstractId` (link to a submitted talk), `posterSession`, and `abstract` (an invited speaker's abstract, sanitized like participant text).
- **Sessions are derived, not stored.**
  - `groupScheduleBySession()` groups **consecutive runs** of items with the same session.
  - It numbers them I, II, III in order of time and takes banner text from `SESSION_LABELS`.
  - A misfiled item shows as a split block rather than quietly reordering the day.
  - Session chairs are stored in `config/site.sessionChairs` and shown on the banner.
- Links:
  - A talk links to its abstract (an explicit `abstractId`, or else a published talk with the same title).
  - Poster slots link to their session heading.
  - `kind: social` links to the party page.
  - Invited abstracts link to the Keynotes / Invited talks sections on `abstracts.html`. They were moved there from an inline fold in the program because the fold was hard to read on phones.
- An "Add to calendar" menu (Google, Outlook, ICS) is built from `EVENT` in `config.mjs`, with an explicit time-zone offset.

---

## Organizer-editable pages

- `content/<slug>.md` is committed. `pages/{slug}` in Firestore overrides it. `content-hydrate.js` renders the file first and swaps in the Firestore version when it arrives. The file is also the fallback if Firestore is down.
- Admin › Pages:
  - A Markdown editor with preview and "Save and publish".
  - "Insert image…" downscales the image, uploads it to `page_images/`, and inserts Markdown at the cursor.
  - `<div class="photo-row">` puts images side by side.
- HTML is allowed in page copy (`span`, `div`, `u`, `s`, `small`, `mark`, plus `style` and `class`), with `style` filtered.
  - Gotcha: `<div>**x**</div>` prints the asterisks. Put a blank line inside the div so the content goes back to the Markdown parser.
- A write-back to the git repo was built and then removed (it needed a GitHub token in the browser). Accept that `content/*.md` will drift from the live copy, and sync it by hand now and then.
- New page: add `x.html` (copy an existing one), `content/x.md`, a `NAV` entry, and a slug in the Pages editor list.

---

## Best-poster voting

- `poster_votes/{voterUid}` = `{posterId, edition, updatedAt}`. One vote each, and changing it overwrites. Withdrawing is allowed while voting is open.
- The rules require:
  - Voting is open (`config/site.votingOpen`, fails closed).
  - The voter is verified and has a `users/` profile.
  - The candidate is an accepted **poster** of this edition.
  - It isn't the voter's own abstract (`posterId != uid`).
  - The voter's registered name doesn't match any author (unrolled check over 20 authors).
- The page applies the same rules, plus accent folding, and greys out ineligible posters as "— your poster".
- Admin › Voting:
  - Open/close switch.
  - Stats.
  - Ranking (hides posters with no votes and reports how many were hidden).
  - Ballot table with who voted for whom, a "Voter is an author" warning flag, and a per-ballot Delete button.
  - CSV export.
- The home page shows a "Vote for the best poster" button only while voting is open, and hides it if the config can't be read.
- Not built: "no votes for your own lab". It would need lab affiliation for each participant, which the site doesn't collect. Ask for a lab/team field at registration if you want this.

---

## Photos: home hero and archive

- `config/hero`: up to N photos, uploaded from Admin › Home photos and shown as a slideshow behind the logo. Visual gotchas:
  - Put the duotone tint on each slide's `::after` with `isolation: isolate`, not on the container, or an empty hero gets tinted.
  - Write fades as `rgb(from var(--c) r g b / 0)`, not `transparent`, which fades to black.
- `gallery/{year}`: one album per past edition on `previous.html`, placed under the `<h2>` whose text contains that year. If no heading matches, it goes at the bottom of the page.
- Photos imported from the hero are shared, not copied. The path prefix (`archive/` vs `hero/`) decides who may delete. Removing a hero photo checks the albums first.
- An optional Dropbox sync (a callable holding the token, writing a cached document to Firestore) was built and then taken out of the deploy.

---

## Contact form

- `contact.html` writes `contact_messages/{id}` (validated in the rules: topic from a fixed list, length caps). `mailContactMessage` (`onDocumentCreated`) sends it by SMTP to one shared inbox, with `Reply-To` set to the sender.
- The SMTP user and password are function **secrets**. Deploying `functions/` fails until they are set.
- Gmail sends the contact mail, so its `From` must stay a Gmail address. The `pints.fr` SPF record covers Firebase's servers, not Gmail's.

---

## Admin and organizer powers

- Admin console tabs: Abstracts · Schedule · Pages · Participants · Voting · Home photos · Archive · Settings.
- Settings covers:
  - Meeting date.
  - Submission window, editing window, and registration switch.
  - Late registration and submission links, and late edit grants.
  - Granting admin rights (writes `admins/{uid}`).
- Participants: correct a name or affiliation (updates the public copy too), confirm an email by hand, delete a participant (callable: Auth account + profile + abstract + figure). Exports.
- Organizers see a confirmation dialog (`confirm-dialog.js`) before every destructive action.

---

## Mailing list (bonus)

Not built as a sender. **CSV export of participants** stands in, and organizers use their own mail client. Real sending needs a paid mail service plus a function.

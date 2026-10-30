# PINTS conference website

Static site for the PINTS meeting (Paris Île-de-France Neuroscience, Theory, and
Systems). No build step: the repository contents *are* the deployed site.

- **Live site:** <https://pints-fr.github.io/>
- **Design notes and lessons:** [`docs/design-notes.md`](docs/design-notes.md) —
  start here if you are picking this up. Why the architecture is what it is, and
  the traps that cost time the first time round.
- **Design spec:** `docs/superpowers/specs/2026-07-29-pints-website-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-07-29-pints-website.md`

## Status

**Phase 0 (static site) is complete and deployed** at
<https://pints-fr.github.io/>. Every page and asset serves, markdown
renders, the custom 404 works, and the browser console is clean.

**All three phases are built, deployed, and live.** Every requirement in
`CLAUDE.md` is implemented except the bonus mailing-list *sending*, which needs a
paid Firebase plan; the CSV export stands in for it.

- **Accounts** — a registration page that takes a name, an affiliation and an
  email, a separate sign-in page, password reset, and email verification.
  Confirming the address is what puts you on the public participant list: there
  is no opt-in, and no button. See "Registering and being listed".
- **Abstracts** — **one per participant**, with a topic (cognitive / systems /
  computational), a **required figure and caption**, a live preview, and an
  opt-out from being considered for a talk. **Register first, then submit** —
  `submit.html` needs a signed-in account with a confirmed address. Admin review with a
  per-organizer 1–10 score and private note, filters (text, status, talk/poster,
  talk opt-out, topic), two CSV exports, poster-vs-talk assignment, poster
  numbering, accept/reject/unpublish. Public list with search and a topic filter.
- **Pages** — organizers edit page copy in the admin console; edits live in
  Firestore and `content/*.md` remains the seed and the read fallback. See
  "Editing page content".
- **Schedule** — admin editor for a single-day program, ordered by start time;
  public program page headed by the meeting date from Settings. An item may be
  tagged with a *session* (the three abstract topics, plus Keynote Lectures);
  consecutive items sharing one are printed as a tinted block under a banner —
  "Session II — Computational Neuroscience" — numbered by where it falls in the
  day, so inserting a session never means renumbering the rest. Coffee, lunch and
  the poster slot are left untagged and print between the blocks.
- **Settings** — set the meeting date, open/close the submission window, set the
  deadline, grant admin rights. No Firebase-console workarounds remain for
  day-to-day organizing.
- **Archive** — one album per previous edition, uploaded straight from the admin
  console or imported from the home page photographs, and shown under the heading
  that names its year. See "Photographs of previous editions".
- **Home photos** — the photographs that slide past behind the logo on the home
  page, uploaded straight from the admin console. See "Photographs behind the
  home page hero".
- **Organizer edit and delete** — organizers can correct a participant's name or
  affiliation, edit any abstract at any status, and delete an abstract or a
  participant outright. See "Editing and deleting as an organizer".
- **Contact** — `contact.html` takes a name, an address, a topic and a message
  and mails it to pints.conference@gmail.com, with Reply-To set to the sender. Reachable
  from the home page hero and the footer of every page. See "Contacting the
  organizers" — **the mail needs two SMTP secrets set before `functions/` is
  deployed at all.**

116 security-rules tests and 204 unit tests cover this.

### Deploying rules — order matters

**`firestore.rules` and `storage.rules` must be deployed *before or with* the
code that depends on them.** Pushing a page that reads a new collection while the
old ruleset is live gives users "Missing or insufficient permissions" even though
the emulator tests pass. After changing rules:

```bash
npm run test:rules
npx firebase deploy --only firestore:rules,storage
```

The site content is still placeholder: the edition dates, venue, keynote, and
organizer contacts all need filling in via `content/*.md`.

## Registering and being listed

Registration is one form, `register.html`: full name, affiliation, email,
password. It creates the Firebase Auth account, sends the confirmation email,
and writes `users/{uid}` — the private profile.

**It does not put anyone on the participant list yet.** That happens when the
address is confirmed: the verification link lands on `account.html`, which forces
a fresh ID token (`refreshVerification()` — the token's `email_verified` is stale
for up to an hour otherwise) and, when it comes back true, writes
`participants_public/{uid}`. There is no opt-in checkbox and no button; the write
is idempotent and runs on every account-page load, so a registration interrupted
between the two writes heals itself the next time the person opens their account.

### Being listed without ever loading account.html

One route skips that hook: opening the verification link on a device where you
are not signed in. The page redirects to sign-in and the write never happens.

It cannot be fixed in the browser, because `participants_public` may be
written only by its owner or an organizer and the person in question is signed
in nowhere. So `backfillParticipants` in `functions/` sweeps up the difference:
every five minutes it compares verified Firebase Auth accounts against the
public list and publishes anyone with a profile who is missing from it. It
**never overwrites** an existing entry — it writes with `create()`, so a name an
organizer corrected in the admin console cannot be reverted by it, and a race
with the client's own publish resolves harmlessly.

Five minutes rather than one: the client-side path already covers the common
case immediately, so this is a safety net, and sweeping the whole list twelve
times an hour would bill Firestore reads for nothing. Widen or narrow it by
editing the `schedule` in `functions/index.js`. If the list is ever visibly
lagging, that is the number to look at.

`login.html` is sign-in and password reset only. Both pages carry a `?next=`
target through registration, so "Submit an abstract" on the home page brings a
signed-out visitor back to `submit.html` once they have an account.
`js/redirect-utils.mjs` validates that target against a deliberately narrow
pattern — one page of this site, optionally with a fragment — so the parameter
cannot be turned into an open redirect.

## One abstract per participant

**The abstract's document id is the owner's uid.** That is what makes "one each"
real rather than advisory: there is no second slot to create, no rule has to
count anything, and Firestore rules cannot count documents anyway. `ownerUid`
stays as a field because the review console joins submitter details on it and
`deleteParticipant` queries it.

A **figure and a caption are both required**, enforced in
`js/abstract-validation-utils.mjs` for a readable error and again in
`firestore.rules` for anyone holding the public API key. Organizers writing
through `allow write: if isAdmin()` skip the check, so a record that predates the
requirement can still be repaired.

There are **three statuses**: `submitted` (shown as "In review"), `accepted` and
`rejected` ("Not accepted"). `withdrawn` was retired — it existed only so the
admin's Withdraw button had somewhere to put an abstract it pulled off the public
list, and that button is now **Return to review**, which writes `submitted`. A
document that still holds the old value reads as "In review" and normalises on
its next save.

Only an **accepted** abstract is frozen to its owner: the participant's "Edit
submission" button is disabled and the form behind it is read-only. A rejected one
stays editable, and with a single slot per person that matters more than it used
to — a rejected participant would otherwise be unable to revise, delete, or
replace their submission, because there is nowhere else to put a second attempt.

### One renderer, four places

`js/abstract-card.js` draws an abstract, and it is the only thing that does: the
public list, the live preview inside the submission form, the shared-link page and
the confirmation shown after a submission all call it. That is what lets the form promise "exactly
what the abstract list will show" — with a second renderer nearby the promise
would be a guess. The preview updates on every keystroke and includes the figure
and its caption; it leaves out the poster number and the talk pill, which are the
committee's to assign.

After a save, `submit.html` shows the stored abstract as that same card, with the
status and an **Edit submission** button, rather than leaving the filled-in form
on screen behind a green line. Arriving with an abstract already on file shows the
same view, because it is the same state. `account.html` does exactly the same,
through the shared `js/submission-view.js` — a participant meets their own
abstract on two pages and they must not disagree about what it looks like.

### Sharing an abstract

The public list is **collapsed and grouped**: topic headings in the order
`ABSTRACT_TOPICS` declares them (anything unrecognised lands in a trailing
"Other"), and one row per abstract carrying the poster board number or a talk
pill, the title, and the presenting author with "et al." Clicking a row opens it.
**The body is built on first open, not at render time** — a poster session runs to
hundreds of abstracts, and a `<details>` that already contains its `<img>` still
fetches it. **Expand all** opens everything, and a `beforeprint` handler does the
same automatically, so printing the page yields an abstract book rather than a
list of titles.

`abstracts.html?a=<id>` renders one abstract on its own, sets the tab title to
its title, and offers a way back to the list; every row in the list carries that
link. The status a submitter sees is **In review** until a decision is taken and
then **Accepted as a talk** or **Accepted as poster P12**
(`submissionStatusLabel`).

The share link appears **only once the abstract is accepted**. `abstracts_public`
is the world-readable copy and holds accepted abstracts only; a link to one still
in review resolves for its author and for nobody else, which is worse than no
link. For the same reason an unknown id and an unaccepted one give the same
answer — saying which would leak a decision that is not the site's to announce.

### Register first, then submit

`submit.html` is behind two gates, in that order, and both are real rather than
decorative.

**Signed out → sign in.** `requireUser()` redirects to
`login.html?next=submit.html`, so somebody who followed the home page's "Submit
an abstract" button lands back on the form once they have an account, rather than
on a generic account page with no clue what they came for. The home button itself
is rewritten to that sign-in URL as soon as Firebase resolves auth state; the
static `href` stays `submit.html`, which is the right destination for everybody
else and the right fallback for a click that beats the rewrite, since
`submit.html` redirects to exactly the same place.

**Signed in but unconfirmed → confirm.** The form is not mounted at all. A panel
says so, names the address, points at the spam or quarantine folder that
university filters use, and carries its own **resend** button. The moment
somebody discovers the mail never arrived is right there on the page they came
to use, not on a later visit to `account.html`. There is no button to reload
the page and check again — reloading is what a browser already does, and a
button whose only job is that adds nothing a person does not already know how
to do.

If the mail never arrives at all rather than lands in spam — a gateway that
drops it outright, not one that quarantines it — resending cannot help either.
The panel's last line sends that person to `contact.html`, and organizers can
now confirm the address by hand from the Participants tab; see "Editing and
deleting as an organizer" below.

There is no "Your details" block on the form any more. Name, affiliation and
email belong to the account by the time anyone reaches it, and the profile is
edited on `account.html`. What the form does still take from the profile is the
seed for the first author row and the affiliations box.

**Why the account has to exist first.** `firestore.rules` keys the abstract on
the owner's uid and `storage.rules` keys the figure on the uploader's, so an
unauthenticated visitor cannot write either; opening those up would hand the
collection to anyone holding the public API key.

**Verification is enforced in the rules, not just the UI.** `allow create` and
`allow update` on `abstracts/{uid}` require `isVerified()`, i.e.
`request.auth.token.email_verified`. `js/abstract-form.js` mirrors it — an
unconfirmed address renders the form read-only with a notice rather than letting
somebody fill it in and collect a `PERMISSION_DENIED` on the last click — and
organizers are exempt from both, because `allow write: if isAdmin()` already
covers them.

That token is refreshed (`refreshVerification()`) before either page decides
anything on it: clicking the verification link does **not** update the token a
tab already holds, and it stays false for up to an hour. A stale token is what
used to make a first submission fail and then "fix itself" later.

**Reading is never gated.** An abstract already on file is shown whatever the
address's state — the card, the status, the share link if it is accepted. It is
the editor behind it that closes.

## Reviewing abstracts

The Abstracts tab collapses to one row per abstract — the coloured status pill,
the title, the presenting author, and the mean score with how many organizers
scored it — because the review screen has to survive the same hundreds the public
list does. Rows open in place, their bodies built on first open, and **open rows
survive the re-render** that follows every accept, reject and review save.

**Expand all** opens every row on screen — collapsing leaves the row holding the
editor alone, since the form is mounted inside the body and closing it would hide
a half-typed draft.

**Sort within topic** orders each topic group by mean score, highest or lowest
first, or by title. Always within a topic: a mean of 7.4 in cognitive against 7.6
in systems compares two panels' scoring habits, not two abstracts. Unscored
abstracts sort last in *both* directions — "no score" is not a low score, and in
"lowest first" they would otherwise bury the abstract the committee actually
rated worst.

It filters on free text, status, presentation (talk / poster / not
published yet), the submitter's **talk opt-out**, and topic, and both CSV exports
cover exactly what the filters are showing — the button row says so when they are narrower than the whole pile.

**Every organizer has their own 1–10 score and their own private note.** They are
stored as a map keyed by reviewer uid inside `abstract_reviews/{abstractId}`, and
written with a merge into that nested map rather than a whole-document set — two
organizers reviewing the same abstract at the same time must not overwrite each
other. A note without a score counts as a review ("conflict of interest,
abstaining") and does not drag the mean down.

Notes written before scores were per-organizer are shown read-only, labelled as
earlier shared notes. They are not migrated: they belong to whoever wrote them,
and nothing records who that was.

Two exports:

| Button | Contents |
|---|---|
| Export abstracts (CSV) | one row per abstract: title, topic, status, presentation, poster number, authors with affiliation marks, submitter and email, figure caption and URL, dates, body |
| Export reviewer scores (CSV) | one row per abstract, **one column per organizer**, then the mean and how many scored it. An organizer who has scored nothing still gets a column — an empty one is a fact worth seeing |

### "Update published copy" — what it is for

On an abstract that is already accepted, the accept button reads **Update
published copy**, and it is not a second acceptance. It is the only control that
can change poster ↔ talk or the board number after acceptance, and the only one
that pushes an edit made elsewhere into `abstracts_public`. Withdraw-then-accept
would do the same thing while removing the abstract from the public list in
between.

It used to restamp `acceptedAt` on every click, so "when was this accepted"
became "when did somebody last touch it"; the original is now carried through.
It also used to write the reviewer-note textarea on every click, and that
textarea was filled asynchronously after the card rendered — a fast click saved
an empty note over a real one. Accept and reject no longer write notes at all.

## Photographs of previous editions

The Archive page carries one album per edition: a slideshow with a thumbnail
strip under it, fed from `gallery/{year}` in Firestore.

**It advances on its own every `ARCHIVE.intervalMs` (7s), like the home page
hero — until a reader touches it.** Pressing an arrow, a thumbnail or an arrow
key stops the automatic advance for good: somebody paging through an album is
looking at a particular photograph, and having it slide away seven seconds later
is the carousel arguing with them. Hovering or tabbing into the album pauses it
without ending it, so reading a caption is not interrupted. It never starts at
all under `prefers-reduced-motion`, or for an album of one, and it stops while
the tab is in the background. Those on-screen controls are also the pause
mechanism WCAG 2.2.2 asks of anything that moves by itself for more than five
seconds.

**Each album sits under the heading that names its edition.** Nothing marks the
spot in the page copy — the markdown sanitizer allows `class` but not `id`
(`PAGE_ALLOWLIST` in `js/markdown-render-utils.mjs`), so there is no stable
handle to type there, and a class name an organizer has to remember is one that
will eventually be misspelt. Instead `yearInHeading()` reads the year out of each
`<h2>`, so "PINTS 2025" and "The 2025 meeting" both find 2025. An album whose
year appears in no heading falls back to a section at the foot of the page rather
than vanishing.

### Adding photographs

In the admin console's **Archive** tab: type the year, press **Add photographs**,
pick files. They are downscaled in the browser to `ARCHIVE.maxEdge` and uploaded
to `archive/{uid}/{id}` in Firebase Storage, and the list is written immediately —
objects already in the bucket that no list mentions are a leak. Captions, order
and removal are edited per edition and applied with **Save**.

**Import the home page photographs** copies the hero's list into the year in the
field. It shares the Storage objects rather than copying them: the photographs
behind the hero are already downscaled and already in the bucket. Pressing it
twice adds nothing the second time — `importedFromHero()` matches on `path`, not
on the download url, which carries a token that can be reissued for the same
object.

### Which object may be deleted, and by whom

Each photo entry carries a `path`, and **the prefix is the delete permission**
(`ownsObject()` in `js/album-utils.mjs`):

| `path` | Uploaded by | Removing the entry deletes the object? |
|---|---|---|
| `archive/{uid}/{id}` | the Archive tab | yes |
| `hero/{uid}/{id}` | the Home photos tab | **no** — the home page still points at it |
| `""` | a Dropbox sync | no — not ours to delete |

An imported photograph is one object on two lists, which is what makes the import
free. It also means the coupling runs both ways, so `js/admin-hero.js` reads the
albums before deleting anything on Save and skips any object one still
references. Without that, removing a photograph from the hero would blank it on
the Archive page, where it is the point rather than a tint.

The thumbnail strip points at the same full-size objects as the stage — there is
one size of each photograph in Storage. `loading="lazy"` and the album sitting
below the fold keep that off the critical path, and a dozen photographs is fine.
An album past thirty or so would want a smaller object generated at upload time.

### Syncing from Dropbox instead

> **The sync is not deployed.** Its callable was temporarily removed from
> `functions/index.js` so the rest of the functions could ship — see "Editing and
> deleting as an organizer" for why and how to restore it. Everything below is
> accurate and the browser half is untouched; only the Sync button is inert, and
> the Archive admin tab says so. Uploading is unaffected and is the ordinary path.

For a year whose photographs already live in a Dropbox folder, an organizer
pastes the folder link under **Sync a year from Dropbox instead** and presses
**Sync from Dropbox**; captions survive later syncs, matched by file name.

**A browser cannot list a Dropbox folder.** Every Dropbox listing endpoint needs
an `Authorization` header, and a static site has nowhere safe to keep one — this
is the same problem that got the GitHub write-back removed (`docs/design-notes.md`
§3.2b). So the token lives in the `syncDropboxGallery` callable, the result is
cached in Firestore, and visitors never call a function at all.

### Setting up the Dropbox app

1. <https://www.dropbox.com/developers/apps> → **Create app** → **Scoped access**
   → **Full Dropbox** → name it. Under **Permissions**, tick `sharing.read` and
   `files.metadata.read`, and **Submit**.
2. On the **Settings** tab, note the **App key** and **App secret**.
3. Get a refresh token. In a browser, visit (one line, your app key substituted):
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline
   ```
   Approve, copy the code it shows, and exchange it:
   ```bash
   curl -u APP_KEY:APP_SECRET https://api.dropbox.com/oauth2/token \
     -d code=THE_CODE -d grant_type=authorization_code
   ```
   The `refresh_token` in the reply does not expire. An *access* token would —
   after four hours — which is why this is the one we store.
4. Store all three as secrets, never in the repository:
   ```bash
   npx firebase functions:secrets:set DROPBOX_APP_KEY
   npx firebase functions:secrets:set DROPBOX_APP_SECRET
   npx firebase functions:secrets:set DROPBOX_REFRESH_TOKEN
   npx firebase deploy --only functions
   ```
5. In Dropbox, share the photo folder with **Anyone with the link**, copy that
   link, and paste it into the Archive tab with the year.

**The site works without any of this.** The Archive page is exactly what it was
before there were photographs if the gallery is empty, the function is not
deployed, or Firestore is unreachable — the slideshow mounts nothing at all.

Two limits worth knowing: at most 200 photographs a year (`ARCHIVE.maxPhotos`,
and enforced in `firestore.rules` and the callable too), and Dropbox caps
public-link bandwidth at 20 GB/day on a Basic account. A conference gallery is
nowhere near either — and photographs uploaded here go to Firebase Storage, which
is where this note used to say they should end up.

## Photographs behind the home page hero

The home page hero — the burgundy band holding the logo and the three buttons —
can carry photographs of the meeting, sliding past one at a time behind the type.
An organizer uploads them in the admin console's **Home photos** tab: press **Add
photographs**, reorder with the arrows, type a description, and press **Save**.
Up to twelve.

**With no photographs set, the hero is exactly the flat band it has always been.**
That is the default and the fallback: an empty list, a Firestore read that fails,
or a browser that cannot reach Storage all end at the same place. Nothing about
the landing page depends on the photographs arriving.

**The whole band is a link to `previous.html`**, where the same photographs are
shown at full size with captions, and a small **More photographs in the Archive**
chip in the bottom-right corner says so. Clicking anywhere that is not one of the
three buttons follows it — the chip answers "is this clickable?", and the
band-sized target means nobody has to hit the chip to act on the answer. It
appears only when the slider actually mounted something, so a hero with no
photographs is not clickable and carries no chip.

Four things make that work, and all four are load-bearing:

- `.hero .wrap` is `pointer-events: none`, with `a` and `button` inside it
  switched back on. The wrap spans the full 62rem column across the middle of the
  band, so without this it would swallow every click aimed at the photographs —
  including the empty space either side of the logo, which is most of the column.
- The link sits *before* `.wrap` in the markup. Both carry `z-index: 1`, so the
  later one paints on top, which is what keeps the buttons above the link and
  clickable.
- The chip is a `span` inside the anchor, not a second anchor. Two links to the
  same page would be two tab stops announcing the same destination; this way the
  accessible name is the chip's own visible text and needs no `aria-label`.
- The chip carries its own background, because the `.hero::after` veil fades out
  at exactly the corner where it sits and would leave it over an uncontrolled
  photograph at full strength. `.hero .wrap` gains bottom padding while the link
  is present so the chip does not sit against the button row at mid widths.

Hovering anywhere in the band rings its edges and lights the chip. Raising
`--hero-photo-opacity` on hover was the obvious cue and the wrong one — see the
matched-pair note below, and note the edges are where the veil has already faded
to nothing.

They are shown faded and tinted burgundy, so they read as part of the brand
colour rather than as a photo banner — clear enough to make out the room, not so
clear that they fight the logo. Wide shots of the room or the poster session
work; close-up portraits do not, because the band is a very wide, short crop.

Two numbers in `css/styles.css` control this and **should be moved together**:
`--hero-photo-opacity` (`.45`) and the alpha in the `.hero::after` gradient
(`.78`). The veil covers the middle of the band, where the type is, so raising it
buys back the contrast that raising the opacity costs, while the left and right
thirds keep the photographs at full strength.

Where things live:

- `config/hero` in Firestore — the list: `path`, `url` and `alt` per photograph,
  in display order. World-readable, organizer-writable, and shape-checked by
  `validHero()` in `firestore.rules` because the home page renders whatever is in it.
- `hero/{uid}/{id}` in Storage — the files. The uid is in the path because
  storage rules cannot read Firestore and so cannot ask whether the uploader is
  an organizer; the Firestore write that actually puts a photograph on the home
  page is the admin-gated half.
- `js/hero-slider.js` — the slider. `js/hero-utils.mjs` is the pure half; the
  wrapping index arithmetic is shared with the archive slideshow
  (`js/slideshow-utils.mjs`).

Uploads are downscaled in the browser to `HERO.maxEdge` before they leave it, the
same canvas step abstract figures go through, so a 17 MB photograph off a camera
lands as a couple of hundred kilobytes.

The slider stops while the tab is in the background, and under
`prefers-reduced-motion: reduce` it paints the first photograph and never starts
a timer at all.

### A note on the logo's grey

The date and subtitle lines in `assets/pints-2026-header.svg` used to be the
designer's `#808080`, which manages only 3.3:1 against the bare band — under the
4.5:1 small text is meant to clear, before any photograph darkened it further. At
the current photo strength it fell to 2.4:1, which is not legible.

`GREY` in `scripts/logo/build_logo.py` is now `#5c5c5c`, the `--muted` grey the
rest of the site already uses for secondary text. That is 5.5:1 on the bare band
and **4.1:1 over the darkest photograph** — a little under AA for small text (the
subtitle renders at about 17.6px), but two-thirds of the way back from where it
was. `assets/pints-mark.svg` is unaffected: it carries the wordmark only and has
no grey in it.

`.hero::after` does the rest of the work, putting the band colour back over the
middle of the hero and fading out at the edges so the photographs stay at full
strength either side of the type. Its alpha is `.78`, which brings the date line
to **4.4:1 against a black pixel** and **4.9:1 over a mid-tone** — so it clears
AA over any real photograph, and sits just under it in the theoretical worst
case. `.80` crosses 4.5:1 outright if that matters more than the last sliver of
photo clarity behind the type; the band's edges are unaffected either way.

## Contacting the organizers

`contact.html` takes a name, an email address, a topic and a message, and mails
it to **the conference inbox, pints.conference@gmail.com** — `CONTACT_RECIPIENT`
in `functions/index.js`. It is one shared inbox rather than every organizer, so
an answered message is visible to everyone who reads it, and admin rights no
longer decide who is mailed. The address lives only in the function, so it does
not appear in the page source for harvesters to collect.

**Reply-To is the sender**, so answering is one click and the reply goes to the
visitor rather than to the mailbox the site sends from. The subject is
`[PINTS contact] Registration — Alice Dupont`.

**It does not require an account.** Somebody who cannot register, or whose
confirmation mail was quarantined, is exactly who most needs to reach an
organizer. If they *are* signed in, the form prefills their name and address and
the message records their uid, so a "my abstract will not save" mail arrives
already saying who they are.

The page is reachable from the hero on the home page and from the footer of
every page. It is deliberately **not** in `NAV`: seven items plus the auth links
already wrap onto a second row on a phone. Move it into the header by adding
`{ href: "contact.html", label: "Contact" }` to `NAV` in `js/config.mjs` if that
turns out to be the wrong call — nothing else has to change.

### How a message gets out

```
contact.html  ──write──>  contact_messages/{id}  ──trigger──>  mailContactMessage  ──> pints.conference@gmail.com
                            (firestore.rules)                   (functions/, SMTP)      Reply-To: the sender
```

The page writes straight to Firestore, exactly like every other page here. It is
**not** a callable, and that is the whole point: a callable that is not deployed
is a contact page that does nothing, whereas this records the message the moment
the rules ship and treats mail as the layer on top. So the page keeps working —
validating, storing, confirming — with nothing in `functions/` deployed at all.

The consequence is that a delivery failure must not be silent, because the
visitor has already been told the message is on its way. `mailContactMessage`
stamps the outcome back onto the document: `deliveredAt` on success,
`deliveryError` otherwise. **A message with neither is one nobody has answered.**
Read them in the Firebase console under `contact_messages` — there is no Inbox
tab in the admin console, and email is meant to be the channel.

`contact_messages` is the one collection an anonymous visitor may write, so it
is also the one new abuse surface. Two halves guard it, and neither can do the
other's job:

| Where | Guards |
|---|---|
| `firestore.rules` | the shape of one message — field allowlist, lengths, the topic vocabulary, `createdAt` pinned to the server clock, `authorUid` pinned to the caller's own uid |
| `mailContactMessage` | how many get **mailed** — past `MAX_MAILED_PER_HOUR` (20) it stores and stops sending |

Rules cannot count documents, which is why the cap lives in the function; the
function cannot stop a write, which is why the shape check lives in the rules.
Enabling **App Check** (see the web API key section) is the third layer and the
one that would stop the writes themselves.

### Setting up the mail

**Do this before deploying `functions/` at all.** `mailContactMessage` binds two
secrets, and a function whose secrets do not exist cannot be provisioned — which
fails the whole `firebase deploy --only functions`, taking `deleteParticipant`,
`deleteAbstractCompletely` and `backfillParticipants` down with it. This is the
same trap that got the Dropbox sync removed.

1. Generate a Gmail app password — <https://myaccount.google.com> → **Security**.
   2-Step Verification must be on, then **App passwords** → one for Mail.
2. Store both values as secrets, never in the repository:
   ```bash
   npx firebase functions:secrets:set CONTACT_SMTP_USER      # the Gmail address
   npx firebase functions:secrets:set CONTACT_SMTP_PASSWORD  # the 16-char app password
   npx firebase deploy --only functions
   ```

Gmail rather than the Firebase default sender for the reason the verification
mail section records at length: mail sent through Gmail is DKIM-signed by Google
and passes DMARC, and `noreply@pints-conference.firebaseapp.com` does not — which
is what university filters quarantine. A consumer account sends about 500
messages a day, which is ample. Revoke the app password from the Google account
page if the organizer holding it changes.

**Send one real message before announcing the page**, and confirm it arrives at
pints.conference@gmail.com, that **Reply** addresses the visitor, and that the
reply reaches them — a visitor at `@ens.psl.eu` is the test that matters.

Until the secrets exist, the sensible thing is to ship the page without the
mailer: everything except `functions/index.js` and its `nodemailer` dependency
works on its own, and messages accumulate in `contact_messages` where an
organizer can read them.

## Editing page content

**The easy way: sign in as an organizer, open `admin.html` → Pages, pick a page,
edit the markdown, and press "Save and publish".** The change is live on reload.
No GitHub account, no commit.

Edits are stored in Firestore under `pages/{slug}`, and that is the only place
the site writes. The `content/*.md` files stay in the repository as the seed and
the read fallback: a page nobody has edited on the site is served from its file,
and so is a page whose Firestore read fails.

Editing the `.md` file on GitHub still works, but **it has no effect on a page
that has been edited through the admin console** — the Firestore copy wins from
the first save onwards, permanently. If you have been editing on the site, edit
on the site. To go back to the committed text, open `content/<page>.md`, copy it
into the editor, and save; deleting `pages/{slug}` in the Firebase console does
the same thing.

| File | Slug | Appears on |
|---|---|---|
| `content/home.md` | `home` | `index.html` |
| `content/about.md` | `about` | `about.html` |
| `content/venue.md` | `venue` | `venue.html` |
| `content/previous-editions.md` | `previous-editions` | `previous.html` |
| `content/poster-guidelines.md` | `poster-guidelines` | `abstracts.html` |

The list of editable pages is `PAGES` in `js/config.mjs`; adding a page means
adding an entry there and a `data-page` attribute on the host element.

Markdown supports headings, lists, links, tables, bold, and italic.

### HTML in page copy

Markdown has no syntax for coloured text, so page copy may also contain plain
HTML. Write it inline and the editor's preview shows the result immediately:

```html
Registration closes <span style="color: red">this Friday</span>.

<div style="text-align: center">Poster session, 14:00</div>
```

The usable tags are `span`, `div`, `u`, `s`, `small`, and `mark`, on top of
everything markdown already produces, and they may carry `style` and `class`.

**One trap.** A block-level tag such as `<div>` switches the markdown parser
off for everything inside it, so `<div>**bold**</div>` prints the asterisks.
Leave a blank line above and below the contents and markdown works again:

```html
<div style="text-align: center">

**Poster session**, 14:00

</div>
```

`<span>` used inside a sentence has no such problem.

Everything is still sanitized before it reaches the page. Scripts, event
handlers such as `onclick`, and `javascript:` links are removed. A `style`
attribute is filtered down to presentation properties: colour, fonts, spacing,
borders, alignment and sizing survive, while `position`, `z-index`, and offsets
are dropped — those are what turn a styled word into an invisible layer over the
rest of the page — and so is any value containing `url(` or `expression(`, which
would otherwise let page copy call out to another server. The rules live in
`safeStyle()` in `js/markdown-render-utils.mjs` and are unit-tested.

Abstract bodies are a separate, much narrower allowlist and gain none of this:
participant input never renders HTML.

## Editing and deleting as an organizer

Deletion, and hand-confirming a participant's email, are operations that do not
run in the browser, because the Admin SDK is the only thing that can do them:
a Firebase Auth account can only be deleted or self-verified by its owner from
a client, and `storage.rules` scopes figure deletion to the uploader. So
`functions/` holds these callables:

| Callable | Does |
|---|---|
| `deleteAbstractCompletely` | removes the abstract, its published copy, its reviews, its figure |
| `deleteParticipant` | all of the above for every abstract they own, plus their profile, their public listing, and their login |
| `listUnverifiedParticipants` | which registered uids Firebase Auth has not marked email-confirmed — read by the Participants tab to decide who gets the **Confirm email** button |
| `verifyParticipantEmail` | marks a participant's email confirmed by hand and publishes them immediately — for the address a verification mail never reaches at all, see "Register first, then submit" |
| `backfillParticipants` | every five minutes, publishes verified participants who never loaded `account.html` — see "Being listed without ever loading account.html" |
| `mailContactMessage` | mails a contact-form message to pints.conference@gmail.com — see "Contacting the organizers". **Binds two SMTP secrets: set them before deploying anything here** |
| `syncDropboxGallery` | **temporarily removed** — see below |

Five of them are here because they must **bypass the rules**: the deletes act on
somebody else's documents, and `listUnverifiedParticipants`, `verifyParticipantEmail`
and the backfill read or write on behalf of a person who is not the one calling
them — Auth's `email_verified` flag, in particular, can only be listed or set in
bulk by the Admin SDK. The other reason something may live here is that it must
**hold a secret the browser cannot** — which is what `mailContactMessage` and
`syncDropboxGallery` are doing. Those are the only two reasons anything belongs
in `functions/`.

**Confirm email only appears on a row Firebase Auth still has unconfirmed.**
`users/{uid}` — what the rest of the row is drawn from — has no verified flag of
its own, so the tab calls `listUnverifiedParticipants` once per render to know
which rows qualify; a row drops the button the moment `verifyParticipantEmail`
succeeds, since a success re-renders the tab. This is the manual half of the
promise the verify-gate's last line makes: "tell the organizers and we will
confirm your address by hand."

**`syncDropboxGallery` is not in `functions/index.js` right now.** It binds three
Dropbox secrets, and a function whose secrets do not exist cannot be provisioned
— which fails the whole `firebase deploy --only functions`, taking the deletes
and the backfill down with it. Rather than hold everything else hostage to a
Dropbox app nobody has created yet, it was removed in a commit of its own. To
bring it back: set the three secrets as described in "Setting up the Dropbox
app", find the commit whose subject begins "Take the Dropbox sync out of the
deploy", and `git revert` it. Its browser half — the Archive admin tab,
`js/functions.js`, the public slideshow — is untouched and still waiting for it. The moment ordinary reads and writes start
going through callables, the site stops being a static site and every page pays
cold-start latency for work the rules already secure.

`deleteParticipant` refuses to delete you, and refuses to delete another
organizer — revoke their admin rights in Settings first. The Participants tab
does not offer the button in either case, so the refusal is a backstop rather
than the first line of defence.

**The site works without them.** Every page loads and every other feature works
if the functions are never deployed; the two delete buttons report that the
service is missing when pressed, Confirm email never appears on any row since
`listUnverifiedParticipants` has nothing to return, the Archive page simply
shows no photographs, and the contact page still validates, stores and
confirms — only the mail waits.
Deploy them with:

```bash
cd functions && npm install
npx firebase deploy --only functions
```

**Set `CONTACT_SMTP_USER` and `CONTACT_SMTP_PASSWORD` first** — see "Setting up
the mail". Without them that deploy fails outright and nothing here ships.

They deploy to `europe-west1`, not the `us-central1` default, so participant
names and email addresses stay in the EU. `js/functions.js` names the same
region — **if you change one, change both**, or every call fails as an opaque
CORS error.

Cloud Functions need the Blaze plan. Nothing else on the site does.
`backfillParticipants` additionally needs **Cloud Scheduler**, which Firebase
enables on the first deploy of a scheduled function; the job is free at this
frequency and each sweep costs a handful of Firestore reads.

### Editing

**Abstracts.** The Abstracts tab has an Edit button per card, which opens the
submission form inline. Any abstract at any status can be edited. Saving an
**accepted** one rewrites `abstracts_public` in the same batch, so the public
list cannot go stale.

That last point is load-bearing and is enforced by construction: the form unlocks
an accepted abstract only when the caller supplies `republish`, the payload
carrying its type and poster number. The admin console supplies it; `account.html`
does not, so a submitter — *including an organizer looking at their own accepted
abstract* — still sees it read-only. Never key that exemption on "is an admin":
it would unlock the account page, where nothing rewrites the public copy.

Organizers cannot replace somebody else's **figure**, because `storage.rules`
keys uploads to the uploader's uid and cannot read Firestore to learn who is an
organizer. The form shows the figure and says so.

**Participants.** The Participants tab has an Edit button per row for the name
and affiliation, written through the same `saveProfile()` the account page uses,
so `users/{uid}` and `participants_public/{uid}` move together.

The **email is not editable**: it belongs to the Firebase Auth login, and
changing only the Firestore copy would leave the two disagreeing about who the
person is.

Organizers can be edited but not deleted — revoke their rights in Settings
first.

## Local development

```bash
npm install
npm run vendor      # refresh vendor/ after upgrading marked or dompurify
npm run serve       # http://127.0.0.1:4173
npm test            # pure-function unit tests (204)
npm run test:rules  # Firestore rules tests (116; needs Java)
npm run emulators   # Firestore, Auth, Storage and Functions emulators
```

### Rehearsing against the emulators

Some flows cannot be tried against production without leaving real accounts and
real abstracts behind — signing up, verifying an address, submitting, deleting a
participant. Add `?emulator` to any page, with `npm run emulators` running, and
the whole SDK talks to the local stack instead:

```
http://127.0.0.1:4173/submit.html?emulator
```

The switch is in `js/firebase.js` and is guarded on **localhost AND the query
parameter**, the same way `js/functions.js` has always guarded its own — so the
deployed site can never be pointed at a laptop, and an ordinary local page load
still talks to the real project.

Two things to know. The emulator starts empty, so seed the submission window
first or every submission is refused (the rules read `config/site` and fail
closed when it is missing):

```bash
curl -X PATCH -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "http://127.0.0.1:8080/v1/projects/pints-conference/databases/(default)/documents/config/site" \
  -d '{"fields":{"submissionsOpen":{"booleanValue":true},
       "submissionDeadline":{"timestampValue":"2027-01-01T00:00:00Z"},
       "edition":{"stringValue":"pints2026"}}}'
```

And no mail is actually sent — the Auth emulator queues it. To see the link a
submitter would have received:

```bash
curl -s http://127.0.0.1:9099/emulator/v1/projects/pints-conference/oobCodes
```

If `emulators:start` reports no Java runtime, Homebrew installed `openjdk`
keg-only. `npm run test:rules` finds it on its own; this command does not:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run emulators
```

`npm test` must pass before every commit.

## Architecture

- Multi-page static HTML at the repository root. Each page has a real `<title>`
  and `<h1>`; the header, nav, and footer are injected by `js/layout.js` from the
  single `NAV` definition in `js/config.mjs`.
  `js/layout.js` also drops in the floating **back to top** button, bottom right,
  which appears once the page has scrolled half a viewport. `404.html` is the one
  page without any of this: GitHub Pages serves it from the requested path, so it
  cannot import anything relative and is self-contained by design.
- Pure logic lives in `js/*-utils.mjs` and is unit-tested under Node. DOM and
  Firebase glue lives in `js/page-*.js`.
- `marked` and `DOMPurify` are **vendored** into `vendor/` by `npm run vendor`,
  so the browser imports them as local files. There is no CDN dependency at
  runtime and no bundler.
- Two logo files, both **generated** by `scripts/logo/` and not hand-edited —
  see the README in that directory. `assets/pints-2026-header.svg` is the home
  hero (wordmark, subtitle and date); `assets/pints-mark.svg` is the wordmark
  alone and is the header brand link on every page, injected by `js/layout.js`.
  Their text is stored as outlines rather than `<text>` in Trebuchet MS, because
  a visitor without that font (most Linux and Android) otherwise gets a Times
  wordmark with the pint-glass "i" landing on the N. Changing the date or the
  venue means editing the constants at the top of `scripts/logo/build_logo.py`
  and re-running it; the alt text in `index.html` has to be updated to match.
- **All paths are relative.** Never write a leading-slash path: the site is
  served from the root of `pints-fr.github.io` today, but was served from
  `neoneuron.github.io/pints/` before the move to the org and could move again —
  absolute paths would 404 on any subpath.
  **The single exception is `404.html`**, which Pages renders at the *requested*
  URL rather than at the site root — relative paths there would resolve against
  the bad URL. It is therefore self-contained, with inline CSS and a `<base>`
  tag. If the site ends up on a subpath, that `<base href="/">` is the one line
  that must change, to `/<repo-name>/`.

## Deployment

GitHub Pages serves the `main` branch from the repository root. Pushing to
`main` deploys. `.nojekyll` must stay in place — without it, Pages runs Jekyll,
which drops any path beginning with an underscore and would transform
`content/*.md` instead of serving it raw for the client-side renderer.

The repository is `pints-fr/pints-fr.github.io`, owned by the **`pints-fr`**
organization. Because it is named `<org>.github.io`, Pages serves it at the root
of <https://pints-fr.github.io/> rather than on a `/pints/` subpath — which is
also how the `pints.fr` custom domain will serve it, so no path has to change
again at DNS cutover.

**If the site URL ever changes again** — back to a repo-name subpath —
`404.html`'s `<base href="/">` must change to match. Nothing will appear broken:
the 404 page still renders, its links just point at the wrong path. Verifying a
deliberately bogus URL is therefore part of any such move.

### Caching after a deploy

GitHub Pages serves assets with `cache-control: max-age=600`, so a returning
visitor can run up to ten minutes of stale JavaScript after a push. It
self-heals; just don't conclude a fix failed within that window.

One asymmetry is worth knowing when testing: a hard reload revalidates the
document and its **statically** imported modules, but a runtime
`await import(...)` is an ordinary fetch that honours the HTTP cache, so a
dynamically imported module can stay stale *through* a hard reload. Prefer a
static import for anything a page always needs. The admin console's tab modules
are still dynamic — that lazy loading is deliberate, since only one tab is
opened at a time — so when testing an admin tab, confirm with
`fetch(url, {cache:'reload'})` rather than trusting a hard reload.

## Firebase

**Not yet created.** The accounts code is written, deployed, and its security
rules are tested — but until the steps below are done, every account page shows
"Accounts are not switched on yet" instead of failing with an SDK error.

`firestore.rules` is the **only** authorization boundary: the site is a static
page with no server in front of it, so anything the rules do not forbid is
permitted to anyone on the internet. Change it only alongside its tests.

### The web API key in `js/firebase-config.js` is public on purpose

GitHub's secret scanner flags it as a "Google API Key". It is not a credential,
and it must not be hidden:

- **It cannot be hidden.** The browser has to receive it to reach Firebase, so it
  ends up in the served JavaScript and the Network tab no matter where it is
  stored. Injecting it from a GitHub Actions secret changes where it lives, not
  whether it is public — and it would force a build step this project
  deliberately does not have.
- **It does not grant access.** It identifies the project. Authorization is
  `firestore.rules`, covered by 116 emulator tests and verified against
  production: an anonymous caller holding this exact key gets
  `PERMISSION_DENIED` on `users`, `admins`, `abstracts`, and `abstract_reviews`,
  and can read only what is public by design.

**What the exposure does cost you is quota, not data.** An unrestricted key lets
anyone drive Identity Toolkit and Firestore calls against this project — mass
signup attempts, password-reset floods, read loops. On Spark that means hitting a
daily cap and denying service to real participants.

Two free mitigations, neither yet applied (checked 2026-07-30: the key answers
`curl` with no `Referer` at all, so it currently has no restrictions):

1. **Restrict the key** — Google Cloud console → *APIs & Services →
   Credentials* → the browser key. Set *Application restrictions* to **HTTP
   referrers** and allow `pints-fr.github.io/*` (plus `neoneuron.github.io/*`
   while the old URL still redirects, and `localhost` for local work). Under
   *API restrictions*, limit it to the APIs actually used:
   Identity Toolkit, Cloud Firestore, Token Service. Test sign-in afterwards —
   an over-tight list breaks auth.
2. **Enable App Check** with reCAPTCHA v3 (free) and enforce it on Firestore, so
   requests must come from your real site rather than a script holding the key.

If the scanning alert is noisy, dismiss it as a false positive rather than
rotating the key — rotation changes the string without changing what it can do.

### One-time setup

1. <https://console.firebase.google.com> → **Add project**, name it
   `pints-conference`. Analytics off. **The project must be on the Blaze
   (pay-as-you-go) plan**, because abstract figures are stored in Cloud Storage
   and Storage is not available on Spark. Everything else here stays inside the
   free allowance; set a budget alert of a few euros so a surprise is impossible.
   **Do not enable Cloud Functions** — nothing in this site needs them, and they
   would break the "no server" property the whole design rests on.
2. **Build → Firestore Database → Create database → Production mode**, location
   `eur3 (europe-west)`.
3. **Build → Authentication → Get started → Sign-in method → Email/Password →
   Enable.** Leave "Email link" off.
4. **Authentication → Settings → Authorized domains → Add domain** →
   `pints-fr.github.io`. Add `neoneuron.github.io` (the pre-org host),
   `localhost`, and `127.0.0.1` too.
   *Skipping this makes every sign-in fail with `auth/unauthorized-domain`.*
5. **Project settings → General → Your apps → Web (`</>`)**, register the app,
   copy the `firebaseConfig` object, and paste it over the placeholders in
   `js/firebase-config.js`. That file is public by design — the web API key
   identifies the project, it is not a credential.
6. **Build → Storage → Get started.** This is the step that needs Blaze. Accept
   the default bucket; `storage.rules` locks it down to `abstract_figures/{uid}/`.
7. Deploy the rules: `npx firebase login && npx firebase use --add` (pick the
   project), then `npx firebase deploy --only firestore:rules,storage`.
8. In Firestore, create collection `config`, document ID `site`, with fields
   `submissionsOpen` (boolean), `submissionDeadline` (timestamp), `eventDate`
   (string, `YYYY-MM-DD`), and `edition` (string, `pints2026`). The abstract
   rules call `get()` on this document; if it is missing, the rule errors and
   denies every submission.

### Verification emails and institutional mail filters

Abstract submission requires a verified email address, enforced in
`firestore.rules` via `request.auth.token.email_verified`.

**The problem.** Firebase's default sender is
`noreply@pints-conference.firebaseapp.com` — a domain PINTS has no DNS control
over, so the mail carries no SPF or DKIM that aligns with anything a recipient
recognises. Measured 2026-07-29: a Gmail address received it and verified
successfully; an `@ens.psl.eu` address did not. The Firebase pipeline is fine;
this is recipient-side filtering, and for a meeting whose attendees are almost
entirely on institutional mail it is the single biggest obstacle between a
registrant and a submitted abstract.

**The fix: send as `pints.fr`.** Google keeps sending the mail, but signs it with
DKIM keys published under `pints.fr` and an SPF record that authorises its
servers, so it arrives aligned. Free, native, no third party, no new secret, and
no Identity Platform upgrade.

Two mitigations remain in place regardless, because no configuration makes every
institutional filter cooperate:

- The unverified banner on `account.html` and the panel that replaces the form on
  `submit.html` both name the cause, point at the spam or quarantine folder,
  carry a resend button, and show the error code if a resend fails.
- Organizers are exempt from the gate, because `firestore.rules` already grants
  admins `allow write: if isAdmin()` on abstracts. An organizer is never locked
  out of their own submission by undelivered mail.

#### Why not GoDaddy's own mail, or an outside service

GoDaddy hosts the DNS for `pints.fr` and that is the whole of its role here.
It is not a sending option:

- `relay-hosting.secureserver.net` only accepts connections from sites on GoDaddy
  hosting. This site is on GitHub Pages.
- Professional Email / Microsoft 365 mailboxes (`smtpout.secureserver.net`) are
  human mailboxes on shared sending reputation, capped around 250 relays a day,
  and wiring one into Firebase needs the **custom SMTP** feature — which requires
  the one-way upgrade to Firebase Authentication with Identity Platform.

A transactional provider (Resend, Postmark, Mailgun, SES) is the fallback if the
measurement below ever stops passing. It buys real bounce and delivery logs, at
the cost of a third-party dependency, a new secret, and a new abuse surface: the
link would have to be minted with `generateEmailVerificationLink()` in
`functions/` and mailed from there. Not worth it while the native path works.

#### The action links cannot be moved, and that is a hard stop

The links in these emails still point at
`pints-conference.firebaseapp.com/__/auth/action`, and **there is no way to
change that on this project.** Do not spend an afternoon on it as we did.

Firebase documents a "custom email action handler": you host the page, set the
template's **customize action URL**, done. The console rejects every value with
*"an error occurs in updating the action URL"*. Going under the console to the
Identity Platform admin API gives the real error, `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`,
and probing it maps the rule exactly:

| Candidate `callbackUri` | |
|---|---|
| `https://pints-conference.firebaseapp.com/__/auth/action` | **ALLOWED** |
| `https://pints-conference.web.app/__/auth/action` | **ALLOWED** |
| `https://pints-conference.web.app/__/auth/action/` | BLOCKED — trailing slash |
| `https://pints-conference.web.app/action.html` | BLOCKED — path |
| `https://pints.fr/auth-action.html` | BLOCKED |
| `https://auth.pints.fr/__/auth/action` | BLOCKED |
| `https://pints-fr.github.io/__/auth/action` | BLOCKED |

**The whole URL is whitelisted, not the domain and not the path.** Exactly two
values are accepted: Firebase's own two default handler URLs. A trailing slash is
enough to fail.

Things that are *not* the explanation, each of which cost a probe:

- **Authorized domains.** `pints.fr` and `pints-fr.github.io` were both on the
  list and both refused. Adding `auth.pints.fr` to it changed nothing.
- **Firebase Hosting ownership.** `auth.pints.fr` was set up as a real Hosting
  custom domain, certificate and all, and was still refused.
- **The custom email domain being half-verified.** `customDomainState` reads
  `NOT_STARTED` with an epoch-zero timestamp while `useCustomDomain` is `true`.
  It looks broken and is cosmetic: the delivered mail passes DKIM, SPF and DMARC.
  Ignore that field.

So `submit.html` and `account.html` are where people land, via the `continueUrl`
Firebase appends — set in `returnToAccount()` in `js/auth.js`. Verification works;
it just goes through a Google-branded page first.

Lifting this would need Firebase Authentication with Identity Platform (a
**one-way** upgrade), or minting links in `functions/` with
`generateEmailVerificationLink()` and mailing them ourselves — which means
sending the mail ourselves, and losing the `pints.fr` DKIM signature that this
whole section exists to obtain unless a transactional provider is set up first.
Neither is worth it to move a hostname.

#### The measurement

**Measured 2026-08-19, after the custom domain was applied** — the headers on a
delivered verification mail:

```
dkim=pass   header.i=@pints.fr  header.s=firebase2
spf=pass    smtp.mailfrom=noreply@pints.fr
dmarc=pass  header.from=pints.fr
```

Signed with our own key, `Return-Path` aligned, DMARC aligned. This is the test
the 2026-07-29 entry above failed.

Signing was necessary and is not sufficient. Same message, three recipients,
measured the same day:

| Recipient | Result |
|---|---|
| `@gmail.com` | Inbox |
| `@outlook.com` | Junk |
| `@cnrs.fr` | **Nothing.** Not the inbox, not the junk folder |

Authentication is not the variable here — it passes for all three. Two different
causes are left, and only one of them is ours to fix.

**Resolved the same day.** Adding an MX record fixed the `@cnrs.fr` delivery; see
below for why a *receiving* record was what made *sending* work. Outlook was not
expected to change and is a separate cause.

#### The domain cannot receive mail, and that breaks sending

**Fixed 2026-08-19 — kept here because the reasoning is the useful part.**

`pints.fr` published **no MX record**. RFC 5321 §5.1 then makes the A record the
implicit MX, so anything trying to reach `pints.fr` by mail was aimed at GitHub
Pages — where port 25 does not answer at all. It hangs rather than refusing,
which is the worst of the three possible behaviours. Consequences:

- Gateways that verify the envelope sender before accepting the message (a
  *sender callout*) open that connection, wait, and then defer or reject.
  `cnrs.fr` runs its own MX (`mx1`/`mx2.cnrs.fr`), and self-managed gateways are
  exactly where this check still lives.
- **Every bounce is undeliverable.** A rejection notice addressed to
  `noreply@pints.fr` has nowhere to land, so "it never arrived" and "it was
  refused and nobody told us" are indistinguishable from here.
- "Sending domain has no MX" is a scored spam signal in its own right in several
  commercial filters.

Do **not** answer this with a null MX (`MX 0 .`, RFC 7505). That asserts the
domain accepts no mail at all and turns a callout from a timeout into a
guaranteed rejection.

#### The mail leaves over SendGrid, not Google

`_spf.firebasemail.com` expands to `include:sendgrid.net include:_spf.google.com`.
Firebase's custom-domain mail is not sent from Google's own outbound ranges
alone, and SendGrid's *shared* pools carry the weakest reputation at Microsoft
specifically. That matches the result exactly: Outlook junked what Gmail
inboxed. No configuration fixes this — only a dedicated IP or a different
transactional provider would, and neither is worth it while the numbers are this
small.

#### We are getting no DMARC reports, which is why CNRS is a guess

`_dmarc.pints.fr` publishes `rua=mailto:kai.chen@gmail.com`. A `rua` address
*outside* the domain requires an authorization record at
`pints.fr._report._dmarc.gmail.com`, which we cannot create on `gmail.com`, so
most reporters send nothing at all. The CNRS failure therefore arrives with no
evidence attached. Fixing this also needs an MX.

`pints.fr` is not on the Spamhaus DBL — checked against a control vector to
confirm the lookup itself worked. None of this is reputation damage to the
domain; it is configuration.

#### What to do, in order

1. ~~**Add MX records**~~ **Done 2026-08-19.** ImprovMX free tier, `mx1`/`mx2.improvmx.com`
   at priority 10/20. The alias that matters is **`noreply@pints.fr`** — that is
   Firebase's envelope sender and therefore the exact address a callout probes. An
   MX that rejects `noreply@` fixes nothing, so a catch-all is the robust setting.
2. ~~**Repoint DMARC**~~ **Done.** `v=DMARC1; p=none; rua=mailto:dmarc@pints.fr`.
   Aggregate reports now have somewhere to land, so the next failure arrives with
   evidence instead of a shrug. Expect daily XML attachments; that is the point.
3. **Still to do: Reply-To** on the template to a real organizer address, and
   **Public-facing name** → `PINTS Conference`. The mail currently calls itself
   "pints-conference", which reads like a test message to filters and to people.
4. ~~**Re-test to `@cnrs.fr`**~~ **Done — delivery confirmed.** The MX record was
   the whole fix. One variable at a time is what found it, which is the same
   lesson as the action-URL section above.

Outlook is still expected to junk it, and no configuration here will change that:
that failure is SendGrid shared-IP reputation, not anything `pints.fr` publishes.

The SPF include was **merged** into the existing record, not added as a second
one — `v=spf1 include:_spf.firebasemail.com include:spf.improvmx.com ~all`. Two
`v=spf1` records would break sending from the whole domain silently. The chain
costs 5 of SPF's 10 permitted DNS lookups; going over is a `permerror` that fails
everything, so count before adding a third include.

**Port 25 is blocked on the ENS network**, so none of this can be probed by SMTP
from a laptop on campus — Gmail's own MX is equally unreachable from there, which
makes a blocked-port timeout look exactly like a broken MX. Test end to end
instead: send a plain message to `noreply@pints.fr` and confirm it forwards.

Until then, the panels on `submit.html` and `account.html` link to
`contact.html` so somebody whose mail never arrives has a route that does not
depend on mail arriving.

**Also send a password reset and complete it end to end.** It is the regression
most likely to be missed, because nothing about registering exercises it.

**Unblocking one person in the meantime:** Firebase console →
**Authentication → Users**, find them, and mark the address verified.

### Making someone an organizer

1. **Authentication → Users** — find the person and copy their UID.
2. **Firestore → `admins`** — add a document whose **ID is that UID**, with
   fields `email` (string), `addedBy` (string), `addedAt` (timestamp).

The first admin must be created this way. After that, admins can add each other
from the admin console (Phase 3).

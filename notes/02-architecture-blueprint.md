# Architecture blueprint

## Stack

| Layer | Choice | Why |
|---|---|---|
| Pages | Plain multi-page HTML, CSS, ES modules. **No bundler, no build step** | Academics can maintain it. The repo *is* the deployed site. Real URLs work for search. One page can be edited without understanding the others |
| Hosting | GitHub Pages from `main` at the repo root, plus `.nojekyll` and a custom domain | Free. Pushing deploys. `.nojekyll` stops Jekyll from mangling `content/*.md` and `_`-prefixed paths |
| Auth | Firebase Auth, email and password, with email verification | Free, and the browser SDK works with no server |
| Data | Cloud Firestore, called directly from the browser | Free tier is plenty. **Security rules are the only access control** |
| Files | Cloud Storage (figures, hero/archive/page photos) | Needs the **Blaze** plan since Feb 2026. In practice it costs nothing, but set a budget alert |
| Server bits | Cloud Functions v2 (`functions/`), kept to a minimum | Only for work that must bypass the rules or keep a secret |
| Third-party JS | `marked`, `DOMPurify`, and the Firebase SDK **vendored** into `vendor/` (`npm run vendor` is a plain file copy) | No CDN needed at runtime and still no build |
| Dev tooling | npm (dev only), `node --test`, `@firebase/rules-unit-testing` v5, the Firebase emulators, `http-server` | — |

`npm` is never used on the live site. Only the browser loads the files.

## Repository layout

```
*.html                 one file per page (index, program, abstracts, participants, register,
                       login, account, submit, vote, admin, contact, party, venue, about,
                       previous, 404). Each page loads one js/page-*.js module.
content/*.md           committed page copy: seed and fallback for pages/{slug} in Firestore
css/styles.css         one stylesheet; palette in :root custom properties
js/config.mjs          single source of truth: CURRENT_EDITION, NAV, LIMITS, vocabularies, EVENT
js/firebase-config.js  public web config (the API key is public by design)
js/firebase.js         initApp + ?emulator switch (localhost only) + Auth-free publicDb client
js/auth.js, db.js, storage.js, functions.js   the only modules that talk to Firebase
js/layout.js           injects header/nav/footer/back-to-top from NAV
js/page-*.js           DOM glue for each page
js/admin-*.js          one module per admin-console tab (loaded lazily with dynamic import)
js/*-utils.mjs         PURE logic (no DOM, no Firebase), the part that gets unit tests
js/abstract-card.js    the ONLY abstract renderer (public list, preview, submitter view)
firestore.rules, storage.rules   the access-control model
functions/index.js     callables + scheduled sweep + Firestore-triggered mailer
test/*.test.mjs        unit tests (node --test)
test/rules/*.test.mjs  rules tests against the emulator (serial)
scripts/               vendor copy, rules-test runner (finds a JVM), logo generator
404.html               self-contained (inline CSS, <base href="/">)
```

**Rule of thumb:** put logic in `*-utils.mjs` so it can be tested in Node, put Firebase calls in `db.js` / `auth.js` / `storage.js`, and keep `page-*.js` to DOM wiring.

## Data model (Firestore)

The defining constraint: **Firestore rules cannot hide individual fields.** A read gets the whole document or nothing. So any data with mixed visibility is split into a private original and a **public projection**, written in the same batch.

| Collection | Doc ID | Read | Write | Purpose |
|---|---|---|---|---|
| `config/site` | fixed | public | admin | Edition, event date, submission / editing / registration / voting switches and deadlines, session chairs |
| `config/hero` | fixed | public | admin | Home-page slideshow photos |
| `admins/{uid}` | uid | self, admin | admin | Admin registry. `isAdmin()` checks whether a doc exists here. The first admin is added by hand in the console |
| `users/{uid}` | uid | self, admin | self (create only if registration is open or a link is spent), admin | Private profile: name, affiliation, email |
| `participants_public/{uid}` | uid | public | self (verified), admin, backfill function | Public name list |
| `abstracts/{uid}` | **owner uid** (one each) | owner `get`, admin `list` | owner inside the windows, admin | Private submission |
| `abstracts_public/{uid}` | same ID | public | admin; owner only in a batch that matches the private copy | Accepted abstracts, as they will be published |
| `abstract_reviews/{id}` | abstract ID | admin | admin | Map of scores and notes per reviewer, plus accept/reject decision. Separate so authors can never read it |
| `schedule/{autoId}` | auto | public | admin | Program items (start/end, kind, session, linked abstract, invited abstract) |
| `pages/{slug}` | slug | public | admin | Page copy edited by organizers (Markdown + filtered HTML) |
| `gallery/{year}` | year | public | admin | Archive albums |
| `poster_votes/{uid}` | **voter uid** (one each) | owner `get`, admin `list` | owner while voting is open, admin | Best-poster ballot |
| `registration_links/{token}` | token | public `get` | admin create; spender stamps `usedBy` | Single-use late registration |
| `submission_links/{token}` | token | public `get` | admin create; spender stamps `usedBy` | Single-use late submission |
| `edit_grants/{uid}` | participant uid | owner, admin | admin | Late editing for one person, with an expiry |
| `contact_messages/{id}` | auto | — | public create (validated) | Contact form. A function mails it |

**Edition scoping:** every document for an edition carries `edition: CURRENT_EDITION`. List pages query with `where("edition","==",…)` and **sort on the client** using tested pure functions. Using `orderBy` would need composite indexes, which is extra setup for no benefit at a few hundred records. Next year's site needs a one-line change, not a migration.

## Storage layout

Storage rules **cannot read Firestore**, so ownership is encoded in the path:

```
abstract_figures/{uid}/…   only that uid may write; admin-only reads (figures are never public now)
hero/{uid}/…  archive/{uid}/…  page_images/{uid}/…   written by organizers
```

Images are **downscaled in the browser** (longest edge 1600px) before upload. This helps visitors more than the bucket.

## Cloud Functions (`functions/index.js`)

Something belongs here only if it answers yes to one of these: **does it need to bypass the rules, or hold a secret?**

| Function | Type | Why it can't run in the browser |
|---|---|---|
| `deleteParticipant`, `deleteAbstractCompletely` | callable | Deleting someone else's Auth account needs the Admin SDK. Storage rules can't check `isAdmin()` |
| `listUnverifiedParticipants`, `verifyParticipantEmail` | callable | Lets organizers confirm an address by hand when institutional mail filters eat the email |
| `backfillParticipants` | scheduled, every 5 min | Publishes verified users the client hook missed. Uses `create()`, so it never overwrites |
| `mailContactMessage` | Firestore `onDocumentCreated` | SMTP credentials are secrets (`defineSecret`) |

Every callable checks `request.auth` and admin status itself, because the Admin SDK ignores the rules. No page load ever depends on a function, so the site still works if they aren't deployed.

## Front-end conventions worth copying

- **All paths are relative.** Then the site works on a subpath like `user.github.io/repo/` and on a custom domain. The one exception is `404.html`.
- **One renderer per concept.** For example, `abstract-card.js` draws an abstract in the public list, the live preview, and the submitter view. When two renderers existed, they drifted apart.
- **Two Markdown allowlists.**
  - Trusted page copy allows headings, tables, images, and a limited set of HTML tags plus `style`/`class`. `style` is filtered by `safeStyle()`, which drops `position`, `z-index`, and any `url(`.
  - Untrusted participant text allows only `p br em strong sup sub a` with https links. The XSS cases are unit-tested.
- **Committed Markdown renders first, then Firestore's version replaces it** when it arrives, which avoids roughly 0.5s of blank page.
- **A separate Firestore client for public reads** (`publicDb`, on its own Firebase app, never calls `getAuth()`). Otherwise every public query waits for Auth to restore its session.
- **Fail safe on config reads.** If the config can't be read, hide any button that advertises something that might not be happening (for example voting).
- **Keep state the user created out of DOM nodes you're about to rebuild.** For example, keep the set of open rows in the review console in a `Set` and reapply it after re-rendering.
- **Defer work by not building the DOM.** A collapsed `<details>` still fetches its images. Build the body only on the first `toggle`.

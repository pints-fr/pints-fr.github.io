# Checklist: building a new site of this kind

This assumes the same stack: static GitHub Pages + Firebase. Fork or copy this repo, or follow the steps to build from scratch.

## 0. Decide first. These are expensive to change later.

- [ ] **One submission per person, or several?** One means `abstracts/{uid}`, which the rules can enforce. Several means auto IDs + `ownerUid` (03 §3).
- [ ] **When is the email-verification gate checked?** At submission (PINTS's final choice) or only at public listing.
- [ ] **Which fields does registration collect?** Name, affiliation, email. Add lab/team, career stage, dietary needs, and so on **now** if any later rule depends on them (voting against your own lab, for example).
- [ ] **Topics/tracks vocabulary.** It is reused for program sessions. Listed in `config.mjs` *and* in the rules (they can't import it).
- [ ] **Talk vs poster.** In PINTS everything is submitted as a poster and the committee promotes some to talks.
- [ ] **What is public about an accepted abstract?** Full text, or title + authors (owner's choice)? Figures are reviewer-only.
- [ ] **Review scale** (PINTS: 1–4 with veto) and whether review is blind.
- [ ] **Custom domain**, and who controls its DNS.

## 1. Repo and hosting

- [ ] Create an org repo `<org>/<org>.github.io` (serves at `/`) and set Pages to `main` / root. Add `.nojekyll` and `CNAME`.
- [ ] Copy the skeleton: `*.html`, `css/`, `js/`, `content/`, `vendor/` (`npm run vendor`), `404.html`, `scripts/`, `test/`.
- [ ] Edit `js/config.mjs`: `CURRENT_EDITION`, `SITE_NAME`, `SITE_TAGLINE`, `EVENT`, `NAV`, `LIMITS`, topics, kinds, sessions, contact topics.
- [ ] Change the palette in `:root` in `css/styles.css`, the logo assets, and `content/*.md`.
- [ ] Make sure `404.html`'s `<base>` matches where the site is served from.

## 2. Firebase

- [ ] Create the project and upgrade to Blaze with a budget alert. Create the Firestore database (EU, production mode), enable Email/Password Auth, and start Storage.
- [ ] Add authorized domains: custom domain, `<org>.github.io`, `localhost`, `127.0.0.1`.
- [ ] Put the web app config into `js/firebase-config.js`.
- [ ] Copy `firestore.rules` and `storage.rules`. Update the hard-coded vocabularies (topics, kinds, contact topics, status lists, length caps). Run `npm run test:rules`, then `npx firebase deploy --only firestore:rules,storage`.
- [ ] Seed `config/site`. Create the first `admins/{uid}` by hand.
- [ ] Functions: set the SMTP secrets, then `npx firebase deploy --only functions`. Point `CONTACT_RECIPIENT` at a shared inbox.
- [ ] Optional but recommended: restrict the API key by referrer and enable App Check.

## 3. Domain and email (do this before registration opens)

- [ ] DNS: A records, `www` CNAME, GitHub org domain verification, Enforce HTTPS.
- [ ] Firebase custom email domain: merged SPF, DKIM CNAMEs, DMARC, **an MX record** (forwarding service with a catch-all).
- [ ] Send a verification email to a real institutional address and check it arrives.
- [ ] Customize the email template wording.

## 4. Before launch

- [ ] `npm test` and `npm run test:rules` both pass.
- [ ] Run every flow on the emulators with seeded accounts: register → verify → submit → admin accepts → public list → vote.
- [ ] Production probes: private collections return `PERMISSION_DENIED`, public ones succeed.
- [ ] Load every page on the live site and check the console is clean. Check at phone width. Check a deliberately wrong URL shows the 404 page.
- [ ] Organizers have admin accounts and have read the operator timeline (05).

## 5. Each new edition

- [ ] Bump `CURRENT_EDITION`, `EVENT`, and logo constants. Update `content/*.md` *and* the live `pages/{slug}` copies.
- [ ] Settings: new deadlines and windows. Clear voting. Archive last year's photos in a `gallery/{year}` album.
- [ ] Re-check email deliverability and DNS records (DMARC reports).

## Requirement → where it lives (PINTS)

| Requirement | Files |
|---|---|
| Logins with roles | `js/auth.js`, `admins/{uid}`, `firestore.rules` `isAdmin()` |
| Registration (+ close, late links) | `register.html`, `js/page-register.js`, `registration-utils.mjs`, `registration_links` |
| Abstract submission | `submit.html`, `js/abstract-form.js`, `abstract-validation-utils.mjs`, `submission-view.js`, `db.js` |
| Review console | `js/admin-abstracts.js`, `review-utils.mjs`, `abstract_reviews` |
| Participant names | `participants.html`, `participants_public`, `functions` backfill |
| Editable schedule | `js/admin-schedule.js`, `schedule-utils.mjs`, `program.html` |
| Poster list with abstracts | `abstracts.html`, `js/page-abstracts.js`, `abstract-card.js`, `abstracts_public` |
| Markdown pages | `content/*.md`, `js/content-hydrate.js`, `js/admin-pages.js`, `markdown-render-utils.mjs` |
| Voting | `vote.html`, `js/page-vote.js`, `vote-utils.mjs`, `js/admin-voting.js`, `poster_votes` |
| Photos | `js/admin-hero.js`, `js/admin-archive.js`, `slideshow.js`, `hero-slider.js` |
| Contact | `contact.html`, `contact_messages`, `functions` `mailContactMessage` |
| Mailing list | Participants CSV export (no sending) |

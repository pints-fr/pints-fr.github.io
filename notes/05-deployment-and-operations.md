# Deployment and operations

## Three separate deploy paths

| What | How it goes live | Notes |
|---|---|---|
| Site (HTML/CSS/JS/MD/assets) | `git push` to `main`. GitHub Pages serves it within about 1–2 minutes | Assets are cached with `max-age=600`, so returning visitors may run old JS for up to 10 minutes |
| `firestore.rules`, `storage.rules` | **By hand:** `npx firebase deploy --only firestore:rules` (or `storage`, or `firestore:rules,storage`) | **Pushing does not deploy them.** This was the source of most "works locally, fails live" bugs |
| `functions/` | `npx firebase deploy --only functions` | Secrets must be set first (`firebase functions:secrets:set …`) |

### Order matters

- **Deploy rules before, or together with, the code that needs them.** New page code running against old rules fails with `PERMISSION_DENIED`, even though the emulator tests passed.
- Make rule changes **additive** where possible: new fields optional, new switches defaulting to the current behaviour. Then you can deploy the rules first, and the old live code keeps working until the push lands. Before every rules deploy in this project, the session checked that the old code would still work with the new rules.
- **Pull before deploying rules.** `git fetch && git log main..origin/main`. On 2026-09-23 the local checkout was behind origin, and the live site was running code the local tree didn't have. Deploying rules from a stale checkout would roll back someone else's rules change.
- `firebase` isn't installed globally. Use `npx firebase …` (it's a dev dependency).
- After a deploy, probe production with the public key:
  ```bash
  B="https://firestore.googleapis.com/v1/projects/PROJECT/databases/(default)/documents"
  curl -s "$B/users?key=$KEY"               # must be PERMISSION_DENIED
  curl -s "$B/participants_public?key=$KEY" # must succeed
  ```

## GitHub Pages specifics

- Keep `.nojekyll` in the repo.
- **`404.html` must be self-contained**: inline CSS and `<base href="/">`. Pages serves it at the *requested* URL, so relative paths there break. If the site moves to a subpath, change `<base>`.
- An **org site** (`<org>/<org>.github.io`) serves at `/`, while a project repo serves at `/<repo>/`. Relative paths everywhere make either work.
- A runtime `await import()` uses the HTTP cache **even through a hard reload**. Use static imports for anything a page always needs. To test lazily loaded modules, use `fetch(url,{cache:'reload'})`.

## Custom domain (pints.fr on GoDaddy)

1. Verify the domain at the **org** level (`github.com/organizations/<org>/settings/pages`). The TXT record is `_github-pages-challenge-<org>`.
2. Apex A records → GitHub's four IPs. `www` CNAME → `<org>.github.io.`
3. In repo Pages settings, set the custom domain (GitHub commits a `CNAME` file), then tick **Enforce HTTPS** once the certificate is issued.
4. Add the domain to **Firebase Auth → Authorized domains**. Otherwise you get `auth/unauthorized-domain`.
5. Debug DNS against an external resolver (`dig @1.1.1.1`). Local resolvers, the ENS one in particular, cache stale answers.

## Email deliverability (the biggest operational problem)

Conference audiences use **institutional mail**, which quarantines Firebase's default sender (`noreply@<project>.firebaseapp.com`). Treat this as a launch blocker.

What worked for PINTS:

1. **Firebase custom email domain**: Auth → Templates → customize the domain to `pints.fr`. It adds TXT records (`firebase=…`, SPF `include:_spf.firebasemail.com`) and two DKIM CNAMEs. **Merge into the single existing `v=spf1` record. Never add a second one.** Stay within SPF's 10-lookup limit.
2. Add **DMARC** (`_dmarc`, start at `p=none`, with `rua` to an on-domain address).
3. **Publish an MX record.** Without an MX, the A record is treated as the MX (RFC 5321). Gateways that probe the sender, like `@cnrs.fr`, hang on GitHub Pages port 25 and drop the mail silently. PINTS used ImprovMX free with a catch-all, so `noreply@pints.fr` resolves. Never use a null MX.
4. The **action links in the emails cannot be moved** to your own domain. Firebase accepts only its two default handler URLs (`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`). Don't spend a day on this.
5. Fallbacks still matter:
   - A resend button on every waiting page.
   - A contact form.
   - Organizers can confirm an email by hand.
   - Tell people to check spam.
6. Test from a **real institutional address**. Gmail arriving proves the pipeline works, not that filters let it through. Port 25 may be blocked on a campus network, so outbound SMTP probes from there prove nothing.

## Firebase project setup (one time)

1. Create the project, turn Analytics off, and **switch to the Blaze plan** (Storage needs it). Set a budget alert of a few euros.
2. Create the Firestore database in production mode, in an EU location.
3. Auth: enable Email/Password. Add authorized domains (custom domain, `<org>.github.io`, `localhost`, `127.0.0.1`).
4. Register a web app and paste the config into `js/firebase-config.js`. **The API key is public by design.** Dismiss GitHub's secret-scanning alert. If you want to limit quota abuse, restrict the key by HTTP referrer, limit it to the APIs used, and add App Check. Hiding the key does nothing.
5. Start Storage. `npx firebase login && npx firebase use --add`, then deploy the rules.
6. Seed `config/site` (`submissionsOpen`, `submissionDeadline`, `eventDate`, `edition`). Rules that `get()` it deny everything while it is missing.
7. Create the first admin by hand: copy their UID from Auth → Users and create `admins/{uid}` in Firestore. Later admins are added from Settings.
8. Functions: `cd functions && npm i`, set the SMTP secrets, deploy.

## Running the conference: operator timeline

| When | Action |
|---|---|
| Call for abstracts | Settings: submissions open with a deadline, editing window set, registration open |
| After the deadline | Late links as needed. Reviewer mode on. Review. Bulk-accept posters. Promote talks. Split poster sessions. Renumber |
| Decisions out | Editing window open for corrections and publish choices. Then **Apply publish settings** after the editing deadline |
| Program | Schedule tab: items, sessions, chairs, linked abstracts, invited abstracts |
| Conference day | Voting open → home page button appears. Monitor the Voting tab (flagged ballots), close voting, export the CSV |
| Registration close | Untick "Registration is open". Late registration links for stragglers |

## Costs

Firestore, Auth, and Hosting all stayed within free limits. Storage needs Blaze but stayed within its free allowance (5 GB stored, 1 GB/day download), helped by downscaling in the browser. Watch out for pollers: a scheduled function running every minute is a steady Firestore read bill, which is why the backfill runs every 5 minutes.

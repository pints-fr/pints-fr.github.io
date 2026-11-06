# Notes: building a conference website like PINTS

These notes look back over the PINTS 2026 website project (July to November 2026). They are written as a **guide to building another site with the same kinds of features**: participant accounts, abstract submission and review, an editable program, a public poster list, organizer-editable pages, and voting. They do not replace the deeper documents already in the repo. Instead, they pull out what you need to start from scratch and point to those documents for details.

| File | What it covers |
|---|---|
| [01-project-history.md](01-project-history.md) | A timeline of every phase and session: what was asked for, what was built, and what changed direction |
| [02-architecture-blueprint.md](02-architecture-blueprint.md) | The stack, the file layout, the data model, and why each choice was made |
| [03-security-rules-patterns.md](03-security-rules-patterns.md) | Reusable Firestore and Storage rule patterns, which are the site's only access control |
| [04-feature-recipes.md](04-feature-recipes.md) | How each feature is built: registration, abstracts, review, schedule, pages, voting, late links, and more |
| [05-deployment-and-operations.md](05-deployment-and-operations.md) | GitHub Pages, custom domain and DNS, Firebase setup, email deliverability, deploying rules, costs |
| [06-dev-workflow-and-testing.md](06-dev-workflow-and-testing.md) | Emulators, the three test layers, and the day-to-day loop of working with Claude Code |
| [07-lessons-and-pitfalls.md](07-lessons-and-pitfalls.md) | A condensed list of traps that cost real time |
| [08-new-site-checklist.md](08-new-site-checklist.md) | Step-by-step instructions to start a new site of this kind |

## Deeper sources in this repo

- `docs/design-notes.md` gives the long-form reasons behind each decision (sections 1–8). It was written in July and August and was not updated for the September–November features, so these notes fill that gap.
- `README.md` is the operator runbook: Firebase setup, mail and DNS, the emulators, and admin tasks. **Some status lines in it are stale**, for example "Firebase not yet created" and "do not enable Cloud Functions". Treat the code and these notes as current.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` hold the original design spec and the phased implementation plan.

## The site in one paragraph

The site is static, multi-page HTML/CSS/JS (ES modules, **no build step**) hosted on **GitHub Pages** at a custom domain (`pints.fr`). **Firebase Auth** handles accounts and **Firestore** holds the data, so the browser talks to Firebase directly. **`firestore.rules` is the only access control.** Cloud Storage holds uploaded figures and photos. A small `functions/` folder holds only what must either bypass the rules or keep a secret: deleting accounts, sending contact-form mail, and a scheduled job that backfills the public participant list. Page copy is Markdown, which organizers edit in an admin console. Everything is scoped to one edition by a single `CURRENT_EDITION` constant.

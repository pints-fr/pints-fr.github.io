# Development workflow and testing

## Three test layers

Each layer catches problems the other two miss.

1. **Unit tests for pure functions.** `npm test`, which runs `node --test test/*.test.mjs`. 298 tests at the end of the project, running in about 0.3 s. Everything worth testing lives in `js/*-utils.mjs`: sorting, validation, time parsing, CSV quoting, sanitizing Markdown and styles, session grouping, vote tallies, review statistics, calendar links. No framework and no DOM.
2. **Security-rules tests.** `npm run test:rules` (`scripts/rules-tests.mjs` finds a JVM and runs the Firestore emulator). About 210 tests across `test/rules/*.rules.test.mjs`, one file per collection.
   - **Assert both allow and deny** for every case. A rule that allows everything passes a test that only checks allows.
   - **Use the exact payload the client writes** (`null`s included), ideally built by the same helper. A test that left out the figure field passed while production rejected `figureUrl: null`.
   - Run files **one at a time** (`--test-concurrency=1`). Each calls `clearFirestore()`, and running in parallel wipes sibling tests' data mid-run. It still passed, which made it dangerous.
   - `@firebase/rules-unit-testing` **v5** goes with `firebase` v12.
3. **Manual browser checks** on the emulators, and on production after deploying. This caught stale caches, undeployed rules, module load order, layout overflow, and compositing bugs. **An HTTP 200 doesn't mean the page works.** Load it and read the console.

The DOM is still untested: built tables, cards, and author superscripts were checked by eye. If the site grows, add tests there next.

## Running locally against emulators

```bash
PATH=/opt/homebrew/opt/openjdk/bin:$PATH npx firebase emulators:start --only firestore,auth,storage --project <project-id>
npx http-server -p 4173 -c-1 .
```

- `js/firebase.js` points Auth, Firestore, and Storage at the emulators when the URL has **`?emulator`** and the host is localhost.
  - **`?emulator` must be on every URL.** Without it the page talks to production.
  - **The login redirect drops it.** Sign in from the browser console instead: `await (await import('/js/auth.js')).signIn(email, pw, true)`. Then go to `admin.html?emulator`.
  - Generated links (registration or submission) need `&emulator` added by hand when testing.
- Seed over REST with `Authorization: Bearer owner`:
  - Auth on `:9099`: `accounts:signUp`, then `projects/<id>/accounts:update` with `emailVerified: true`.
  - Firestore on `:8080`: `admins/{uid}`, `users/{uid}`, **`config/site`**. Without `config/site`, every rule that reads it denies.
- Keep the seed in a script, because restarting the emulators wipes everything. A useful seed has an organizer, a second organizer (to check reviewer isolation), a plain participant, and one abstract in each state: accepted poster, accepted talk, rejected, and none.
- Leave the functions emulator out: it needs the SMTP secrets. Organizer delete won't work locally.
- Scripted clicks don't count as a user gesture, so `navigator.clipboard.writeText` can hang. Never make page logic wait on it.
- Running `http-server` **without** `?emulator` serves local code against **live data**. Sometimes that's useful (testing a change against real settings), but tell the user that saving there changes the live site.

## The working loop with Claude Code (what actually happened)

Almost every request in the operating season followed the same steps, in separate short sessions:

1. **Pull first** (`git pull --rebase`). The repo has other committers and some commits made from the web. Several sessions found local `main` behind origin.
2. Implement it. Pure logic goes into `*-utils.mjs` with tests, rules changes come with rules tests, and UI changes are kept minimal.
3. "**Run a local host for testing.**" Start the emulators and the static server, seed the right accounts and states, and hand the user the URLs plus where the throwaway test credentials are (a file in the scratchpad, never in chat).
4. User checks it, asks for tweaks, and the loop repeats.
5. "**Deploy rules first**" if the rules changed. Check origin for drift, confirm the new rules are safe with the code currently live, then `npx firebase deploy --only firestore:rules`.
6. "**Commit and push.**" Leave out unrelated untracked files (`AGENTS.md`, `.codegraph/`). Rebase onto origin and re-run tests if it moved.
7. Tell the user what still has to be done in the live admin console (for example "tick the editing window", "set the party item's kind to social", "click Apply publish settings").
8. Stop the local servers.

Other habits that paid off:

- **Say what you added that wasn't asked for.** For example, the veto count and handling of old-scale scores. Organizers need to know about behaviour changes on live data, such as "existing scores 5–10 need rescoring".
- Before a destructive admin feature (delete all reviews), recommend **exporting a CSV first**.
- Persist hard-won operational facts in Claude's memory: rules deploy by hand, emulator quirks, DNS specifics. That stopped the same mistakes from happening twice.
- Keep `docs/design-notes.md` going as a "why" log. Record reversals with the reasoning, so the next person doesn't undo a decision without knowing why it was made. *(It wasn't updated after August. The later reasoning sits in commit messages and these notes.)*
- Write commit messages that explain *why*. Several key decisions are recorded only there.

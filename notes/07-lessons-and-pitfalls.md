# Lessons and pitfalls: a condensed list

Each item cost real time on PINTS. The section numbers point to `docs/design-notes.md`, which has the full story.

## Architecture and product

1. **Field-level read rules don't exist.** Use a private document plus a public projection written in the same batch (§3.1).
2. **Use the uid as the document ID for "one per person".** It's the only limit the rules can enforce (§7.1). Abstracts went from uid IDs to auto IDs and back.
3. **Keep Cloud Functions for "bypass the rules" or "hold a secret".** Ordinary reads and writes stay in the browser, so no page load waits on a cold start (§3.2c, §7.4).
4. **Don't store credentials in the browser.** A GitHub token in `sessionStorage` worked, and was removed anyway (§3.2b).
5. **Gate on the capability, not the role.** `accepted && !republish`, not `accepted && !isAdmin` (§3.2d).
6. **Expect policy to change back and forth.** The verification gate moved off submission and back on (§7.5, §7.21). Keep each gate in one rule function and one page-side check.
7. **Every deadline needs an exception path.** Build window + single-use link + per-person grant once.
8. **Derive what you can instead of storing it.** Session numerals, banner text, and grouping are computed, so an inserted session never needs everything renumbered by hand (§7.13).
9. **One renderer per concept, one view per state.** Two renderers or two "your submission" screens will drift and contradict each other (§7.14, §7.17).
10. **Retiring a stored value:** keep accepting it as a "from" state in the rules, and label anything unknown safely ("In review") (§7.18).
11. **Blind review in the UI is not secrecy.** Say so to organizers.
12. **A mean score hides vetoes.** Show the veto count. Sort unscored items last both ways. Never sort across topics (§7.20).
13. **Matching names is a weak identity check.** Matching voters to authors by name misses initials and spelling variants. Back it up with admin flags and manual deletion. If a rule depends on lab or team, collect that field at registration.

## Firebase

14. **`email_verified` in the token is stale.** Call `user.reload()` + `getIdToken(true)` before trusting it (§4.2).
15. **Pushing doesn't deploy rules.** Deploy them by hand, *before or with* the code. Pull first so you don't roll back someone else's rules.
16. **Rules must accept the exact client payload, including `null`s.** Admins bypass validation, so they won't see the bug.
17. **A missing `config/site` means every gated rule denies.** Use `.get(field, default)` for fields added later, and choose fail-open or fail-closed on purpose.
18. **`get()` inside a batch reads the state before the batch.** Use `getAfter()` for conditions that depend on the same batch.
19. **Collection queries need `list`.** Don't write rules that inspect `request.query`.
20. **Public reads wait for Auth** unless they go through a separate Firebase app with no Auth.
21. **Storage rules can't read Firestore.** Put ownership in the path. Admin deletes of other people's objects need a function.
22. **Cloud Storage needs the Blaze plan** (since Feb 2026). Set a budget alert and downscale images in the browser.
23. **The web API key is public.** Restrict it by referrer and add App Check. Don't try to hide it (§3.4).
24. **Firebase email action URLs can't be customized** on this setup. When a black box refuses input, change one variable per probe (§7.25).

## Email and DNS

25. **Institutional filters drop Firebase's default sender.** Use a custom email domain with SPF, DKIM, and DMARC (§4.2).
26. **A domain with no MX record makes probing gateways drop mail silently.** Publish an MX (README, deliverability section).
27. **Only one SPF record per domain.** Merge, never add a second, and stay within 10 lookups.
28. **Test delivery to an institutional address**, not just Gmail. Query an external DNS resolver.

## GitHub Pages and the browser

29. **Add `.nojekyll`**, and make **`404.html` self-contained** with a `<base>` tag (§4.3).
30. **Use relative paths everywhere.** The site moved from a user subpath to an org root to a custom domain.
31. **Assets are cached for 10 minutes, and dynamic `import()` ignores hard reloads.** Don't decide a fix failed too early.
32. **`loading="lazy"` + a disclosure = an image that never loads** (0×0 never intersects). Defer by not building the DOM instead (§7.16).
33. **CSS shorthands set every longhand they cover.** `padding: 0 x` on `.wrap` silently cancelled `main`'s vertical padding (§7.12).
34. **`ch` units are relative to the element's own font** (§7.12).
35. **`transparent` is transparent black.** Use `rgb(from var(--c) r g b / 0)` in gradients (§7.22).
36. **A blend-mode layer with nothing underneath still paints.** Put decorative layers on the thing they decorate (§7.22).
37. **SVG `<text>` falls back to a serif font on Linux and Android.** Convert logo text to outlines (§7.11).
38. **Markdown can't add a class.** Image constraints must be global (`img{max-width:100%}`).
39. **Two related messages shown in one element overwrite each other.** Give each persistent message its own element (§7.7).
40. **State the user created (open rows) must live outside DOM nodes that get re-rendered** (§7.19).

## Testing

41. **Assert both allow and deny** in rules tests. Run rules test files one at a time.
42. **HTTP 200 doesn't mean it works.** Load the page and read the console.
43. **Compositing and layout bugs only show in a screenshot.** Check visual changes at phone width too.

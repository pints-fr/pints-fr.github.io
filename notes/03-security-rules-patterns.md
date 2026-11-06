# Security-rules patterns

With no server, **`firestore.rules` and `storage.rules` are the only access control**. Anyone can read the public API key and call Firestore directly. Anything the page hides but the rules allow is effectively public. Each pattern below was used in PINTS and can be reused as is.

## 1. Helper functions

```
function isSignedIn() { return request.auth != null; }
function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }
function isVerified() { return isSignedIn() && request.auth.token.email_verified == true; }
function isAdmin()   { return isSignedIn() && exists(/databases/$(database)/documents/admins/$(request.auth.uid)); }
function str(v, max) { return v is string && v.size() > 0 && v.size() <= max; }
function optStr(d, f, max) { return !(f in d) || (d[f] is string && d[f].size() <= max); }
```

## 2. Public projection documents

Fields can't be hidden, so data that is part private and part public lives in two documents: `users/{uid}` + `participants_public/{uid}`, and `abstracts/{uid}` + `abstracts_public/{uid}`. Reviews get their own admin-only collection so an author can never read them.

When an owner may rewrite their own public copy, the rule checks **both sides of the batch** with `getAfter()`. For example, `publicMatches(getAfter(public), request.resource.data)` means the owner can't leave the public copy stale or put anything on it that the private copy doesn't say. The committee's fields (type, board number, session, acceptedAt) are pinned with `request.resource.data.get(f,null) == resource.data.get(f,null)`.

## 3. "One per person": the doc ID is the uid

`abstracts/{uid}`, `poster_votes/{uid}`, `edit_grants/{uid}`. Rules can't count documents, but they don't need to when the only slot that can be written is named by the uid. Changing a vote is just overwriting it. This means `list` can be admin-only, because an owner reads their own doc with a direct `get`.

> PINTS switched abstracts to auto IDs once and then back (design-notes §7.1). If you ever need several per person, use `abstracts/{autoId}` with `allow list: if resource.data.ownerUid == request.auth.uid` and always query with `where("ownerUid","==",uid)`. You then lose the ability to enforce the limit in the rules.

## 4. Windows from `config/site`

```
function submissionWindowOpen() {           // fails CLOSED: missing doc → error → deny
  let cfg = get(/databases/$(database)/documents/config/site).data;
  return cfg.submissionsOpen == true && request.time < cfg.submissionDeadline;
}
function registrationOpen() {               // fails OPEN: switch added after launch
  let p = /databases/$(database)/documents/config/site;
  return !exists(p) || get(p).data.get('registrationOpen', true) != false;
}
```

Choose deliberately, for each switch, which way it fails when the setting is missing:
- Voting, submissions, and editing fail **closed**.
- Registration fails **open**, because a config written before the switch existed must not silently shut registration.

Use `cfg.get('field', default)` for any field added later. A plain `cfg.field` on a missing field makes the rule error, and an error means deny. That can bring down an unrelated window.

Keep **the submission window (create) separate from the editing window (update/delete)**. `canEdit(uid) = editWindowOpen() || lateEditGranted(uid)`.

## 5. Exception tokens: single-use links spent atomically

Used for late registration and late submission. The link doc's ID *is* the random token (32 chars).

```
match /registration_links/{token} {
  allow get: if true;                       // holding the link = knowing the id
  allow list, delete: if isAdmin();         // revoke = delete
  allow create: if isAdmin() && <shape: createdBy, createdAt, expiresAt is timestamp>;
  allow update: if isSignedIn()
    && !('usedBy' in resource.data) && resource.data.expiresAt > request.time
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['usedBy','usedAt'])
    && request.resource.data.usedBy == request.auth.uid
    && request.resource.data.usedAt == request.time
    && getAfter(/…/users/$(request.auth.uid)).data.get('registrationLink', null) == token;
}
function redeemsLink(data) {               // used in users/{uid} create
  let p = /…/registration_links/$(data.registrationLink);
  return 'registrationLink' in data && exists(p)
    && !('usedBy' in get(p).data) && get(p).data.expiresAt > request.time   // BEFORE the batch
    && getAfter(p).data.get('usedBy', null) == request.auth.uid;           // AFTER the batch
}
```

The client writes the profile and stamps the link in **one `writeBatch`**. `get()` reads the state before the batch and `getAfter()` reads it after. Together they mean a link can't be reused or spent by anything except the registration it lets through, and two people racing for one link can't both succeed. The record keeps the token, and later updates pin it so it can't be changed.

A **per-person grant** is simpler. `edit_grants/{uid}` with `expiresAt`. The link you send is a plain `submit.html?edit=1`. The grant is the permission, so a forwarded link is useless to anyone else.

## 6. Gate on the capability, not the role

Accepted abstracts are frozen because editing them would leave the public copy stale. The tempting rule is `frozen = accepted && !isAdmin`, and it is **wrong**: an admin editing their *own* abstract from the account page would leave the public copy stale. Unfreeze only when the write demonstrably includes the public rewrite (`publicMatches` via `getAfter`).

## 7. Validate shape strictly, and allow the exact payload the client sends

`keys().hasOnly([...])` + `keys().hasAll([...])` + a type and length check for each field. **Allow `null` wherever the client writes `null`**. A production bug came from the rules accepting "missing or string" when `saveAbstract()` wrote `figureUrl: null`. Admins didn't notice because `allow write: if isAdmin()` skips validation.

Pin server timestamps: `request.resource.data.updatedAt == request.time`.

## 8. Retired values stay readable and writable

`withdrawn` was retired as a status, but it stays in the list of statuses a doc may be updated *from*. Removing it would freeze any document still holding it. Migrate by normalizing on the next save, not with a script.

## 9. Rules have no loops and no Unicode folding

- To check whether a voter is a co-author, PINTS unrolled `authorAt(authors, 0..19, key)` up to the author cap enforced by `validAbstract`.
- `nameKey()` in the rules lowercases and collapses spaces and hyphens, but it can't strip accents. The page also strips accents, and the admin tab flags ballots that slip through. **The rules are a backstop. Show organizers whatever the rules can't catch.**

## 10. Storage

- Ownership is in the path (`abstract_figures/{uid}/…`). Cap size and `contentType`.
- The rules can't call `isAdmin()` because they can't read Firestore. Admin deletes of other people's objects go through a function. Alternatively, accept that the object stays.
- Shared objects: archive albums reuse hero photos. Deleting a hero photo first checks whether any album still references it. Of the two directions this coupling needs, only one can be encoded in the path prefix. The other needs a lookup.

## 11. Things that fail in surprising ways

- **`list` vs `get`.** List pages need `list`. `allow read` covers both. Don't write rules that inspect `request.query`.
- **`get()` inside a batch sees the state before the batch.** Use `getAfter()` when the condition depends on another write in the same batch.
- **A missing `config/site`** makes every rule that calls `get()` on it deny. Seed it in the emulator first.
- **Pages ships the site, but the rules are deployed by hand.** See 05.

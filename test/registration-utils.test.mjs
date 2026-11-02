import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  editLinkUrl, grantStatus, isRegistrationOpen, linkStatus, newLinkToken, registrationLinkUrl,
} from "../js/registration-utils.mjs";

test("registration is open when there is no config at all", () => {
  assert.equal(isRegistrationOpen(null), true);
  assert.equal(isRegistrationOpen(undefined), true);
});

test("registration is open when the field predates the switch", () => {
  assert.equal(isRegistrationOpen({ submissionsOpen: false }), true);
});

test("registration follows the switch once it is set", () => {
  assert.equal(isRegistrationOpen({ registrationOpen: true }), true);
  assert.equal(isRegistrationOpen({ registrationOpen: false }), false);
});

const now = new Date("2026-10-09T12:00:00Z");
const later = new Date("2026-10-10T12:00:00Z");
const earlier = new Date("2026-10-08T12:00:00Z");

test("a link that does not exist is missing", () => {
  assert.equal(linkStatus(null, now), "missing");
});

test("an unused link is valid until it expires", () => {
  assert.equal(linkStatus({ expiresAt: later }, now), "valid");
  assert.equal(linkStatus({ expiresAt: earlier }, now), "expired");
  assert.equal(linkStatus({ expiresAt: now }, now), "expired");
});

test("a link reads Firestore timestamps as well as dates", () => {
  assert.equal(linkStatus({ expiresAt: { toDate: () => later } }, now), "valid");
});

test("a spent link is used, whether or not it has expired", () => {
  assert.equal(linkStatus({ expiresAt: later, usedBy: "alice" }, now), "used");
  assert.equal(linkStatus({ expiresAt: earlier, usedBy: "alice" }, now), "used");
});

test("a link without an expiry is treated as expired", () => {
  assert.equal(linkStatus({}, now), "expired");
});

test("tokens are lowercase hex, two digits a byte", () => {
  assert.equal(newLinkToken(new Uint8Array([0, 15, 255])), "000fff");
});

test("the link points at register.html next to the admin page", () => {
  assert.equal(registrationLinkUrl("https://pints.fr/admin.html#settings", "abc"),
    "https://pints.fr/register.html?link=abc");
});

test("a late-editing grant is active until it expires", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  assert.equal(grantStatus({ expiresAt: new Date("2026-11-03T00:00:00Z") }, now), "active");
  assert.equal(grantStatus({ expiresAt: { toDate: () => new Date("2026-11-01T00:00:00Z") } }, now),
    "expired");
  assert.equal(grantStatus({}, now), "expired");
});

test("the late-editing link opens the editor next to the admin page", () => {
  assert.equal(editLinkUrl("https://pints.fr/admin.html#settings"),
    "https://pints.fr/submit.html?edit=1");
});

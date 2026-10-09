import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isRegistrationOpen } from "../js/registration-utils.mjs";

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

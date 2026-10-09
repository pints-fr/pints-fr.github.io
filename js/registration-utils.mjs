// Whether new people may register, read off config/site.
//
// A missing document or a missing field counts as OPEN: the switch was added
// after the site went live, and a config written before it must not quietly
// close registration. firestore.rules reads the field the same way
// (registrationOpen()), so the page and the database agree on the default.

/** True unless an organizer has explicitly closed registration. */
export function isRegistrationOpen(config) {
  return config?.registrationOpen !== false;
}

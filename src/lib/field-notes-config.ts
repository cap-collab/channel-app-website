// Field Notes access gate.
//
// While TRUE, the entire /field-notes page and all Field Notes API routes are
// restricted to admin-dashboard access (isBroadcaster: role 'broadcaster' | 'admin').
// This is the same check that gates /broadcast/admin, so the channelbroadcast
// test/admin account passes.
//
// To launch Field Notes publicly: flip this to false AND re-enable the public
// read rule for published notes in firestore.rules (see the field-notes block).
export const FIELD_NOTES_ADMIN_ONLY = true;

// Max length of a field note recording, in seconds.
export const MAX_FIELD_NOTE_DURATION_SEC = 60;

// Tapes menu-link gate.
//
// While TRUE, the "Tapes" menu link is only shown to admin-dashboard accounts
// (isBroadcaster: role 'broadcaster' | 'admin'). The /tape page and the Tapes
// API routes are already public regardless of this flag — it only controls
// whether the menu link is visible to everyone.
//
// FALSE = launched publicly: the menu link shows for all users. The public read
// rule for published notes in firestore.rules is already enabled.
export const FIELD_NOTES_ADMIN_ONLY = false;

// Max length of a field note recording, in seconds.
export const MAX_FIELD_NOTE_DURATION_SEC = 60;

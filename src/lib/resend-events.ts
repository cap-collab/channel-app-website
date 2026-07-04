// Shared Resend "emails" list paginator + per-recipient event bucketing.
//
// Resend's GET /emails returns the account's recent emails, newest first, one
// row per send with a `last_event` (the LATEST event seen for that email:
// sent / delivered / opened / clicked / bounced / complained / unsubscribed …).
// The list is cursor-paginated with `limit` (max 100/page) + an `after` cursor;
// the response carries `has_more`. There is no server-side subject/date filter,
// so callers filter the rows client-side.
//
// Used by the weekly-recommendations report run to (a) gate per-user rec
// rotation on whether they opened last week and (b) email Cap a recap.

const RESEND_EMAILS_API = "https://api.resend.com/emails";

// One row of the /emails list response (fields we rely on).
export interface ResendEmailRow {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string; // ISO
  last_event: string;
}

interface ResendListResponse {
  data: ResendEmailRow[];
  // Resend paginates with a boolean `has_more`; the cursor for the next page is
  // the last row's id (passed back as `after`).
  has_more?: boolean;
}

export interface ListResendEmailsOptions {
  apiKey: string;
  // Keep rows created at/after this ms; paging stops once a page's oldest row
  // predates it (the list is newest-first, so nothing older is relevant).
  sinceMs: number;
  // Optional upper bound — drop rows created after this ms (e.g. exclude the
  // current in-flight send when looking at "last week").
  untilMs?: number;
  // Only keep rows whose subject exactly equals this (client-side filter).
  subject?: string;
  // Safety cap on pages so a runaway never blocks the cron. Logs if hit.
  maxPages?: number;
}

// Page GET /emails from newest backwards until we pass `sinceMs` (or run out of
// pages / hit maxPages), returning the filtered rows.
export async function listResendEmails(
  opts: ListResendEmailsOptions,
): Promise<{ rows: ResendEmailRow[]; truncated: boolean; pagesFetched: number }> {
  const { apiKey, sinceMs, untilMs, subject } = opts;
  const maxPages = opts.maxPages ?? 50;

  const kept: ResendEmailRow[] = [];
  let after: string | undefined;
  let pagesFetched = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(RESEND_EMAILS_API);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Resend /emails list failed: ${res.status}`);
    }
    const body = (await res.json()) as ResendListResponse;
    pagesFetched++;

    const rows = body.data || [];
    if (rows.length === 0) break;

    let pageWentBelowWindow = false;
    for (const row of rows) {
      const createdMs = Date.parse(row.created_at);
      if (Number.isNaN(createdMs)) continue;
      if (createdMs < sinceMs) {
        // Newest-first: the first row older than the window means the rest of
        // this page (and all later pages) are older too.
        pageWentBelowWindow = true;
        break;
      }
      if (untilMs != null && createdMs > untilMs) continue; // too new — skip
      if (subject != null && row.subject !== subject) continue;
      kept.push(row);
    }

    if (pageWentBelowWindow) break;
    if (!body.has_more) break;
    after = rows[rows.length - 1]?.id;
    if (!after) break;

    // Ran the full page budget with more still available.
    if (page === maxPages - 1) truncated = true;
  }

  return { rows: kept, truncated, pagesFetched };
}

// Per-recipient event flags, collapsed from `last_event`.
export interface RecipientEvent {
  opened: boolean;
  unsubscribed: boolean;
  bounced: boolean;
}

// Map Resend `last_event` → coarse flags. `last_event` is the LATEST event only,
// so open-then-unsubscribe collapses to unsubscribed — acceptable for a weekly
// summary and for open-gating (a user who unsubscribed shouldn't be rotated).
export function eventFlags(lastEvent: string): RecipientEvent {
  switch (lastEvent) {
    case "opened":
    case "clicked":
      return { opened: true, unsubscribed: false, bounced: false };
    case "unsubscribed":
      return { opened: false, unsubscribed: true, bounced: false };
    case "bounced":
    case "complained":
      return { opened: false, unsubscribed: false, bounced: true };
    default:
      // sent / delivered / delivery_delayed / … → no signal we act on.
      return { opened: false, unsubscribed: false, bounced: false };
  }
}

// Build an email(lowercased) → RecipientEvent map from filtered rows. When a
// recipient appears in more than one row (shouldn't for one weekly send, but be
// safe), OR the flags so any positive signal wins.
export function buildRecipientEventMap(rows: ResendEmailRow[]): Map<string, RecipientEvent> {
  const map = new Map<string, RecipientEvent>();
  for (const row of rows) {
    const flags = eventFlags(row.last_event);
    for (const addr of row.to || []) {
      const key = addr.toLowerCase();
      const prev = map.get(key);
      if (prev) {
        map.set(key, {
          opened: prev.opened || flags.opened,
          unsubscribed: prev.unsubscribed || flags.unsubscribed,
          bounced: prev.bounced || flags.bounced,
        });
      } else {
        map.set(key, { ...flags });
      }
    }
  }
  return map;
}

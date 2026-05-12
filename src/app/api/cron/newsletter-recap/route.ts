import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  NEWSLETTER_FROM_EMAIL,
  NEWSLETTER_SUBJECTS,
  type Cohort,
} from "@/lib/channel-newsletter";

// Tuesday 15:00 UTC (8 AM PT). Pulls the most recent Monday send from
// Resend's emails API, splits by cohort (matching subject), and emails
// Cap a recap with delivery / open / click / bounce / complaint counts.
//
// Open rates are best-effort: Apple Mail Privacy Protection pre-loads
// tracking pixels, so opens are inflated, especially on iOS-heavy lists.
// Unsubscribe / bounce / complaint counts are reliable.

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

type ResendEmail = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event: string;
};

type ResendListResponse = { data: ResendEmail[] };

type CohortStats = {
  cohort: Cohort;
  subject: string;
  total: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  other: number;
};

const RESEND_API = "https://api.resend.com/emails?limit=200";

function emptyStats(cohort: Cohort, subject: string): CohortStats {
  return { cohort, subject, total: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, other: 0 };
}

function bucketEvent(stats: CohortStats, event: string): void {
  // Resend last_event values: sent, delivered, opened, clicked, bounced,
  // complained, delivery_delayed, etc. We treat opened/clicked as a
  // superset of delivered (they imply delivery) for counting.
  switch (event) {
    case "delivered":
    case "sent":
      stats.delivered++;
      break;
    case "opened":
      stats.delivered++;
      stats.opened++;
      break;
    case "clicked":
      stats.delivered++;
      stats.opened++;
      stats.clicked++;
      break;
    case "bounced":
      stats.bounced++;
      break;
    case "complained":
      stats.complained++;
      break;
    default:
      stats.other++;
  }
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function buildRecapHtml(djStats: CohortStats, listenerStats: CohortStats, sendDateLabel: string): string {
  const row = (s: CohortStats) => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${s.cohort === "dj" ? "Artists" : "Listeners"}</td>
      <td style="padding:8px;border:1px solid #ddd;">${s.total}</td>
      <td style="padding:8px;border:1px solid #ddd;">${s.delivered} (${pct(s.delivered, s.total)})</td>
      <td style="padding:8px;border:1px solid #ddd;">${s.opened} (${pct(s.opened, s.delivered)})</td>
      <td style="padding:8px;border:1px solid #ddd;">${s.clicked} (${pct(s.clicked, s.delivered)})</td>
      <td style="padding:8px;border:1px solid #ddd;">${s.bounced}</td>
      <td style="padding:8px;border:1px solid #ddd;">${s.complained}</td>
    </tr>
  `;
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">Channel newsletter recap — ${sendDateLabel}</h2>
    <p style="margin:0 0 12px;font-size:13px;color:#555;">
      Numbers from Resend for emails sent in the last 24h matching the newsletter subjects.
    </p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="background:#f6f6f6;">
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Cohort</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Sent</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Delivered</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Opened</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Clicked</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Bounced</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Complained</th>
        </tr>
      </thead>
      <tbody>
        ${row(djStats)}
        ${row(listenerStats)}
      </tbody>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.5;">
      Note: open rates count tracking pixel hits. Apple Mail Privacy Protection
      pre-loads images for users on iOS / macOS Mail, which inflates the open
      rate. Clicks, bounces, and complaints are not affected.
    </p>
    <p style="margin:8px 0 0;font-size:12px;color:#888;">
      Subjects matched: <code>${djStats.subject}</code>${djStats.subject === listenerStats.subject ? "" : ` / <code>${listenerStats.subject}</code>`}
    </p>
  </body></html>`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  const res = await fetch(RESEND_API, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Resend API: ${res.status}` }, { status: 500 });
  }
  const data = (await res.json()) as ResendListResponse;

  // Only look at the last 36h to be safe — Tuesday 8 AM PT recapping
  // Monday 2 PM PT send is ~18h apart.
  const cutoff = Date.now() - 36 * 60 * 60 * 1000;
  const recent = data.data.filter((e) => new Date(e.created_at).getTime() >= cutoff);

  const djStats = emptyStats("dj", NEWSLETTER_SUBJECTS.dj);
  const listenerStats = emptyStats("listener", NEWSLETTER_SUBJECTS.listener);
  const sameSubject = NEWSLETTER_SUBJECTS.dj === NEWSLETTER_SUBJECTS.listener;

  // When DJs and listeners share a subject we can't tell them apart from
  // Resend metadata alone — count everything matching the subject under
  // a single combined bucket and report it under "All recipients".
  if (sameSubject) {
    const combined = emptyStats("listener", NEWSLETTER_SUBJECTS.listener);
    combined.cohort = "listener";
    for (const e of recent) {
      if (e.subject !== NEWSLETTER_SUBJECTS.dj) continue;
      combined.total++;
      bucketEvent(combined, e.last_event);
    }
    djStats.total = 0;
    djStats.subject = "(shared subject — see combined row)";
    Object.assign(listenerStats, combined);
    listenerStats.subject = `${NEWSLETTER_SUBJECTS.listener} (combined)`;
  } else {
    for (const e of recent) {
      if (e.subject === NEWSLETTER_SUBJECTS.dj) {
        djStats.total++;
        bucketEvent(djStats, e.last_event);
      } else if (e.subject === NEWSLETTER_SUBJECTS.listener) {
        listenerStats.total++;
        bucketEvent(listenerStats, e.last_event);
      }
    }
  }

  const sendDateLabel = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const subject = sameSubject
    ? `[newsletter recap] ${listenerStats.total} sent — ${listenerStats.opened} opens, ${listenerStats.bounced} bounces`
    : `[newsletter recap] DJs: ${djStats.total} · Listeners: ${listenerStats.total}`;

  try {
    await resend.emails.send({
      from: NEWSLETTER_FROM_EMAIL,
      to: "cap@channel-app.com",
      subject,
      html: buildRecapHtml(djStats, listenerStats, sendDateLabel),
    });
    return NextResponse.json({
      sentTo: "cap@channel-app.com",
      sameSubject,
      djStats,
      listenerStats,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

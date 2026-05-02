import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  buildAuditHtml,
  buildAuditRows,
  NEWSLETTER_FROM_EMAIL,
} from "@/lib/channel-newsletter";

// Monday 2026-05-04, 18:00 UTC (11 AM PT). Pre-flight audit email to Cap,
// 3 hours before the 2 PM PT send.
// Scheduled via vercel.json; the cron secret is validated via either the
// Vercel-cron header or a Bearer token (matching the pattern used by other
// channel-app crons).

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const rows = await buildAuditRows(db);
  const html = buildAuditHtml(rows);
  const killed = process.env.NEWSLETTER_KILL === "true";
  const banner = killed
    ? `<p style="margin:0 0 16px;padding:12px;background:#fee;border:1px solid #c00;color:#900;font-size:14px;">⚠️ NEWSLETTER_KILL=true — the 2 PM PT send will be skipped. Flip the env var in Vercel to re-enable.</p>`
    : `<p style="margin:0 0 16px;padding:12px;background:#efe;border:1px solid #090;color:#060;font-size:14px;">✅ NEWSLETTER_KILL is not set — send will fire at 2 PM PT unless you flip it in Vercel.</p>`;
  const finalHtml = html.replace(
    `<h2 style="margin:0 0 8px;">Channel newsletter recipient audit</h2>`,
    `<h2 style="margin:0 0 8px;">Pre-flight: Channel newsletter (2 PM PT send)</h2>${banner}`,
  );

  try {
    await resend.emails.send({
      from: NEWSLETTER_FROM_EMAIL,
      to: "cap@channel-app.com",
      subject: `[pre-flight] Newsletter send in 1 hour — ${rows.filter((r) => r.onNextSend).length} recipients`,
      html: finalHtml,
    });
    return NextResponse.json({
      sentTo: "cap@channel-app.com",
      totalRows: rows.length,
      onNextSend: rows.filter((r) => r.onNextSend).length,
      killSwitchEngaged: killed,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

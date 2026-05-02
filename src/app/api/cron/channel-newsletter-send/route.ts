import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  buildEmailHtml,
  buildListUnsubscribeHeaders,
  getDjRecipients,
  getListenerRecipients,
  NEWSLETTER_FROM_EMAIL,
  subjectFor,
} from "@/lib/channel-newsletter";

// Monday 2026-05-04, 21:00 UTC (2 PM PT). Sends the channel-wide newsletter.
//
// Abort: set NEWSLETTER_KILL=true in Vercel env. Takes effect on next
// request, no redeploy needed.
//
// Recipients are pulled live from Firestore at send time, so last-minute
// signups and opt-outs are respected.

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.NEWSLETTER_KILL === "true") {
    console.log("[channel-newsletter-send] Aborted: NEWSLETTER_KILL=true");
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: NEWSLETTER_FROM_EMAIL,
        to: "cap@channel-app.com",
        subject: "[newsletter] ABORTED — NEWSLETTER_KILL=true",
        html: `<p>The 2 PM PT send was aborted because <code>NEWSLETTER_KILL</code> is set to <code>true</code> in Vercel. No emails were sent.</p>`,
      }).catch((e) => console.error("[channel-newsletter-send] kill-notice email failed:", e));
    }
    return NextResponse.json({ aborted: true, reason: "NEWSLETTER_KILL=true" });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const djRecipients = await getDjRecipients(db);
  const djEmails = new Set(djRecipients.map((r) => r.email));
  const listenerRecipients = await getListenerRecipients(db, djEmails);
  const selected = [...djRecipients, ...listenerRecipients];

  let sent = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];
  for (const recipient of selected) {
    try {
      await resend.emails.send({
        from: NEWSLETTER_FROM_EMAIL,
        to: recipient.email,
        subject: subjectFor(recipient.cohort),
        html: buildEmailHtml(recipient.name, recipient.cohort, recipient.email, recipient.djUsername),
        headers: buildListUnsubscribeHeaders(recipient.email, recipient.cohort === "dj" ? "dj" : "marketing"),
      });
      sent++;
    } catch (e) {
      failed++;
      errors.push({ email: recipient.email, error: String(e) });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const summaryHtml = `<h2>Channel newsletter send complete</h2>
    <p><strong>Sent:</strong> ${sent} / ${selected.length}<br/>
    <strong>Failed:</strong> ${failed}<br/>
    <strong>DJ cohort:</strong> ${djRecipients.length}<br/>
    <strong>Listener cohort:</strong> ${listenerRecipients.length}</p>
    ${errors.length > 0 ? `<p><strong>Errors:</strong></p><ul>${errors.map((e) => `<li>${e.email} — ${e.error}</li>`).join("")}</ul>` : ""}`;
  await resend.emails.send({
    from: NEWSLETTER_FROM_EMAIL,
    to: "cap@channel-app.com",
    subject: `[newsletter] Sent ${sent}/${selected.length} · ${failed} failed`,
    html: summaryHtml,
  }).catch((e) => console.error("[channel-newsletter-send] summary email failed:", e));

  return NextResponse.json({
    sent,
    failed,
    totalSelected: selected.length,
    djCohort: djRecipients.length,
    listenerCohort: listenerRecipients.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

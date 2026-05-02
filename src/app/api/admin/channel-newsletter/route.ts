import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  buildAuditHtml,
  buildAuditRows,
  buildEmailHtml,
  buildListUnsubscribeHeaders,
  getDjRecipients,
  getListenerRecipients,
  NEWSLETTER_FROM_EMAIL,
  NEWSLETTER_APP_URL,
  subjectFor,
  type Recipient,
} from "@/lib/channel-newsletter";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Modes:
//   ?mode=preview&cohort=dj|listener[&to=foo@bar.com]
//   ?mode=dry-run&cohort=dj|listener|all  (default = all)
//   ?mode=compare&lastSubject=...&cohort=dj|listener|all
//   ?mode=audit                           — emails Cap a full roster table
//   ?mode=send&cohort=dj|listener|all     (LOCKED until SEND_ENABLED=true)

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") || "dry-run";
  const cohortParam = (request.nextUrl.searchParams.get("cohort") || "all") as
    | "dj"
    | "listener"
    | "all";

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const djRecipients = await getDjRecipients(db);
  const djEmails = new Set(djRecipients.map((r) => r.email));
  const listenerRecipients =
    cohortParam === "dj" ? [] : await getListenerRecipients(db, djEmails);

  const selected: Recipient[] =
    cohortParam === "dj"
      ? djRecipients
      : cohortParam === "listener"
        ? listenerRecipients
        : [...djRecipients, ...listenerRecipients];

  // ── Preview ──
  if (mode === "preview") {
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }
    if (cohortParam === "all") {
      return NextResponse.json({ error: "preview requires cohort=dj|listener" }, { status: 400 });
    }
    const toParam = request.nextUrl.searchParams.get("to");
    const asParam = request.nextUrl.searchParams.get("as");
    const previewTo = toParam || "cap@channel-app.com";
    const tokenEmail = asParam || previewTo;
    const matched = selected.find((r) => r.email === tokenEmail);
    const previewName = matched?.name || "Cap";
    const previewSubject = subjectFor(cohortParam);
    const previewDjUsername =
      matched?.djUsername ||
      (cohortParam === "dj" ? request.nextUrl.searchParams.get("djUsername") || undefined : undefined);
    try {
      await resend.emails.send({
        from: NEWSLETTER_FROM_EMAIL,
        to: previewTo,
        subject: `[test as ${tokenEmail}] ${previewSubject}`,
        html: buildEmailHtml(previewName, cohortParam, tokenEmail, previewDjUsername),
        headers: buildListUnsubscribeHeaders(tokenEmail, cohortParam === "dj" ? "dj" : "marketing"),
      });
      return NextResponse.json({
        mode: "preview",
        cohort: cohortParam,
        sentTo: previewTo,
        unsubscribeTokenFor: tokenEmail,
        greetedAs: previewName,
        subject: previewSubject,
        djProfileUrl:
          cohortParam === "dj"
            ? previewDjUsername
              ? `${NEWSLETTER_APP_URL}/dj/${encodeURIComponent(previewDjUsername)}`
              : `${NEWSLETTER_APP_URL}/radio`
            : undefined,
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // ── Dry-run ──
  if (mode === "dry-run") {
    const unresolved = selected.filter((r) => r.name === "there");
    return NextResponse.json({
      mode: "dry-run",
      cohort: cohortParam,
      subjects: {
        dj: subjectFor("dj"),
        listener: subjectFor("listener"),
      },
      totals: {
        dj: djRecipients.length,
        listener: listenerRecipients.length,
        selected: selected.length,
      },
      unresolvedGreetingCount: unresolved.length,
      unresolvedGreetings: unresolved.map((r) => ({ email: r.email, cohort: r.cohort })),
      recipients: selected.map((r) => ({
        email: r.email,
        firstName: r.name,
        cohort: r.cohort,
        djProfileUrl:
          r.cohort === "dj"
            ? r.djUsername
              ? `${NEWSLETTER_APP_URL}/dj/${encodeURIComponent(r.djUsername)}`
              : `${NEWSLETTER_APP_URL}/radio`
            : undefined,
      })),
    });
  }

  // ── Audit ──
  if (mode === "audit") {
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }
    const rows = await buildAuditRows(db);
    const html = buildAuditHtml(rows);
    const auditTo = request.nextUrl.searchParams.get("to") || "cap@channel-app.com";
    try {
      await resend.emails.send({
        from: NEWSLETTER_FROM_EMAIL,
        to: auditTo,
        subject: `[audit] Channel newsletter roster — ${rows.length} rows`,
        html,
      });
      return NextResponse.json({
        mode: "audit",
        sentTo: auditTo,
        totalRows: rows.length,
        onNextSend: rows.filter((r) => r.onNextSend).length,
        unsubscribed: rows.filter((r) => r.unsubscribed).length,
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // ── Compare ──
  if (mode === "compare") {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Resend API key not configured" }, { status: 500 });
    }
    const lastSubject = request.nextUrl.searchParams.get("lastSubject");
    if (!lastSubject) {
      return NextResponse.json(
        { error: "Pass ?lastSubject=... to diff against a prior send" },
        { status: 400 },
      );
    }
    const r = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (!r.ok) {
      return NextResponse.json({ error: `Resend API: ${r.status}` }, { status: 500 });
    }
    const data = (await r.json()) as {
      data: Array<{ to: string[]; subject: string; last_event: string; created_at: string }>;
    };
    const priorSends = data.data.filter((e) => e.subject === lastSubject);
    const priorEmails = new Set(
      priorSends.map((e) => e.to[0]).filter((e) => e !== "cap@channel-app.com"),
    );
    const currentEmails = new Set(selected.map((r) => r.email));
    const added = Array.from(currentEmails).filter((e) => !priorEmails.has(e));
    const removed = Array.from(priorEmails).filter((e) => !currentEmails.has(e));
    const unchanged = Array.from(currentEmails).filter((e) => priorEmails.has(e));
    return NextResponse.json({
      mode: "compare",
      cohort: cohortParam,
      lastSubject,
      currentSubjects: {
        dj: subjectFor("dj"),
        listener: subjectFor("listener"),
      },
      priorSendCount: priorEmails.size,
      currentRecipientCount: currentEmails.size,
      added,
      removed,
      unchangedCount: unchanged.length,
    });
  }

  // ── Send (LOCKED) ──
  if (mode === "send") {
    const SEND_ENABLED = false; // ← Monday cron handles 2026-05-04
    if (!SEND_ENABLED) {
      return NextResponse.json({
        error: "Send mode is locked. Set SEND_ENABLED = true in code when ready.",
        cohort: cohortParam,
        totalSelected: selected.length,
      });
    }
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }
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
    return NextResponse.json({
      mode: "send",
      cohort: cohortParam,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  return NextResponse.json(
    { error: "Invalid mode. Use: preview, dry-run, audit, compare, send" },
    { status: 400 },
  );
}

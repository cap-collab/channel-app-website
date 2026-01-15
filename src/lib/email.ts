import { Resend } from "resend";

// Initialize Resend only if API key is available
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Channel <djshows@channel-app.com>";

// Map backend metadata station IDs to iOS app station IDs for deep links
function getDeepLinkStationId(metadataStationId: string): string {
  const mapping: Record<string, string> = {
    nts1: "nts-1",
    nts2: "nts-2",
    rinse: "rinse-fm",
    rinsefr: "rinse-fr",
    dublab: "dublab",
    subtle: "subtle",
  };
  return mapping[metadataStationId] || metadataStationId;
}

// Generate deep link URL for a station (opens app if installed, falls back to website)
function getStationDeepLink(metadataStationId: string): string {
  const appStationId = getDeepLinkStationId(metadataStationId);
  return `https://channel-app.com/listen/${appStationId}`;
}

// Settings deep link (opens app settings if installed, falls back to website)
const SETTINGS_DEEP_LINK = "https://channel-app.com/settings";

interface ShowStartingEmailParams {
  to: string;
  showName: string;
  djName?: string;
  stationName: string;
  stationId: string;
}

export async function sendShowStartingEmail({
  to,
  showName,
  djName,
  stationName,
  stationId,
}: ShowStartingEmailParams) {
  const listenUrl = getStationDeepLink(stationId);
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const displayName = djName || showName;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${displayName} is live on ${stationName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; text-align: center; }
            h1 { margin: 0 0 8px; font-size: 22px; color: #fff; }
            .station { color: #888; font-size: 14px; margin-bottom: 20px; }
            .show-name { color: #aaa; font-size: 14px; margin-bottom: 24px; }
            .listen-btn { display: inline-block; background: #fff; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1>${displayName} <span style="color: #888;">is live</span></h1>
              <p class="station">on ${stationName}</p>
              ${djName ? `<p class="show-name">${showName}</p>` : ""}
              <a href="${listenUrl}" class="listen-btn">Tune In</a>
            </div>
            <div class="footer">
              <p>You're receiving this because you saved this show.</p>
              <a href="${SETTINGS_DEEP_LINK}" class="unsubscribe">Unsubscribe</a>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}

interface MentionEmailParams {
  to: string;
  mentionerUsername: string;
  stationName: string;
  stationId: string;
  messagePreview?: string;
}

export async function sendMentionEmail({
  to,
  mentionerUsername,
  stationName,
  stationId,
  messagePreview,
}: MentionEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const chatUrl = getStationDeepLink(stationId);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${mentionerUsername} mentioned you in ${stationName} chat`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; text-align: center; }
            h1 { margin: 0 0 8px; font-size: 22px; color: #fff; }
            .station { color: #888; font-size: 14px; margin-bottom: 20px; }
            .message-preview { background: #1a1a1a; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-style: italic; color: #aaa; text-align: left; }
            .join-btn { display: inline-block; background: #fff; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1>@${mentionerUsername} <span style="color: #888;">mentioned you</span></h1>
              <p class="station">in ${stationName} chat</p>
              ${messagePreview ? `<div class="message-preview">"${messagePreview}"</div>` : ""}
              <a href="${chatUrl}" class="join-btn">Join Chat</a>
            </div>
            <div class="footer">
              <p>You're receiving this because someone mentioned you.</p>
              <a href="${SETTINGS_DEEP_LINK}" class="unsubscribe">Unsubscribe</a>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending mention email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending mention email:", error);
    return false;
  }
}

interface PopularityAlertEmailParams {
  to: string;
  showName: string;
  stationName: string;
  stationId: string;
  loveCount: number;
}

export async function sendPopularityAlertEmail({
  to,
  showName,
  stationName,
  stationId,
  loveCount,
}: PopularityAlertEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const listenUrl = getStationDeepLink(stationId);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${showName} is getting a lot of love on ${stationName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; text-align: center; }
            h1 { margin: 0 0 8px; font-size: 22px; color: #fff; }
            .station { color: #888; font-size: 14px; margin-bottom: 12px; }
            .love-count { font-size: 32px; margin-bottom: 24px; }
            .listen-btn { display: inline-block; background: #fff; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1>${showName}</h1>
              <p class="station">is trending on ${stationName}</p>
              <div class="love-count">${loveCount} ❤️</div>
              <a href="${listenUrl}" class="listen-btn">Tune In</a>
            </div>
            <div class="footer">
              <p>You're receiving this because you enabled popularity alerts.</p>
              <a href="${SETTINGS_DEEP_LINK}" class="unsubscribe">Unsubscribe</a>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending popularity alert email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending popularity alert email:", error);
    return false;
  }
}

interface TipReminderEmailParams {
  to: string;
  djName?: string;
  pendingAmountCents: number;
  daysRemaining: number;
  stripeOnboardingUrl: string;
}

export async function sendTipReminderEmail({
  to,
  djName,
  pendingAmountCents,
  daysRemaining,
  stripeOnboardingUrl,
}: TipReminderEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const amountFormatted = `$${(pendingAmountCents / 100).toFixed(2)}`;
  const isUrgent = daysRemaining <= 7;
  const displayName = djName || 'there';

  // Vary subject line based on urgency
  let subject: string;
  if (daysRemaining <= 1) {
    subject = `Final notice: ${amountFormatted} expires tomorrow`;
  } else if (daysRemaining <= 7) {
    subject = `${amountFormatted} expires in ${daysRemaining} days`;
  } else {
    subject = `You have ${amountFormatted} in pending support on Channel`;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; text-align: center; }
            h1 { margin: 0 0 8px; font-size: 22px; color: #fff; }
            .amount { font-size: 36px; font-weight: 700; color: ${isUrgent ? '#fbbf24' : '#fff'}; margin: 20px 0; }
            .deadline { color: ${isUrgent ? '#fbbf24' : '#888'}; font-size: 14px; margin-bottom: 24px; }
            .connect-btn { display: inline-block; background: ${isUrgent ? '#fbbf24' : '#fff'}; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .info { color: #666; font-size: 13px; margin-top: 20px; text-align: left; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1>Hi ${displayName},</h1>
              <p style="color: #888; margin-bottom: 20px;">You have pending support from listeners on Channel</p>
              <div class="amount">${amountFormatted}</div>
              <p class="deadline">${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left to claim</p>
              <a href="${stripeOnboardingUrl}" class="connect-btn">Connect Stripe to Receive</a>
              <div class="info">
                <p>Connect your Stripe account to receive tips from listeners. The process takes about 5 minutes.</p>
                ${isUrgent ? '<p style="color: #fbbf24; margin-top: 12px;"><strong>After 60 days, unclaimed tips are reallocated to the DJ Support Pool.</strong></p>' : ''}
              </div>
            </div>
            <div class="footer">
              <p>You're receiving this because you have pending tips on Channel.</p>
              <a href="${SETTINGS_DEEP_LINK}" class="unsubscribe">Unsubscribe</a>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending tip reminder email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending tip reminder email:", error);
    return false;
  }
}

interface WatchlistDigestEmailParams {
  to: string;
  matches: Array<{
    showName: string;
    djName?: string;
    stationName: string;
    stationId: string;
    startTime: Date;
    searchTerm: string;
  }>;
}

export async function sendWatchlistDigestEmail({
  to,
  matches,
}: WatchlistDigestEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  if (matches.length === 0) return false;

  // Group matches by search term
  const matchesByTerm: Record<string, typeof matches> = {};
  for (const match of matches) {
    if (!matchesByTerm[match.searchTerm]) {
      matchesByTerm[match.searchTerm] = [];
    }
    matchesByTerm[match.searchTerm].push(match);
  }

  // Build HTML for each search term group
  const groupsHtml = Object.entries(matchesByTerm)
    .map(([term, termMatches]) => {
      const showsHtml = termMatches
        .map(
          (match) => `
          <div style="background: #1a1a1a; border-radius: 8px; padding: 16px; margin-bottom: 8px;">
            <div style="font-weight: 600; margin-bottom: 4px;">${match.djName || match.showName}</div>
            <div style="color: #888; font-size: 13px;">${match.stationName} · ${new Date(match.startTime).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${new Date(match.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
          </div>
        `
        )
        .join("");

      return `
        <div style="margin-bottom: 24px;">
          <p style="color: #aaa; font-size: 14px; margin-bottom: 12px;">We found shows matching your "<strong style="color: #fff;">${term}</strong>" alert and added them to your favorites:</p>
          ${showsHtml}
        </div>
      `;
    })
    .join("");

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `We found ${matches.length} show${matches.length > 1 ? "s" : ""} matching your alerts`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; text-align: center; }
            h1 { margin: 0 0 24px; font-size: 20px; color: #fff; }
            .stream-btn { display: inline-block; background: #fff; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1>New shows <span style="color: #888;">added to your favorites</span></h1>
              ${groupsHtml}
              <a href="https://channel-app.com" class="stream-btn">Stream on Channel</a>
            </div>
            <div class="footer">
              <p>These shows have been added to your favorites.</p>
              <a href="${SETTINGS_DEEP_LINK}" class="unsubscribe">Unsubscribe</a>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending digest email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending digest email:", error);
    return false;
  }
}

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
  djUsername?: string; // DJ's chat username for profile link
  djHasEmail?: boolean; // Whether the DJ has an email linked to their account
  stationName: string;
  stationId: string;
  streamUrl?: string; // External radio stream URL
}

export async function sendShowStartingEmail({
  to,
  showName,
  djName,
  djUsername,
  djHasEmail,
  stationName,
  stationId,
  streamUrl,
}: ShowStartingEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const displayName = showName;

  // Show "Chat live with the DJ" if DJ has an email linked (can receive notifications)
  // Otherwise show "Tune In" linking to the radio stream
  const canChatWithDJ = djHasEmail && djUsername;
  const buttonUrl = canChatWithDJ
    ? `https://channel-app.com/dj/${djUsername}`
    : streamUrl || getStationDeepLink(stationId);
  const buttonText = canChatWithDJ ? "Chat live with the DJ" : "Tune In";

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
              ${djName ? `<p class="show-name">${djName}</p>` : ""}
              <a href="${buttonUrl}" class="listen-btn">${buttonText}</a>
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
  djUsername?: string; // DJ's profile username for chat link
  messagePreview?: string;
}

export async function sendMentionEmail({
  to,
  mentionerUsername,
  stationName,
  stationId,
  djUsername,
  messagePreview,
}: MentionEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  // Link to DJ profile chat if available, otherwise fall back to station
  const chatUrl = djUsername
    ? `https://channel-app.com/dj/${djUsername}#chat`
    : getStationDeepLink(stationId);

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
  djUsername?: string; // DJ's profile username for chat link
  loveCount: number;
}

export async function sendPopularityAlertEmail({
  to,
  showName,
  stationName,
  stationId,
  djUsername,
  loveCount,
}: PopularityAlertEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  // Link to DJ profile chat if available, otherwise fall back to station
  const listenUrl = djUsername
    ? `https://channel-app.com/dj/${djUsername}#chat`
    : getStationDeepLink(stationId);

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
    djUsername?: string; // For DJ profile link
    stationName: string;
    stationId: string;
    startTime: Date;
    searchTerm: string;
    isIRL?: boolean; // IRL event flag
    irlLocation?: string; // City for IRL events
    irlTicketUrl?: string; // Ticket link for IRL events
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

  // Group matches by search term (DJ name)
  const matchesByTerm: Record<string, typeof matches> = {};
  for (const match of matches) {
    if (!matchesByTerm[match.searchTerm]) {
      matchesByTerm[match.searchTerm] = [];
    }
    matchesByTerm[match.searchTerm].push(match);
  }

  // Build HTML for each DJ group
  const groupsHtml = Object.entries(matchesByTerm)
    .map(([term, termMatches]) => {
      // Get DJ profile link from first match (they all share the same DJ)
      const firstMatch = termMatches[0];
      const djProfileUrl = firstMatch.djUsername
        ? `https://channel-app.com/dj/${firstMatch.djUsername}`
        : "https://channel-app.com/channel";
      const djDisplayName = firstMatch.djName || term;

      const showsHtml = termMatches
        .map(
          (match) => {
            const dateStr = new Date(match.startTime).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
            const timeStr = new Date(match.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

            if (match.isIRL) {
              // IRL event display
              return `
              <div style="background: #1a1a1a; border-radius: 8px; padding: 16px; margin-bottom: 8px; text-align: left;">
                <div style="font-weight: 600; margin-bottom: 4px;">${match.showName}</div>
                <div style="color: #888; font-size: 13px;">${match.irlLocation || "TBA"} · ${dateStr}</div>
                ${match.irlTicketUrl ? `<a href="${match.irlTicketUrl}" style="color: #fff; font-size: 12px; text-decoration: underline; margin-top: 8px; display: inline-block;">Get tickets</a>` : ""}
              </div>
            `;
            } else {
              // Online show display
              return `
              <div style="background: #1a1a1a; border-radius: 8px; padding: 16px; margin-bottom: 8px; text-align: left;">
                <div style="font-weight: 600; margin-bottom: 4px;">${match.showName}</div>
                <div style="color: #888; font-size: 13px;">${match.stationName} · ${dateStr} at ${timeStr}</div>
              </div>
            `;
            }
          }
        )
        .join("");

      return `
        <div style="margin-bottom: 24px;">
          <p style="color: #888; font-size: 14px; margin-bottom: 12px;">From "<strong style="color: #fff;">${term}</strong>"</p>
          ${showsHtml}
          <a href="${djProfileUrl}" style="display: inline-block; background: #fff; color: #000 !important; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 12px; font-size: 14px;">Visit ${djDisplayName} profile</a>
        </div>
      `;
    })
    .join("");

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${matches.length} new show${matches.length > 1 ? "s" : ""} coming up from your favorite DJs`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; text-align: center; }
            h1 { margin: 0 0 24px; font-size: 20px; color: #fff; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1>New shows from your favorite DJs</h1>
              ${groupsHtml}
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

interface DjOnlineEmailParams {
  to: string;
  djUsername: string;
}

export async function sendDjOnlineEmail({
  to,
  djUsername,
}: DjOnlineEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const chatUrl = `https://channel-app.com/dj/${djUsername}#chat`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${djUsername} is chatting on Channel`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; text-align: center; }
            h1 { margin: 0 0 8px; font-size: 22px; color: #fff; }
            .subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
            .online-indicator { display: inline-block; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; margin-right: 8px; animation: pulse 2s infinite; }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
            .join-btn { display: inline-block; background: #fff; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1><span class="online-indicator"></span>${djUsername}</h1>
              <p class="subtitle">is active in their chat right now</p>
              <a href="${chatUrl}" class="join-btn">Join the Chat</a>
            </div>
            <div class="footer">
              <p>You're receiving this because you follow ${djUsername}.</p>
              <a href="${SETTINGS_DEEP_LINK}" class="unsubscribe">Unsubscribe</a>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Error sending DJ online email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending DJ online email:", error);
    return false;
  }
}

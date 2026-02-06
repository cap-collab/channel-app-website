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

// Get the radio station's website URL by metadata key
function getStationWebsiteUrl(metadataStationId: string): string {
  const websiteUrls: Record<string, string> = {
    nts1: "https://www.nts.live/",
    nts2: "https://www.nts.live/",
    rinse: "https://www.rinse.fm/",
    rinsefr: "https://www.rinse.fm/channels/france",
    dublab: "https://www.dublab.com/",
    subtle: "https://www.subtleradio.com/",
    newtown: "https://newtownradio.com",
    broadcast: "https://channel-app.com/channel",
  };
  return websiteUrls[metadataStationId] || getStationDeepLink(metadataStationId);
}

// Settings deep link (opens app settings if installed, falls back to website)
const SETTINGS_DEEP_LINK = "https://channel-app.com/settings";

// Channel logo URL
const LOGO_URL = "https://channel-app.com/logo-white.png";

// Shared email wrapper with Channel branding
function wrapEmailContent(content: string, footerText: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <style>
        :root { color-scheme: dark; }
        body, .body-bg { background-color: #0a0a0a !important; }
      </style>
    </head>
    <body class="body-bg" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0a0a0a; color: #fff; margin: 0; padding: 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background-color: #0a0a0a;">
        <tr>
          <td align="center" style="padding: 40px 20px;" bgcolor="#0a0a0a">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 420px;">
              <!-- Logo Header -->
              <tr>
                <td align="center" style="padding-bottom: 32px;" bgcolor="#0a0a0a">
                  <img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" />
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td bgcolor="#0a0a0a">
                  ${content}
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td align="center" style="padding-top: 32px; border-top: 1px solid #333;" bgcolor="#0a0a0a">
                  <p style="margin: 0 0 12px; font-size: 13px; color: #71717a;">
                    ${footerText}
                  </p>
                  <a href="${SETTINGS_DEEP_LINK}" style="font-size: 12px; color: #71717a; text-decoration: underline;">
                    Unsubscribe
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// Pink gradient button style
const PINK_BUTTON_STYLE = "display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); color: #fff !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;";

interface ShowStartingEmailParams {
  to: string;
  showName: string;
  djName?: string;
  djUsername?: string; // DJ's chat username for profile link
  djPhotoUrl?: string; // DJ profile photo
  djHasEmail?: boolean; // Whether DJ has email set (can receive chat messages)
  stationName: string;
  stationId: string;
}

export async function sendShowStartingEmail({
  to,
  showName,
  djName,
  djUsername,
  djPhotoUrl,
  djHasEmail,
  stationName,
  stationId,
}: ShowStartingEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const displayName = showName;
  const djDisplayName = djName || showName;

  // Show "Join the chat" ONLY if DJ has email set (can receive chat messages)
  // Otherwise show "Tune In" linking to the radio's website
  const canChatWithDJ = djHasEmail && djUsername;
  const buttonUrl = canChatWithDJ
    ? `https://channel-app.com/dj/${djUsername}`
    : getStationWebsiteUrl(stationId);
  const buttonText = canChatWithDJ ? "Join the chat" : "Tune In";

  // Station accent colors for fallback avatar (same as watchlist digest)
  const stationAccentColors: Record<string, string> = {
    broadcast: "#D94099",
    nts1: "#FFFFFF",
    nts2: "#FFFFFF",
    rinse: "#228EFD",
    rinsefr: "#8A8A8A",
    dublab: "#0287FE",
    subtle: "#C3E943",
    newtown: "#ec92af",
  };
  const fallbackColor = stationAccentColors[stationId] || "#D94099";

  // DJ photo or fallback initial (email-compatible table-based fallback)
  const photoHtml = djPhotoUrl
    ? `<img src="${djPhotoUrl}" alt="${djDisplayName}" width="80" height="80" style="width: 80px; height: 80px; border-radius: 12px; object-fit: cover; border: 1px solid #333;" />`
    : `<table width="80" height="80" cellpadding="0" cellspacing="0" border="0" style="border-radius: 12px; border: 1px solid #333; background-color: ${fallbackColor};">
        <tr>
          <td align="center" valign="middle" style="font-size: 32px; font-weight: bold; color: #fff;">
            ${djDisplayName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a1a1a; border-radius: 12px; border: 1px solid #333;">
      <tr>
        <td align="center" style="padding: 32px;">
          <!-- DJ Photo -->
          <div style="margin-bottom: 16px;">
            ${photoHtml}
          </div>
          <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #fff;">
            ${displayName} <span style="color: #71717a;">is live</span>
          </h1>
          <p style="margin: 0 0 24px; font-size: 14px; color: #a1a1aa;">on ${stationName}</p>
          <a href="${buttonUrl}" style="${PINK_BUTTON_STYLE}">${buttonText}</a>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${displayName} is live on ${stationName}`,
      html: wrapEmailContent(content, "You're receiving this because you saved this show."),
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

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a1a1a; border-radius: 12px; border: 1px solid #333;">
      <tr>
        <td align="center" style="padding: 32px;">
          <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #fff;">
            @${mentionerUsername} <span style="color: #71717a;">mentioned you</span>
          </h1>
          <p style="margin: 0 0 ${messagePreview ? '16px' : '24px'}; font-size: 14px; color: #a1a1aa;">in ${stationName} chat</p>
          ${messagePreview ? `
            <div style="background: #0a0a0a; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-style: italic; color: #a1a1aa; text-align: left; border: 1px solid #333;">
              "${messagePreview}"
            </div>
          ` : ''}
          <a href="${chatUrl}" style="${PINK_BUTTON_STYLE}">Join Chat</a>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${mentionerUsername} mentioned you in ${stationName} chat`,
      html: wrapEmailContent(content, "You're receiving this because someone mentioned you."),
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

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a1a1a; border-radius: 12px; border: 1px solid #333;">
      <tr>
        <td align="center" style="padding: 32px;">
          <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #fff;">
            ${showName}
          </h1>
          <p style="margin: 0 0 16px; font-size: 14px; color: #a1a1aa;">is trending on ${stationName}</p>
          <div style="font-size: 36px; margin-bottom: 24px;">${loveCount} ❤️</div>
          <a href="${listenUrl}" style="${PINK_BUTTON_STYLE}">Tune In</a>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${showName} is getting a lot of love on ${stationName}`,
      html: wrapEmailContent(content, "You're receiving this because you enabled popularity alerts."),
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

  // Use amber color for urgent, pink gradient for normal
  const buttonStyle = isUrgent
    ? "display: inline-block; background: #fbbf24; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;"
    : PINK_BUTTON_STYLE;

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a1a1a; border-radius: 12px; border: 1px solid #333;">
      <tr>
        <td align="center" style="padding: 32px;">
          <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #fff;">
            Hi ${displayName},
          </h1>
          <p style="margin: 0 0 16px; font-size: 14px; color: #a1a1aa;">You have pending support from listeners on Channel</p>
          <div style="font-size: 40px; font-weight: 700; color: ${isUrgent ? '#fbbf24' : '#fff'}; margin: 16px 0;">${amountFormatted}</div>
          <p style="margin: 0 0 24px; font-size: 14px; color: ${isUrgent ? '#fbbf24' : '#71717a'};">${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left to claim</p>
          <a href="${stripeOnboardingUrl}" style="${buttonStyle}">Connect Stripe to Receive</a>
          <div style="margin-top: 24px; padding: 16px; background: #0a0a0a; border-radius: 8px; border: 1px solid #333; text-align: left;">
            <p style="margin: 0; font-size: 13px; color: #71717a;">Connect your Stripe account to receive tips from listeners. The process takes about 5 minutes.</p>
            ${isUrgent ? '<p style="margin: 12px 0 0; font-size: 13px; color: #fbbf24;"><strong>After 60 days, unclaimed tips are reallocated to the DJ Support Pool.</strong></p>' : ''}
          </div>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: wrapEmailContent(content, "You're receiving this because you have pending tips on Channel."),
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
  userTimezone?: string; // User's IANA timezone for formatting dates
  matches: Array<{
    showName: string;
    djName?: string;
    djUsername?: string; // For DJ profile link
    djPhotoUrl?: string; // DJ profile photo
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
  userTimezone,
  matches,
}: WatchlistDigestEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  if (matches.length === 0) return false;

  // Channel logo URL (hosted on the website)
  const logoUrl = "https://channel-app.com/logo-white.png";

  // Use user's timezone for formatting, fallback to America/New_York
  const timezone = userTimezone || "America/New_York";

  // Get short timezone abbreviation (e.g., "EST", "PST")
  const getTimezoneAbbr = (tz: string, date: Date) => {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });
    const parts = formatter.formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value || tz;
  };

  // Build show cards HTML - Digital Flyer style with center spine layout
  const showCardsHtml = matches
    .map((match) => {
      const dateStr = new Date(match.startTime).toLocaleDateString("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" });
      const timeStr = new Date(match.startTime).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
      const tzAbbr = getTimezoneAbbr(timezone, new Date(match.startTime));
      const djDisplayName = match.djName || match.searchTerm;

      // DJ profile URL - link to profile if exists, fallback to my-shows
      const djProfileUrl = match.djUsername
        ? `https://channel-app.com/dj/${match.djUsername}`
        : "https://channel-app.com/my-shows";

      // CTA URL: For IRL events with tickets, link to tickets; otherwise link to DJ profile
      const ctaUrl = match.isIRL && match.irlTicketUrl
        ? match.irlTicketUrl
        : djProfileUrl;

      // CTA text
      const ctaText = match.isIRL && match.irlTicketUrl ? "GET TICKETS" : "REMIND ME";

      // Badge for IRL vs Online
      const badgeHtml = match.isIRL
        ? `<span style="display: inline-block; font-size: 10px; font-family: monospace; color: #22c55e; text-transform: uppercase; letter-spacing: 0.5px;">🌲 IRL</span>`
        : `<span style="display: inline-block; font-size: 10px; font-family: monospace; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px;">☁️ Online</span>`;

      // Location/Station info (include timezone for online shows)
      const locationInfo = match.isIRL
        ? `${match.irlLocation || "TBA"} · ${dateStr}`
        : `${match.stationName} · ${dateStr} at ${timeStr} ${tzAbbr}`;

      // Station accent colors (matches /my-shows fallback avatar behavior)
      const stationAccentColors: Record<string, string> = {
        broadcast: "#D94099",
        nts1: "#FFFFFF",
        nts2: "#FFFFFF",
        rinse: "#228EFD",
        rinsefr: "#8A8A8A",
        dublab: "#0287FE",
        subtle: "#C3E943",
        newtown: "#ec92af",
        irl: "#22c55e",
      };
      const fallbackColor = match.isIRL ? "#22c55e" : (stationAccentColors[match.stationId] || "#D94099");

      // DJ photo or fallback initial (email-compatible table-based fallback)
      const photoHtml = match.djPhotoUrl
        ? `<img src="${match.djPhotoUrl}" alt="${djDisplayName}" width="64" height="64" style="width: 64px; height: 64px; border-radius: 8px; object-fit: cover; border: 1px solid #333;" />`
        : `<table width="64" height="64" cellpadding="0" cellspacing="0" border="0" style="border-radius: 8px; border: 1px solid #333; background-color: ${fallbackColor};">
            <tr>
              <td align="center" valign="middle" style="font-size: 24px; font-weight: bold; color: #fff;">
                ${djDisplayName.charAt(0).toUpperCase()}
              </td>
            </tr>
          </table>`;

      return `
        <!-- Show Card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
          <tr>
            <td style="background: #1a1a1a; border-radius: 12px; padding: 16px; border: 1px solid #333;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <!-- DJ Photo -->
                  <td width="64" valign="top" style="padding-right: 12px;">
                    <a href="${djProfileUrl}" style="text-decoration: none;">
                      ${photoHtml}
                    </a>
                  </td>
                  <!-- Content -->
                  <td valign="top">
                    <!-- Badge -->
                    <div style="margin-bottom: 4px;">
                      ${badgeHtml}
                    </div>
                    <!-- Show Name -->
                    <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; line-height: 1.3;">
                      ${match.showName}
                    </div>
                    <!-- DJ Name -->
                    <div style="font-size: 13px; color: #a1a1aa; margin-bottom: 4px;">
                      <a href="${djProfileUrl}" style="color: #a1a1aa; text-decoration: none;">${djDisplayName}</a>
                    </div>
                    <!-- Location/Time -->
                    <div style="font-size: 12px; color: #71717a;">
                      ${locationInfo}
                    </div>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <div style="margin-top: 12px; text-align: center;">
                <a href="${ctaUrl}" style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); color: #fff !important; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${ctaText}
                </a>
              </div>
            </td>
          </tr>
        </table>
      `;
    })
    .join(`
      <!-- Spine divider -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
        <tr>
          <td align="center">
            <div style="width: 2px; height: 24px; background: linear-gradient(180deg, #ec4899 0%, #8b5cf6 100%); border-radius: 1px;"></div>
          </td>
        </tr>
      </table>
    `);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${matches.length} new show${matches.length > 1 ? "s" : ""} coming up from your favorite DJs`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="color-scheme" content="dark">
          <meta name="supported-color-schemes" content="dark">
          <title>New Shows from Your Favorite DJs</title>
          <style>
            :root { color-scheme: dark; }
            body, .body-bg { background-color: #0a0a0a !important; }
          </style>
        </head>
        <body class="body-bg" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0a0a0a; color: #fff; margin: 0; padding: 0;">
          <!-- Wrapper -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background-color: #0a0a0a;">
            <tr>
              <td align="center" style="padding: 40px 20px;" bgcolor="#0a0a0a">
                <!-- Container -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 420px;">
                  <!-- Logo Header -->
                  <tr>
                    <td align="center" style="padding-bottom: 32px;" bgcolor="#0a0a0a">
                      <img src="${logoUrl}" alt="Channel" width="120" style="width: 120px; height: auto;" />
                    </td>
                  </tr>
                  <!-- Title -->
                  <tr>
                    <td align="center" style="padding-bottom: 32px;" bgcolor="#0a0a0a">
                      <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #fff; line-height: 1.3;">
                        New shows from your<br/>favorite DJs
                      </h1>
                    </td>
                  </tr>
                  <!-- Show Cards -->
                  <tr>
                    <td bgcolor="#0a0a0a">
                      ${showCardsHtml}
                    </td>
                  </tr>
                  <!-- Footer -->
                  <tr>
                    <td align="center" style="padding-top: 32px; border-top: 1px solid #333;" bgcolor="#0a0a0a">
                      <p style="margin: 0 0 12px; font-size: 13px; color: #71717a;">
                        These shows have been added to your favorites.
                      </p>
                      <a href="${SETTINGS_DEEP_LINK}" style="font-size: 12px; color: #71717a; text-decoration: underline;">
                        Unsubscribe
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
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

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #1a1a1a; border-radius: 12px; border: 1px solid #333;">
      <tr>
        <td align="center" style="padding: 32px;">
          <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #fff;">
            <span style="display: inline-block; width: 10px; height: 10px; background: #22c55e; border-radius: 50%; margin-right: 8px; vertical-align: middle;"></span>${djUsername}
          </h1>
          <p style="margin: 0 0 24px; font-size: 14px; color: #a1a1aa;">is active in their chat right now</p>
          <a href="${chatUrl}" style="${PINK_BUTTON_STYLE}">Join the Chat</a>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${djUsername} is chatting on Channel`,
      html: wrapEmailContent(content, `You're receiving this because you follow ${djUsername}.`),
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

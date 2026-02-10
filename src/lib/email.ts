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

// Normalize a DJ username for use in URLs (e.g. "COPYPASTE w/ KLS.RDR" → "copypastewklsrdr")
function normalizeDjUsername(djUsername: string): string {
  return djUsername.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Get a photo URL for emails
// Always prefer the proxy when djUsername is known — it serves a clean, short URL
// that email clients handle reliably (no long tokens, spaces, or special chars)
function getEmailPhotoUrl(djUsername?: string, djPhotoUrl?: string): string | undefined {
  if (djUsername) {
    return `https://channel-app.com/api/dj-photo/${normalizeDjUsername(djUsername)}`;
  }
  if (djPhotoUrl) return djPhotoUrl;
  return undefined;
}

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
    ? `https://channel-app.com/dj/${normalizeDjUsername(djUsername)}`
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
  // Use proxy URL for reliable loading in email clients
  const emailPhotoUrl = getEmailPhotoUrl(djUsername, djPhotoUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="80" height="80" style="width: 80px; height: 80px; border-radius: 12px; object-fit: cover; border: 1px solid #333;" />`
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
    ? `https://channel-app.com/dj/${normalizeDjUsername(djUsername)}#chat`
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
    ? `https://channel-app.com/dj/${normalizeDjUsername(djUsername)}#chat`
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

// Station accent colors for fallback avatars
const STATION_ACCENT_COLORS: Record<string, string> = {
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

// Build a show card HTML block (used for favorite shows and preference-matched shows)
function buildShowCardHtml(
  show: {
    showName: string;
    djName?: string;
    djUsername?: string;
    djPhotoUrl?: string;
    stationName: string;
    stationId: string;
    startTime: Date;
    isIRL?: boolean;
    irlLocation?: string;
    irlTicketUrl?: string;
  },
  tag: string,
  timezone: string,
): string {
  const djDisplayName = show.djName || show.showName;
  const timeStr = new Date(show.startTime).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" });
  const parts = formatter.formatToParts(new Date(show.startTime));
  const tzAbbr = parts.find((p) => p.type === "timeZoneName")?.value || timezone;

  const djProfileUrl = show.djUsername
    ? `https://channel-app.com/dj/${normalizeDjUsername(show.djUsername)}`
    : "https://channel-app.com/my-shows";

  const isFavorite = tag === "FAVORITE";
  const ctaUrl = show.isIRL && show.irlTicketUrl ? show.irlTicketUrl : djProfileUrl;
  const ctaText = show.isIRL && show.irlTicketUrl ? "GET TICKETS" : isFavorite ? "SEE PROFILE" : "REMIND ME";

  const badgeHtml = show.isIRL
    ? `<span style="display: inline-block; font-size: 10px; font-family: monospace; color: #22c55e; text-transform: uppercase; letter-spacing: 0.5px;">🌲 IRL</span>`
    : `<span style="display: inline-block; font-size: 10px; font-family: monospace; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px;">☁️ Online</span>`;

  const locationInfo = show.isIRL
    ? `${show.irlLocation || "TBA"}`
    : `${show.stationName} · ${timeStr} ${tzAbbr}`;

  const fallbackColor = show.isIRL ? "#22c55e" : (STATION_ACCENT_COLORS[show.stationId] || "#D94099");
  const emailPhotoUrl = getEmailPhotoUrl(show.djUsername, show.djPhotoUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="64" height="64" style="width: 64px; height: 64px; border-radius: 8px; object-fit: cover; border: 1px solid #333;" />`
    : `<table width="64" height="64" cellpadding="0" cellspacing="0" border="0" style="border-radius: 8px; border: 1px solid #333; background-color: ${fallbackColor};">
        <tr>
          <td align="center" valign="middle" style="font-size: 24px; font-weight: bold; color: #fff;">
            ${djDisplayName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  return `
    <!-- Show Card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px;">
      <tr>
        <td style="padding: 0;">
          <!-- Tag -->
          <div style="margin-bottom: 8px;">
            <span style="font-size: 10px; font-family: monospace; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">${tag}</span>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="64" valign="top" style="padding-right: 12px;">
                <a href="${djProfileUrl}" style="text-decoration: none;">
                  ${photoHtml}
                </a>
              </td>
              <td valign="top">
                <div style="margin-bottom: 4px;">
                  ${badgeHtml}
                </div>
                <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; line-height: 1.3;">
                  ${show.showName}
                </div>
                <div style="font-size: 13px; color: #a1a1aa; margin-bottom: 4px;">
                  <a href="${djProfileUrl}" style="color: #a1a1aa; text-decoration: none;">${djDisplayName}</a>
                </div>
                <div style="font-size: 12px; color: #71717a;">
                  ${locationInfo}
                </div>
              </td>
            </tr>
          </table>
          <div style="margin-top: 12px; text-align: center;">
            <a href="${ctaUrl}" style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); color: #fff !important; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
              ${ctaText}
            </a>
          </div>
        </td>
      </tr>
    </table>
  `;
}

// Build a curator rec card HTML block (matches show card layout)
function buildCuratorRecCardHtml(rec: {
  djName: string;
  djUsername: string;
  djPhotoUrl?: string;
  url: string;
  type: "music" | "irl" | "online";
  title?: string;
  imageUrl?: string;
  ogTitle?: string;
  ogImage?: string;
}): string {
  const cleanUrl = rec.url ? rec.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const domain = rec.url ? rec.url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "") : "";
  const typeBadge = rec.type === "irl" ? "🌲 IRL" : rec.type === "online" ? "📺 Online" : "🎵 Music";
  const displayTitle = rec.title || rec.ogTitle || cleanUrl;
  const displayImage = rec.imageUrl || rec.ogImage;

  const djProfileUrl = `https://channel-app.com/dj/${normalizeDjUsername(rec.djUsername)}`;

  // Use rec image (DJ-uploaded or OG) if available, otherwise DJ photo
  const photoUrl = displayImage || getEmailPhotoUrl(rec.djUsername, rec.djPhotoUrl);
  const photoHtml = photoUrl
    ? `<img src="${photoUrl}" alt="${displayTitle}" width="64" height="64" style="width: 64px; height: 64px; border-radius: 8px; object-fit: cover; border: 1px solid #333;" />`
    : `<table width="64" height="64" cellpadding="0" cellspacing="0" border="0" style="border-radius: 8px; border: 1px solid #333; background-color: #D94099;">
        <tr>
          <td align="center" valign="middle" style="font-size: 24px; font-weight: bold; color: #fff;">
            ${rec.djName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  return `
    <!-- Curator Rec Card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px;">
      <tr>
        <td style="padding: 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="64" valign="top" style="padding-right: 12px;">
                <a href="${rec.url}" style="text-decoration: none;">
                  ${photoHtml}
                </a>
              </td>
              <td valign="top">
                <div style="margin-bottom: 4px;">
                  <span style="display: inline-block; font-size: 10px; font-family: monospace; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px;">${typeBadge}</span>
                </div>
                <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; line-height: 1.3;">
                  <a href="${rec.url}" style="color: #fff; text-decoration: none;">${displayTitle}</a>
                </div>
                <div style="font-size: 12px; color: #71717a;">
                  ${domain}
                </div>
              </td>
            </tr>
          </table>
          <div style="margin-top: 12px; text-align: center;">
            <a href="${djProfileUrl}" style="display: inline-block; background: rgba(255,255,255,0.1); color: #fff !important; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
              See ${rec.djName} Profile
            </a>
          </div>
        </td>
      </tr>
    </table>
  `;
}

// Build a day header HTML block
function buildDayHeaderHtml(dayLabel: string): string {
  return `
    <!-- Day Header -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px; margin-top: 8px;">
      <tr>
        <td style="padding: 8px 0;">
          <span style="font-size: 12px; font-family: monospace; color: #a1a1aa; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">${dayLabel}</span>
        </td>
      </tr>
    </table>
  `;
}

interface WatchlistDigestEmailParams {
  to: string;
  userTimezone?: string;
  favoriteShows: Array<{
    showName: string;
    djName?: string;
    djUsername?: string;
    djPhotoUrl?: string;
    stationName: string;
    stationId: string;
    startTime: Date;
    isIRL?: boolean;
    irlLocation?: string;
    irlTicketUrl?: string;
  }>;
  curatorRecs: Array<{
    djName: string;
    djUsername: string;
    djPhotoUrl?: string;
    url: string;
    type: "music" | "irl" | "online";
    title?: string;
    imageUrl?: string;
    ogTitle?: string;
    ogImage?: string;
  }>;
  preferenceShows: Array<{
    showName: string;
    djName?: string;
    djUsername?: string;
    djPhotoUrl?: string;
    stationName: string;
    stationId: string;
    startTime: Date;
    isIRL?: boolean;
    irlLocation?: string;
    irlTicketUrl?: string;
    matchLabel?: string;
  }>;
}

export async function sendWatchlistDigestEmail({
  to,
  userTimezone,
  favoriteShows,
  curatorRecs,
  preferenceShows,
}: WatchlistDigestEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const timezone = userTimezone || "America/New_York";

  // Build 4 day buckets: today + next 3 days (in user's timezone)
  const now = new Date();
  type TimelineItem =
    | { kind: "show"; tag: string; show: WatchlistDigestEmailParams["favoriteShows"][0] }
    | { kind: "preference"; tag: string; show: WatchlistDigestEmailParams["preferenceShows"][0] };

  // Get the date string (YYYY-MM-DD) for a given Date in user's timezone
  const getDateKey = (d: Date): string => {
    return d.toLocaleDateString("en-CA", { timeZone: timezone }); // en-CA gives YYYY-MM-DD
  };

  // Build day keys for today + next 3 days
  const dayKeys: string[] = [];
  const dayLabels: Map<string, string> = new Map();
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const key = getDateKey(d);
    dayKeys.push(key);
    let label: string;
    if (i === 0) {
      label = "TODAY";
    } else if (i === 1) {
      label = "TOMORROW";
    } else {
      label = d.toLocaleDateString("en-US", { timeZone: timezone, weekday: "long", month: "short", day: "numeric" }).toUpperCase();
    }
    dayLabels.set(key, label);
  }

  // Initialize buckets
  const buckets = new Map<string, TimelineItem[]>();
  for (const key of dayKeys) {
    buckets.set(key, []);
  }

  // Place all favorite shows into buckets
  for (const show of favoriteShows) {
    const key = getDateKey(new Date(show.startTime));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push({ kind: "show", tag: "FAVORITE", show });
    }
    // Shows outside the 4-day window are still included if they fall on a bucket day
  }

  // Place preference shows into their day buckets (used for gap-filling later)
  const prefsByDay = new Map<string, WatchlistDigestEmailParams["preferenceShows"][0][]>();
  for (const show of preferenceShows) {
    const key = getDateKey(new Date(show.startTime));
    if (!prefsByDay.has(key)) prefsByDay.set(key, []);
    prefsByDay.get(key)!.push(show);
  }

  // Gap-fill empty days with preference shows
  for (const key of dayKeys) {
    const bucket = buckets.get(key)!;
    if (bucket.length > 0) continue;

    // Try a preference show for this day
    const dayPrefs = prefsByDay.get(key);
    if (dayPrefs && dayPrefs.length > 0) {
      const pref = dayPrefs.shift()!;
      const tag = pref.matchLabel ? `PICKED FOR YOU · ${pref.matchLabel}` : "PICKED FOR YOU";
      bucket.push({ kind: "preference", tag, show: pref });
      continue;
    }

    // Try any preference show from any day
    const allPrefEntries = Array.from(prefsByDay.values());
    for (const prefs of allPrefEntries) {
      if (prefs.length > 0) {
        const pref = prefs.shift()!;
        const tag = pref.matchLabel ? `PICKED FOR YOU · ${pref.matchLabel}` : "PICKED FOR YOU";
        bucket.push({ kind: "preference", tag, show: pref });
        break;
      }
    }
  }

  // Count total items and check if we have anything to send
  let totalItems = 0;
  dayKeys.forEach((key) => {
    totalItems += (buckets.get(key) || []).length;
  });
  if (totalItems === 0) return false;

  // Build HTML for each day
  let timelineHtml = "";
  for (const key of dayKeys) {
    const items = buckets.get(key)!;
    if (items.length === 0) continue;

    const label = dayLabels.get(key) || key;
    timelineHtml += buildDayHeaderHtml(label);

    // Sort items within a day by start time
    items.sort((a, b) => {
      const aTime = new Date(a.show.startTime).getTime();
      const bTime = new Date(b.show.startTime).getTime();
      return aTime - bTime;
    });

    for (const item of items) {
      timelineHtml += buildShowCardHtml(item.show, item.tag, timezone);
    }
  }

  // Curator recs section (separate from timeline, grouped by DJ)
  if (curatorRecs.length > 0) {
    const recsByDj = new Map<string, typeof curatorRecs>();
    for (const rec of curatorRecs) {
      const key = rec.djUsername.toLowerCase();
      if (!recsByDj.has(key)) recsByDj.set(key, []);
      recsByDj.get(key)!.push(rec);
    }
    for (const [, djRecs] of Array.from(recsByDj)) {
      const djName = djRecs[0].djName;
      timelineHtml += buildDayHeaderHtml(`Recommended by ${djName}`);
      for (const rec of djRecs) {
        timelineHtml += buildCuratorRecCardHtml(rec);
      }
    }
  }

  // Build highlight name for title: priority is favorite DJ > favorite show > preference DJ
  let highlightName = "";
  const firstFavWithDJ = favoriteShows.find((s) => s.djName);
  if (firstFavWithDJ?.djName) {
    highlightName = firstFavWithDJ.djName;
  } else if (favoriteShows.length > 0) {
    highlightName = favoriteShows[0].showName;
  } else if (preferenceShows.length > 0) {
    const firstPrefWithDJ = preferenceShows.find((s) => s.djName);
    highlightName = firstPrefWithDJ?.djName || preferenceShows[0].showName;
  }

  const titleText = highlightName ? `Upcoming for you: ${highlightName} & more` : "Upcoming for you";

  const content = `
    <!-- Title -->
    <h1 style="margin: 0 0 24px; font-size: 22px; font-weight: 700; color: #fff; line-height: 1.3; text-align: center;">
      ${titleText}
    </h1>
    <!-- Timeline -->
    ${timelineHtml}
  `;

  const subject = highlightName ? `Upcoming for you: ${highlightName} & more` : "Upcoming for you";

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: wrapEmailContent(content, "Based on your preferences and favorites."),
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

  const chatUrl = `https://channel-app.com/dj/${normalizeDjUsername(djUsername)}#chat`;

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

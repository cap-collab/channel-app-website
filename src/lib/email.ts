import { Resend } from "resend";

// Initialize Resend only if API key is available
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Channel <djshows@channel-app.com>";
const FROM_EMAIL_DJ = "Cap from Channel <cap@channel-app.com>";

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
    broadcast: "https://channel-app.com/radio",
  };
  return websiteUrls[metadataStationId] || getStationDeepLink(metadataStationId);
}

// Settings deep link (opens app settings if installed, falls back to website)
const SETTINGS_DEEP_LINK = "https://channel-app.com/settings";

// Email categories for List-Unsubscribe headers
type EmailCategory = "alerts" | "marketing" | "dj";

function getUnsubscribeUrl(category: EmailCategory): string {
  return `${SETTINGS_DEEP_LINK}?unsubscribe=${category}`;
}

export function getUnsubscribeHeaders(category: EmailCategory) {
  const url = getUnsubscribeUrl(category);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// Token-based unsubscribe URL for non-account users (waitlist etc.)
export function getWaitlistUnsubscribeUrl(email: string): string {
  const token = Buffer.from(email.trim().toLowerCase()).toString("base64");
  return `https://channel-app.com/api/unsubscribe?token=${encodeURIComponent(token)}&list=waitlist`;
}

// Wrap email content with waitlist-specific unsubscribe footer (no account needed)
export function wrapWaitlistEmailContent(content: string, footerText: string, email: string): string {
  const unsubscribeUrl = getWaitlistUnsubscribeUrl(email);
  return wrapEmailContentWithUnsubscribeUrl(content, footerText, unsubscribeUrl);
}

// Internal: wrap email with a custom unsubscribe URL
function wrapEmailContentWithUnsubscribeUrl(content: string, footerText: string, unsubscribeUrl: string): string {
  return minifyHtml(`
    <!DOCTYPE html>
    <html style="background-color: #ffffff;" bgcolor="#ffffff">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light only">
      <meta name="supported-color-schemes" content="light only">
      <style>
        :root { color-scheme: light only; }
        body, .body-bg { background-color: #ffffff !important; }
        u + .body-bg { background-color: #ffffff !important; }
        @media only screen and (max-width: 480px) {
          .card-row { display: block !important; }
          .card-content { display: block !important; width: 100% !important; }
          .card-btn { display: block !important; width: 100% !important; text-align: center !important; padding-top: 12px !important; padding-left: 0 !important; }
        }
      </style>
    </head>
    <body class="body-bg" bgcolor="#ffffff" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #ffffff; color: #1a1a1a; margin: 0; padding: 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff;">
        <tr>
          <td align="center" style="padding: 40px 20px;" bgcolor="#ffffff">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
              <tr>
                <td align="center" style="padding-bottom: 32px;" bgcolor="#ffffff">
                  <a href="https://channel-app.com" style="text-decoration: none;"><img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" /></a>
                </td>
              </tr>
              <tr>
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px; border-top: 1px solid #e5e5e5;" bgcolor="#ffffff">
                  <p style="margin: 0 0 12px; font-size: 13px; color: #999;">
                    ${footerText}
                  </p>
                  <a href="${unsubscribeUrl}" style="font-size: 12px; color: #999; text-decoration: underline;">
                    Unsubscribe
                  </a>
                  <!--${Date.now()}-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `);
}

// Channel logo URL
const LOGO_URL = "https://channel-app.com/logo-black.png";

// Shared email wrapper with Channel branding
function minifyHtml(html: string): string {
  return html.replace(/\n\s+/g, "\n").replace(/\n+/g, "\n").trim();
}

function wrapEmailContent(content: string, footerText: string): string {
  return minifyHtml(`
    <!DOCTYPE html>
    <html style="background-color: #ffffff;" bgcolor="#ffffff">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light only">
      <meta name="supported-color-schemes" content="light only">
      <style>
        :root { color-scheme: light only; }
        body, .body-bg { background-color: #ffffff !important; }
        u + .body-bg { background-color: #ffffff !important; }
        @media only screen and (max-width: 480px) {
          .card-row { display: block !important; }
          .card-content { display: block !important; width: 100% !important; }
          .card-btn { display: block !important; width: 100% !important; text-align: center !important; padding-top: 12px !important; padding-left: 0 !important; }
        }
      </style>
    </head>
    <body class="body-bg" bgcolor="#ffffff" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #ffffff; color: #1a1a1a; margin: 0; padding: 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff;">
        <tr>
          <td align="center" style="padding: 40px 20px;" bgcolor="#ffffff">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
              <tr>
                <td align="center" style="padding-bottom: 32px;" bgcolor="#ffffff">
                  <a href="https://channel-app.com" style="text-decoration: none;"><img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" /></a>
                </td>
              </tr>
              <tr>
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px; border-top: 1px solid #e5e5e5;" bgcolor="#ffffff">
                  <p style="margin: 0 0 12px; font-size: 13px; color: #999;">
                    ${footerText}
                  </p>
                  <a href="${SETTINGS_DEEP_LINK}" style="font-size: 12px; color: #999; text-decoration: underline;">
                    Unsubscribe
                  </a>
                  <!--${Date.now()}-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `);
}

// Standard button style (dark on white)
const BUTTON_STYLE = "display: inline-block; background-color: #0a0a0a; color: #fff !important; padding: 14px 28px; border-radius: 0; text-decoration: none; font-weight: 600; font-size: 14px;";

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
  // djHasEmail no longer used — button logic now checks stationId instead
  stationName,
  stationId,
}: ShowStartingEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const displayName = showName;
  // Prefer resolved DJ profile username (from p field), fall back to raw dj name
  const djDisplayName = djUsername || djName || showName;

  // Channel Radio → "Tune In" → /radio
  // External stations → "Tune In" → station website
  const isChannelRadio = stationId === "broadcast";
  const buttonUrl = isChannelRadio
    ? "https://channel-app.com/radio"
    : getStationWebsiteUrl(stationId);
  const buttonText = "Tune In";

  // Station accent colors for fallback avatar (same as watchlist digest)
  const stationAccentColors: Record<string, string> = {
    broadcast: "#D94099",
    "dj-radio": "#D94099",
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
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="80" height="80" style="width: 80px; height: 80px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5;" />`
    : `<table width="80" height="80" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: ${fallbackColor};">
        <tr>
          <td align="center" valign="middle" style="font-size: 32px; font-weight: bold; color: #fff;">
            ${djDisplayName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td align="center" style="padding: 32px;">
          <div style="margin-bottom: 16px;">
            ${photoHtml}
          </div>
          <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #1a1a1a;">
            ${displayName} <span style="color: #999;">is live</span>
          </h1>
          <p style="margin: 0 0 24px; font-size: 14px; color: #666;">on ${stationName}</p>
          <a href="${buttonUrl}" style="${BUTTON_STYLE}">${buttonText}</a>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${djUsername || djName ? djDisplayName : displayName} is live on ${stationName}`,
      html: wrapEmailContent(content, "You're receiving this because you saved this show."),
      headers: getUnsubscribeHeaders("alerts"),
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

  const djProfileUrl = show.djUsername
    ? `https://channel-app.com/dj/${normalizeDjUsername(show.djUsername)}`
    : show.djName
      ? `https://channel-app.com/dj/${normalizeDjUsername(show.djName)}`
      : `https://channel-app.com/dj/${normalizeDjUsername(show.showName)}`;

  const isFavorite = tag === "FAVORITE";
  const ctaUrl = show.isIRL && show.irlTicketUrl ? show.irlTicketUrl : djProfileUrl;
  const ctaText = show.isIRL && show.irlTicketUrl ? "GET TICKETS" : isFavorite ? "SEE PROFILE" : "REMIND ME";

  const badgeHtml = show.isIRL
    ? `<span style="display: inline-block; font-size: 10px; font-family: monospace; color: #22c55e; text-transform: uppercase; letter-spacing: 0.5px;">🌲 IRL</span>`
    : `<span style="display: inline-block; font-size: 10px; font-family: monospace; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">☁️ Online</span>`;

  const locationInfo = show.isIRL
    ? `${show.irlLocation || "TBA"}`
    : `${show.stationName} · ${timeStr}`;

  const fallbackColor = show.isIRL ? "#22c55e" : (STATION_ACCENT_COLORS[show.stationId] || "#D94099");
  const emailPhotoUrl = getEmailPhotoUrl(show.djUsername, show.djPhotoUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="64" height="64" style="width: 64px; height: 64px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5;" />`
    : `<table width="64" height="64" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: ${fallbackColor};">
        <tr>
          <td align="center" valign="middle" style="font-size: 24px; font-weight: bold; color: #fff;">
            ${djDisplayName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px; background: #f5f5f5; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 16px;">
          <div style="margin-bottom: 8px;">
            <span style="font-size: 10px; font-family: monospace; color: #999; text-transform: uppercase; letter-spacing: 0.5px;">${tag}</span>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr class="card-row">
              <td class="card-content" valign="top">
                <table cellpadding="0" cellspacing="0" border="0">
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
                      <div style="font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; line-height: 1.3;">
                        ${show.showName}
                      </div>
                      <div style="font-size: 13px; color: #666; margin-bottom: 4px;">
                        <a href="${djProfileUrl}" style="color: #666; text-decoration: none;">${djDisplayName}</a>
                      </div>
                      <div style="font-size: 12px; color: #999;">
                        ${locationInfo}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
              <td class="card-btn" valign="middle" style="text-align: right; padding-left: 12px; white-space: nowrap;">
                <a href="${ctaUrl}" style="display: inline-block; background-color: #0a0a0a; color: #fff !important; padding: 10px 24px; border-radius: 0; text-decoration: none; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${ctaText}
                </a>
              </td>
            </tr>
          </table>
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
    ? `<img src="${photoUrl}" alt="${displayTitle}" width="64" height="64" style="width: 64px; height: 64px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5;" />`
    : `<table width="64" height="64" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: #D94099;">
        <tr>
          <td align="center" valign="middle" style="font-size: 24px; font-weight: bold; color: #fff;">
            ${rec.djName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px; background: #f5f5f5; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr class="card-row">
              <td class="card-content" valign="top">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="64" valign="top" style="padding-right: 12px;">
                      <a href="${rec.url}" style="text-decoration: none;">
                        ${photoHtml}
                      </a>
                    </td>
                    <td valign="top">
                      <div style="margin-bottom: 4px;">
                        <span style="display: inline-block; font-size: 10px; font-family: monospace; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">${typeBadge}</span>
                      </div>
                      <div style="font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; line-height: 1.3;">
                        <a href="${rec.url}" style="color: #1a1a1a; text-decoration: none;">${displayTitle}</a>
                      </div>
                      <div style="font-size: 12px; color: #999;">
                        ${domain}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
              <td class="card-btn" valign="middle" style="text-align: right; padding-left: 12px; white-space: nowrap;">
                <a href="${djProfileUrl}" style="display: inline-block; background-color: #0a0a0a; color: #fff !important; padding: 10px 24px; border-radius: 0; text-decoration: none; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                  See ${rec.djName} Profile
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

// Build a day header HTML block
function buildDayHeaderHtml(dayLabel: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px; margin-top: 8px;">
      <tr>
        <td style="padding: 8px 0;">
          <span style="font-size: 12px; font-family: monospace; color: #666; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">${dayLabel}</span>
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
  preferredGenres?: string[];
}

export async function sendWatchlistDigestEmail({
  to,
  userTimezone,
  favoriteShows,
  curatorRecs,
  preferenceShows,
  preferredGenres,
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

  // Place favorite shows into buckets (only within the 4-day window)
  for (const show of favoriteShows) {
    const key = getDateKey(new Date(show.startTime));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push({ kind: "show", tag: "FAVORITE", show });
    }
  }

  // Place preference shows into their day buckets (1 per empty day, already selected upstream)
  for (const show of preferenceShows) {
    const key = getDateKey(new Date(show.startTime));
    const bucket = buckets.get(key);
    if (bucket && bucket.length === 0) {
      const tag = show.matchLabel ? `PICKED FOR YOU · ${show.matchLabel}` : "PICKED FOR YOU";
      bucket.push({ kind: "preference", tag, show });
    }
  }

  // Count total items and check if we have enough to send (minimum 4)
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

  // Build subject line and title
  // Only use shows that are actually visible in the email (within the 4-day window buckets)
  const visibleItems: TimelineItem[] = [];
  for (const key of dayKeys) {
    visibleItems.push(...(buckets.get(key) || []));
  }
  const visibleFavorite = visibleItems.find((item) => item.kind === "show");
  const visiblePreference = visibleItems.find((item) => item.kind === "preference");

  // Include date in subject to prevent Gmail from threading/collapsing repeat digests
  const subjectDate = now.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
  let subject: string;
  let titleText: string;

  if (visibleFavorite) {
    // Use DJ name from first visible favorite
    const show = visibleFavorite.show;
    const firstDj = show.djUsername || show.djName || show.showName;
    titleText = `${firstDj} & more upcoming`;
    subject = `${firstDj} & more upcoming · ${subjectDate}`;
  } else if (visiblePreference) {
    // No visible favorites — use DJ name from first visible picked-for-you show
    const show = visiblePreference.show;
    const highlightName = show.djUsername || show.djName || show.showName;
    titleText = highlightName ? `Upcoming for you: ${highlightName} & more` : "Upcoming for you";
    subject = `${titleText} · ${subjectDate}`;
  } else {
    titleText = "Upcoming for you";
    subject = `${titleText} · ${subjectDate}`;
  }

  let genreBannerText: string;
  if (preferredGenres && preferredGenres.length > 0) {
    const genreList = preferredGenres.length === 1
      ? preferredGenres[0]
      : preferredGenres.slice(0, -1).join(", ") + ", and " + preferredGenres[preferredGenres.length - 1];
    genreBannerText = `You are receiving this email based on your preference for ${genreList}. To change your preferences, visit your <a href="https://channel-app.com/settings" style="color: #666; text-decoration: underline;">settings</a>`;
  } else {
    genreBannerText = `<a href="https://channel-app.com/settings" style="color: #666; text-decoration: underline;">Set your email preferences</a> to receive alerts that match your tastes`;
  }

  const content = `
    <h1 style="margin: 0 0 4px; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3; text-align: center;">
      ${titleText}
    </h1>
    <p style="margin: 0 0 24px; font-size: 12px; color: #999; line-height: 1.4; text-align: center;">
      ${genreBannerText}
    </p>
    ${timelineHtml}
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: wrapEmailContent(content, "Based on your preferences and favorites."),
      headers: getUnsubscribeHeaders("marketing"),
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

// ── Broadcast Reminder Email (24h before show) ──────────────────────

interface BroadcastReminderEmailParams {
  to: string;
  djName: string;
  showName: string;
  broadcastUrl: string;
  profileUrl: string | null;
  startTime: string; // e.g. "Tuesday, March 31"
  timeRange: string; // e.g. "8:00 PM – 10:00 PM EST"
}

export async function sendBroadcastReminderEmail({
  to,
  djName,
  showName,
  broadcastUrl,
  startTime,
  timeRange,
}: BroadcastReminderEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const shareLine = `<tr>
        <td style="padding-top: 4px;">
          <span style="color: #666; font-size: 14px;">Share your stream: </span>
          <a href="https://channel-app.com" style="color: #555; font-size: 14px; text-decoration: underline;">channel-app.com</a>
        </td>
      </tr>`;

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 16px; color: #1a1a1a;">
            Hi ${djName},
          </p>
          <p style="margin: 0 0 20px; font-size: 16px; color: #1a1a1a;">
            Quick reminder — you're live on Channel tomorrow.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border: 1px solid #e5e5e5; margin-bottom: 24px;">
            <tr>
              <td style="padding: 16px;">
                <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #1a1a1a;">${showName}</p>
                <p style="margin: 0 0 2px; font-size: 14px; color: #666;">${startTime}</p>
                <p style="margin: 0; font-size: 14px; color: #666;">${timeRange}</p>
              </td>
            </tr>
          </table>
          <p style="margin: 0 0 4px; font-size: 14px; color: #666;">Your live stream link (keep private):</p>
          <p style="margin: 0 0 16px;">
            <a href="${broadcastUrl}" style="color: #555; font-size: 14px; text-decoration: underline; word-break: break-all;">${broadcastUrl}</a>
          </p>
          <p style="margin: 0 0 20px; font-size: 14px; color: #1a1a1a;">
            I recommend opening it ahead of time and doing a quick test.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-top: 4px;">
                <span style="color: #666; font-size: 14px;">Setup guide: </span>
                <a href="https://channel-app.com/streaming-guide" style="color: #555; font-size: 14px; text-decoration: underline;">channel-app.com/streaming-guide</a>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 4px;">
                <span style="color: #666; font-size: 14px;">Edit your profile info: </span>
                <a href="https://channel-app.com/studio" style="color: #555; font-size: 14px; text-decoration: underline;">channel-app.com/studio</a>
              </td>
            </tr>
            ${shareLine}
          </table>
          <p style="margin: 24px 0 0; font-size: 14px; color: #1a1a1a;">
            See you tomorrow, Cap
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL_DJ,
      to,
      subject: `Reminder: ${showName} tomorrow on Channel`,
      html: wrapEmailContent(content, "You're receiving this because you have a scheduled show on Channel Radio."),
      headers: getUnsubscribeHeaders("dj"),
    });

    if (error) {
      console.error("Error sending broadcast reminder email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending broadcast reminder email:", error);
    return false;
  }
}

export async function sendBroadcast2HourReminderEmail({
  to,
  djName,
  showName,
  broadcastUrl,
  startTime,
  timeRange,
}: BroadcastReminderEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const shareLine = `<tr>
        <td style="padding-top: 4px;">
          <span style="color: #666; font-size: 14px;">Share your stream: </span>
          <a href="https://channel-app.com" style="color: #555; font-size: 14px; text-decoration: underline;">channel-app.com</a>
        </td>
      </tr>`;

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 16px; color: #1a1a1a;">
            Hi ${djName},
          </p>
          <p style="margin: 0 0 20px; font-size: 16px; color: #1a1a1a;">
            Your show is coming up soon — time to get set up!
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border: 1px solid #e5e5e5; margin-bottom: 24px;">
            <tr>
              <td style="padding: 16px;">
                <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #1a1a1a;">${showName}</p>
                <p style="margin: 0 0 2px; font-size: 14px; color: #666;">${startTime}</p>
                <p style="margin: 0; font-size: 14px; color: #666;">${timeRange}</p>
              </td>
            </tr>
          </table>
          <p style="margin: 0 0 4px; font-size: 14px; color: #666;">Your live stream link (keep private):</p>
          <p style="margin: 0 0 16px;">
            <a href="${broadcastUrl}" style="color: #555; font-size: 14px; text-decoration: underline; word-break: break-all;">${broadcastUrl}</a>
          </p>
          <p style="margin: 0 0 20px; font-size: 14px; color: #1a1a1a;">
            Open it now and do a quick test before you go live.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-top: 4px;">
                <span style="color: #666; font-size: 14px;">Setup guide: </span>
                <a href="https://channel-app.com/streaming-guide" style="color: #555; font-size: 14px; text-decoration: underline;">channel-app.com/streaming-guide</a>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 4px;">
                <span style="color: #666; font-size: 14px;">Edit your profile info: </span>
                <a href="https://channel-app.com/studio" style="color: #555; font-size: 14px; text-decoration: underline;">channel-app.com/studio</a>
              </td>
            </tr>
            ${shareLine}
          </table>
          <p style="margin: 24px 0 0; font-size: 14px; color: #1a1a1a;">
            See you soon, Cap
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL_DJ,
      to,
      subject: `You're live soon on Channel`,
      html: wrapEmailContent(content, "You're receiving this because you have a scheduled show on Channel Radio."),
      headers: getUnsubscribeHeaders("dj"),
    });

    if (error) {
      console.error("Error sending broadcast 2h reminder email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending broadcast 2h reminder email:", error);
    return false;
  }
}

// ── Post-Broadcast Thank You Email (24h after show) ─────────────────

interface PostBroadcastEmailParams {
  to: string;
  djName: string;
  username: string;
  missingItems: string | null; // e.g. "your location, genre, and a tip link"
  showTipParagraph: boolean;   // true when tipButtonLink is NOT set
}

export async function sendPostBroadcastEmail({
  to,
  djName,
  username,
  missingItems,
  showTipParagraph,
}: PostBroadcastEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const profileUrl = `https://channel-app.com/dj/${username}`;
  const studioUrl = "https://channel-app.com/studio";

  const recommendLine = missingItems
    ? `<p style="margin: 0 0 16px; font-size: 14px; color: #1a1a1a;">
            I'd recommend adding ${missingItems} via
            <a href="${studioUrl}" style="color: #555; text-decoration: underline;">${studioUrl}</a>
          </p>`
    : "";

  const tipParagraph = showTipParagraph
    ? `<p style="margin: 0 0 16px; font-size: 14px; color: #666;">
            The tip link is where people land when they click "support", and it also adds a small tip icon to your player whenever someone is listening to your live or recordings.
          </p>`
    : "";

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 16px; color: #1a1a1a;">
            Hi ${djName},
          </p>
          <p style="margin: 0 0 16px; font-size: 14px; color: #1a1a1a;">
            Huge thank you again for yesterday.
          </p>
          <p style="margin: 0 0 16px; font-size: 14px; color: #1a1a1a;">
            Your recording is now available on Channel on your profile:<br />
            <a href="${profileUrl}" style="color: #555; text-decoration: underline; word-break: break-all;">${profileUrl}</a>
          </p>
          <p style="margin: 0 0 16px; font-size: 14px; color: #1a1a1a;">
            Your profile will also be featured on the main page and in our newsletter.
          </p>
          ${recommendLine}
          ${tipParagraph}
          <p style="margin: 0 0 16px; font-size: 14px; color: #1a1a1a;">
            Thanks again, really appreciate you being part of this 🖤
          </p>
          <p style="margin: 0 0 0; font-size: 14px; color: #666;">
            Would love your feedback to help make the platform better for you and your audience. Feel free to reach out anytime.
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL_DJ,
      to,
      subject: "Your recording is available on Channel",
      html: wrapEmailContent(content, "You're receiving this because you recently broadcast on Channel Radio."),
      headers: getUnsubscribeHeaders("dj"),
    });

    if (error) {
      console.error("Error sending post-broadcast email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending post-broadcast email:", error);
    return false;
  }
}

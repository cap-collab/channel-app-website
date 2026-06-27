import { Resend } from "resend";
import { tempoLabel } from "@/lib/tempo";

// Initialize Resend only if API key is available
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Scene glyph + label for the weekly fallback "featured by scene" blocks. The
// featured grid only ever uses spiral/star.
const SCENE_GLYPH: Record<string, { glyph: string; name: string }> = {
  spiral: { glyph: "🌀", name: "Spiral" },
  star: { glyph: "✳", name: "Star" },
};

const FROM_EMAIL = "Channel <djshows@channel-app.com>";
const FROM_EMAIL_DJ = "Cap from Channel <cap@channel-app.com>";

// Get the radio station's website URL by metadata key. Unknown station IDs
// fall back to the Channel homepage.
function getStationWebsiteUrl(metadataStationId: string): string {
  const websiteUrls: Record<string, string> = {
    nts1: "https://www.nts.live/",
    nts2: "https://www.nts.live/",
    rinse: "https://www.rinse.fm/",
    rinsefr: "https://www.rinse.fm/channels/france",
    dublab: "https://www.dublab.com/",
    subtle: "https://www.subtleradio.com/",
    sutro: "https://sutrofm.net/",
    newtown: "https://newtownradio.com",
    broadcast: "https://channel-app.com/",
  };
  return websiteUrls[metadataStationId] || "https://channel-app.com/";
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

// Per-DJ "go live" mute link, used at the bottom of every show-starting email.
// Single click → adds the DJ to the recipient's `goLiveMutes` array, no login
// required. The token is base64(uid + ":" + djUsername) — same trust model
// as the waitlist token (knowledge of the link = consent to act on it).
export function getGoLiveMuteUrl(userId: string, djUsername: string): string {
  const token = Buffer.from(`${userId}:${djUsername}`).toString("base64");
  return `https://channel-app.com/api/go-live-mute?token=${encodeURIComponent(token)}`;
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
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px;" bgcolor="#ffffff">
                  <a href="https://channel-app.com" style="text-decoration: none;"><img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" /></a>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px;" bgcolor="#ffffff">
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

function wrapEmailContent(
  content: string,
  footerText: string,
  unsubscribeOverride?: { url: string; label: string },
  aboveContentHtml?: string,
  sidePaddingPx?: number,
): string {
  const unsubUrl = unsubscribeOverride?.url ?? SETTINGS_DEEP_LINK;
  const unsubLabel = unsubscribeOverride?.label ?? "Unsubscribe";
  return _wrapEmailContent(content, footerText, unsubUrl, unsubLabel, aboveContentHtml, sidePaddingPx);
}

// How a DJ signs in, recorded on their user doc at login (see useAuth.ts) and
// backfilled for existing DJs. Used only to remind a DJ of their own method in
// the footer of DJ-facing emails, so they don't create a duplicate account.
export type SignInMethod = "google" | "apple" | "emailLink" | "password";

// Build the personalized "how you sign in" sentence appended to a DJ email
// footer. Returns "" (no line) when the method is unknown — the footer then
// renders exactly as it does today. Apple deliberately omits the email because
// Hide-My-Email relays it to a useless address.
function signInReminderHtml(method?: string, email?: string): string {
  const at = "at <a href=\"https://channel-app.com\" style=\"color: #999; text-decoration: underline;\">channel-app.com</a>";
  let line: string;
  switch (method) {
    case "google":
      line = `You sign in with <strong>Google</strong>${email ? ` (${email})` : ""} ${at}.`;
      break;
    case "apple":
      line = `You sign in with <strong>Apple</strong> ${at}.`;
      break;
    case "password":
      line = `You sign in with your <strong>email &amp; password</strong>${email ? ` (${email})` : ""} ${at}.`;
      break;
    case "emailLink":
      line = `You sign in with a <strong>magic link</strong> — enter your email ${at} and we'll send it on that email address.`;
      break;
    default:
      return "";
  }
  return `<br><br>${line}`;
}

function _wrapEmailContent(
  content: string,
  footerText: string,
  unsubUrl: string,
  unsubLabel: string,
  aboveContentHtml?: string,
  // Horizontal padding around the content (px). Default 20; the weekly rec email
  // passes a smaller value (matching the Monday newsletter) for more width.
  sidePaddingPx: number = 20,
): string {
  const aboveBlock = aboveContentHtml
    ? `<tr>
        <td align="center" style="padding-bottom: 16px;" bgcolor="#ffffff">
          ${aboveContentHtml}
        </td>
      </tr>`
    : "";
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
          <td align="center" style="padding: 40px ${sidePaddingPx}px;" bgcolor="#ffffff">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
              ${aboveBlock}
              <tr>
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px;" bgcolor="#ffffff">
                  <a href="https://channel-app.com" style="text-decoration: none;"><img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" /></a>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px;" bgcolor="#ffffff">
                  <p style="margin: 0 0 12px; font-size: 13px; color: #999;">
                    ${footerText}
                  </p>
                  <a href="${unsubUrl}" style="font-size: 12px; color: #999; text-decoration: underline;">
                    ${unsubLabel}
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

// Get a photo URL for emails.
// Priority:
//  1. showImageUrl — per-show cover art on the broadcast slot. This is the
//     only image that works for a COLLECTIVE slot: its djUsername is a
//     collective slug, so the /api/dj-photo proxy (keyed on a user's
//     chatUsernameNormalized) 404s and the image blanks. It's also just the
//     most show-accurate art when a DJ uploaded one.
//  2. proxy by djUsername — clean, short URL email clients handle reliably
//     (no long tokens, spaces, or special chars).
//  3. raw djPhotoUrl fallback.
function getEmailPhotoUrl(
  djUsername?: string,
  djPhotoUrl?: string,
  showImageUrl?: string,
): string | undefined {
  if (showImageUrl) return showImageUrl;
  if (djUsername) {
    return `https://channel-app.com/api/dj-photo/${normalizeDjUsername(djUsername)}`;
  }
  if (djPhotoUrl) return djPhotoUrl;
  return undefined;
}

export interface LaterTodayShowRow {
  showId: string;
  showName: string;
  djName?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  showImageUrl?: string; // Per-show cover art — preferred over the DJ photo
  stationName: string;
  stationId: string;
  startTime: string; // ISO 8601
  endTime?: string; // ISO 8601 — used to render "start – end" on the row
}

interface ShowStartingEmailParams {
  to: string;
  recipientUserId?: string; // For per-DJ unsubscribe link in footer
  showName: string;
  djName?: string;
  djUsername?: string; // DJ's chat username for profile link
  djPhotoUrl?: string; // DJ profile photo
  showImageUrl?: string; // Per-show cover art — preferred over the DJ photo
  djHasEmail?: boolean; // Whether DJ has email set (can receive chat messages)
  stationName: string;
  stationId: string;
  streamingUrl?: string; // For dj-radio shows: the external station's URL
  // Audience-borrow bridge: the DJ {X} the live entity borrows from
  // (audienceDjUids). When set, the footer reads "you like {X}." Drives the
  // borrow "why" line. (The old crew/affiliation caption was removed.)
  affiliationBridgeDj?: string;
  // Which listener-side bridge connected the recipient: "crew" (same
  // affiliation group) renders "From the same world as {R}."; "borrow"
  // (audience-borrow — the live DJ borrows {R}'s fans) renders "If you like
  // {R}.". Only affects the caption above the card; defaults to crew wording.
  bridgeKind?: "crew" | "borrow";
  // Recipient was matched via past engagement (heart or lock-in) rather than
  // a watchlist/favorite. Changes footer copy only.
  engagementReason?: "engaged";
  // Recipient matched because they saved this exact show ("favorite") vs. a
  // saved search term that matched ("watchlist"). Only affects the default
  // footer line; engagement/affiliation reasons take priority over this.
  savedReason?: "favorite" | "watchlist";
  // Other shows the recipient would have matched today, bundled into a
  // single email so we cap each user at one go-live notification per day.
  // Sorted by startTime ascending. When empty/absent, no section renders
  // and the email is byte-identical to the single-show layout.
  laterToday?: LaterTodayShowRow[];
  // Recipient's timezone (e.g. "America/Los_Angeles") — used to format the
  // time label on each bundled row.
  userTimezone?: string;
  // When the primary show is a restream (not a live broadcast), the subject
  // and headline say "airing" instead of "is live".
  isRestream?: boolean;
}

export async function sendShowStartingEmail({
  to,
  recipientUserId,
  showName,
  djName,
  djUsername,
  djPhotoUrl,
  showImageUrl,
  // djHasEmail no longer used — button logic now checks stationId instead
  stationName,
  stationId,
  streamingUrl,
  affiliationBridgeDj,
  bridgeKind,
  engagementReason,
  savedReason,
  laterToday,
  userTimezone,
  isRestream,
}: ShowStartingEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const displayName = showName;
  // Prefer resolved DJ profile username (from p field), fall back to raw dj name
  const djDisplayName = djUsername || djName || showName;

  // Channel Radio → "Tune In" → home
  // dj-radio (DJ live on an external station entered via /studio) → that station's URL
  // Known external stations → "Tune In" → station website
  const isChannelRadio = stationId === "broadcast";
  let buttonUrl: string;
  if (isChannelRadio) {
    buttonUrl = "https://channel-app.com/";
  } else if (stationId === "dj-radio") {
    buttonUrl = streamingUrl || "https://channel-app.com/";
  } else {
    buttonUrl = getStationWebsiteUrl(stationId);
  }
  // On Channel broadcasts listeners can send love in-app; on external
  // stations they can't, so keep the plain CTA there.
  const buttonText = isChannelRadio ? "Tune in & send love" : "Tune In";

  // Station accent colors for fallback avatar (same as watchlist digest)
  const stationAccentColors: Record<string, string> = {
    broadcast: "#DC9B50",
    "dj-radio": "#DC9B50",
    nts1: "#FFFFFF",
    nts2: "#FFFFFF",
    rinse: "#228EFD",
    rinsefr: "#8A8A8A",
    dublab: "#0287FE",
    subtle: "#C3E943",
    sutro: "#FFFFFF",
    newtown: "#ec92af",
  };
  const fallbackColor = stationAccentColors[stationId] || "#DC9B50";

  // Show cover art → DJ photo (proxy) → fallback initial (email-compatible
  // table-based fallback). showImageUrl is required for collective slots.
  const emailPhotoUrl = getEmailPhotoUrl(djUsername, djPhotoUrl, showImageUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="80" height="80" style="width: 80px; height: 80px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5;" />`
    : `<table width="80" height="80" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: ${fallbackColor};">
        <tr>
          <td align="center" valign="middle" style="font-size: 32px; font-weight: bold; color: #fff;">
            ${djDisplayName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  const laterTodayHtml = laterToday && laterToday.length > 0
    ? buildLaterTodaySection(laterToday, userTimezone || "America/Los_Angeles")
    : "";

  // Subject line is always about the PRIMARY live show only — "{DJ} is live on
  // channel" (or "airing" for a restream). The bundle below is the week's full
  // schedule, not a crew who are also live right now, so it must NOT inflate
  // the subject with a week of names.
  // Prefer the human-readable djName ("etc radio") over the normalized
  // djUsername slug ("etcradio") in the subject; fall back to the slug, then
  // the show name.
  const primarySubjectName = djName || djUsername || displayName;
  const stationSuffix = isChannelRadio ? "channel" : stationName;
  const subject = isRestream
    ? `${primarySubjectName} airing on ${stationSuffix}`
    : `${primarySubjectName} is live on ${stationSuffix}`;

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td align="center" style="padding: 32px;">
          <div style="margin-bottom: 16px;">
            ${photoHtml}
          </div>
          <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #1a1a1a;">
            ${displayName} <span style="color: #999;">${isRestream ? "is airing" : "is live"}</span>
          </h1>
          <p style="margin: 0 0 24px; font-size: 14px; color: #666;">on ${isChannelRadio ? "channel" : stationName}</p>
          <a href="${buttonUrl}" style="${BUTTON_STYLE}">${buttonText}</a>
        </td>
      </tr>
    </table>
    ${laterTodayHtml}
  `;

  // Per-DJ mute link in the footer applies to every recipient — one click
  // adds this DJ to the user's goLiveMutes so they stop receiving go-live
  // notifications for this DJ regardless of how they got matched
  // (watchlist, favorite, affiliated, engagement).
  // The mute URL keys on the normalized djUsername slug (the backend mute
  // target — keep it), but the user-facing label must read the human name
  // ("etc radio"), not the slug ("etcradio"). Same display preference as the
  // subject: djName → djUsername → showName.
  const muteUrl = recipientUserId && djUsername
    ? getGoLiveMuteUrl(recipientUserId, djUsername)
    : undefined;
  const muteOverride = muteUrl
    ? { url: muteUrl, label: `Unsubscribe from ${primarySubjectName}` }
    : undefined;

  // No caption above the hero card — the match reason lives ONLY in the footer
  // line at the bottom of the email (avoids repeating it in two places).

  // Footer = the single "why you're receiving this" line (no caption above the
  // card). Priority: favorite → watchlist → engaged → borrow. A borrow match
  // also carries engagementReason, so it's checked AFTER the direct-engaged
  // case but identified by affiliationBridgeDj.
  const footerText = (savedReason === "favorite" || savedReason === "watchlist")
    ? "You're receiving this because it matches a show on your watchlist."
    : engagementReason && !affiliationBridgeDj
    ? "You're receiving this because you engaged with that DJ in the past."
    : affiliationBridgeDj
    ? bridgeKind === "borrow"
      ? `You're receiving this because you like ${affiliationBridgeDj}.`
      : `You're receiving this because you follow ${affiliationBridgeDj}.`
    : "You're receiving this because it matches a show on your watchlist.";

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: wrapEmailContent(content, footerText, muteOverride),
      headers: muteUrl
        ? {
            "List-Unsubscribe": `<${muteUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : getUnsubscribeHeaders("alerts"),
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
  broadcast: "#DC9B50",
  nts1: "#FFFFFF",
  nts2: "#FFFFFF",
  rinse: "#228EFD",
  rinsefr: "#8A8A8A",
  dublab: "#0287FE",
  subtle: "#C3E943",
  sutro: "#FFFFFF",
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

  const fallbackColor = show.isIRL ? "#22c55e" : (STATION_ACCENT_COLORS[show.stationId] || "#DC9B50");
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

// Compact 48x48-photo row used by the "Also coming up later today" bundle
// at the bottom of go-live emails. Whole row is one tappable link to the
// DJ profile. No CTA button — tighter than buildShowCardHtml.
function buildLaterTodayRowHtml(row: LaterTodayShowRow, timezone: string): string {
  const djDisplayName = row.djName || row.djUsername || row.showName;
  // The bundle spans the whole week, so each row leads with its weekday and
  // a start–end range ("Wed 7:00 – 9:00 PM"). Only the start carries the
  // weekday; the end is time-only (same day — we never span days).
  const startStr = new Date(row.startTime).toLocaleString("en-US", {
    timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit",
  });
  const endStr = row.endTime
    ? new Date(row.endTime).toLocaleString("en-US", {
        timeZone: timezone, hour: "numeric", minute: "2-digit",
      })
    : null;
  const timeStr = endStr ? `${startStr} – ${endStr}` : startStr;
  const djProfileUrl = row.djUsername
    ? `https://channel-app.com/dj/${normalizeDjUsername(row.djUsername)}`
    : row.djName
      ? `https://channel-app.com/dj/${normalizeDjUsername(row.djName)}`
      : `https://channel-app.com/dj/${normalizeDjUsername(row.showName)}`;

  const fallbackColor = STATION_ACCENT_COLORS[row.stationId] || "#DC9B50";
  const emailPhotoUrl = getEmailPhotoUrl(row.djUsername, row.djPhotoUrl, row.showImageUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="48" height="48" style="width: 48px; height: 48px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5; display: block;" />`
    : `<table width="48" height="48" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: ${fallbackColor};">
        <tr>
          <td align="center" valign="middle" style="font-size: 20px; font-weight: bold; color: #fff;">
            ${djDisplayName.charAt(0).toUpperCase()}
          </td>
        </tr>
      </table>`;

  return `
    <a href="${djProfileUrl}" style="text-decoration: none; color: inherit; display: block;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 8px;">
        <tr>
          <td width="48" valign="top" style="padding-right: 12px;">
            ${photoHtml}
          </td>
          <td valign="middle">
            <div style="font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; line-height: 1.3;">
              ${row.showName}
            </div>
            <div style="font-size: 12px; color: #999;">
              ${djDisplayName} · ${timeStr}
            </div>
          </td>
        </tr>
      </table>
    </a>
  `;
}

// YYYY-MM-DD for a timestamp in the given timezone (local-day key).
function localDayKey(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

// One labelled block of bundle rows. Shared by the "today" + "this week"
// sections so they look identical apart from the heading.
function buildBundleBlock(label: string, rows: LaterTodayShowRow[], timezone: string): string {
  if (rows.length === 0) return "";
  return `
    <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e5e5;">
      <p style="margin: 0 0 12px; font-size: 11px; font-family: monospace; color: #999; text-transform: uppercase; letter-spacing: 1px;">${label}</p>
      ${rows.map((r) => buildLaterTodayRowHtml(r, timezone)).join("")}
    </div>
  `;
}

// Build the bundle, split into two blocks: shows airing later TODAY (same
// local day as the email) under "Also coming up today", and the rest of the
// week under "Coming up this week". Caller already filtered + sorted rows by
// startTime. Either block renders nothing when empty.
function buildLaterTodaySection(rows: LaterTodayShowRow[], timezone: string): string {
  if (rows.length === 0) return "";
  // "Today" = the day the email is SENT (the wall clock), in the recipient's
  // TZ. A show whose start is later on the same calendar day goes under "Also
  // coming up today"; everything else under "Coming up this week".
  const todayKey = localDayKey(Date.now(), timezone);
  const today: LaterTodayShowRow[] = [];
  const thisWeek: LaterTodayShowRow[] = [];
  for (const r of rows) {
    const ms = Date.parse(r.startTime);
    if (Number.isFinite(ms) && localDayKey(ms, timezone) === todayKey) today.push(r);
    else thisWeek.push(r);
  }
  return (
    buildBundleBlock("Also coming up today", today, timezone) +
    buildBundleBlock("Coming up this week", thisWeek, timezone)
  );
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
    : `<table width="64" height="64" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: #DC9B50;">
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

// ── Weekly Recommendation Email (Tue 10am PT) ───────────────────────────────
// Mirrors /scene over email: new shows from favorites, in-your-scene picks, and
// everything coming up this week. Reuses the go-live bundle-row look
// (buildBundleBlock / 48×48 stacked rows) so it's visually consistent.

// An archive row (sections 1 & 2). No upcoming time — meta line is "DJ · scene".
export interface WeeklyRecArchiveRow {
  slug: string;
  showName: string;
  djName?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  showImageUrl?: string;
  sceneLabel?: string; // e.g. a scene name; optional secondary meta
  // For the fallback "featured" grid grouped by scene: the scene slug (e.g.
  // "spiral" / "star") to group + label by, and the tempo for the bold
  // "Scene · Tempo" line.
  sceneSlug?: string;
  tempo?: string | null;
}

// A coming-up row (section 3). Online OR IRL; carries a start (+optional end).
export interface WeeklyRecComingUpRow {
  showName: string;
  djName?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  showImageUrl?: string;
  stationId: string;
  startTime: string; // ISO
  endTime?: string; // ISO
  isIRL: boolean;
  linkUrl?: string; // ticket URL (IRL) or DJ/show page (online); falls back to DJ page
  // IRL events often have a full lineup — the sub-line lists these (capped with
  // "+N more" so the row height never grows). Online shows: omit / single DJ.
  allDjArtists?: string[];
}

interface WeeklyRecommendationsEmailParams {
  to: string;
  userTimezone?: string;
  section1: WeeklyRecArchiveRow[]; // new from favorites (max 2)
  section2: WeeklyRecArchiveRow[]; // in your scene (max 2)
  comingUp: WeeklyRecComingUpRow[]; // everything this week
  isFallback?: boolean; // section1/2 came from the featured matrix
  recipientUid?: string; // known recipient → CTA deep-links their own /scene
}

// Archive row → bundle-style row. Links to the homepage main player
// (/?archive=<slug>) so the archive preloads on the archive slide.
function buildWeeklyArchiveRowHtml(row: WeeklyRecArchiveRow): string {
  const djDisplayName = row.djName || row.djUsername || row.showName;
  const meta = row.sceneLabel ? `${djDisplayName} · ${row.sceneLabel}` : djDisplayName;
  const url = `https://channel-app.com/?archive=${encodeURIComponent(row.slug)}`;
  const fallbackColor = "#DC9B50";
  const emailPhotoUrl = getEmailPhotoUrl(row.djUsername, row.djPhotoUrl, row.showImageUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="48" height="48" style="width: 48px; height: 48px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5; display: block;" />`
    : `<table width="48" height="48" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: ${fallbackColor};"><tr><td align="center" valign="middle" style="font-size: 20px; font-weight: bold; color: #fff;">${djDisplayName.charAt(0).toUpperCase()}</td></tr></table>`;
  return `
    <a href="${url}" style="text-decoration: none; color: inherit; display: block;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 8px;">
        <tr>
          <td width="48" valign="top" style="padding-right: 12px;">${photoHtml}</td>
          <td valign="middle">
            <div style="font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; line-height: 1.3;">${row.showName}</div>
            <div style="font-size: 12px; color: #999;">${meta}</div>
          </td>
        </tr>
      </table>
    </a>
  `;
}

// Fallback "featured by scene" row: bold "{Scene} · {Tempo}" headline, with
// "{DJ} · {show}" beneath. Same 48px photo + link as the standard archive row.
function buildWeeklyFeaturedRowHtml(row: WeeklyRecArchiveRow): string {
  const djDisplayName = row.djName || row.djUsername || row.showName;
  const sceneInfo = row.sceneSlug ? SCENE_GLYPH[row.sceneSlug] : undefined;
  // Headline = scene GLYPH only (no plain "Spiral"/"Star" word) + tempo.
  const sceneGlyph = sceneInfo ? sceneInfo.glyph : "";
  const tempo = row.tempo ? tempoLabel(row.tempo) : null;
  const headline = [sceneGlyph, tempo].filter(Boolean).join(" · ") || row.showName;
  const sub = `${djDisplayName} · ${row.showName}`;
  const url = `https://channel-app.com/?archive=${encodeURIComponent(row.slug)}`;
  const fallbackColor = "#DC9B50";
  const emailPhotoUrl = getEmailPhotoUrl(row.djUsername, row.djPhotoUrl, row.showImageUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="48" height="48" style="width: 48px; height: 48px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5; display: block;" />`
    : `<table width="48" height="48" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: ${fallbackColor};"><tr><td align="center" valign="middle" style="font-size: 20px; font-weight: bold; color: #fff;">${djDisplayName.charAt(0).toUpperCase()}</td></tr></table>`;
  return `
    <a href="${url}" style="text-decoration: none; color: inherit; display: block;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 8px;">
        <tr>
          <td width="48" valign="top" style="padding-right: 12px;">${photoHtml}</td>
          <td valign="middle">
            <div style="font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; line-height: 1.3;">${headline}</div>
            <div style="font-size: 12px; color: #999;">${sub}</div>
          </td>
        </tr>
      </table>
    </a>
  `;
}

// Coming-up row → bundle-style row with an Online/IRL badge + weekday start–end.
function buildWeeklyComingUpRowHtml(row: WeeklyRecComingUpRow, timezone: string): string {
  const djDisplayName = row.djName || row.djUsername || row.showName;
  const startStr = new Date(row.startTime).toLocaleString("en-US", {
    timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit",
  });
  const endStr = row.endTime
    ? new Date(row.endTime).toLocaleString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" })
    : null;
  const timeStr = endStr ? `${startStr} – ${endStr}` : startStr;
  const badge = row.isIRL ? "🌲 IRL" : "☁️ Online";
  // IRL events list their lineup (capped so the row never grows): first 3 names,
  // then "+N more". Online shows keep the single DJ display name.
  let artistStr = djDisplayName;
  if (row.isIRL && row.allDjArtists && row.allDjArtists.length > 0) {
    const names = Array.from(new Set(row.allDjArtists));
    const CAP = 3;
    artistStr = names.length <= CAP
      ? names.join(", ")
      : `${names.slice(0, CAP).join(", ")} +${names.length - CAP} more`;
  }
  const url = row.linkUrl
    || (row.djUsername ? `https://channel-app.com/dj/${normalizeDjUsername(row.djUsername)}`
      : `https://channel-app.com/dj/${normalizeDjUsername(row.djName || row.showName)}`);
  const fallbackColor = row.isIRL ? "#22c55e" : (STATION_ACCENT_COLORS[row.stationId] || "#DC9B50");
  const emailPhotoUrl = getEmailPhotoUrl(row.djUsername, row.djPhotoUrl, row.showImageUrl);
  const photoHtml = emailPhotoUrl
    ? `<img src="${emailPhotoUrl}" alt="${djDisplayName}" width="48" height="48" style="width: 48px; height: 48px; border-radius: 0; object-fit: cover; border: 1px solid #e5e5e5; display: block;" />`
    : `<table width="48" height="48" cellpadding="0" cellspacing="0" border="0" style="border-radius: 0; border: 1px solid #e5e5e5; background-color: ${fallbackColor};"><tr><td align="center" valign="middle" style="font-size: 20px; font-weight: bold; color: #fff;">${djDisplayName.charAt(0).toUpperCase()}</td></tr></table>`;
  return `
    <a href="${url}" style="text-decoration: none; color: inherit; display: block;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 8px;">
        <tr>
          <td width="48" valign="top" style="padding-right: 12px;">${photoHtml}</td>
          <td valign="middle">
            <div style="font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; line-height: 1.3;">${row.showName}</div>
            <div style="font-size: 12px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${artistStr} · ${timeStr} · ${badge}</div>
          </td>
        </tr>
      </table>
    </a>
  `;
}

// One labelled block (heading + top divider + stacked rows). Mirrors the
// go-live email's buildBundleBlock. Empty rows → renders nothing. The FIRST
// rendered block omits the top divider/margin so it sits flush at the top of
// the email (there's no title/subtitle above it).
function buildWeeklyBlock(label: string, rowsHtml: string[], first = false): string {
  if (rowsHtml.length === 0) return "";
  const wrapStyle = first
    ? ""
    : "margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e5e5;";
  // Empty label → no heading paragraph (e.g. the fallback featured rows, where
  // the scene is conveyed by each row's glyph).
  const labelHtml = label
    ? `<p style="margin: 0 0 12px; font-size: 11px; font-family: monospace; color: #999; text-transform: uppercase; letter-spacing: 1px;">${label}</p>`
    : "";
  return `
    <div style="${wrapStyle}">
      ${labelHtml}
      ${rowsHtml.join("")}
    </div>
  `;
}

export async function sendWeeklyRecommendationsEmail({
  to,
  userTimezone,
  section1,
  section2,
  comingUp,
  isFallback,
  recipientUid,
}: WeeklyRecommendationsEmailParams): Promise<boolean> {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }
  const tz = userTimezone || "America/Los_Angeles";

  // Render blocks in order — the first NON-EMPTY block omits the top divider.
  const rows3 = comingUp.map((r) => buildWeeklyComingUpRowHtml(r, tz));
  let firstUsed = false;
  const renderBlock = (label: string, rows: string[]): string => {
    if (rows.length === 0) return "";
    const html = buildWeeklyBlock(label, rows, !firstUsed);
    firstUsed = true;
    return html;
  };

  let topBlocks: string;
  if (isFallback) {
    // No-history: NO title and NO scene headers — just the featured rows, ordered
    // by scene (spiral then star). Each row's bold headline carries the scene
    // GLYPH + tempo ("🌀 · Uptempo") with "{DJ} · {show}" beneath, so the scene
    // is conveyed by the glyph alone.
    const SCENE_ORDER = ["spiral", "star"];
    const rowsHtml = SCENE_ORDER.flatMap((slug) =>
      section1.filter((r) => r.sceneSlug === slug).map(buildWeeklyFeaturedRowHtml),
    );
    // Include any featured archive that didn't match spiral/star, so nothing is
    // silently dropped.
    const matched = new Set(["spiral", "star"]);
    rowsHtml.push(
      ...section1.filter((r) => !r.sceneSlug || !matched.has(r.sceneSlug)).map(buildWeeklyFeaturedRowHtml),
    );
    topBlocks = renderBlock("", rowsHtml);
  } else {
    // "New from your favorites" = DJ-centric rows (show name / DJ · scene).
    // "In your scene" (discovery) reuses the featured row format (scene glyph +
    // tempo / DJ · show), since those picks carry scene+tempo like the fallback.
    const block1 = renderBlock("New from your favorites", section1.map(buildWeeklyArchiveRowHtml));
    const block2 = renderBlock("In your scene", section2.map(buildWeeklyFeaturedRowHtml));
    topBlocks = block1 + block2;
  }
  const block3 = renderBlock("Coming up this week", rows3);

  // We know who this recipient is, so deep-link their OWN /scene via a
  // non-credential uid token (same base64 trust model as the unsubscribe /
  // go-live-mute links above). The page renders their personalized scene
  // read-only — no login, no session. Falls back to a bare /scene link if the
  // uid is missing for any reason.
  const ctaUrl = recipientUid
    ? `https://channel-app.com/scene?u=${encodeURIComponent(Buffer.from(recipientUid).toString("base64url"))}`
    : "https://channel-app.com/scene";
  // No-history (fallback) emails are HEADED "Explore the scene" (the featured
  // grid), so the redundant bottom "Explore the scene" button is dropped there.
  const ctaHtml = isFallback
    ? ""
    : `
    <div style="margin-top: 28px; text-align: center;">
      <a href="${ctaUrl}" style="${BUTTON_STYLE}">Explore the scene</a>
    </div>
  `;

  const content = `
    ${topBlocks}
    ${block3}
    ${ctaHtml}
  `;

  try {
    // No-history (fallback) users haven't listened yet, so "Your Weekly Listening"
    // reads wrong — use the discovery-framed subject that mirrors their section
    // heading ("Featured this week").
    const subject = isFallback ? "Featured this week" : "Your Weekly Listening";
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      // Tighter side margins (matches the Monday newsletter) for more card width.
      html: wrapEmailContent(content, "", undefined, undefined, 6),
      headers: getUnsubscribeHeaders("marketing"),
    });
    if (error) {
      console.error("Error sending weekly recommendations email:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending weekly recommendations email:", error);
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
  isResident?: boolean; // monthly/quarterly resident — softer, warmer reminder
  signInMethod?: string; // DJ's recorded sign-in method → personalized footer reminder
  signInEmail?: string; // email to show in that reminder (omitted for Apple)
}

export async function sendBroadcast48HourReminderEmail({
  to,
  djName,
  showName,
  startTime,
  timeRange,
  isResident = false,
  signInMethod,
  signInEmail,
}: BroadcastReminderEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  // Residents (monthly/quarterly) already know the ropes — drop the
  // setup/test/share checklist and keep just the show-presentation nudge.
  const checklistRows = isResident
    ? `
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; <strong>Pick a strong image and a good show name.</strong> It's what people see first, and it shapes how your show stands out.</td>
            </tr>`
    : `
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; <strong>Pick a strong image and a good show name.</strong> It's what people see first, and it shapes how your show stands out.</td>
            </tr>
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; Test your audio setup by doing a short recording</td>
            </tr>
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; Click "Prepare to go live" ahead of time to avoid any surprises</td>
            </tr>
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; Share it on IG and tag us <a href="https://www.instagram.com/channelrad.io" style="color: #555; text-decoration: underline;">@channelrad.io</a></td>
            </tr>`;

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 14px; color: #666;">
            Hi ${djName},
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border: 1px solid #e5e5e5; margin-bottom: 24px;">
            <tr>
              <td style="padding: 16px;">
                <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #1a1a1a;">${showName}</p>
                <p style="margin: 0 0 2px; font-size: 14px; color: #1a1a1a;">${startTime}</p>
                <p style="margin: 0; font-size: 14px; color: #1a1a1a;">${timeRange}</p>
              </td>
            </tr>
          </table>
          <p style="margin: 0 0 4px; font-size: 14px; color: #1a1a1a;">
            Use the studio to get set up: <a href="https://channel-app.com/studio" style="color: #555; font-size: 14px; text-decoration: underline;">channel-app.com/studio</a>
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 12px 0 0;">${checklistRows}
          </table>
          <p style="margin: 24px 0 12px; font-size: 14px; color: #666;">
            Something come up? No stress, just let me know.
          </p>
          <p style="margin: 0; font-size: 14px; color: #666;">
            I'd much rather reschedule than have you feel pressured to make it happen. The priority is always for you to be in a good place and genuinely excited about doing the show.
          </p>
          <p style="margin: 24px 0 0; font-size: 14px; color: #1a1a1a;">
            Cap
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL_DJ,
      to,
      subject: isResident ? `Looking forward to your show` : `Test your audio set up, please`,
      html: wrapEmailContent(content, "You're receiving this because you have a scheduled show on Channel Radio." + signInReminderHtml(signInMethod, signInEmail)),
      headers: getUnsubscribeHeaders("dj"),
    });

    if (error) {
      console.error("Error sending broadcast 48h reminder email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending broadcast 48h reminder email:", error);
    return false;
  }
}

// ── 1-Week Reminder Email ───────────────────────────────────────────

export async function sendBroadcast1WeekReminderEmail({
  to,
  djName,
  showName,
  startTime,
  timeRange,
  signInMethod,
  signInEmail,
}: BroadcastReminderEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 14px; color: #666;">
            Hi ${djName},
          </p>
          <p style="margin: 0 0 20px; font-size: 14px; color: #666;">
            Quick reminder — you're live on Channel in 1 week.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border: 1px solid #e5e5e5;">
            <tr>
              <td style="padding: 16px;">
                <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #1a1a1a;">${showName}</p>
                <p style="margin: 0 0 2px; font-size: 14px; color: #1a1a1a;">${startTime}</p>
                <p style="margin: 0; font-size: 14px; color: #1a1a1a;">${timeRange}</p>
              </td>
            </tr>
          </table>
          <p style="margin: 24px 0 12px; font-size: 14px; color: #666;">
            Something come up? No stress, just let me know.
          </p>
          <p style="margin: 0; font-size: 14px; color: #666;">
            I'd much rather reschedule than have you feel pressured to make it happen. The priority is always for you to be in a good place and genuinely excited about doing the show.
          </p>
          <p style="margin: 24px 0 0; font-size: 14px; color: #1a1a1a;">
            Cap
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL_DJ,
      to,
      subject: `Your show is in 1 week`,
      html: wrapEmailContent(content, "You're receiving this because you have a scheduled show on Channel Radio." + signInReminderHtml(signInMethod, signInEmail)),
      headers: getUnsubscribeHeaders("dj"),
    });

    if (error) {
      console.error("Error sending broadcast 1-week reminder email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending broadcast 1-week reminder email:", error);
    return false;
  }
}

// Nudge a monthly-resident DJ who hasn't played recently and has nothing on
// the calendar to book their next show. Personal, from Cap. Single CTA to the
// studio scheduling page. Footer is the DJ-insiders category so the existing
// one-click unsubscribe applies.
export async function sendResidentRescheduleEmail({
  to,
  djName,
  signInMethod,
  signInEmail,
}: {
  to: string;
  djName: string;
  signInMethod?: string;
  signInEmail?: string;
}) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const studioUrl = "https://channel-app.com/studio";

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 14px; color: #666;">
            Hi ${djName},
          </p>
          <p style="margin: 0 0 20px; font-size: 14px; color: #666;">
            It's been a few weeks since your last show.
          </p>
          <p style="margin: 0 0 4px; font-size: 14px; color: #666;">
            Whenever you're ready, you can schedule your next broadcast or upload a pre-recorded show here:
          </p>
          <p style="margin: 0 0 24px; font-size: 14px;">
            <a href="${studioUrl}" style="color: #1a1a1a; text-decoration: underline;">channel-app.com/studio</a>
          </p>
          <p style="margin: 0; font-size: 14px; color: #666;">
            Looking forward to hearing what you've been working on.
          </p>
          <p style="margin: 24px 0 0; font-size: 14px; color: #1a1a1a;">
            Cap
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL_DJ,
      to,
      subject: `Ready for your next show?`,
      html: wrapEmailContent(content, "You're receiving this as a resident on Channel." + signInReminderHtml(signInMethod, signInEmail)),
      headers: getUnsubscribeHeaders("dj"),
    });

    if (error) {
      console.error("Error sending resident reschedule email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending resident reschedule email:", error);
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
  signInMethod,
  signInEmail,
}: BroadcastReminderEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f5f5f5; border-radius: 0; border: 1px solid #e5e5e5;">
      <tr>
        <td style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 14px; color: #666;">
            Hi ${djName},
          </p>
          <p style="margin: 0 0 20px; font-size: 14px; color: #666;">
            Your show is coming up soon — time to get set up!
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border: 1px solid #e5e5e5; margin-bottom: 24px;">
            <tr>
              <td style="padding: 16px;">
                <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #1a1a1a;">${showName}</p>
                <p style="margin: 0 0 2px; font-size: 14px; color: #1a1a1a;">${startTime}</p>
                <p style="margin: 0; font-size: 14px; color: #1a1a1a;">${timeRange}</p>
              </td>
            </tr>
          </table>
          <p style="margin: 0 0 4px; font-size: 14px; color: #1a1a1a;">
            Use your broadcast link to get set up:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 12px 0 0;">
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; Check your audio levels before going live and during your show. <strong>If the signal gets too hot, it WILL cause clipping and glitches in the recording.</strong></td>
            </tr>
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; Select Stereo stream optimization if you're sending a stereo signal from your interface.</td>
            </tr>
            <tr>
              <td style="padding: 4px 0 4px 16px; font-size: 14px; color: #1a1a1a;">&#8226; Reach out if you have any questions or doubts: email, channel chat, text, or IG. I'll be here, locked in with you.</td>
            </tr>
          </table>
          <p style="margin: 24px 0 12px; font-size: 14px; color: #666;">
            Using a different computer today? Your private broadcast link works without logging in. Just open the link below and you're ready to stream.
          </p>
          <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 8px;">
            <tr>
              <td style="background: #1a1a1a; padding: 12px 20px;">
                <a href="${broadcastUrl}" style="color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-block;">Open your broadcast link</a>
              </td>
            </tr>
          </table>
          <p style="margin: 0; font-size: 12px; color: #888; word-break: break-all;">
            <a href="${broadcastUrl}" style="color: #888; text-decoration: underline;">${broadcastUrl}</a>
          </p>
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
      html: wrapEmailContent(content, "You're receiving this because you have a scheduled show on Channel Radio." + signInReminderHtml(signInMethod, signInEmail)),
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

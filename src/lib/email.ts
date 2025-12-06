import { Resend } from "resend";

// Initialize Resend only if API key is available
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Channel <djshows@channel-app.com>";

interface ShowStartingEmailParams {
  to: string;
  showName: string;
  djName?: string;
  stationName: string;
  listenUrl: string;
}

export async function sendShowStartingEmail({
  to,
  showName,
  djName,
  stationName,
  listenUrl,
}: ShowStartingEmailParams) {
  if (!resend) {
    console.warn("Email service not configured - skipping email");
    return false;
  }

  const displayName = djName || showName;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${displayName} is live now on ${stationName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; }
            .header { margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #fff; }
            .content { background: #111; border-radius: 12px; padding: 30px; margin-bottom: 20px; }
            h1 { margin: 0 0 8px; font-size: 22px; }
            .station { color: #888; font-size: 14px; margin-bottom: 20px; }
            .show-name { color: #aaa; font-size: 14px; margin-bottom: 24px; }
            .listen-btn { display: inline-block; background: #fff; color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Channel</div>
            </div>
            <div class="content">
              <h1>${displayName} is live now</h1>
              <p class="station">${stationName}</p>
              ${djName ? `<p class="show-name">${showName}</p>` : ""}
              <a href="${listenUrl}" class="listen-btn">Listen Now</a>
            </div>
            <div class="footer">
              <p>You're receiving this because you saved this show.</p>
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings" class="unsubscribe">Manage notifications</a>
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

interface WatchlistDigestEmailParams {
  to: string;
  matches: Array<{
    showName: string;
    djName?: string;
    stationName: string;
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

  const matchesHtml = matches
    .map(
      (match) => `
      <div style="background: #1a1a1a; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
        <div style="font-weight: 600; margin-bottom: 4px;">${match.djName || match.showName}</div>
        <div style="color: #888; font-size: 13px;">${match.stationName} · ${new Date(match.startTime).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${new Date(match.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
        <div style="color: #666; font-size: 12px; margin-top: 8px;">Matched: "${match.searchTerm}"</div>
      </div>
    `
    )
    .join("");

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${matches.length} new show${matches.length > 1 ? "s" : ""} match your watchlist`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; margin: 0; padding: 40px 20px; }
            .container { max-width: 500px; margin: 0 auto; }
            .header { margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #fff; }
            .content { margin-bottom: 20px; }
            h1 { margin: 0 0 20px; font-size: 20px; }
            .browse-btn { display: inline-block; background: #fff; color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Channel</div>
            </div>
            <div class="content">
              <h1>New shows matching your watchlist</h1>
              ${matchesHtml}
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/djshows" class="browse-btn">Browse Shows</a>
            </div>
            <div class="footer">
              <p>You're receiving this because you have watchlist email notifications enabled.</p>
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings" class="unsubscribe">Manage notifications</a>
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

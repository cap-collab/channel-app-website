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
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings" class="unsubscribe">Unsubscribe</a>
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

  // Create URL with search query for first term
  const firstTerm = Object.keys(matchesByTerm)[0];
  const searchUrl = `${process.env.NEXT_PUBLIC_APP_URL}/djshows?search=${encodeURIComponent(firstTerm)}`;

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
            .browse-btn { display: inline-block; background: #fff; color: #000 !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
            .footer { color: #666; font-size: 12px; text-align: center; margin-top: 30px; }
            .unsubscribe { color: #666; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h1>New shows <span style="color: #888;">added to your favorites</span></h1>
              ${groupsHtml}
              <a href="${searchUrl}" class="browse-btn">View Shows</a>
            </div>
            <div class="footer">
              <p>These shows have been added to your favorites.</p>
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

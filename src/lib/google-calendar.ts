import { google, calendar_v3 } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not configured");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(state: string): string {
  const oauth2Client = getOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent", // Force consent to get refresh token
  });
}

export async function getTokensFromCode(
  code: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to get tokens from Google");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
  };
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error("Failed to refresh access token");
  }

  return {
    accessToken: credentials.access_token,
    expiresAt: new Date(credentials.expiry_date || Date.now() + 3600000),
  };
}

export function getCalendarClient(accessToken: string): calendar_v3.Calendar {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export async function createChannelCalendar(
  accessToken: string
): Promise<string> {
  const calendar = getCalendarClient(accessToken);

  // Check if "Channel Shows" calendar already exists
  const { data: calendarList } = await calendar.calendarList.list();

  const existingCalendar = calendarList.items?.find(
    (cal) => cal.summary === "Channel Shows"
  );

  if (existingCalendar?.id) {
    return existingCalendar.id;
  }

  // Create new calendar
  const { data: newCalendar } = await calendar.calendars.insert({
    requestBody: {
      summary: "Channel Shows",
      description: "Radio shows from Channel app",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });

  if (!newCalendar.id) {
    throw new Error("Failed to create calendar");
  }

  return newCalendar.id;
}

export interface ShowEvent {
  id: string;
  name: string;
  dj?: string;
  description?: string;
  stationName: string;
  stationUrl?: string;
  startTime: Date;
  endTime: Date;
}

export async function addShowToCalendar(
  accessToken: string,
  calendarId: string,
  show: ShowEvent
): Promise<string> {
  const calendar = getCalendarClient(accessToken);

  const title = show.dj ? `${show.dj} - ${show.stationName}` : `${show.name} - ${show.stationName}`;

  const { data: event } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: title,
      description: show.description || `${show.name}\n\nListen on ${show.stationName}`,
      location: show.stationUrl,
      start: {
        dateTime: show.startTime.toISOString(),
        timeZone: "UTC",
      },
      end: {
        dateTime: show.endTime.toISOString(),
        timeZone: "UTC",
      },
      extendedProperties: {
        private: {
          channelShowId: show.id,
        },
      },
    },
  });

  if (!event.id) {
    throw new Error("Failed to create calendar event");
  }

  return event.id;
}

export async function removeShowFromCalendar(
  accessToken: string,
  calendarId: string,
  showId: string
): Promise<void> {
  const calendar = getCalendarClient(accessToken);

  // Find event with matching showId
  const response = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [`channelShowId=${showId}`],
  });

  const events = response.data;
  if (events.items) {
    for (const event of events.items) {
      if (event.id) {
        await calendar.events.delete({ calendarId, eventId: event.id });
      }
    }
  }
}

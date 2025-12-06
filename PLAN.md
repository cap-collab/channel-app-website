# Channel Web App - Implementation Plan

## Overview
Build a web application that mirrors the mobile app experience with enhanced calendar/browsing capabilities, plus a radio station application portal. The web app will share the same Firebase backend and metadata as the mobile app.

---

## Architecture

### Tech Stack
- **Frontend:** Next.js 14 (App Router) with TypeScript
- **Styling:** Tailwind CSS
- **Backend:** Next.js API routes + Firebase
- **Database:** Firebase Firestore (existing project: `channel-97386`)
- **Auth:** Firebase Authentication (Google sign-in only)
- **Calendar:** Google Calendar API (server-side OAuth)
- **Email:** Resend (transactional emails)
- **Hosting:** Vercel (connects to existing `channel-app.com` domain)
- **Cron Jobs:** Vercel Cron (show reminders, token refresh, watchlist checks)
- **Metadata:** Existing GitHub-hosted JSON (`cap-collab.github.io/channel-metadata/metadata.json`)

### Repository Structure
Use the **existing website repository**: `channel-app-website`

- Replace current static HTML with Next.js app
- Keep same domain: `channel-app.com`
- Switch hosting from GitHub Pages → Vercel
- Independent from mobile app repo for licensing

```
channel-app-website/   # Existing repo, new Next.js content
├── src/
│   ├── app/
│   │   ├── page.tsx                        # Home - Radio calendar grid
│   │   ├── browse/page.tsx                 # "Who's playing what now?"
│   │   ├── my-shows/page.tsx               # User's favorited shows
│   │   ├── settings/page.tsx               # Notification & calendar settings
│   │   ├── apply/page.tsx                  # Radio station application form
│   │   ├── api/
│   │   │   ├── auth/google/route.ts        # Google OAuth initiation
│   │   │   ├── auth/google/callback/route.ts
│   │   │   ├── calendar/
│   │   │   │   └── events/route.ts         # Add/remove Google Calendar events
│   │   │   └── cron/
│   │   │       ├── show-reminders/route.ts # Every minute
│   │   │       ├── watchlist-check/route.ts # Every hour
│   │   │       └── refresh-tokens/route.ts  # Every 30 min
│   │   └── layout.tsx
│   ├── components/
│   │   ├── calendar/
│   │   │   ├── CalendarGrid.tsx            # Main container
│   │   │   ├── StationColumn.tsx           # 24h timeline per station
│   │   │   ├── ShowBlock.tsx               # Individual show (memoized)
│   │   │   ├── TimeAxis.tsx                # Time labels (sticky)
│   │   │   └── CurrentTimeIndicator.tsx
│   │   ├── SearchBar.tsx
│   │   ├── AuthModal.tsx
│   │   └── NotificationSettings.tsx
│   ├── hooks/
│   │   ├── useCalendarData.ts              # Metadata fetch + transform
│   │   ├── useFavorites.ts                 # Firestore sync
│   │   └── useAuth.ts
│   ├── lib/
│   │   ├── firebase.ts                     # Client config
│   │   ├── firebase-admin.ts               # Admin SDK for API routes
│   │   ├── metadata.ts                     # Fetch show schedules
│   │   ├── google-calendar.ts              # Google Calendar API
│   │   └── email.ts                        # Resend integration
│   └── types/
│       └── index.ts
├── vercel.json                             # Cron job configuration
├── public/
└── package.json
```

---

## URL Structure

Keep existing pages, add new ones:

| URL | Content | Status |
|-----|---------|--------|
| `/` | Landing page (logo, App Store link) | Keep as-is |
| `/djshows` | Radio calendar grid (web app) | NEW |
| `/apply` | Station application form | NEW |
| `/my-shows` | User's favorited shows | NEW |
| `/settings` | Notification & calendar settings | NEW |
| `/privacy` | Privacy policy | Keep as-is |
| `/terms` | Terms of use | Keep as-is |
| `/guidelines` | Community guidelines | Keep as-is |
| `/listen/[station]` | App deep links | Keep as-is |

**Navigation:** Add "Browse DJ Shows" and "Apply" buttons/links on landing page

---

## Page: Browse DJ Shows (`/djshows`)

### Features
1. **Calendar Grid View**
   - All 6 stations displayed as columns side-by-side
   - Horizontal scroll to see more stations
   - Each column shows 24-hour timeline (like mobile ScheduleView)
   - Current time indicator across all columns
   - Date navigation (today, tomorrow, next 7 days)

2. **Search Bar (top)**
   - Same search logic as mobile app (case-insensitive, matches show name + DJ)
   - Results highlight matching shows across all stations
   - "Add to Watch List" for custom search terms

3. **"Who's Playing What Now?" Button**
   - Opens browse mode showing only current shows
   - Each show card has "Pick this" → opens station website in new tab
   - Shows station accent colors and branding

4. **Show Interactions**
   - Click show → expand to see description
   - Heart/star button to favorite
   - On first favorite → prompt to sign up for sync features

5. **Sign-in Required For**
   - Adding a show to favorites
   - Adding a keyword to watchlist
   - Enabling email notifications
   - Enabling calendar sync
   - Prompt: "Sign in with Google to save favorites and get alerts"

### Data Flow
```
metadata.json (GitHub) → Next.js fetch → RadioCalendarGrid component
                                      ↓
                         StationColumn (per station)
                                      ↓
                         ShowCard (per show)
```

---

## Tab 2: Radio Station Application Form

### Fields Required
1. **Station Name** (text)
2. **Instagram Logo** (file upload → Firebase Storage)
3. **Accent Color** (color picker)
4. **Stream URL** (text, validated)
5. **Online Schedule URL** (text)
6. **Contact Email** (text)
7. **Why feature on Channel?** (textarea, optional)

### Submission Flow
1. Form validates all fields
2. Uploads logo to Firebase Storage
3. Creates document in Firestore `station-applications` collection
4. Sends notification email to you (admin)
5. Shows confirmation to applicant

---

## User Authentication & Accounts

### Firebase Auth Setup
- Enable Google provider in existing Firebase project
- Web client configuration in Next.js
- Sign-in triggers on: favorite, watchlist add, notification/calendar settings

### Firestore Data Model

```typescript
// Collection: users/{userId}
interface UserDocument {
  email: string;
  displayName: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  timezone: string;

  // Google Calendar (encrypted tokens)
  googleCalendar?: {
    accessToken: string;      // Encrypted
    refreshToken: string;     // Encrypted
    expiresAt: Timestamp;
    calendarId: string;       // "Channel Shows" calendar ID
  };

  // Notification preferences
  emailNotifications: {
    showStarting: boolean;    // Email when show starts NOW
    watchlistMatch: boolean;  // Daily digest of new matches (max 1/day)
  };
  lastWatchlistEmailAt?: Timestamp;  // Track daily limit
}

// Subcollection: users/{userId}/favorites/{favoriteId}
interface FavoriteDocument {
  term: string;               // Show name, DJ name, or search term
  type: 'show' | 'dj' | 'search';
  showName?: string;          // For display when not in schedule
  djName?: string;
  stationId?: string;
  createdAt: Timestamp;
  createdBy: 'web' | 'ios';   // For cross-platform sync
}

// Collection: scheduledNotifications/{id}
interface ScheduledNotification {
  userId: string;
  showId: string;
  showName: string;
  stationId: string;
  notifyAt: Timestamp;        // 5 min before show
  sent: boolean;
}

// Collection: station-applications/{id}
interface StationApplication {
  stationName: string;
  logoUrl: string;            // Firebase Storage URL
  accentColor: string;
  streamUrl: string;
  scheduleUrl: string;
  contactEmail: string;
  message?: string;
  submittedAt: Timestamp;
  status: 'pending' | 'approved' | 'rejected';
}
```

---

## Calendar Sync System (Google Calendar Only)

### Google Calendar Integration (Server-Side OAuth)
1. User clicks "Connect Google Calendar" → redirects to `/api/auth/google`
2. Google OAuth with `offline` access (for refresh tokens) + calendar scope
3. Callback stores encrypted tokens in Firestore
4. Creates "Channel Shows" calendar in user's Google account
5. When user favorites a show → add events via Google Calendar API
6. Cron job refreshes tokens every 30 minutes before expiry

### Calendar Event Format
```
Title: "DJ Shadow - NTS 1"
Start: 2025-12-07T14:00:00Z
End: 2025-12-07T16:00:00Z
Description: "Show description..."
Location: https://nts.live
```

---

## Email Notification System

### Email Types
1. **Show Starting NOW**
   - Sent when favorited show starts (not before)
   - "DJ Shadow is live now on NTS 1"
   - Link to listen on web

2. **Daily Watchlist Digest** (max 1 email per day)
   - Sent once daily when new matches found
   - Summarizes ALL new matches since last email
   - "3 new shows match your watchlist"
   - List of shows with one-click add to favorites

### Vercel Cron Jobs (vercel.json)
```json
{
  "crons": [
    { "path": "/api/cron/show-reminders", "schedule": "* * * * *" },
    { "path": "/api/cron/watchlist-digest", "schedule": "0 10 * * *" },
    { "path": "/api/cron/refresh-tokens", "schedule": "*/30 * * * *" }
  ]
}
```

### Watchlist Digest Logic
- Runs daily at 10am UTC
- For each user with `emailNotifications.watchlistMatch: true`:
  - Skip if `lastWatchlistEmailAt` is today
  - Find all new schedule matches since `lastWatchlistEmailAt`
  - If matches found: send digest email, update `lastWatchlistEmailAt`

---

## Notification Settings Page

### Options
1. **Calendar Sync**
   - Connected calendar type (Google/Apple/.ics)
   - "Disconnect" / "Reconnect" buttons
   - Toggle: Auto-add new favorites to calendar

2. **Email Notifications**
   - Toggle: Email when show is starting
   - Toggle: Email when new watchlist match found
   - Toggle: Weekly digest

3. **My Shows Link**
   - Quick access to favorited shows view

---

## My Shows Page

### Features
- List of all favorited shows grouped by date (like mobile)
- Search within favorites
- Remove from favorites
- Shows "Watch List" keywords
- Calendar sync status indicator

---

## Implementation Phases

### Phase 1: Foundation
1. Initialize Next.js project with TypeScript + Tailwind
2. Set up Firebase client SDK
3. Create metadata fetching service
4. Build basic layout with navigation

### Phase 2: Calendar Grid (Main Feature)
1. Build RadioCalendarGrid component
2. Build StationColumn with timeline
3. Build ShowCard with expand/collapse
4. Add search functionality
5. Add "Who's Playing What Now?" browse mode

### Phase 3: Authentication
1. Configure Firebase Auth (Google + Apple)
2. Build AuthModal component
3. Create user document on first sign-in
4. Add favorites persistence to Firestore

### Phase 4: Calendar Sync
1. Implement Google Calendar API integration
2. Build .ics feed generator endpoint
3. Create calendar management UI
4. Test sync flow end-to-end

### Phase 5: Email Notifications
1. Set up email service (Resend)
2. Build notification preferences UI
3. Create email templates
4. Set up scheduled jobs for "show starting" emails

### Phase 6: Station Application Form
1. Build multi-step form
2. Implement file upload to Firebase Storage
3. Create Firestore submission logic
4. Add admin notification

### Phase 7: Deployment
1. Configure Vercel project
2. Set up environment variables
3. Connect to channel-app.com domain (new routes or subdomain)
4. Test production deployment

---

## Key Files to Reference

### Mobile App (for parity)
- [Station.swift](Channel/Models/Station.swift) - Station config (colors, URLs)
- [Show.swift](Channel/Models/Show.swift) - Show model with timezone parsing
- [Metadata.swift](Channel/Models/Metadata.swift) - Metadata structure
- [MyShowsPopupView.swift](Channel/Views/MyShowsPopupView.swift) - Favorites UI
- [ScheduleView.swift](Channel/Views/ScheduleView.swift) - Timeline view
- [StarredShowMetadata.swift](Channel/Models/StarredShowMetadata.swift) - Matching logic

### Metadata
- `https://cap-collab.github.io/channel-metadata/metadata.json`
- [update-metadata.js](scripts/update-metadata.js) - Fetcher script

### Firebase
- [GoogleService-Info.plist](Channel/GoogleService-Info.plist) - Project config
- Project ID: `channel-97386`

---

## Mobile App Sync (Future)

When ready to sync favorites between web and iOS:

1. iOS app adds Firebase Auth (Google + Apple sign-in)
2. On sign-in, merge local `UserDefaults` favorites with Firestore
3. Add Firestore listener for real-time sync
4. Favorites subcollection tracks `createdBy: 'web' | 'ios'` for conflict resolution

---

## Key Considerations

- **Performance:** Calendar grid uses CSS Grid (1px/minute), React.memo, intersection observer for virtualization
- **Security:** Google OAuth tokens encrypted at rest, ICS tokens are secret (warn users not to share)
- **Offline:** Allow browsing without sign-in, prompt for account when favoriting
- **Timezone:** All times stored as UTC, displayed in user's local timezone

---

## Environment Variables Required

```
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=channel-97386
FIREBASE_ADMIN_PRIVATE_KEY=

# Google OAuth (for Calendar API)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Email
RESEND_API_KEY=

# Cron Security
CRON_SECRET=

# Encryption
ENCRYPTION_KEY=
```

---

## Open Questions Resolved
- ✅ Tech stack: Next.js 14 (which IS React) + Tailwind + Firebase
- ✅ Hosting: Vercel
- ✅ Repository: Existing `channel-app-website` repo - replace static HTML with Next.js
- ✅ Auth: Firebase with Google sign-in only
- ✅ Calendar: Google Calendar API only (no Apple/.ics for now)
- ✅ Favorites: Firestore subcollection (syncs across devices when logged in)
- ✅ Sign-in required for: favorites, watchlist, notifications, calendar sync
- ✅ Emails: Show starting NOW (not before), daily watchlist digest (max 1/day)
- ✅ Station application: name, IG logo, accent color, stream URL, schedule URL, contact email

## Tech Stack Notes
- **Next.js = React** with server-side rendering, routing, and API routes built-in
- **Resend** - Simple email API, free tier 3k emails/month, built for Vercel
- **Vercel Cron** - Built into Vercel hosting, no extra service needed

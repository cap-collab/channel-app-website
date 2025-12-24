# Channel Broadcast - MVP Plan

**Repo:** `cap-collab/channel-app-website` (add to existing channel-app.com website)
**URL:** `channel-app.com/broadcast` (radio portal for station owners & DJs)

## Goal
Build a web platform for venues/DJs to run radio live streams with:
1. **Scheduling** - Program content across time slots
2. **Audio capture** - Ingest from RTMP (OBS) + pre-recorded files
3. **Stream distribution** - Single public HLS stream URL

**Strategy**: Solid MVP for one pilot client → scale to multi-tenant SaaS

---

## Chosen Solution: LiveKit Cloud (→ Self-Hosted Later)

After comparing infrastructure options, **LiveKit** is the best fit:

| Your Need | How LiveKit Delivers |
|-----------|---------------------|
| **Anyone can stream** | Browser-based WHIP streaming - no OBS needed! DJs just click "Go Live" in your web app |
| **Control in your iOS app** | HLS egress gives you stream URLs you control. Play in AVPlayer, add your UI/ads around it |
| **Monetization** | You own the infrastructure. Insert pre-roll/mid-roll ads, track listening minutes for rev share |
| **Multi-tenant SaaS** | Each venue/DJ = a LiveKit "room". Scale to thousands of concurrent streams |
| **Future-proof** | Add video streaming later, co-host features, mobile broadcasting |

**Migration path**: Start with LiveKit Cloud (free tier), move to self-hosted when scaling. Only 3 env vars change:
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

---

## Cost Comparison

| Approach | Monthly Cost (at scale: 24/7 to 1000 users) |
|----------|---------------------------------------------|
| **LiveKit Cloud** | ~$4,500/month |
| **LiveKit Self-Hosted** | ~$100/month (VPS + bandwidth) |
| **Liquidsoap + Icecast** | ~$15-30/month |

Start with Cloud, self-host when costs justify it.

---

## What We Build

### Web Dashboard (for Station Owner)
- Create/manage radio station
- Create schedule (calendar UI): "8-10pm = DJ Alice, 10pm-12am = DJ Bob"
- Invite DJs (email invite, they create account)

### DJ Portal (for DJs)
- See assigned time slots
- **Two ways to go live:**
  1. **Browser streaming** (laptop DJs): Click "Go Live" → browser captures system audio or audio input
  2. **RTMP streaming** (pro/club setups): Get personal stream key → use OBS or hardware encoder
- Live status indicator

### DJ Hardware Compatibility
| Setup | Streaming Method |
|-------|------------------|
| Laptop + DJ software (Serato, Rekordbox, Traktor) | Browser - captures system audio |
| DJ controller + laptop | Browser - same as above |
| CDJs + mixer → audio interface → laptop | Browser - captures audio input |
| Standalone gear (no laptop) | RTMP via OBS on separate computer or hardware encoder |

### iOS App Integration
- Channel Media app already exists (separate repo)
- Just need to call `GET /api/stations/:id/stream` to get HLS URL
- Play HLS in AVPlayer

---

## Integration with channel-app-website

Add new routes under `/broadcast`:

```
channel-app-website/
├── app/
│   ├── ...existing pages...
│   └── broadcast/              # NEW: Radio portal
│       ├── page.tsx            # Landing/dashboard
│       ├── station/
│       │   └── [id]/
│       │       ├── page.tsx    # Station dashboard
│       │       ├── schedule/   # Schedule management
│       │       └── djs/        # DJ management
│       ├── dj/
│       │   └── [id]/
│       │       └── page.tsx    # DJ portal (Go Live button)
│       └── live/
│           └── [stationId]/
│               └── page.tsx    # Public listener page
├── components/
│   └── broadcast/              # NEW: Broadcast-specific components
│       ├── LiveButton.tsx
│       ├── ScheduleCalendar.tsx
│       └── AudioPlayer.tsx
├── lib/
│   └── livekit/                # NEW: LiveKit client helpers
└── infrastructure/             # NEW: LiveKit server configs (or separate repo)
    ├── docker-compose.yml
    └── livekit/
```

---

## Implementation Order (2-Week Pilot)

### Week 1: Prove the Audio Pipeline

**Day 1-2: LiveKit Cloud Setup**
- [x] Sign up for LiveKit Cloud
- [ ] Create a project (NOT an agent)
- [ ] Get API keys
- [ ] Test: can we connect to the server?

**Day 3-4: Browser Streaming Test**
- [ ] Create simple HTML page with LiveKit JS SDK
- [ ] Test: DJ streams audio from browser → LiveKit room
- [ ] Verify audio quality, latency

**Day 5-6: HLS Egress**
- [ ] Configure HLS egress output
- [ ] Test: browser audio → LiveKit → HLS URL
- [ ] Play HLS in VLC / browser to verify

**Day 7: iOS Integration Test**
- [ ] Add HLS stream URL to Channel Media app
- [ ] Test playback on real device
- [ ] **Milestone: End-to-end audio working!**

### Week 2: Web App + Scheduling

**Day 8-9: Database + Routes**
- [ ] Add broadcast tables to existing database (stations, schedules)
- [ ] Create `/broadcast` routes in channel-app-website
- [ ] (Auth already exists)

**Day 10-11: DJ Portal**
- [ ] DJ login page
- [ ] "Go Live" button (connects to LiveKit)
- [ ] Show current schedule slot

**Day 12-13: Station Owner Dashboard**
- [ ] Create schedule (simple time slots)
- [ ] Assign DJs to slots
- [ ] View who's currently live

**Day 14: Polish + Pilot Launch**
- [ ] Test with real pilot DJ
- [ ] Fix bugs
- [ ] **Launch pilot!**

---

## Post-Pilot (Future)

- [ ] Fallback audio when no DJ is live
- [ ] Listener analytics
- [ ] Multi-tenant (multiple stations)
- [ ] Monetization / ad insertion
- [ ] Rev share calculations

---

## DJ Chat Feature (NEW)

Enable DJs to chat with iOS listeners during their broadcast, with visual DJ identification and promo links.

### Summary
- **Web (no login required):** DJ goes live → auto-assigned username (editable) → can chat immediately
- **iOS (login required):** DJ must log into Channel on web to link their account → then can chat as DJ on iOS too
- DJ messages show a vinyl record icon badge to identify them as the playing DJ
- One promo link per set (pinned at top of chat + shown in timeline)

### DJ Onboarding Flow
1. **Account Prompt** - Login with Google/Apple or continue as guest
2. **Audio Setup** - Existing flow (system audio / device / RTMP)
3. **DJ Profile Setup** - Username + optional promo link
4. **Go Live** - Chat panel visible, can edit promo if not posted

### Multi-DJ Shows (Handoff)
- When DJ slot changes, new DJ sees "Claim your slot" prompt
- Each DJ can update the promo link once during their slot
- Previous DJ loses DJ badge, new DJ gains it

### Data Model Changes

**BroadcastSlot (add fields):**
```typescript
liveDjUserId?: string;        // Firebase UID
liveDjUsername?: string;      // Chat username
showPromoUrl?: string;        // Default promo for show
showPromoTitle?: string;

// For multi-DJ, extend djSlots:
djSlots?: {
  ...existing fields,
  liveDjUserId?: string;
  liveDjUsername?: string;
  promoUrl?: string;          // DJ-specific promo
  promoTitle?: string;
}[]
```

**ChatMessage (add fields):**
```typescript
isDJ?: boolean;
djSlotId?: string;
messageType?: 'chat' | 'promo';
promoUrl?: string;
promoTitle?: string;
```

### New Files (Web)
- `src/components/broadcast/DJAccountPrompt.tsx`
- `src/components/broadcast/DJProfileSetup.tsx`
- `src/components/broadcast/DJSlotClaim.tsx`
- `src/components/broadcast/DJChatPanel.tsx`
- `src/hooks/useDJChat.ts`
- `src/app/api/broadcast/dj-username/route.ts`
- `src/app/api/broadcast/dj-promo/route.ts`

### New Files (iOS)
- `Channel/Views/DJBadge.swift`
- `Channel/Views/PromoLinkCard.swift`

### Updated Files
- `firestore.rules`
- `src/components/broadcast/LiveIndicator.tsx`
- `src/app/broadcast/live/BroadcastClient.tsx`
- `src/app/broadcast/[venue]/VenueClient.tsx`
- `Channel/Models/ChatMessage.swift`
- `Channel/Views/ChatMessageRow.swift`
- `Channel/Views/ChatRoomView.swift`
- `Channel/Services/ChatService.swift`

### Implementation Order
1. Data model - Add fields to BroadcastSlot and ChatMessage
2. Firestore rules - Allow new fields
3. Backend APIs - dj-username and dj-promo routes
4. Web onboarding - DJAccountPrompt, DJProfileSetup
5. Web DJ chat - DJChatPanel, useDJChat hook
6. iOS display - DJBadge, PromoLinkCard
7. iOS DJ detection - ChatService checks if user is DJ

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ RTMP (OBS) or   │────▶│   LiveKit       │────▶│  HLS Egress     │──▶ Public Stream
│ Browser (WHIP)  │     │   Cloud/Server  │     │  (or RTMP out)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │   Next.js Web App   │
                    │   (scheduling, UI)  │
                    │   + PostgreSQL + S3 │
                    └─────────────────────┘
```

---

## Environment Variables (to add)

```
# LiveKit (Cloud for now, self-hosted later)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

---

## LiveKit Cloud Setup Guide

### Step 1: Create a Project (NOT an Agent)

When you log into LiveKit Cloud at https://cloud.livekit.io:

1. Look for **"Projects"** or **"Dashboard"** in the left sidebar (NOT "Build your first agent")
2. The agent builder is for AI voice agents - that's not what we need
3. We need a regular LiveKit **project** for WebRTC streaming

If you only see the agent builder:
- Look for a dropdown menu at the top showing project names
- Or look for "Settings" → "Projects"
- Or try going to https://cloud.livekit.io/projects directly

### Step 2: Get API Keys

Once you have a project:
1. Go to project Settings
2. Find API Keys section
3. Copy `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

### Step 3: Test Connection

We'll create a simple test page to verify the connection works.

---

## Resources

- [LiveKit GitHub](https://github.com/livekit/livekit)
- [LiveKit JS SDK](https://docs.livekit.io/client-sdks/javascript/)
- [LiveKit Egress docs](https://docs.livekit.io/home/egress/overview/)
- [LiveKit RTMP Ingress docs](https://docs.livekit.io/home/ingress/overview/)

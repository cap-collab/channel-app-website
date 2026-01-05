# DJ Username & Broadcast Architecture

This document explains how DJ usernames, chat usernames, and promo links work across different broadcast types.

---

## Quick Reference

| Broadcast Type | URL Pattern | Login Required | DJ Can Edit Username | Username Saved to Profile |
|----------------|-------------|----------------|---------------------|---------------------------|
| Venue Single DJ | `/broadcast/live?token=xxx` | No | ✅ Yes | ❌ No (ephemeral) |
| Venue Multi-DJ | `/broadcast/live?token=xxx` | No | ✅ Yes | ❌ No (ephemeral) |
| Remote DJ (guest) | `/broadcast/live?token=xxx` | No | ✅ Yes | ❌ No (ephemeral) |
| Remote DJ (logged in) | `/broadcast/live?token=xxx` | Yes | ❌ No - locked | Uses `chatUsername` |

---

## Broadcast Types

### 1. Venue Broadcasts (`broadcastType: 'venue'`)

**URL**: `/broadcast/live?token={uniqueToken}`

- **Token-based URL** - secure, one-time link sent to venue
- **Shared computer** - multiple DJs use the same device at the venue
- **No login required** - DJs just type their name and go live
- **Ephemeral usernames** - not saved to any profile
- **Venue journey** - includes venue permissions confirmation

#### Single DJ Venue
- One DJ per broadcast slot
- Username stored at: `broadcast-slots/{id}.liveDjUsername`
- Promo stored at: `broadcast-slots/{id}.showPromoUrl`

#### Multi-DJ Venue
- Multiple DJs in time-based slots within one broadcast
- Uses `djSlots[]` array with start/end times
- Each DJ slot has its own username and promo
- Username stored at: `broadcast-slots/{id}.djSlots[n].liveDjUsername`
- Promo stored at: `broadcast-slots/{id}.djSlots[n].promoUrl`

### 2. Remote Broadcasts (`broadcastType: 'remote'`)

**URL**: `/broadcast/live?token={uniqueToken}`

- **Unique token URL** - one-time link sent to DJ
- **Token expires** 1 hour after slot end time
- **DJ's own device** - more likely to be logged in
- **If logged in**: username locked to their `chatUsername`

---

## Username Rules

### Detection Logic

```typescript
const isRemoteDj = broadcastType === 'remote';
const isUsernameLocked = isAuthenticated && !!savedUsername && isRemoteDj;
```

### Venue DJs (Always Editable)

```
DJ opens page → Types any display name → Goes live
```

- Username is **always editable** (shared computer scenario)
- Username is **never saved** to user profile
- Username is **never registered** in `usernames` collection
- Each DJ slot can have a different name
- Stored only on the broadcast slot (ephemeral)

### Remote DJs (Conditional)

#### Guest Remote DJ (not logged in)
```
DJ opens page → Types display name → Goes live
```
- Same as venue DJ - editable, ephemeral

#### Logged-In Remote DJ
```
DJ opens page → Username pre-filled from profile → Can't edit → Goes live
```
- Username is **locked** to their `chatUsername`
- Displayed as read-only text, not input field
- Ensures consistent identity across chat and broadcast

---

## Promo Link Management

### Storage Locations

| Broadcast Type | Promo Storage | Promo Title Storage |
|----------------|---------------|---------------------|
| Single DJ | `slot.showPromoUrl` | `slot.showPromoTitle` |
| Multi-DJ | `djSlots[n].promoUrl` | `djSlots[n].promoTitle` |
| Remote DJ | `slot.showPromoUrl` | `slot.showPromoTitle` |

### Promo Flow

1. **Initial Setup**: DJ enters promo URL during profile setup
2. **During Broadcast**: DJ can update promo via chat panel
3. **Multi-DJ**: Each DJ slot has independent promo URL
4. **Chat Display**: Promo appears as clickable card in chat

### API Endpoint

`POST /api/broadcast/dj-promo`
- Updates promo URL for current DJ
- For multi-DJ: finds active slot by time and updates that slot's promo
- Posts promo as chat message with `messageType: 'promo'`

---

## Data Storage

### Firestore Collections

#### `broadcast-slots/{id}`
```typescript
{
  // Broadcast info
  broadcastType: 'venue' | 'remote',
  broadcastToken: string,       // Unique token for the broadcast URL
  tokenExpiresAt?: Timestamp,

  // Schedule
  startTime: Timestamp,
  endTime: Timestamp,
  status: 'scheduled' | 'live' | 'paused' | 'completed' | 'missed',

  // Show info
  showName?: string,
  djName?: string,              // Scheduled DJ name (can be "TBD")

  // Live DJ info (set when going live)
  liveDjUsername?: string,      // Display name used during broadcast
  liveDjUserId?: string,        // Firebase UID (only if logged in)

  // Promo (single DJ)
  showPromoUrl?: string,
  showPromoTitle?: string,

  // Multi-DJ slots (optional)
  djSlots?: DJSlot[],
}
```

#### `broadcast-slots/{id}.djSlots[n]` (Multi-DJ)
```typescript
{
  id: string,
  djName?: string,              // Scheduled name
  startTime: number,            // Unix timestamp ms
  endTime: number,

  // Set when this DJ goes live
  liveDjUsername?: string,
  liveDjUserId?: string,
  promoUrl?: string,
  promoTitle?: string,
}
```

#### `users/{uid}`
```typescript
{
  chatUsername?: string,        // Persistent username for chat/DJ
  displayName?: string,         // From Google/Apple auth
  email?: string,
  lastSeenAt?: Timestamp,
}
```

#### `usernames/{normalizedUsername}`
```typescript
{
  displayName: string,          // Original casing (e.g., "DJCool")
  uid: string,                  // Firebase UID
  claimedAt: Timestamp,
}
```

---

## Username Registration Flow

### When Username Gets Registered

Username is registered in `usernames` collection ONLY when:
1. DJ is **logged in** (has Firebase UID)
2. DJ **goes live** (not during profile setup)
3. Username is not already claimed by someone else

### Registration Code (`/api/broadcast/go-live`)

```typescript
if (djUserId && djUsername) {
  // 1. Check if username available
  const usernameDoc = await db.collection('usernames').doc(normalized).get();
  if (!usernameDoc.exists || usernameDoc.data()?.uid === djUserId) {
    // 2. Claim username
    await usernameDocRef.set({
      displayName: djUsername,
      uid: djUserId,
      claimedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 3. Save to user profile
  await userRef.set({
    chatUsername: djUsername,
    lastSeenAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
```

---

## Chat Username vs DJ Display Name

### Listener Chat (`/channel`)

- Requires login (Firebase auth)
- Requires registered `chatUsername`
- If no `chatUsername`, shows username setup prompt
- Username stored in `users/{uid}.chatUsername`
- Registered in `usernames` collection for uniqueness

### DJ Chat (during broadcast)

- Uses `liveDjUsername` from broadcast slot
- DJ badge shown based on username match
- Promo links appear as special chat cards

### Merging DJ and Chat Username

When a **logged-in remote DJ goes live**:
1. Their DJ display name becomes their `chatUsername`
2. It's registered in `usernames` collection
3. Same username everywhere (chat + broadcast)

When a **venue DJ goes live**:
1. Username stored only on broadcast slot
2. NOT saved to any profile (ephemeral)
3. Each DJ can use different name per set

---

## Multi-DJ Slot Management

### Slot Detection

```typescript
const getCurrentDjSlot = () => {
  const now = Date.now();
  return slot.djSlots.find(dj =>
    now >= dj.startTime && now < dj.endTime
  );
};
```

### Slot Change Detection

- Checked every 1 second via interval
- When slot changes: reset username, promo, show profile setup again
- New DJ fills in their info for their slot

### Slot-Level vs Show-Level Storage

| Data | Single DJ | Multi-DJ |
|------|-----------|----------|
| Username | `slot.liveDjUsername` | `djSlot.liveDjUsername` |
| User ID | `slot.liveDjUserId` | `djSlot.liveDjUserId` |
| Promo URL | `slot.showPromoUrl` | `djSlot.promoUrl` |
| Promo Title | `slot.showPromoTitle` | `djSlot.promoTitle` |

---

## Validation Rules

### Username Validation (same as iOS app)

```typescript
function isValidUsername(username: string): boolean {
  const trimmed = username.trim();

  // Length: 2-20 characters
  if (trimmed.length < 2 || trimmed.length > 20) return false;

  // Alphanumeric only
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return false;

  // Reserved words
  const reserved = ['channel', 'admin', 'system', 'moderator', 'mod'];
  if (reserved.includes(trimmed.toLowerCase())) return false;

  return true;
}
```

### Promo URL Validation

- Must be valid URL (http:// or https://)
- Max 500 characters
- Optional field

### Promo Title Validation

- Max 100 characters
- Optional field

---

## Key Files

| File | Purpose |
|------|---------|
| `/src/components/broadcast/DJProfileSetup.tsx` | DJ profile form with username lock logic |
| `/src/components/channel/ListenerChatPanel.tsx` | Listener chat with username setup |
| `/src/app/api/broadcast/go-live/route.ts` | Goes live + registers username |
| `/src/app/api/chat/register-username/route.ts` | Listener username registration |
| `/src/app/api/broadcast/dj-promo/route.ts` | Promo URL management |
| `/src/hooks/useUserProfile.ts` | Fetches/sets chat username |
| `/src/app/broadcast/live/BroadcastClient.tsx` | Main broadcast page |
| `/src/types/broadcast.ts` | TypeScript types |

---

## Summary

1. **Venue DJs** = shared computer, ephemeral usernames, no login friction
2. **Remote DJs** = personal device, persistent username if logged in
3. **Chat username** = requires login, registered for uniqueness
4. **DJ display name** = can be ephemeral or linked to chat username
5. **Multi-DJ** = each slot has independent username/promo
6. **Promo links** = stored per-DJ for multi-DJ, per-show for single DJ

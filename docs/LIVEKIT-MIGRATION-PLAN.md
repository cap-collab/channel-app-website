# LiveKit Cost Optimization Plan

## Current Setup Summary

**You're using LiveKit Cloud** (`channel-0jfvb5vb.livekit.cloud`) for audio-only DJ radio streaming.

| Component | What You Have |
|-----------|---------------|
| Room | Single `channel-radio` room |
| Input | Browser audio capture + RTMP ingress (OBS) |
| Output | HLS egress → Cloudflare R2 |
| Clients | Web (React) + iOS (Swift SDK) |
| Features | Multi-DJ slots, listener presence, BPM analysis |

---

## Cost Analysis: Where You're Spending Money

### LiveKit Cloud Pricing Tiers
| Plan | Cost | Minutes | Bandwidth |
|------|------|---------|-----------|
| Build (Free) | $0 | 5,000 | 50GB |
| Ship | $50/mo | 150,000 | 250GB |
| Scale | $500/mo | 1.5M | 3TB |

### Your Usage Pattern (Audio-Only Radio)
- **1 DJ publisher** + **N listeners** per broadcast
- Audio bitrate: ~128-192 kbps (much lighter than video)
- Bandwidth per listener/hour: ~60-90 MB

### Cost Projection at Scale
| Listeners | Hours/Day | Monthly Cost (Est.) |
|-----------|-----------|---------------------|
| 10 | 4 | $50-100 |
| 50 | 4 | $100-200 |
| 100 | 4 | $200-400 |
| 500 | 4 | $500+ (Scale plan) |
| 1000+ | 4 | $1000+ |

---

## Options to Save Cost

### Option 1: Switch to Cloudflare Stream
**Savings: 50-80%**

You're already using Cloudflare R2 for HLS storage. Cloudflare Stream would simplify your stack.

**Pricing:**
- Storage: $5/1,000 minutes
- Delivery: $1/1,000 minutes
- RTMP ingress: FREE
- Encoding: FREE

**For 100 listeners, 4 hrs/day:**
- ~$20-40/month vs $200+ on LiveKit

**Pros:**
- Already in Cloudflare ecosystem (R2)
- Simple pricing, no participant-minute model
- Good for broadcast (1-to-many)

**Cons:**
- Higher latency (HLS = 2-10 seconds)
- Less interactive features
- No native WebRTC (affects iOS BPM analysis)

**Migration effort:** 2-3 weeks

---

### Option 2: Self-Host LiveKit
**Savings: 70-90% at scale**

LiveKit is open-source. You can run it on your own infrastructure.

**Estimated costs:**
- Small VPS (10 listeners): $10-20/month
- Medium server (100 listeners): $50-100/month
- Auto-scaling setup (1000+): $200-500/month

**Pros:**
- Same codebase, minimal code changes
- Full control over infrastructure
- No per-minute billing

**Cons:**
- DevOps overhead (deployment, monitoring, scaling)
- You handle reliability/uptime
- Need TURN servers for NAT traversal

**Migration effort:** 1-2 weeks (infrastructure setup)

---

### Option 3: Switch to Amazon IVS
**Savings: 30-50%**

Best for pure broadcast scenarios.

**Pricing:**
- Pay-as-you-go, no minimums
- Free tier: 5hrs input + 100hrs SD output (first year)
- ~$0.20/hour for video output

**Pros:**
- AWS integration if you use AWS
- Good for one-way broadcasts
- Built-in recording

**Cons:**
- Less suitable for interactive features
- Different SDK architecture
- iOS SDK changes required

**Migration effort:** 3-4 weeks

---

### Option 4: Hybrid Approach (RECOMMENDED)
**Use LiveKit only for DJ → Server, then distribute via Cloudflare**

Current flow:
```
DJ → LiveKit Cloud → HLS Egress → R2 → Listeners
```

Optimized flow:
```
DJ → Self-hosted LiveKit (single instance) → HLS → Cloudflare Stream/R2 → Listeners
```

**Why this works:**
- LiveKit only handles 1 DJ connection (tiny cost)
- Cloudflare handles all listener distribution (cheap)
- You keep the same client code for DJs
- iOS listeners consume HLS (already works)

**Cost:** ~$20-50/month total at any scale

---

## Updated Scale: Multi-Channel Platform

**New requirements:**
- 500 broadcasters streaming 40 hours/week each
- 80,000+ streaming hours/month (broadcasters alone)
- Plus listeners per channel
- Multiple concurrent channels (not just one `channel-radio`)

---

## Cost Analysis at Scale

### LiveKit Cloud at This Scale

**Broadcaster minutes:** 500 users × 40 hrs × 4 weeks = 4.8M minutes/month
**Listener minutes:** If each stream averages 10 listeners = 48M minutes/month

| Plan | Included | Your Usage | Overage Cost |
|------|----------|------------|--------------|
| Scale ($500/mo) | 1.5M minutes | 50M+ minutes | ~$290,000/mo |

**LiveKit Cloud is NOT viable at this scale.** You'd pay enterprise rates.

### Self-Hosted LiveKit

**Infrastructure needed for 500 concurrent streams:**
- CPU: ~50-100 cores (audio-only is light)
- RAM: ~64-128 GB
- Bandwidth: ~500 Mbps - 2 Gbps

**Estimated monthly cost:**
| Provider | Specs | Cost |
|----------|-------|------|
| Hetzner Dedicated | AX102 (128GB, 16 cores) × 3 | ~$300/mo |
| AWS/GCP Auto-scale | Variable | $500-2000/mo |
| Bare metal cluster | 3-5 servers | ~$500/mo |

**Self-hosted savings: 99%+** ($500 vs $290,000)

---

## Architecture for Multi-Channel Platform

```
                    ┌─────────────────────────────────┐
                    │       Load Balancer             │
                    │   (Cloudflare/nginx/HAProxy)    │
                    └─────────────┬───────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│ LiveKit Node 1│       │ LiveKit Node 2│       │ LiveKit Node 3│
│ (channels 1-N)│       │ (channels N-M)│       │ (channels M-X)│
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Redis (room state)  │
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │ Egress 1 │      │ Egress 2 │      │ Egress 3 │
        │ (HLS)    │      │ (HLS)    │      │ (HLS)    │
        └────┬─────┘      └────┬─────┘      └────┬─────┘
             │                 │                 │
             └─────────────────┼─────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Cloudflare R2/CDN  │
                    │  (HLS distribution) │
                    └─────────────────────┘
```

### Key Components:

1. **LiveKit Cluster** (3-5 nodes)
   - Each node handles ~100-200 concurrent rooms
   - Redis for distributed state
   - Auto-routing via load balancer

2. **Egress Workers** (dedicated)
   - Separate servers for HLS generation
   - Prevents CPU spikes from affecting streams
   - Output to Cloudflare R2

3. **Cloudflare CDN** (listener distribution)
   - R2 for HLS storage
   - Workers for edge caching
   - Scales infinitely for listeners

---

## Recommendation: Self-Hosted LiveKit Cluster

At 500 broadcasters scale, **self-hosting is mandatory**. LiveKit Cloud would cost $200k+/month.

**Estimated self-hosted cost: $300-1000/month** (99%+ savings)

---

## Implementation Plan (Phased Approach)

### Phase 1: Single Node MVP (Start Here)

Start with one beefy server to validate the approach before scaling.

**1.1 Provision Initial Server**
```
Hetzner AX52 (~$85/mo):
- AMD Ryzen 7 (8 cores / 16 threads)
- 64 GB RAM
- 1 Gbps bandwidth
- Can handle ~50-100 concurrent streams
```

**1.2 Deploy LiveKit + Dependencies**
```bash
# Docker Compose setup
version: "3.9"
services:
  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7880:7880"   # HTTP API
      - "7881:7881"   # WebSocket
      - "7882:7882/udp"  # WebRTC UDP
    environment:
      - LIVEKIT_KEYS=APIkey: secretkey
      - LIVEKIT_CONFIG=/config/livekit.yaml
    volumes:
      - ./livekit.yaml:/config/livekit.yaml

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  egress:
    image: livekit/egress:latest
    environment:
      - EGRESS_CONFIG_FILE=/config/egress.yaml
    volumes:
      - ./egress.yaml:/config/egress.yaml
```

**1.3 Configure for Multi-Room**
```yaml
# livekit.yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true

redis:
  address: redis:6379

room:
  auto_create: true
  empty_timeout: 300  # 5 min cleanup
  max_participants: 1000
```

**1.4 TURN Server Setup**
```yaml
# Add to livekit.yaml
turn:
  enabled: true
  domain: turn.yourdomain.com
  tls_port: 5349
  udp_port: 3478
```

### Phase 2: Multi-Channel App Changes

**2.1 Dynamic Room Names**
Current: hardcoded `channel-radio`
New: dynamic per-channel rooms

```typescript
// src/types/broadcast.ts
// Change from:
export const BROADCAST_ROOM = "channel-radio";

// To:
export function getBroadcastRoom(channelId: string): string {
  return `channel-${channelId}`;
}
```

**2.2 Token API Update**
File: `src/app/api/livekit/token/route.ts`
```typescript
// Accept channelId parameter
const { room, username, canPublish, channelId } = await request.json();
const roomName = channelId ? `channel-${channelId}` : room;
```

**2.3 Egress Per Channel**
File: `src/app/api/livekit/egress/route.ts`
```typescript
// Output path includes channel ID
const outputPath = `${channelId}/stream`;
const hlsUrl = `${R2_PUBLIC_URL}/${channelId}/live.m3u8`;
```

**2.4 iOS Multi-Channel Support**
File: `LiveKitService.swift`
```swift
// Accept channel parameter
func connect(to channelId: String) async throws {
    let room = "channel-\(channelId)"
    // ... existing connection logic
}
```

### Phase 3: Scale to Cluster (When Needed)

**3.1 Add More Nodes**
When single server hits 70% CPU:
- Add 2nd LiveKit node
- Configure load balancing

**3.2 Kubernetes Deployment (Optional)**
For auto-scaling:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: livekit
spec:
  replicas: 3
  selector:
    matchLabels:
      app: livekit
  template:
    spec:
      containers:
      - name: livekit
        image: livekit/livekit-server
        resources:
          requests:
            cpu: "2"
            memory: "4Gi"
          limits:
            cpu: "4"
            memory: "8Gi"
```

**3.3 Geographic Distribution**
For global users:
- US region: Hetzner Ashburn or DigitalOcean NYC
- EU region: Hetzner Falkenstein
- DNS-based routing (Cloudflare Load Balancing)

### Phase 4: Monitoring & Operations

**4.1 Prometheus Metrics**
LiveKit exposes `/metrics` endpoint:
- `livekit_room_count` - active rooms
- `livekit_participant_count` - connected users
- `livekit_packet_loss` - stream quality

**4.2 Grafana Dashboard**
Monitor:
- CPU/RAM per node
- Active streams
- Bandwidth usage
- Error rates

**4.3 Alerting**
Set up alerts for:
- Server CPU > 80%
- Memory > 85%
- Error rate spike
- Node down

---

## Files to Modify

| File | Change |
|------|--------|
| `.env.*` | New self-hosted LiveKit URL + credentials |
| `src/types/broadcast.ts` | Dynamic room names per channel |
| `src/app/api/livekit/token/route.ts` | Accept channelId parameter |
| `src/app/api/livekit/egress/route.ts` | Per-channel HLS paths |
| `src/app/api/livekit/ingress/route.ts` | Per-channel RTMP endpoints |
| `src/hooks/useBroadcast.ts` | Pass channelId to room |
| `src/hooks/useBroadcastStream.ts` | Listen to channel-specific room |
| iOS `LiveKitService.swift` | Accept channel parameter |

---

## Cost Projection at Scale

| Scale | Infrastructure | Monthly Cost |
|-------|---------------|--------------|
| 50 concurrent streams | 1× Hetzner AX52 | ~$100/mo |
| 200 concurrent streams | 2× Hetzner AX52 | ~$200/mo |
| 500 concurrent streams | 3× Hetzner AX102 | ~$400/mo |
| 500 streams + egress | Cluster + egress workers | ~$600/mo |

**Plus Cloudflare costs (listener delivery):**
- R2 storage: $0.015/GB/month
- R2 egress: Free to Cloudflare CDN
- Workers (if needed): $5/mo base

**Total at full scale: ~$600-1000/month**
vs LiveKit Cloud: **$200,000+/month**

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Server failure | Streams drop | Multi-node cluster, auto-failover |
| Scaling too slow | Poor UX | Start with headroom, monitor closely |
| TURN/NAT issues | Mobile users can't connect | Use Cloudflare TURN or dedicated TURN |
| Egress bottleneck | HLS delays | Dedicated egress workers |
| DevOps overhead | Your time | Start simple, automate incrementally |

---

## Why Option 4 Is The Only Option You Need

Option 4 (self-hosted LiveKit + Cloudflare) **scales infinitely**. You never need to switch to something else - just add servers.

| Stage | Streams | Streamers | What to do | Cost |
|-------|---------|-----------|------------|------|
| **Start** | 3 | < 50 | 1 small VPS | ~$20/mo |
| **Growing** | 10-20 | 50-200 | 1 medium server | ~$100/mo |
| **Scale** | 50+ | 200-500 | 2-3 servers | ~$300/mo |
| **Big** | 100+ | 500+ | Cluster | ~$600/mo |

**When would you NOT use Option 4?**
- If you don't want to manage servers at all → pay for LiveKit Cloud
- If you drop iOS BPM requirement → could use pure Cloudflare Stream
- If you need enterprise SLA contracts → AWS IVS or managed services

For your case: **Start with Option 4 now and grow with it.**

---

## Start Simple: Phase 1

Since you're starting with just 3 streams and <500 streamers, here's your minimal viable setup:

**1. Single VPS (~$10-20/mo)**
```
DigitalOcean Droplet or Hetzner CX22:
- 2 vCPU, 4GB RAM
- Handles 10-20 concurrent streams easily
```

**2. Docker Compose (copy-paste ready)**
```yaml
version: "3.9"
services:
  livekit:
    image: livekit/livekit-server:latest
    restart: always
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"
    environment:
      - LIVEKIT_KEYS=your-api-key: your-secret
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml

  redis:
    image: redis:7-alpine
    restart: always
```

**3. Update your .env files**
```
LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-secret
```

**4. That's it.** Your existing code mostly works - just update env vars.

---

## Migration Path

1. **Now:** Keep LiveKit Cloud while setting up self-hosted
2. **Test:** Point a test environment to self-hosted, verify everything works
3. **Switch:** Update production env vars, deprecate LiveKit Cloud
4. **Later:** Add servers when you hit ~70% CPU on current one

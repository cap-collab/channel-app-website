# LiveKit upgrade — staged scripts (test during a multi-day no-show window)

Plan: `~/.claude/plans/make-a-recap-of-functional-starfish.md`. Server-first, then egress.
Targets: livekit-server 1.9.9→v1.13.2, egress 1.12.0→v1.13.0. Both tags confirmed pullable.
Rollback digests: server sha256:d8b1107d9234, egress sha256:30b3389518c8. Tags EXIST on registry.

## Run order (each `.sh` runs ON THE VPS root@5.161.252.231; heavy logs → /root/*-upgrade-*.log)
0. BASELINE first (from Mac): record a channelbroadcast test on CURRENT versions, then
   `npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts` → note the ❌ PERIODIC drop count.
1. STAGE A — server: `stage-a-upgrade-server.sh` (idle window). Then go live on channelbroadcast,
   run verify-live-and-archive.ts → confirm streaming + archive OK (drops likely STILL present; egress not upgraded yet).
   Bake 1-2 real shows. Rollback: `stage-a-rollback.sh /root/livekit-inspect-backup-<ts>.json`.
2. STAGE B — egress: `stage-b-upgrade-egress.sh` (idle window, after A proven). Then go live on
   channelbroadcast, run verify → confirm ✅ FIXED (drops gone). Rollback: `stage-b-rollback.sh`.

## verify-live-and-archive.ts (from Mac; READ-ONLY)
Deep-checks a test recording: archive doc fields (duration/URL/method/short-flag) + silencedetect
on the RAW EGRESS original for the ~21ms 10s-grid drops. Refuses to verdict on manual-upload files.
  npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts            # newest archive
  npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts --dj <name>
  npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts --id <archiveId>
Proven baseline: `--dj drench` → ❌ 90 micro-gaps, PERIODIC (mod-10≈5.2s). After egress upgrade a
fresh test should read ✅ FIXED.

## Watch-items during tests (see plan's Deep Risk Assessment)
Stage A (server): cold go-live timing, live→live handoff (duplicate-identity), device+stereo RED/DTX.
Stage B (egress): drops gone, no desync, HLS + handoff intact (Chrome 146), archive duration correct.

## ✅ STAGE A DONE — 2026-07-21 00:31 UTC (server 1.9.9 → v1.13.2)
Executed step-by-step. Backup: /root/livekit-inspect-backup-20260721T003101Z.json (rollback digest sha256:d8b1107d9234).
Verified LIVE on channelbroadcast (Cap heard clean audio, desktop WebRTC):
- livekit v1.13.2 Running restarts=0 restart=unless-stopped; egress v1.12.0 + ingress + redis reconnected clean (service ready).
- DJ publish: 700ms connect, mediaTrack published AUDIO/MICROPHONE, mime=audio/red audioFeatures=[TF_STEREO] (RED+stereo OK).
- Recording=track_composite/file (no fallback); HLS=room_composite/segments; live.m3u8 200.
- Token grant correct (RoomJoin/CanSubscribe true, CanPublish false, CanPublishData not-set).
- App control plane (room-status/listEgress/token) all 200 against v1.13.2.

### ⚠️ Benign new behavior on v1.13.2 (DO NOT re-chase):
livekit logs 3× "WARN error reading data channel ... dtls timeout" per web-listener (labels _lossy/_data_track/_reliable).
= v1.13.2 opens data channels by default (v1.11 feature); our app never uses data → they time out once (~3s), harmless.
PROVEN harmless: listener still went "participant active", stats worker isConnected=true, audio heard clean, ZERO media/audio transport errors, warns do NOT escalate (exactly 3, one per label). Cosmetic log noise only.

### NEXT: bake through 1-2 real shows (next week), THEN Stage B (egress → v1.13.0, the drop fix).
Before/after Stage B: run verify-live-and-archive.ts on a fresh channelbroadcast recording (proven baseline: --dj drench = ❌ 90 periodic drops).

## ✅ STAGE B DONE — 2026-07-21 00:38 UTC (egress 1.12.0 → v1.13.0)
Executed step-by-step, room idle (no shows for a week ahead). Backup: /root/egress-inspect-backup-20260721T003750Z.json (rollback digest sha256:30b3389518c8).
- egress v1.13.0 Running restarts=0; flags preserved (shm=1g, cap-add SYS_ADMIN, restart unless-stopped); clean startup (redis → cpu available 4.0 → service ready); no errors.
- Siblings untouched (livekit v1.13.2 / ingress / redis IDs unchanged, restarts=0). App control-plane healthy.

## FULL STACK NOW: livekit-server v1.13.2 + egress v1.13.0 + ingress v1.4.3.
Rollback anytime (idle window): stage-a-rollback.sh (server→1.9.9) / stage-b-rollback.sh (egress→1.12.0). Old images kept on box.

## MEASUREMENT (the real proof — per Cap: ~10% of shows had bad quality, watch if it drops)
The upgrade is the acknowledged fix (egress #1133 / v1.13.0 appwriter+PTS changes). Whether it fixes the intermittent
recording drops can ONLY be confirmed by real shows (drops are ~10% intermittent, per-DJ). After each real show next week:
  npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts --dj <name>
→ reports ✅ FIXED (no ~21ms 10s-grid drops) or ❌ STILL PRESENT. Track several shows vs the ~10% baseline.
Also watch: the benign data-channel dtls warns (harmless, see Stage A note) — do not re-chase.

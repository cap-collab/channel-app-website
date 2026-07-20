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

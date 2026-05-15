export type ChannelContentClass = 'stereo' | 'mono' | 'ambiguous';

// Classify a 2-channel MediaStream as:
//   'mono'      — L/R separation ≥ MONO_SEPARATION_DB (channels carry
//                 essentially the same signal)
//   'stereo'    — separation below that threshold (genuine L/R difference)
//   'ambiguous' — couldn't run the test: audio levels too low to measure,
//                 or no AudioContext available
//
// Classification is separation-only. Calibrated against real measurements:
// a mono source through a stereo interface still measures ~21 dB separation
// (preamp noise + gain mismatch decorrelate it), while genuine stereo content
// measured 6–11 dB. The 18 dB threshold sits cleanly between those bands and
// still catches bit-identical mono (30 dB+).
//
// Used by the Stream Optimization panel's "test my audio" button as advice to
// the DJ. It is NOT used as a publish-time gate — the DJ's explicit choice
// drives the RED decision.
const MONO_SEPARATION_DB = 18;
export async function analyseStereoContent(
  stream: MediaStream,
  durationMs: number,
): Promise<ChannelContentClass> {
  const Ctx: typeof AudioContext = (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    console.log('🎛 Audio check — no AudioContext available, cannot run → ambiguous');
    return 'ambiguous';
  }
  const ctx = new Ctx();
  try {
    const src = ctx.createMediaStreamSource(stream);
    const splitter = ctx.createChannelSplitter(2);
    const lAnalyser = ctx.createAnalyser();
    const rAnalyser = ctx.createAnalyser();
    lAnalyser.fftSize = 2048;
    rAnalyser.fftSize = 2048;
    src.connect(splitter);
    splitter.connect(lAnalyser, 0);
    splitter.connect(rAnalyser, 1);

    const lBuf = new Float32Array(lAnalyser.fftSize);
    const rBuf = new Float32Array(rAnalyser.fftSize);
    let lSumSq = 0, rSumSq = 0, diffSumSq = 0, sampleCount = 0;
    const intervalMs = 50;
    const iterations = Math.max(10, Math.floor(durationMs / intervalMs));

    for (let i = 0; i < iterations; i++) {
      await new Promise((res) => setTimeout(res, intervalMs));
      lAnalyser.getFloatTimeDomainData(lBuf);
      rAnalyser.getFloatTimeDomainData(rBuf);
      for (let j = 0; j < lBuf.length; j++) {
        const l = lBuf[j], r = rBuf[j];
        lSumSq += l * l;
        rSumSq += r * r;
        diffSumSq += (l - r) * (l - r);
        sampleCount++;
      }
    }

    if (sampleCount === 0) {
      console.log('🎛 Audio check — no samples captured, cannot run → ambiguous');
      return 'ambiguous';
    }
    const lRms = Math.sqrt(lSumSq / sampleCount);
    const rRms = Math.sqrt(rSumSq / sampleCount);
    const diffRms = Math.sqrt(diffSumSq / sampleCount);
    const mixRms = Math.sqrt((lSumSq + rSumSq) / sampleCount);
    // Need real signal on BOTH channels to decide — silence on either side
    // is ambiguous. -50 dBFS floor ≈ very quiet but non-zero.
    const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
    const lDb = dB(lRms), rDb = dB(rRms), mixDb = dB(mixRms);
    const r1 = (x: number) => x.toFixed(1);
    // Too quiet to measure separation meaningfully — report 'ambiguous' so the
    // UI tells the DJ to turn their levels up and retry.
    if (lDb < -50 || rDb < -50 || mixDb < -45) {
      console.log(`🎛 Audio check — audio levels too low to test, L ${r1(lDb)}dB / R ${r1(rDb)}dB / mix ${r1(mixDb)}dB → ambiguous`);
      return 'ambiguous';
    }
    // Separation = how much L-R differs from the L+R mix. Separation-only
    // classification: ≥ MONO_SEPARATION_DB → mono, below → stereo.
    const separationDb = mixDb - dB(diffRms);
    const verdict: ChannelContentClass =
      separationDb >= MONO_SEPARATION_DB ? 'mono' : 'stereo';
    console.log(`🎛 Audio check — separation ${r1(separationDb)}dB, L ${r1(lDb)}dB / R ${r1(rDb)}dB → ${verdict}`);
    return verdict;
  } finally {
    try { await ctx.close(); } catch { /* swallow */ }
  }
}

export type ChannelContentClass = 'stereo' | 'mono' | 'ambiguous';

// Classify a 2-channel MediaStream as 'stereo' (genuine L/R separation),
// 'mono' (L≈R, mono summed into stereo), or 'ambiguous' (insufficient signal
// to decide). Conservative — biased toward 'ambiguous'.
//
// Used by the Stream Optimization panel's "test my audio" button as advice to
// the DJ. It is NOT used as a publish-time gate — the DJ's explicit choice
// drives the RED decision.
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
    if (lDb < -50 || rDb < -50 || mixDb < -45) {
      console.log(`🎛 Audio check — signal too low to decide, L ${r1(lDb)}dB / R ${r1(rDb)}dB / mix ${r1(mixDb)}dB → ambiguous`);
      return 'ambiguous';
    }
    // Separation = how much L-R differs from the L+R mix. >25 dB below mix
    // means L≈R (mono summed). <15 dB means genuine stereo. In between is
    // ambiguous.
    const separationDb = mixDb - dB(diffRms);
    const verdict: ChannelContentClass =
      separationDb >= 25 ? 'mono' : separationDb <= 15 ? 'stereo' : 'ambiguous';
    console.log(`🎛 Audio check — separation ${r1(separationDb)}dB, L ${r1(lDb)}dB / R ${r1(rDb)}dB → ${verdict}`);
    return verdict;
  } finally {
    try { await ctx.close(); } catch { /* swallow */ }
  }
}

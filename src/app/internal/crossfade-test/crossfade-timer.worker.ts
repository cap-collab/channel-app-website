// Crossfade timer worker. Drives volume-ramp progress at ~60Hz from a
// worker thread so the ramp survives backgrounded tabs and locked screens
// (main-thread setInterval/rAF both get throttled when the tab is hidden;
// workers do not). The worker only emits progress messages — all curve
// math + audio.volume writes stay on the main thread.
//
// Protocol:
//   in : { type: 'start', token, durationMs, tickHz }
//   in : { type: 'cancel', token }
//   out: { type: 'tick', token, elapsedMs }
//   out: { type: 'done', token }
//
// Tokens let the main thread ignore stale messages when a newer fade has
// already started — mirrors the existing fadeTokenRef pattern in
// useArchiveRadio.runCrossfade.

type InMsg =
  | { type: 'start'; token: number; durationMs: number; tickHz: number }
  | { type: 'cancel'; token: number };

type OutMsg =
  | { type: 'tick'; token: number; elapsedMs: number }
  | { type: 'done'; token: number };

let currentToken = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;
let durationMs = 0;

const post = (msg: OutMsg) => (self as unknown as Worker).postMessage(msg);

const stopTimer = () => {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    stop();
    currentToken = msg.token;
    durationMs = msg.durationMs;
    startedAt = performance.now();
    const periodMs = Math.max(4, Math.round(1000 / msg.tickHz));
    intervalId = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      post({ type: 'tick', token: currentToken, elapsedMs: elapsed });
      if (elapsed >= durationMs) {
        stop();
        post({ type: 'done', token: currentToken });
      }
    }, periodMs);
    return;
  }
  if (msg.type === 'cancel') {
    if (msg.token === currentToken) stop();
    return;
  }
};

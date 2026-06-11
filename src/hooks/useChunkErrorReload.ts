"use client";

import { useEffect } from "react";

// After a deploy, a browser tab still holding the old HTML references JS chunk
// hashes that no longer exist on the server. Loading one throws ChunkLoadError,
// which surfaces as the blank "Application error: a client-side exception"
// screen. This hook catches that specific failure and does a one-time reload to
// pull the current HTML + chunks, so users self-heal instead of seeing a black
// screen.
//
// The reload is guarded by a sessionStorage flag: if the chunk is genuinely
// gone even after reloading, we do NOT loop — we let the error surface so it's
// visible rather than trapping the user in a reload cycle.

const RELOAD_FLAG = "channel:chunk-reloaded";

function isChunkLoadError(reason: unknown): boolean {
  if (!reason) return false;
  const name = (reason as { name?: string }).name;
  if (name === "ChunkLoadError") return true;
  const message = String(
    (reason as { message?: string }).message ?? reason
  );
  return (
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /'?text\/html'? is not a valid JavaScript MIME type/i.test(message)
  );
}

export function useChunkErrorReload() {
  useEffect(() => {
    function reloadOnce() {
      try {
        if (sessionStorage.getItem(RELOAD_FLAG)) return; // already tried — don't loop
        sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {
        // sessionStorage unavailable (private mode quirks) — still reload once.
      }
      // Force a fresh load past any HTTP cache.
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
        reloadOnce();
      }
    }

    function onRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) {
        reloadOnce();
      }
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // If the page stays up for a few seconds, our chunks loaded fine — clear the
    // guard so a *future* deploy can recover again. We delay the clear so that a
    // chunk error firing right after a recovery reload still sees the flag and
    // does NOT trigger a second reload (which would loop if the chunk is truly
    // gone). 5s is comfortably longer than initial chunk loading.
    const clearTimer = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        // ignore
      }
    }, 5000);

    return () => {
      window.clearTimeout(clearTimer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}

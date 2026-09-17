// A short two-tone chime for "something new arrived" notifications — synthesized
// with the Web Audio API instead of an audio file, so there's nothing to host.
let ctx = null;

function ensureContext() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Browsers block audio until the page has seen a user gesture — grab the very
// first click/keypress anywhere to unlock it, well before any chime is needed.
if (typeof window !== "undefined") {
  const unlock = () => {
    ensureContext();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function playChime() {
  try {
    const audioCtx = ensureContext();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [880, 1108].forEach((freq, i) => {
      const start = now + i * 0.13;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
  } catch {
    // Never let a sound failure break the notification itself.
  }
}

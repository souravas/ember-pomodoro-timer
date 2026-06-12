// Synthesized audio — no sound files shipped. Shared by the offscreen
// document (real playback: service workers have no audio access) and the
// settings panel (previews). Everything routes through the `out` node the
// caller provides, so volume is one gain upstream.

export const CHIMES = [
  { id: 'bell', label: 'Bell' },
  { id: 'warm', label: 'Warm' },
  { id: 'pluck', label: 'Pluck' },
];

export const AMBIENTS = [
  { id: 'off', label: 'Off' },
  { id: 'ticking', label: 'Ticking' },
  { id: 'rain', label: 'Rain' },
  { id: 'noise', label: 'Noise' },
];

// One decaying partial: the building block of every chime voice.
function tone(ctx, out, { freq, at, gain, attack = 0.015, decay = 1.6, type = 'sine' }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + decay + 0.1);
}

// Plays one phase-end chime; returns roughly how long it rings, in seconds.
export function playChime(ctx, out, kind = 'bell') {
  const now = ctx.currentTime;
  if (kind === 'warm') {
    // A low, slow-blooming triad — more sigh than bell.
    for (const [freq, gain] of [
      [293.66, 0.16], // D4
      [369.99, 0.12], // F#4
      [440.0, 0.1], // A4
    ]) {
      tone(ctx, out, { freq, at: now, gain, attack: 0.3, decay: 2.4 });
    }
    return 2.6;
  }
  if (kind === 'pluck') {
    // One damped strike with a fast pitch drop — marimba-ish.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(330, now + 0.08);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.28, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(g).connect(out);
    osc.start(now);
    osc.stop(now + 1);
    tone(ctx, out, { freq: 660, at: now, gain: 0.05, attack: 0.008, decay: 0.5 });
    return 1.1;
  }
  // 'bell' — the original soft two-note: fundamental plus one octave partial.
  for (const { freq, at } of [
    { freq: 587.33, at: now }, // D5
    { freq: 880.0, at: now + 0.28 }, // A5
  ]) {
    tone(ctx, out, { freq, at, gain: 0.22 });
    tone(ctx, out, { freq: freq * 2, at, gain: 0.07 });
  }
  return 2.2;
}

// The 30-seconds-before-a-break-ends warning: two soft high ticks.
export function playWarn(ctx, out) {
  const now = ctx.currentTime;
  for (const at of [now, now + 0.22]) {
    tone(ctx, out, { freq: 1320, at, gain: 0.09, attack: 0.005, decay: 0.18 });
  }
  return 0.6;
}

// A couple seconds of looped white noise. White loops seamlessly — the
// colour comes from filters downstream.
function noiseSource(ctx) {
  const seconds = 2;
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

// A scheduler that keeps WebAudio fed ~0.7s ahead — sample-accurate events
// from a sloppy timer. `next(at)` does the scheduling and returns the gap
// to the following event, in seconds.
function lookahead(ctx, next) {
  let at = ctx.currentTime + 0.1;
  const pump = () => {
    while (at < ctx.currentTime + 0.7) at += next(at);
  };
  pump();
  const interval = setInterval(pump, 250);
  return () => clearInterval(interval);
}

// Starts a continuous focus soundscape; returns { stop() }. The caller
// fades `out` itself if it wants a soft landing — stop() is immediate.
export function startAmbient(ctx, out, kind) {
  const stops = [];

  if (kind === 'ticking') {
    // tick · tock — alternating pitches, once a second, very quiet.
    let hi = true;
    stops.push(
      lookahead(ctx, (at) => {
        tone(ctx, out, { freq: hi ? 2100 : 1700, at, gain: 0.05, attack: 0.002, decay: 0.05 });
        hi = !hi;
        return 1;
      })
    );
  } else if (kind === 'rain') {
    // A steady hiss bed plus sporadic droplets just above it.
    const src = noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const bed = ctx.createGain();
    bed.gain.value = 0.05;
    src.connect(lp).connect(bed).connect(out);
    src.start();
    stops.push(() => src.stop());
    stops.push(
      lookahead(ctx, (at) => {
        tone(ctx, out, {
          freq: 900 + Math.random() * 2200,
          at,
          gain: 0.012 + Math.random() * 0.02,
          attack: 0.002,
          decay: 0.06,
        });
        return 0.06 + Math.random() * 0.22;
      })
    );
  } else if (kind === 'noise') {
    // Deep brown-ish rumble: white noise pushed through a low lowpass.
    const src = noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0.35; // the filter eats most of the energy — make it back
    src.connect(lp).connect(g).connect(out);
    src.start();
    stops.push(() => src.stop());
  }

  return {
    stop() {
      for (const s of stops) s();
    },
  };
}

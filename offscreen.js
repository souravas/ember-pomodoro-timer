// Offscreen document: the extension's speaker, since MV3 service workers
// have no audio access. Synthesis lives in core/sound.js. Chrome reaps an
// AUDIO_PLAYBACK offscreen document ~30s after audio stops, so nothing here
// manages its own lifetime: a chime lets it die, an ambient loop keeps it.

import { playChime, playWarn, startAmbient } from './core/sound.js';

let ctx = null;
let master = null;
let ambient = null; // { kind, handle }

function ensureGraph() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return ctx;
}

// Squared for a perceptual-ish curve: half the slider sounds half as loud.
function setVolume(volume) {
  master.gain.value = (volume ?? 0.7) ** 2;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'chime') {
    ensureGraph();
    setVolume(msg.volume);
    playChime(ctx, master, msg.chime);
  } else if (msg.type === 'warn') {
    ensureGraph();
    setVolume(msg.volume);
    playWarn(ctx, master);
  } else if (msg.type === 'ambient') {
    ensureGraph();
    setVolume(msg.volume);
    if (ambient && ambient.kind !== msg.sound) {
      ambient.handle.stop();
      ambient = null;
    }
    if (msg.sound && msg.sound !== 'off' && !ambient) {
      ambient = { kind: msg.sound, handle: startAmbient(ctx, master, msg.sound) };
    }
  }
});

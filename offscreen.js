// Offscreen document: exists only to play the phase-end chime, since MV3
// service workers have no audio access. Synthesized — no audio file needed.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'chime') return;
  playChime();
});

function playChime() {
  const ctx = new AudioContext();
  const now = ctx.currentTime;

  // A soft two-note bell: each note is a fundamental plus one octave partial
  // with a fast attack and a long exponential decay.
  const notes = [
    { freq: 587.33, at: 0 }, // D5
    { freq: 880.0, at: 0.28 }, // A5
  ];

  for (const { freq, at } of notes) {
    for (const [mult, gain] of [
      [1, 0.22],
      [2, 0.07],
    ]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      g.gain.setValueAtTime(0, now + at);
      g.gain.linearRampToValueAtTime(gain, now + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.6);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 1.7);
    }
  }

  setTimeout(() => {
    ctx.close();
    chrome.runtime.sendMessage({ type: 'chimeDone' }).catch(() => {});
  }, 2200);
}

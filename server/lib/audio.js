/** Returns the samples of a 16-bit PCM WAV as an Int16Array. */
export function readWav16(buf) {
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const end = Math.min(buf.length, off + 8 + size);
      const bytes = buf.subarray(off + 8, end - ((end - off - 8) % 2));
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    }
    off += 8 + size + (size % 2);
  }
  return new Int16Array(0);
}

/** Peak level per 1/perSec seconds, normalised to 0..1, for drawing waveforms. */
export function computePeaks(samples, rate = 16000, perSec = 50) {
  const win = Math.floor(rate / perSec);
  const peaks = [];
  let max = 1;
  for (let i = 0; i < samples.length; i += win) {
    let p = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > p) p = v;
    }
    peaks.push(p);
    if (p > max) max = p;
  }
  return peaks.map((p) => Math.round((p / max) * 100) / 100);
}

/**
 * Estimates tempo and a steady beat grid from an onset-strength envelope (10 ms hops):
 * autocorrelation picks the beat period (70-180 BPM, biased toward ~120), then the grid
 * phase that lines up with the most onsets. Also finds the loudest 15 s, a good place to start the song.
 */
export function analyzeMusic(samples, rate = 16000) {
  const hop = Math.floor(rate / 100);
  const n = Math.floor(samples.length / hop);
  if (n < 300) return null;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += (samples[j] / 32768) ** 2;
    env[i] = Math.log(1e-4 + Math.sqrt(s / hop));
  }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);
  // Subtract a local average so steady loud parts don't dominate.
  const local = new Float32Array(n);
  let acc = 0;
  const W = 25;
  for (let i = 0; i < n + W; i++) {
    if (i < n) acc += onset[i];
    if (i - 2 * W - 1 >= 0) acc -= onset[i - 2 * W - 1];
    const c = i - W;
    if (c >= 0 && c < n) local[c] = Math.max(0, onset[c] - acc / (2 * W + 1));
  }

  const minLag = 33; // 180 BPM
  const maxLag = 86; // 70 BPM
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0;
    for (let i = 0; i + lag < n; i++) ac += local[i] * local[i + lag];
    const bias = Math.exp(-0.5 * (Math.log2(lag / 50) / 0.6) ** 2);
    scores.push(ac * bias);
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  let lag = best + minLag;
  if (best > 0 && best < scores.length - 1) {
    const [a, b, c] = [scores[best - 1], scores[best], scores[best + 1]];
    const d = a - 2 * b + c;
    if (d < 0) lag += (0.5 * (a - c)) / d;
  }

  let phase = 0;
  let phaseScore = -1;
  for (let o = 0; o < lag; o++) {
    let s = 0;
    for (let k = o; k < n; k += lag) {
      const i = Math.round(k);
      s += local[i] + 0.5 * ((local[i - 1] || 0) + (local[i + 1] || 0));
    }
    if (s > phaseScore) { phaseScore = s; phase = o; }
  }
  const beats = [];
  for (let k = phase; k < n; k += lag) beats.push(Math.round(k) / 100);

  // Loudest 15 s window (1 s steps).
  const perSec = [];
  for (let s = 0; s * 100 < n; s++) {
    let e = 0;
    for (let i = s * 100; i < Math.min(n, (s + 1) * 100); i++) e += Math.exp(env[i]);
    perSec.push(e);
  }
  const span = Math.min(15, perSec.length);
  let sum = perSec.slice(0, span).reduce((x, y) => x + y, 0);
  let bestSum = sum;
  let bestStart = 0;
  for (let s = 1; s + span <= perSec.length; s++) {
    sum += perSec[s + span - 1] - perSec[s - 1];
    if (sum > bestSum) { bestSum = sum; bestStart = s; }
  }
  const firstBeatAfter = beats.find((b) => b >= bestStart) ?? bestStart;

  return { bpm: Math.round((6000 / lag) * 10) / 10, beats, highlight: Math.round(firstBeatAfter * 100) / 100 };
}

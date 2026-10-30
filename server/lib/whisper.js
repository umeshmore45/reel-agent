import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Reuses the voice agent's model (../../server/models) when it is there.
const MODEL = process.env.WHISPER_MODEL || [
  path.join(here, '..', 'models', 'ggml-base.en.bin'),
  path.join(here, '..', '..', '..', 'server', 'models', 'ggml-base.en.bin'),
].find((p) => existsSync(p));
const BIN = process.env.WHISPER_SERVER_BIN || 'whisper-server';
// Its own port so it can run next to the voice agent's whisper (8178).
const PORT = Number(process.env.WHISPER_PORT || 8179);
const LANG = process.env.WHISPER_LANG || 'en';
const URL_BASE = `http://127.0.0.1:${PORT}`;

let child = null;
let ready = null;

const up = () => fetch(`${URL_BASE}/`).then(() => true, () => false);

/** Starts whisper.cpp's HTTP server on first use (or reuses one already on the port) and waits until it answers. */
export function ensureWhisper() {
  if (ready) return ready;
  ready = (async () => {
    if (await up()) return;
    if (!MODEL) throw new Error('No Whisper model found. Run: npm run setup:whisper');
    child = spawn(BIN, [
      '-m', MODEL, '--host', '127.0.0.1', '--port', String(PORT),
      '-l', LANG, '-sns', '-bs', '5', '-t', '4',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => {
      const line = d.toString();
      if (/error|failed/i.test(line)) console.error(`[whisper] ${line.trim()}`);
    });
    const failed = new Promise((_, reject) => {
      child.on('error', (err) => reject(new Error(`Could not start ${BIN}: ${err.message}. Install with: brew install whisper-cpp`)));
      child.on('exit', (code) => reject(new Error(`whisper-server exited (${code})`)));
    });
    const stop = () => child?.kill('SIGTERM');
    process.once('exit', stop);
    process.once('SIGINT', () => { stop(); process.exit(0); });
    process.once('SIGTERM', () => { stop(); process.exit(0); });
    const started = Date.now();
    await Promise.race([failed, (async () => {
      while (!(await up())) {
        if (Date.now() - started > 30_000) throw new Error('Whisper server did not start in 30 s');
        await new Promise((r) => setTimeout(r, 300));
      }
    })()]);
  })().catch((err) => {
    ready = null;
    child = null;
    throw err;
  });
  return ready;
}

const norm = (w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** Drops phrases Whisper repeats in a loop on noise ("Thank you. Thank you. Thank you."), keeping the first. */
function dropRepeats(words) {
  const out = [];
  let i = 0;
  while (i < words.length) {
    let n = 15;
    for (; n >= 1; n--) {
      if (out.length < n || i + n > words.length) continue;
      const same = words.slice(i, i + n).every((w, k) => norm(w) === norm(out[out.length - n + k]));
      // Single words only count as a loop from the third copy ("very very" is real speech).
      if (same && (n > 1 || (out.length >= 2 && norm(out[out.length - 2]) === norm(words[i])))) break;
    }
    if (n >= 1) i += n;
    else out.push(words[i++]);
  }
  return out;
}

/**
 * Word-level transcript of a 16 kHz mono WAV: { words: [{ start, end, text }], quality }.
 * max_len=1 + split_on_word makes whisper.cpp return one segment per word (with its punctuation).
 * quality is 'low' when the result looks invented from noise or non-English speech: loops, or words
 * stretched over most of a second each (real speech is ~0.2-0.4 s per word).
 */
export async function transcribeWords(wavPath) {
  await ensureWhisper();
  const form = new FormData();
  form.append('file', new Blob([await readFile(wavPath)], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  form.append('max_len', '1');
  form.append('split_on_word', 'true');
  const res = await fetch(`${URL_BASE}/inference`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Whisper error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  const words = [];
  for (const seg of data.segments || []) {
    const text = (seg.text || '').replace(/[♪♫]/g, '').trim();
    if (!text || /^[[(*].*[\])*]$/.test(text)) continue; // [BLANK_AUDIO], (music), *laughs*
    const start = Math.round(seg.start * 100) / 100;
    const end = Math.max(start + 0.05, Math.round(seg.end * 100) / 100);
    // Punctuation-only pieces belong to the previous word.
    if (/^[^\p{L}\p{N}]+$/u.test(text)) {
      if (words.length) words[words.length - 1].text += text;
      continue;
    }
    words.push({ start, end, text });
  }
  const kept = dropRepeats(words);
  if (!kept.length) return { words: [], quality: 'good' };
  const durs = kept.map((w) => w.end - w.start).sort((a, b) => a - b);
  const median = durs[Math.floor(durs.length / 2)];
  const stretched = durs.filter((d) => d > 1).length / durs.length;
  const looped = (words.length - kept.length) / words.length;
  return { words: kept, quality: looped > 0.3 || median > 0.55 || stretched > 0.3 ? 'low' : 'good' };
}

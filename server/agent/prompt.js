import { FPS, layoutFrames } from '../lib/timeline.js';

const s = (n) => Number(n.toFixed(2));

/** Transcript as "[start] word" with phrase end times, compact enough for long takes. */
function formatWords(words) {
  if (!words.length) return '(no speech)';
  const out = [];
  words.forEach((w, i) => {
    out.push(`[${s(w.start)}] ${w.text}`);
    const next = words[i + 1];
    if (!next || next.start - w.end > 0.4) out.push(`(ends ${s(w.end)})`);
  });
  return out.join(' ');
}

function describeMedia(m, seen) {
  if (m.status !== 'ready') return `- ${m.id} | ${m.kind} | "${m.name}" | ${m.status === 'error' ? `failed: ${m.error}` : 'still processing, not usable yet'}`;
  const orient = m.width && m.height ? ` | ${m.width}x${m.height} ${m.width > m.height ? 'landscape' : m.width < m.height ? 'portrait' : 'square'}` : '';
  const lines = [];
  if (m.kind === 'video') {
    lines.push(`- ${m.id} | video | "${m.name}" | ${s(m.duration)} s${orient} | sound: ${m.hasAudio ? 'yes' : 'none'}`);
    if (m.sheet) lines.push(`  contact sheet: ${m.sheet} (frames at ${m.sheetTimes.map(s).join(', ')} s)`);
    if (m.transcript.status === 'done' && m.transcript.quality === 'low') {
      lines.push('  transcript: unclear (probably background noise or non-English speech); treat this clip as having no usable speech');
    } else if (m.transcript.status === 'done') {
      lines.push(seen ? '  transcript: (sent earlier in this conversation, unchanged)' : `  transcript: ${formatWords(m.transcript.words)}`);
    } else if (m.transcript.status === 'pending') lines.push('  transcript: still being transcribed');
  } else if (m.kind === 'image') {
    lines.push(`- ${m.id} | image | "${m.name}"${orient}`, `  image file: ${m.file}`);
  } else {
    lines.push(`- ${m.id} | audio | "${m.name}" | ${s(m.duration)} s`);
    if (m.bpm) {
      lines.push(`  music: ${m.bpm} BPM, one beat every ${s(60 / m.bpm)} s, suggested start ${m.highlight} s`);
      lines.push(`  beats (first 64 from the suggested start): ${m.beats.filter((b) => b >= m.highlight).slice(0, 64).map(s).join(', ')}`);
    }
  }
  return lines.join('\n');
}

/** The per-turn prompt: request + media summary + current timeline. Transcripts are only sent once per session. */
export function buildTurnPrompt({ text, project, timeline }) {
  const seen = new Set(project.agentSeenMedia || []);
  const media = project.media.map((m) => describeMedia(m, seen.has(m.id))).join('\n') || '(no media uploaded yet)';
  const { total } = layoutFrames(timeline.clips);
  const { overrides, ...captions } = timeline.captions;
  const compact = { ...timeline, captions };
  return [
    `USER REQUEST:\n${text}`,
    `MEDIA:\n${media}`,
    `CURRENT TIMELINE (reel length ${s(total / FPS)} s):\n${JSON.stringify(compact)}`,
  ].join('\n\n');
}

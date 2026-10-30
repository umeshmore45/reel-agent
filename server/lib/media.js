import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { SHEET_VERSION, contactSheet, extractAudio, makeProxy, probe, thumbnail } from './ffmpeg.js';
import { analyzeMusic, computePeaks, readWav16 } from './audio.js';
import { transcribeWords } from './whisper.js';
import { projectDir, saveProject } from './store.js';

// ffmpeg jobs share the CPU with the browser preview, so only two files are processed at a time.
const MAX_ACTIVE = 2;
let active = 0;
const queue = [];

export function queueMedia(project, media) {
  queue.push(() => processMedia(project, media));
  pump();
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
}

/** Rebuilds a contact sheet made by an older version (fewer frames). */
export function queueSheetRefresh(project, media) {
  queue.push(async () => {
    const dir = projectDir(project.id);
    try {
      media.sheetTimes = await contactSheet(path.join(dir, media.file), path.join(dir, media.sheet), media.duration, media.hdr);
      media.sheetVersion = SHEET_VERSION;
      await saveProject(project, { touch: false });
    } catch (err) {
      console.error(`[media] contact sheet failed for ${media.name}: ${err.message}`);
    }
  });
  pump();
}

export function kindFromUpload(mimetype = '', name = '') {
  if (mimetype.startsWith('image/') || /\.(jpe?g|png|webp|bmp)$/i.test(name)) return 'image';
  if (mimetype.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(name)) return 'audio';
  return 'video';
}

/**
 * Upload → probe → thumbnail (+ contact sheet) → ready, then the slower extras:
 * waveform peaks, beat grid for music, word transcript for video speech, and a preview proxy.
 */
async function processMedia(project, media) {
  const dir = projectDir(project.id);
  const src = path.join(dir, media.file);
  const save = () => saveProject(project, { touch: false });
  try {
    const info = await probe(src);
    if (media.kind === 'video' && (!info.hasVideo || info.stillImage)) media.kind = info.hasVideo ? 'image' : 'audio';
    if (media.kind === 'audio' && !info.hasAudio) throw new Error('No audio track found');
    if (media.kind !== 'audio' && !info.width) throw new Error('No picture found in this file');
    Object.assign(media, {
      duration: media.kind === 'image' ? 0 : Math.round(info.duration * 1000) / 1000,
      width: info.width,
      height: info.height,
      hasAudio: media.kind !== 'image' && info.hasAudio,
      hdr: media.kind === 'video' ? info.hdr : undefined,
    });
    if (media.kind === 'video' && media.duration < 0.2) throw new Error('Video is too short');

    if (media.kind !== 'audio') {
      const thumb = `thumbs/${media.id}.jpg`;
      await thumbnail(src, path.join(dir, thumb), media.kind === 'video' ? Math.min(1, media.duration / 3) : 0, media.hdr);
      media.thumb = thumb;
    }
    if (media.kind === 'video') {
      const sheet = `sheets/${media.id}.jpg`;
      media.sheetTimes = await contactSheet(src, path.join(dir, sheet), media.duration, media.hdr);
      media.sheet = sheet;
      media.sheetVersion = SHEET_VERSION;
    }
    media.status = 'ready';
    if (media.hasAudio && media.kind === 'video') media.transcript.status = 'pending';
    await save();

    if (media.hasAudio) {
      const wav = path.join(dir, 'audio', `${media.id}.wav`);
      await extractAudio(src, wav);
      const samples = readWav16(await readFile(wav));
      media.peaks = computePeaks(samples);
      if (media.kind === 'audio') {
        const music = analyzeMusic(samples);
        if (music) Object.assign(media, music);
      }
      await save();
      if (media.kind === 'video') await transcribe(project, media, wav);
      await rm(wav, { force: true });
    }

    if (media.kind === 'video') {
      const proxy = `proxy/${media.id}.mp4`;
      media.proxyPending = true;
      try {
        await makeProxy(src, path.join(dir, proxy), media.hdr);
        media.proxy = proxy;
      } catch (err) {
        console.error(`[media] proxy failed for ${media.name}: ${err.message}`);
      }
      delete media.proxyPending;
      await save();
    }
  } catch (err) {
    delete media.proxyPending;
    media.status = 'error';
    media.error = err.message.split('\n').slice(-2).join(' ').slice(0, 300);
    if (media.transcript.status === 'pending') media.transcript.status = 'none';
    await save();
  }
}

async function transcribe(project, media, wav) {
  media.transcript.status = 'pending';
  try {
    const { words, quality } = await transcribeWords(wav);
    media.transcript = { status: 'done', words, quality, text: words.map((w) => w.text).join(' ') };
  } catch (err) {
    media.transcript = { status: 'error', words: [], text: '', error: err.message };
  }
  await saveProject(project, { touch: false });
}

/** Re-runs speech-to-text for one video (e.g. after installing Whisper). */
export async function retranscribe(project, media) {
  const dir = projectDir(project.id);
  const wav = path.join(dir, 'audio', `${media.id}.wav`);
  await extractAudio(path.join(dir, media.file), wav);
  await transcribe(project, media, wav);
  await rm(wav, { force: true });
}

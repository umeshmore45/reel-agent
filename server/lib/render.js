import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HW_DECODE, ffmpeg, h264Args, toSdr } from './ffmpeg.js';
import { FPS, layoutFrames } from './timeline.js';
import { projectDir } from './store.js';

// ffmpeg versions of the colour presets. The browser preview uses the CSS filters in
// web/lib/constants.ts; sepia/saturate/contrast are matched exactly where ffmpeg allows it.
const FILTER_FF = {
  none: '',
  vivid: 'eq=contrast=1.08:saturation=1.4',
  warm: 'colorchannelmixer=.879:.154:.038:0:.070:.937:.034:0:.054:.107:.826,eq=saturation=1.3',
  vintage: 'colorchannelmixer=.757:.308:.076:0:.140:.874:.067:0:.109:.214:.652,eq=contrast=0.92:saturation=0.85:brightness=0.02',
  mono: 'hue=s=0,eq=contrast=1.12',
  cinematic: 'eq=contrast=1.15:saturation=0.85:brightness=-0.015',
  bright: 'eq=brightness=0.04:contrast=1.05:saturation=1.1',
  moody: 'eq=brightness=-0.04:contrast=1.2:saturation=0.75',
  noir: 'hue=s=0,eq=contrast=1.4:brightness=-0.04',
  pop: 'eq=contrast=1.15:saturation=1.7',
};

const f3 = (n) => Number(n.toFixed(3));
const PUNCH_FRAMES = FPS / 2;
// Gentle luma sharpening: phone footage downscaled from 4K reads crisper on small screens.
const SHARPEN = 'unsharp=5:5:0.45:5:5:0';

function colorFilter(c) {
  const parts = [FILTER_FF[c.filter] || ''];
  if (c.brightness || c.contrast !== 1 || c.saturation !== 1) {
    parts.push(`eq=brightness=${f3(c.brightness)}:contrast=${f3(c.contrast)}:saturation=${f3(c.saturation)}`);
  }
  return parts.filter(Boolean).join(',');
}

function atempo(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

/** Music volume over time: drops to duckLevel during speech, with 0.2 s ramps (same curve as the preview). */
function duckExpr(music, regions) {
  if (!music.duck || !regions.length) return String(f3(music.volume));
  const r = 0.2;
  const tri = regions.map(({ start, end }) => `clip(min((t-${f3(start - r)})/${r},(${f3(end + r)}-t)/${r}),0,1)`);
  const d = tri.reduceRight((acc, x) => (acc ? `max(${x},${acc})` : x), '');
  return `${f3(music.volume)}*(1-${f3(1 - music.duckLevel)}*${d})`;
}

/**
 * Renders the reel to MP4 (H.264/AAC, 30 fps). Captions and text are drawn by the browser
 * (so they match the preview exactly) and arrive as full-frame transparent WebP/PNG images with durations;
 * they are played back as one overlay stream via the concat demuxer.
 */
export async function renderReel({ project, timeline, height, fast, overlays, duckRegions, workDir, outFile, onProgress, signal }) {
  const W = height === 1280 ? 720 : 1080;
  const H = height === 1280 ? 1280 : 1920;
  const dir = projectDir(project.id);
  const media = new Map(project.media.map((m) => [m.id, m]));
  const clips = timeline.clips.filter((c) => media.get(c.mediaId)?.status === 'ready');
  if (!clips.length) throw new Error('Add at least one clip to the timeline first.');

  const { items, total: totalFrames } = layoutFrames(clips);
  const total = totalFrames / FPS;
  const args = ['-y', '-progress', 'pipe:1', '-nostats'];
  const graph = [];
  const audio = [];
  let input = 0;

  items.forEach((li, i) => {
    const c = li.clip;
    const m = media.get(c.mediaId);
    const file = path.join(dir, m.file);
    const durS = li.dur / FPS;
    if (m.kind === 'image') {
      args.push('-loop', '1', '-framerate', String(FPS), '-t', String(f3(durS + 1)), '-i', file);
    } else {
      args.push(...HW_DECODE, '-ss', String(f3(c.in)), '-t', String(f3(c.out - c.in + 0.5)), '-i', file);
    }
    const k = input++;

    // Zoomed shots are framed at twice the output size (straight from the 4K source), so a
    // punch-in stays sharp and zoompan's integer crop steps don't jitter.
    const zoomed = c.zoom !== 'none';
    const FW = zoomed ? W * 2 : W;
    const FH = zoomed ? H * 2 : H;
    // HDR footage is first scaled to just cover the frame, then tone-mapped (cheap at that size).
    const pre = [
      ...(m.kind === 'video' ? [`setpts=(PTS-STARTPTS)/${f3(c.speed)}`] : []), `fps=${FPS}`,
      ...(m.hdr ? [`scale=${FW}:${FH}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos`, toSdr(m.hdr)] : []),
    ].join(',');
    const zoom = !zoomed ? '' : (() => {
      const a = f3(c.zoomAmount);
      const z = c.zoom === 'in' ? `1+${a}*on/${li.dur}`
        : c.zoom === 'out' ? `1+${a}-${a}*on/${li.dur}`
        : `1+${a}*(1-pow(1-min(1,on/${PUNCH_FRAMES}),3))`; // punch: eased zoom in over 0.5 s, then hold
      // The visible window is centred on (zoomX, zoomY), kept inside the frame. Same maths as web/lib/draw.ts.
      const x = `max(0,min(iw-iw/zoom,${f3(c.zoomX ?? 0.5)}*iw-iw/zoom/2))`;
      const y = `max(0,min(ih-ih/zoom,${f3(c.zoomY ?? 0.5)}*ih-ih/zoom/2))`;
      return `${c.fit === 'blur' ? `scale=${FW}:${FH},` : ''}zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${FPS}`;
    })();
    const post = [zoom, colorFilter(c), 'format=yuv420p', 'setsar=1',
      'tpad=stop_mode=clone:stop_duration=2', `trim=end_frame=${li.dur}`, 'setpts=PTS-STARTPTS', 'settb=AVTB']
      .filter(Boolean).join(',');

    if (c.fit === 'blur') {
      const bw = W / 8;
      const bh = H / 8;
      graph.push(`[${k}:v]${pre},split=2[bgi${i}][fgi${i}]`);
      graph.push(`[bgi${i}]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:2,scale=${W}:${H},eq=brightness=-0.06[bg${i}]`);
      graph.push(`[fgi${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg${i}]`);
      graph.push(`[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,${post}[v${i}]`);
    } else {
      graph.push(`[${k}:v]${pre},scale=${FW}:${FH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${FW}:${FH}:(iw-ow)*${f3(c.focusX)}:(ih-oh)*${f3(c.focusY)},${post}[v${i}]`);
    }

    if (m.kind === 'video' && m.hasAudio && c.volume > 0) {
      const fin = li.tIn ? li.tIn / FPS : 0.01;
      const fout = li.tOut ? li.tOut / FPS : 0.01;
      const ms = Math.round((li.start / FPS) * 1000);
      graph.push(`[${k}:a]${['asetpts=PTS-STARTPTS', ...atempo(c.speed), 'aresample=48000',
        'aformat=sample_fmts=fltp:channel_layouts=stereo', `volume=${f3(c.volume)}`, 'apad',
        `atrim=duration=${f3(durS)}`, `afade=t=in:st=0:d=${f3(fin)}`, `afade=t=out:st=${f3(Math.max(0, durS - fout))}:d=${f3(fout)}`,
        `adelay=${ms}|${ms}`].join(',')}[a${i}]`);
      audio.push(`[a${i}]`);
    }
  });

  // Join clips: hard cuts via concat, transitions via xfade overlapping the next clip's start.
  let acc = 'v0';
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    graph.push(prev.tOut
      ? `[${acc}][v${i}]xfade=transition=${prev.clip.transition}:duration=${f3(prev.tOut / FPS)}:offset=${f3(items[i].start / FPS)}[x${i}]`
      : `[${acc}][v${i}]concat=n=2:v=1:a=0[x${i}]`);
    acc = `x${i}`;
  }

  if (overlays.length) {
    const list = ['ffconcat version 1.0'];
    for (const o of overlays) list.push(`file '${path.join(workDir, o.file)}'`, `duration ${f3(o.duration)}`);
    list.push(`file '${path.join(workDir, overlays[overlays.length - 1].file)}'`);
    const listFile = path.join(workDir, 'overlays.ffconcat');
    await writeFile(listFile, `${list.join('\n')}\n`);
    args.push('-f', 'concat', '-safe', '0', '-i', listFile);
    graph.push(`[${acc}]${SHARPEN}[sharp]`, `[${input++}:v]format=rgba[ovl]`, `[sharp][ovl]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[vout]`);
  } else {
    graph.push(`[${acc}]${SHARPEN},format=yuv420p[vout]`);
  }

  if (audio.length) {
    graph.push(`${audio.join('')}amix=inputs=${audio.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${f3(total)}[voice]`);
  }
  const music = timeline.music && media.get(timeline.music.mediaId);
  if (music?.status === 'ready') {
    const mu = timeline.music;
    args.push('-stream_loop', '-1', '-ss', String(f3(mu.start)), '-i', path.join(dir, music.file));
    const fades = [
      mu.fadeIn > 0 ? `afade=t=in:st=0:d=${f3(mu.fadeIn)}` : '',
      mu.fadeOut > 0 ? `afade=t=out:st=${f3(Math.max(0, total - mu.fadeOut))}:d=${f3(mu.fadeOut)}` : '',
    ].filter(Boolean);
    graph.push(`[${input++}:a]${[`atrim=duration=${f3(total)}`, 'asetpts=PTS-STARTPTS', 'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo', `volume='${duckExpr(mu, duckRegions)}':eval=frame`, ...fades].join(',')}[music]`);
  }
  // "Fade" look: sound fades with the picture (the picture fade is part of the overlay layer).
  const fade = timeline.look?.fade ? `,afade=t=in:st=0:d=0.5,afade=t=out:st=${f3(Math.max(0, total - 0.7))}:d=0.7` : '';
  const limiter = 'alimiter=limit=0.95:level=false';
  if (audio.length && music) graph.push(`[voice][music]amix=inputs=2:normalize=0:dropout_transition=0,${limiter}${fade}[aout]`);
  else if (audio.length) graph.push(`[voice]${limiter}${fade}[aout]`);
  else if (music) graph.push(`[music]anull${fade}[aout]`);
  else graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f3(total)}[aout]`);

  const filter = graph.join(';\n');
  await writeFile(path.join(workDir, 'graph.txt'), filter);
  args.push(
    '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]',
    ...h264Args({ crf: fast ? 22 : 17, preset: fast ? 'veryfast' : 'slow', bitrate: '20M' }),
    '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-t', String(f3(total)), outFile,
  );

  await ffmpeg(args, { signal, onProgress: (sec) => onProgress?.(Math.min(0.99, sec / total)) });
  const { size } = await stat(outFile);
  return { duration: total, size, width: W, height: H };
}

export const cleanup = (workDir) => rm(workDir, { recursive: true, force: true });

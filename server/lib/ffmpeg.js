import { spawn, spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

// FFMPEG_PATH wins, then the binary bundled by the ffmpeg-static package, then whatever is on PATH.
export const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

let encoders = null;
/** libx264 when the build has it, otherwise the macOS hardware encoder. */
export function h264Args({ crf = 20, preset = 'medium', bitrate = '12M' } = {}) {
  if (encoders === null) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    encoders = r.stdout || '';
  }
  if (/\blibx264\b/.test(encoders)) {
    return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high'];
  }
  return ['-c:v', 'h264_videotoolbox', '-b:v', bitrate, '-pix_fmt', 'yuv420p'];
}

const tail = (s, n = 12) => s.trim().split('\n').slice(-n).join('\n');

// Hardware video decoding on macOS (about 3x faster for 4K HEVC phone footage). ffmpeg falls back
// to software decoding by itself when a file can't be decoded in hardware.
export const HW_DECODE = process.platform === 'darwin' ? ['-hwaccel', 'videotoolbox'] : [];

/**
 * HDR (HLG/PQ phone footage) to normal SDR BT.709, so colours don't look washed out in the
 * preview or the reel. Run it after downscaling: it works in 32-bit float and is slow at 4K.
 */
export const toSdr = (hdr) => (hdr
  ? 'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'
  : '');

/**
 * Runs ffmpeg. With `-progress pipe:1` in args, onProgress receives seconds of output written.
 * Returns stderr. Rejects with the last lines of ffmpeg's log on failure.
 */
export function ffmpeg(args, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let out = '';
    child.stdout.on('data', (d) => {
      if (!onProgress) return;
      out += d.toString();
      let i;
      while ((i = out.indexOf('\n')) !== -1) {
        const m = out.slice(0, i).match(/^out_time_us=(\d+)/);
        out = out.slice(i + 1);
        if (m) onProgress(Number(m[1]) / 1e6);
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-50_000);
    });
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort);
    child.on('error', (err) => reject(new Error(`Could not start ffmpeg (${FFMPEG}): ${err.message}`)));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (code === 0) resolve(stderr);
      else reject(new Error(tail(stderr) || `ffmpeg exited with code ${code}`));
    });
  });
}

/** Reads duration, size (after rotation), and which streams a file has, from ffmpeg's own banner. */
export function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', (d) => { log += d.toString(); });
    child.on('error', reject);
    child.on('close', () => {
      if (/Invalid data found|could not find codec|No such file/i.test(log) && !/Stream #/.test(log)) {
        return reject(new Error('Unsupported or unreadable file'));
      }
      const d = log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
      const videoLine = log.split('\n').find((l) => /Stream #.*: Video:/.test(l) && !/attached pic/.test(l));
      let width = 0;
      let height = 0;
      if (videoLine) {
        const wh = videoLine.match(/, (\d{2,5})x(\d{2,5})/);
        if (wh) { width = Number(wh[1]); height = Number(wh[2]); }
      }
      const rot = log.match(/rotation of (-?\d+(?:\.\d+)?) degrees/) || log.match(/rotate\s*:\s*(-?\d+)/);
      if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [width, height] = [height, width];
      resolve({
        duration,
        width,
        height,
        hasVideo: Boolean(videoLine),
        hdr: /arib-std-b67/.test(videoLine || '') ? 'hlg' : /smpte2084/.test(videoLine || '') ? 'pq' : undefined,
        stillImage: Boolean(videoLine && /Video: (mjpeg|png|webp|bmp|tiff|jpeg2000|heic)/.test(videoLine) && duration < 0.1),
        hasAudio: /Stream #.*: Audio:/.test(log),
      });
    });
  });
}

export const thumbnail = (src, out, at = 0, hdr) => ffmpeg([
  '-y', ...(at > 0 ? ['-ss', at.toFixed(2)] : []), ...(at > 0 ? HW_DECODE : []), '-i', src,
  '-frames:v', '1', '-vf', ["scale='min(360,iw)':-2", toSdr(hdr)].filter(Boolean).join(','), '-q:v', '4', out,
]);

export const SHEET_VERSION = 2;

/**
 * Evenly spaced frames in one grid image, so the agent can "watch" a clip: about one per 1.5 s
 * (8-24 frames), enough to tell people and moments apart in longer takes. Returns the frame times.
 */
export async function contactSheet(src, out, duration, hdr) {
  const want = Math.min(24, Math.max(8, Math.ceil(duration / 1.5)));
  const cols = want <= 8 ? 4 : 6;
  const rows = Math.ceil(want / cols);
  const step = Math.max(duration, 0.4) / (cols * rows);
  const sdr = toSdr(hdr);
  await ffmpeg([
    '-y', ...HW_DECODE, '-i', src,
    '-vf', `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${step.toFixed(3)})',scale='if(gt(iw\\,ih)\\,320\\,180)':-2,${sdr ? `${sdr},` : ''}tile=${cols}x${rows}:padding=6:color=black`,
    '-frames:v', '1', '-fps_mode', 'vfr', '-q:v', '5', out,
  ]);
  return Array.from({ length: cols * rows }, (_, i) => Number((i * step).toFixed(2)));
}

export const extractAudio = (src, out) => ffmpeg(['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]);

/** 1080p H.264 copy with a keyframe every half second, so the browser preview scrubs smoothly. */
export const makeProxy = (src, out, hdr) => ffmpeg([
  '-y', ...HW_DECODE, '-i', src, '-map', '0:v:0', '-map', '0:a:0?',
  '-vf', ["scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)':flags=lanczos", toSdr(hdr)].filter(Boolean).join(','),
  ...h264Args({ crf: 23, preset: 'veryfast', bitrate: '8M' }), '-g', '15',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out,
]);

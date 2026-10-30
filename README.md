# Reel Agent — AI agent + pro editor for vertical reels

Upload raw clips, photos and a song. The AI agent watches the footage, reads the transcript and cuts a 9:16 reel (hook, pacing, captions, text, music, colour). Then you fine-tune everything in a timeline editor and export an MP4 for Instagram Reels, YouTube Shorts or TikTok.

- **UI:** Next.js 14 + Tailwind (`web/`, port 3100). Use Chrome or Edge.
- **Backend:** Node + Express (`server/`, port 4100). Projects live in `server/workspace/projects/<id>/`.
- **Agent brain:** Claude Code CLI (`claude -p` with `--json-schema`), one CLI session per project.
- **Video:** ffmpeg from the `ffmpeg-static` npm package (override with `FFMPEG_PATH`).
- **Speech-to-text:** local Whisper (`whisper-server`, port 8179) with word timestamps. Model: `server/models/ggml-base.en.bin`.

## Requirements

- Node.js 20+
- [Claude Code](https://claude.com/claude-code) installed and logged in (`claude` on your PATH). The agent runs on your own Claude Code account.
- whisper.cpp: `brew install whisper-cpp` (macOS), or build [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and put `whisper-server` on your PATH (or set `WHISPER_SERVER_BIN`).

## Setup and run

```bash
git clone https://github.com/umeshmore45/reel-agent.git
cd reel-agent
npm run install:all     # first time
npm run setup:whisper   # first time: downloads the Whisper base.en model (~140 MB)
npm run dev             # server :4100 + web :3100
```

Open http://localhost:3100.

## What it does

**AI agent (right panel).** Describe the reel you want, or use a quick action: auto-edit, stronger hook, cut silences, faster pacing, beat sync, cinematic look, caption + hashtags. Each turn the agent gets every file's duration, orientation, word-level transcript, music BPM/beats, and a contact sheet (8 frames) it opens with the Read tool to see the footage. It returns the complete new timeline as structured output; the server validates it and the editor applies it as one undoable step. The conversation is remembered per project.

**Editor.**
- Live 9:16 preview: fill-crop with focus point, or fit over a blurred copy; slow zoom (Ken Burns); colour presets + brightness/contrast/saturation; transitions (crossfade, dip to black, slide, zoom, circle).
- Timeline: drag to reorder, trim handles, split (S), duplicate (D), delete, snapping to beats/cuts/playhead, drop clips from the library.
- Auto captions from Whisper, 6 styles with word-by-word highlight; edit the words; drag them on the preview.
- Text overlays: 6 fonts, shadow/outline/box/glow, pop/fade/slide/typewriter animation; drag on the preview; safe-zone guides.
- Music: waveform, beat grid, "strongest part" start, fades, auto-duck under speech, "snap cuts to the beat".
- One-click **Remove silences & filler words** per talking clip.
- Undo/redo (⌘Z / ⇧⌘Z), autosave, multiple projects.

**Export.** 1080×1920 or 720×1280, H.264/AAC, 30 fps, `+faststart`. Captions and text are drawn by the same canvas code as the preview (one WebP per distinct frame) and composited by ffmpeg, so the export matches what you saw.

## How a file is processed

1. Upload → `ffmpeg` probe (duration, size after rotation, audio).
2. Thumbnail + 4×2 contact sheet for the agent.
3. Audio → 16 kHz WAV → waveform peaks; for music, tempo + beat grid + loudest 15 s; for video, Whisper word timestamps.
4. A 720p H.264 proxy with a keyframe every 0.5 s for smooth scrubbing (export always uses the original).

## Customizing

- **How the agent edits:** `server/agent/systemPrompt.js` (rules + reel playbook) and `server/agent/schema.js` (output shape).
- **Faster agent:** `AGENT_MODEL=sonnet npm run dev`.
- **Other languages / better accuracy:** use a multilingual Whisper model, e.g. `WHISPER_MODEL=/path/ggml-small.bin WHISPER_LANG=auto npm run dev`.
- **Colour presets:** CSS in `web/lib/constants.ts`, matching ffmpeg filters in `server/lib/render.js`.
- **Agent tools:** Read only (it looks at contact sheets in the project folder). No shell, web or write access.

## Security

Reel Agent is a local app. The API serves your footage and runs Claude Code on your account, so it listens on `127.0.0.1` only, accepts browser requests only from the editor (`http://localhost:3100`, change with `WEB_ORIGIN`), and rejects any other `Host` header. Don't expose port 4100 to a network.

## License

MIT. See [LICENSE](LICENSE).

import type { CaptionStyleId, FilterId, FontId, TextAnim, TextStyle, TransitionType } from './types';

export const REEL_W = 1080;
export const REEL_H = 1920;
export const FPS = 30;

// CSS versions of the colour presets for the preview. ffmpeg versions live in server/lib/render.js.
export const FILTERS: { id: FilterId; label: string; css: string }[] = [
  { id: 'none', label: 'Original', css: '' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.4) contrast(1.08)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.2) saturate(1.3)' },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.4) contrast(0.92) saturate(0.85) brightness(1.04)' },
  { id: 'mono', label: 'Mono', css: 'grayscale(1) contrast(1.12)' },
  { id: 'cinematic', label: 'Cinematic', css: 'contrast(1.15) saturate(0.85) brightness(0.97)' },
  { id: 'bright', label: 'Bright', css: 'brightness(1.08) contrast(1.05) saturate(1.1)' },
  { id: 'moody', label: 'Moody', css: 'brightness(0.92) contrast(1.2) saturate(0.75)' },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.4) brightness(0.92)' },
  { id: 'pop', label: 'Pop', css: 'saturate(1.7) contrast(1.15)' },
];
export const FILTER_CSS = Object.fromEntries(FILTERS.map((f) => [f.id, f.css])) as Record<FilterId, string>;

export const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: 'cut', label: 'Cut' },
  { id: 'fade', label: 'Crossfade' },
  { id: 'fadeblack', label: 'Dip to black' },
  { id: 'slideleft', label: 'Slide left' },
  { id: 'slideup', label: 'Slide up' },
  { id: 'zoomin', label: 'Zoom' },
  { id: 'circleopen', label: 'Circle' },
];

export const TEXT_STYLES: { id: TextStyle; label: string }[] = [
  { id: 'shadow', label: 'Shadow' },
  { id: 'outline', label: 'Outline' },
  { id: 'box', label: 'Box' },
  { id: 'glow', label: 'Glow' },
];

export const TEXT_ANIMS: { id: TextAnim; label: string }[] = [
  { id: 'pop', label: 'Pop' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide', label: 'Slide up' },
  { id: 'type', label: 'Typewriter' },
  { id: 'none', label: 'None' },
];

export type CaptionStyleDef = {
  label: string;
  font: FontId;
  weight: number;
  color: string;
  active: string;
  stroke?: string;
  strokeW?: number;
  activeBg?: string;
  activeScale?: number;
  glow?: string;
  spoken?: string;
  bar?: string;
  shadow?: boolean;
};

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyleDef> = {
  pop: { label: 'Pop', font: 'montserrat', weight: 900, color: '#ffffff', active: '#ffe14d', stroke: '#000000', strokeW: 0.16, activeScale: 1.12, shadow: true },
  box: { label: 'Box', font: 'montserrat', weight: 800, color: '#ffffff', active: '#ffffff', activeBg: '#7c3aed', stroke: '#000000', strokeW: 0.1 },
  clean: { label: 'Clean', font: 'poppins', weight: 700, color: '#ffffff', active: '#ffffff', shadow: true },
  neon: { label: 'Neon', font: 'montserrat', weight: 800, color: '#e0ffff', active: '#ff3ea5', glow: '#22d3ee' },
  karaoke: { label: 'Karaoke', font: 'poppins', weight: 800, color: 'rgba(255,255,255,0.55)', spoken: '#ffffff', active: '#4ade80', stroke: '#000000', strokeW: 0.1 },
  minimal: { label: 'Minimal', font: 'poppins', weight: 600, color: '#ffffff', active: '#ffffff', bar: 'rgba(0,0,0,0.55)' },
};

export const SWATCHES = ['#ffffff', '#000000', '#ffe14d', '#ff3ea5', '#22d3ee', '#4ade80', '#f97316', '#7c3aed', '#ef4444'];

// Words dropped by "Remove silences".
export const FILLERS = new Set(['um', 'uh', 'uhm', 'umm', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm']);

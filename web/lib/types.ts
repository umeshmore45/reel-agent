export type MediaKind = 'video' | 'image' | 'audio';
export type Word = { start: number; end: number; text: string };

export type Media = {
  id: string;
  kind: MediaKind;
  name: string;
  file: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  status: 'processing' | 'ready' | 'error';
  error?: string;
  thumb?: string;
  sheet?: string;
  proxy?: string;
  proxyPending?: boolean;
  transcript: { status: 'none' | 'pending' | 'done' | 'error'; words: Word[]; text: string; quality?: 'good' | 'low'; error?: string };
  peaks?: number[];
  beats?: number[];
  bpm?: number;
  highlight?: number;
};

export type FilterId = 'none' | 'vivid' | 'warm' | 'vintage' | 'mono' | 'cinematic' | 'bright' | 'moody' | 'noir' | 'pop';
export type TransitionType = 'cut' | 'fade' | 'fadeblack' | 'slideleft' | 'slideup' | 'zoomin' | 'circleopen';
export type FontId = 'montserrat' | 'anton' | 'bebas' | 'poppins' | 'playfair' | 'marker';
export type TextStyle = 'shadow' | 'outline' | 'box' | 'glow';
export type TextAnim = 'none' | 'pop' | 'fade' | 'slide' | 'type';
export type CaptionStyleId = 'pop' | 'box' | 'clean' | 'neon' | 'karaoke' | 'minimal';

export type Clip = {
  id: string;
  mediaId: string;
  in: number;
  out: number;
  speed: number;
  volume: number;
  fit: 'fill' | 'blur';
  focusX: number;
  focusY: number;
  zoom: 'none' | 'in' | 'out' | 'punch';
  zoomAmount: number;
  /** Point the zoom moves toward, 0-1 of the picture (default centre). */
  zoomX?: number;
  zoomY?: number;
  filter: FilterId;
  brightness: number;
  contrast: number;
  saturation: number;
  transition: TransitionType;
  transitionDuration: number;
};

export type TextItem = {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  font: FontId;
  color: string;
  bg: string;
  style: TextStyle;
  anim: TextAnim;
};

export type Captions = {
  enabled: boolean;
  style: CaptionStyleId;
  y: number;
  size: number;
  wordsPerPage: number;
  uppercase: boolean;
  highlight: string;
  overrides: Record<string, string>;
};

export type Music = {
  mediaId: string;
  volume: number;
  start: number;
  fadeIn: number;
  fadeOut: number;
  duck: boolean;
  duckLevel: number;
};

/** Whole-reel finish. letterbox = height of each cinema bar (fraction of the frame). */
export type Look = { letterbox: number; vignette: number; fade: boolean };

export type Timeline = { clips: Clip[]; texts: TextItem[]; captions: Captions; music: Music | null; look?: Look };

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; applied?: boolean };
export type Render = { id: string; file: string; createdAt: string; duration: number; size: number; width: number; height: number; seconds: number };
export type Post = { caption: string; hashtags: string[] };

export type ProjectSummary = { id: string; name: string; createdAt: string; updatedAt: string; thumb: string | null; mediaCount: number };
export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  media: Media[];
  timeline: Timeline;
  chat: ChatMessage[];
  post: Post;
  renders: Render[];
};

export type Selection =
  | { kind: 'clip'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'captions' }
  | { kind: 'music' }
  | null;

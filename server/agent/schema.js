import { CAPTION_STYLES, FILTERS, FONTS, TEXT_ANIMS, TEXT_STYLES, TRANSITIONS } from '../lib/timeline.js';

const n = (description) => ({ type: 'number', description });

/** Structured output the agent must return each turn. The server sanitizes it again before applying. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Short plain-text message to the user: what you did and why, or your question.' },
    timeline: {
      type: 'object',
      description: 'The COMPLETE new timeline. Omit when nothing changes.',
      properties: {
        clips: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              mediaId: { type: 'string' },
              in: n('source start, seconds'),
              out: n('source end, seconds (images: how long to show)'),
              speed: n('0.25-4'),
              volume: n('0-1, clip audio'),
              fit: { type: 'string', enum: ['fill', 'blur'] },
              focusX: n('0-1'),
              focusY: n('0-1'),
              zoom: { type: 'string', enum: ['none', 'in', 'out', 'punch'] },
              zoomAmount: n('0.05-0.3 for in/out, 0.5-2.5 for punch'),
              zoomX: n('0-1: point to zoom toward (x)'),
              zoomY: n('0-1: point to zoom toward (y)'),
              filter: { type: 'string', enum: FILTERS },
              brightness: n('-0.3..0.3'),
              contrast: n('0.5..1.6'),
              saturation: n('0..2'),
              transition: { type: 'string', enum: TRANSITIONS, description: 'into the next clip' },
              transitionDuration: n('0.2-0.6'),
            },
            required: ['mediaId', 'in', 'out'],
          },
        },
        texts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              start: n('reel seconds'),
              end: n('reel seconds'),
              x: n('0-1 center'),
              y: n('0-1 center'),
              size: n('px at 1080 wide'),
              font: { type: 'string', enum: FONTS },
              color: { type: 'string', description: 'hex' },
              bg: { type: 'string', description: 'hex; box/outline/glow colour' },
              style: { type: 'string', enum: TEXT_STYLES },
              anim: { type: 'string', enum: TEXT_ANIMS },
            },
            required: ['text', 'start', 'end'],
          },
        },
        captions: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            style: { type: 'string', enum: CAPTION_STYLES },
            y: n('0-1'),
            size: n('px'),
            wordsPerPage: n('1-4'),
            uppercase: { type: 'boolean' },
            highlight: { type: 'string', description: 'hex, or "" for style default' },
          },
        },
        music: {
          type: ['object', 'null'],
          properties: {
            mediaId: { type: 'string' },
            volume: n('0-1'),
            start: n('seconds into the song'),
            fadeIn: n('s'),
            fadeOut: n('s'),
            duck: { type: 'boolean' },
            duckLevel: n('0.1-0.6'),
          },
        },
        look: {
          type: 'object',
          description: 'Whole-reel finish',
          properties: {
            letterbox: n('0-0.2: height of each black cinema bar as a fraction of the frame'),
            vignette: n('0-1: darkened edges'),
            fade: { type: 'boolean', description: 'fade in from black at the start and out to black at the end' },
          },
        },
      },
      required: ['clips'],
    },
    post: {
      type: 'object',
      properties: {
        caption: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['reply'],
};

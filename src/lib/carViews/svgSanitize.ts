// The engineering car drawings' SVG sanitizer (docs/car-views.md). Pure, no imports: an Admin's upload is checked
// here before it's stored, and again before it's served, and the page only ever inlines what this wrote.
//
// It's an allowlist, not a filter: the file is tokenized, every element, attribute and value must be one this knows,
// and the output is written again from those tokens (so nothing it didn't understand can reach a page). Refused:
// scripts, event handlers, styles sheets, foreignObject, images, filters, text, links, entities and DOCTYPEs, any
// reference that isn't to an id in the same drawing (url(#id), href="#id"), and anything over the size limits.
// Inkscape's and Illustrator's editor metadata is dropped quietly; a style attribute is turned into the attributes it
// sets, each checked the same way.

import type { ViewBox } from './anchors.ts';

export const SVG_LIMITS = { bytes: 400_000, elements: 8_000, depth: 48 } as const;

export type SvgProblem =
  | { code: 'tooLarge' }
  | { code: 'notSvg' }
  | { code: 'malformed' }
  | { code: 'forbiddenMarkup'; detail: string }
  | { code: 'element'; detail: string }
  | { code: 'attribute'; detail: string }
  | { code: 'value'; detail: string }
  | { code: 'eventHandler'; detail: string }
  | { code: 'externalReference'; detail: string }
  | { code: 'text' }
  | { code: 'tooManyElements' }
  | { code: 'tooDeep' }
  | { code: 'viewBox' };

export type SanitizedSvg = { viewBox: ViewBox; inner: string; elements: number };
export type SanitizeResult = { ok: true; svg: SanitizedSvg } | { ok: false; problems: SvgProblem[] };

const ELEMENTS = new Set([
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'use',
  'title',
  'desc',
]);
const TEXT_ELEMENTS = new Set(['title', 'desc']);
// Editor metadata, dropped with everything inside it
const DROPPED_ELEMENTS = /^(metadata|sodipodi:.+|inkscape:.+|rdf:.+|cc:.+|dc:.+)$/;
const DROPPED_ATTRIBUTES = /^(xmlns(:.+)?|version|xml:space|inkscape:.+|sodipodi:.+|data-name|enable-background|baseProfile)$/;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const LENGTH = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?(px|%)?$/;
const NUMBER_LIST = /^[-+0-9.eE,\s]*$/;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$/;
const TRANSFORM = /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\([-+0-9eE.,\s]*\)\s*,?)*\s*$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CLASS = /^[A-Za-z0-9_\- ]{0,200}$/;
const KEYWORD = /^[A-Za-z-]{1,32}$/;
const LOCAL_URL = /^url\(\s*#([A-Za-z][A-Za-z0-9_-]{0,63})\s*\)$/;
const COLOR = /^(none|currentColor|transparent|#[0-9a-fA-F]{3,8}|rgba?\(\s*[0-9.%\s,]+\)|[a-zA-Z]{3,20})$/;
const LAYERS = /^(body|glass|wheels|aero|details|lights)$/;

type Check = (value: string) => boolean;
const paint: Check = (v) => COLOR.test(v) || LOCAL_URL.test(v);
const localRef: Check = (v) => LOCAL_URL.test(v) || v === 'none';
const ATTRIBUTES: Record<string, Check> = {
  id: (v) => ID.test(v),
  class: (v) => CLASS.test(v),
  transform: (v) => TRANSFORM.test(v),
  gradientTransform: (v) => TRANSFORM.test(v),
  patternTransform: (v) => TRANSFORM.test(v),
  fill: paint,
  stroke: paint,
  'stop-color': paint,
  color: paint,
  'fill-opacity': (v) => NUMBER.test(v),
  'stroke-opacity': (v) => NUMBER.test(v),
  'stop-opacity': (v) => NUMBER.test(v),
  opacity: (v) => NUMBER.test(v),
  'stroke-width': (v) => LENGTH.test(v),
  'stroke-miterlimit': (v) => NUMBER.test(v),
  'stroke-dasharray': (v) => v === 'none' || NUMBER_LIST.test(v),
  'stroke-dashoffset': (v) => LENGTH.test(v),
  'stroke-linecap': (v) => KEYWORD.test(v),
  'stroke-linejoin': (v) => KEYWORD.test(v),
  'fill-rule': (v) => KEYWORD.test(v),
  'clip-rule': (v) => KEYWORD.test(v),
  'vector-effect': (v) => KEYWORD.test(v),
  'shape-rendering': (v) => KEYWORD.test(v),
  'paint-order': (v) => /^[a-z ]{1,40}$/.test(v),
  display: (v) => KEYWORD.test(v),
  visibility: (v) => KEYWORD.test(v),
  'clip-path': localRef,
  mask: localRef,
  'data-layer': (v) => LAYERS.test(v),
  'data-part': (v) => /^[a-z][a-z0-9-]{0,40}$/.test(v),
  'data-corner': (v) => /^(LF|RF|LR|RR)$/.test(v),
  d: (v) => PATH_DATA.test(v),
  points: (v) => NUMBER_LIST.test(v),
  x: (v) => LENGTH.test(v),
  y: (v) => LENGTH.test(v),
  width: (v) => LENGTH.test(v),
  height: (v) => LENGTH.test(v),
  rx: (v) => LENGTH.test(v),
  ry: (v) => LENGTH.test(v),
  cx: (v) => LENGTH.test(v),
  cy: (v) => LENGTH.test(v),
  r: (v) => LENGTH.test(v),
  fx: (v) => LENGTH.test(v),
  fy: (v) => LENGTH.test(v),
  x1: (v) => LENGTH.test(v),
  y1: (v) => LENGTH.test(v),
  x2: (v) => LENGTH.test(v),
  y2: (v) => LENGTH.test(v),
  offset: (v) => LENGTH.test(v),
  pathLength: (v) => NUMBER.test(v),
  gradientUnits: (v) => KEYWORD.test(v),
  spreadMethod: (v) => KEYWORD.test(v),
  patternUnits: (v) => KEYWORD.test(v),
  patternContentUnits: (v) => KEYWORD.test(v),
  clipPathUnits: (v) => KEYWORD.test(v),
  maskUnits: (v) => KEYWORD.test(v),
  maskContentUnits: (v) => KEYWORD.test(v),
  viewBox: (v) => NUMBER_LIST.test(v),
  preserveAspectRatio: (v) => /^[A-Za-z ]{1,40}$/.test(v),
  href: (v) => /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v),
};
// Style properties a style attribute may set, turned into these attributes
const STYLE_PROPERTIES = new Set(Object.keys(ATTRIBUTES).filter((k) => !['id', 'class', 'd', 'points', 'href', 'viewBox', 'transform'].includes(k) && !k.startsWith('data-')));

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function parseViewBoxValue(value: string | undefined): ViewBox | null {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0 || width > 1e6 || height > 1e6) return null;
  return { x, y, width, height };
}

const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=<>/"']+(?:\s*=\s*(?:"[^"<]*"|'[^'<]*'))?)*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=<>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

export function sanitizeSvg(source: string): SanitizeResult {
  if (typeof source !== 'string' || source.length > SVG_LIMITS.bytes) return { ok: false, problems: [{ code: 'tooLarge' }] };
  const problems: SvgProblem[] = [];
  let text = source.replace(/^﻿/, '');
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text)) problems.push({ code: 'forbiddenMarkup', detail: 'doctype/entity/cdata' });
  text = text.replace(/^\s*<\?xml[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<\?/.test(text)) problems.push({ code: 'forbiddenMarkup', detail: 'processing instruction' });
  if (/<!--/.test(text)) problems.push({ code: 'malformed' });
  if (problems.length) return { ok: false, problems };

  type Open = { name: string; dropped: boolean; text: boolean };
  const stack: Open[] = [];
  let out = '';
  const root: { viewBox: ViewBox | null } = { viewBox: null };
  let rootSeen = false;
  let rootClosed = false;
  let elements = 0;
  let pos = 0;
  const fail = (p: SvgProblem) => {
    if (problems.length < 20 && !problems.some((q) => q.code === p.code && ('detail' in q ? q.detail : '') === ('detail' in p ? p.detail : ''))) problems.push(p);
  };

  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    const chunk = lt === -1 ? text.slice(pos) : text.slice(pos, lt);
    if (chunk.trim()) {
      const top = stack[stack.length - 1];
      if (!top || rootClosed) fail({ code: 'malformed' });
      else if (top.dropped) {
        // inside editor metadata: ignored
      } else if (top.text) {
        if (/&(?!(amp|lt|gt|quot|apos);)/.test(chunk)) fail({ code: 'forbiddenMarkup', detail: 'entity' });
        else out += escapeText(chunk.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[m] ?? ''));
      } else fail({ code: 'text' });
    }
    if (lt === -1) break;
    TAG.lastIndex = lt;
    const m = TAG.exec(text);
    if (!m) {
      fail({ code: 'malformed' });
      break;
    }
    pos = TAG.lastIndex;
    const [, closing, rawName, rawAttributes, selfClosing] = m;
    const name = rawName;
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name || rawAttributes.trim()) {
        fail({ code: 'malformed' });
        break;
      }
      if (!top.dropped && stack.length > 0) out += `</${name}>`;
      else if (!top.dropped && stack.length === 0) rootClosed = true;
      continue;
    }
    if (rootClosed) {
      fail({ code: 'malformed' });
      break;
    }
    const parentDropped = stack.length > 0 && stack[stack.length - 1].dropped;
    const parentText = stack.length > 0 && stack[stack.length - 1].text;
    if (parentText) {
      fail({ code: 'forbiddenMarkup', detail: `${name} inside text` });
      break;
    }
    if (!rootSeen) {
      if (name !== 'svg') return { ok: false, problems: [{ code: 'notSvg' }] };
      rootSeen = true;
    } else if (name === 'svg') {
      fail({ code: 'element', detail: 'nested svg' });
    }
    const dropped = parentDropped || DROPPED_ELEMENTS.test(name);
    if (!dropped && name !== 'svg' && !ELEMENTS.has(name)) fail({ code: 'element', detail: name });
    if (stack.length >= SVG_LIMITS.depth) {
      fail({ code: 'tooDeep' });
      break;
    }

    const attributes: [string, string][] = [];
    if (!dropped) {
      ATTRIBUTE.lastIndex = 0;
      const seen = new Set<string>();
      const add = (attr: string, value: string) => {
        if (/^on/i.test(attr)) return fail({ code: 'eventHandler', detail: attr });
        if (DROPPED_ATTRIBUTES.test(attr)) return;
        if (name === 'svg') {
          if (attr === 'viewBox') root.viewBox = parseViewBoxValue(value);
          return;
        }
        const key = attr === 'xlink:href' ? 'href' : attr;
        const check = ATTRIBUTES[key];
        if (!check) return fail({ code: 'attribute', detail: `${name} ${attr}` });
        const v = value.trim();
        if (key === 'href' && name !== 'use') return fail({ code: 'externalReference', detail: `${name} ${attr}` });
        if (/url\(/i.test(v) && !LOCAL_URL.test(v)) return fail({ code: 'externalReference', detail: `${name} ${attr}` });
        if (key === 'href' && !check(v)) return fail({ code: 'externalReference', detail: `${name} ${attr}` });
        if (!check(v)) return fail({ code: 'value', detail: `${name} ${attr}` });
        if (seen.has(key)) return;
        seen.add(key);
        attributes.push([key, v]);
      };
      let a: RegExpExecArray | null;
      while ((a = ATTRIBUTE.exec(rawAttributes))) {
        const [, attr, dq, sq] = a;
        const value = dq ?? sq;
        if (value === undefined) {
          fail({ code: 'attribute', detail: `${name} ${attr}` });
          continue;
        }
        if (/[&<]/.test(value)) {
          fail({ code: 'value', detail: `${name} ${attr}` });
          continue;
        }
        if (attr === 'style') {
          for (const declaration of value.split(';')) {
            if (!declaration.trim()) continue;
            const colon = declaration.indexOf(':');
            const prop = colon < 0 ? '' : declaration.slice(0, colon).trim();
            const v = colon < 0 ? '' : declaration.slice(colon + 1).trim();
            if (!prop || /^-inkscape|^font|^text|^letter|^word|^line-height|^writing-mode|^isolation|^mix-blend-mode$/.test(prop)) continue;
            if (!STYLE_PROPERTIES.has(prop)) fail({ code: 'attribute', detail: `${name} style ${prop}` });
            else add(prop, v);
          }
          continue;
        }
        add(attr, value);
      }
    }

    if (!dropped && name !== 'svg') {
      elements++;
      if (elements > SVG_LIMITS.elements) {
        fail({ code: 'tooManyElements' });
        break;
      }
      out += `<${name}${attributes.map(([k, v]) => ` ${k}="${v}"`).join('')}${selfClosing ? '/>' : '>'}`;
    }
    if (!selfClosing) stack.push({ name, dropped, text: TEXT_ELEMENTS.has(name) });
    else if (name === 'svg') rootClosed = true;
  }

  if (!rootSeen) return { ok: false, problems: [{ code: 'notSvg' }] };
  if (stack.length && !problems.length) fail({ code: 'malformed' });
  const viewBox = root.viewBox;
  if (!viewBox) fail({ code: 'viewBox' });
  if (problems.length || !viewBox) return { ok: false, problems };
  return { ok: true, svg: { viewBox, inner: out, elements } };
}

// Gives every id in sanitized markup a prefix, and every reference to one, so two drawings on a page (or two copies of
// one) never share an id. Only for this sanitizer's own output, whose ids and references it knows the shape of
export function scopeIds(inner: string, prefix: string): string {
  const safe = prefix.replace(/[^A-Za-z0-9_-]/g, '');
  return inner
    .replace(/ id="([A-Za-z][A-Za-z0-9_-]*)"/g, ` id="${safe}-$1"`)
    .replace(/url\(\s*#([A-Za-z][A-Za-z0-9_-]*)\s*\)/g, `url(#${safe}-$1)`)
    .replace(/ href="#([A-Za-z][A-Za-z0-9_-]*)"/g, ` href="#${safe}-$1"`);
}

// The layers an engineering drawing may have, which the views show or hide (data-layer on a group)
export const ART_LAYERS = ['body', 'glass', 'wheels', 'aero', 'details', 'lights'] as const;

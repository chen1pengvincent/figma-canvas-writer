// Bounded SVG subset parser: converts a small, self-contained SVG document
// into a Figma VectorNetwork + fills. No scripts, no external references, no
// embedded HTML. Unsupported constructs are rejected with a clear error.
import { appErr, hexToRgb01 } from './util.js';

function parseNumber(text) {
  const value = parseFloat(text);
  if (!Number.isFinite(value)) throw appErr('INVALID_ASSET', 'SVG 数字格式错误: ' + text);
  return value;
}
function splitArgs(d) {
  return d.trim().split(/[\s,]+/).filter(s => s.length > 0);
}
function colorFrom(value) {
  const v = String(value).trim();
  if (v === 'none' || v === 'transparent') return null;
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16) / 255, g: parseInt(m[1].slice(2, 4), 16) / 255, b: parseInt(m[1].slice(4, 6), 16) / 255 };
  m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) return hexToRgb01('#' + m[1]);
  m = v.match(/^rgb\(\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*\)$/i);
  if (m) return { r: Math.min(1, Math.max(0, parseNumber(m[1]) / 255)), g: Math.min(1, Math.max(0, parseNumber(m[2]) / 255)), b: Math.min(1, Math.max(0, parseNumber(m[3]) / 255)) };
  m = v.match(/^rgba\(\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*\)$/i);
  if (m) return { r: Math.min(1, Math.max(0, parseNumber(m[1]) / 255)), g: Math.min(1, Math.max(0, parseNumber(m[2]) / 255)), b: Math.min(1, Math.max(0, parseNumber(m[3]) / 255)), a: Math.min(1, Math.max(0, parseNumber(m[4]))) };
  throw appErr('INVALID_ASSET', '不支持的 SVG 颜色: ' + v.slice(0, 64));
}

function parseTransform(value) {
  const out = { scaleX: 1, scaleY: 1, dx: 0, dy: 0 };
  if (!value) return out;
  const m = String(value).match(/translate\(\s*([-0-9.]+)\s*(?:[, ]\s*([-0-9.]+))?\s*\)/);
  if (m) { out.dx = parseNumber(m[1]); if (m[2] !== undefined) out.dy = parseNumber(m[2]); }
  const s = String(value).match(/scale\(\s*([-0-9.]+)\s*(?:[, ]\s*([-0-9.]+))?\s*\)/);
  if (s) { out.scaleX = parseNumber(s[1]); out.scaleY = s[2] !== undefined ? parseNumber(s[2]) : out.scaleX; }
  const matrix = String(value).match(/matrix\(\s*([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)\s*\)/);
  if (matrix) {
    out.scaleX = parseNumber(matrix[1]); out.scaleY = parseNumber(matrix[4]);
    out.dx = parseNumber(matrix[5]); out.dy = parseNumber(matrix[6]);
  }
  if (/rotate|skew|scaleY/i.test(String(value)) && !m && !s && !matrix) throw appErr('INVALID_ASSET', '不支持的 SVG 变换: ' + String(value).slice(0, 64));
  return out;
}

export function parseSvgToVectors(svgText, options = {}) {
  if (typeof svgText !== 'string' || svgText.length > 4 * 1024 * 1024) throw appErr('INVALID_ASSET', 'SVG 文本不合法或过大');
  if (/<!ENTITY|<script|onload=|href=|url\(|@import/i.test(svgText)) throw appErr('INVALID_ASSET', 'SVG 包含脚本或外部引用，已拒绝');
  const shapes = [];
  const rectRe = /<rect\b([^>]*)\/>|<rect\b([^>]*)><\/rect>/gi;
  const circleRe = /<circle\b([^>]*)\/>|<circle\b([^>]*)><\/circle>/gi;
  const ellipseRe = /<ellipse\b([^>]*)\/>|<ellipse\b([^>]*)><\/ellipse>/gi;
  const lineRe = /<line\b([^>]*)\/>|<line\b([^>]*)><\/line>/gi;
  const polyRe = /<(polygon|polyline)\b([^>]*)\/>/gi;
  const pathRe = /<path\b([^>]*)\/>/gi;
  const attr = (tag, name, fallback = null) => {
    const m = tag.match(new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    return m ? (m[2] ?? m[3] ?? m[4]) : fallback;
  };

  for (const match of svgText.matchAll(rectRe)) {
    const tag = match[1] || match[2];
    const x = parseNumber(attr(tag, 'x', '0')); const y = parseNumber(attr(tag, 'y', '0'));
    const w = parseNumber(attr(tag, 'width', '0')); const h = parseNumber(attr(tag, 'height', '0'));
    if (w <= 0 || h <= 0) continue;
    const t = parseTransform(attr(tag, 'transform'));
    shapes.push({ kind: 'rect', x: x * t.scaleX + t.dx, y: y * t.scaleY + t.dy, w: w * t.scaleX, h: h * t.scaleY,
      fill: attr(tag, 'fill'), fillOpacity: parseNumber(attr(tag, 'fill-opacity', '1')), stroke: attr(tag, 'stroke'), strokeWidth: parseNumber(attr(tag, 'stroke-width', '0')) });
  }
  for (const match of svgText.matchAll(circleRe)) {
    const tag = match[1] || match[2];
    const cx = parseNumber(attr(tag, 'cx', '0')); const cy = parseNumber(attr(tag, 'cy', '0'));
    const r = parseNumber(attr(tag, 'r', '0'));
    if (r <= 0) continue;
    shapes.push({ kind: 'ellipse', x: cx - r, y: cy - r, w: r * 2, h: r * 2,
      fill: attr(tag, 'fill'), fillOpacity: parseNumber(attr(tag, 'fill-opacity', '1')), stroke: attr(tag, 'stroke'), strokeWidth: parseNumber(attr(tag, 'stroke-width', '0')) });
  }
  for (const match of svgText.matchAll(ellipseRe)) {
    const tag = match[1] || match[2];
    const cx = parseNumber(attr(tag, 'cx', '0')); const cy = parseNumber(attr(tag, 'cy', '0'));
    const rx = parseNumber(attr(tag, 'rx', '0')); const ry = parseNumber(attr(tag, 'ry', '0'));
    if (rx <= 0 || ry <= 0) continue;
    shapes.push({ kind: 'ellipse', x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2,
      fill: attr(tag, 'fill'), fillOpacity: parseNumber(attr(tag, 'fill-opacity', '1')), stroke: attr(tag, 'stroke'), strokeWidth: parseNumber(attr(tag, 'stroke-width', '0')) });
  }
  for (const match of svgText.matchAll(lineRe)) {
    const tag = match[1] || match[2];
    const x1 = parseNumber(attr(tag, 'x1', '0')); const y1 = parseNumber(attr(tag, 'y1', '0'));
    const x2 = parseNumber(attr(tag, 'x2', '0')); const y2 = parseNumber(attr(tag, 'y2', '0'));
    if (x1 === x2 && y1 === y2) continue;
    shapes.push({ kind: 'segment', x1, y1, x2, y2,
      stroke: attr(tag, 'stroke'), strokeWidth: parseNumber(attr(tag, 'stroke-width', '1')) });
  }
  for (const match of svgText.matchAll(polyRe)) {
    const tag = match[2];
    const closed = match[1].toLowerCase() === 'polygon';
    const points = splitArgs(attr(tag, 'points', '')).map(parseNumber);
    if (points.length < 4 || points.length % 2 !== 0) continue;
    shapes.push({ kind: 'poly', points, closed,
      fill: attr(tag, 'fill'), fillOpacity: parseNumber(attr(tag, 'fill-opacity', '1')), stroke: attr(tag, 'stroke'), strokeWidth: parseNumber(attr(tag, 'stroke-width', '0')) });
  }
  for (const match of svgText.matchAll(pathRe)) {
    const tag = match[1];
    const d = attr(tag, 'd', '');
    if (!d) continue;
    shapes.push({ kind: 'path', d,
      fill: attr(tag, 'fill'), fillOpacity: parseNumber(attr(tag, 'fill-opacity', '1')), stroke: attr(tag, 'stroke'), strokeWidth: parseNumber(attr(tag, 'stroke-width', '0')) });
  }
  if (shapes.length === 0) throw appErr('INVALID_ASSET', 'SVG 未包含可导入的图形元素');

  const vectors = shapes.map(shape => shapeToVector(shape)).filter(Boolean);
  if (vectors.length === 0) throw appErr('INVALID_ASSET', 'SVG 图形无法转换为可编辑矢量');
  return vectors;
}

function shapeToVector(shape) {
  const vector = { width: 0, height: 0, vectorPaths: [], vectorNetwork: null };
  const paintFrom = (fill) => {
    if (!fill || fill === 'none') return [];
    const color = colorFrom(fill);
    const paint = { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b } };
    if (color.a !== undefined) paint.opacity = color.a * (shape.fillOpacity ?? 1);
    return [paint];
  };
  if (shape.kind === 'rect') {
    vector.width = shape.w; vector.height = shape.h;
    vector.vectorNetwork = {
      vertices: [{ x: 0, y: 0 }, { x: shape.w, y: 0 }, { x: shape.w, y: shape.h }, { x: 0, y: shape.h }],
      segments: [
        { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 },
      ],
      regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }],
    };
    vector.vectorNetwork.vertices.forEach(v => { v.x += shape.x; v.y += shape.y; });
    vector.fills = paintFrom(shape.fill);
  } else if (shape.kind === 'ellipse') {
    const cx = shape.x + shape.w / 2; const cy = shape.y + shape.h / 2;
    const rx = shape.w / 2; const ry = shape.h / 2;
    vector.width = shape.w; vector.height = shape.h;
    const segments = [];
    const points = 48;
    for (let i = 0; i < points; i++) {
      const a = i / points * Math.PI * 2;
      const a2 = (i + 1) / points * Math.PI * 2;
      segments.push({
        start: i, end: i + 1,
        tangentStart: { x: -Math.sin(a) * rx, y: Math.cos(a) * ry },
        tangentEnd: { x: -Math.sin(a2) * rx, y: Math.cos(a2) * ry },
      });
    }
    const vertices = [];
    for (let i = 0; i < points; i++) {
      const a = i / points * Math.PI * 2;
      vertices.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    vertices.push(vertices[0]);
    const loops = [segments.map((_, i) => i)];
    vector.vectorNetwork = { vertices, segments, regions: [{ windingRule: 'NONZERO', loops }] };
    vector.fills = paintFrom(shape.fill);
  } else if (shape.kind === 'poly' || shape.kind === 'path') {
    const points = shape.kind === 'poly' ? shape.points : pathToPoints(shape.d);
    if (!points || points.length < 2) return null;
    const xs = points.map(p => p.x); const ys = points.map(p => p.y);
    const minX = Math.min(...xs); const minY = Math.min(...ys);
    vector.width = Math.max(...xs) - minX; vector.height = Math.max(...ys) - minY;
    const vertices = points.map(p => ({ x: p.x - minX, y: p.y - minY }));
    const count = vertices.length;
    const segments = [];
    for (let i = 0; i < count - 1; i++) segments.push({ start: i, end: i + 1 });
    if (shape.closed !== false) {
      segments.push({ start: count - 1, end: 0 });
      vector.vectorNetwork = { vertices, segments, regions: [{ windingRule: 'NONZERO', loops: [segments.map((_, i) => i)] }] };
    } else {
      vector.vectorNetwork = { vertices, segments, regions: [] };
    }
    vector.fills = paintFrom(shape.fill);
  } else if (shape.kind === 'segment') {
    const minX = Math.min(shape.x1, shape.x2); const minY = Math.min(shape.y1, shape.y2);
    vector.width = Math.abs(shape.x2 - shape.x1) || 1; vector.height = Math.abs(shape.y2 - shape.y1) || 1;
    vector.vectorNetwork = {
      vertices: [{ x: shape.x1 - minX, y: shape.y1 - minY }, { x: shape.x2 - minX, y: shape.y2 - minY }],
      segments: [{ start: 0, end: 1 }], regions: [],
    };
    vector.fills = [];
    if (shape.stroke && shape.stroke !== 'none') {
      const color = colorFrom(shape.stroke);
      vector.strokes = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b } }];
      vector.strokeWeight = shape.strokeWidth || 1;
    }
  } else return null;
  if (shape.stroke && shape.stroke !== 'none' && !vector.strokes) {
    try {
      const color = colorFrom(shape.stroke);
      vector.strokes = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b } }];
      vector.strokeWeight = shape.strokeWidth || 1;
    } catch { /* stroke color unsupported: keep fill only */ }
  }
  return vector;
}

// Parse SVG path data into absolute polyline points. Supports M/L/H/V/C/Q/S/A
// (arcs and curves are flattened with a bounded segment budget) and Z.
function pathToPoints(d) {
  const tokens = d.trim().match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const points = [];
  let x = 0, y = 0, startX = 0, startY = 0, current = 'M';
  let pending = [];
  let cx = 0, cy = 0;
  let i = 0;
  const take = () => {
    while (pending.length > 0) {
      const token = pending.shift();
      if (/^[a-zA-Z]$/.test(token)) { current = token.toUpperCase(); return current; }
      if (token !== '') pending.unshift(token);
      break;
    }
    return null;
  };
  pending = tokens.slice();
  const num = () => {
    while (pending.length && /^[a-zA-Z]$/.test(pending[0])) pending.shift();
    const value = parseNumber(pending.shift());
    if (!Number.isFinite(value)) throw appErr('INVALID_ASSET', 'SVG path 数字不合法');
    return value;
  };
  let segments = 0;
  const emit = (px, py) => {
    points.push({ x: px, y: py });
    if (++segments > 8000) throw appErr('INVALID_ASSET', 'SVG path 过于复杂');
  };
  while (pending.length > 0) {
    const next = pending[0];
    if (/^[a-zA-Z]$/.test(next)) { current = pending.shift(); }
    const upper = current.toUpperCase();
    if (upper === 'M') {
      x = num(); y = num();
      if (current === 'm') { x += points.length ? points[points.length - 1].x : 0; y += points.length ? points[points.length - 1].y : 0; }
      startX = x; startY = y;
      emit(x, y);
      current = current === 'm' ? 'l' : 'L';
    } else if (upper === 'L') {
      x = num(); y = num();
      if (current === 'l') { x += points[points.length - 1].x; y += points[points.length - 1].y; }
      emit(x, y);
    } else if (upper === 'H') {
      x = num();
      if (current === 'h') x += points[points.length - 1].x;
      emit(x, y);
    } else if (upper === 'V') {
      y = num();
      if (current === 'v') y += points[points.length - 1].y;
      emit(x, y);
    } else if (upper === 'C') {
      const c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num();
      const abs = current === 'C';
      const px = points[points.length - 1].x, py = points[points.length - 1].y;
      const ax = abs ? c1x : c1x + px, ay = abs ? c1y : c1y + py;
      const bx = abs ? c2x : c2x + px, by = abs ? c2y : c2y + py;
      const dx = abs ? ex : ex + px, dy = abs ? ey : ey + py;
      const STEPS = 24;
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const u = 1 - t;
        emit(u * u * u * px + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * dx,
          u * u * u * py + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * dy);
      }
      x = dx; y = dy; cx = bx; cy = by;
    } else if (upper === 'S' || upper === 'Q') {
      const c1x = num(), c1y = num(), ex = num(), ey = num();
      const abs = current === upper;
      const px = points[points.length - 1].x, py = points[points.length - 1].y;
      const c0x = upper === 'S' ? (2 * px - cx) : px, c0y = upper === 'S' ? (2 * py - cy) : py;
      const ax = abs ? c1x : c1x + px, ay = abs ? c1y : c1y + py;
      const dx = abs ? ex : ex + px, dy = abs ? ey : ey + py;
      const STEPS = 16;
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const u = 1 - t;
        emit(u * u * px + 2 * u * t * ax + t * t * dx, u * u * py + 2 * u * t * ay + t * t * dy);
      }
      x = dx; y = dy; cx = ax; cy = ay;
    } else if (upper === 'A') {
      const rx = num(), ry = num(), rot = num(), largeArc = num(), sweep = num(), ex = num(), ey = num();
      const abs = current === 'A';
      const px = points[points.length - 1].x, py = points[points.length - 1].y;
      const dx = abs ? ex : ex + px, dy = abs ? ey : ey + py;
      const rad = Math.abs(rot) * Math.PI / 180;
      const cosR = Math.cos(rad), sinR = Math.sin(rad);
      const mx = (px - dx) / 2, my = (py - dy) / 2;
      const tx = cosR * mx + sinR * my, ty = -sinR * mx + cosR * my;
      let lambda = (tx * tx) / (rx * rx) + (ty * ty) / (ry * ry);
      let rr = rx, rry = ry;
      if (lambda > 1) { rr *= Math.sqrt(lambda); rry *= Math.sqrt(lambda); lambda = 1; }
      if (rr <= 0 || rry <= 0) { emit(dx, dy); x = dx; y = dy; continue; }
      const sign = largeArc !== sweep ? 1 : -1;
      const coef = sign * Math.sqrt(Math.max(0, (1 - lambda) / lambda));
      const ccx = coef * (rr * ty) / rry, ccy = coef * -(rry * tx) / rr;
      const centerX = cosR * ccx - sinR * ccy + (px + dx) / 2;
      const centerY = sinR * ccx + cosR * ccy + (py + dy) / 2;
      const angle = (u, v) => {
        let a = Math.atan2(u[1] * rry, u[0] * rr);
        const t2 = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0] * rr, u[1] * rry) * Math.hypot(v[0] * rr, v[1] * rry) || 1);
        if (t2 < -1 || t2 > 1) return a;
        const delta = Math.acos(Math.max(-1, Math.min(1, t2)));
        return sweep === 0 ? a - delta : a + delta;
      };
      const u = [(tx - ccx) / rr, (ty - ccy) / rry];
      const v = [(-tx - ccx) / rr, (-ty - ccy) / rry];
      let start = Math.atan2(u[1], u[0]);
      let delta = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1))));
      if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
      if (sweep === 1 && delta < 0) delta += Math.PI * 2;
      const STEPS = 32;
      for (let s = 1; s <= STEPS; s++) {
        const t = start + delta * s / STEPS;
        const local = [rr * Math.cos(t), rry * Math.sin(t)];
        const gx = cosR * local[0] - sinR * local[1] + centerX;
        const gy = sinR * local[0] + cosR * local[1] + centerY;
        emit(gx, gy);
      }
      x = dx; y = dy;
    } else if (upper === 'Z') {
      if (points.length && (points[points.length - 1].x !== startX || points[points.length - 1].y !== startY)) emit(startX, startY);
    } else {
      throw appErr('INVALID_ASSET', '不支持的 SVG path 命令: ' + current);
    }
  }
  return points.length >= 2 ? points : null;
}

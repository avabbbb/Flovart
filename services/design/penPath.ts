import { fmt } from './svgUtils';

export interface PathPoint {
  x: number;
  y: number;
}

/** 钢笔锚点：in/out 为绝对坐标的控制柄，缺省表示直角点。 */
export interface PathAnchor extends PathPoint {
  in?: PathPoint;
  out?: PathPoint;
}

export interface PathSubpath {
  anchors: PathAnchor[];
  closed: boolean;
}

/** 规范化后的绝对坐标命令：只有 M / L / C / Z。 */
export type NormalizedCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** 逐字符分词：弧线的 large-arc / sweep 标志可以不带分隔符紧挨着写（如 "a10 10 0 0110 10"）。 */
function tokenizePath(d: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let i = 0;
  let command = '';
  let argIndex = 0;
  const isSep = (c: string) => c === ' ' || c === ',' || c === '\n' || c === '\t' || c === '\r';
  while (i < d.length) {
    const c = d[i];
    if (isSep(c)) { i += 1; continue; }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      command = c.toUpperCase();
      argIndex = 0;
      tokens.push(c);
      i += 1;
      continue;
    }
    const arity = ARG_COUNT[command] ?? 0;
    const position = arity ? argIndex % arity : 0;
    if (command === 'A' && (position === 3 || position === 4) && (c === '0' || c === '1')) {
      tokens.push(Number(c));
      argIndex += 1;
      i += 1;
      continue;
    }
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) { i += 1; continue; }
    tokens.push(Number(m[0]));
    argIndex += 1;
    i += m[0].length;
  }
  return tokens;
}

function arcToCubics(x1: number, y1: number, rxIn: number, ryIn: number, angleDeg: number, largeArc: boolean, sweep: boolean, x2: number, y2: number): NormalizedCommand[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ type: 'L', x: x2, y: y2 }];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number) => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  const derivative = (t: number) => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });
  const out: NormalizedCommand[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t1 = theta1 + i * step;
    const t2 = t1 + step;
    const p1 = point(t1);
    const p2 = i === segments - 1 ? { x: x2, y: y2 } : point(t2);
    const d1 = derivative(t1);
    const d2 = derivative(t2);
    out.push({ type: 'C', x1: p1.x + k * d1.x, y1: p1.y + k * d1.y, x2: p2.x - k * d2.x, y2: p2.y - k * d2.y, x: p2.x, y: p2.y });
  }
  return out;
}

/** 解析 SVG path d，输出只含 M/L/C/Z 的绝对坐标命令（H/V→L，S→C，Q/T→C，A→若干 C）。 */
export function parsePath(d: string): NormalizedCommand[] {
  const tokens = tokenizePath(d);
  const out: NormalizedCommand[] = [];
  let i = 0;
  let cmd = '';
  let x = 0; let y = 0;
  let startX = 0; let startY = 0;
  let lastCubic: PathPoint | null = null;
  let lastQuad: PathPoint | null = null;
  const num = () => {
    const value = tokens[i];
    i += 1;
    return typeof value === 'number' ? value : NaN;
  };
  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === 'string') { cmd = token; i += 1; }
    else if (!cmd) { i += 1; continue; }
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (upper === 'Z') {
      out.push({ type: 'Z' });
      x = startX; y = startY;
      lastCubic = null; lastQuad = null;
      continue;
    }
    const arity = ARG_COUNT[upper];
    if (arity === undefined) { i += 1; continue; }
    const args = tokens.slice(i, i + arity);
    if (args.length < arity || args.some(t => typeof t !== 'number')) {
      // 参数不足：跳过残缺命令
      while (i < tokens.length && typeof tokens[i] === 'number') i += 1;
      continue;
    }
    let nextCubic: PathPoint | null = null;
    let nextQuad: PathPoint | null = null;
    switch (upper) {
      case 'M': {
        x = ox + num(); y = oy + num();
        startX = x; startY = y;
        out.push({ type: 'M', x, y });
        // 后续隐式坐标视作 L
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': x = ox + num(); y = oy + num(); out.push({ type: 'L', x, y }); break;
      case 'H': x = ox + num(); out.push({ type: 'L', x, y }); break;
      case 'V': y = oy + num(); out.push({ type: 'L', x, y }); break;
      case 'C': {
        const x1 = ox + num(); const y1 = oy + num();
        const x2 = ox + num(); const y2 = oy + num();
        x = ox + num(); y = oy + num();
        out.push({ type: 'C', x1, y1, x2, y2, x, y });
        nextCubic = { x: x2, y: y2 };
        break;
      }
      case 'S': {
        const x1 = lastCubic ? 2 * x - lastCubic.x : x;
        const y1 = lastCubic ? 2 * y - lastCubic.y : y;
        const x2 = ox + num(); const y2 = oy + num();
        x = ox + num(); y = oy + num();
        out.push({ type: 'C', x1, y1, x2, y2, x, y });
        nextCubic = { x: x2, y: y2 };
        break;
      }
      case 'Q':
      case 'T': {
        const qx: number = upper === 'Q' ? ox + num() : lastQuad ? 2 * x - lastQuad.x : x;
        const qy: number = upper === 'Q' ? oy + num() : lastQuad ? 2 * y - lastQuad.y : y;
        const ex = ox + num(); const ey = oy + num();
        out.push({ type: 'C', x1: x + (2 / 3) * (qx - x), y1: y + (2 / 3) * (qy - y), x2: ex + (2 / 3) * (qx - ex), y2: ey + (2 / 3) * (qy - ey), x: ex, y: ey });
        x = ex; y = ey;
        nextQuad = { x: qx, y: qy };
        break;
      }
      case 'A': {
        const rx = num(); const ry = num(); const rot = num();
        const large = num() !== 0; const sweep = num() !== 0;
        const ex = ox + num(); const ey = oy + num();
        out.push(...arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey));
        x = ex; y = ey;
        break;
      }
    }
    lastCubic = nextCubic;
    lastQuad = nextQuad;
  }
  return out;
}

export function serializeCommands(commands: readonly NormalizedCommand[]): string {
  return commands.map(c => {
    switch (c.type) {
      case 'M': return `M${fmt(c.x)} ${fmt(c.y)}`;
      case 'L': return `L${fmt(c.x)} ${fmt(c.y)}`;
      case 'C': return `C${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`;
      case 'Z': return 'Z';
    }
  }).join(' ');
}

function same(a: PathPoint | undefined, b: PathPoint): boolean {
  return !!a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/** 锚点 → path d。相邻两点任一有控制柄时输出 C，否则输出 L。 */
export function anchorsToPath(subpaths: readonly PathSubpath[]): string {
  const parts: string[] = [];
  for (const { anchors, closed } of subpaths) {
    if (anchors.length === 0) continue;
    const commands: NormalizedCommand[] = [{ type: 'M', x: anchors[0].x, y: anchors[0].y }];
    const segment = (a: PathAnchor, b: PathAnchor) => {
      const hasCurve = (a.out && !same(a.out, a)) || (b.in && !same(b.in, b));
      if (!hasCurve) commands.push({ type: 'L', x: b.x, y: b.y });
      else commands.push({ type: 'C', x1: (a.out ?? a).x, y1: (a.out ?? a).y, x2: (b.in ?? b).x, y2: (b.in ?? b).y, x: b.x, y: b.y });
    };
    for (let i = 1; i < anchors.length; i += 1) segment(anchors[i - 1], anchors[i]);
    if (closed && anchors.length > 1) {
      const last = anchors[anchors.length - 1];
      const first = anchors[0];
      if ((last.out && !same(last.out, last)) || (first.in && !same(first.in, first))) segment(last, first);
      commands.push({ type: 'Z' });
    }
    parts.push(serializeCommands(commands));
  }
  return parts.join(' ');
}

/** path d → 锚点（每个子路径一组）。闭合子路径末尾与起点重合的锚点会被合并。 */
export function pathToAnchors(d: string): PathSubpath[] {
  const result: PathSubpath[] = [];
  // 断言初始值：current 在闭包 flush 里被重置，避免控制流把它收窄成 null。
  let current = null as PathSubpath | null;
  const flush = () => { if (current && current.anchors.length) result.push(current); current = null; };
  for (const c of parsePath(d)) {
    if (c.type === 'M') { flush(); current = { anchors: [{ x: c.x, y: c.y }], closed: false }; continue; }
    if (!current) current = { anchors: [{ x: 0, y: 0 }], closed: false };
    const sub: PathSubpath = current;
    if (c.type === 'Z') {
      const first = sub.anchors[0];
      const last = sub.anchors[sub.anchors.length - 1];
      if (sub.anchors.length > 1 && same(last, first)) {
        if (last.in) first.in = last.in;
        sub.anchors.pop();
      }
      sub.closed = true;
      const restart = { x: first.x, y: first.y };
      flush();
      current = { anchors: [restart], closed: false };
      continue;
    }
    const prev = sub.anchors[sub.anchors.length - 1];
    if (c.type === 'L') sub.anchors.push({ x: c.x, y: c.y });
    else {
      prev.out = { x: c.x1, y: c.y1 };
      sub.anchors.push({ x: c.x, y: c.y, in: { x: c.x2, y: c.y2 } });
    }
  }
  // 末尾只有 Z 之后留下的单个起点，不是有效子路径
  const tail = current;
  if (tail && tail.anchors.length > 1) result.push(tail);
  return result;
}

export interface SampledPolygon {
  points: Array<[number, number]>;
  closed: boolean;
}

/** 把路径采样成折线；曲线每段 segments 个采样点。 */
export function samplePath(d: string, segments = 16): SampledPolygon[] {
  const polygons: SampledPolygon[] = [];
  let current = null as SampledPolygon | null;
  let x = 0; let y = 0;
  let startX = 0; let startY = 0;
  const push = (px: number, py: number) => {
    if (!current) current = { points: [[x, y]], closed: false };
    current.points.push([px, py]);
  };
  const flush = () => { if (current && current.points.length > 1) polygons.push(current); current = null; };
  for (const c of parsePath(d)) {
    switch (c.type) {
      case 'M': flush(); current = { points: [[c.x, c.y]], closed: false }; x = startX = c.x; y = startY = c.y; break;
      case 'L': push(c.x, c.y); x = c.x; y = c.y; break;
      case 'C':
        for (let s = 1; s <= segments; s += 1) {
          const t = s / segments;
          const mt = 1 - t;
          push(
            mt * mt * mt * x + 3 * mt * mt * t * c.x1 + 3 * mt * t * t * c.x2 + t * t * t * c.x,
            mt * mt * mt * y + 3 * mt * mt * t * c.y1 + 3 * mt * t * t * c.y2 + t * t * t * c.y,
          );
        }
        x = c.x; y = c.y;
        break;
      case 'Z':
        if (current) current.closed = true;
        flush();
        x = startX; y = startY;
        break;
    }
  }
  flush();
  return polygons;
}

export function pathBounds(d: string): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const polygon of samplePath(d, 24)) {
    for (const [px, py] of polygon.points) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 平移并缩放路径（用于把路径从一个坐标系映射到另一个）。 */
export function transformPath(d: string, map: (p: PathPoint) => PathPoint): string {
  return serializeCommands(parsePath(d).map(c => {
    if (c.type === 'Z') return c;
    if (c.type === 'C') {
      const p1 = map({ x: c.x1, y: c.y1 });
      const p2 = map({ x: c.x2, y: c.y2 });
      const p = map({ x: c.x, y: c.y });
      return { type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
    }
    const p = map({ x: c.x, y: c.y });
    return { ...c, x: p.x, y: p.y };
  }));
}

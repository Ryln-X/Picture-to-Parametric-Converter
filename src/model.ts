export type XY = { x: number; y: number };
export type Point = XY & { id: string; incoming?: XY; outgoing?: XY };
export type Anchor = { id: string; position: number; value: number };
export type Axis = { label: string; unit: string; scale: 'linear' | 'log'; anchors: Anchor[] };
export type ImageLayer = {
  data: string; name: string; width: number; height: number;
  x: number; y: number; scale: number; rotation: number;
};
export type Project = {
  version: 1;
  image: ImageLayer | null;
  xAxis: Axis;
  yAxis: Axis;
  points: Point[];
  interpolation: 'straight' | 'smooth' | 'bezier';
  offset: number;
  veil: number;
};

export const uid = () => crypto.randomUUID();
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const defaultProject = (): Project => ({
  version: 1, image: null, points: [], interpolation: 'straight', offset: 0, veil: 0.22,
  xAxis: { label: 'Frequency', unit: 'Hz', scale: 'log', anchors: [
    { id: uid(), position: 0.08, value: 20 }, { id: uid(), position: 0.94, value: 20000 },
  ] },
  yAxis: { label: 'Level', unit: 'dB', scale: 'linear', anchors: [
    { id: uid(), position: 0.08, value: 120 }, { id: uid(), position: 0.88, value: 40 },
  ] },
});

const transformed = (value: number, axis: Axis) => axis.scale === 'log' ? Math.log10(value) : value;
const untransformed = (value: number, axis: Axis) => axis.scale === 'log' ? 10 ** value : value;
export const sortedAnchors = (axis: Axis) => [...axis.anchors].sort((a, b) => a.position - b.position);

export function axisError(axis: Axis): string | null {
  if (axis.anchors.length < 2) return 'Add at least two references.';
  const anchors = sortedAnchors(axis);
  if (anchors.some(a => !Number.isFinite(a.position) || a.position < 0 || a.position > 1 || !Number.isFinite(a.value))) return 'Enter finite values within the image.';
  if (axis.scale === 'log' && anchors.some(a => a.value <= 0)) return 'Logarithmic values must be positive.';
  const direction = Math.sign(anchors[1].value - anchors[0].value);
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].position - anchors[i - 1].position < 0.0001) return 'Reference lines must be separated.';
    if (!direction || Math.sign(anchors[i].value - anchors[i - 1].value) !== direction) return 'Values must increase or decrease consistently.';
  }
  return null;
}

// Interpolate between each pair of references, allowing nonuniform image axes.
export function valueAt(position: number, axis: Axis): number {
  if (axisError(axis)) return NaN;
  const anchors = sortedAnchors(axis);
  let index = anchors.findIndex(a => a.position > position) - 1;
  if (index < 0) index = position < anchors[0].position ? 0 : anchors.length - 2;
  index = Math.min(index, anchors.length - 2);
  const a = anchors[index], b = anchors[index + 1];
  const t = (position - a.position) / (b.position - a.position);
  return untransformed(transformed(a.value, axis) + t * (transformed(b.value, axis) - transformed(a.value, axis)), axis);
}

export function positionAt(value: number, axis: Axis): number {
  if (axisError(axis) || !Number.isFinite(value) || (axis.scale === 'log' && value <= 0)) return NaN;
  const anchors = sortedAnchors(axis);
  const increasing = anchors[1].value > anchors[0].value;
  let index = anchors.findIndex(a => increasing ? a.value > value : a.value < value) - 1;
  if (index < 0) index = (increasing ? value < anchors[0].value : value > anchors[0].value) ? 0 : anchors.length - 2;
  index = Math.min(index, anchors.length - 2);
  const a = anchors[index], b = anchors[index + 1];
  const t = (transformed(value, axis) - transformed(a.value, axis)) / (transformed(b.value, axis) - transformed(a.value, axis));
  return a.position + t * (b.position - a.position);
}

export function moveAnchor(axis: Axis, id: string, position: number): Axis {
  const sorted = sortedAnchors(axis);
  const i = sorted.findIndex(a => a.id === id);
  if (i < 0) return axis;
  const bounded = clamp(position, i > 0 ? sorted[i - 1].position + 0.002 : 0, i < sorted.length - 1 ? sorted[i + 1].position - 0.002 : 1);
  return { ...axis, anchors: axis.anchors.map(a => a.id === id ? { ...a, position: bounded } : a) };
}

export type Segment = { a: XY; b: XY; c: XY; d: XY };
const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function segments(points: Point[], mode: Project['interpolation']): Segment[] {
  const direction = Math.sign((points.at(-1)?.x ?? 0) - (points[0]?.x ?? 0));
  const monotone = !!direction && points.every((p, i) => !i || (p.x - points[i - 1].x) * direction > 1e-8);
  return points.slice(0, -1).map((a, i) => {
    const d = points[i + 1];
    if (mode === 'straight') return { a, b: lerp(a, d, 1 / 3), c: lerp(a, d, 2 / 3), d };
    if (mode === 'bezier') return { a, b: a.outgoing ?? lerp(a, d, 1 / 3), c: d.incoming ?? lerp(a, d, 2 / 3), d };
    if (!monotone) {
      const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 2)];
      return { a, b: { x: a.x + (d.x - previous.x) / 6, y: a.y + (d.y - previous.y) / 6 },
        c: { x: d.x - (next.x - a.x) / 6, y: d.y - (next.y - a.y) / 6 }, d };
    }
    // Shape-preserving Hermite slopes keep a frequency curve from overshooting peaks.
    const slope = (j: number) => {
      const p = points[Math.max(0, j - 1)], q = points[j], r = points[Math.min(points.length - 1, j + 1)];
      const left = (q.y - p.y) / (q.x - p.x || 1e-8), right = (r.y - q.y) / (r.x - q.x || 1e-8);
      if (j === 0) return right;
      if (j === points.length - 1) return left;
      return left * right <= 0 ? 0 : 2 * left * right / (left + right);
    };
    const dx = (d.x - a.x) / 3;
    return { a, b: { x: a.x + dx, y: a.y + slope(i) * dx }, c: { x: d.x - dx, y: d.y - slope(i + 1) * dx }, d };
  });
}

export function cubic(s: Segment, t: number): XY {
  const u = 1 - t;
  return { x: u ** 3 * s.a.x + 3 * u ** 2 * t * s.b.x + 3 * u * t ** 2 * s.c.x + t ** 3 * s.d.x,
    y: u ** 3 * s.a.y + 3 * u ** 2 * t * s.b.y + 3 * u * t ** 2 * s.c.y + t ** 3 * s.d.y };
}

export function pathData(points: Point[], mode: Project['interpolation'], width: number, height: number): string {
  if (!points.length) return '';
  return `M ${points[0].x * width} ${points[0].y * height} ` + segments(points, mode).map(s =>
    `C ${s.b.x * width} ${s.b.y * height} ${s.c.x * width} ${s.c.y * height} ${s.d.x * width} ${s.d.y * height}`).join(' ');
}

// Split the nearest cubic segment without changing its shape.
export function insertPoint(points: Point[], point: Point, mode: Project['interpolation']): Point[] {
  if (points.length < 2) return [...points, point];
  let best = { distance: Infinity, index: 0, t: 0.5 };
  const curves = segments(points, mode);
  curves.forEach((s, index) => {
    for (let step = 1; step < 100; step++) {
      const t = step / 100, p = cubic(s, t), distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance < best.distance) best = { distance, index, t };
    }
  });
  const result = [...points];
  if (mode === 'bezier') {
    const s = curves[best.index], t = best.t;
    const ab = lerp(s.a, s.b, t), bc = lerp(s.b, s.c, t), cd = lerp(s.c, s.d, t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), center = lerp(abc, bcd, t);
    const delta = { x: point.x - center.x, y: point.y - center.y };
    result[best.index] = { ...result[best.index], outgoing: ab };
    result[best.index + 1] = { ...result[best.index + 1], incoming: cd };
    point = { ...point, incoming: { x: abc.x + delta.x, y: abc.y + delta.y }, outgoing: { x: bcd.x + delta.x, y: bcd.y + delta.y } };
  }
  result.splice(best.index + 1, 0, point);
  return result;
}

export function movePoint(point: Point, to: XY): Point {
  const dx = to.x - point.x, dy = to.y - point.y;
  const shift = (p: XY | undefined) => p ? { x: p.x + dx, y: p.y + dy } : undefined;
  return { ...point, ...to, incoming: shift(point.incoming), outgoing: shift(point.outgoing) };
}

export type Row = { x: number; y: number };
export function exportRows(project: Project, samples = 0): Row[] {
  if (axisError(project.xAxis) || axisError(project.yAxis)) throw new Error('Fix the axis references before exporting.');
  let pixels: XY[] = project.points;
  if (samples > 1 && project.points.length > 1) {
    const curves = segments(project.points, project.interpolation);
    // Uniform distance along the drawn path, rather than a density tied to anchor count.
    const dense = curves.flatMap((s, i) => Array.from({ length: 201 }, (_, j) => ({ ...cubic(s, j / 200), duplicate: i > 0 && j === 0 }))).filter(p => !p.duplicate);
    const lengths = [0];
    for (let i = 1; i < dense.length; i++) lengths[i] = lengths[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
    let j = 1;
    pixels = Array.from({ length: samples }, (_, i) => {
      const target = lengths[lengths.length - 1] * i / (samples - 1);
      while (j < dense.length - 1 && lengths[j] < target) j++;
      return lerp(dense[j - 1], dense[j], (target - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1));
    });
  }
  const rows = pixels.map(p => ({ x: valueAt(p.x, project.xAxis), y: valueAt(p.y, project.yAxis) - project.offset }));
  if (rows.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('The current scale produces values outside the numeric range.');
  return rows;
}

export function parseData(text: string): Row[] {
  const rows: Row[] = [];
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return;
    const fields = trimmed.split(/[,\t ]+/);
    if (fields.length === 2 && fields.every(s => Number.isFinite(Number(s)))) rows.push({ x: Number(fields[0]), y: Number(fields[1]) });
    else if (!rows.length && /[a-zA-Z]/.test(trimmed)) return;
    else throw new Error(`Invalid data at line ${i + 1}. Use two numeric columns.`);
  });
  if (rows.length < 2) throw new Error('The file needs at least two numeric rows.');
  if (rows.length > 20000) throw new Error('Import up to 20,000 rows at a time.');
  return rows;
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toPrecision(7)).toString();
}

export function validateProject(input: unknown): Project {
  const p = input as Project;
  if (!p || p.version !== 1 || !Array.isArray(p.points) || p.points.length > 20000 || !['straight', 'smooth', 'bezier'].includes(p.interpolation)) throw new Error('This is not a supported graph project.');
  for (const axis of [p.xAxis, p.yAxis]) {
    if (!axis || !['log', 'linear'].includes(axis.scale) || typeof axis.label !== 'string' || typeof axis.unit !== 'string' || !Array.isArray(axis.anchors) || axis.anchors.length > 100 || axisError(axis)) throw new Error('Invalid axis calibration in this project.');
    if (new Set(axis.anchors.map(a => a.id)).size !== axis.anchors.length || axis.anchors.some(a => typeof a.id !== 'string')) throw new Error('Invalid axis references.');
  }
  const validXY = (xy: XY) => xy && Number.isFinite(xy.x) && Number.isFinite(xy.y) && Math.abs(xy.x) <= 10 && Math.abs(xy.y) <= 10;
  if (new Set(p.points.map(point => point.id)).size !== p.points.length || p.points.some(point => typeof point.id !== 'string' || !validXY(point) || (point.incoming && !validXY(point.incoming)) || (point.outgoing && !validXY(point.outgoing)))) throw new Error('Invalid points in this project.');
  if (!Number.isFinite(p.offset) || !Number.isFinite(p.veil) || p.veil < 0 || p.veil > 1) throw new Error('Invalid project settings.');
  if (p.image && (!/^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,/.test(p.image.data) || typeof p.image.name !== 'string' || !Number.isFinite(p.image.width) || !Number.isFinite(p.image.height) || p.image.width <= 0 || p.image.height <= 0 || p.image.width / p.image.height < .1 || p.image.width / p.image.height > 10 || p.image.width * p.image.height > 50000000 || ![p.image.x, p.image.y, p.image.scale, p.image.rotation].every(Number.isFinite) || p.image.scale <= 0 || p.image.scale > 10)) throw new Error('Invalid image in this project.');
  return p;
}

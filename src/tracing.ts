import { cubic, segments, type Point, type Project, type XY } from './model';

export type TraceOptions = {
  radius: number;
  spacing: number;
  adaptive: boolean;
  color: string | null;
};
export type TraceInput = { pixels: Uint8ClampedArray; width: number; height: number; points: Point[]; interpolation: Project['interpolation']; options: TraceOptions };

function simplify(points: XY[], tolerance: number): XY[] {
  const retained = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first], b = points[last], dx = b.x - a.x, dy = b.y - a.y;
    let distance = tolerance, index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i], t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (d > distance) { distance = d; index = i; }
    }
    if (index !== -1) { retained.add(index); stack.push([first, index], [index, last]); }
  }
  return [...retained].sort((a, b) => a - b).map(i => points[i]);
}

export function traceImage({ pixels, width, height, points, interpolation, options }: TraceInput): { points: XY[]; confidence: number } {
  if (points.length < 2) throw new Error('Sketch a guide with at least two points first.');
  const guide = segments(points, interpolation).flatMap(s => Array.from({ length: 101 }, (_, i) => cubic(s, i / 100)));
  if (guide.some((p, i) => i > 0 && p.x < guide[i - 1].x - 0.0001)) throw new Error('For auto trace, draw the guide from left to right without loops.');
  const start = Math.max(0, Math.round(guide[0].x * (width - 1))), end = Math.min(width - 1, Math.round(guide.at(-1)!.x * (width - 1)));
  if (end - start < 4) throw new Error('Extend the guide horizontally before tracing.');
  const color = options.color ? [1, 3, 5].map(i => parseInt(options.color!.slice(i, i + 2), 16)) : null;
  const radius = Math.max(2, Math.min(80, Math.round(options.radius)));
  const window = radius * 2 + 1, count = end - start + 1;
  const origins = new Int32Array(count), back = new Int16Array(count * window);
  let previous = new Float64Array(window).fill(0), guideIndex = 1;
  const darkness = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    const offset = (y * width + x) * 4;
    return 1 - (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
  };
  const evidence = (x: number, y: number) => {
    if (y < 0 || y >= height) return 0;
    const o = (y * width + x) * 4;
    if (color) {
      const distance = Math.hypot(pixels[o] - color[0], pixels[o + 1] - color[1], pixels[o + 2] - color[2]) / 441.673;
      return Math.max(0, 1 - distance * 3);
    }
    return darkness(x, y);
  };
  for (let x = start; x <= end; x++) {
    const n = x - start, normalized = x / (width - 1);
    while (guideIndex < guide.length - 1 && guide[guideIndex].x < normalized) guideIndex++;
    const a = guide[guideIndex - 1], b = guide[guideIndex];
    const expected = (a.y + (b.y - a.y) * (normalized - a.x) / (b.x - a.x || 1)) * (height - 1);
    origins[n] = Math.round(expected) - radius;
    const next = new Float64Array(window).fill(Infinity);
    for (let j = 0; j < window; j++) {
      const y = origins[n] + j;
      if (y < 0 || y >= height) continue;
      const strength = Math.max(evidence(x, y), evidence(x, y - 1) * 0.75, evidence(x, y + 1) * 0.75);
      // Full-height grid lines are poor evidence. Neighbor columns preserve a crossing curve.
      const vertical = (darkness(x, y - radius - 4) + darkness(x, y + radius + 4)) / 2;
      const neighboring = (evidence(x - 2, y) + evidence(x + 2, y)) / 2;
      const imageCost = 1 - strength + (!color ? Math.max(0, vertical - neighboring) * 0.5 : 0);
      const cost = imageCost + ((y - expected) / radius) ** 2 * 0.42;
      if (!n) { next[j] = cost; continue; }
      const previousY = y - origins[n - 1];
      let best = Infinity, chosen = 0;
      for (let k = Math.max(0, previousY - 5); k <= Math.min(window - 1, previousY + 5); k++) {
        const jump = y - (origins[n - 1] + k);
        const candidate = previous[k] + jump * jump * 0.075;
        if (candidate < best) { best = candidate; chosen = k; }
      }
      next[j] = cost + best;
      back[n * window + j] = chosen;
    }
    previous = next;
  }
  let index = 0;
  for (let j = 1; j < window; j++) if (previous[j] < previous[index]) index = j;
  if (!Number.isFinite(previous[index])) throw new Error('The guide leaves the image. Move it inside the image and retry.');
  const full: XY[] = Array(count);
  let confidence = 0;
  for (let n = count - 1; n >= 0; n--) {
    const y = origins[n] + index;
    full[n] = { x: (start + n) / (width - 1), y: y / (height - 1) };
    confidence += evidence(start + n, y);
    index = back[n * window + index];
  }
  confidence /= count;
  if (confidence < 0.16) throw new Error('No clear line found near the guide. Move the sketch closer, pick a line color, or increase the search width.');
  const spacing = Math.max(2, Math.min(100, Math.round(options.spacing)));
  // In adaptive mode the tolerance controls detail; straight sections need fewer points.
  const result = options.adaptive
    ? simplify(full.map(p => ({ x: p.x * width, y: p.y * height })), Math.max(0.65, spacing / 6)).map(p => ({ x: p.x / width, y: p.y / height }))
    : full.filter((_, i) => i % spacing === 0 || i === full.length - 1);
  return { points: result, confidence };
}

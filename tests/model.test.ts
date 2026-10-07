import { describe, expect, it } from 'vitest';
import { axisError, cubic, defaultProject, exportRows, insertPoint, moveAnchor, movePoint, parseData, positionAt, segments, validateProject, valueAt, type Axis } from '../src/model';
import { traceImage } from '../src/tracing';

const project = () => defaultProject();
describe('axis calibration', () => {
  it('maps frequency logarithmically and dB linearly', () => {
    const p = project();
    expect(valueAt(0.51, p.xAxis)).toBeCloseTo(Math.sqrt(20 * 20000));
    expect(valueAt(0.48, p.yAxis)).toBeCloseTo(80);
    expect(positionAt(2000, p.xAxis)).toBeCloseTo(0.08 + 0.86 * 2 / 3);
  });
  it('round-trips nonuniform references and values beyond endpoints', () => {
    const axis: Axis = { label: 'Frequency', unit: 'Hz', scale: 'log', anchors: [{ id: 'a', position: .1, value: 20 }, { id: 'b', position: .6, value: 500 }, { id: 'c', position: .9, value: 20000 }] };
    for (const n of [10, 20, 100, 500, 1000, 20000, 30000]) expect(valueAt(positionAt(n, axis), axis)).toBeCloseTo(n, 5);
    expect(valueAt(.6, axis)).toBeCloseTo(500);
  });
  it('moves references without changing traced positions', () => {
    const p = project();
    p.points = [{ id: 'p', x: .51, y: .48 }];
    const before = valueAt(p.points[0].x, p.xAxis);
    const changed = moveAnchor(p.xAxis, p.xAxis.anchors[1].id, .8);
    expect(valueAt(p.points[0].x, changed)).not.toBeCloseTo(before);
    expect(p.points[0]).toEqual({ id: 'p', x: .51, y: .48 });
    expect(moveAnchor(changed, changed.anchors[0].id, 1).anchors[0].position).toBeLessThan(.8);
  });
  it('rejects crossed values, duplicate positions and nonpositive log values', () => {
    const p = project();
    expect(axisError({ ...p.xAxis, anchors: [...p.xAxis.anchors, { id: 'c', position: .5, value: 40000 }] })).toMatch(/consistently/);
    expect(axisError({ ...p.yAxis, anchors: [{ id: 'a', value: 1, position: .2 }, { id: 'b', value: 2, position: .2 }] })).toMatch(/separated/);
    expect(axisError({ ...p.xAxis, anchors: [{ id: 'a', value: 0, position: .2 }, { id: 'b', value: 2, position: .8 }] })).toMatch(/positive/);
  });
});

describe('editable curves and exports', () => {
  it('inserts on the nearest segment instead of appending', () => {
    const points = [{ id: 'a', x: .1, y: .5 }, { id: 'b', x: .5, y: .4 }, { id: 'c', x: .9, y: .7 }];
    expect(insertPoint(points, { id: 'new', x: .3, y: .45 }, 'straight').map(p => p.id)).toEqual(['a', 'new', 'b', 'c']);
  });
  it('splits a Bézier without losing its shape', () => {
    const points = [{ id: 'a', x: .1, y: .5, outgoing: { x: .3, y: .1 } }, { id: 'b', x: .9, y: .5, incoming: { x: .7, y: .9 } }];
    const original = segments(points, 'bezier')[0], center = cubic(original, .5);
    const split = segments(insertPoint(points, { id: 'new', ...center }, 'bezier'), 'bezier');
    for (const t of [.1, .2, .4, .7, .9]) {
      const expected = cubic(original, t), actual = t < .5 ? cubic(split[0], t * 2) : cubic(split[1], (t - .5) * 2);
      expect(actual.x).toBeCloseTo(expected.x, 6); expect(actual.y).toBeCloseTo(expected.y, 6);
    }
  });
  it('moves both control handles with an anchor', () => {
    const moved = movePoint({ id: 'a', x: .5, y: .5, incoming: { x: .4, y: .4 }, outgoing: { x: .6, y: .6 } }, { x: .6, y: .7 });
    expect(moved.incoming!.x).toBeCloseTo(.5); expect(moved.outgoing!.y).toBeCloseTo(.8);
  });
  it('smooths general paths with vertical segments without unbounded handles', () => {
    const points = [{ id: 'a', x: .2, y: .1 }, { id: 'b', x: .2, y: .5 }, { id: 'c', x: .8, y: .6 }, { id: 'd', x: .3, y: .9 }];
    for (const s of segments(points, 'smooth')) for (const handle of [s.b, s.c]) {
      expect(handle.x).toBeGreaterThan(-.5); expect(handle.x).toBeLessThan(1.5);
      expect(handle.y).toBeGreaterThan(-.5); expect(handle.y).toBeLessThan(1.5);
    }
  });
  it('samples the actual curve and subtracts the offset once', () => {
    const p = project(); p.points = [{ id: 'a', x: .08, y: .08, outgoing: { x: .3, y: .8 } }, { id: 'b', x: .94, y: .08, incoming: { x: .7, y: .8 } }]; p.interpolation = 'bezier'; p.offset = 100;
    const rows = exportRows(p, 101);
    expect(rows).toHaveLength(101); expect(rows[0].x).toBeCloseTo(20); expect(rows[100].x).toBeCloseTo(20000);
    expect(rows[0].y).toBeCloseTo(20); expect(rows[50].y).toBeLessThan(-20);
    expect(p.points[0].y).toBe(.08);
  });
  it('parses plain, CSV and TSV two-column data with comments', () => {
    expect(parseData('50.000 119.38\n53.285 119.23\n')).toEqual([{ x: 50, y: 119.38 }, { x: 53.285, y: 119.23 }]);
    expect(parseData('# response\nFrequency,Level\n100,2\n200,3')).toHaveLength(2);
    expect(parseData('100\t2\n200\t3')).toHaveLength(2);
    expect(() => parseData('1 2\n3 broken')).toThrow(/line 2/);
  });
  it('validates project round trips and rejects unsafe image URLs', () => {
    const p = project(); expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => validateProject({ ...p, image: { data: 'https://example.com/image.png' } })).toThrow(/image/);
    expect(() => validateProject({ ...p, points: [{ id: 'a', x: null, y: .5 }] })).toThrow(/points/);
  });
});

describe('guided image tracing', () => {
  const synthetic = () => {
    const width = 300, height = 160, pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const actual = (x: number) => Math.round(65 + 22 * Math.sin(x / 40));
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      if (x % 30 === 0 || y % 30 === 0) pixels[i] = pixels[i + 1] = pixels[i + 2] = 175;
      if (Math.abs(y - actual(x)) <= 1) { pixels[i] = 25; pixels[i + 1] = 65; pixels[i + 2] = 210; }
    }
    const points = [20, 65, 110, 155, 200, 245, 280].map((x, i) => ({ id: String(i), x: x / (width - 1), y: (actual(x) + 3) / (height - 1) }));
    return { width, height, pixels, points, actual };
  };
  it('follows a colored curve across grid lines', () => {
    const image = synthetic();
    const result = traceImage({ ...image, interpolation: 'smooth', options: { color: '#1941d2', radius: 12, spacing: 5, adaptive: false } });
    expect(result.confidence).toBeGreaterThan(.8);
    expect(result.points.length).toBeGreaterThan(40);
    for (const point of result.points) expect(Math.abs(point.y * (image.height - 1) - image.actual(Math.round(point.x * (image.width - 1))))).toBeLessThan(3);
    expect(result.points.at(-1)!.x).toBeCloseTo(280 / 299);
  });
  it('uses fewer points on straight regions in adaptive mode', () => {
    const image = synthetic();
    const options = { color: '#1941d2', radius: 12, spacing: 5, adaptive: true };
    const adaptive = traceImage({ ...image, interpolation: 'smooth', options });
    const uniform = traceImage({ ...image, interpolation: 'smooth', options: { ...options, adaptive: false } });
    expect(adaptive.points.length).toBeLessThan(uniform.points.length);
  });
  it('rejects absent lines and guides with loops', () => {
    const image = synthetic();
    expect(() => traceImage({ ...image, pixels: new Uint8ClampedArray(image.pixels.length).fill(255), interpolation: 'straight', options: { color: null, radius: 10, spacing: 10, adaptive: true } })).toThrow(/No clear line/);
    expect(() => traceImage({ ...image, points: [...image.points].reverse(), interpolation: 'straight', options: { color: null, radius: 10, spacing: 10, adaptive: true } })).toThrow(/left to right/);
  });
});

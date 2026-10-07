import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowDownToLine, Check, ChevronDown, Crosshair, FileInput, FolderOpen, Hand, ImagePlus, Minus, Moon, MousePointer2, PenTool, Plus, Redo2, RotateCcw, Save, ScanLine, Sun, Trash2, Undo2, X } from 'lucide-react';
import { AxisEditor, Field, NumberField, Section } from './components';
import { clamp, defaultProject, exportRows, formatValue, insertPoint, moveAnchor, movePoint, parseData, pathData, positionAt, segments, sortedAnchors, uid, validateProject, valueAt, axisError, type Point, type Project, type XY } from './model';
import { decodedImage, download, loadImage } from './io';
import { useHistory } from './useHistory';
import type { TraceOptions } from './tracing';

type Mode = 'trace' | 'calibrate' | 'preview' | 'data';
type Tool = 'points' | 'pen' | 'select' | 'pan' | 'pick';
type Drag = { kind: 'point' | 'pen' | 'handle' | 'anchor' | 'pan' | 'image'; id?: string; axis?: 'xAxis' | 'yAxis'; handle?: 'incoming' | 'outgoing'; start: XY; point?: Point; view?: XY; image?: XY };
const imageAccept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('graph-editor-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* Storage may be unavailable in private browsing. */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const history = useHistory(defaultProject()), project = history.value;
  const [mode, setMode] = useState<Mode>('trace'), [tool, setTool] = useState<Tool>('points');
  const [selected, setSelected] = useState<string | null>(null), [autoInsert, setAutoInsert] = useState(true);
  const [zoom, setZoom] = useState(1), [view, setView] = useState<XY>({ x: 0, y: 0 });
  const [canvasScale, setCanvasScale] = useState(1);
  const [cursor, setCursor] = useState<XY | null>(null), [ctrl, setCtrl] = useState(false), [space, setSpace] = useState(false);
  const [loupeMode, setLoupeMode] = useState<'always' | 'ctrl' | 'off'>('always');
  const [showImage, setShowImage] = useState(true), [showGrid, setShowGrid] = useState(true), [alignImage, setAlignImage] = useState(false);
  const [toast, setToast] = useState(''), [busy, setBusy] = useState(false), [traceBusy, setTraceBusy] = useState(false);
  const [traceOptions, setTraceOptions] = useState<TraceOptions>({ radius: 18, spacing: 10, adaptive: true, color: null });
  const [proposal, setProposal] = useState<{ points: Point[]; confidence: number } | null>(null);
  const [exportFormat, setExportFormat] = useState('txt'), [exportDensity, setExportDensity] = useState<'points' | 'curve'>('points'), [exportCount, setExportCount] = useState(500);
  const [page, setPage] = useState(0), [resetConfirm, setResetConfirm] = useState(false), [dragOver, setDragOver] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null), stageRef = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const imageInput = useRef<HTMLInputElement>(null), dataInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const traceWorker = useRef<Worker | null>(null), toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const width = 1000, height = project.image ? width * project.image.height / project.image.width : 620;
  const currentPoint = project.points.find(p => p.id === selected);
  const invalidAxes = axisError(project.xAxis) || axisError(project.yAxis);
  const drawingPath = pathData(project.points, project.interpolation, width, height);
  const notify = (message: string) => {
    setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6500);
  };
  const update = (recipe: (p: Project) => Project) => { cancelTrace(); history.set(recipe); };
  const cancelTrace = () => { traceWorker.current?.terminate(); traceWorker.current = null; setTraceBusy(false); setProposal(null); };
  const setAxis = (axis: 'xAxis' | 'yAxis', value: Project[typeof axis]) => update(p => ({ ...p, [axis]: value }));
  const resetView = () => { setZoom(1); setView({ x: 0, y: 0 }); };
  const removeSelected = () => {
    if (!selected) return;
    update(p => ({ ...p, points: p.points.filter(point => point.id !== selected) })); setSelected(null);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('graph-editor-theme', theme); }
    catch { /* Theme switching still works when storage is unavailable. */ }
  }, [theme]);

  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]');
    const down = (e: KeyboardEvent) => {
      setCtrl(e.ctrlKey || e.metaKey);
      if (editable(e.target)) return;
      if (e.code === 'Space') { e.preventDefault(); setSpace(true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cancelTrace(); e.shiftKey ? history.redo() : history.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); cancelTrace(); history.redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
      else if (e.key === 'Escape') { cancelTrace(); setSelected(null); setAlignImage(false); setResetConfirm(false); }
      else if (e.key.toLowerCase() === 'p') setTool('pen');
      else if (e.key.toLowerCase() === 'd') setTool('points');
      else if (e.key.toLowerCase() === 'v') setTool('select');
      else if (e.key.toLowerCase() === 'h') setTool('pan');
    };
    const up = (e: KeyboardEvent) => { setCtrl(e.ctrlKey || e.metaKey); if (e.code === 'Space') setSpace(false); };
    const blur = () => { setCtrl(false); setSpace(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  });
  useEffect(() => () => { traceWorker.current?.terminate(); if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => { setPage(0); }, [project.points.length]);
  useEffect(() => { if (mode !== 'trace' && tool === 'pick') setTool('select'); setAlignImage(false); }, [mode]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(() => setCanvasScale(Math.max(.05, svg.clientWidth / width)));
    observer.observe(svg);
    return () => observer.disconnect();
  }, [mode, height]);

  const coords = (e: { clientX: number; clientY: number }): XY => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const position = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: position.x / width, y: position.y / height };
  };

  const changeZoom = (next: number, around: XY = { x: view.x + 0.5 / zoom, y: view.y + 0.5 / zoom }) => {
    next = clamp(next, 1, 12);
    const ratio = zoom / next;
    setView({ x: clamp(around.x - (around.x - view.x) * ratio, 0, 1 - 1 / next), y: clamp(around.y - (around.y - view.y) * ratio, 0, 1 - 1 / next) });
    setZoom(next);
  };
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); changeZoom(zoom * Math.exp(-e.deltaY * 0.0015), coords(e)); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom, view, height, mode]);

  async function openImage(file: File) {
    setBusy(true); cancelTrace();
    try {
      const image = await loadImage(file);
      history.set(p => ({ ...p, image })); resetView(); setShowImage(true); setMode('trace');
      notify(`Opened ${file.name}. Align the axis references before exporting.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'This image could not be opened.'); }
    finally { setBusy(false); }
  }
  async function openData(file: File) {
    setBusy(true); cancelTrace();
    try {
      const rows = parseData(await file.text());
      let base = history.current.current;
      if (!base.image && !base.points.length) {
        const xs = rows.map(r => r.x), ys = rows.map(r => r.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        if (minX === maxX) throw new Error('The data needs at least two different X values.');
        const padding = Math.max((maxY - minY) * 0.08, 1);
        base = { ...base, xAxis: { ...base.xAxis, scale: minX > 0 ? base.xAxis.scale : 'linear', anchors: [{ id: uid(), value: minX, position: 0.08 }, { id: uid(), value: maxX, position: 0.94 }] },
          yAxis: { ...base.yAxis, anchors: [{ id: uid(), value: maxY + padding, position: 0.08 }, { id: uid(), value: minY - padding, position: 0.88 }] } };
      }
      if (axisError(base.xAxis) || axisError(base.yAxis)) throw new Error('Fix the axis references before importing data.');
      const points = rows.map(r => ({ id: uid(), x: positionAt(r.x, base.xAxis), y: positionAt(r.y + base.offset, base.yAxis) }));
      if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) throw new Error('Some values fall outside the current plot. Adjust the axis range first.');
      history.set({ ...base, points }); setSelected(null); setMode('preview'); resetView(); notify(`Imported ${points.length} points.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not import data.'); }
    finally { setBusy(false); }
  }
  async function openProject(file: File) {
    setBusy(true); cancelTrace();
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('Choose a project smaller than 100 MB.');
      const loaded = validateProject(JSON.parse(await file.text()));
      if (loaded.image) await decodedImage(loaded.image.data);
      history.set(loaded); setSelected(null); setMode('trace'); resetView(); notify('Project restored.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not open the project.'); }
    finally { setBusy(false); }
  }

  async function pickColor(at: XY) {
    if (!project.image) return;
    const canvas = await imageCanvas();
    const x = clamp(Math.round(at.x * width) - 4, 0, width - 9), y = clamp(Math.round(at.y * height) - 4, 0, canvas.height - 9);
    const pixels = canvas.getContext('2d')!.getImageData(x, y, 9, 9).data;
    let best = -Infinity, rgb = [0, 0, 0];
    // Prefer the solid center of a thin stroke over its antialiased edge.
    for (let i = 0; i < 81; i++) {
      const values = [...pixels.slice(i * 4, i * 4 + 3)];
      const darkness = 1 - values.reduce((a, b) => a + b, 0) / 765;
      const saturation = (Math.max(...values) - Math.min(...values)) / 255;
      const distance = Math.hypot(i % 9 - 4, Math.floor(i / 9) - 4);
      const score = darkness * .65 + saturation - distance * .015;
      if (score > best) { best = score; rgb = values; }
    }
    const color = '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('');
    setTraceOptions(o => ({ ...o, color })); setTool('points'); notify(`Line color set to ${color}.`);
  }
  async function imageCanvas() {
    const image = history.current.current.image!;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(width * image.height / image.width);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(width / 2 + image.x * width, canvas.height / 2 + image.y * canvas.height);
    context.rotate(image.rotation * Math.PI / 180); context.scale(image.scale, image.scale);
    context.drawImage(await decodedImage(image.data), -width / 2, -canvas.height / 2, width, canvas.height);
    return canvas;
  }
  async function autoTrace() {
    cancelTrace(); setTraceBusy(true);
    try {
      const snapshot = history.current.current;
      const canvas = await imageCanvas();
      if (snapshot !== history.current.current) { setTraceBusy(false); return; }
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const worker = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' });
      traceWorker.current = worker;
      worker.onmessage = e => {
        if (e.data.error) notify(e.data.error);
        else setProposal({ points: e.data.result.points.map((p: XY) => ({ ...p, id: uid() })), confidence: e.data.result.confidence });
        setTraceBusy(false); worker.terminate(); traceWorker.current = null;
      };
      worker.onerror = () => { notify('Tracing stopped. Try a smaller image or a shorter guide.'); setTraceBusy(false); worker.terminate(); traceWorker.current = null; };
      worker.postMessage({ pixels, width: canvas.width, height: canvas.height, points: snapshot.points, interpolation: snapshot.interpolation, options: traceOptions }, [pixels.buffer]);
    } catch (error) { setTraceBusy(false); notify(error instanceof Error ? error.message : 'Could not trace this image.'); }
  }

  const capture = (e: ReactPointerEvent, next: Drag) => {
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    cancelTrace(); history.begin(); drag.current = next;
  };
  const pointDown = (e: ReactPointerEvent, point: Point) => {
    if (space || tool === 'pan' || alignImage || tool === 'pick') return;
    const at = coords(e);
    const distance = (candidate: Point) => Math.hypot((candidate.x - at.x) * width, (candidate.y - at.y) * height);
    // Overlapping hit areas should select the nearest point, not the last SVG element.
    const nearest = project.points.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best, point);
    setSelected(nearest.id); capture(e, { kind: 'point', id: nearest.id, point: nearest, start: at });
  };
  const stageDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const at = coords(e);
    if (space || tool === 'pan' || e.button === 1) { capture(e, { kind: 'pan', start: { x: e.clientX, y: e.clientY }, view }); return; }
    if (alignImage && project.image) { capture(e, { kind: 'image', start: at, image: { x: project.image.x, y: project.image.y } }); return; }
    if (tool === 'pick') { void pickColor(at); return; }
    if (mode !== 'trace' || tool === 'select') { setSelected(null); return; }
    if (at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1) return;
    const point: Point = { ...at, id: uid() };
    const shouldInsert = autoInsert && project.points.some((p, i) => i > 0 && at.x > Math.min(p.x, project.points[i - 1].x) && at.x < Math.max(p.x, project.points[i - 1].x));
    capture(e, { kind: tool === 'pen' ? 'pen' : 'point', id: point.id, start: at, point });
    history.set(p => ({ ...p, interpolation: tool === 'pen' ? 'bezier' : p.interpolation,
      points: shouldInsert ? insertPoint(p.points, point, tool === 'pen' ? 'bezier' : p.interpolation) : [...p.points, point] }), false);
    setSelected(point.id);
  };
  const stageMove = (e: ReactPointerEvent) => {
    const at = coords(e); setCursor(at); setCtrl(e.ctrlKey || e.metaKey);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const rect = svgRef.current!.getBoundingClientRect();
      setView({ x: clamp(d.view!.x - (e.clientX - d.start.x) / rect.width / zoom, 0, 1 - 1 / zoom), y: clamp(d.view!.y - (e.clientY - d.start.y) / rect.height / zoom, 0, 1 - 1 / zoom) });
    } else if (d.kind === 'anchor') {
      history.set(p => ({ ...p, [d.axis!]: moveAnchor(p[d.axis!], d.id!, at[d.axis === 'xAxis' ? 'x' : 'y']) }), false);
    } else if (d.kind === 'image') {
      history.set(p => ({ ...p, image: p.image ? { ...p.image, x: d.image!.x + at.x - d.start.x, y: d.image!.y + at.y - d.start.y } : null }), false);
    } else {
      history.set(p => ({ ...p, points: p.points.map(point => {
        if (point.id !== d.id) return point;
        if (d.kind === 'handle') {
          const updated = { ...point, [d.handle!]: { x: clamp(at.x, -1, 2), y: clamp(at.y, -1, 2) } };
          if (!e.altKey) updated[d.handle === 'incoming' ? 'outgoing' : 'incoming'] = { x: 2 * point.x - at.x, y: 2 * point.y - at.y };
          return updated;
        }
        if (d.kind === 'pen') {
          if (Math.hypot((at.x - d.start.x) * width, (at.y - d.start.y) * height) < 3) return point;
          return { ...point, outgoing: at, incoming: { x: 2 * point.x - at.x, y: 2 * point.y - at.y } };
        }
        return movePoint(d.point!, { x: clamp(d.point!.x + at.x - d.start.x), y: clamp(d.point!.y + at.y - d.start.y) });
      }) }), false);
    }
  };
  const stageUp = () => { if (drag.current) { drag.current = null; history.commit(); } };

  const editPointValue = (point: Point, axis: 'x' | 'y', value: number) => {
    const position = positionAt(value + (axis === 'y' ? project.offset : 0), axis === 'x' ? project.xAxis : project.yAxis);
    if (!Number.isFinite(position) || position < 0 || position > 1) { notify('This value is outside the plot. Expand the axis range first.'); return; }
    update(p => ({ ...p, points: p.points.map(row => row.id === point.id ? movePoint(row, { ...row, [axis]: position }) : row) }));
  };

  const xRefs = sortedAnchors(project.xAxis), yRefs = sortedAnchors(project.yAxis);
  const plotBounds = { left: xRefs[0].position * width, right: xRefs.at(-1)!.position * width, top: yRefs[0].position * height, bottom: yRefs.at(-1)!.position * height };
  const ticks = (axis: Project['xAxis']) => {
    if (axisError(axis)) return [];
    const anchors = sortedAnchors(axis), low = Math.min(...anchors.map(a => a.value)), high = Math.max(...anchors.map(a => a.value));
    const candidates: number[] = [];
    if (axis.scale === 'log') {
      const first = Math.floor(Math.log10(low)), last = Math.ceil(Math.log10(high));
      if (last - first > 20) return anchors.map(a => ({ value: a.value, position: a.position, major: true }));
      for (let exp = first; exp <= last; exp++) for (const m of [1, 2, 5]) candidates.push(m * 10 ** exp);
    } else {
      const raw = (high - low) / 7, base = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 5, 10].find(m => m * base >= raw)! * base;
      for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-8; value += step) { candidates.push(Number(value.toPrecision(12))); if (candidates.length > 100) break; }
    }
    return candidates.filter(n => n >= low && n <= high).map(value => ({ value, position: positionAt(value, axis), major: true }));
  };
  const tickLabel = (n: number) => Math.abs(n) >= 1000 ? `${Number((n / 1000).toPrecision(4))}k` : Number(n.toPrecision(4)).toString();
  const xTicks = ticks(project.xAxis), yTicks = ticks(project.yAxis);
  const graphColors = theme === 'dark'
    ? { background: '#19211c', grid: '#354238', text: '#adbeb0', title: '#c5d8ca', border: '#627868', curve: '#65ceb0' }
    : { background: '#ffffff', grid: '#e0e5df', text: '#76827b', title: '#46564b', border: '#adb6b5', curve: '#137565' };
  const imageTransform = project.image ? `translate(${width / 2 + project.image.x * width} ${height / 2 + project.image.y * height}) rotate(${project.image.rotation}) scale(${project.image.scale}) translate(${-width / 2} ${-height / 2})` : '';
  const viewBox = `${view.x * width} ${view.y * height} ${width / zoom} ${height / zoom}`;
  const renderGraph = (interactive: boolean, grid = showGrid, image = showImage): ReactNode => <>
    <rect className="graph-background" width={width} height={height} fill={graphColors.background} />
    {image && project.image && <image href={project.image.data} width={width} height={height} transform={imageTransform} />}
    {image && project.image && <rect width={width} height={height} fill="white" opacity={project.veil} />}
    {grid && mode !== 'calibrate' && <g className="plot-grid">
      {xTicks.map(t => <g key={t.value}><line style={{ stroke: graphColors.grid }} x1={t.position * width} x2={t.position * width} y1={plotBounds.top} y2={plotBounds.bottom} /><text style={{ fill: graphColors.text }} x={t.position * width} y={plotBounds.bottom + 20} textAnchor="middle">{tickLabel(t.value)}</text></g>)}
      {yTicks.map(t => <g key={t.value}><line style={{ stroke: graphColors.grid }} y1={t.position * height} y2={t.position * height} x1={plotBounds.left} x2={plotBounds.right} /><text style={{ fill: graphColors.text }} x={plotBounds.left - 10} y={t.position * height + 4} textAnchor="end">{tickLabel(t.value - project.offset)}</text></g>)}
      <rect x={plotBounds.left} y={plotBounds.top} width={plotBounds.right - plotBounds.left} height={plotBounds.bottom - plotBounds.top} fill="none" stroke={graphColors.border} />
      <text style={{ fill: graphColors.title }} x={(plotBounds.left + plotBounds.right) / 2} y={Math.min(height - 5, plotBounds.bottom + 42)} textAnchor="middle" className="axis-title">{project.xAxis.label}{project.xAxis.unit && ` (${project.xAxis.unit})`}</text>
      <text style={{ fill: graphColors.title }} transform={`translate(${Math.max(14, plotBounds.left - 52)} ${(plotBounds.top + plotBounds.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{project.yAxis.label}{project.yAxis.unit && ` (${project.yAxis.unit})`}</text>
    </g>}
    {mode === 'calibrate' && <g className="calibration-lines">
      {(['xAxis', 'yAxis'] as const).flatMap(axis => sortedAnchors(project[axis]).map((a, index) => {
        const horizontal = axis === 'yAxis';
        const down = interactive ? (e: ReactPointerEvent) => {
          if (space || tool === 'pan' || alignImage) return;
          capture(e, { kind: 'anchor', id: a.id, axis, start: coords(e) });
        } : undefined;
        const x = horizontal ? width - 92 : a.position * width, y = horizontal ? a.position * height : 14;
        return <g key={a.id} className={horizontal ? 'reference-y' : 'reference-x'} onPointerDown={down} data-testid={`${axis}-line-${index}`} style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}>
          <line x1={horizontal ? 0 : a.position * width} x2={horizontal ? width : a.position * width} y1={horizontal ? a.position * height : 0} y2={horizontal ? a.position * height : height} className="reference-hit" />
          <line x1={horizontal ? 0 : a.position * width} x2={horizontal ? width : a.position * width} y1={horizontal ? a.position * height : 0} y2={horizontal ? a.position * height : height} className="reference-visible" />
          <rect x={clamp(x - (horizontal ? 0 : 35), 0, width - 75)} y={clamp(y - (horizontal ? 11 : 0), 0, height - 24)} width={75} height={24} rx={4} />
          <text x={clamp(x - (horizontal ? 0 : 35), 0, width - 75) + 37.5} y={clamp(y - (horizontal ? 11 : 0), 0, height - 24) + 16} textAnchor="middle">{formatValue(a.value)}</text>
        </g>;
      }))}
    </g>}
    <path d={drawingPath} fill="none" stroke={graphColors.curve} strokeWidth={2.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
    {proposal && <path d={pathData(proposal.points, 'straight', width, height)} fill="none" stroke="#d07629" strokeWidth={2} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    {interactive && project.interpolation === 'bezier' && currentPoint && mode !== 'calibrate' && (['incoming', 'outgoing'] as const).map(handle => {
      const pointIndex = project.points.indexOf(currentPoint), curves = segments(project.points, 'bezier');
      const control = currentPoint[handle] ?? (handle === 'incoming' ? curves[pointIndex - 1]?.c : curves[pointIndex]?.b);
      if (!control) return null;
      return <g key={handle}><line x1={currentPoint.x * width} y1={currentPoint.y * height} x2={control.x * width} y2={control.y * height} stroke="#8cb7ae" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle cx={control.x * width} cy={control.y * height} r={4.5 / zoom / canvasScale} vectorEffect="non-scaling-stroke" className="bezier-handle" onPointerDown={e => capture(e, { kind: 'handle', id: currentPoint.id, handle, start: coords(e) })} data-testid={`handle-${handle}`} />
      </g>;
    })}
    {interactive && mode !== 'calibrate' && project.points.map((point, i) => <g key={point.id}>
      <circle cx={point.x * width} cy={point.y * height} r={12 / zoom / canvasScale} fill="transparent" className="point-hit" onPointerDown={e => pointDown(e, point)} onDoubleClick={e => {
        e.stopPropagation(); if (project.interpolation === 'bezier') update(p => ({ ...p, points: p.points.map(row => row.id === point.id ? { ...row, incoming: undefined, outgoing: undefined } : row) }));
      }} data-testid={`point-${i}`} />
      <circle cx={point.x * width} cy={point.y * height} r={(selected === point.id ? 5 : 3.4) / zoom / canvasScale} fill={selected === point.id ? graphColors.curve : graphColors.background} stroke={graphColors.curve} strokeWidth={1.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
    </g>)}
  </>;

  async function doExport() {
    try {
      if (exportFormat === 'png' || exportFormat === 'svg') {
        const source = document.getElementById('export-graph') as unknown as SVGSVGElement;
        const clone = source.cloneNode(true) as SVGSVGElement;
        clone.removeAttribute('id'); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height));
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = '.plot-grid line{stroke:#dce2e0;stroke-width:1}.plot-grid text{fill:#66716e;font:12px sans-serif}.plot-grid .axis-title{font-size:13px;fill:#35413d}'; clone.prepend(style);
        const text = new XMLSerializer().serializeToString(clone);
        if (exportFormat === 'svg') download('graph.svg', text, 'image/svg+xml');
        else {
          const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
          try {
            const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = Math.round(height * 2);
            const context = canvas.getContext('2d')!; context.drawImage(await decodedImage(url), 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Could not create the image.');
            download('graph.png', blob);
          } finally { URL.revokeObjectURL(url); }
        }
      } else {
        const rows = exportRows(project, exportDensity === 'curve' ? exportCount : 0);
        const contents = exportFormat === 'csv' ? [`"${project.xAxis.label.replaceAll('"', '""')} (${project.xAxis.unit.replaceAll('"', '""')})","${project.yAxis.label.replaceAll('"', '""')} (${project.yAxis.unit.replaceAll('"', '""')})"`, ...rows.map(p => `${formatValue(p.x)},${formatValue(p.y)}`)].join('\n') : rows.map(p => `${formatValue(p.x)} ${formatValue(p.y)}`).join('\n');
        download(`graph.${exportFormat}`, contents + '\n', exportFormat === 'csv' ? 'text/csv' : 'text/plain');
      }
      notify('Export downloaded.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Export failed.'); }
  }

  const toolbarButton = (id: Tool, icon: ReactNode, label: string, shortcut: string) => <button key={id} className={`tool-button ${tool === id ? 'active' : ''}`} aria-label={label} aria-pressed={tool === id} title={`${label} (${shortcut})`} onClick={() => { setTool(id); setAlignImage(false); }}>{icon}<span>{label}</span></button>;

  return <div className="app-shell">
    <input ref={imageInput} className="hidden-input" type="file" accept={imageAccept} data-testid="image-input" onChange={e => { if (e.target.files?.[0]) void openImage(e.target.files[0]); e.target.value = ''; }} />
    <input ref={dataInput} className="hidden-input" type="file" accept=".txt,.csv,.tsv" data-testid="data-input" onChange={e => { if (e.target.files?.[0]) void openData(e.target.files[0]); e.target.value = ''; }} />
    <input ref={projectInput} className="hidden-input" type="file" accept=".json" data-testid="project-input" onChange={e => { if (e.target.files?.[0]) void openProject(e.target.files[0]); e.target.value = ''; }} />
    <header className="header">
      <div className="file-actions"><button className="primary-button" disabled={busy} onClick={() => imageInput.current?.click()}><ImagePlus size={16} />{busy ? 'Opening…' : 'Open image'}</button>
        <button className="quiet-button" disabled={busy} onClick={() => dataInput.current?.click()} title="Import two-column TXT, CSV, or TSV"><FileInput size={16} /><span>Import data</span></button>
        <details className="file-menu"><summary aria-label="Project menu"><FolderOpen size={16} /><span>Project</span><ChevronDown size={12} /></summary><div className="menu-content">
          <button onClick={() => { projectInput.current?.click(); document.querySelector('.file-menu')?.removeAttribute('open'); }}><FolderOpen size={14} /> Open project</button>
          <button onClick={() => { download('graph-project.json', JSON.stringify(project), 'application/json'); notify('Project saved with image and calibration.'); document.querySelector('.file-menu')?.removeAttribute('open'); }}><Save size={14} /> Save project</button>
          <button onClick={() => { setResetConfirm(true); document.querySelector('.file-menu')?.removeAttribute('open'); }}><RotateCcw size={14} /> New graph</button>
        </div></details>
      </div>
      <div className="header-right"><button className="quiet-button theme-toggle" aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} title={theme === 'light' ? 'Dark theme' : 'Light theme'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button><button className="quiet-button export-shortcut" onClick={() => { setMode('data'); }}><ArrowDownToLine size={16} /> Export</button></div>
    </header>

    <div className="editor-layout">
      <main className="workspace">
        <div className="workspace-header"><nav className="mode-tabs" aria-label="Editor mode">
          {([['trace', 'Trace'], ['calibrate', 'Edit axes'], ['preview', 'Preview'], ['data', 'Data']] as const).map(([id, label]) => <button key={id} className={mode === id ? 'selected' : ''} aria-pressed={mode === id} onClick={() => { setMode(id); if (id === 'preview') setTool('select'); }}>{label}</button>)}
        </nav><span className="filename" title={project.image?.name}>{project.image?.name ?? 'Untitled graph'}</span></div>

        {mode !== 'data' && <div className="toolbar">
          <div className="tool-group">{mode === 'trace' && <>{toolbarButton('points', <MousePointer2 size={16} />, 'Points', 'D')}{toolbarButton('pen', <PenTool size={16} />, 'Pen', 'P')}</>}
            {toolbarButton('select', <Crosshair size={16} />, 'Move', 'V')}{toolbarButton('pan', <Hand size={16} />, 'Pan', 'H')}
          </div>
          {mode === 'trace' && <label className="toolbar-check" title="Insert a point between existing points within their X range"><input type="checkbox" checked={autoInsert} onChange={e => setAutoInsert(e.target.checked)} />Insert between</label>}
          <div className="toolbar-spacer" /><div className="tool-group history-tools">
            <button className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.canUndo} onClick={() => { cancelTrace(); history.undo(); }}><Undo2 size={16} /></button>
            <button className="icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!history.canRedo} onClick={() => { cancelTrace(); history.redo(); }}><Redo2 size={16} /></button>
            <button className="icon-button" aria-label="Delete selected point" title="Delete selected point" disabled={!currentPoint} onClick={removeSelected}><Trash2 size={15} /></button>
          </div>
        </div>}

        {mode !== 'data' ? <>
          <div ref={stageRef} className={`stage ${dragOver ? 'drag-over' : ''} ${alignImage || tool === 'pan' || space ? 'pan-cursor' : tool === 'select' ? 'select-cursor' : 'draw-cursor'}`} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => {
            e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files[0]; if (file) { if (/\.(txt|csv|tsv)$/i.test(file.name)) void openData(file); else if (/\.json$/i.test(file.name)) void openProject(file); else void openImage(file); }
          }}>
            <div className="canvas-frame" style={{ aspectRatio: `${width} / ${height}`, '--canvas-ratio': width / height } as CSSProperties}>
              <svg ref={svgRef} className="graph-canvas" viewBox={viewBox} onPointerDown={stageDown} onPointerMove={stageMove} onPointerUp={stageUp} onPointerCancel={stageUp} onLostPointerCapture={stageUp} onPointerLeave={() => { if (!drag.current) setCursor(null); }} aria-label="Graph drawing canvas" data-testid="graph-canvas">
                {renderGraph(true)}
              </svg>
              {!project.image && !project.points.length && <div className="empty-state"><ImagePlus size={29} strokeWidth={1.2} /><button onClick={() => imageInput.current?.click()}>Drop an image, or browse</button><span>PNG, JPG, WebP, AVIF, GIF, BMP</span><button className="empty-draw" onClick={() => { setMode('trace'); setTool('points'); svgRef.current?.focus(); notify('Click the canvas to add points.'); }}>Or start drawing</button></div>}
              {cursor && (loupeMode === 'always' || (loupeMode === 'ctrl' && ctrl)) && <div className="loupe" aria-label="Magnified cursor view">
                <svg viewBox={`${cursor.x * width - 34 / zoom} ${cursor.y * height - 34 / zoom} ${68 / zoom} ${68 / zoom}`}>{renderGraph(false, false)}<line x1={cursor.x * width - 34 / zoom} x2={cursor.x * width + 34 / zoom} y1={cursor.y * height} y2={cursor.y * height} stroke="#d77745" strokeWidth={0.35 / zoom} /><line y1={cursor.y * height - 34 / zoom} y2={cursor.y * height + 34 / zoom} x1={cursor.x * width} x2={cursor.x * width} stroke="#d77745" strokeWidth={0.35 / zoom} /></svg>
                <span>3×</span>
              </div>}
            </div>
            {proposal && <div className="trace-proposal"><span>{proposal.points.length} points · {proposal.confidence < 0.45 ? 'Check the match' : 'Trace preview'}</span><button onClick={() => { history.set(p => ({ ...p, points: proposal.points, interpolation: 'straight' })); setSelected(null); setProposal(null); notify('Trace applied. Points are editable.'); }}><Check size={15} />Apply</button><button aria-label="Discard trace" onClick={cancelTrace}><X size={16} /></button></div>}
          </div>
          <div className="canvas-bottom"><span className="canvas-hint">{alignImage ? 'Drag the image to align it. Points stay fixed.' : mode === 'calibrate' ? 'Drag a reference line to match the image. Points stay fixed.' : mode === 'preview' ? 'Drag points to refine the curve.' : tool === 'pen' ? 'Click and drag for curves. Alt: independent handles.' : tool === 'pick' ? 'Click the line to sample its color.' : 'Click to add. Drag to move. Space: pan. Scroll: zoom.'}</span>
            <div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => changeZoom(zoom / 1.25)}><Minus size={14} /></button><button className="zoom-value" title="Fit image" onClick={resetView}>{Math.round(zoom * 100)}%</button><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 12} onClick={() => changeZoom(zoom * 1.25)}><Plus size={14} /></button></div>
          </div>
        </> : <div className="data-view">
          <div className="data-heading"><div><h1>Point values</h1><p>{project.points.length} points · {exportDensity === 'curve' ? `${exportCount} samples on export` : 'Anchor points on export'}</p></div><button className="quiet-button" onClick={() => { setMode('preview'); setTool('select'); }}><Crosshair size={14} />Edit on graph</button></div>
          {invalidAxes ? <div className="data-empty">Fix the axis references to view numeric values.<button className="text-button" onClick={() => setMode('calibrate')}>Edit axes</button></div> : !project.points.length ? <div className="data-empty">No points yet.<button className="text-button" onClick={() => setMode('trace')}>Draw a curve</button></div> : <>
            <div className="data-table-wrap"><table className="data-table"><thead><tr><th>#</th><th>{project.xAxis.label} {project.xAxis.unit && `(${project.xAxis.unit})`}</th><th>{project.yAxis.label} {project.yAxis.unit && `(${project.yAxis.unit})`}</th><th /></tr></thead><tbody>
              {project.points.slice(page * 100, (page + 1) * 100).map((point, i) => <tr key={point.id} className={selected === point.id ? 'selected' : ''} onClick={() => setSelected(point.id)}>
                <td>{page * 100 + i + 1}</td><td><NumberField label={`Point ${page * 100 + i + 1} X value`} value={valueAt(point.x, project.xAxis)} onChange={n => editPointValue(point, 'x', n)} /></td><td><NumberField label={`Point ${page * 100 + i + 1} Y value`} value={valueAt(point.y, project.yAxis) - project.offset} onChange={n => editPointValue(point, 'y', n)} /></td><td><button className="icon-button" aria-label={`Delete point ${page * 100 + i + 1}`} onClick={e => { e.stopPropagation(); update(p => ({ ...p, points: p.points.filter(row => row.id !== point.id) })); }}><Trash2 size={13} /></button></td>
              </tr>)}
            </tbody></table></div>
            {project.points.length > 100 && <div className="pagination"><button disabled={!page} onClick={() => setPage(n => n - 1)}>Previous</button><span>{page + 1} / {Math.ceil(project.points.length / 100)}</span><button disabled={(page + 1) * 100 >= project.points.length} onClick={() => setPage(n => n + 1)}>Next</button></div>}
          </>}
        </div>}
        <footer className="workspace-footer"><span>{project.points.length} points{invalidAxes && <span className="footer-warning"> · Invalid axis references</span>}</span><span className="cursor-values">{cursor && !invalidAxes ? `${formatValue(valueAt(cursor.x, project.xAxis))} ${project.xAxis.unit} · ${formatValue(valueAt(cursor.y, project.yAxis) - project.offset)} ${project.yAxis.unit}` : ' '}</span><span>Files stay on your device</span></footer>
      </main>

      <aside className="sidebar" aria-label="Graph settings">
        {mode === 'calibrate' ? <>
          <div className="sidebar-intro"><h1>Axis references</h1><p>Match lines to known values. Add references for uneven scales.</p></div>
          <AxisEditor axis={project.xAxis} name="X" onChange={axis => setAxis('xAxis', axis)} onMessage={notify} />
          <AxisEditor axis={project.yAxis} name="Y" onChange={axis => setAxis('yAxis', axis)} onMessage={notify} />
          <div className="scale-note">Frequency: logarithmic. dB: linear.<br />dB is already a logarithmic unit.</div>
        </> : <>
          <Section title="Curve">
            <Field label="Interpolation"><select aria-label="Interpolation" value={project.interpolation} onChange={e => update(p => ({ ...p, interpolation: e.target.value as Project['interpolation'] }))}><option value="straight">Straight segments</option><option value="smooth">Smooth curve</option><option value="bezier">Bézier handles</option></select></Field>
            <Field label={`Subtract from ${project.yAxis.unit || 'Y'} values`} hint="Applied to values and exports; the trace stays in place."><NumberField label="Y offset" value={project.offset} onChange={offset => update(p => ({ ...p, offset }))} /></Field>
            {currentPoint && <div className="selected-point"><div className="section-heading"><h3>Point {project.points.indexOf(currentPoint) + 1}</h3><button className="icon-button" aria-label="Deselect point" onClick={() => setSelected(null)}><X size={13} /></button></div><div className="two-fields">
              <Field label={project.xAxis.unit || 'X'}><NumberField label="Selected point X" value={valueAt(currentPoint.x, project.xAxis)} onChange={n => editPointValue(currentPoint, 'x', n)} /></Field>
              <Field label={project.yAxis.unit || 'Y'}><NumberField label="Selected point Y" value={valueAt(currentPoint.y, project.yAxis) - project.offset} onChange={n => editPointValue(currentPoint, 'y', n)} /></Field>
            </div></div>}
          </Section>
          {mode === 'trace' && <Section title="Auto trace">
            <p className="section-note">Sketch left to right. Trace follows your guide.</p>
            <Field label={`Search width · ±${traceOptions.radius} px`}><input type="range" aria-label="Trace search width" min="3" max="80" value={traceOptions.radius} onChange={e => setTraceOptions(o => ({ ...o, radius: +e.target.value }))} /></Field>
            <Field label={`${traceOptions.adaptive ? 'Detail' : 'Point spacing'} · ${traceOptions.spacing} px`}><input type="range" aria-label="Trace point spacing" min="2" max="60" value={traceOptions.spacing} onChange={e => setTraceOptions(o => ({ ...o, spacing: +e.target.value }))} /></Field>
            <label className="check-field"><input type="checkbox" checked={traceOptions.adaptive} onChange={e => setTraceOptions(o => ({ ...o, adaptive: e.target.checked }))} />More points around bends</label>
            <div className="color-controls"><span className="color-swatch" style={{ background: traceOptions.color ?? '#303a36' }} /><button className={`text-button ${tool === 'pick' ? 'active' : ''}`} disabled={!project.image} onClick={() => { setTool(tool === 'pick' ? 'points' : 'pick'); setAlignImage(false); }}>Pick line color</button>{traceOptions.color && <button className="icon-button" aria-label="Reset line color" onClick={() => setTraceOptions(o => ({ ...o, color: null }))}><X size={12} /></button>}</div>
            <button className="wide-button" disabled={!project.image || project.points.length < 2 || !!proposal} onClick={() => traceBusy ? cancelTrace() : void autoTrace()}><ScanLine size={16} />{traceBusy ? 'Cancel tracing' : 'Trace from sketch'}</button>
          </Section>}
          {mode !== 'trace' && <Section title="Export">
            <Field label="Format"><select aria-label="Export format" value={exportFormat} onChange={e => setExportFormat(e.target.value)}><option value="txt">TXT · two columns</option><option value="csv">CSV · with headers</option><option value="svg">SVG · graph image</option><option value="png">PNG · graph image</option></select></Field>
            {(exportFormat === 'txt' || exportFormat === 'csv') && <><Field label="Values"><select aria-label="Export values" value={exportDensity} onChange={e => setExportDensity(e.target.value as typeof exportDensity)}><option value="points">Anchor points</option><option value="curve">Sample the curve</option></select></Field>
              {exportDensity === 'curve' && <Field label="Sample count"><NumberField label="Export sample count" min={2} max={20000} step={1} value={exportCount} onChange={n => setExportCount(Math.round(n))} /></Field>}</>}
            <button className="primary-button full-width" disabled={project.points.length < 2 || (!!invalidAxes && ['txt', 'csv'].includes(exportFormat))} onClick={() => void doExport()}><ArrowDownToLine size={15} />Download {exportFormat.toUpperCase()}</button>
          </Section>}
          <Section title="Axes" action={<button className="text-button" onClick={() => setMode('calibrate')}>Edit</button>}>
            <div className="axis-summary"><span>{project.xAxis.label} <small>{project.xAxis.scale === 'log' ? 'Log' : 'Linear'}</small></span><span>{formatValue(xRefs[0].value)} — {formatValue(xRefs.at(-1)!.value)} {project.xAxis.unit}</span></div>
            <div className="axis-summary"><span>{project.yAxis.label} <small>{project.yAxis.scale === 'log' ? 'Log' : 'Linear'}</small></span><span>{formatValue(yRefs.at(-1)!.value)} — {formatValue(yRefs[0].value)} {project.yAxis.unit}</span></div>
            {invalidAxes && <p className="inline-error">{invalidAxes}</p>}
          </Section>
        </>}

        {mode !== 'data' && <Section title="View">
          <label className="check-field"><input type="checkbox" checked={showImage} disabled={!project.image} onChange={e => setShowImage(e.target.checked)} />Show image</label>
          {project.image && <Field label={`White overlay · ${Math.round(project.veil * 100)}%`}><input type="range" aria-label="White overlay" min="0" max="100" value={project.veil * 100} onChange={e => history.set(p => ({ ...p, veil: +e.target.value / 100 }))} /></Field>}
          <label className="check-field"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />Show calibrated grid</label>
          <Field label="Magnifier"><select aria-label="Magnifier" value={loupeMode} onChange={e => setLoupeMode(e.target.value as typeof loupeMode)}><option value="always">Always on</option><option value="ctrl">Hold Ctrl / ⌘</option><option value="off">Off</option></select></Field>
          {project.image && <details className="image-alignment"><summary>Align image<ChevronDown size={13} /></summary><div className="alignment-content">
            <label className="check-field"><input type="checkbox" checked={alignImage} onChange={e => { setAlignImage(e.target.checked); setTool('select'); }} />Drag image</label>
            <div className="two-fields"><Field label="X offset %"><NumberField label="Image X offset" value={project.image.x * 100} onChange={n => update(p => ({ ...p, image: p.image ? { ...p.image, x: n / 100 } : null }))} /></Field><Field label="Y offset %"><NumberField label="Image Y offset" value={project.image.y * 100} onChange={n => update(p => ({ ...p, image: p.image ? { ...p.image, y: n / 100 } : null }))} /></Field></div>
            <div className="two-fields"><Field label="Scale %"><NumberField label="Image scale" value={project.image.scale * 100} min={5} max={1000} onChange={n => update(p => ({ ...p, image: p.image ? { ...p.image, scale: n / 100 } : null }))} /></Field><Field label="Rotation °"><NumberField label="Image rotation" value={project.image.rotation} min={-180} max={180} onChange={n => update(p => ({ ...p, image: p.image ? { ...p.image, rotation: n } : null }))} /></Field></div>
            <button className="text-button" onClick={() => update(p => ({ ...p, image: p.image ? { ...p.image, x: 0, y: 0, scale: 1, rotation: 0 } : null }))}><RotateCcw size={13} />Reset alignment</button>
          </div></details>}
        </Section>}
        <div className="sidebar-footnote">{mode === 'calibrate' ? 'References remap values without moving points.' : 'Ctrl+Z to undo · Delete to remove a point'}</div>
      </aside>
    </div>
    <svg id="export-graph" className="export-svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{renderGraph(false, showGrid, showImage)}</svg>
    {toast && <div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {resetConfirm && <div className="modal-backdrop" onClick={() => setResetConfirm(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={e => e.stopPropagation()}><h2 id="reset-title">Start a new graph?</h2><p>Save your project first if you want to keep it.</p><div><button className="quiet-button" onClick={() => setResetConfirm(false)}>Cancel</button><button className="primary-button" onClick={() => { cancelTrace(); history.set(defaultProject()); setSelected(null); resetView(); setMode('trace'); setResetConfirm(false); }}>New graph</button></div></div></div>}
  </div>;
}

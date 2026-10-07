import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { axisError, formatValue, moveAnchor, sortedAnchors, uid, valueAt, type Axis } from './model';

export function NumberField({ value, onChange, label, min, max, step = 'any', ...rest }: {
  value: number; onChange: (n: number) => void; label: string; min?: number; max?: number; step?: number | 'any'; className?: string;
}) {
  const [text, setText] = useState(formatValue(value));
  useEffect(() => setText(formatValue(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n);
    else setText(formatValue(value));
  };
  return <input {...rest} type="number" aria-label={label} value={text} min={min} max={max} step={step} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') { setText(formatValue(value)); e.currentTarget.blur(); }
  }} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="section"><div className="section-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}

export function AxisEditor({ axis, name, onChange, onMessage }: { axis: Axis; name: 'X' | 'Y'; onChange: (axis: Axis) => void; onMessage: (message: string) => void }) {
  const error = axisError(axis);
  return <Section title={`${name} axis`}>
    <div className="two-fields">
      <Field label="Label"><input aria-label={`${name} axis label`} value={axis.label} onChange={e => onChange({ ...axis, label: e.target.value })} /></Field>
      <Field label="Unit"><input aria-label={`${name} axis unit`} value={axis.unit} onChange={e => onChange({ ...axis, unit: e.target.value })} /></Field>
    </div>
    <Field label="Scale"><select aria-label={`${name} scale`} value={axis.scale} onChange={e => {
      if (e.target.value === 'log' && axis.anchors.some(a => a.value <= 0)) { onMessage('Set positive reference values before choosing a logarithmic scale.'); return; }
      onChange({ ...axis, scale: e.target.value as Axis['scale'] });
    }}><option value="log">Logarithmic</option><option value="linear">Linear</option></select></Field>
    <div className="reference-head"><span>Value</span><span>Position %</span><span /></div>
    <div className="reference-list">{sortedAnchors(axis).map((a, i) => <div className="reference-row" key={a.id}>
      <NumberField label={`${name} reference ${i + 1} value`} value={a.value} onChange={value => onChange({ ...axis, anchors: axis.anchors.map(anchor => anchor.id === a.id ? { ...anchor, value } : anchor) })} />
      <NumberField label={`${name} reference ${i + 1} position`} value={a.position * 100} min={0} max={100} onChange={n => onChange(moveAnchor(axis, a.id, n / 100))} />
      <button className="icon-button" aria-label={`Remove ${name} reference ${i + 1}`} disabled={axis.anchors.length <= 2} onClick={() => onChange({ ...axis, anchors: axis.anchors.filter(anchor => anchor.id !== a.id) })}><Trash2 size={13} /></button>
    </div>)}</div>
    <button className="text-button" disabled={!!error || axis.anchors.length >= 100} onClick={() => {
      const sorted = sortedAnchors(axis);
      let index = 0;
      for (let i = 1; i < sorted.length - 1; i++) if (sorted[i + 1].position - sorted[i].position > sorted[index + 1].position - sorted[index].position) index = i;
      const position = (sorted[index].position + sorted[index + 1].position) / 2;
      onChange({ ...axis, anchors: [...axis.anchors, { id: uid(), position, value: valueAt(position, axis) }] });
    }}><Plus size={14} /> Add reference</button>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </Section>;
}

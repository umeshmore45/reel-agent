'use client';

import type { ReactNode } from 'react';

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-white/5 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
        {right}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, format }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; onCommit?: () => void; format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-300">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit}
        className="w-full"
      />
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, small }: {
  value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className="flex rounded-lg bg-zinc-800/80 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.id)} type="button" onClick={() => onChange(o.id)}
          className={`flex-1 rounded-md px-2 ${small ? 'py-1 text-[11px]' : 'py-1.5 text-xs'} font-medium transition ${
            value === o.id ? 'bg-zinc-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-xs text-zinc-300">
      {label}
      <button
        type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-violet-500' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function NumberField({ label, value, step = 0.1, min, max, onChange }: {
  label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs text-zinc-400">
      <span className="mb-1 block">{label}</span>
      <input
        type="number" value={Number(value.toFixed(2))} step={step} min={min} max={max}
        onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
        className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-zinc-100 tabular-nums outline-none focus:border-violet-500"
      />
    </label>
  );
}

export function Btn({ children, onClick, variant = 'ghost', disabled, title, className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'ghost' | 'primary' | 'danger' | 'soft';
  disabled?: boolean; title?: string; className?: string;
}) {
  const styles = {
    ghost: 'text-zinc-300 hover:bg-white/10 hover:text-white',
    soft: 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
    primary: 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20 hover:brightness-110',
    danger: 'text-red-300 hover:bg-red-500/15',
  }[variant];
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function ColorRow({ value, onChange, swatches }: { value: string; onChange: (v: string) => void; swatches: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {swatches.map((c) => (
        <button
          key={c} type="button" onClick={() => onChange(c)} title={c}
          className={`h-6 w-6 rounded-full border ${value.toLowerCase() === c ? 'border-white ring-2 ring-violet-500' : 'border-white/20'}`}
          style={{ background: c }}
        />
      ))}
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent" />
    </div>
  );
}

export const Spinner = ({ className = 'h-3.5 w-3.5' }: { className?: string }) => (
  <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />
);

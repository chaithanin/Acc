'use client';

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './primitives';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90 border-transparent',
  secondary: 'bg-surface text-ink border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-ink-secondary border-transparent hover:bg-surface-hover',
  danger: 'bg-critical text-white hover:opacity-90 border-transparent',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Select({
  label,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="flex flex-col gap-1">
      {label ? (
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </span>
      ) : null}
      <select
        {...props}
        className={cx(
          'rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink',
          'hover:bg-surface-hover',
          className,
        )}
      >
        {children}
      </select>
    </label>
  );
}

export function TextInput({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="flex flex-col gap-1">
      {label ? (
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </span>
      ) : null}
      <input
        {...props}
        className={cx(
          'rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink',
          'placeholder:text-ink-muted',
          className,
        )}
      />
    </label>
  );
}

/**
 * A modal dialog. Rendered inline rather than in a portal — every use sits at
 * the top level of a page, so a portal would add machinery for no benefit.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      {/* Backdrop click closes; the panel stops propagation. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(
          'relative w-full rounded-[var(--radius-card)] border border-border bg-surface shadow-xl',
          wide ? 'max-w-5xl' : 'max-w-2xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-secondary">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
      {label}
    </span>
  );
}

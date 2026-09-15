import { clsx } from 'clsx'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

export function Button({
  variant = 'secondary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed'
  const v: Record<Variant, string> = {
    primary: 'bg-sky-600 hover:bg-sky-500 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-100',
    danger: 'bg-rose-600 hover:bg-rose-500 text-white',
    ghost: 'bg-transparent hover:bg-slate-800 text-slate-200'
  }
  return <button className={clsx(base, v[variant], className)} {...rest} />
}

export function Card({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={clsx('rounded-xl border border-slate-800 bg-slate-900/70 p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between">
          {title && <h2 className="text-base font-semibold text-slate-100">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none',
        className
      )}
      {...rest}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx('w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none', className)}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Badge({ level, children }: { level: 'green' | 'yellow' | 'red' | 'gray' | 'pending' | 'skipped' | 'blue'; children: ReactNode }) {
  const c: Record<string, string> = {
    green: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    yellow: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    red: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    gray: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    pending: 'bg-sky-500/20 text-sky-300 border-sky-500/40 animate-pulse',
    skipped: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
    blue: 'bg-sky-500/20 text-sky-300 border-sky-500/40'
  }
  return <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', c[level])}>{children}</span>
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 text-sm"
    >
      <span className="text-slate-200">{label}</span>
      <span className={clsx('relative h-5 w-9 rounded-full transition', checked ? 'bg-sky-600' : 'bg-slate-600')}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition', checked ? 'left-4.5' : 'left-0.5')} />
      </span>
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400', className)} />
}

export const LEVEL_LABEL: Record<string, string> = {
  green: '양호',
  yellow: '주의',
  red: '불가',
  gray: '미지원',
  pending: '검사 중',
  skipped: '건너뜀'
}

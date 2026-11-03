import type { ReactNode } from "react";

export function Card({ title, children, className = "", right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  approved: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  posted: "bg-green-500/15 text-green-700 dark:text-green-400",
  posting: "bg-sky-500/15 text-sky-600",
  generating: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone ?? ""] ?? "bg-stone-500/15 text-muted"}`}>{children}</span>;
}

export function Button({ children, variant = "default", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) {
  const styles = {
    default: "border border-line bg-panel hover:bg-stone-500/10",
    primary: "bg-accent text-black hover:opacity-90",
    danger: "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
    ghost: "hover:bg-stone-500/10",
  }[variant];
  return (
    <button {...props} className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${styles} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Skeleton() {
  return <div className="h-40 animate-pulse rounded-xl border border-line bg-panel" />;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

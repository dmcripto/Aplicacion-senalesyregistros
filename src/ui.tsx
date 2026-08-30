import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cx, fmtPrice, fmtR, resultR, riskOf } from "./lib";
import type { Trade } from "./lib";
import { useInView } from "./hooks";

// ─── Iconos SVG propios ─────────────────────────────────────────────────────

type IconProps = { className?: string };

export const ShieldLogo = ({ className }: IconProps) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden>
    <path
      d="M16 2 28 7v9c0 8-5.4 12.6-12 14C9.4 28.6 4 24 4 16V7z"
      fill="#0d131b"
      stroke="var(--color-gold)"
      strokeWidth="1.8"
    />
    <rect x="9.6" y="12.5" width="3.2" height="8.5" rx="0.6" fill="var(--color-bull)" />
    <rect x="11" y="9.5" width="1" height="14.5" fill="var(--color-bull)" />
    <rect x="19.2" y="9" width="3.2" height="8.5" rx="0.6" fill="var(--color-bear)" />
    <rect x="20.6" y="6.5" width="1" height="14.5" fill="var(--color-bear)" />
  </svg>
);

export const TriUp = ({ className }: IconProps) => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 1.5 9.2 8.5H0.8z" fill="currentColor" />
  </svg>
);

export const TriDown = ({ className }: IconProps) => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 8.5 0.8 1.5h8.4z" fill="currentColor" />
  </svg>
);

export const IconTarget = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    <path d="M8 0.8v2.4M8 12.8v2.4M0.8 8h2.4M12.8 8h2.4" strokeLinecap="round" />
  </svg>
);

export const IconFlag = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M3.5 14.5v-12" strokeLinecap="round" />
    <path d="M3.5 2.5h8.5l-2.4 3 2.4 3H3.5" fill="currentColor" fillOpacity="0.25" strokeLinejoin="round" />
  </svg>
);

export const IconTrash = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 9h6.6l.7-9M6.6 7v4.5M9.4 7v4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconUndo = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M6.5 3 3 6.5 6.5 10" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 6.5h6a4 4 0 0 1 0 8H6" strokeLinecap="round" />
  </svg>
);

export const IconDownload = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M8 2v8m0 0L5 7.2M8 10l3-2.8M2.5 13.5h11" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconClipboard = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <rect x="3" y="2.8" width="10" height="11.5" rx="1.5" />
    <path d="M5.8 2.8V1.5h4.4v1.3M5.8 6.6h4.4M5.8 9.2h4.4M5.8 11.8h2.6" strokeLinecap="round" />
  </svg>
);

export const IconPlus = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
  </svg>
);

export const IconX = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
);

export const IconCheck = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconAlert = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M8 2 14.5 13.5H1.5z" strokeLinejoin="round" />
    <path d="M8 6.5v3.2" strokeLinecap="round" />
    <circle cx="8" cy="11.6" r="0.4" fill="currentColor" />
  </svg>
);

export const IconSearch = ({ className }: IconProps) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" strokeLinecap="round" />
  </svg>
);

export const IconCandles = ({ className }: IconProps) => (
  <svg viewBox="0 0 120 64" className={className} aria-hidden>
    <g opacity="0.9">
      <rect x="10" y="26" width="8" height="22" rx="1.5" fill="var(--color-bull)" />
      <rect x="13" y="18" width="2" height="38" fill="var(--color-bull)" />
      <rect x="28" y="18" width="8" height="20" rx="1.5" fill="var(--color-bear)" />
      <rect x="31" y="12" width="2" height="34" fill="var(--color-bear)" />
      <rect x="46" y="22" width="8" height="26" rx="1.5" fill="var(--color-bull)" />
      <rect x="49" y="14" width="2" height="42" fill="var(--color-bull)" />
      <rect x="64" y="14" width="8" height="18" rx="1.5" fill="var(--color-bull)" />
      <rect x="67" y="8" width="2" height="32" fill="var(--color-bull)" />
      <rect x="82" y="20" width="8" height="22" rx="1.5" fill="var(--color-bear)" />
      <rect x="85" y="14" width="2" height="36" fill="var(--color-bear)" />
      <rect x="100" y="10" width="8" height="24" rx="1.5" fill="var(--color-bull)" />
      <rect x="103" y="4" width="2" height="38" fill="var(--color-bull)" />
    </g>
    <path d="M6 58h108" stroke="var(--color-line2)" strokeWidth="1.5" strokeDasharray="4 5" />
  </svg>
);

// ─── Badges ─────────────────────────────────────────────────────────────────

export const DirBadge = ({ dir }: { dir: Trade["direction"] }) => (
  <span
    className={cx(
      "num inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide",
      dir === "LONG" ? "bg-bull/12 text-bull" : "bg-bear/12 text-bear",
    )}
    style={{ boxShadow: `inset 0 0 0 1px ${dir === "LONG" ? "rgba(22,217,138,.35)" : "rgba(255,77,103,.35)"}` }}
  >
    {dir === "LONG" ? <TriUp className="h-2 w-2" /> : <TriDown className="h-2 w-2" />}
    {dir}
  </span>
);

export const OutcomeBadge = ({ trade }: { trade: Trade }) => {
  if (trade.outcome === "ABIERTA") {
    return (
      <span className="num inline-flex items-center gap-1.5 rounded bg-gold/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-gold" style={{ boxShadow: "inset 0 0 0 1px rgba(243,183,30,.4)" }}>
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" />
        ABIERTA
      </span>
    );
  }
  const r = resultR(trade) ?? 0;
  const pos = r >= 0;
  return (
    <span
      className={cx(
        "num inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-bold tracking-wide",
        pos ? "bg-bull/12 text-bull" : "bg-bear/12 text-bear",
      )}
      style={{ boxShadow: `inset 0 0 0 1px ${pos ? "rgba(22,217,138,.35)" : "rgba(255,77,103,.35)"}` }}
    >
      {trade.outcome === "MANUAL" ? "CIERRE" : trade.outcome} · {fmtR(r)}R
    </span>
  );
};

// ─── Reveal al hacer scroll ─────────────────────────────────────────────────

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cx("reveal", inView && "reveal-in", className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// ─── Toasts ─────────────────────────────────────────────────────────────────

export interface ToastData {
  id: string;
  msg: string;
  kind: "ok" | "err" | "info";
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={cx(
            "toast-in pointer-events-auto flex items-start gap-2.5 rounded-md border bg-panel/95 px-3.5 py-3 text-left text-[13px] font-medium shadow-[0_12px_32px_rgba(0,0,0,.5)] backdrop-blur-sm transition-transform hover:scale-[1.015]",
            t.kind === "ok" && "border-bull/40",
            t.kind === "err" && "border-bear/40",
            t.kind === "info" && "border-cyan/40",
          )}
        >
          <span
            className={cx(
              "mt-0.5 shrink-0",
              t.kind === "ok" && "text-bull",
              t.kind === "err" && "text-bear",
              t.kind === "info" && "text-cyan",
            )}
          >
            {t.kind === "ok" ? (
              <IconCheck className="h-4 w-4" />
            ) : t.kind === "err" ? (
              <IconAlert className="h-4 w-4" />
            ) : (
              <IconClipboard className="h-4 w-4" />
            )}
          </span>
          <span className="leading-snug text-snow">{t.msg}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Modal de cierre manual ─────────────────────────────────────────────────

export function CloseModal({
  trade,
  onConfirm,
  onCancel,
}: {
  trade: Trade;
  onConfirm: (exit: number) => void;
  onCancel: () => void;
}) {
  const [exitStr, setExitStr] = useState(String(trade.entry));
  const exit = Number(exitStr.replace(",", "."));
  const valid = Number.isFinite(exit) && exit > 0;
  const risk = riskOf(trade);
  const dir = trade.direction === "LONG" ? 1 : -1;
  const r = valid && risk > 0 ? (dir * (exit - trade.entry)) / risk : null;

  const quick = useMemo(
    () => [
      { label: "Break Even", value: trade.entry },
      { label: "En TP", value: trade.tp },
      { label: "En SL", value: trade.sl },
    ],
    [trade],
  );

  return (
    <div
      className="fade-in fixed inset-0 z-[80] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="pop-in w-full max-w-md rounded-lg border border-line bg-panel shadow-[0_24px_70px_rgba(0,0,0,.6)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="font-display text-xl font-bold tracking-wide text-snow">Cierre manual</h3>
            <p className="num mt-0.5 text-[11px] text-fog">
              {trade.symbol} · {trade.direction} @ {fmtPrice(trade.entry)}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded p-1.5 text-fog transition-colors hover:bg-raise hover:text-snow"
            aria-label="Cerrar"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-fog">
              Precio de salida
            </label>
            <input
              autoFocus
              type="number"
              step="any"
              value={exitStr}
              onChange={(e) => setExitStr(e.target.value)}
              className={cx("field num text-sm", !valid && exitStr !== "" && "field-error")}
            />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q.label}
                  onClick={() => setExitStr(String(q.value))}
                  className={cx(
                    "num rounded border px-2.5 py-1 text-[11px] font-semibold transition-all hover:-translate-y-px",
                    Number(exitStr) === q.value
                      ? "border-gold/60 bg-gold/15 text-gold"
                      : "border-line bg-ink text-fog hover:border-line2 hover:text-snow",
                  )}
                >
                  {q.label} · {fmtPrice(q.value)}
                </button>
              ))}
            </div>
          </div>

          <div
            className={cx(
              "flex items-center justify-between rounded-md border px-4 py-3",
              r == null || r === 0
                ? "border-line bg-ink"
                : r > 0
                  ? "border-bull/40 bg-bulldeep/40"
                  : "border-bear/40 bg-beardeep/40",
            )}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fog">Resultado</span>
            <span
              className={cx(
                "num text-2xl font-bold",
                r == null ? "text-dim" : r === 0 ? "text-fog" : r > 0 ? "text-bull" : "text-bear",
              )}
            >
              {r == null ? "—" : `${fmtR(r)}R`}
            </span>
          </div>
        </div>

        <div className="flex gap-2.5 border-t border-line px-5 py-4">
          <button
            onClick={onCancel}
            className="flex-1 rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-fog transition-colors hover:bg-raise hover:text-snow"
          >
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={() => valid && onConfirm(exit)}
            className="flex-1 rounded-md bg-gold px-4 py-2.5 text-sm font-bold text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirmar cierre
          </button>
        </div>
      </div>
    </div>
  );
}

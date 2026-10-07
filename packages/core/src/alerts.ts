// ─── VELTRIX · Alertas propias (tipos y validación, compartidos entre web y móvil) ───
// El servidor las revisa cada minuto (supabase/functions/_shared/alerts.ts): salta cuando el valor CRUZA el nivel.

export type AlertKind = "price" | "rsi" | "ema";
export type AlertSide = "above" | "below";
export type AlertTf = "5m" | "15m" | "1h" | "4h" | "1d";
export const ALERT_TFS: AlertTf[] = ["5m", "15m", "1h", "4h", "1d"];
export const MAX_ACTIVE_ALERTS = 10;

export interface UserAlert {
  id: string;
  symbol: string;
  kind: AlertKind;
  tf: AlertTf;
  dir: AlertSide;
  level: number | null;
  period: number | null;
  once: boolean;
  active: boolean;
  triggeredAt: string | null;
  triggerCount: number;
}

export interface AlertDraft {
  symbol: string; // BTCUSDT
  kind: AlertKind;
  tf: AlertTf;
  dir: AlertSide;
  level: number | null;
  period: number | null;
  once: boolean;
}

export type AlertDraftError = "level" | "period" | "symbol";

/** Mismos límites que la tabla: precio > 0, RSI entre 1 y 99 con período 2–100, EMA con período 2–200. */
export function checkAlertDraft(d: AlertDraft): { ok: true } | { ok: false; error: AlertDraftError } {
  if (!/^[A-Z0-9]{3,20}$/.test(d.symbol)) return { ok: false, error: "symbol" };
  const int = (n: number | null) => n != null && Number.isInteger(n);
  if (d.kind === "price") return d.level != null && Number.isFinite(d.level) && d.level > 0 ? { ok: true } : { ok: false, error: "level" };
  if (d.kind === "rsi") {
    if (d.level == null || !Number.isFinite(d.level) || d.level < 1 || d.level > 99) return { ok: false, error: "level" };
    return int(d.period) && d.period! >= 2 && d.period! <= 100 ? { ok: true } : { ok: false, error: "period" };
  }
  return int(d.period) && d.period! >= 2 && d.period! <= 200 ? { ok: true } : { ok: false, error: "period" };
}

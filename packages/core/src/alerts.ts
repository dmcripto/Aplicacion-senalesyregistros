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

/**
 * Lee el nivel que escribió la persona. En español el punto separa miles («81.700» = 81700) y la coma
 * separa decimales, pero el campo antes lo leía como decimal («81.700» = 81,7) y la alerta nunca saltaba.
 * Si el texto parece un número con miles y el precio actual deja claro cuál se quiso decir, se usa ese.
 */
export function parseAlertLevel(raw: string, lastPrice: number | null = null): number {
  const v = raw.trim().replace(/\s/g, "");
  const plain = Number(v.replace(",", "."));
  if (!/^\d{1,3}([.,]\d{3})+$/.test(v)) return plain; // no tiene forma de miles: se lee tal cual
  const thousands = Number(v.replace(/[.,]/g, ""));
  if (!Number.isFinite(plain) || plain <= 0) return thousands; // «1.234.567» no se puede leer como decimal
  if (lastPrice == null || !(lastPrice > 0)) return plain;
  return Math.abs(Math.log(thousands / lastPrice)) < Math.abs(Math.log(plain / lastPrice)) ? thousands : plain;
}

/** Un precio que no se parece al actual (menos de 1/5 o más de 5 veces) casi siempre es un error de tipeo. */
export function levelLooksOff(level: number, lastPrice: number | null): boolean {
  return lastPrice != null && lastPrice > 0 && level > 0 && (level < lastPrice / 5 || level > lastPrice * 5);
}

// ─── VELTRIX · Alertas propias ──────────────────────────────────────────────
// La persona crea alertas («avisame cuando el precio cruce 100.000», «cuando el RSI baje de 30», «cuando el precio
// cierre sobre la EMA 50»). El servidor las revisa cada minuto: una alerta salta cuando el valor CRUZA el nivel
// (pasa de un lado al otro), no mientras se queda del mismo lado. Los indicadores se miden sobre la última vela CERRADA,
// para que una mecha pasajera no dispare una alerta; el precio, en vivo.
// Sin dependencias de Deno ni de Node, para poder probarlo en local.

import { esc } from "./telegram.ts";

export type Side = "above" | "below";
export type AlertKind = "price" | "rsi" | "ema";
export type AlertTf = "5m" | "15m" | "1h" | "4h" | "1d";

export interface AlertRow {
  id: string;
  user_id: string;
  symbol: string; // BTCUSDT
  kind: AlertKind;
  tf: AlertTf;
  dir: Side;
  level: number | null;
  period: number | null;
  once: boolean;
  last_side: Side | null;
  trigger_count: number;
}

export const MAX_FETCHES = 40; // pedidos distintos a Binance por corrida (el resto espera a la siguiente)
const ALERT_CONCURRENCY = 8;
const ALERT_KLINES = 500;

// ─── Cálculos (los mismos que el gráfico: ver packages/core/src/indicators.ts) ──

export function emaLast(values: number[], period: number): number | null {
  if (period < 1 || values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) prev = values[i] * k + prev * (1 - k);
  return prev;
}

export function rsiLast(values: number[], period: number): number | null {
  if (period < 1 || values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
}

// ─── Decidir ────────────────────────────────────────────────────────────────

export interface Measure {
  /** Valor que se mide (precio, RSI, o cierre de la última vela para la EMA). */
  value: number;
  /** Con qué se compara (el nivel, o el valor de la EMA). */
  ref: number;
}

export interface MarketData {
  price?: number | null;
  /** Cierres de velas YA cerradas, de la más vieja a la más nueva. */
  closes?: number[] | null;
}

export function measure(a: Pick<AlertRow, "kind" | "level" | "period">, d: MarketData): Measure | null {
  if (a.kind === "price") {
    return d.price != null && d.price > 0 && a.level != null ? { value: d.price, ref: Number(a.level) } : null;
  }
  const closes = d.closes;
  if (!closes?.length) return null;
  if (a.kind === "rsi") {
    const v = rsiLast(closes, Number(a.period));
    return v != null && a.level != null ? { value: v, ref: Number(a.level) } : null;
  }
  const e = emaLast(closes, Number(a.period));
  return e != null ? { value: closes[closes.length - 1], ref: e } : null;
}

/** Lado actual y si hay que avisar: solo cuando cruzó hacia el lado pedido (la primera medición solo fija el lado). */
export function decide(a: Pick<AlertRow, "dir" | "last_side">, m: Measure): { side: Side; fire: boolean } {
  const side: Side = m.value >= m.ref ? "above" : "below";
  return { side, fire: a.last_side != null && a.last_side !== side && side === a.dir };
}

// ─── Textos ─────────────────────────────────────────────────────────────────

export function fmtNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

/** Texto del aviso: título y cuerpo cortos (notificación) y HTML para Telegram. */
export function alertTexts(a: Pick<AlertRow, "symbol" | "kind" | "tf" | "dir" | "period">, m: Measure, lang: "es" | "en"): { title: string; body: string; html: string } {
  const en = lang === "en";
  const up = a.dir === "above";
  let body: string;
  if (a.kind === "price") {
    body = en ? `Price crossed ${up ? "above" : "below"} ${fmtNum(m.ref)} (now ${fmtNum(m.value)})` : `El precio cruzó por ${up ? "encima" : "debajo"} de ${fmtNum(m.ref)} (ahora ${fmtNum(m.value)})`;
  } else if (a.kind === "rsi") {
    body = en
      ? `RSI ${a.period} (${a.tf}) crossed ${up ? "above" : "below"} ${fmtNum(m.ref)} (now ${m.value.toFixed(1)})`
      : `El RSI ${a.period} (${a.tf}) cruzó por ${up ? "encima" : "debajo"} de ${fmtNum(m.ref)} (ahora ${m.value.toFixed(1)})`;
  } else {
    body = en
      ? `Price closed ${up ? "above" : "below"} the EMA ${a.period} (${a.tf}): ${fmtNum(m.value)} vs ${fmtNum(m.ref)}`
      : `El precio cerró por ${up ? "encima" : "debajo"} de la EMA ${a.period} (${a.tf}): ${fmtNum(m.value)} vs ${fmtNum(m.ref)}`;
  }
  const title = `🔔 ${a.symbol}`;
  const html = [`🔔 <b>${en ? "ALERT" : "ALERTA"}</b> · <b>${esc(a.symbol)}</b>`, "", esc(body), "", `<i>${en ? "Your alert in VELTRIX. Not financial advice." : "Tu alerta en VELTRIX. No es asesoramiento financiero."}</i>`].join("\n");
  return { title, body, html };
}

// ─── Datos de mercado (Binance: futuros y, si el par no existe ahí, spot) ───

const ALERT_BASES = ["https://fapi.binance.com/fapi/v1", "https://api.binance.com/api/v3"];

export async function fetchPrice(symbol: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  for (const base of ALERT_BASES) {
    try {
      const res = await fetcher(`${base}/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const p = Number((await res.json()).price);
      if (p > 0) return p;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

/** Cierres de las velas ya cerradas (se descarta la que todavía se está formando). */
export async function fetchClosedCloses(symbol: string, tf: AlertTf, now: number, fetcher: typeof fetch = fetch): Promise<number[] | null> {
  for (const base of ALERT_BASES) {
    try {
      const res = await fetcher(`${base}/klines?symbol=${symbol}&interval=${tf}&limit=${ALERT_KLINES}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const rows = (await res.json()) as unknown[][];
      if (!Array.isArray(rows)) continue;
      const closes = rows.filter((r) => Number(r[6]) < now).map((r) => Number(r[4]));
      if (closes.length) return closes;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

// ─── Revisión periódica ─────────────────────────────────────────────────────

export interface AlertDeps {
  supabase: any;
  /** Avisa a la persona (notificación y Telegram). */
  notify: (a: AlertRow, m: Measure) => Promise<void>;
  getPrice?: (symbol: string) => Promise<number | null>;
  getCloses?: (symbol: string, tf: AlertTf) => Promise<number[] | null>;
}

/**
 * Revisa las alertas activas. Devuelve cuántas saltaron. Pide los datos una sola vez por activo (y temporalidad), con un tope
 * por corrida; las que no entran se revisan en la siguiente (se empieza por las que hace más que no se miran).
 */
export async function runAlerts(deps: AlertDeps, now = Date.now()): Promise<number> {
  const { supabase } = deps;
  const getPrice = deps.getPrice ?? ((s: string) => fetchPrice(s));
  const getCloses = deps.getCloses ?? ((s: string, tf: AlertTf) => fetchClosedCloses(s, tf, Date.now()));

  const { data, error } = await supabase
    .from("price_alerts")
    .select("id,user_id,symbol,kind,tf,dir,level,period,once,last_side,trigger_count,checked_at")
    .eq("active", true)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(500);
  if (error || !data?.length) return 0; // sin el SQL, o sin alertas
  const alerts = data as AlertRow[];

  const keyOf = (a: AlertRow) => (a.kind === "price" ? `p|${a.symbol}` : `k|${a.symbol}|${a.tf}`);
  const keys: string[] = [];
  for (const a of alerts) {
    const k = keyOf(a);
    if (!keys.includes(k) && keys.length < MAX_FETCHES) keys.push(k);
  }
  const market = new Map<string, MarketData>();
  for (let i = 0; i < keys.length; i += ALERT_CONCURRENCY) {
    await Promise.all(
      keys.slice(i, i + ALERT_CONCURRENCY).map(async (k) => {
        const [type, symbol, tf] = k.split("|");
        try {
          market.set(k, type === "p" ? { price: await getPrice(symbol) } : { closes: await getCloses(symbol, tf as AlertTf) });
        } catch {
          market.set(k, {});
        }
      }),
    );
  }

  const nowIso = new Date(now).toISOString();
  const quiet: string[] = [];
  let fired = 0;
  for (const a of alerts) {
    const d = market.get(keyOf(a));
    if (!d) continue; // quedó para la próxima corrida
    const m = measure(a, d);
    if (!m) {
      quiet.push(a.id);
      continue;
    }
    const { side, fire } = decide(a, m);
    if (!fire) {
      if (a.last_side !== side) await supabase.from("price_alerts").update({ last_side: side, checked_at: nowIso }).eq("id", a.id);
      else quiet.push(a.id);
      continue;
    }
    // Se marca antes de avisar: si dos corridas coinciden, solo una avisa.
    const { data: won } = await supabase
      .from("price_alerts")
      .update({ last_side: side, checked_at: nowIso, triggered_at: nowIso, trigger_count: (a.trigger_count ?? 0) + 1, ...(a.once ? { active: false } : {}) })
      .eq("id", a.id)
      .eq("active", true)
      .eq("last_side", a.last_side)
      .select("id");
    if (!won?.length) continue;
    fired++;
    try {
      await deps.notify(a, m);
    } catch (e) {
      console.error("alert notify:", e instanceof Error ? e.message : e);
    }
  }
  if (quiet.length) await supabase.from("price_alerts").update({ checked_at: nowIso }).in("id", quiet);
  return fired;
}

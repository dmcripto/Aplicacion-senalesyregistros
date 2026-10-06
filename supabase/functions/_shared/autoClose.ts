// Detección de TP/SL tocados a partir de velas de precio públicas (Binance / OKX).

export type Direction = "LONG" | "SHORT";

export interface OpenTrade {
  id: string;
  user_id: string;
  symbol: string;
  direction: Direction;
  entry: number;
  tp: number;
  sl: number;
  /** Targets parciales declarados en la señal (antes del TP final). */
  targets?: number[] | null;
  /** Cuántos targets ya se avisaron. */
  targets_hit?: number;
  date: string;
  /** De dónde viene: «bot» = operación del bot simulado (la sigue la función del bot, nunca esta). */
  source?: string | null;
  notes?: string | null;
}

/** Nota de las señales de prueba que cada persona se manda a sí misma (la escribe la función del bot). */
export const TEST_SIGNAL_NOTE = "Señal de prueba de VELTRIX: no es una operación real.";
/** Las operaciones simuladas del bot las cierra y avisa la función del bot: el cierre automático no las toca. */
export const isSimulated = (t: Pick<OpenTrade, "source">) => t.source === "bot";
/** Una señal de prueba se sigue y se avisa solo a su dueño: nunca a comunidades ni por WhatsApp. */
export const isTestSignal = (t: Pick<OpenTrade, "notes">) => t.notes === TEST_SIGNAL_NOTE;

export interface Candle {
  t: number; // apertura, ms
  h: number;
  l: number;
}

export interface MarketSymbol {
  key: string; // clave única, p. ej. "BTCUSDT:spot"
  base: string;
  quote: "USDT" | "USDC";
  perp: boolean;
}

const NOT_CRYPTO = new Set(["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "XAU", "XAG", "SPX", "NAS", "US", "DXY"]);

/** "BTCUSDT", "SOLUSDT.P", "ETHUSDTPERP", "BTCUSD" → símbolo de mercado, o null si no es cripto soportado. */
export function parseMarketSymbol(raw: string): MarketSymbol | null {
  let s = raw.toUpperCase().trim();
  if (s.includes(":")) s = s.split(":").pop()!;
  const perp = /\.P$|PERP$/.test(s);
  s = s.replace(/\.P$|PERP$/, "").replace(/[-_/]/g, "");
  const m = s.match(/^([A-Z0-9]{2,15}?)(USDT|USDC|BUSD|USD)$/);
  if (!m || NOT_CRYPTO.has(m[1])) return null;
  const quote = m[2] === "USDC" ? "USDC" : "USDT";
  return { key: `${m[1]}${quote}:${perp ? "perp" : "spot"}`, base: m[1], quote, perp };
}

/** Primer TP/SL tocado por las velas posteriores a la apertura. Si una misma vela toca ambos, se asume SL (criterio conservador). */
export function detectHit(
  trade: Pick<OpenTrade, "direction" | "tp" | "sl" | "date">,
  candles: Candle[],
): { outcome: "TP" | "SL"; at: number } | null {
  const opened = new Date(trade.date).getTime();
  const long = trade.direction === "LONG";
  for (const c of candles) {
    if (c.t < opened) continue;
    const hitTp = long ? c.h >= trade.tp : c.l <= trade.tp;
    const hitSl = long ? c.l <= trade.sl : c.h >= trade.sl;
    if (hitSl) return { outcome: "SL", at: c.t };
    if (hitTp) return { outcome: "TP", at: c.t };
  }
  return null;
}

/** El «Target 1»: cuando la ganancia llega a este múltiplo de lo arriesgado (R) se avisa para tomar beneficios parciales y mover el SL a break-even. */
export const PARTIAL_R = 1;

/**
 * Precio del Target 1, o null si no corresponde: solo si el TP queda bastante más lejos (a 1,5 veces ese nivel o más),
 * porque si el TP está cerca el aviso del TP alcanza.
 */
export function partialLevel(t: Pick<OpenTrade, "direction" | "entry" | "tp" | "sl">): number | null {
  const risk = Math.abs(t.entry - t.sl);
  if (!(risk > 0)) return null;
  const dir = t.direction === "LONG" ? 1 : -1;
  const tpR = (dir * (t.tp - t.entry)) / risk;
  if (!(tpR >= PARTIAL_R * 1.5)) return null;
  return t.entry + dir * PARTIAL_R * risk;
}

/**
 * Niveles de los targets parciales, del más cercano al más lejano. Si la señal trae sus propios targets se usan esos
 * (los que queden entre la entrada y el TP); si no, vale el «Target 1» automático de 1R (ver `partialLevel`).
 */
export function targetLevels(t: Pick<OpenTrade, "direction" | "entry" | "tp" | "sl" | "targets">): number[] {
  const dir = t.direction === "LONG" ? 1 : -1;
  const own = [...new Set((t.targets ?? []).map(Number))]
    .filter((n) => Number.isFinite(n) && dir * (n - t.entry) > 0 && dir * (n - t.tp) < 0)
    .sort((a, b) => dir * (a - b));
  if (own.length) return own;
  const auto = partialLevel(t);
  return auto == null ? [] : [auto];
}

/**
 * Hora (vela) en que se tocó cada target, en orden, antes de que el precio llegara al SL. Una vela que toca el SL corta la
 * búsqueda (criterio conservador, igual que `detectHit`). El largo del resultado es cuántos targets se alcanzaron.
 */
export function detectTargets(trade: Pick<OpenTrade, "direction" | "entry" | "tp" | "sl" | "targets" | "date">, candles: Candle[]): number[] {
  const levels = targetLevels(trade);
  if (!levels.length) return [];
  const opened = new Date(trade.date).getTime();
  const long = trade.direction === "LONG";
  const times: number[] = [];
  for (const c of candles) {
    if (c.t < opened) continue;
    if (long ? c.l <= trade.sl : c.h >= trade.sl) break;
    while (times.length < levels.length && (long ? c.h >= levels[times.length] : c.l <= levels[times.length])) times.push(c.t);
    if (times.length === levels.length) break;
  }
  return times;
}

/** Primera vela que llegó al Target 1 antes de tocar el SL (si una misma vela toca ambos, se descarta). Devuelve su hora o null. */
export function detectPartial(trade: Pick<OpenTrade, "direction" | "entry" | "tp" | "sl" | "date">, candles: Candle[]): number | null {
  return detectTargets(trade, candles)[0] ?? null;
}

export const rOfHit = (t: Pick<OpenTrade, "entry" | "tp" | "sl">, outcome: "TP" | "SL") => {
  if (outcome === "SL") return -1;
  const risk = Math.abs(t.entry - t.sl);
  return risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
};

// ─── Proveedores de velas ───────────────────────────────────────────────────

const HOUR = 3_600_000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function binanceCandles(sym: MarketSymbol, sinceMs: number): Promise<Candle[]> {
  const age = Date.now() - sinceMs;
  const interval = age <= 16 * HOUR ? "1m" : age <= 10 * 24 * HOUR ? "15m" : age <= 40 * 24 * HOUR ? "1h" : null;
  if (!interval) throw new Error("operación demasiado antigua");
  const host = sym.perp ? "https://fapi.binance.com/fapi/v1/klines" : "https://data-api.binance.vision/api/v3/klines";
  const rows = (await getJson(
    `${host}?symbol=${sym.base}${sym.quote}&interval=${interval}&startTime=${Math.floor(sinceMs)}&limit=1000`,
  )) as unknown[][];
  return rows.map((r) => ({ t: Number(r[0]), h: Number(r[2]), l: Number(r[3]) }));
}

async function okxCandles(sym: MarketSymbol, sinceMs: number): Promise<Candle[]> {
  const age = Date.now() - sinceMs;
  const bar = age <= 5 * HOUR ? "1m" : age <= 25 * HOUR ? "5m" : age <= 12 * 24 * HOUR ? "1H" : age <= 50 * 24 * HOUR ? "4H" : null;
  if (!bar) throw new Error("operación demasiado antigua");
  const instId = `${sym.base}-${sym.quote}${sym.perp ? "-SWAP" : ""}`;
  const json = (await getJson(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=300`)) as {
    data?: string[][];
  };
  if (!json.data?.length) throw new Error("sin datos en OKX");
  return json.data.map((r) => ({ t: Number(r[0]), h: Number(r[2]), l: Number(r[3]) })).reverse();
}

/** Prueba Binance y, si falla (bloqueo regional, símbolo inexistente…), OKX. */
export async function fetchCandles(sym: MarketSymbol, sinceMs: number): Promise<Candle[] | null> {
  for (const provider of [binanceCandles, okxCandles]) {
    try {
      const candles = await provider(sym, sinceMs);
      if (candles.length) return candles;
    } catch (_) {
      // se prueba el siguiente proveedor
    }
  }
  return null;
}

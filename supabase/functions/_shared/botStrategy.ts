// Bot automático (etapa simulada): estrategia de ruptura a favor de la tendencia, y su prueba con historial.
//
// Es una estrategia clásica y transparente, no un secreto ni una promesa de ganancia:
//   · Tendencia: la media rápida (EMA 50) está por encima de la lenta (EMA 200) y el precio también → solo compras.
//     Al revés → solo ventas.
//   · Entrada: la vela cerrada rompe el máximo (o mínimo) de las últimas 20 velas.
//   · Stop: 1,5 veces el ATR(14) de distancia. Objetivo: 2 veces lo arriesgado (2R).
// Funciona sobre velas de 1 hora ya cerradas, sin mirar nunca el futuro. Sin dependencias de Deno.

export interface Bar {
  t: number; // apertura, ms
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface BotParams {
  lookback: number; // velas del canal de ruptura
  emaFast: number;
  emaSlow: number;
  atrLen: number;
  atrMult: number; // distancia del stop, en ATR
  rr: number; // objetivo, en múltiplos del riesgo
  feePct: number; // costo de ida y vuelta (comisión + deslizamiento), en % del precio, solo para la prueba
  tf?: BotTimeframe; // tamaño de vela; sin indicar, 1 hora
}

export type BotTimeframe = "1h" | "4h";

/**
 * Costo supuesto de cada operación en las pruebas con historial, ida y vuelta y en % del precio: comisión de mercado de Bitunix
 * (0,06 % por lado, comprobada con una orden real: 0,12 % ida y vuelta) más 0,02 % de deslizamiento estimado.
 */
export const ROUND_TRIP_COST_PCT = 0.14;

export const DEFAULT_PARAMS: BotParams = { lookback: 20, emaFast: 50, emaSlow: 200, atrLen: 14, atrMult: 1.5, rr: 2, feePct: ROUND_TRIP_COST_PCT };

/** Perfiles de estrategia que cada persona puede elegir (no se dejan los números libres: se sobreajustan con facilidad). */
export type BotProfileId = "conservative" | "balanced" | "dynamic" | "slow";
export const BOT_PROFILE_IDS: BotProfileId[] = ["conservative", "balanced", "dynamic", "slow"];
export const BOT_PROFILES: Record<BotProfileId, BotParams> = {
  // menos señales: canal más largo y stop más holgado
  conservative: { lookback: 40, emaFast: 50, emaSlow: 200, atrLen: 14, atrMult: 2, rr: 2, feePct: ROUND_TRIP_COST_PCT },
  balanced: DEFAULT_PARAMS,
  // más señales: canal corto, tendencia más rápida y objetivo más cercano
  dynamic: { lookback: 10, emaFast: 20, emaSlow: 100, atrLen: 14, atrMult: 1.2, rr: 1.5, feePct: ROUND_TRIP_COST_PCT },
  // los mismos números del equilibrado, con velas de 4 horas: menos operaciones y menos comisiones
  slow: { ...DEFAULT_PARAMS, tf: "4h" },
};
/** La estrategia en una frase (para la nota de cada operación simulada). */
export const describeParams = (p: BotParams) => {
  const n = (x: number) => String(x).replace(".", ",");
  return `ruptura de ${p.lookback} velas${p.tf === "4h" ? " de 4 horas" : ""} a favor de la tendencia (EMA ${p.emaFast}/${p.emaSlow}) · stop ${n(p.atrMult)} ATR · objetivo ${n(p.rr)}R`;
};
export const isProfileId = (x: unknown): x is BotProfileId => typeof x === "string" && (BOT_PROFILE_IDS as string[]).includes(x);
export const paramsOf = (id: unknown): BotParams => (isProfileId(id) ? BOT_PROFILES[id] : DEFAULT_PARAMS);

export const BOT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"] as const;
export const BAR_MS = 3_600_000;
export const barMsOf = (p: Pick<BotParams, "tf">) => (p.tf === "4h" ? 4 * BAR_MS : BAR_MS);
/** Velas mínimas para poder calcular todo (la EMA lenta manda). */
export const WARMUP = (p: BotParams = DEFAULT_PARAMS) => p.emaSlow + 5;

export interface BotSignal {
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp: number;
  t: number; // apertura de la vela que dio la señal
  strength: number; // cuánto se pasó de la ruptura, en ATR (para elegir primero la señal más fuerte cuando hay varias)
}

/** EMA (serie completa); los primeros valores usan el promedio simple como arranque. */
export function ema(values: number[], len: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < len) return out;
  const k = 2 / (len + 1);
  let prev = values.slice(0, len).reduce((a, b) => a + b, 0) / len;
  out[len - 1] = prev;
  for (let i = len; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** ATR de Wilder (serie completa). */
export function atr(bars: Bar[], len: number): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  if (bars.length <= len) return out;
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  let prev = tr.slice(1, len + 1).reduce((a, b) => a + b, 0) / len;
  out[len] = prev;
  for (let i = len + 1; i < bars.length; i++) {
    prev = (prev * (len - 1) + tr[i]) / len;
    out[i] = prev;
  }
  return out;
}

export interface Indicators {
  fast: number[];
  slow: number[];
  atr: number[];
}

export function indicators(bars: Bar[], p: BotParams = DEFAULT_PARAMS): Indicators {
  const closes = bars.map((b) => b.c);
  return { fast: ema(closes, p.emaFast), slow: ema(closes, p.emaSlow), atr: atr(bars, p.atrLen) };
}

/** Señal de la vela cerrada número `i` (solo usa datos hasta `i`). null = sin señal. */
export function signalAt(bars: Bar[], ind: Indicators, i: number, p: BotParams = DEFAULT_PARAMS): BotSignal | null {
  if (i < Math.max(p.emaSlow, p.lookback + 1, p.atrLen + 1) || i >= bars.length) return null;
  const f = ind.fast[i], s = ind.slow[i], a = ind.atr[i], c = bars[i].c;
  if (![f, s, a, c].every(Number.isFinite) || a <= 0) return null;
  let hi = -Infinity, lo = Infinity;
  for (let k = i - p.lookback; k < i; k++) {
    hi = Math.max(hi, bars[k].h);
    lo = Math.min(lo, bars[k].l);
  }
  const dist = a * p.atrMult;
  if (c > hi && f > s && c > s) return { direction: "LONG", entry: c, sl: c - dist, tp: c + dist * p.rr, t: bars[i].t, strength: (c - hi) / a };
  if (c < lo && f < s && c < s) return { direction: "SHORT", entry: c, sl: c + dist, tp: c - dist * p.rr, t: bars[i].t, strength: (lo - c) / a };
  return null;
}

/** Primera vela posterior que toca el stop o el objetivo. Si una misma vela toca ambos, se asume el stop (criterio conservador). */
export function resolveFrom(bars: Bar[], from: number, sig: Pick<BotSignal, "direction" | "sl" | "tp">): { outcome: "TP" | "SL"; index: number } | null {
  const long = sig.direction === "LONG";
  for (let j = from; j < bars.length; j++) {
    const hitSl = long ? bars[j].l <= sig.sl : bars[j].h >= sig.sl;
    if (hitSl) return { outcome: "SL", index: j };
    const hitTp = long ? bars[j].h >= sig.tp : bars[j].l <= sig.tp;
    if (hitTp) return { outcome: "TP", index: j };
  }
  return null;
}

export interface BacktestTrade {
  t: number;
  direction: "LONG" | "SHORT";
  entry: number;
  outcome: "TP" | "SL";
  r: number; // resultado en R, ya con el costo de ida y vuelta
}

export interface BacktestResult {
  bars: number;
  trades: BacktestTrade[];
  open: number; // operaciones que seguían abiertas al final (no cuentan)
}

/** Recorre el historial vela por vela, una sola operación a la vez. */
export function backtest(bars: Bar[], p: BotParams = DEFAULT_PARAMS): BacktestResult {
  const ind = indicators(bars, p);
  const trades: BacktestTrade[] = [];
  let open = 0;
  let i = 0;
  while (i < bars.length - 1) {
    const sig = signalAt(bars, ind, i, p);
    if (!sig) {
      i++;
      continue;
    }
    const hit = resolveFrom(bars, i + 1, sig);
    if (!hit) {
      open++;
      break;
    }
    const risk = Math.abs(sig.entry - sig.sl);
    const gross = hit.outcome === "TP" ? p.rr : -1;
    const cost = ((p.feePct / 100) * sig.entry) / risk; // comisión y deslizamiento medidos en R
    trades.push({ t: sig.t, direction: sig.direction, entry: sig.entry, outcome: hit.outcome, r: gross - cost });
    i = hit.index; // la operación salió dentro de esa vela: al cierre ya puede entrar otra (igual que en vivo)
  }
  return { bars: bars.length, trades, open };
}

export interface BotStats {
  n: number;
  wins: number;
  winRate: number; // %
  expectancy: number; // R por operación
  netR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
}

export function botStats(rs: number[]): BotStats {
  const n = rs.length;
  if (!n) return { n: 0, wins: 0, winRate: 0, expectancy: 0, netR: 0, profitFactor: null, maxDrawdownR: 0 };
  const gain = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const loss = Math.abs(rs.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  let cum = 0, peak = 0, dd = 0;
  for (const r of rs) {
    cum += r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  const wins = rs.filter((r) => r > 0).length;
  return { n, wins, winRate: (wins / n) * 100, expectancy: (gain - loss) / n, netR: gain - loss, profitFactor: loss > 0 ? gain / loss : null, maxDrawdownR: dd };
}

/** Velas cerradas: descarta la última si todavía está en curso. */
export const closedBars = (bars: Bar[], now = Date.now(), barMs = BAR_MS) => bars.filter((b) => b.t + barMs <= now);

/** Cualquier futuro USDT razonable (el escaneo del mercado trae activos que no están en la lista fija de 5). */
export const isTradableSymbol = (s: unknown): s is string => typeof s === "string" && /^[A-Z0-9]{2,15}USDT$/.test(s);

/** Cuántos activos mira el bot cuando escanea el mercado (0 = solo los que eligió la persona). */
export const SCAN_SIZES = [0, 20, 40] as const;
export const scanSizeOf = (x: unknown): number => (SCAN_SIZES as readonly number[]).includes(Number(x)) ? Number(x) : 0;

export const isBotSymbol = (s: unknown): s is (typeof BOT_SYMBOLS)[number] => typeof s === "string" && (BOT_SYMBOLS as readonly string[]).includes(s);

// ─── Velas públicas ─────────────────────────────────────────────────────────

type Fetch = typeof fetch;

async function getJson(fetchFn: Fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Velas de 1 hora (o de 4), de más viejas a más nuevas. Prueba Binance (futuros) y, si falla, Bybit. */
export async function fetchBars(symbol: string, count: number, fetchFn: Fetch = fetch, tf: BotTimeframe = "1h"): Promise<Bar[]> {
  const errors: string[] = [];
  for (const provider of [binanceBars, bybitBars]) {
    try {
      const bars = await provider(symbol, count, fetchFn, tf);
      if (bars.length >= Math.min(count, 300)) return bars;
      errors.push("pocas velas");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`No se pudieron bajar las velas de ${symbol} (${errors.join(", ")})`);
}

async function binanceBars(symbol: string, count: number, fetchFn: Fetch, tf: BotTimeframe): Promise<Bar[]> {
  const out: Bar[] = [];
  let end = Date.now();
  while (out.length < count) {
    const rows = (await getJson(fetchFn, `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=1000&endTime=${end}`)) as unknown[][];
    if (!rows.length) break;
    const page = rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
    out.unshift(...page);
    end = page[0].t - 1;
    if (rows.length < 1000) break;
  }
  return dedupe(out).slice(-count);
}

async function bybitBars(symbol: string, count: number, fetchFn: Fetch, tf: BotTimeframe): Promise<Bar[]> {
  const out: Bar[] = [];
  let end = Date.now();
  while (out.length < count) {
    const j = (await getJson(fetchFn, `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${tf === "4h" ? 240 : 60}&limit=1000&end=${end}`)) as {
      result?: { list?: string[][] };
    };
    const rows = j.result?.list ?? [];
    if (!rows.length) break;
    const page = rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) })).reverse();
    out.unshift(...page);
    end = page[0].t - 1;
    if (rows.length < 1000) break;
  }
  return dedupe(out).slice(-count);
}

function dedupe(bars: Bar[]): Bar[] {
  const seen = new Set<number>();
  return bars.filter((b) => (seen.has(b.t) ? false : (seen.add(b.t), true))).sort((a, b) => a.t - b.t);
}

// ─── Universo del escaneo: los futuros más operados ─────────────────────────

const STABLES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR", "USDE"]);
// Binance también lista futuros de petróleo, oro, acciones y ETF. No son cripto: el escaneo los deja afuera.
const NOT_CRYPTO = new Set(["CL", "BZ", "NG", "HG", "XAU", "XAG", "XPT", "XPD", "NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "SOXL", "SPCX", "SNDK", "QQQ", "SPY", "TQQQ", "SQQQ"]);
const NON_CRYPTO_KIND = /tradfi|stock|equity|commodit|index|forex|fx|etf/i;
const MIN_VOLUME_USDT = 30_000_000; // por debajo de este volumen diario el precio real se aleja mucho del que se ve

/** Los `n` futuros cripto USDT con más volumen en 24 h (Binance y, si falla, Bybit). Sin stablecoins, vencimientos, acciones ni materias primas. */
export async function fetchUniverse(n: number, fetchFn: Fetch = fetch): Promise<string[]> {
  const pick = (rows: Array<{ symbol: string; vol: number }>, allowed: Set<string> | null) =>
    rows
      .filter((r) => isTradableSymbol(r.symbol) && !STABLES.has(r.symbol.slice(0, -4)) && !NOT_CRYPTO.has(r.symbol.slice(0, -4)) && (!allowed || allowed.has(r.symbol)) && Number.isFinite(r.vol) && r.vol >= MIN_VOLUME_USDT)
      .sort((a, b) => b.vol - a.vol)
      .slice(0, n)
      .map((r) => r.symbol);
  const errors: string[] = [];
  try {
    const [rows, info] = await Promise.all([
      getJson(fetchFn, "https://fapi.binance.com/fapi/v1/ticker/24hr") as Promise<Array<{ symbol: string; quoteVolume: string }>>,
      getJson(fetchFn, "https://fapi.binance.com/fapi/v1/exchangeInfo") as Promise<{ symbols?: Array<{ symbol: string; status?: string; contractType?: string; underlyingType?: string; underlyingSubType?: string[] }> }>,
    ]);
    // Solo perpetuos en operación cuyo subyacente es una moneda (no una acción, un índice ni una materia prima).
    const allowed = new Set(
      (info.symbols ?? [])
        .filter((x) => x.status === "TRADING" && x.contractType === "PERPETUAL" && (x.underlyingType == null || x.underlyingType === "COIN") && !(x.underlyingSubType ?? []).some((k) => NON_CRYPTO_KIND.test(k)))
        .map((x) => x.symbol),
    );
    const list = pick(rows.map((r) => ({ symbol: r.symbol, vol: Number(r.quoteVolume) })), allowed);
    if (list.length >= Math.min(n, 3)) return list;
    errors.push("pocos activos");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  try {
    const j = (await getJson(fetchFn, "https://api.bybit.com/v5/market/tickers?category=linear")) as { result?: { list?: Array<{ symbol: string; turnover24h: string }> } };
    const list = pick((j.result?.list ?? []).map((r) => ({ symbol: r.symbol, vol: Number(r.turnover24h) })), null);
    if (list.length >= Math.min(n, 3)) return list;
    errors.push("pocos activos");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  throw new Error(`No se pudo armar la lista de activos (${errors.join(", ")})`);
}

/** Corre `fn` sobre cada elemento con a lo sumo `limit` pedidos a la vez (para no saturar al exchange). */
export async function mapPool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

// ─── Reglas elegidas por la persona (desde «Estrategia sugerida») ───────────

export type BotDim = "symbol" | "weekday" | "hour" | "direction";
/** Mismo formato que `BotAction` del núcleo (packages/core/src/strategy.ts). */
export type BotAction = { op: "skip" | "only"; dim: BotDim; key: string } | { op: "maxPerDay"; n: number } | { op: "stopAfterLosses"; n: number };

const validKey = (dim: BotDim, key: unknown): key is string => {
  if (typeof key !== "string") return false;
  if (dim === "symbol") return isBotSymbol(key);
  if (dim === "weekday") return /^[0-6]$/.test(key);
  if (dim === "hour") return /^[0-7]$/.test(key);
  return key === "LONG" || key === "SHORT";
};

/** Se queda solo con las reglas bien formadas (la base de datos guarda lo que mande el cliente). Máximo 20. */
export function cleanActions(raw: unknown): BotAction[] {
  if (!Array.isArray(raw)) return [];
  const out: BotAction[] = [];
  for (const r of raw.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if ((o.op === "skip" || o.op === "only") && ["symbol", "weekday", "hour", "direction"].includes(o.dim as string) && validKey(o.dim as BotDim, o.key)) {
      out.push({ op: o.op, dim: o.dim as BotDim, key: o.key as string });
    } else if ((o.op === "maxPerDay" || o.op === "stopAfterLosses") && Number.isInteger(o.n) && (o.n as number) >= 1 && (o.n as number) <= 20) {
      out.push({ op: o.op, n: o.n as number });
    }
  }
  return out;
}

/** Día de la semana (0 = domingo) y franja de 3 horas (0–7) en la zona horaria de la persona (UTC si no se sabe). */
export function localParts(ms: number, timeZone: string | null): { weekday: number; block: number } {
  let tz = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(ms));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), block: Math.floor(hour / 3) };
}

/** ¿Las reglas de «no operar» y «solo operar» dejan pasar esta señal? (El tope diario y el freno por pérdidas se controlan aparte.) */
export function allowedByActions(actions: BotAction[], ctx: { symbol: string; direction: string; weekday: number; block: number }): boolean {
  const value = (dim: BotDim) => (dim === "symbol" ? ctx.symbol : dim === "direction" ? ctx.direction : dim === "weekday" ? String(ctx.weekday) : String(ctx.block));
  for (const a of actions) if (a.op === "skip" && a.key === value(a.dim)) return false;
  for (const dim of ["symbol", "weekday", "hour", "direction"] as BotDim[]) {
    const only = actions.filter((a): a is Extract<BotAction, { dim: BotDim }> => a.op === "only" && a.dim === dim);
    if (only.length && !only.some((a) => a.key === value(dim))) return false;
  }
  return true;
}

export const capOf = (actions: BotAction[], op: "maxPerDay" | "stopAfterLosses"): number | null => {
  const ns = actions.filter((a): a is Extract<BotAction, { n: number }> => a.op === op).map((a) => a.n);
  return ns.length ? Math.min(...ns) : null;
};

// ─── Simulación del bot completo (varios activos, topes y reglas) ───────────
// Es la misma lógica que la corrida en vivo, pero recorriendo el historial hora por hora. Sirve para comparar
// «sin reglas» contra «con las reglas que eligió la persona» sobre precios que esas reglas no vieron al armarse.

export interface SimSettings {
  symbols: string[];
  maxOpen: number;
  dailyLossR: number;
  rules: BotAction[];
  timeZone: string | null;
}

export interface SimTrade {
  symbol: string;
  t: number; // apertura de la vela que dio la señal
  direction: "LONG" | "SHORT";
  outcome: "TP" | "SL";
  r: number; // ya con el costo de ida y vuelta
  closedAt: number;
}

interface OpenSim {
  sig: BotSignal;
  openedAt: number;
}

const DAY_MS = 24 * 3_600_000;

export function simulate(barsBySymbol: Record<string, Bar[]>, s: SimSettings, p: BotParams = DEFAULT_PARAMS): { trades: SimTrade[]; open: number } {
  const symbols = s.symbols.filter((x) => barsBySymbol[x]?.length);
  const ind = new Map(symbols.map((x) => [x, indicators(barsBySymbol[x], p)]));
  const at = new Map(symbols.map((x) => [x, new Map(barsBySymbol[x].map((b, i) => [b.t, i]))]));
  const times = [...new Set(symbols.flatMap((x) => barsBySymbol[x].map((b) => b.t)))].sort((a, b) => a - b);
  const maxPerDay = capOf(s.rules, "maxPerDay");
  const stopAfter = capOf(s.rules, "stopAfterLosses");

  const open = new Map<string, OpenSim>();
  const done: SimTrade[] = [];
  const opened: number[] = []; // aperturas (ms) para el tope por día

  const costR = (sig: BotSignal) => ((p.feePct / 100) * sig.entry) / Math.abs(sig.entry - sig.sl);

  const barMs = barMsOf(p);
  for (const T of times) {
    const now = T + barMs; // la vela T ya cerró
    // 1) cerrar lo que esta vela tocó
    for (const symbol of symbols) {
      const o = open.get(symbol);
      const i = at.get(symbol)!.get(T);
      if (!o || i == null) continue;
      const bar = barsBySymbol[symbol][i];
      const hit = resolveFrom([bar], 0, o.sig);
      if (!hit) continue;
      open.delete(symbol);
      done.push({ symbol, t: o.sig.t, direction: o.sig.direction, outcome: hit.outcome, r: (hit.outcome === "TP" ? p.rr : -1) - costR(o.sig), closedAt: now });
    }
    // 2) señales nuevas con los límites de la persona
    const recent = done.filter((d) => d.closedAt > now - DAY_MS && d.closedAt <= now);
    const lossToday = recent.reduce((a, d) => a + d.r, 0);
    if (lossToday <= -s.dailyLossR) continue;
    if (stopAfter != null) {
      let streak = 0;
      for (const d of [...recent].sort((a, b) => b.closedAt - a.closedAt)) {
        if (d.outcome !== "SL") break;
        streak++;
      }
      if (streak >= stopAfter) continue;
    }
    // Todas las señales de esta vela; si hay más que lugares, entran primero las más fuertes.
    const found: Array<{ symbol: string; sig: BotSignal }> = [];
    for (const symbol of symbols) {
      if (open.has(symbol)) continue;
      const i = at.get(symbol)!.get(T);
      if (i == null) continue;
      const sig = signalAt(barsBySymbol[symbol], ind.get(symbol)!, i, p);
      if (sig) found.push({ symbol, sig });
    }
    found.sort((a, b) => b.sig.strength - a.sig.strength);
    for (const { symbol, sig } of found) {
      if (open.size >= s.maxOpen) break;
      if (maxPerDay != null && opened.filter((x) => x > now - DAY_MS).length >= maxPerDay) continue;
      const when = localParts(now, s.timeZone);
      if (!allowedByActions(s.rules, { symbol, direction: sig.direction, weekday: when.weekday, block: when.block })) continue;
      open.set(symbol, { sig, openedAt: now });
      opened.push(now);
    }
  }
  return { trades: done, open: open.size };
}

// ─── Laboratorio de variantes ───────────────────────────────────────────────
// Prueba varias versiones de la estrategia sobre un año de precios y mira si ganan en las DOS mitades por separado.
// Probar muchas versiones y quedarse con la mejor engaña (alguna sale bien por pura suerte); por eso la vara es alta
// y ninguna variante se vuelve un perfil del bot sin confirmarse antes en modo simulado.

export interface LabVariant {
  id: string;
  params: BotParams;
}

export const LAB_DAYS = 360;
export const LAB_VARIANTS: LabVariant[] = [
  { id: "h1-balanced", params: { ...DEFAULT_PARAMS } }, // referencia: lo que se probó hasta ahora
  { id: "h4-balanced", params: { ...DEFAULT_PARAMS, tf: "4h" } },
  { id: "h4-conservative", params: { ...BOT_PROFILES.conservative, tf: "4h" } },
  { id: "h4-wide", params: { lookback: 30, emaFast: 50, emaSlow: 200, atrLen: 14, atrMult: 2.5, rr: 3, feePct: ROUND_TRIP_COST_PCT, tf: "4h" } },
  { id: "h4-fast", params: { ...BOT_PROFILES.dynamic, tf: "4h" } },
];

export interface LabRow {
  id: string;
  tf: BotTimeframe;
  whole: BotStats;
  first: BotStats;
  second: BotStats;
}

/** Corre cada variante con sus velas (`barsFor` da las velas de cada tamaño) y separa las operaciones en dos mitades (antes y después de `midMs`). */
export function runLab(barsFor: (tf: BotTimeframe) => Record<string, Bar[]>, s: Omit<SimSettings, "rules">, midMs: number, variants: LabVariant[] = LAB_VARIANTS): LabRow[] {
  return variants.map((v) => {
    const tf = v.params.tf ?? "1h";
    const trades = simulate(barsFor(tf), { ...s, rules: [] }, v.params).trades;
    const rs = (list: SimTrade[]) => botStats(list.map((x) => x.r));
    return { id: v.id, tf, whole: rs(trades), first: rs(trades.filter((x) => x.t < midMs)), second: rs(trades.filter((x) => x.t >= midMs)) };
  });
}

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
}

export const DEFAULT_PARAMS: BotParams = { lookback: 20, emaFast: 50, emaSlow: 200, atrLen: 14, atrMult: 1.5, rr: 2, feePct: 0.1 };

/** Perfiles de estrategia que cada persona puede elegir (no se dejan los números libres: se sobreajustan con facilidad). */
export type BotProfileId = "conservative" | "balanced" | "dynamic";
export const BOT_PROFILE_IDS: BotProfileId[] = ["conservative", "balanced", "dynamic"];
export const BOT_PROFILES: Record<BotProfileId, BotParams> = {
  // menos señales: canal más largo y stop más holgado
  conservative: { lookback: 40, emaFast: 50, emaSlow: 200, atrLen: 14, atrMult: 2, rr: 2, feePct: 0.1 },
  balanced: DEFAULT_PARAMS,
  // más señales: canal corto, tendencia más rápida y objetivo más cercano
  dynamic: { lookback: 10, emaFast: 20, emaSlow: 100, atrLen: 14, atrMult: 1.2, rr: 1.5, feePct: 0.1 },
};
/** La estrategia en una frase (para la nota de cada operación simulada). */
export const describeParams = (p: BotParams) => {
  const n = (x: number) => String(x).replace(".", ",");
  return `ruptura de ${p.lookback} velas a favor de la tendencia (EMA ${p.emaFast}/${p.emaSlow}) · stop ${n(p.atrMult)} ATR · objetivo ${n(p.rr)}R`;
};
export const isProfileId = (x: unknown): x is BotProfileId => typeof x === "string" && (BOT_PROFILE_IDS as string[]).includes(x);
export const paramsOf = (id: unknown): BotParams => (isProfileId(id) ? BOT_PROFILES[id] : DEFAULT_PARAMS);

export const BOT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"] as const;
export const BAR_MS = 3_600_000;
/** Velas mínimas para poder calcular todo (la EMA lenta manda). */
export const WARMUP = (p: BotParams = DEFAULT_PARAMS) => p.emaSlow + 5;

export interface BotSignal {
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp: number;
  t: number; // apertura de la vela que dio la señal
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
  if (c > hi && f > s && c > s) return { direction: "LONG", entry: c, sl: c - dist, tp: c + dist * p.rr, t: bars[i].t };
  if (c < lo && f < s && c < s) return { direction: "SHORT", entry: c, sl: c + dist, tp: c - dist * p.rr, t: bars[i].t };
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
export const closedBars = (bars: Bar[], now = Date.now()) => bars.filter((b) => b.t + BAR_MS <= now);

export const isBotSymbol = (s: unknown): s is (typeof BOT_SYMBOLS)[number] => typeof s === "string" && (BOT_SYMBOLS as readonly string[]).includes(s);

// ─── Velas públicas ─────────────────────────────────────────────────────────

type Fetch = typeof fetch;

async function getJson(fetchFn: Fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Velas de 1 hora, de más viejas a más nuevas. Prueba Binance (futuros) y, si falla, Bybit. */
export async function fetchBars(symbol: string, count: number, fetchFn: Fetch = fetch): Promise<Bar[]> {
  const errors: string[] = [];
  for (const provider of [binanceBars, bybitBars]) {
    try {
      const bars = await provider(symbol, count, fetchFn);
      if (bars.length >= Math.min(count, 300)) return bars;
      errors.push("pocas velas");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`No se pudieron bajar las velas de ${symbol} (${errors.join(", ")})`);
}

async function binanceBars(symbol: string, count: number, fetchFn: Fetch): Promise<Bar[]> {
  const out: Bar[] = [];
  let end = Date.now();
  while (out.length < count) {
    const rows = (await getJson(fetchFn, `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=1000&endTime=${end}`)) as unknown[][];
    if (!rows.length) break;
    const page = rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
    out.unshift(...page);
    end = page[0].t - 1;
    if (rows.length < 1000) break;
  }
  return dedupe(out).slice(-count);
}

async function bybitBars(symbol: string, count: number, fetchFn: Fetch): Promise<Bar[]> {
  const out: Bar[] = [];
  let end = Date.now();
  while (out.length < count) {
    const j = (await getJson(fetchFn, `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=1000&end=${end}`)) as {
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

  for (const T of times) {
    const now = T + BAR_MS; // la vela T ya cerró
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
    for (const symbol of symbols) {
      if (open.size >= s.maxOpen || open.has(symbol)) continue;
      const i = at.get(symbol)!.get(T);
      if (i == null) continue;
      const sig = signalAt(barsBySymbol[symbol], ind.get(symbol)!, i, p);
      if (!sig) continue;
      if (maxPerDay != null && opened.filter((x) => x > now - DAY_MS).length >= maxPerDay) continue;
      const when = localParts(now, s.timeZone);
      if (!allowedByActions(s.rules, { symbol, direction: sig.direction, weekday: when.weekday, block: when.block })) continue;
      open.set(symbol, { sig, openedAt: now });
      opened.push(now);
    }
  }
  return { trades: done, open: open.size };
}

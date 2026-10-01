// ─── VELTRIX · Mapa de liquidaciones (estimado) ─────────────────────────────
// Los exchanges no publican dónde están las liquidaciones pendientes. Esto las ESTIMA con datos públicos
// (precio por hora, interés abierto y proporción de largos/cortos), de forma parecida a los mapas profesionales:
//   1. Cada hora en que el interés abierto sube, se abrieron posiciones nuevas cerca del precio de esa hora.
//   2. Se reparten entre largos y cortos, y entre apalancamientos típicos (5x a 100x).
//   3. De cada una se calcula su precio de liquidación.
//   4. Si el precio ya pasó por ese nivel después de abrirse, esa posición ya se liquidó: se descarta.
// Lo que queda son las zonas donde todavía hay liquidaciones pendientes. Es una estimación, no un dato exacto.
// Sin dependencias de Deno ni de Node: solo fetch, para poder probarlo en local.

export type Source = "binance" | "bybit";

export interface Bar {
  t: number; // apertura de la vela (ms)
  h: number;
  l: number;
  c: number;
}
export interface OiPoint {
  t: number;
  usd: number; // interés abierto en dólares
}
export interface LsPoint {
  t: number;
  longShare: number; // 0..1: proporción de cuentas largas
}

export interface MapBucket {
  price: number; // centro del nivel
  longs: number; // intensidad relativa 0..100 de liquidaciones de largos
  shorts: number; // idem cortos
}

export interface LiquidationMapData {
  coin: string;
  symbol: string;
  source: Source;
  price: number;
  step: number;
  hours: number; // horas de historia usadas
  buckets: MapBucket[]; // de menor a mayor precio
  topLong: { price: number; pct: number } | null; // mayor concentración de liquidaciones de largos (debajo del precio)
  topShort: { price: number; pct: number } | null; // idem cortos (arriba del precio)
  computedAt: number;
}

export const COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "SUI"];

/** Apalancamientos típicos y qué parte de las posiciones nuevas se supone en cada uno. */
export const LEVERAGES: Array<{ x: number; w: number }> = [
  { x: 5, w: 0.1 },
  { x: 10, w: 0.25 },
  { x: 25, w: 0.3 },
  { x: 50, w: 0.2 },
  { x: 100, w: 0.15 },
];
const MMR = 0.005; // margen de mantenimiento supuesto (0,5 %)
const HOUR = 3_600_000;

const hourKey = (t: number) => Math.floor(t / HOUR);

export interface ComputeOptions {
  rangePct?: number; // qué tan lejos del precio actual se muestra (0,15 = ±15 %)
  buckets?: number; // cantidad de niveles de precio
}

export function computeMap(bars: Bar[], oi: OiPoint[], ls: LsPoint[], meta: { coin: string; symbol: string; source: Source }, opts: ComputeOptions = {}): LiquidationMapData {
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  if (sorted.length < 5) throw new Error("not enough bars");
  const price = sorted[sorted.length - 1].c;
  const rangePct = opts.rangePct ?? 0.15;
  const n = opts.buckets ?? 90;
  const lo = price * (1 - rangePct);
  const hi = price * (1 + rangePct);
  const step = (hi - lo) / n;

  // Precio mínimo / máximo que se alcanzó DESPUÉS de cada vela (para saber si un nivel ya fue tocado).
  const sufMin: number[] = new Array(sorted.length + 1).fill(Infinity);
  const sufMax: number[] = new Array(sorted.length + 1).fill(-Infinity);
  for (let i = sorted.length - 1; i >= 0; i--) {
    sufMin[i] = Math.min(sufMin[i + 1], sorted[i].l);
    sufMax[i] = Math.max(sufMax[i + 1], sorted[i].h);
  }

  const oiByHour = new Map(oi.map((p) => [hourKey(p.t), p.usd]));
  const lsByHour = new Map(ls.map((p) => [hourKey(p.t), p.longShare]));
  const longs = new Array(n).fill(0);
  const shorts = new Array(n).fill(0);
  const bucketOf = (p: number) => Math.floor((p - lo) / step);

  let prevOi: number | undefined;
  let used = 0;
  for (let i = 0; i < sorted.length; i++) {
    const bar = sorted[i];
    const cur = oiByHour.get(hourKey(bar.t));
    if (cur === undefined) continue;
    const delta = prevOi === undefined ? 0 : cur - prevOi;
    prevOi = cur;
    if (!(delta > 0)) continue; // solo cuenta lo que se abrió: las bajas del interés abierto no suman
    used++;
    const entry = (bar.h + bar.l + bar.c) / 3;
    const longShare = Math.min(0.9, Math.max(0.1, lsByHour.get(hourKey(bar.t)) ?? 0.5));
    for (const { x, w } of LEVERAGES) {
      const longLiq = entry * (1 - 1 / x + MMR);
      const shortLiq = entry * (1 + 1 / x - MMR);
      if (sufMin[i + 1] > longLiq) {
        const b = bucketOf(longLiq);
        if (b >= 0 && b < n) longs[b] += delta * longShare * w;
      }
      if (sufMax[i + 1] < shortLiq) {
        const b = bucketOf(shortLiq);
        if (b >= 0 && b < n) shorts[b] += delta * (1 - longShare) * w;
      }
    }
  }

  const max = Math.max(1e-9, ...longs, ...shorts);
  const buckets: MapBucket[] = longs.map((_, b) => ({
    price: lo + (b + 0.5) * step,
    longs: Math.round((longs[b] / max) * 1000) / 10,
    shorts: Math.round((shorts[b] / max) * 1000) / 10,
  }));

  const top = (key: "longs" | "shorts") => {
    let best: MapBucket | null = null;
    for (const b of buckets) if (b[key] > 0 && (!best || b[key] > best[key])) best = b;
    return best ? { price: best.price, pct: (best.price / price - 1) * 100 } : null;
  };

  return {
    coin: meta.coin,
    symbol: meta.symbol,
    source: meta.source,
    price,
    step,
    hours: used,
    buckets,
    topLong: top("longs"),
    topShort: top("shorts"),
    computedAt: Date.now(),
  };
}

// ─── Datos públicos ─────────────────────────────────────────────────────────

type FetchFn = typeof fetch;

async function getJson(fetchFn: FetchFn, url: string): Promise<any> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return res.json();
}
const f = (v: unknown) => Number(v);

export async function fetchBinance(symbol: string, fetchFn: FetchFn = fetch) {
  const base = "https://fapi.binance.com";
  const [klines, oi, ls] = await Promise.all([
    getJson(fetchFn, `${base}/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=500`),
    getJson(fetchFn, `${base}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=500`),
    getJson(fetchFn, `${base}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=500`).catch(() => []),
  ]);
  return {
    bars: (klines as any[][]).map((k) => ({ t: f(k[0]), h: f(k[2]), l: f(k[3]), c: f(k[4]) })),
    oi: (oi as any[]).map((p) => ({ t: f(p.timestamp), usd: f(p.sumOpenInterestValue) })),
    ls: (ls as any[]).map((p) => ({ t: f(p.timestamp), longShare: f(p.longAccount) })),
  };
}

export async function fetchBybit(symbol: string, fetchFn: FetchFn = fetch) {
  const base = "https://api.bybit.com";
  const [klines, oi, ls] = await Promise.all([
    getJson(fetchFn, `${base}/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=500`),
    getJson(fetchFn, `${base}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h&limit=200`),
    getJson(fetchFn, `${base}/v5/market/account-ratio?category=linear&symbol=${symbol}&period=1h&limit=200`).catch(() => null),
  ]);
  const bars = ((klines?.result?.list ?? []) as any[][]).map((k) => ({ t: f(k[0]), h: f(k[2]), l: f(k[3]), c: f(k[4]) }));
  const px = new Map(bars.map((b) => [hourKey(b.t), b.c]));
  return {
    bars,
    // En Bybit el interés abierto viene en monedas: se pasa a dólares con el cierre de esa hora.
    oi: ((oi?.result?.list ?? []) as any[])
      .map((p) => ({ t: f(p.timestamp), usd: f(p.openInterest) * (px.get(hourKey(f(p.timestamp))) ?? 0) }))
      .filter((p) => p.usd > 0),
    ls: ((ls?.result?.list ?? []) as any[]).map((p) => ({ t: f(p.timestamp), longShare: f(p.buyRatio) })),
  };
}

/** Binance primero; si no responde (por ejemplo bloqueo regional), Bybit. */
export async function buildMap(coin: string, fetchFn: FetchFn = fetch, opts: ComputeOptions = {}): Promise<LiquidationMapData> {
  const symbol = `${coin}USDT`;
  const attempts: Array<[Source, () => Promise<{ bars: Bar[]; oi: OiPoint[]; ls: LsPoint[] }>]> = [
    ["binance", () => fetchBinance(symbol, fetchFn)],
    ["bybit", () => fetchBybit(symbol, fetchFn)],
  ];
  let lastError: unknown;
  for (const [source, load] of attempts) {
    try {
      const d = await load();
      return computeMap(d.bars, d.oi, d.ls, { coin, symbol, source }, opts);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("sin datos");
}

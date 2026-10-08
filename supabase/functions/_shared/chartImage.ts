// ─── VELTRIX · Gráfico de velas como imagen para Telegram (/grafico BTCUSDT 4h) ─────────────────────────────────────
// Velas + volumen (y, si se pide, dos EMA) dibujadas como SVG con los colores de TradingView y convertidas a PNG con el
// mismo motor de las tarjetas. Datos públicos de Binance (futuros y, si no existe ahí, spot). Sin datos personales.

import { esc } from "./telegram.ts";
import { svgToPng } from "./card.ts";
import { buildMap } from "./liquidations.ts";
import type { Hotspot } from "./liquidations.ts";

export interface Ohlc {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const CHART_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

export interface ChartRequest {
  symbol: string; // BTCUSDT
  interval: ChartInterval;
  ema: boolean;
  liq: boolean; // niveles del mapa de liquidaciones
}

const CH_QUOTES = ["USDT", "USDC", "BUSD", "USD"];

/** «BTC», «btcusdt», «BINANCE:BTCUSDT», «BTC/USDT» → BTCUSDT. */
export function normalizeSymbol(raw: string): string | null {
  let s = raw.toUpperCase().split(":").pop()!.replace(/\.P$/, "").replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{2,15}$/.test(s)) return null;
  if (!CH_QUOTES.some((q) => s.endsWith(q) && s.length > q.length)) s += "USDT";
  return s;
}

export function normalizeInterval(raw: string): ChartInterval | null {
  const m = /^(\d+)([a-zA-Z]+)$/.exec(raw.trim());
  if (!m) return /^[dD]$/.test(raw) ? "1d" : /^[wW]$/.test(raw) ? "1w" : null;
  const unit = m[2].toLowerCase();
  const n = Number(m[1]);
  const v = unit === "m" || unit === "min" ? `${n}m` : unit === "h" ? `${n}h` : unit === "d" ? `${n}d` : unit === "w" ? `${n}w` : "";
  return (CHART_INTERVALS as readonly string[]).includes(v) ? (v as ChartInterval) : null;
}

/** Lee «/grafico BTCUSDT 4h ema». Devuelve null si no hay un símbolo válido. El intervalo por defecto es 1h. */
export function parseChartArgs(args: string[]): ChartRequest | null {
  let symbol: string | null = null;
  let interval: ChartInterval | null = null;
  let ema = false;
  let liq = false;
  for (const a of args) {
    const low = a.toLowerCase();
    if (low === "ema") {
      ema = true;
      continue;
    }
    if (low === "liq" || low === "liquidaciones") {
      liq = true;
      continue;
    }
    if (!symbol && !interval) {
      const iv = normalizeInterval(a);
      if (iv && /^\d/.test(a)) {
        interval = iv;
        continue;
      }
    }
    if (!symbol) {
      symbol = normalizeSymbol(a);
      continue;
    }
    interval ??= normalizeInterval(a);
  }
  return symbol ? { symbol, interval: interval ?? "1h", ema, liq } : null;
}

const CH_BARS = 110;

async function chGetRows(url: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j) && j.length ? (j as unknown[][]) : null;
  } catch {
    return null;
  }
}

/** Velas de Binance: futuros y, si ahí no existe el símbolo, spot. Devuelve también de dónde salieron. */
export async function fetchOhlc(symbol: string, interval: ChartInterval): Promise<{ bars: Ohlc[]; source: string } | null> {
  const q = `symbol=${symbol}&interval=${interval}&limit=${CH_BARS}`;
  for (const [source, url] of [
    ["Binance Futures", `https://fapi.binance.com/fapi/v1/klines?${q}`],
    ["Binance", `https://data-api.binance.vision/api/v3/klines?${q}`],
  ] as const) {
    const rows = await chGetRows(url);
    if (!rows) continue;
    const bars = rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) })).filter((b) => b.h > 0 && b.l > 0);
    if (bars.length > 5) return { bars, source };
  }
  return null;
}

export function chEma(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

/** 12 300 000 → «$12.3M». */
function chUsd(v: number): string {
  return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;
}

const CH_C = { bg: "#131722", grid: "#2a2e39", text: "#b2b5be", bull: "#26a69a", bear: "#ef5350", cyan: "#2ec4f1" };
const CH_W = 1200;
const CH_H = 720;
const PLOT_R = 1110; // el eje de precios queda a la derecha
const PLOT_L = 20;
const PRICE_T = 96;
const PRICE_B = 560;
const VOL_T = 580;
const VOL_B = 672;

/** Precio con los decimales justos según su tamaño. */
export function fmtChartPrice(p: number): string {
  const d = p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.1 ? 5 : 7;
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function chNiceStep(range: number, target: number): number {
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

function chTimeLabel(ms: number, interval: ChartInterval, lang: "es" | "en"): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const mon = d.toLocaleString(lang === "en" ? "en-US" : "es-AR", { month: "short", timeZone: "UTC" }).replace(".", "");
  if (interval === "1d" || interval === "1w") return `${day} ${mon}`;
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function chartSvg(req: ChartRequest, bars: Ohlc[], source: string, lang: "es" | "en", spots: Hotspot[] = []): string {
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  const pad = (hi - lo || hi * 0.01) * 0.06;
  const max = hi + pad;
  const min = lo - pad;
  const y = (p: number) => PRICE_T + ((max - p) / (max - min)) * (PRICE_B - PRICE_T);
  const n = bars.length;
  const step = (PLOT_R - PLOT_L - 12) / n;
  const x = (i: number) => PLOT_L + 6 + step * (i + 0.5);
  const bw = Math.max(2, step * 0.7);
  const maxVol = Math.max(...bars.map((b) => b.v)) || 1;

  let grid = "";
  const ps = chNiceStep(max - min, 7);
  for (let p = Math.ceil(min / ps) * ps; p < max; p += ps) {
    grid += `<line x1="${PLOT_L}" x2="${PLOT_R}" y1="${y(p).toFixed(1)}" y2="${y(p).toFixed(1)}" stroke="${CH_C.grid}" stroke-width="1"/>
    <text x="${PLOT_R + 10}" y="${(y(p) + 5).toFixed(1)}" font-size="15" fill="${CH_C.text}">${esc(fmtChartPrice(p))}</text>`;
  }
  const every = Math.ceil(n / 8);
  for (let i = every - 1; i < n; i += every) {
    grid += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${PRICE_T}" y2="${VOL_B}" stroke="${CH_C.grid}" stroke-width="1" opacity="0.6"/>
    <text x="${x(i).toFixed(1)}" y="${VOL_B + 26}" font-size="15" text-anchor="middle" fill="${CH_C.text}">${esc(chTimeLabel(bars[i].t, req.interval, lang))}</text>`;
  }

  let candles = "";
  bars.forEach((b, i) => {
    const up = b.c >= b.o;
    const col = up ? CH_C.bull : CH_C.bear;
    const top = y(Math.max(b.o, b.c));
    const h = Math.max(1, Math.abs(y(b.o) - y(b.c)));
    candles += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}" stroke="${col}" stroke-width="1.4"/>
    <rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}"/>
    <rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(VOL_B - (b.v / maxVol) * (VOL_B - VOL_T)).toFixed(1)}" width="${bw.toFixed(1)}" height="${((b.v / maxVol) * (VOL_B - VOL_T)).toFixed(1)}" fill="${col}" opacity="0.5"/>`;
  });

  let lines = "";
  let legend = "";
  if (req.ema) {
    const closes = bars.map((b) => b.c);
    for (const [period, col] of [[20, "#f5c542"], [50, "#b388ff"]] as const) {
      const e = chEma(closes, period);
      lines += `<polyline fill="none" stroke="${col}" stroke-width="2" points="${e.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`;
      legend += `<tspan fill="${col}" dx="18">EMA ${period}</tspan>`;
    }
  }

  // Mapa de liquidaciones: los niveles más cargados que caen dentro del rango visible (más gruesa = más dinero).
  let liqSvg = "";
  const shown = spots.filter((h) => h.price > min && h.price < max);
  const maxUsd = Math.max(1, ...shown.map((h) => h.usd));
  for (const h of shown) {
    const col = h.side === "long" ? "#ff9f43" : "#7c8cff";
    const yy = y(h.price).toFixed(1);
    const w = h.usd > maxUsd * 0.66 ? 3 : h.usd > maxUsd * 0.33 ? 2 : 1.2;
    const label = `${h.side === "long" ? (lang === "en" ? "Long liq." : "Liq. largos") : lang === "en" ? "Short liq." : "Liq. cortos"} ${chUsd(h.usd)}`;
    liqSvg += `<line x1="${PLOT_L}" x2="${PLOT_R}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-width="${w}" opacity="0.85"/>
    <text x="${PLOT_L + 8}" y="${(h.price > 0 ? y(h.price) - 6 : 0).toFixed(1)}" font-size="14" font-weight="700" fill="${col}">${esc(label)}</text>`;
  }
  const last = bars[n - 1];
  const first = bars[0];
  const chg = ((last.c - first.o) / first.o) * 100;
  const upLast = last.c >= last.o;
  const lastCol = upLast ? CH_C.bull : CH_C.bear;
  const ly = y(last.c);
  const base = esc(req.symbol);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CH_W}" height="${CH_H}" viewBox="0 0 ${CH_W} ${CH_H}" font-family="Inter">
  <rect width="${CH_W}" height="${CH_H}" fill="${CH_C.bg}"/>
  <text x="${CH_W / 2 - 40}" y="${(PRICE_T + PRICE_B) / 2 + 40}" font-size="110" font-weight="700" letter-spacing="14" text-anchor="middle" fill="#ffffff" opacity="0.04">VELTRIX</text>
  ${grid}
  ${candles}
  ${lines}
  ${liqSvg}
  <line x1="${PLOT_L}" x2="${PLOT_R}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${lastCol}" stroke-width="1" stroke-dasharray="4 4"/>
  <rect x="${PLOT_R + 2}" y="${(ly - 13).toFixed(1)}" width="${CH_W - PLOT_R - 4}" height="26" rx="3" fill="${lastCol}"/>
  <text x="${PLOT_R + 10}" y="${(ly + 5).toFixed(1)}" font-size="15" font-weight="700" fill="#ffffff">${esc(fmtChartPrice(last.c))}</text>
  <text x="24" y="40" font-size="26" font-weight="700" fill="#ffffff">${base} <tspan fill="${CH_C.text}" font-weight="400" font-size="20">· ${esc(req.interval)} · ${esc(source)}</tspan></text>
  <text x="24" y="72" font-size="16" fill="${CH_C.text}">O <tspan fill="${lastCol}">${esc(fmtChartPrice(last.o))}</tspan>  H <tspan fill="${lastCol}">${esc(fmtChartPrice(last.h))}</tspan>  L <tspan fill="${lastCol}">${esc(fmtChartPrice(last.l))}</tspan>  C <tspan fill="${lastCol}">${esc(fmtChartPrice(last.c))}</tspan>  <tspan fill="${chg >= 0 ? CH_C.bull : CH_C.bear}">${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(2)}%</tspan>${legend}</text>
  <text x="${CH_W - 24}" y="40" font-size="22" font-weight="700" letter-spacing="5" text-anchor="end" fill="${CH_C.cyan}">VELTRIX</text>
</svg>`;
}

export interface ChartResult {
  png: Uint8Array;
  caption: string;
}

/** Baja las velas, dibuja y convierte. Devuelve "notfound" si el símbolo no existe y null si falló el dibujo. */
export async function chartImage(req: ChartRequest, lang: "es" | "en"): Promise<ChartResult | "notfound" | null> {
  const data = await fetchOhlc(req.symbol, req.interval);
  if (!data) return "notfound";
  let spots: Hotspot[] = [];
  if (req.liq) {
    try {
      spots = (await buildMap(req.symbol.replace(/(USDT|USDC|BUSD|USD)$/, ""))).hotspots;
    } catch {
      /* sin mapa para esta moneda: el gráfico sale igual, solo con velas */
    }
  }
  const png = await svgToPng(chartSvg(req, data.bars, data.source, lang, spots));
  if (!png) return null;
  const last = data.bars[data.bars.length - 1];
  return { png, caption: `<b>${esc(req.symbol)}</b> · ${req.interval} · ${esc(fmtChartPrice(last.c))}\n<a href="https://veltrix-trading.vercel.app">VELTRIX</a>` };
}

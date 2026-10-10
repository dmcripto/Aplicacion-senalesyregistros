// ─── VELTRIX · Herramientas extra del bot de Telegram para la comunidad ─────
// Ranking semanal, /niveles, /calc, resumen de mercado de la mañana, avisos de funding y de movimientos fuertes,
// votación de señales, aviso de sobreexposición y filtro de activos. Lo puro (cálculos y textos) no depende de Deno
// ni de la red, para probarlo en local; lo que habla con Supabase/Binance recibe sus dependencias.

import { claim, unclaim, DIGEST_HOUR, DIGEST_UNTIL } from "./economy.ts";
import { localDay, localHour, rOf, validTz } from "./dailySummary.ts";
import type { SumTrade } from "./dailySummary.ts";
import { emaLast, rsiLast, fetchClosedCloses } from "./alerts.ts";
import { esc, notifyTelegram } from "./telegram.ts";
import type { Lang } from "./telegram.ts";

/** Precio con los decimales justos según su tamaño (igual que en el gráfico). */
const fmtPx = (p: number) => {
  const d = p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.1 ? 5 : 7;
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

const ctR = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;
const ctBase = (symbol: string) => symbol.replace(/(USDT|USDC)$/, "");

// ═══ 1) Ranking semanal ═════════════════════════════════════════════════════

export interface RankTrade extends SumTrade {
  symbol: string;
}

export interface WeeklyRanking {
  closed: number;
  wins: number;
  losses: number;
  netR: number;
  winrate: number; // 0–100
  best: { symbol: string; r: number } | null;
  worst: { symbol: string; r: number } | null;
}

/** Resultado de las operaciones cerradas en [from, to). Sin cerradas devuelve null. */
export function weeklyRanking(trades: RankTrade[], from: number, to: number): WeeklyRanking | null {
  const rows = trades
    .filter((t) => t.outcome !== "ABIERTA" && t.closed_at && new Date(t.closed_at).getTime() >= from && new Date(t.closed_at).getTime() < to)
    .map((t) => ({ symbol: t.symbol, r: rOf(t) }));
  if (!rows.length) return null;
  const wins = rows.filter((x) => x.r > 0).length;
  const losses = rows.filter((x) => x.r < 0).length;
  const sorted = [...rows].sort((a, b) => b.r - a.r);
  return {
    closed: rows.length,
    wins,
    losses,
    netR: rows.reduce((a, x) => a + x.r, 0),
    winrate: Math.round((wins / rows.length) * 100),
    best: sorted[0].r > 0 ? sorted[0] : null,
    worst: sorted[sorted.length - 1].r < 0 ? sorted[sorted.length - 1] : null,
  };
}

export function weeklyMessage(w: WeeklyRanking | null, lang: Lang): string {
  const en = lang === "en";
  if (!w) return en ? "🏆 <b>Weekly ranking</b>\n\nNo trades were closed this week." : "🏆 <b>Ranking semanal</b>\n\nEsta semana no se cerró ninguna operación.";
  const lines = [
    `🏆 <b>${en ? "Weekly ranking" : "Ranking semanal"}</b> · VELTRIX`,
    "",
    `${en ? "Closed" : "Cerradas"}: <b>${w.closed}</b> (${w.wins} ✅ · ${w.losses} ❌)`,
    `${en ? "Win rate" : "Acierto"}: <b>${w.winrate}%</b>`,
    `${en ? "Net result" : "Resultado neto"}: <b>${ctR(w.netR)}</b>`,
  ];
  if (w.best) lines.push("", `🥇 ${en ? "Best" : "Mejor"}: <b>${esc(ctBase(w.best.symbol))}</b> ${ctR(w.best.r)}`);
  if (w.worst) lines.push(`📉 ${en ? "Worst" : "Peor"}: <b>${esc(ctBase(w.worst.symbol))}</b> ${ctR(w.worst.r)}`);
  lines.push("", `<i>${en ? "For personal record-keeping: not financial advice." : "Información para registro personal: no es asesoramiento financiero."}</i>`);
  return lines.join("\n");
}

/** Semana en curso: de las últimas 7 días hasta ahora. */
export const WEEK_MS = 7 * 86_400_000;

/** Número de semana ISO-ish (año + semana), para la marca de «ya publicado». */
export function weekKey(ms: number, tz: string): string {
  const day = localDay(ms, tz);
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // jueves de esa semana
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

/** ¿Es domingo desde las 20:00 en la zona de la persona? */
export function isWeeklyTime(now: number, tz: string): boolean {
  const day = new Date(`${localDay(now, tz)}T00:00:00Z`).getUTCDay();
  return day === 0 && localHour(now, tz) >= 20;
}

export interface PostDeps {
  supabase: any;
  send: (chatId: number, html: string, thread: number | null) => Promise<{ ok?: boolean; error_code?: number } | void>;
}

/** Domingo a la noche: publica el ranking de la semana en cada comunidad (una vez por semana). */
export async function postWeeklyRanking(deps: PostDeps, now = Date.now()): Promise<number> {
  const { supabase } = deps;
  const { data: rows, error } = await supabase.from("telegram_communities").select("id,user_id,chat_id,thread_id");
  if (error || !rows?.length) return 0;
  const owners = [...new Set((rows as any[]).map((r) => r.user_id as string))];
  const { data: profiles } = await supabase.from("profiles").select("id,timezone,lang").in("id", owners);
  const profOf = new Map<string, { timezone: string | null; lang: string | null }>((profiles ?? []).map((p: any) => [p.id as string, p]));
  let sent = 0;
  for (const row of rows as any[]) {
    const prof = profOf.get(row.user_id);
    const tz = validTz(prof?.timezone);
    if (!tz || !isWeeklyTime(now, tz)) continue;
    const key = `weekly:${weekKey(now, tz)}`;
    const chatId = Number(row.chat_id);
    if (!(await claim(supabase, key, chatId))) continue;
    const trades = await communityTrades(supabase, row.user_id, now - WEEK_MS);
    const w = weeklyRanking(trades, now - WEEK_MS, now + 1);
    if (!w) continue; // semana sin cierres: no se publica nada
    const r = await deps.send(chatId, weeklyMessage(w, prof?.lang === "en" ? "en" : "es"), row.thread_id ? Number(row.thread_id) : null);
    if (r?.ok) sent++;
    else {
      await unclaim(supabase, key, chatId);
      if (r?.error_code === 403) await supabase.from("telegram_communities").delete().eq("id", row.id);
    }
  }
  return sent;
}

/** Operaciones de la cuenta que se muestran a la comunidad (sin las del bot simulado ni las de prueba). */
export async function communityTrades(supabase: any, userId: string, sinceMs: number): Promise<RankTrade[]> {
  const { data } = await supabase
    .from("trades")
    .select("symbol,direction,entry,tp,sl,date,outcome,exit,closed_at,source,notes")
    .eq("user_id", userId)
    .neq("outcome", "ABIERTA")
    .gte("closed_at", new Date(sinceMs).toISOString())
    .limit(1000);
  return ((data ?? []) as Array<RankTrade & { source?: string | null; notes?: string | null }>)
    .filter((t) => t.source !== "bot" && !/^Señal de prueba de VELTRIX|^Señal publicada solo para/.test(t.notes ?? ""))
    .map((t) => ({ ...t, entry: Number(t.entry), tp: Number(t.tp), sl: Number(t.sl), exit: t.exit == null ? null : Number(t.exit) }));
}

// ═══ 2) /calc ═══════════════════════════════════════════════════════════════

export interface CalcInput {
  entry: number;
  sl: number;
  capital: number;
  riskPct: number;
  tp?: number;
}

/** «/calc 65000 64500 1000 1 [67000]» (también acepta una moneda al principio y un % pegado). Null si falta algo. */
export function parseCalcArgs(args: string[], defaults: { capital?: number | null; riskPct?: number | null } = {}): CalcInput | null {
  const nums = args
    .map((a) => a.replace(/%$/, "").replace(",", "."))
    .filter((a) => /^\d+(\.\d+)?$/.test(a))
    .map(Number);
  if (nums.length < 2) return null;
  const [entry, sl, c, r, tp] = nums;
  const capital = c ?? defaults.capital ?? 0;
  const riskPct = r ?? defaults.riskPct ?? 0;
  if (!(entry > 0) || !(sl > 0) || entry === sl || !(capital > 0) || !(riskPct > 0) || riskPct > 100) return null;
  return { entry, sl, capital, riskPct, ...(tp && tp > 0 ? { tp } : {}) };
}

export interface CalcResult {
  riskUsd: number;
  qty: number;
  notional: number;
  leverage: number;
  stopPct: number;
  direction: "LONG" | "SHORT";
  rr: number | null;
}

export function calcPosition(i: CalcInput): CalcResult {
  const riskUsd = (i.capital * i.riskPct) / 100;
  const dist = Math.abs(i.entry - i.sl);
  const qty = riskUsd / dist;
  const notional = qty * i.entry;
  const direction = i.sl < i.entry ? "LONG" : "SHORT";
  return {
    riskUsd,
    qty,
    notional,
    leverage: notional / i.capital,
    stopPct: (dist / i.entry) * 100,
    direction,
    rr: i.tp ? Math.abs(i.tp - i.entry) / dist : null,
  };
}

const ctQty = (q: number) => (q >= 100 ? q.toFixed(2) : q >= 1 ? q.toFixed(4) : q.toPrecision(4));
const ctUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function calcMessage(i: CalcInput, lang: Lang): string {
  const en = lang === "en";
  const c = calcPosition(i);
  const lines = [
    `🧮 <b>${en ? "Position size" : "Tamaño de la posición"}</b> · ${c.direction === "LONG" ? "LONG 🟢" : "SHORT 🔴"}`,
    "",
    `${en ? "Capital" : "Capital"}: <b>${ctUsd(i.capital)}</b> · ${en ? "risk" : "riesgo"} <b>${i.riskPct}%</b> = <b>${ctUsd(c.riskUsd)}</b>`,
    `${en ? "Entry" : "Entrada"} <b>${i.entry}</b> · Stop <b>${i.sl}</b> <i>(${c.stopPct.toFixed(2)}%)</i>`,
    "",
    `📦 ${en ? "Size" : "Tamaño"}: <b>${ctQty(c.qty)}</b> ${en ? "units" : "unidades"} (${ctUsd(c.notional)})`,
    `⚙️ ${en ? "Leverage needed" : "Apalancamiento necesario"}: <b>${c.leverage < 1 ? "1x" : `${Math.ceil(c.leverage * 10) / 10}x`}</b>`,
  ];
  if (c.rr != null) lines.push(`⚖️ R:R <b>1 : ${c.rr.toFixed(1)}</b> → ${en ? "gain if TP" : "ganancia si TP"} <b>${ctUsd(c.riskUsd * c.rr)}</b>`);
  lines.push("", `<i>${en ? "If the stop is hit you lose" : "Si toca el stop perdés"} ${ctUsd(c.riskUsd)}.</i>`);
  return lines.join("\n");
}

export const calcUsage = (lang: Lang) =>
  lang === "en"
    ? "Use <code>/calc entry stop capital risk%</code>\n\nExample:\n<code>/calc 65000 64500 1000 1</code>\n(add the TP at the end to see the R:R). In a private chat with your account linked, capital and risk are taken from your profile: <code>/calc 65000 64500</code>."
    : "Usá <code>/calc entrada stop capital riesgo%</code>\n\nEjemplo:\n<code>/calc 65000 64500 1000 1</code>\n(agregá el TP al final para ver el R:R). En el chat privado con tu cuenta vinculada toma el capital y el riesgo de tu perfil: <code>/calc 65000 64500</code>.";

// ═══ 3) /niveles ════════════════════════════════════════════════════════════

export interface LevelsData {
  symbol: string;
  price: number;
  change: number | null;
  rsi1h: number | null;
  rsi4h: number | null;
  ema20: number | null;
  ema50: number | null;
  open: Array<{ direction: string; entry: number; tp: number; sl: number }>;
}

export function trendOf(price: number, ema20: number | null, ema50: number | null): "up" | "down" | "side" | null {
  if (ema20 == null || ema50 == null) return null;
  if (price > ema20 && ema20 > ema50) return "up";
  if (price < ema20 && ema20 < ema50) return "down";
  return "side";
}

export function levelsMessage(d: LevelsData, lang: Lang): string {
  const en = lang === "en";
  const tr = trendOf(d.price, d.ema20, d.ema50);
  const trTxt = tr === "up" ? (en ? "🟢 Uptrend" : "🟢 Alcista") : tr === "down" ? (en ? "🔴 Downtrend" : "🔴 Bajista") : tr === "side" ? (en ? "⚪ Sideways" : "⚪ Lateral") : "—";
  const rsiTxt = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}${v >= 70 ? " 🔥" : v <= 30 ? " 🧊" : ""}`);
  const ch = d.change == null ? "" : ` ${d.change >= 0 ? "🟢▲" : "🔴▼"} ${Math.abs(d.change).toFixed(2)}%`;
  const lines = [
    `📍 <b>${esc(ctBase(d.symbol))}</b> · ${en ? "key levels" : "niveles clave"}`,
    "",
    `${en ? "Price" : "Precio"}: <code>${fmtPx(d.price)}</code>${ch}`,
    `${en ? "Trend (4h)" : "Tendencia (4h)"}: <b>${trTxt}</b>`,
    `RSI 1h: <b>${rsiTxt(d.rsi1h)}</b> · RSI 4h: <b>${rsiTxt(d.rsi4h)}</b>`,
  ];
  if (d.ema20 != null) lines.push(`EMA 20 / 50 (4h): <code>${fmtPx(d.ema20)}</code> / <code>${d.ema50 != null ? fmtPx(d.ema50) : "—"}</code>`);
  if (d.open.length) {
    lines.push("", `📌 <b>${en ? "Open signals" : "Señales abiertas"}</b>`);
    for (const t of d.open.slice(0, 5)) lines.push(`${t.direction === "LONG" ? "🟢" : "🔴"} ${t.direction} · ${en ? "entry" : "entrada"} ${t.entry} · TP ${t.tp} · SL ${t.sl}`);
  }
  return lines.join("\n");
}

/** Reúne los datos de /niveles. Null si el par no existe. */
export async function fetchLevels(symbol: string, open: LevelsData["open"], now = Date.now()): Promise<LevelsData | null> {
  const q = await fetchTicker(symbol);
  if (!q) return null;
  const [h1, h4] = await Promise.all([fetchClosedCloses(symbol, "1h", now), fetchClosedCloses(symbol, "4h", now)]);
  return {
    symbol,
    price: q.price,
    change: q.change,
    rsi1h: h1 ? rsiLast(h1, 14) : null,
    rsi4h: h4 ? rsiLast(h4, 14) : null,
    ema20: h4 ? emaLast(h4, 20) : null,
    ema50: h4 ? emaLast(h4, 50) : null,
    open,
  };
}

export async function fetchTicker(symbol: string, fetcher: typeof fetch = fetch): Promise<{ price: number; change: number | null } | null> {
  for (const url of [`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`]) {
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const j = await res.json();
      const price = Number(j.lastPrice);
      const change = Number(j.priceChangePercent);
      if (price > 0) return { price, change: Number.isFinite(change) ? change : null };
    } catch {
      /* siguiente */
    }
  }
  return null;
}

// ═══ 4) Resumen de mercado de la mañana ═════════════════════════════════════

export interface MarketSnap {
  symbol: string;
  price: number;
  change: number | null;
  funding?: number | null; // fracción (0.0001 = 0,01 %)
}

export const MORNING_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT"];

export function morningMessage(snaps: MarketSnap[], lang: Lang): string | null {
  if (!snaps.length) return null;
  const en = lang === "en";
  const lines = [`☀️ <b>${en ? "Market morning" : "Mercado de la mañana"}</b> · VELTRIX`, ""];
  for (const s of snaps) {
    const ch = s.change == null ? "" : ` ${s.change >= 0 ? "🟢▲" : "🔴▼"} ${Math.abs(s.change).toFixed(2)}%`;
    const f = s.funding == null ? "" : ` · funding ${(s.funding * 100).toFixed(3)}%`;
    lines.push(`<b>${esc(ctBase(s.symbol))}</b>  <code>${fmtPx(s.price)}</code>${ch}${f}`);
  }
  lines.push("", `<i>${en ? "24 h change. Funding > 0: longs pay shorts." : "Variación 24 h. Funding > 0: los largos pagan a los cortos."}</i>`);
  return lines.join("\n");
}

export async function fetchFunding(symbol: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetcher(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const v = Number((await res.json()).lastFundingRate);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export async function fetchSnaps(symbols: string[], withFunding: boolean): Promise<MarketSnap[]> {
  const out = await Promise.all(
    symbols.map(async (symbol) => {
      const q = await fetchTicker(symbol);
      if (!q) return null;
      return { symbol, price: q.price, change: q.change, funding: withFunding ? await fetchFunding(symbol) : null } as MarketSnap;
    }),
  );
  return out.filter((x): x is MarketSnap => !!x);
}

// ═══ 5) Avisos de funding y de movimientos fuertes ══════════════════════════

export const WATCH_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
export const FUNDING_ALERT = 0.001; // 0,10 % por período: ya es caro mantener la posición
export const MOVE_ALERT_PCT = 4; // movimiento de 1 h, en %
const FUNDING_WINDOW_MS = 8 * 3_600_000;

export function fundingAlert(symbol: string, rate: number, lang: Lang): string {
  const en = lang === "en";
  const crowded = rate > 0 ? (en ? "longs" : "largos") : en ? "shorts" : "cortos";
  return [
    `💸 <b>${en ? "Extreme funding" : "Funding extremo"}</b> · ${esc(ctBase(symbol))}`,
    "",
    `Funding: <b>${(rate * 100).toFixed(3)}%</b>`,
    en ? `The market is crowded with ${crowded}: a squeeze against them becomes more likely.` : `El mercado está cargado de ${crowded}: aumenta la chance de un barrido en su contra.`,
    "",
    `<i>${en ? "Information only, not financial advice." : "Solo informativo, no es asesoramiento financiero."}</i>`,
  ].join("\n");
}

export function moveAlert(symbol: string, pct: number, price: number, lang: Lang): string {
  const en = lang === "en";
  return [
    `${pct > 0 ? "🚀" : "🩸"} <b>${en ? "Strong move" : "Movimiento fuerte"}</b> · ${esc(ctBase(symbol))}`,
    "",
    `${pct > 0 ? "🟢▲" : "🔴▼"} <b>${Math.abs(pct).toFixed(1)}%</b> ${en ? "in the last hour" : "en la última hora"} · <code>${fmtPx(price)}</code>`,
    en ? "Liquidations are likely in this kind of move: check the liquidation map with /chart BTC 4h liq." : "En movimientos así suele haber liquidaciones: mirá el mapa con /grafico BTC 4h liq.",
  ].join("\n");
}

async function lastHourMove(symbol: string, fetcher: typeof fetch = fetch): Promise<{ pct: number; price: number } | null> {
  try {
    const res = await fetcher(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=2`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown[][];
    const cur = rows?.[rows.length - 1];
    if (!cur) return null;
    const open = Number(cur[1]);
    const close = Number(cur[4]);
    return open > 0 ? { pct: ((close - open) / open) * 100, price: close } : null;
  } catch {
    return null;
  }
}

/** Cada 5 minutos: mira funding y movimiento de 1 h de las monedas principales y avisa una sola vez por ventana. */
export async function postMarketAlerts(deps: PostDeps, now = Date.now()): Promise<number> {
  const { supabase } = deps;
  const { data: rows, error } = await supabase.from("telegram_communities").select("id,user_id,chat_id,news_thread_id").eq("news_enabled", true);
  if (error || !rows?.length) return 0;
  const owners = [...new Set((rows as any[]).map((r) => r.user_id as string))];
  const { data: profiles } = await supabase.from("profiles").select("id,lang").in("id", owners);
  const langOf = new Map<string, Lang>((profiles ?? []).map((p: any) => [p.id as string, p.lang === "en" ? "en" : "es"]));

  const events: Array<{ key: string; html: (l: Lang) => string }> = [];
  const window = Math.floor(now / FUNDING_WINDOW_MS);
  const hour = Math.floor(now / 3_600_000);
  for (const symbol of WATCH_COINS) {
    const f = await fetchFunding(symbol);
    if (f != null && Math.abs(f) >= FUNDING_ALERT) events.push({ key: `fund:${symbol}:${window}:${f > 0 ? "p" : "n"}`, html: (l) => fundingAlert(symbol, f, l) });
  }
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
    const m = await lastHourMove(symbol);
    if (m && Math.abs(m.pct) >= MOVE_ALERT_PCT) events.push({ key: `move:${symbol}:${hour}:${m.pct > 0 ? "u" : "d"}`, html: (l) => moveAlert(symbol, m.pct, m.price, l) });
  }
  if (!events.length) return 0;

  let sent = 0;
  for (const row of rows as any[]) {
    const lang = langOf.get(row.user_id) ?? "es";
    for (const ev of events) {
      const chatId = Number(row.chat_id);
      if (!(await claim(supabase, ev.key, chatId))) continue;
      const r = await deps.send(chatId, ev.html(lang), row.news_thread_id ? Number(row.news_thread_id) : null);
      if (r?.ok) sent++;
      else {
        await unclaim(supabase, ev.key, chatId);
        if (r?.error_code === 403) await supabase.from("telegram_communities").delete().eq("id", row.id);
        break;
      }
    }
  }
  return sent;
}

/** Desde las 8:00 de la zona de la cuenta dueña: una vez por día, el resumen del mercado en «Noticias». */
export async function postMarketMorning(deps: PostDeps, now = Date.now()): Promise<number> {
  const { supabase } = deps;
  const { data: rows, error } = await supabase.from("telegram_communities").select("id,user_id,chat_id,news_thread_id").eq("news_enabled", true);
  if (error || !rows?.length) return 0;
  const owners = [...new Set((rows as any[]).map((r) => r.user_id as string))];
  const { data: profiles } = await supabase.from("profiles").select("id,timezone,lang").in("id", owners);
  const profOf = new Map<string, { timezone: string | null; lang: string | null }>((profiles ?? []).map((p: any) => [p.id as string, p]));
  let snaps: MarketSnap[] | null = null;
  let sent = 0;
  for (const row of rows as any[]) {
    const prof = profOf.get(row.user_id);
    const tz = validTz(prof?.timezone);
    if (!tz) continue;
    const h = localHour(now, tz);
    if (h < DIGEST_HOUR || h >= DIGEST_UNTIL) continue;
    const key = `morning:${localDay(now, tz)}`;
    const chatId = Number(row.chat_id);
    if (!(await claim(supabase, key, chatId))) continue;
    snaps ??= await fetchSnaps(MORNING_COINS, true);
    const html = morningMessage(snaps, prof?.lang === "en" ? "en" : "es");
    if (!html) {
      await unclaim(supabase, key, chatId);
      continue;
    }
    const r = await deps.send(chatId, html, row.news_thread_id ? Number(row.news_thread_id) : null);
    if (r?.ok) sent++;
    else {
      await unclaim(supabase, key, chatId);
      if (r?.error_code === 403) await supabase.from("telegram_communities").delete().eq("id", row.id);
    }
  }
  return sent;
}

// ═══ 6) Estadísticas personales: /racha y /semana ═══════════════════════════

export interface StreakInfo {
  winStreak: number; // ganadoras seguidas (las últimas cerradas)
  lossStreak: number;
  bestWinStreak: number;
  closed: number;
}

export function streaks(trades: SumTrade[]): StreakInfo {
  const closed = trades
    .filter((t) => t.outcome !== "ABIERTA")
    .sort((a, b) => new Date(a.closed_at ?? a.date).getTime() - new Date(b.closed_at ?? b.date).getTime())
    .map((t) => rOf(t));
  let win = 0;
  let loss = 0;
  let best = 0;
  let run = 0;
  for (const r of closed) {
    if (r > 0) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  for (let i = closed.length - 1; i >= 0 && closed[i] > 0; i--) win++;
  for (let i = closed.length - 1; i >= 0 && closed[i] < 0; i--) loss++;
  return { winStreak: win, lossStreak: loss, bestWinStreak: best, closed: closed.length };
}

export function streakMessage(s: StreakInfo, lang: Lang): string {
  const en = lang === "en";
  if (!s.closed) return en ? "You have no closed trades yet." : "Todavía no tenés operaciones cerradas.";
  const lines = [`🔥 <b>${en ? "Your streaks" : "Tus rachas"}</b>`, ""];
  if (s.winStreak > 0) lines.push(en ? `Current: <b>${s.winStreak}</b> winning in a row 🟢` : `Ahora: <b>${s.winStreak}</b> ganadoras seguidas 🟢`);
  else if (s.lossStreak > 0) lines.push(en ? `Current: <b>${s.lossStreak}</b> losing in a row 🔴` : `Ahora: <b>${s.lossStreak}</b> perdedoras seguidas 🔴`);
  lines.push(en ? `Best streak: <b>${s.bestWinStreak}</b> winning in a row` : `Mejor racha: <b>${s.bestWinStreak}</b> ganadoras seguidas`);
  if (s.lossStreak >= 3) lines.push("", en ? "💡 After 3 losses in a row, step back and review the plan before the next trade." : "💡 Después de 3 pérdidas seguidas, frená y revisá el plan antes de la próxima operación.");
  return lines.join("\n");
}

// ═══ 7) Votación de señales: ver votes.ts ═════════════════════════════════
// ═══ 8) Aviso de sobreexposición ════════════════════════════════════════════

export const MAX_OPEN_SOFT = 6; // sin riesgo cargado: a partir de acá se avisa
export const MAX_TOTAL_RISK_PCT = 6; // con riesgo cargado: suma de riesgos abiertos

export interface OpenLite {
  direction: string;
}

export function exposureNotice(open: OpenLite[], riskPct: number | null | undefined, lang: Lang): string | null {
  const en = lang === "en";
  const n = open.length;
  const total = riskPct && riskPct > 0 ? n * riskPct : null;
  const tooMuch = total != null ? total > MAX_TOTAL_RISK_PCT : n >= MAX_OPEN_SOFT;
  if (!tooMuch) return null;
  const longs = open.filter((t) => t.direction === "LONG").length;
  const shorts = n - longs;
  const same = Math.max(longs, shorts);
  const lines = [
    `⚠️ <b>${en ? "Heavy exposure" : "Mucha exposición"}</b>`,
    "",
    en ? `You have <b>${n}</b> open trades${total != null ? `, about <b>${total.toFixed(1)}%</b> of your capital at risk if all hit the stop` : ""}.` : `Tenés <b>${n}</b> operaciones abiertas${total != null ? `, cerca de <b>${total.toFixed(1)}%</b> de tu capital en riesgo si todas tocan el stop` : ""}.`,
  ];
  if (same >= 3) lines.push(en ? `${same} go the same way: crypto tends to move together, so it counts almost as one big trade.` : `${same} van en el mismo sentido: las cripto suelen moverse juntas, casi cuenta como una sola operación grande.`);
  lines.push("", en ? "Turn this reminder off with /risk off." : "Podés apagar este aviso con /riesgo off.");
  return lines.join("\n");
}

/**
 * Después de registrar una señal: si hay demasiadas operaciones abiertas, se lo avisa a la persona por Telegram (a lo sumo una vez por hora).
 * Respeta el interruptor «risk_reminder». Nunca lanza errores.
 */
export async function sendExposureNotice(supabase: any, userId: string, now = Date.now()): Promise<boolean> {
  try {
    const { data: prof, error } = await supabase.from("profiles").select("lang,risk_pct,risk_reminder").eq("id", userId).maybeSingle();
    if (error || !prof || (prof as { risk_reminder?: boolean }).risk_reminder === false) return false;
    const { data: open } = await supabase.from("trades").select("direction,source").eq("user_id", userId).eq("outcome", "ABIERTA").limit(200);
    const lang: Lang = (prof as { lang?: string }).lang === "en" ? "en" : "es";
    const risk = Number((prof as { risk_pct?: number }).risk_pct ?? 0) || null;
    const text = exposureNotice(((open ?? []) as Array<OpenLite & { source?: string | null }>).filter((t) => t.source !== "bot"), risk, lang);
    if (!text) return false;
    if (!(await claim(supabase, `expo:${userId}:${Math.floor(now / 3_600_000)}`, 0))) return false;
    await notifyTelegram(supabase, userId, () => text);
    return true;
  } catch {
    return false;
  }
}

// ═══ 9) Filtro de activos ═══════════════════════════════════════════════════

const CT_SYM = /^[A-Z0-9]{2,15}USDT$/;

/** «btc eth, xau» → [BTCUSDT, ETHUSDT, XAUUSDT]. */
export function parseSymbolList(raw: string): string[] {
  const out: string[] = [];
  for (const w of raw.toUpperCase().split(/[\s,;]+/)) {
    if (!w) continue;
    const s = /(USDT|USDC|USD|PERP)$/.test(w) ? w.replace(/(USDC|USD|PERP)$/, "USDT") : `${w}USDT`;
    if (CT_SYM.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 40);
}

/** ¿La persona quiere recibir esta señal? Sin lista guardada recibe todo. Se comparan sin sufijo (BTCUSDT.P = BTCUSDT). */
export function wantsSymbol(filter: string | null | undefined, symbol: string): boolean {
  const list = String(filter ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!list.length) return true;
  const norm = (s: string) => s.toUpperCase().replace(/\.P$|PERP$/, "").replace(/(USDC|USD)$/, "USDT");
  return list.map(norm).includes(norm(symbol));
}

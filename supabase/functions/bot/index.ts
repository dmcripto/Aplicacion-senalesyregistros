// Bot automático (etapa simulada).
//
//   · POST con la sesión de la persona   { "action": "backtest", "symbols": [...], "days": 120 }
//       → prueba la estrategia con el historial real de precios y devuelve el resultado (no toca nada).
//   · POST con la sesión de la persona   { "action": "lab", "symbols": [...] }
//       → laboratorio: varias versiones de la estrategia (velas de 1 y 4 horas) sobre un año de precios, por mitades.
//   · POST con la sesión de la persona   { "action": "test_signal" }
//       → (solo cuentas habilitadas) crea una señal abierta de prueba y manda el aviso a la persona; no publica en comunidades.
//   · POST con el encabezado x-cron-secret (pg_cron, cada 5 minutos)
//       → para cada persona con el bot encendido: cierra sus operaciones simuladas que tocaron stop u objetivo,
//         y anota una operación nueva si la última vela cerrada dio señal y los límites lo permiten.
//
// Nunca opera en un exchange: solo escribe en el diario de la persona.

import { createClient } from "npm:@supabase/supabase-js@2";
import { BAR_MS, BOT_PROFILES, LAB_DAYS, LAB_DAYS_BY_TF, LAB_VARIANTS, barMsOf, runLab, BOT_PROFILE_IDS, BOT_SYMBOLS, WARMUP, allowedByActions, botStats, capOf, cleanActions, closedBars, describeParams, fetchBars, fetchUniverse, indicators, isBotSymbol, isTradableSymbol, mapPool, scanSizeOf, isProfileId, localParts, paramsOf, resolveFrom, signalAt, signalWithUnlock, simulate } from "../_shared/botStrategy.ts";
import { cleanUnlock, unlockNote } from "../_shared/unlockFilter.ts";
import type { UnlockEvent } from "../_shared/unlockFilter.ts";
import type { BotParams, BotProfileId, BotTimeframe, Indicators } from "../_shared/botStrategy.ts";
import { sendExpoPush } from "../_shared/expoPush.ts";
import { resultCardHtml, signalCardHtml } from "../_shared/community.ts";
import { esc, notifyTelegram } from "../_shared/telegram.ts";
import type { Lang } from "../_shared/telegram.ts";
import { MAX_PAUSE_MIN, activeNewsPause, pauseCfgOf, pauseLabel } from "../_shared/newsPause.ts";
import type { NewsEvent } from "../_shared/newsPause.ts";
import type { BotAction } from "../_shared/botStrategy.ts";
import type { Bar } from "../_shared/botStrategy.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_USERS = 2000; // personas con el bot encendido que se leen por corrida
const BUDGET_MS = 100_000; // si la corrida se alarga, lo que falte se atiende en la siguiente (primero los que hace más que no se revisan)
const MAX_WARMUP = Math.max(...BOT_PROFILE_IDS.map((id) => WARMUP(BOT_PROFILES[id])));
const TICK_BARS = MAX_WARMUP + 80; // lo justo para calcular los indicadores de cualquier perfil y resolver operaciones recientes
const PROFILE_LABEL: Record<BotProfileId, string> = { conservative: "perfil conservador", dynamic: "perfil dinámico", intense: "perfil intensivo, más operaciones", balanced: "perfil equilibrado", slow: "perfil lento, velas de 4 horas", slowwide: "perfil lento con objetivo amplio, velas de 4 horas" };
const noteFor = (id: BotProfileId) => `🤖 Bot simulado (${PROFILE_LABEL[id]}) · ${describeParams(BOT_PROFILES[id])}. No se operó en ningún exchange.`;
const TAG = "Bot simulado";

// ─── Avisos personales ──────────────────────────────────────────────────────
// Push en la app y mensaje por Telegram al chat vinculado de la propia persona. Nunca se publica en comunidades:
// son operaciones simuladas y no deben confundirse con señales reales.

const PROFILE_NAME: Record<BotProfileId, { es: string; en: string }> = {
  conservative: { es: "conservador", en: "conservative" },
  balanced: { es: "equilibrado", en: "balanced" },
  dynamic: { es: "dinámico", en: "dynamic" },
  intense: { es: "intensivo", en: "intensive" },
  slow: { es: "lento (4 horas)", en: "slow (4 hours)" },
  slowwide: { es: "lento · objetivo amplio", en: "slow · wide target" },
};

const notifyPref = new Map<string, boolean>();
async function wantsNotify(userId: string): Promise<boolean> {
  if (notifyPref.has(userId)) return notifyPref.get(userId)!;
  const { data, error } = await admin.from("bot_settings").select("notify").eq("user_id", userId).maybeSingle();
  const v = error ? true : (data as { notify?: boolean } | null)?.notify !== false; // sin la columna nueva se avisa igual
  notifyPref.set(userId, v);
  return v;
}

async function langOf(userId: string): Promise<Lang> {
  const { data } = await admin.from("profiles").select("lang").eq("id", userId).maybeSingle();
  return (data as { lang?: string } | null)?.lang === "en" ? "en" : "es";
}

async function push(userId: string, title: string, body: string, tradeId: string) {
  const { data: tokens } = await admin.from("device_tokens").select("expo_push_token").eq("user_id", userId);
  if (tokens?.length) await sendExpoPush((tokens as Array<{ expo_push_token: string }>).map((t) => ({ to: t.expo_push_token, title, body, data: { tradeId } })));
}

async function notifyOpened(userId: string, tradeId: string, t: { symbol: string; direction: "LONG" | "SHORT"; entry: number; tp: number; sl: number }, profile: BotProfileId) {
  try {
    if (!(await wantsNotify(userId))) return;
    const lang = await langOf(userId);
    const en = lang === "en";
    const pn = PROFILE_NAME[profile][lang];
    await push(userId, `🤖 ${t.symbol} · ${t.direction === "LONG" ? (en ? "BUY" : "COMPRA") : en ? "SELL" : "VENTA"} (${en ? "simulated" : "simulado"})`, `${en ? "Entry" : "Entrada"} ${t.entry} · TP ${t.tp} · SL ${t.sl}`, tradeId);
    await notifyTelegram(admin, userId, (l) => `${signalCardHtml(t, l, { header: "🤖", disclaimer: false })}\n\n<i>${esc(l === "en" ? `Simulated bot (${pn} profile): nothing was traded on any exchange.` : `Bot simulado (perfil ${pn}): no se operó en ningún exchange.`)}</i>`);
  } catch (e) {
    console.error("aviso bot:", e instanceof Error ? e.message : e);
  }
}

async function notifyClosed(userId: string, tradeId: string, t: { symbol: string; entry: number; tp: number; sl: number }, outcome: "TP" | "SL") {
  try {
    if (!(await wantsNotify(userId))) return;
    const lang = await langOf(userId);
    const en = lang === "en";
    const r = rOf(t, outcome);
    const rs = `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`;
    await push(userId, `🤖 ${t.symbol} · ${outcome === "TP" ? (en ? "TP hit" : "TP alcanzado") : en ? "SL hit" : "SL alcanzado"} (${en ? "simulated" : "simulado"})`, `${en ? "Result" : "Resultado"}: ${rs}`, tradeId);
    await notifyTelegram(admin, userId, (l) => resultCardHtml(t.symbol, outcome, r, l, { label: l === "en" ? "Result (simulated bot)" : "Resultado (bot simulado)" }));
  } catch (e) {
    console.error("aviso bot:", e instanceof Error ? e.message : e);
  }
}

// ─── Prueba con historial ───────────────────────────────────────────────────

const BACKTEST_TTL = 30 * 60_000;
const barsCache = new Map<string, { at: number; bars: Bar[] }>();

async function barsFor(symbol: string, count: number, tf: BotTimeframe = "1h"): Promise<Bar[]> {
  const key = `${symbol}:${count}:${tf}`;
  const hit = barsCache.get(key);
  if (hit && Date.now() - hit.at < BACKTEST_TTL) return hit.bars;
  const bars = closedBars(await fetchBars(symbol, count, fetch, tf), Date.now(), barMsOf({ tf }));
  barsCache.set(key, { at: Date.now(), bars });
  return bars;
}

// Lista de los futuros más operados: cambia despacio, así que se guarda 30 minutos.
const universeCache = new Map<number, { at: number; list: string[] }>();
async function universe(n: number): Promise<string[]> {
  const hit = universeCache.get(n);
  if (hit && Date.now() - hit.at < BACKTEST_TTL) return hit.list;
  const list = await fetchUniverse(n);
  universeCache.set(n, { at: Date.now(), list });
  return list;
}

/**
 * Desbloqueos de tokens guardados por la función que lee la fuente de datos (tabla token_unlocks, sin acceso desde la app).
 * Sin la tabla, o vacía, devuelve [] y el filtro no cambia nada.
 */
async function loadUnlocks(fromMs: number, toMs: number): Promise<UnlockEvent[]> {
  const { data, error } = await admin.from("token_unlocks").select("symbol, at, pct").gte("at", new Date(fromMs).toISOString()).lte("at", new Date(toMs).toISOString()).limit(5000);
  if (error) return [];
  return ((data ?? []) as Array<{ symbol: string; at: string; pct: number }>).map((r) => ({ symbol: r.symbol, at: new Date(r.at).getTime(), pct: Number(r.pct) })).filter((e) => Number.isFinite(e.at) && Number.isFinite(e.pct));
}

/**
 * Simula el bot completo (con los topes y las reglas guardadas de la persona) sobre el historial real y lo compara
 * con el mismo bot sin reglas. Las reglas salen de operaciones de la persona, no de estos precios: es una prueba justa.
 */
async function runBacktest(userId: string, chosen: string[], days: number) {
  const count = Math.min(24 * days, 3000) + MAX_WARMUP;
  const { data: cfg } = await admin.from("bot_settings").select("*").eq("user_id", userId).maybeSingle();
  const { data: prof } = await admin.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const rules = cleanActions(cfg?.rules);
  const base = { maxOpen: Number(cfg?.max_open ?? 3), dailyLossR: Number(cfg?.daily_loss_r ?? 3), timeZone: (prof?.timezone as string | null) ?? null };
  const profile: BotProfileId = isProfileId(cfg?.profile) ? cfg.profile : "balanced";
  const params = paramsOf(profile);

  // Con el escaneo del mercado se prueban también los futuros más operados (los de hoy: ver la advertencia en la pantalla).
  const scan = scanSizeOf(cfg?.scan_top);
  let symbols = chosen;
  if (scan) {
    try {
      symbols = [...new Set([...chosen, ...(await universe(scan))])];
    } catch {
      /* sin la lista del mercado: se prueba con los activos elegidos */
    }
  }
  const bars: Record<string, Bar[]> = {};
  const bars4h: Record<string, Bar[]> = {}; // para el perfil lento (si un activo no baja en 4 horas, ese perfil lo deja afuera)
  const errors: Record<string, string> = {};
  const count4h = 6 * days + MAX_WARMUP;
  await mapPool(symbols, 8, async (symbol) => {
    try {
      bars[symbol] = await barsFor(symbol, count, "1h");
    } catch (e) {
      errors[symbol] = e instanceof Error ? e.message : "error";
      return;
    }
    try {
      bars4h[symbol] = await barsFor(symbol, count4h, "4h");
    } catch {
      /* solo el perfil lento pierde este activo */
    }
  });
  symbols = symbols.filter((x) => bars[x]);
  const sim = (rules: BotAction[], p: BotParams) => simulate(p.tf === "4h" ? bars4h : bars, { symbols, rules, ...base }, p);
  const without = sim([], params);
  const withRules = rules.length ? sim(rules, params) : null;
  // Filtro de desbloqueos: el mismo bot, con y sin el filtro, sobre las fechas de desbloqueo que haya cargadas.
  const unlockCfg = cleanUnlock({ mode: cfg?.unlock_mode, windowDays: cfg?.unlock_window_days, minPct: cfg?.unlock_min_pct });
  let unlock: { mode: string; events: number; without: ReturnType<typeof botStats>; with: ReturnType<typeof botStats> } | null = null;
  if (unlockCfg.mode !== "off") {
    const events = await loadUnlocks(Date.now() - (days + 40) * 86_400_000, Date.now() + 40 * 86_400_000);
    const filtered = events.length ? simulate(params.tf === "4h" ? bars4h : bars, { symbols, rules: [], ...base, unlock: { cfg: unlockCfg, events } }, params) : null;
    unlock = { mode: unlockCfg.mode, events: events.length, without: botStats(without.trades.map((t) => t.r)), with: botStats((filtered ?? without).trades.map((t) => t.r)) };
  }
  // Los perfiles, sin reglas y con los mismos límites, para compararlos.
  const byProfile = BOT_PROFILE_IDS.map((id) => ({ id, current: id === profile, stats: botStats(sim([], BOT_PROFILES[id]).trades.map((t) => t.r)) }));
  return {
    ok: true,
    days,
    profile,
    params,
    byProfile,
    total: botStats(without.trades.map((t) => t.r)),
    withRules: withRules ? botStats(withRules.trades.map((t) => t.r)) : null,
    unlock,
    rulesApplied: rules.length,
    scanned: scan ? symbols.length : 0,
    // Con escaneo hay decenas de activos: se muestran los 10 con más operaciones.
    symbols: symbols
      .map((symbol) => ({ symbol, stats: botStats(without.trades.filter((t) => t.symbol === symbol).map((t) => t.r)), error: errors[symbol] }))
      .sort((a, b) => b.stats.n - a.stats.n)
      .slice(0, scan ? 10 : 5),
  };
}

/**
 * Laboratorio: varias versiones de la estrategia (velas de 1 y de 4 horas) sobre un año de precios reales, sin reglas,
 * con los mismos topes de la persona. Cada una se mide entera y por mitades (la primera y la segunda parte del año).
 */
async function runLabTest(userId: string, chosen: string[]) {
  const { data: cfg } = await admin.from("bot_settings").select("*").eq("user_id", userId).maybeSingle();
  const { data: prof } = await admin.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const base = { maxOpen: Number(cfg?.max_open ?? 3), dailyLossR: Number(cfg?.daily_loss_r ?? 3), timeZone: (prof?.timezone as string | null) ?? null };

  // Con el escaneo del mercado se prueban también los futuros más operados. Para no saturar al exchange solo se
  // bajan velas de 4 horas (la referencia de 1 hora ya se conoce de la prueba sin escaneo).
  const scan = scanSizeOf(cfg?.scan_top);
  let symbols = chosen;
  if (scan) {
    try {
      symbols = [...new Set([...chosen, ...(await universe(scan))])];
    } catch {
      /* sin la lista del mercado: se prueba con los activos elegidos */
    }
  }
  const scanning = scan > 0 && symbols.length > chosen.length;
  const variants = scanning ? LAB_VARIANTS.filter((v) => v.params.tf === "4h") : LAB_VARIANTS;
  const tfs = [...new Set(variants.map((v) => v.params.tf ?? "1h"))] as BotTimeframe[];

  const bars: Record<BotTimeframe, Record<string, Bar[]>> = { "15m": {}, "1h": {}, "4h": {} };
  const jobs = symbols.flatMap((symbol) => tfs.map((tf) => ({ symbol, tf })));
  await mapPool(jobs, 8, async ({ symbol, tf }) => {
    const perDay = tf === "4h" ? 6 : tf === "15m" ? 96 : 24;
    try {
      bars[tf][symbol] = await barsFor(symbol, LAB_DAYS_BY_TF[tf] * perDay + MAX_WARMUP, tf);
    } catch {
      /* ese activo queda afuera */
    }
  });
  const ok = symbols.filter((x) => tfs.every((tf) => bars[tf][x]));
  if (!ok.length) return { ok: false, error: "No se pudieron bajar los precios. Probá de nuevo en unos minutos." };
  const usable = (tf: BotTimeframe) => Object.fromEntries(ok.map((x) => [x, bars[tf][x]]));
  const mid = (tf: BotTimeframe) => Date.now() - (LAB_DAYS_BY_TF[tf] / 2) * 24 * 3_600_000; // cada variante se parte por la mitad de SU período
  return { ok: true, days: LAB_DAYS, variants: runLab(usable, { symbols: ok, ...base }, mid, variants), symbols: ok, scanned: scanning ? ok.length : 0 };
}

// ─── Señal de prueba (solo para cuentas habilitadas) ─────────────────────────

const TEST_NOTE = "Señal de prueba de VELTRIX: no es una operación real.";

async function livePrice(symbol: string): Promise<number | null> {
  for (const url of [`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`, `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { price?: string; result?: { list?: Array<{ lastPrice?: string }> } };
      const p = Number(j.price ?? j.result?.list?.[0]?.lastPrice);
      if (Number.isFinite(p) && p > 0) return p;
    } catch {
      /* se prueba con el siguiente proveedor */
    }
  }
  return null;
}

/**
 * Crea una señal abierta de prueba (BTC, compra, con el precio de ahora) en la cuenta de la persona y le manda el aviso por la app
 * y por su Telegram. Sirve para ver cómo llega y cómo se ve una señal. NUNCA se publica en comunidades ni por WhatsApp.
 */
async function sendTestSignal(userId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: prof, error } = await admin.from("profiles").select("bot_beta, lang").eq("id", userId).maybeSingle();
  if (error || !(prof as { bot_beta?: boolean } | null)?.bot_beta) return { status: 403, body: { ok: false, error: "Todavía no está disponible para tu cuenta." } };
  const since = new Date(Date.now() - 30_000).toISOString();
  const { data: recent } = await admin.from("trades").select("id").eq("user_id", userId).eq("notes", TEST_NOTE).gte("date", since).limit(1);
  if (recent?.length) return { status: 429, body: { ok: false, error: "Esperá unos segundos antes de mandar otra prueba." } };
  const price = await livePrice("BTCUSDT");
  if (!price) return { status: 502, body: { ok: false, error: "No se pudo leer el precio de BTC. Probá de nuevo en un minuto." } };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const entry = r2(price), sl = r2(price * 0.99), tp = r2(price * 1.02); // stop 1 % abajo, objetivo 2 % arriba (R:R 1:2)
  const { data: trade, error: insErr } = await admin
    .from("trades")
    .insert({ user_id: userId, symbol: "BTCUSDT", direction: "LONG", entry, sl, tp, notes: TEST_NOTE, tags: ["Prueba"] })
    .select("id")
    .single();
  if (insErr || !trade) return { status: 500, body: { ok: false, error: "No se pudo crear la señal de prueba." } };
  const en = (prof as { lang?: string }).lang === "en";
  await push(userId, `BTCUSDT · ${en ? "BUY" : "COMPRA"} (${en ? "test" : "prueba"})`, `${en ? "Entry" : "Entrada"} ${entry} · TP ${tp} · SL ${sl}`, trade.id);
  await notifyTelegram(admin, userId, (l) => `${signalCardHtml({ symbol: "BTCUSDT", direction: "LONG", entry, tp, sl }, l, { header: "🧪", disclaimer: false })}\n\n<i>${esc(l === "en" ? "Test signal: not a real trade." : "Señal de prueba: no es una operación real.")}</i>`);
  return { status: 200, body: { ok: true, tradeId: trade.id, entry, sl, tp } };
}

// ─── Corrida periódica ──────────────────────────────────────────────────────

interface Settings {
  user_id: string;
  profile?: unknown;
  symbols: string[];
  max_open: number;
  daily_loss_r: number;
  rules?: unknown;
  scan_top?: unknown;
  unlock_mode?: unknown;
  unlock_window_days?: unknown;
  unlock_min_pct?: unknown;
}

interface OpenBotTrade {
  id: string;
  user_id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp: number;
  external_id?: string | null;
}

/** Las operaciones del perfil lento llevan «:4h» al final del identificador (así se sabe con qué velas seguirlas). */
const tfOfTrade = (t: { external_id?: string | null }): BotTimeframe => (t.external_id?.endsWith(":4h") ? "4h" : "1h");
const profileOf = (s: { profile?: unknown }): BotProfileId => (isProfileId(s.profile) ? s.profile : "balanced");
const tfOfSettings = (s: { profile?: unknown }): BotTimeframe => paramsOf(profileOf(s)).tf ?? "1h";

/**
 * Bot con dinero real (prueba mínima): le pide a la función «trade» que abra la orden de una operación nueva.
 * Esa función revisa todo de nuevo (llave beta, topes, saldo) y, si el modo está «en seco», solo anota lo que habría enviado.
 * Un fallo acá nunca afecta a la operación simulada.
 */
async function sendLiveOrder(userId: string, tradeId: string) {
  const secret = Deno.env.get("BOT_CRON_SECRET") ?? Deno.env.get("EXCHANGE_CRON_SECRET");
  if (!secret) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ action: "execute", userId, tradeId }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    console.error("orden real:", e instanceof Error ? e.message : e);
  }
}

/** Anota en la web (si existe la tabla) que el bot está en pausa por un dato económico, o que ya terminó. Un fallo acá no afecta al bot. */
async function markNewsPause(userId: string, pause: { event: NewsEvent; until: number } | null, current: string | null) {
  try {
    if (pause) {
      const until = new Date(pause.until).toISOString();
      if (current && new Date(current).getTime() === pause.until) return; // ya está anotado
      await admin.from("bot_news_pause").upsert({ user_id: userId, paused_until: until, paused_event: pauseLabel(pause.event, "es"), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    } else if (current) {
      await admin.from("bot_news_pause").update({ paused_until: null, paused_event: null }).eq("user_id", userId);
    }
  } catch (e) {
    console.error("pausa:", e instanceof Error ? e.message : e);
  }
}

/** Deja en «Últimas órdenes» que una señal se omitió por el dato económico (para quien tiene el bot con dinero real encendido). */
async function logNewsSkip(userId: string, symbol: string, direction: "LONG" | "SHORT", event: NewsEvent, until: number) {
  const hh = new Date(until).toISOString().slice(11, 16);
  const { error } = await admin.from("live_orders").insert({
    user_id: userId,
    symbol,
    side: direction === "LONG" ? "BUY" : "SELL",
    kind: "bot",
    status: "skipped",
    note: `Omitida por dato económico: ${pauseLabel(event, "es")} (pausa hasta las ${hh} UTC).`,
  });
  if (error) console.error("live_orders pausa:", error.message);
}

const rOf = (t: { entry: number; sl: number; tp: number }, outcome: "TP" | "SL") => (outcome === "SL" ? -1 : Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl));

async function tick() {
  notifyPref.clear(); // la preferencia de avisos se vuelve a leer en cada corrida (la instancia de la función puede vivir varios minutos)
  const { data: rows } = await admin.from("bot_settings").select("*").eq("enabled", true).order("last_tick_at", { ascending: true, nullsFirst: true }).limit(MAX_USERS);
  const settings = (rows ?? []) as Settings[];
  // Las operaciones simuladas abiertas se siguen cerrando aunque la persona apague el bot.
  const { data: openRows } = await admin.from("trades").select("id, user_id, symbol, direction, entry, sl, tp, external_id").eq("source", "bot").eq("outcome", "ABIERTA").limit(2000);
  const open = (openRows ?? []) as OpenBotTrade[];
  // Quien escanea el mercado mira además los futuros más operados (la lista es la misma para todos y se baja una vez).
  const failed: string[] = [];
  const scanMax = Math.max(0, ...settings.map((s) => scanSizeOf(s.scan_top)));
  let top: string[] = [];
  if (scanMax) {
    try {
      top = await universe(scanMax);
    } catch (e) {
      failed.push(`mercado: ${e instanceof Error ? e.message : "error"}`); // sin la lista, cada quien sigue con sus activos
    }
  }
  const watchOf = (s: Settings) => [...new Set([...s.symbols, ...top.slice(0, scanSizeOf(s.scan_top))])].filter(isTradableSymbol);
  // Qué velas hacen falta: de cada activo, las del tamaño que usa cada perfil (1 o 4 horas) y las de sus operaciones abiertas.
  const need = new Set<string>();
  for (const s of settings) for (const sym of watchOf(s)) need.add(`${sym}|${tfOfSettings(s)}`);
  for (const t of open) if (isTradableSymbol(t.symbol)) need.add(`${t.symbol}|${tfOfTrade(t)}`);
  if (!need.size) return { ok: true, users: 0, opened: 0, closed: 0 };

  const bars = new Map<string, Bar[]>(); // clave: «ACTIVO|1h» o «ACTIVO|4h»
  await mapPool([...need], 8, async (key) => {
    const [sym, tf] = key.split("|") as [string, BotTimeframe];
    try {
      bars.set(key, await fetchBars(sym, TICK_BARS, fetch, tf));
    } catch (e) {
      failed.push(`${sym}: ${e instanceof Error ? e.message : "error"}`);
    }
  });

  // 1) Cerrar lo que tocó stop u objetivo.
  let closed = 0;
  const { data: sigRows } = open.length
    ? await admin.from("bot_signals").select("trade_id, candle_time").in("trade_id", open.map((t) => t.id))
    : { data: [] as Array<{ trade_id: string; candle_time: string }> };
  const candleOf = new Map((sigRows ?? []).map((r) => [r.trade_id, new Date(r.candle_time).getTime()]));
  for (const t of open) {
    const tf = tfOfTrade(t);
    const b = bars.get(`${t.symbol}|${tf}`);
    const candle = candleOf.get(t.id);
    if (!b || candle == null) continue;
    const barMs = barMsOf({ tf });
    const from = b.findIndex((x) => x.t >= candle + barMs);
    if (from < 0) continue;
    const hit = resolveFrom(b, from, t);
    if (!hit) continue;
    const { data: upd } = await admin
      .from("trades")
      .update({ outcome: hit.outcome, closed_at: new Date(b[hit.index].t + barMs).toISOString(), auto_closed: true })
      .eq("id", t.id)
      .eq("outcome", "ABIERTA")
      .select("id");
    if (upd?.length) {
      closed++;
      await notifyClosed(t.user_id, t.id, t, hit.outcome);
    }
  }

  // 2) Señales nuevas.
  let opened = 0;
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: profs } = settings.length
    ? await admin.from("profiles").select("id, timezone").in("id", settings.map((x) => x.user_id))
    : { data: [] as Array<{ id: string; timezone: string | null }> };
  const tzOf = new Map((profs ?? []).map((p: { id: string; timezone: string | null }) => [p.id, p.timezone]));
  // Quién tiene el bot con dinero real encendido (la tabla puede no existir todavía: entonces nadie).
  const { data: liveRows } = settings.length ? await admin.from("bot_live").select("user_id").eq("enabled", true).in("user_id", settings.map((x) => x.user_id)) : { data: [] as Array<{ user_id: string }> };
  const liveUsers = new Set((liveRows ?? []).map((r: { user_id: string }) => r.user_id));
  // Pausa por datos económicos de alto impacto: los datos de las próximas horas (los carga la agenda económica) y los ajustes de cada persona.
  const nowMs = Date.now();
  const { data: newsRows } = await admin
    .from("economic_events")
    .select("starts_at, title, title_es, country")
    .eq("impact", "High")
    .gte("starts_at", new Date(nowMs - (MAX_PAUSE_MIN + 1) * 60_000).toISOString())
    .lte("starts_at", new Date(nowMs + (MAX_PAUSE_MIN + 1) * 60_000).toISOString());
  const newsEvents = (newsRows ?? []) as NewsEvent[]; // sin la agenda cargada (o sin su SQL) no hay datos: no hay pausa
  const pauseRows = new Map<string, { enabled?: unknown; before_min?: unknown; after_min?: unknown; paused_until?: string | null }>();
  if (settings.length) {
    const { data: pr } = await admin.from("bot_news_pause").select("user_id, enabled, before_min, after_min, paused_until").in("user_id", settings.map((x) => x.user_id));
    for (const r of (pr ?? []) as Array<{ user_id: string; paused_until?: string | null }>) pauseRows.set(r.user_id, r);
  }
  // Desbloqueos de los próximos días (solo si alguien tiene el filtro encendido).
  const anyUnlock = settings.some((x) => cleanUnlock({ mode: x.unlock_mode }).mode !== "off");
  const unlocks = anyUnlock ? await loadUnlocks(nowMs, nowMs + 31 * 86_400_000) : [];
  const t0 = Date.now();
  const inds = new Map<string, Indicators>(); // indicadores por activo y perfil (se calculan una vez por corrida)
  let deferred = 0;
  for (const [n, s] of settings.entries()) {
    if (Date.now() - t0 > BUDGET_MS) {
      deferred = settings.length - n;
      break;
    }
    const profile = profileOf(s);
    const params = paramsOf(profile);
    const tf = tfOfSettings(s);
    const barMs = barMsOf({ tf });
    const rules: BotAction[] = cleanActions(s.rules);
    const { data: openNow } = await admin.from("trades").select("symbol").eq("user_id", s.user_id).eq("source", "bot").eq("outcome", "ABIERTA");
    const openSymbols = new Set((openNow ?? []).map((r: { symbol: string }) => r.symbol));
    const { data: recent } = await admin.from("trades").select("entry, sl, tp, outcome").eq("user_id", s.user_id).eq("source", "bot").neq("outcome", "ABIERTA").gte("closed_at", since);
    const lossToday = (recent ?? []).reduce((a: number, r: { entry: number; sl: number; tp: number; outcome: "TP" | "SL" }) => a + rOf(r, r.outcome), 0);
    await admin.from("bot_settings").update({ last_tick_at: new Date().toISOString() }).eq("user_id", s.user_id);
    const pause = activeNewsPause(newsEvents, pauseCfgOf(pauseRows.get(s.user_id)), nowMs);
    await markNewsPause(s.user_id, pause, pauseRows.get(s.user_id)?.paused_until ?? null);
    if (lossToday <= -s.daily_loss_r) continue; // límite diario alcanzado: por hoy no opera más
    // Reglas elegidas en «Estrategia sugerida»: tope de operaciones por día y freno tras pérdidas seguidas (últimas 24 h).
    const maxPerDay = capOf(rules, "maxPerDay");
    const stopAfter = capOf(rules, "stopAfterLosses");
    const { data: today } = maxPerDay != null || stopAfter != null
      ? await admin.from("trades").select("outcome, closed_at, date").eq("user_id", s.user_id).eq("source", "bot").gte("date", since).order("date", { ascending: false })
      : { data: [] as Array<{ outcome: string; closed_at: string | null; date: string }> };
    let openedToday = (today ?? []).length;
    if (stopAfter != null) {
      const closedRows = (today ?? []).filter((r: { outcome: string }) => r.outcome !== "ABIERTA").sort((a: { closed_at: string | null }, b: { closed_at: string | null }) => String(b.closed_at).localeCompare(String(a.closed_at)));
      let streak = 0;
      for (const r of closedRows) {
        if (r.outcome !== "SL") break;
        streak++;
      }
      if (streak >= stopAfter) continue;
    }
    let count = openSymbols.size;
    // Todas las señales de esta vela; si hay más que lugares, entran primero las más fuertes (igual que en la prueba con historial).
    const unlockCfg = cleanUnlock({ mode: s.unlock_mode, windowDays: s.unlock_window_days, minPct: s.unlock_min_pct });
    const found: Array<{ symbol: string; sig: NonNullable<ReturnType<typeof signalAt>>; near: boolean; boosted: boolean }> = [];
    for (const symbol of watchOf(s)) {
      if (openSymbols.has(symbol)) continue;
      const b = bars.get(`${symbol}|${tf}`);
      if (!b) continue;
      const done = closedBars(b, Date.now(), barMs);
      const i = done.length - 1;
      if (i < 0) continue;
      const key = `${symbol}:${profile}`;
      if (!inds.has(key)) inds.set(key, indicators(done, params));
      if (unlockCfg.mode !== "off" && unlocks.length) {
        const f = signalWithUnlock(done, inds.get(key)!, i, params, symbol, done[i].t + barMs, unlocks, unlockCfg);
        if (f && f.sig.t === done[i].t) found.push({ symbol, sig: f.sig, near: f.nearUnlock, boosted: f.boosted });
        continue;
      }
      const sig = signalAt(done, inds.get(key)!, i, params);
      if (sig && sig.t === done[i].t) found.push({ symbol, sig, near: false, boosted: false });
    }
    found.sort((a, b) => Number(b.boosted) - Number(a.boosted) || b.sig.strength - a.sig.strength);
    for (const { symbol, sig, near, boosted } of found) {
      if (count >= s.max_open) break;
      if (maxPerDay != null && openedToday >= maxPerDay) continue;
      const when = localParts(sig.t + barMs, tzOf.get(s.user_id) ?? null);
      if (!allowedByActions(rules, { symbol, direction: sig.direction, weekday: when.weekday, block: when.block })) continue;
      if (Date.now() - (sig.t + barMs) > 2 * BAR_MS) continue; // señal vieja (la función estuvo caída): no se persigue
      // Primero la señal (única por vela): si otra corrida ya la anotó, no se duplica.
      const { data: already } = await admin.from("bot_signals").select("id").eq("user_id", s.user_id).eq("symbol", symbol).eq("candle_time", new Date(sig.t).toISOString()).maybeSingle();
      if (already) continue;
      const { data: signal, error: sigErr } = await admin
        .from("bot_signals")
        .insert({ user_id: s.user_id, symbol, candle_time: new Date(sig.t).toISOString(), direction: sig.direction, entry: sig.entry, sl: sig.sl, tp: sig.tp })
        .select("id")
        .single();
      if (sigErr || !signal) continue;
      if (pause) {
        // Pausa por dato económico: la señal queda anotada (no se vuelve a evaluar ni se persigue) pero no se abre la operación.
        if (liveUsers.has(s.user_id)) await logNewsSkip(s.user_id, symbol, sig.direction, pause.event, pause.until);
        continue;
      }
      const { data: trade, error: trErr } = await admin
        .from("trades")
        .insert({ user_id: s.user_id, symbol, direction: sig.direction, entry: sig.entry, sl: sig.sl, tp: sig.tp, source: "bot", external_id: tf === "4h" ? `${symbol}:${sig.t}:4h` : `${symbol}:${sig.t}`, notes: near ? `${noteFor(profile)} ${unlockNote(unlockCfg, boosted)}` : noteFor(profile), tags: [TAG] })
        .select("id")
        .single();
      if (trErr || !trade) {
        console.error("bot trade:", trErr?.message);
        continue;
      }
      await admin.from("bot_signals").update({ trade_id: trade.id }).eq("id", signal.id);
      await notifyOpened(s.user_id, trade.id, { symbol, direction: sig.direction, entry: sig.entry, tp: sig.tp, sl: sig.sl }, profile);
      if (liveUsers.has(s.user_id)) await sendLiveOrder(s.user_id, trade.id);
      opened++;
      count++;
      openedToday++;
    }
  }
  return { ok: true, users: settings.length, opened, closed, failed, deferred };
}

// ─── Entrada ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const secret = Deno.env.get("BOT_CRON_SECRET") ?? Deno.env.get("EXCHANGE_CRON_SECRET");
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    if (!secret || secret.length < 16 || cron !== secret) return json({ ok: false, error: "No autorizado" }, 401);
    try {
      return json(await tick());
    } catch (e) {
      console.error("bot tick:", e instanceof Error ? e.message : e);
      return json({ ok: false, error: "tick" }, 500);
    }
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ ok: false, error: "Sesión no válida. Volvé a ingresar." }, 401);

  let body: { action?: unknown; symbols?: unknown; days?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* sin cuerpo */
  }
  if (body.action === "test_signal") {
    const r = await sendTestSignal(auth.user.id);
    return json(r.body, r.status);
  }
  if (body.action !== "backtest" && body.action !== "lab") return json({ ok: false, error: "Acción no válida" }, 400);
  const symbols = (Array.isArray(body.symbols) ? body.symbols : [...BOT_SYMBOLS.slice(0, 2)]).filter(isBotSymbol).slice(0, 10);
  if (!symbols.length) return json({ ok: false, error: "Elegí al menos un activo." }, 400);
  if (body.action === "lab") return json(await runLabTest(auth.user.id, symbols));
  const days = Math.min(120, Math.max(30, Number(body.days) || 120));
  return json(await runBacktest(auth.user.id, symbols, days));
});

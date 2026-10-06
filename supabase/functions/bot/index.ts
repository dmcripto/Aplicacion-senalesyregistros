// Bot automático (etapa simulada).
//
//   · POST con la sesión de la persona   { "action": "backtest", "symbols": [...], "days": 120 }
//       → prueba la estrategia con el historial real de precios y devuelve el resultado (no toca nada).
//   · POST con el encabezado x-cron-secret (pg_cron, cada 5 minutos)
//       → para cada persona con el bot encendido: cierra sus operaciones simuladas que tocaron stop u objetivo,
//         y anota una operación nueva si la última vela cerrada dio señal y los límites lo permiten.
//
// Nunca opera en un exchange: solo escribe en el diario de la persona.

import { createClient } from "npm:@supabase/supabase-js@2";
import { BAR_MS, BOT_PROFILES, BOT_PROFILE_IDS, BOT_SYMBOLS, WARMUP, allowedByActions, botStats, capOf, cleanActions, closedBars, describeParams, fetchBars, indicators, isBotSymbol, isProfileId, localParts, paramsOf, resolveFrom, signalAt, simulate } from "../_shared/botStrategy.ts";
import type { BotProfileId, Indicators } from "../_shared/botStrategy.ts";
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
const noteFor = (id: BotProfileId) => `🤖 Bot simulado (${id === "conservative" ? "perfil conservador" : id === "dynamic" ? "perfil dinámico" : "perfil equilibrado"}) · ${describeParams(BOT_PROFILES[id])}. No se operó en ningún exchange.`;
const TAG = "Bot simulado";

// ─── Prueba con historial ───────────────────────────────────────────────────

const BACKTEST_TTL = 30 * 60_000;
const barsCache = new Map<string, { at: number; bars: Bar[] }>();

async function barsFor(symbol: string, count: number): Promise<Bar[]> {
  const key = `${symbol}:${count}`;
  const hit = barsCache.get(key);
  if (hit && Date.now() - hit.at < BACKTEST_TTL) return hit.bars;
  const bars = closedBars(await fetchBars(symbol, count));
  barsCache.set(key, { at: Date.now(), bars });
  return bars;
}

/**
 * Simula el bot completo (con los topes y las reglas guardadas de la persona) sobre el historial real y lo compara
 * con el mismo bot sin reglas. Las reglas salen de operaciones de la persona, no de estos precios: es una prueba justa.
 */
async function runBacktest(userId: string, symbols: string[], days: number) {
  const count = Math.min(24 * days, 3000) + MAX_WARMUP;
  const { data: cfg } = await admin.from("bot_settings").select("*").eq("user_id", userId).maybeSingle();
  const { data: prof } = await admin.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const rules = cleanActions(cfg?.rules);
  const base = { maxOpen: Number(cfg?.max_open ?? 3), dailyLossR: Number(cfg?.daily_loss_r ?? 3), timeZone: (prof?.timezone as string | null) ?? null };
  const profile: BotProfileId = isProfileId(cfg?.profile) ? cfg.profile : "balanced";
  const params = paramsOf(profile);

  const bars: Record<string, Bar[]> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        bars[symbol] = await barsFor(symbol, count);
      } catch (e) {
        errors[symbol] = e instanceof Error ? e.message : "error";
      }
    }),
  );
  const without = simulate(bars, { symbols, rules: [], ...base }, params);
  const withRules = rules.length ? simulate(bars, { symbols, rules, ...base }, params) : null;
  // Los tres perfiles, sin reglas y con los mismos límites, para compararlos.
  const byProfile = BOT_PROFILE_IDS.map((id) => ({ id, current: id === profile, stats: botStats(simulate(bars, { symbols, rules: [], ...base }, BOT_PROFILES[id]).trades.map((t) => t.r)) }));
  return {
    ok: true,
    days,
    profile,
    params,
    byProfile,
    total: botStats(without.trades.map((t) => t.r)),
    withRules: withRules ? botStats(withRules.trades.map((t) => t.r)) : null,
    rulesApplied: rules.length,
    symbols: symbols.map((symbol) => ({ symbol, stats: botStats(without.trades.filter((t) => t.symbol === symbol).map((t) => t.r)), error: errors[symbol] })),
  };
}

// ─── Corrida periódica ──────────────────────────────────────────────────────

interface Settings {
  user_id: string;
  profile?: unknown;
  symbols: string[];
  max_open: number;
  daily_loss_r: number;
  rules?: unknown;
}

interface OpenBotTrade {
  id: string;
  user_id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp: number;
}

const rOf = (t: { entry: number; sl: number; tp: number }, outcome: "TP" | "SL") => (outcome === "SL" ? -1 : Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl));

async function tick() {
  const { data: rows } = await admin.from("bot_settings").select("*").eq("enabled", true).order("last_tick_at", { ascending: true, nullsFirst: true }).limit(MAX_USERS);
  const settings = (rows ?? []) as Settings[];
  // Las operaciones simuladas abiertas se siguen cerrando aunque la persona apague el bot.
  const { data: openRows } = await admin.from("trades").select("id, user_id, symbol, direction, entry, sl, tp").eq("source", "bot").eq("outcome", "ABIERTA").limit(2000);
  const open = (openRows ?? []) as OpenBotTrade[];
  const symbols = [...new Set([...settings.flatMap((s) => s.symbols), ...open.map((t) => t.symbol)])].filter(isBotSymbol);
  if (!symbols.length) return { ok: true, users: 0, opened: 0, closed: 0 };

  const bars = new Map<string, Bar[]>();
  const failed: string[] = [];
  await Promise.all(
    symbols.map(async (s) => {
      try {
        bars.set(s, await fetchBars(s, TICK_BARS));
      } catch (e) {
        failed.push(`${s}: ${e instanceof Error ? e.message : "error"}`);
      }
    }),
  );

  // 1) Cerrar lo que tocó stop u objetivo.
  let closed = 0;
  const { data: sigRows } = open.length
    ? await admin.from("bot_signals").select("trade_id, candle_time").in("trade_id", open.map((t) => t.id))
    : { data: [] as Array<{ trade_id: string; candle_time: string }> };
  const candleOf = new Map((sigRows ?? []).map((r) => [r.trade_id, new Date(r.candle_time).getTime()]));
  for (const t of open) {
    const b = bars.get(t.symbol);
    const candle = candleOf.get(t.id);
    if (!b || candle == null) continue;
    const from = b.findIndex((x) => x.t >= candle + BAR_MS);
    if (from < 0) continue;
    const hit = resolveFrom(b, from, t);
    if (!hit) continue;
    const { data: upd } = await admin
      .from("trades")
      .update({ outcome: hit.outcome, closed_at: new Date(b[hit.index].t + BAR_MS).toISOString(), auto_closed: true })
      .eq("id", t.id)
      .eq("outcome", "ABIERTA")
      .select("id");
    if (upd?.length) closed++;
  }

  // 2) Señales nuevas.
  let opened = 0;
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: profs } = settings.length
    ? await admin.from("profiles").select("id, timezone").in("id", settings.map((x) => x.user_id))
    : { data: [] as Array<{ id: string; timezone: string | null }> };
  const tzOf = new Map((profs ?? []).map((p: { id: string; timezone: string | null }) => [p.id, p.timezone]));
  const t0 = Date.now();
  const inds = new Map<string, Indicators>(); // indicadores por activo y perfil (se calculan una vez por corrida)
  let deferred = 0;
  for (const [n, s] of settings.entries()) {
    if (Date.now() - t0 > BUDGET_MS) {
      deferred = settings.length - n;
      break;
    }
    const profile: BotProfileId = isProfileId(s.profile) ? s.profile : "balanced";
    const params = paramsOf(profile);
    const rules: BotAction[] = cleanActions(s.rules);
    const { data: openNow } = await admin.from("trades").select("symbol").eq("user_id", s.user_id).eq("source", "bot").eq("outcome", "ABIERTA");
    const openSymbols = new Set((openNow ?? []).map((r: { symbol: string }) => r.symbol));
    const { data: recent } = await admin.from("trades").select("entry, sl, tp, outcome").eq("user_id", s.user_id).eq("source", "bot").neq("outcome", "ABIERTA").gte("closed_at", since);
    const lossToday = (recent ?? []).reduce((a: number, r: { entry: number; sl: number; tp: number; outcome: "TP" | "SL" }) => a + rOf(r, r.outcome), 0);
    await admin.from("bot_settings").update({ last_tick_at: new Date().toISOString() }).eq("user_id", s.user_id);
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
    for (const symbol of s.symbols) {
      if (count >= s.max_open || openSymbols.has(symbol)) continue;
      const b = bars.get(symbol);
      if (!b) continue;
      const done = closedBars(b);
      const i = done.length - 1;
      if (i < 0) continue;
      const key = `${symbol}:${profile}`;
      if (!inds.has(key)) inds.set(key, indicators(done, params));
      const sig = signalAt(done, inds.get(key)!, i, params);
      if (!sig || sig.t !== done[i].t) continue;
      if (maxPerDay != null && openedToday >= maxPerDay) continue;
      const when = localParts(sig.t + BAR_MS, tzOf.get(s.user_id) ?? null);
      if (!allowedByActions(rules, { symbol, direction: sig.direction, weekday: when.weekday, block: when.block })) continue;
      if (Date.now() - (sig.t + BAR_MS) > 2 * BAR_MS) continue; // señal vieja (la función estuvo caída): no se persigue
      // Primero la señal (única por vela): si otra corrida ya la anotó, no se duplica.
      const { data: already } = await admin.from("bot_signals").select("id").eq("user_id", s.user_id).eq("symbol", symbol).eq("candle_time", new Date(sig.t).toISOString()).maybeSingle();
      if (already) continue;
      const { data: signal, error: sigErr } = await admin
        .from("bot_signals")
        .insert({ user_id: s.user_id, symbol, candle_time: new Date(sig.t).toISOString(), direction: sig.direction, entry: sig.entry, sl: sig.sl, tp: sig.tp })
        .select("id")
        .single();
      if (sigErr || !signal) continue;
      const { data: trade, error: trErr } = await admin
        .from("trades")
        .insert({ user_id: s.user_id, symbol, direction: sig.direction, entry: sig.entry, sl: sig.sl, tp: sig.tp, source: "bot", external_id: `${symbol}:${sig.t}`, notes: noteFor(profile), tags: [TAG] })
        .select("id")
        .single();
      if (trErr || !trade) {
        console.error("bot trade:", trErr?.message);
        continue;
      }
      await admin.from("bot_signals").update({ trade_id: trade.id }).eq("id", signal.id);
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
  if (body.action !== "backtest") return json({ ok: false, error: "Acción no válida" }, 400);
  const symbols = (Array.isArray(body.symbols) ? body.symbols : [...BOT_SYMBOLS.slice(0, 2)]).filter(isBotSymbol).slice(0, 5);
  if (!symbols.length) return json({ ok: false, error: "Elegí al menos un activo." }, 400);
  const days = Math.min(120, Math.max(30, Number(body.days) || 120));
  return json(await runBacktest(auth.user.id, symbols, days));
});

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
import { BAR_MS, BOT_SYMBOLS, DEFAULT_PARAMS, WARMUP, allowedByActions, backtest, botStats, capOf, cleanActions, closedBars, fetchBars, indicators, isBotSymbol, localParts, resolveFrom, signalAt } from "../_shared/botStrategy.ts";
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

const BATCH = 200;
const TICK_BARS = WARMUP() + 80; // lo justo para calcular indicadores y resolver operaciones recientes
const NOTE = "🤖 Bot simulado · ruptura de 20 velas a favor de la tendencia (EMA 50/200) · stop 1,5 ATR · objetivo 2R. No se operó en ningún exchange.";
const TAG = "Bot simulado";

// ─── Prueba con historial ───────────────────────────────────────────────────

const BACKTEST_TTL = 30 * 60_000;
const cache = new Map<string, { at: number; value: BacktestPart }>();

interface BacktestPart {
  symbol: string;
  trades: number[];
  open: number;
  error?: string;
}

async function runBacktest(symbols: string[], days: number) {
  const bars = Math.min(24 * days, 3000) + WARMUP();
  const per = await Promise.all(
    symbols.map(async (symbol): Promise<BacktestPart> => {
      const key = `${symbol}:${bars}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < BACKTEST_TTL) return hit.value;
      let value: BacktestPart;
      try {
        const data = closedBars(await fetchBars(symbol, bars));
        const r = backtest(data);
        // Solo cuentan las operaciones que abrieron después del tramo de arranque de los indicadores.
        const from = data[Math.min(WARMUP(), data.length - 1)]?.t ?? 0;
        value = { symbol, trades: r.trades.filter((t) => t.t >= from).map((t) => t.r), open: r.open };
      } catch (e) {
        value = { symbol, trades: [], open: 0, error: e instanceof Error ? e.message : "error" };
      }
      if (!value.error) cache.set(key, { at: Date.now(), value });
      return value;
    }),
  );
  const all = per.flatMap((p) => p.trades);
  return {
    ok: true,
    days,
    params: DEFAULT_PARAMS,
    total: botStats(all),
    symbols: per.map((p) => ({ symbol: p.symbol, stats: botStats(p.trades), error: p.error })),
  };
}

// ─── Corrida periódica ──────────────────────────────────────────────────────

interface Settings {
  user_id: string;
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
  const { data: rows } = await admin.from("bot_settings").select("*").eq("enabled", true).limit(BATCH);
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
  for (const s of settings) {
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
      const sig = signalAt(done, indicators(done), i);
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
        .insert({ user_id: s.user_id, symbol, direction: sig.direction, entry: sig.entry, sl: sig.sl, tp: sig.tp, source: "bot", external_id: `${symbol}:${sig.t}`, notes: NOTE, tags: [TAG] })
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
  return { ok: true, users: settings.length, opened, closed, failed };
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
  return json(await runBacktest(symbols, days));
});

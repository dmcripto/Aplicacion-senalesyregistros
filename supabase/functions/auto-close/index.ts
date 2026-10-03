// Cierre automático de operaciones: cada minuto (pg_cron) revisa las operaciones
// abiertas, consulta velas públicas y marca TP o SL cuando el precio los tocó.
// Es idempotente y se limita a una corrida cada 25 s, así que llamarla desde
// afuera no tiene efecto adicional.

import { createClient } from "npm:@supabase/supabase-js@2";
import { detectHit, fetchCandles, parseMarketSymbol, rOfHit } from "../_shared/autoClose.ts";
import type { Candle, MarketSymbol, OpenTrade } from "../_shared/autoClose.ts";
import { sendExpoPush } from "../_shared/expoPush.ts";
import { communityResultMessage, publishToCommunities } from "../_shared/community.ts";
import { sendDailySummaries } from "../_shared/dailySummary.ts";
import { botToken, esc, notifyTelegram, sendMessage } from "../_shared/telegram.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MIN_GAP_MS = 25_000;
const MAX_TRADES = 2000;
const CONCURRENCY = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const { data: last } = await supabase
    .from("auto_close_runs")
    .select("ran_at")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.ran_at).getTime() < MIN_GAP_MS) return json({ skipped: true });
  await supabase.from("auto_close_runs").insert({});
  await supabase.from("auto_close_runs").delete().lt("ran_at", new Date(Date.now() - 86_400_000).toISOString());

  // Resumen diario: se revisa una vez cada 10 minutos (a partir de las 21:00 de cada zona horaria).
  if (new Date().getUTCMinutes() % 10 === 0) {
    try {
      const token = botToken();
      await sendDailySummaries({
        supabase,
        telegram: async (chatId, html) => (token ? await sendMessage(token, chatId, html) : undefined),
        push: sendExpoPush,
      });
    } catch (e) {
      console.error("daily-summary:", e instanceof Error ? e.message : e);
    }
  }

  const { data: disabled } = await supabase.from("profiles").select("id").eq("auto_close", false);
  const off = new Set((disabled ?? []).map((p) => p.id as string));

  const { data: rows, error } = await supabase
    .from("trades")
    .select("id,user_id,symbol,direction,entry,tp,sl,date")
    .eq("outcome", "ABIERTA")
    .order("date", { ascending: false })
    .limit(MAX_TRADES);
  if (error) return json({ error: error.message }, 500);

  const trades: Array<{ trade: OpenTrade; sym: MarketSymbol }> = [];
  for (const r of rows ?? []) {
    if (off.has(r.user_id)) continue;
    const sym = parseMarketSymbol(r.symbol);
    if (!sym) continue;
    trades.push({
      trade: {
        id: r.id,
        user_id: r.user_id,
        symbol: r.symbol,
        direction: r.direction,
        entry: Number(r.entry),
        tp: Number(r.tp),
        sl: Number(r.sl),
        date: r.date,
      },
      sym,
    });
  }

  // Un pedido de velas por símbolo, desde la operación abierta más antigua.
  const since = new Map<string, { sym: MarketSymbol; ms: number }>();
  for (const { trade, sym } of trades) {
    const ms = new Date(trade.date).getTime();
    const cur = since.get(sym.key);
    if (!cur || ms < cur.ms) since.set(sym.key, { sym, ms });
  }
  const candlesByKey = new Map<string, Candle[]>();
  const entries = [...since.entries()];
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + CONCURRENCY).map(async ([key, { sym, ms }]) => {
        const candles = await fetchCandles(sym, ms);
        if (candles) candlesByKey.set(key, candles);
      }),
    );
  }

  let closed = 0;
  for (const { trade, sym } of trades) {
    const candles = candlesByKey.get(sym.key);
    if (!candles) continue;
    const hit = detectHit(trade, candles);
    if (!hit) continue;

    const { data: updated } = await supabase
      .from("trades")
      .update({ outcome: hit.outcome, closed_at: new Date(hit.at).toISOString(), auto_closed: true })
      .eq("id", trade.id)
      .eq("outcome", "ABIERTA")
      .select("id");
    if (!updated?.length) continue;
    closed++;

    const r = rOfHit(trade, hit.outcome);
    await notifyTelegram(supabase, trade.user_id, (lang) => {
      const ok = hit.outcome === "TP";
      const title = ok ? (lang === "en" ? "TP hit" : "TP alcanzado") : lang === "en" ? "SL hit" : "SL alcanzado";
      return `${ok ? "✅" : "❌"} <b>${title}</b> · ${esc(trade.symbol)}\n${lang === "en" ? "Auto-close" : "Cierre automático"} ${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`;
    });
    await publishToCommunities(supabase, botToken(), trade.user_id, (lang) => communityResultMessage(trade.symbol, hit.outcome, r, lang));
    const { data: tokens } = await supabase.from("device_tokens").select("expo_push_token").eq("user_id", trade.user_id);
    if (tokens?.length) {
      // Idioma del usuario (columna opcional: si todavía no existe, se usa español).
      const { data: langRow } = await supabase.from("profiles").select("lang").eq("id", trade.user_id).maybeSingle();
      const en = (langRow as { lang?: string } | null)?.lang === "en";
      await sendExpoPush(
        tokens.map((t) => ({
          to: t.expo_push_token,
          title: `${hit.outcome === "TP" ? (en ? "✅ TP hit" : "✅ TP alcanzado") : en ? "❌ SL hit" : "❌ SL alcanzado"} · ${trade.symbol}`,
          body: `${en ? "Auto-close" : "Cierre automático"} ${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`,
          data: { tradeId: trade.id },
        })),
      );
    }
  }

  return json({ ok: true, open: trades.length, symbols: since.size, closed });
});

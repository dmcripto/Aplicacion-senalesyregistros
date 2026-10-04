// Cierre automático de operaciones: cada minuto (pg_cron) revisa las operaciones
// abiertas, consulta velas públicas y marca TP o SL cuando el precio los tocó.
// Es idempotente y se limita a una corrida cada 25 s, así que llamarla desde
// afuera no tiene efecto adicional.

import { createClient } from "npm:@supabase/supabase-js@2";
import { PARTIAL_R, detectHit, detectPartial, fetchCandles, parseMarketSymbol, partialLevel, rOfHit } from "../_shared/autoClose.ts";
import type { Candle, MarketSymbol, OpenTrade } from "../_shared/autoClose.ts";
import { sendExpoPush } from "../_shared/expoPush.ts";
import { partialCardImage, resultCardImage } from "../_shared/card.ts";
import { notifyWhatsApp, waResultParams } from "../_shared/waCloud.ts";
import { communityResultMessage, partialCardHtml, publishToCommunities, resultCardHtml } from "../_shared/community.ts";
import { sendDailySummaries } from "../_shared/dailySummary.ts";
import { botToken, notifyTelegram, sendMessage } from "../_shared/telegram.ts";
import { waResultText } from "../_shared/whatsapp.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MIN_GAP_MS = 25_000;
const PARTIAL_FRESH_MS = 45 * 60_000; // el Target 1 solo se avisa si se tocó hace menos de esto
const MAX_TRADES = 2000;
const CONCURRENCY = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Avisa del Target 1 una sola vez por operación. Si el nivel se tocó hace rato (ya estaba así al activar la función), solo se marca. */
async function partialAlert(trade: OpenTrade, candles: Candle[]) {
  try {
    const at = detectPartial(trade, candles);
    const level = partialLevel(trade);
    if (at == null || level == null) return;
    const { data: marked, error } = await supabase
      .from("trades")
      .update({ partial_at: new Date().toISOString() })
      .eq("id", trade.id)
      .eq("outcome", "ABIERTA")
      .is("partial_at", null)
      .select("id");
    if (error || !marked?.length) return; // sin columna, o ya la marcó otra corrida
    if (Date.now() - at > PARTIAL_FRESH_MS) return; // viejo: no avisar
    const sig = { symbol: trade.symbol, direction: trade.direction, entry: trade.entry, tp: trade.tp, sl: trade.sl };
    await notifyTelegram(supabase, trade.user_id, (lang) => partialCardHtml(sig, level, PARTIAL_R, lang, { header: "🔔", disclaimer: false }));
    await publishToCommunities(supabase, botToken(), trade.user_id, (lang) => partialCardHtml(sig, level, PARTIAL_R, lang), (lang) => partialCardImage(sig, level, PARTIAL_R, lang));
  } catch (e) {
    console.error("partial:", e instanceof Error ? e.message : e);
  }
}

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

  // Personas que apagaron el aviso de Target 1 (columna opcional: si todavía no existe, el aviso queda para todos).
  const { data: noPartial } = await supabase.from("profiles").select("id").eq("partial_alerts", false);
  const partialOff = new Set((noPartial ?? []).map((p) => p.id as string));

  const openTrades = (cols: string) => supabase.from("trades").select(cols).eq("outcome", "ABIERTA").order("date", { ascending: false }).limit(MAX_TRADES);
  let { data: rows, error } = await openTrades("id,user_id,symbol,direction,entry,tp,sl,date,partial_at");
  // Sin la columna partial_at (falta correr el SQL) se sigue como antes, sin avisos de Target 1.
  if (error) ({ data: rows, error } = await openTrades("id,user_id,symbol,direction,entry,tp,sl,date"));
  if (error) return json({ error: error.message }, 500);

  const partialDone = new Map<string, string | null>(); // id → partial_at, para no repetir el aviso
  const trades: Array<{ trade: OpenTrade; sym: MarketSymbol }> = [];
  for (const r of rows ?? []) {
    if (off.has(r.user_id)) continue;
    const sym = parseMarketSymbol(r.symbol);
    if (!sym) continue;
    if ("partial_at" in r) partialDone.set(r.id, (r as { partial_at: string | null }).partial_at);
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
    if (!hit) {
      // Sigue abierta: ¿llegó al Target 1? (solo si existe la columna, la persona no lo apagó y todavía no se avisó)
      if (partialDone.has(trade.id) && partialDone.get(trade.id) == null && !partialOff.has(trade.user_id)) await partialAlert(trade, candles);
      continue;
    }

    const { data: updated } = await supabase
      .from("trades")
      .update({ outcome: hit.outcome, closed_at: new Date(hit.at).toISOString(), auto_closed: true })
      .eq("id", trade.id)
      .eq("outcome", "ABIERTA")
      .select("id");
    if (!updated?.length) continue;
    closed++;

    const r = rOfHit(trade, hit.outcome);
    await notifyTelegram(supabase, trade.user_id, (lang) => resultCardHtml(trade.symbol, hit.outcome, r, lang, { label: lang === "en" ? "Auto-close" : "Cierre automático" }), (lang) => waResultText(trade.symbol, hit.outcome, r, lang));
    await publishToCommunities(supabase, botToken(), trade.user_id, (lang) => communityResultMessage(trade.symbol, hit.outcome, r, lang), (lang) => resultCardImage(trade.symbol, hit.outcome, r, lang));
    await notifyWhatsApp(supabase, trade.user_id, (lang) => ({ kind: "result", params: waResultParams(trade.symbol, hit.outcome, r, lang) }));
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

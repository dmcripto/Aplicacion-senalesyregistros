// Cierre automático de operaciones: cada minuto (pg_cron) revisa las operaciones
// abiertas, consulta velas públicas y marca TP o SL cuando el precio los tocó.
// Es idempotente y se limita a una corrida cada 25 s, así que llamarla desde
// afuera no tiene efecto adicional.

import { createClient } from "npm:@supabase/supabase-js@2";
import { detectHit, detectTargets, fetchCandles, parseMarketSymbol, rOfHit, targetLevels, isSimulated, isTestSignal, keepsOutOfCommunity } from "../_shared/autoClose.ts";
import type { Candle, MarketSymbol, OpenTrade } from "../_shared/autoClose.ts";
import { sendExpoPush } from "../_shared/expoPush.ts";
import { partialCardImage, resultCardImage } from "../_shared/card.ts";
import { notifyWhatsApp, waResultParams } from "../_shared/waCloud.ts";
import { communityResultMessage, partialCardHtml, publishToCommunities, resultCardHtml, resultNote } from "../_shared/community.ts";
import { sendDailySummaries } from "../_shared/dailySummary.ts";
import { postEconomyNews, refreshEvents } from "../_shared/economy.ts";
import { postSessionAlerts } from "../_shared/sessions.ts";
import { postMarketAlerts, postMarketMorning, postWeeklyRanking } from "../_shared/communityTools.ts";
import { alertTexts, runAlerts } from "../_shared/alerts.ts";
import { botToken, notifyTelegram, sendMessage } from "../_shared/telegram.ts";
import { waResultText } from "../_shared/whatsapp.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MIN_GAP_MS = 25_000;
const PARTIAL_FRESH_MS = 45 * 60_000; // un target solo se avisa si se tocó hace menos de esto
const MAX_TRADES = 2000;
const CONCURRENCY = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Avisa cada target (Target 1, Target 2…) una sola vez por operación, en orden. Si un target se tocó hace rato
 * (ya estaba así al activar la función, o la persona tenía los avisos apagados) solo se marca, sin avisar.
 */
async function targetAlerts(trade: OpenTrade, candles: Candle[]) {
  try {
    const levels = targetLevels(trade);
    const times = detectTargets(trade, candles);
    const risk = Math.abs(trade.entry - trade.sl);
    const sig = { symbol: trade.symbol, direction: trade.direction, entry: trade.entry, tp: trade.tp, sl: trade.sl };
    for (let i = trade.targets_hit ?? 0; i < times.length; i++) {
      const { data: marked, error } = await supabase
        .from("trades")
        .update({ targets_hit: i + 1 })
        .eq("id", trade.id)
        .eq("outcome", "ABIERTA")
        .eq("targets_hit", i)
        .select("id");
      if (error || !marked?.length) return; // sin columna, o ya lo marcó otra corrida
      if (Date.now() - times[i] > PARTIAL_FRESH_MS) continue; // viejo: no avisar
      const level = levels[i];
      const r = risk > 0 ? Math.abs(level - trade.entry) / risk : 0;
      const n = i + 1;
      await notifyTelegram(supabase, trade.user_id, (lang) => partialCardHtml(sig, level, r, lang, { header: "🔔", disclaimer: false, n }));
      if (!keepsOutOfCommunity(trade)) await publishToCommunities(supabase, botToken(), trade.user_id, (lang) => partialCardHtml(sig, level, r, lang, { n }), (lang) => partialCardImage(sig, level, r, lang, n));
    }
  } catch (e) {
    console.error("targets:", e instanceof Error ? e.message : e);
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

  // Agenda económica: cada 5 minutos se actualiza el calendario (si toca) y se publican las noticias en las comunidades que lo activaron.
  if (new Date().getUTCMinutes() % 5 === 0) {
    try {
      const token = botToken();
      await refreshEvents(supabase);
      await postEconomyNews({
        supabase,
        send: async (chatId, html, thread) => (token ? await sendMessage(token, chatId, html, thread ? { message_thread_id: thread } : {}) : undefined),
      });
    } catch (e) {
      console.error("economy:", e instanceof Error ? e.message : e);
    }
  }

  // Comunidad: resumen de mercado de la mañana y avisos de funding / movimientos fuertes (cada 5 min, en «Noticias»)
  // y ranking semanal (domingo a la noche, en el tema de las señales).
  if (new Date().getUTCMinutes() % 5 === 0) {
    try {
      const token = botToken();
      const send = async (chatId: number, html: string, thread: number | null) => (token ? await sendMessage(token, chatId, html, thread ? { message_thread_id: thread } : {}) : undefined);
      await postMarketMorning({ supabase, send });
      await postMarketAlerts({ supabase, send });
      await postWeeklyRanking({ supabase, send });
    } catch (e) {
      console.error("community-tools:", e instanceof Error ? e.message : e);
    }
  }

  // Apertura y cierre de las bolsas (Tokio, Londres, Nueva York) en el tema de noticias: se revisa cada minuto.
  try {
    const token = botToken();
    await postSessionAlerts({
      supabase,
      send: async (chatId, html, thread) => (token ? await sendMessage(token, chatId, html, thread ? { message_thread_id: thread } : {}) : undefined),
    });
  } catch (e) {
    console.error("sessions:", e instanceof Error ? e.message : e);
  }

  // Alertas propias de las personas (precio, RSI, EMA): se revisan cada minuto.
  try {
    await runAlerts({
      supabase,
      notify: async (a, m) => {
        const { data: prof } = await supabase.from("profiles").select("lang").eq("id", a.user_id).maybeSingle();
        const lang: "es" | "en" = (prof as { lang?: string } | null)?.lang === "en" ? "en" : "es";
        const txt = alertTexts(a, m, lang);
        const { data: tokens } = await supabase.from("device_tokens").select("expo_push_token").eq("user_id", a.user_id);
        await sendExpoPush((tokens ?? []).map((tk) => ({ to: tk.expo_push_token as string, title: txt.title, body: txt.body, data: { type: "alert", symbol: a.symbol } })));
        await notifyTelegram(supabase, a.user_id, (l) => alertTexts(a, m, l).html);
      },
    });
  } catch (e) {
    console.error("alerts:", e instanceof Error ? e.message : e);
  }

  const { data: disabled } = await supabase.from("profiles").select("id").eq("auto_close", false);
  const off = new Set((disabled ?? []).map((p) => p.id as string));

  // Personas que apagaron el aviso de targets (columna opcional: si todavía no existe, el aviso queda para todos).
  const { data: noPartial } = await supabase.from("profiles").select("id").eq("partial_alerts", false);
  const partialOff = new Set((noPartial ?? []).map((p) => p.id as string));

  const openTrades = (cols: string) => supabase.from("trades").select(cols).eq("outcome", "ABIERTA").order("date", { ascending: false }).limit(MAX_TRADES);
  let { data: rows, error } = await openTrades("id,user_id,symbol,direction,entry,tp,sl,date,targets,targets_hit,source,notes");
  // Sin las columnas targets / targets_hit (falta correr el SQL) se sigue como antes, sin avisos de targets.
  if (error) ({ data: rows, error } = await openTrades("id,user_id,symbol,direction,entry,tp,sl,date,source,notes"));
  if (error) return json({ error: error.message }, 500);

  const trades: Array<{ trade: OpenTrade; sym: MarketSymbol }> = [];
  for (const r of rows ?? []) {
    if (off.has(r.user_id)) continue;
    if (isSimulated(r as { source?: string | null })) continue; // las del bot simulado las sigue la función del bot
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
        source: (r as { source?: string | null }).source ?? null,
        notes: (r as { notes?: string | null }).notes ?? null,
        ...("targets_hit" in r ? { targets: (r as { targets?: number[] | null }).targets?.map(Number) ?? null, targets_hit: Number((r as { targets_hit?: number }).targets_hit ?? 0) } : {}),
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
      // Sigue abierta: ¿llegó a algún target? (solo si existen las columnas y la persona no apagó el aviso)
      if (trade.targets_hit != null && !partialOff.has(trade.user_id)) await targetAlerts(trade, candles);
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
    // ¿Cómo llegó el precio? Cuántos targets se habían tocado antes de cerrar → «SL tocado antes del Target 1», «Directo al TP»…
    const totalTargets = targetLevels(trade).length;
    const reached = Math.max(detectTargets(trade, candles).filter((at) => at < hit.at).length, trade.targets_hit ?? 0);
    const note = (lang: "es" | "en") => resultNote(hit.outcome, reached, totalTargets, lang);
    const test = isTestSignal(trade); // la señal de prueba se avisa como «(prueba)» también al cerrarse
    const closeLabel = (lang: "es" | "en") => (lang === "en" ? "Auto-close" : "Cierre automático") + (test ? (lang === "en" ? " (test)" : " (prueba)") : "");
    await notifyTelegram(supabase, trade.user_id, (lang) => resultCardHtml(trade.symbol, hit.outcome, r, lang, { label: closeLabel(lang), note: note(lang) }), (lang) => waResultText(trade.symbol, hit.outcome, r, lang));
    if (!keepsOutOfCommunity(trade)) {
      await publishToCommunities(supabase, botToken(), trade.user_id, (lang) => communityResultMessage(trade.symbol, hit.outcome, r, lang, note(lang)), (lang) => resultCardImage(trade.symbol, hit.outcome, r, lang, { note: note(lang) }));
      await notifyWhatsApp(supabase, trade.user_id, (lang) => ({ kind: "result", params: waResultParams(trade.symbol, hit.outcome, r, lang) }));
    }
    const { data: tokens } = await supabase.from("device_tokens").select("expo_push_token").eq("user_id", trade.user_id);
    if (tokens?.length) {
      // Idioma del usuario (columna opcional: si todavía no existe, se usa español).
      const { data: langRow } = await supabase.from("profiles").select("lang").eq("id", trade.user_id).maybeSingle();
      const en = (langRow as { lang?: string } | null)?.lang === "en";
      await sendExpoPush(
        tokens.map((t) => ({
          to: t.expo_push_token,
          title: `${hit.outcome === "TP" ? (en ? "✅ TP hit" : "✅ TP alcanzado") : en ? "❌ SL hit" : "❌ SL alcanzado"} · ${trade.symbol}${test ? (en ? " (test)" : " (prueba)") : ""}`,
          body: [`${closeLabel(en ? "en" : "es")} ${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`, note(en ? "en" : "es")].filter(Boolean).join(" · "),
          data: { tradeId: trade.id },
        })),
      );
    }
  }

  return json({ ok: true, open: trades.length, symbols: since.size, closed });
});

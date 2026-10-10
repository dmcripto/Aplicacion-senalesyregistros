// Bot de Telegram de VELTRIX.
//
// 1) Webhook de Telegram (POST con update_id + cabecera secreta): recibe lo que el usuario le escribe al bot.
//    · /start CODIGO  → vincula el chat con la cuenta
//    · texto con una señal (pegado o reenviado de un canal) → la interpreta y pide confirmación con botones
//    · /abiertas, /resumen, /idioma, /desvincular, /ayuda
// 2) Pedidos de la app (POST con la sesión del usuario): { "action": "link" } → devuelve el link t.me con el código.
//
// Secretos de la función: TELEGRAM_BOT_TOKEN (de @BotFather) y TELEGRAM_WEBHOOK_SECRET (cualquier frase larga).

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseAlerts } from "../_shared/parseAlert.ts";
import { runInBackground, signalCardImage } from "../_shared/card.ts";
import { chartImage, parseChartArgs } from "../_shared/chartImage.ts";
import { groupHelpMessage } from "../_shared/groupHelp.ts";
import { fetchQuotes, parseQuoteArgs, quoteMessage } from "../_shared/priceQuote.ts";
import { communitySignalMessage, publishToCommunities } from "../_shared/community.ts";
import { botToken, esc, sendMessage, sendPhoto, tgApi } from "../_shared/telegram.ts";
import { ANNOUNCEMENTS, announcementIds } from "../_shared/announcements.ts";
import type { Lang } from "../_shared/telegram.ts";
import { welcomeGreeting, welcomeHello } from "../_shared/welcome.ts";
import {
  calcMessage, calcUsage, communityTrades, fetchLevels, levelsMessage, parseCalcArgs, parseSymbolList,
  sendExposureNotice, streakMessage, streaks, weeklyMessage, weeklyRanking, WEEK_MS,
} from "../_shared/communityTools.ts";
import { castVote, parseVote, voteKeyboard } from "../_shared/votes.ts";
import { hasLink, isNewMember, myInvite, pinReplace, recordJoin } from "../_shared/groupTools.ts";
import { normalizeSymbol } from "../_shared/chartImage.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/**
 * Permisos de administrador que el enlace «Agregar al grupo» le propone al bot (la persona puede cambiarlos antes de confirmar).
 * delete_messages: la bienvenida borra su saludo anterior; manage_topics: publicar en los temas; pin_messages, invite_users y las
 * tres de historias: los que pidió la comunidad. Nombres según https://core.telegram.org/api/links
 */
const GROUP_ADMIN_RIGHTS = ["delete_messages", "pin_messages", "invite_users", "manage_topics", "post_stories", "edit_stories", "delete_stories"];

const MAX_PER_MINUTE = 20; // mismo límite que el webhook de TradingView
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_MINUTES = 10;

// ─── Textos ─────────────────────────────────────────────────────────────────

const money = (n: number, cur: string) => {
  const sym: Record<string, string> = { USD: "$", USDT: "$", USDC: "$", EUR: "€", GBP: "£" };
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pre = sym[cur] ?? `${cur} `;
  return `${n >= 0 ? "+" : "−"}${pre}${body}`;
};
const tgR = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1).replace(/\.0$/, "")}R`;

const T = {
  es: {
    help:
      "<b>VELTRIX</b> 👋\n\nPegá acá una señal (o reenviá el mensaje de un canal) y la registro en tu diario.\n\n" +
      "/abiertas — tus señales abiertas\n/grafico BTCUSDT 4h — gráfico de velas (agregá «ema» o «liq» para ver medias o liquidaciones)\n/resumen — tus resultados en R\n/semana — tu semana · /racha — tus rachas\n/niveles BTC — precio, RSI y tendencia · /calc — tamaño de la posición\n/activos btc eth — solo señales de esos activos · /riesgo off — apagar el aviso de exposición\n/whatsapp on — botón para pasar cada aviso a WhatsApp\n/idioma en — cambiar a inglés\n/desvincular — desconectar este chat\n\n" +
      "Ejemplo:\n<code>BTCUSDT LONG\nEntrada: 65000\nTP: 66500\nSL: 64500</code>",
    notLinked:
      "Este chat todavía no está conectado a una cuenta de VELTRIX.\n\nEntrá a la app o la web → «Conectar Telegram» y tocá el botón: te trae de vuelta acá ya vinculado.",
    badCode: "Ese código no es válido o venció. Volvé a la app o la web y tocá «Conectar Telegram» de nuevo.",
    linked: "✅ <b>Telegram conectado</b>. Ya podés pegar señales acá y te aviso cuando llegue una alerta o se toque un TP/SL.",
    unlinked: "Listo, desconecté este chat de tu cuenta. Podés volver a conectarlo cuando quieras desde la app.",
    waOn: "📲 Listo: cada aviso trae un botón «Enviar a WhatsApp». Lo tocás y se abre WhatsApp con el mensaje armado para que elijas a quién mandarlo.",
    waOff: "Listo, saqué el botón de WhatsApp de los avisos.",
    waUsage: "Usá /whatsapp on o /whatsapp off.",
    langSet: "Idioma cambiado a español 🇪🇸",
    langUsage: "Usá /idioma es o /idioma en.",
    understood: (n: number) => (n === 1 ? "Entendí esta señal:" : `Entendí ${n} señales:`),
    register: (n: number) => (n === 1 ? "✅ Registrar" : `✅ Registrar ${n}`),
    cancel: "✖ Cancelar",
    canceled: "Cancelado. No registré nada.",
    expired: "Esa señal ya no está pendiente (venció o ya la procesé). Pegala de nuevo.",
    registered: (n: number, dup: number) =>
      `✅ ${n === 1 ? "Señal registrada" : `${n} señales registradas`} en tu diario.${dup ? ` (${dup} ya estaba${dup === 1 ? "" : "n"} cargada${dup === 1 ? "" : "s"})` : ""}`,
    tooMany: "Demasiadas señales en el último minuto. Esperá un momento y probá de nuevo.",
    noSignal: "No encontré una señal en ese mensaje.",
    tip: "Probá con activo, dirección, entrada, TP y SL, por ejemplo:\n<code>BTCUSDT LONG\nEntrada: 65000\nTP: 66500\nSL: 64500</code>",
    noOpen: "No tenés señales abiertas.",
    openTitle: "<b>Señales abiertas</b>",
    summaryTitle: "<b>Tus resultados</b>",
    last24: "Últimas 24 h",
    last7: "7 días",
    last30: "30 días",
    ops: "operaciones",
    win: "acierto",
    noClosed: "Todavía no tenés operaciones cerradas en los últimos 30 días.",
    buy: "COMPRA",
    sell: "VENTA",
    entry: "Entrada",
    groupsHint: "Escribime por privado 🙂",
    adminOnly: "😊 Ese comando sirve para configurar el bot y lo usan los administradores del grupo. Vos podés pedirme un gráfico cuando quieras: <code>/grafico BTC 4h</code>",
    communityBad: "Ese código no es válido o venció. Generá uno nuevo en la app o la web, en «Bot de Telegram → Conectar comunidad».",
    communityLinked: "✅ Comunidad conectada. Acá voy a publicar las señales y los resultados (TP/SL) de la cuenta de VELTRIX que la conectó.\n\nPara dejar de publicar: /desconectarcomunidad",
    communityRemoved: "Listo, dejé de publicar en este chat.",
    newsOn: "📰 Listo: en este tema voy a publicar la <b>agenda económica</b>: el resumen del día a las 8:00 y un aviso 30 minutos antes de cada dato de alto impacto.\n\nPara dejar de publicarla: /noticias off",
    newsOff: "Listo, dejé de publicar la agenda económica en este chat.",
    newsNoCommunity: "Primero conectá este grupo a tu cuenta de VELTRIX con /comunidad (desde la app o la web, «Conectar Telegram»). Después escribí /noticias en el tema de noticias.",
  },
  en: {
    help:
      "<b>VELTRIX</b> 👋\n\nPaste a signal here (or forward a channel message) and I'll log it in your journal.\n\n" +
      "/open — your open signals\n/chart BTCUSDT 4h — candlestick chart (add “ema” or “liq” for averages or liquidations)\n/summary — your results in R\n/week — your week · /streak — your streaks\n/levels BTC — price, RSI and trend · /calc — position size\n/assets btc eth — only signals for those assets · /risk off — turn off the exposure warning\n/whatsapp on — button to pass each alert to WhatsApp\n/language es — switch to Spanish\n/unlink — disconnect this chat\n\n" +
      "Example:\n<code>BTCUSDT LONG\nEntry: 65000\nTP: 66500\nSL: 64500</code>",
    notLinked:
      "This chat isn't connected to a VELTRIX account yet.\n\nOpen the app or the web → “Connect Telegram” and tap the button: it brings you back here already linked.",
    badCode: "That code isn't valid or has expired. Go back to the app or the web and tap “Connect Telegram” again.",
    linked: "✅ <b>Telegram connected</b>. You can now paste signals here, and I'll notify you when an alert arrives or a TP/SL is hit.",
    unlinked: "Done, I disconnected this chat from your account. You can reconnect anytime from the app.",
    waOn: "📲 Done: every alert now has a «Send to WhatsApp» button. Tap it and WhatsApp opens with the message ready so you pick who gets it.",
    waOff: "Done, I removed the WhatsApp button from alerts.",
    waUsage: "Use /whatsapp on or /whatsapp off.",
    langSet: "Language changed to English 🇬🇧",
    langUsage: "Use /language en or /language es.",
    understood: (n: number) => (n === 1 ? "I understood this signal:" : `I understood ${n} signals:`),
    register: (n: number) => (n === 1 ? "✅ Log it" : `✅ Log ${n}`),
    cancel: "✖ Cancel",
    canceled: "Canceled. I didn't log anything.",
    expired: "That signal is no longer pending (it expired or was already handled). Paste it again.",
    registered: (n: number, dup: number) =>
      `✅ ${n === 1 ? "Signal logged" : `${n} signals logged`} in your journal.${dup ? ` (${dup} already existed)` : ""}`,
    tooMany: "Too many signals in the last minute. Wait a moment and try again.",
    noSignal: "I couldn't find a signal in that message.",
    tip: "Try asset, direction, entry, TP and SL, for example:\n<code>BTCUSDT LONG\nEntry: 65000\nTP: 66500\nSL: 64500</code>",
    noOpen: "You have no open signals.",
    openTitle: "<b>Open signals</b>",
    summaryTitle: "<b>Your results</b>",
    last24: "Last 24 h",
    last7: "7 days",
    last30: "30 days",
    ops: "trades",
    win: "win rate",
    noClosed: "You have no closed trades in the last 30 days yet.",
    buy: "BUY",
    sell: "SELL",
    entry: "Entry",
    groupsHint: "Message me in private 🙂",
    adminOnly: "😊 That command is for setting up the bot and is used by the group admins. You can ask me for a chart any time: <code>/chart BTC 4h</code>",
    communityBad: "That code isn't valid or has expired. Generate a new one in the app or the web, under “Telegram bot → Connect community”.",
    communityLinked: "✅ Community connected. I'll post here the signals and results (TP/SL) of the VELTRIX account that connected it.\n\nTo stop posting: /disconnectcommunity",
    communityRemoved: "Done, I stopped posting in this chat.",
    newsOn: "📰 Done: in this topic I'll post the <b>economic calendar</b>: the day's summary at 8:00 and a heads-up 30 minutes before each high-impact release.\n\nTo stop: /news off",
    newsOff: "Done, I stopped posting the economic calendar in this chat.",
    newsNoCommunity: "First connect this group to your VELTRIX account with /community (from the app or the web, “Connect Telegram”). Then type /news in the news topic.",
  },
} as const;

// ─── Utilidades ─────────────────────────────────────────────────────────────

const guessLang = (code: unknown): Lang => (String(code ?? "").toLowerCase().startsWith("es") ? "es" : "en");
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const num = (v: unknown) => Number(v);

interface Link {
  user_id: string;
  chat_id: number;
}

const linkFor = async (chatId: number): Promise<Link | null> => {
  const { data } = await admin.from("telegram_links").select("user_id, chat_id").eq("chat_id", chatId).maybeSingle();
  return (data as Link | null) ?? null;
};

const langOf = async (userId: string, fallback: Lang): Promise<Lang> => {
  const { data } = await admin.from("profiles").select("lang").eq("id", userId).maybeSingle();
  const l = (data as { lang?: string } | null)?.lang;
  return l === "en" || l === "es" ? l : fallback;
};

const say = (chatId: number, html: string, extra: Record<string, unknown> = {}) => {
  const token = botToken();
  return token ? sendMessage(token, chatId, html, extra) : Promise.resolve();
};

let cachedUsername: string | null = null;
async function botUsername(token: string): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  const r = await tgApi(token, "getMe");
  cachedUsername = r?.ok ? (r.result?.username ?? null) : null;
  return cachedUsername;
}

/** R de una operación cerrada, igual que en la app. */
function resultR(t: { direction: string; entry: number; tp: number; sl: number; outcome: string; exit: number | null }) {
  const risk = Math.abs(num(t.entry) - num(t.sl));
  if (risk <= 0) return 0;
  const dir = t.direction === "LONG" ? 1 : -1;
  if (t.outcome === "TP") return (dir * (num(t.tp) - num(t.entry))) / risk;
  if (t.outcome === "SL") return -1;
  return (dir * ((t.exit == null ? num(t.entry) : num(t.exit)) - num(t.entry))) / risk;
}

const sideWord = (lang: Lang, direction: string) => (direction === "LONG" ? T[lang].buy : T[lang].sell);
const arrow = (direction: string) => (direction === "LONG" ? "▲" : "▼");

// ─── Vinculación ────────────────────────────────────────────────────────────

async function linkAccount(chatId: number, from: any, rawCode: string, fallback: Lang) {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const { data: row } = await admin.from("telegram_link_codes").select("code, user_id, expires_at, kind").eq("code", code).maybeSingle();
  if (!row || (row.kind ?? "private") !== "private" || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) await admin.from("telegram_link_codes").delete().eq("code", code);
    return say(chatId, T[fallback].badCode);
  }
  await admin.from("telegram_links").delete().eq("chat_id", chatId); // un chat, una cuenta
  await admin.from("telegram_links").upsert(
    { user_id: row.user_id, chat_id: chatId, username: from?.username ?? null, linked_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  await admin.from("telegram_link_codes").delete().eq("code", code);
  const lang = await langOf(row.user_id, fallback);
  return say(chatId, `${T[lang].linked}\n\n${T[lang].help}`);
}

// ─── Señales pegadas ────────────────────────────────────────────────────────

async function handleSignal(chatId: number, link: Link, lang: Lang, text: string) {
  const parsed = parseAlerts(text.slice(0, 4000));
  if (!parsed.valid.length) {
    const why = parsed.errors.slice(0, 3).map((e) => `• ${esc(e)}`).join("\n");
    return say(chatId, `${T[lang].noSignal}\n${why}\n\n${T[lang].tip}`);
  }
  const trades = parsed.valid.slice(0, 10);
  await admin.from("telegram_pending").delete().lt("created_at", iso(60 * 60_000)); // limpieza de pendientes viejos
  const { data: pending } = await admin.from("telegram_pending").insert({ user_id: link.user_id, chat_id: chatId, trades }).select("id").single();
  if (!pending) return;
  const lines = trades.map((t) => {
    const rr = Math.abs(t.entry - t.sl) > 0 ? Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl) : 0;
    const tps = t.targets?.length ? [...t.targets, t.tp].join(" / ") : t.tp;
    return `${arrow(t.direction)} <b>${esc(t.symbol)}</b> ${sideWord(lang, t.direction)} · ${T[lang].entry} ${t.entry} · TP ${tps} · SL ${t.sl} · R:R 1:${rr.toFixed(1)}`;
  });
  return say(chatId, `${T[lang].understood(trades.length)}\n\n${lines.join("\n")}`, {
    reply_markup: { inline_keyboard: [[{ text: T[lang].register(trades.length), callback_data: `ok:${pending.id}` }, { text: T[lang].cancel, callback_data: `no:${pending.id}` }]] },
  });
}

/** 👍/👎 de una señal publicada en un grupo: lo puede votar cualquier miembro. Repetir el mismo voto lo quita. */
async function handleVote(cb: any, vote: { kind: "u" | "d"; tradeId: string }) {
  const token = botToken();
  if (!token) return;
  const chatId: number | undefined = cb.message?.chat?.id;
  const messageId: number | undefined = cb.message?.message_id;
  const { data: com } = chatId ? await admin.from("telegram_communities").select("user_id").eq("chat_id", chatId).limit(1).maybeSingle() : { data: null };
  const lang = com ? await langOf((com as { user_id: string }).user_id, guessLang(cb.from?.language_code)) : guessLang(cb.from?.language_code);
  const counts = com && cb.from?.id ? await castVote(admin, vote.tradeId, Number(cb.from.id), vote.kind) : null;
  await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id, ...(counts ? { text: lang === "es" ? "¡Voto registrado!" : "Vote saved!" } : {}) });
  if (counts && chatId && messageId) await tgApi(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: voteKeyboard(vote.tradeId, counts, lang) });
}

async function handleCallback(cb: any) {
  const token = botToken();
  if (!token) return;
  const vote = parseVote(String(cb.data ?? ""));
  if (vote) return handleVote(cb, vote);
  await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id });
  const chatId: number | undefined = cb.message?.chat?.id;
  const messageId: number | undefined = cb.message?.message_id;
  if (!chatId || !messageId) return;
  const link = await linkFor(chatId);
  if (!link) return;
  const lang = await langOf(link.user_id, guessLang(cb.from?.language_code));
  const [action, id] = String(cb.data ?? "").split(":");
  const edit = (html: string) => tgApi(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML" });

  const { data: pending } = await admin.from("telegram_pending").select("id, user_id, trades").eq("id", id).maybeSingle();
  if (!pending || pending.user_id !== link.user_id) return edit(T[lang].expired);
  // Se consume antes de usarla: si Telegram repite el toque, no se registra dos veces.
  const { data: taken } = await admin.from("telegram_pending").delete().eq("id", id).select("id");
  if (!taken?.length) return;
  if (action !== "ok") return edit(T[lang].canceled);

  const { count } = await admin.from("trades").select("id", { count: "exact", head: true }).eq("user_id", link.user_id).gte("created_at", iso(60_000));
  if ((count ?? 0) >= MAX_PER_MINUTE) return edit(T[lang].tooMany);

  let saved = 0, dup = 0;
  for (const t of pending.trades as Array<{ symbol: string; direction: string; entry: number; tp: number; sl: number; targets?: number[] }>) {
    const { data: same } = await admin
      .from("trades").select("id").eq("user_id", link.user_id).eq("symbol", t.symbol).eq("direction", t.direction).eq("entry", t.entry).gte("created_at", iso(60_000)).limit(1);
    if (same?.length) { dup++; continue; }
    const row = { user_id: link.user_id, symbol: t.symbol, direction: t.direction, entry: t.entry, tp: t.tp, sl: t.sl, date: new Date().toISOString() };
    let { data: made, error } = await admin.from("trades").insert(t.targets?.length ? { ...row, targets: t.targets } : row).select("id");
    // Si todavía no se corrió el SQL de los targets, se guarda igual (solo con el TP final).
    if (error && t.targets?.length) ({ data: made, error } = await admin.from("trades").insert(row).select("id"));
    if (!error) {
      saved++;
      await runInBackground(publishToCommunities(admin, token, link.user_id, (l) => communitySignalMessage(t, l), (l) => signalCardImage(t, l), (made as Array<{ id: string }> | null)?.[0]?.id));
    }
  }
  await edit(T[lang].registered(saved, dup));
  if (saved) await runInBackground(sendExposureNotice(admin, link.user_id));
}

// ─── Comandos ───────────────────────────────────────────────────────────────

async function listOpen(chatId: number, link: Link, lang: Lang) {
  const { data } = await admin
    .from("trades").select("symbol, direction, entry, tp, sl").eq("user_id", link.user_id).eq("outcome", "ABIERTA").order("date", { ascending: false }).limit(10);
  if (!data?.length) return say(chatId, T[lang].noOpen);
  const lines = data.map((t: any) => `${arrow(t.direction)} <b>${esc(t.symbol)}</b> ${sideWord(lang, t.direction)} · ${num(t.entry)} → TP ${num(t.tp)} · SL ${num(t.sl)}`);
  return say(chatId, `${T[lang].openTitle}\n\n${lines.join("\n")}`);
}

async function summary(chatId: number, link: Link, lang: Lang) {
  const { data } = await admin
    .from("trades").select("direction, entry, tp, sl, outcome, exit, closed_at").eq("user_id", link.user_id).neq("outcome", "ABIERTA").gte("closed_at", iso(30 * 86_400_000));
  if (!data?.length) return say(chatId, T[lang].noClosed);
  const { data: prof } = await admin.from("profiles").select("capital, risk_pct, currency").eq("id", link.user_id).maybeSingle();
  const unit = prof && num(prof.capital) > 0 && num(prof.risk_pct) > 0 ? (num(prof.capital) * num(prof.risk_pct)) / 100 : null;
  const rows = data.map((t: any) => ({ r: resultR(t), at: new Date(t.closed_at).getTime() }));
  const block = (label: string, ms: number) => {
    const sel = rows.filter((x) => x.at >= Date.now() - ms);
    const net = sel.reduce((a, x) => a + x.r, 0);
    const wins = sel.filter((x) => x.r > 0).length;
    const extra = unit ? ` (${money(net * unit, prof?.currency ?? "USD")})` : "";
    return `<b>${label}:</b> ${sel.length ? `${tgR(net)}${extra} · ${sel.length} ${T[lang].ops} · ${Math.round((wins / sel.length) * 100)}% ${T[lang].win}` : "—"}`;
  };
  return say(chatId, [T[lang].summaryTitle, "", block(T[lang].last24, 86_400_000), block(T[lang].last7, 7 * 86_400_000), block(T[lang].last30, 30 * 86_400_000)].join("\n"));
}

/** Conecta (o desconecta) un grupo o canal para que el bot publique ahí las señales y resultados de una cuenta. */
async function communityCommand(msg: any, cmd: string, rawCode: string | undefined) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  if (!token) return;
  const fallback = guessLang(msg.from?.language_code);
  // En un grupo con temas, las respuestas y las publicaciones van al tema donde se escribió el comando.
  const thread: number | null = msg.is_topic_message && msg.message_thread_id ? Number(msg.message_thread_id) : null;
  const reply = (html: string) => say(chatId, html, thread ? { message_thread_id: thread } : {});
  // En grupos, solo un administrador de Telegram puede conectar. En canales solo publican administradores.
  if (msg.chat.type !== "channel") {
    if (!(await isAdminOf(token, msg))) return reply(T[fallback].adminOnly);
  }
  if (cmd === "/desconectarcomunidad" || cmd === "/disconnectcommunity") {
    await admin.from("telegram_communities").delete().eq("chat_id", chatId);
    return reply(T[fallback].communityRemoved);
  }
  const code = String(rawCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const { data: row } = await admin.from("telegram_link_codes").select("code, user_id, expires_at, kind").eq("code", code).maybeSingle();
  if (!row || row.kind !== "community" || new Date(row.expires_at).getTime() < Date.now()) {
    if (row && row.kind === "community") await admin.from("telegram_link_codes").delete().eq("code", code);
    return reply(T[fallback].communityBad);
  }
  await admin.from("telegram_communities").delete().eq("chat_id", chatId); // un chat, una cuenta
  await admin.from("telegram_communities").insert({ user_id: row.user_id, chat_id: chatId, title: msg.chat.title ?? null, thread_id: thread });
  await admin.from("telegram_link_codes").delete().eq("code", code);
  const lang = await langOf(row.user_id, fallback);
  return reply(T[lang].communityLinked);
}

/**
 * /noticias (dentro del tema de noticias del grupo) → el bot publica ahí la agenda económica. /noticias off la apaga.
 * Solo administradores, y solo en un grupo ya conectado a una cuenta (con /comunidad).
 */
async function newsCommand(msg: any, arg: string | undefined) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  if (!token) return;
  const fallback = guessLang(msg.from?.language_code);
  const thread: number | null = msg.is_topic_message && msg.message_thread_id ? Number(msg.message_thread_id) : null;
  const reply = (html: string) => say(chatId, html, thread ? { message_thread_id: thread } : {});
  if (msg.chat.type !== "channel") {
    if (!(await isAdminOf(token, msg))) return reply(T[fallback].adminOnly);
  }
  const { data: row } = await admin.from("telegram_communities").select("id,user_id").eq("chat_id", chatId).limit(1).maybeSingle();
  if (!row) return reply(T[fallback].newsNoCommunity);
  const lang = await langOf((row as { user_id: string }).user_id, fallback);
  const off = ["off", "no", "apagar", "desactivar", "stop"].includes(String(arg ?? "").toLowerCase());
  const { error } = await admin
    .from("telegram_communities")
    .update(off ? { news_enabled: false, news_thread_id: null } : { news_enabled: true, news_thread_id: thread })
    .eq("id", (row as { id: string }).id);
  if (error) return reply(lang === "es" ? "Todavía falta correr el SQL de la agenda económica en Supabase." : "The economic calendar SQL has not been run in Supabase yet.");
  return reply(off ? T[lang].newsOff : T[lang].newsOn);
}

/** ¿Quien escribió es administrador? También cuenta quien escribe «como el grupo» (administrador anónimo). */
const isAdminOf = async (token: string, msg: any) => {
  if (msg.sender_chat && msg.sender_chat.id === msg.chat.id) return true;
  const r = await tgApi(token, "getChatMember", { chat_id: msg.chat.id, user_id: msg.from?.id });
  return r?.result?.status === "creator" || r?.result?.status === "administrator";
};

/** Manda el saludo al tema de bienvenidos (borrando el anterior para no llenarlo) y lo deja anotado. */
async function sendWelcome(row: any, chatId: number, chatTitle: string | null, members: Array<{ id: number; first_name?: string; username?: string }>) {
  const token = botToken();
  if (!token || !members.length) return;
  const lang = await langOf(row.user_id, "es");
  const thread = row.welcome_thread_id ? { message_thread_id: Number(row.welcome_thread_id) } : {};
  for (const id of String(row.welcome_last_ids ?? "").split(",").filter(Boolean)) await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: Number(id) });
  const ids: number[] = [];
  const src = row.welcome_src_msg ? Number(row.welcome_src_msg) : null;
  const first = await say(chatId, src ? welcomeHello(members, lang) : welcomeGreeting(members, chatTitle, row.welcome_text, lang), thread);
  if (first?.result?.message_id) ids.push(first.result.message_id);
  if (src) {
    const c = await tgApi(token, "copyMessage", { chat_id: chatId, from_chat_id: chatId, message_id: src, ...thread });
    if (c?.result?.message_id) ids.push(c.result.message_id);
  }
  await admin.from("telegram_communities").update({ welcome_last_ids: ids.join(",") }).eq("id", row.id);
}

/** Alguien entró al grupo: si la bienvenida está activada, se lo saluda en el tema elegido. */
async function welcomeJoin(msg: any) {
  const members = (msg.new_chat_members as any[]).filter((m) => !m.is_bot);
  if (!members.length) return;
  const { data: row, error } = await admin.from("telegram_communities").select("*").eq("chat_id", msg.chat.id).limit(1).maybeSingle();
  if (error || !row || !(row as any).welcome_enabled) return;
  await sendWelcome(row, msg.chat.id, msg.chat.title ?? null, members);
}

/**
 * /bienvenida (dentro del tema de bienvenidos, solo administradores, grupo ya conectado con /comunidad):
 *  • respondiendo a un mensaje → el bot copia ESE mensaje (con formato) a cada persona nueva;
 *  • /bienvenida texto con {nombre} → usa ese texto;  • solo /bienvenida → saludo por defecto;
 *  • /bienvenida probar → lo muestra ahora con tu nombre;  • /bienvenida off → lo apaga.
 */
async function welcomeCommand(msg: any, text: string) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  if (!token) return;
  const fallback = guessLang(msg.from?.language_code);
  const thread: number | null = msg.is_topic_message && msg.message_thread_id ? Number(msg.message_thread_id) : null;
  const reply = (html: string) => say(chatId, html, thread ? { message_thread_id: thread } : {});
  if (!(await isAdminOf(token, msg))) return reply(T[fallback].adminOnly);
  const { data: row } = await admin.from("telegram_communities").select("*").eq("chat_id", chatId).limit(1).maybeSingle();
  if (!row) return reply(T[fallback].newsNoCommunity);
  const lang = await langOf((row as any).user_id, fallback);
  const es = lang === "es";
  const arg = text.replace(/^\/\S+\s*/, "").trim();
  const word = arg.toLowerCase();
  if (["off", "no", "apagar", "desactivar"].includes(word)) {
    await admin.from("telegram_communities").update({ welcome_enabled: false }).eq("id", (row as any).id);
    return reply(es ? "👋 Bienvenida apagada." : "👋 Welcome message turned off.");
  }
  if (["probar", "test"].includes(word)) {
    if (!(row as any).welcome_enabled) return reply(es ? "Primero activala con /bienvenida." : "Turn it on first with /welcome.");
    return sendWelcome({ ...(row as any), welcome_thread_id: thread ?? (row as any).welcome_thread_id }, chatId, msg.chat.title ?? null, [{ id: msg.from.id, first_name: msg.from.first_name }]);
  }
  const replied = msg.reply_to_message && !msg.reply_to_message.forum_topic_created ? msg.reply_to_message : null;
  const patch = { welcome_enabled: true, welcome_thread_id: thread, welcome_src_msg: replied ? replied.message_id : null, welcome_text: !replied && arg ? arg : null, welcome_last_ids: null };
  const { error } = await admin.from("telegram_communities").update(patch).eq("id", (row as any).id);
  if (error) return reply(es ? "Todavía falta correr el SQL de la bienvenida en Supabase." : "The welcome SQL has not been run in Supabase yet.");
  return reply(
    es
      ? `👋 Listo: voy a saludar en este tema a quien entre al grupo${replied ? " copiando el mensaje al que respondiste" : arg ? " con tu texto" : " con el saludo por defecto"}.\n\nPara cambiarlo: respondé a un mensaje con /bienvenida, o escribí /bienvenida seguido del texto (con {nombre}).\nPara verlo ahora: /bienvenida probar · Para apagarlo: /bienvenida off\n\nSi usás otro bot de bienvenida (como Rose), apagá el suyo para que no saluden dos veces.`
      : `👋 Done: I'll greet new members in this topic${replied ? " by copying the message you replied to" : arg ? " with your text" : " with the default greeting"}.\n\nTo change it: reply to a message with /welcome, or type /welcome followed by the text (use {name}).\nTo preview: /welcome test · To turn off: /welcome off\n\nIf you use another welcome bot (like Rose), turn its welcome off so people aren't greeted twice.`,
  );
}

const chartLast = new Map<number, number>();

/**
 * /grafico BTCUSDT 4h [ema] (también /chart y /gr) → manda una imagen con las velas. Funciona en el chat privado de quien tiene
 * la cuenta vinculada y en las comunidades conectadas con /comunidad (ahí lo puede usar cualquiera, en el mismo tema).
 */
async function chartCommand(msg: any, args: string[], lang: Lang) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  if (!token) return;
  const extra = msg.is_topic_message && msg.message_thread_id ? { message_thread_id: Number(msg.message_thread_id) } : {};
  const es = lang === "es";
  const req = parseChartArgs(args);
  if (!req) {
    return say(chatId, es
      ? "Usá <code>/grafico</code> seguido de la moneda y el intervalo.\n\nEjemplos:\n<code>/grafico BTCUSDT 4h</code>\n<code>/grafico ETH 1d ema</code>\n<code>/grafico BTC 4h liq</code>\n\nIntervalos: 1m 5m 15m 30m 1h 4h 1d 1w"
      : "Use <code>/chart</code> followed by the coin and interval.\n\nExamples:\n<code>/chart BTCUSDT 4h</code>\n<code>/chart ETH 1d ema</code>\n<code>/chart BTC 4h liq</code>\n\nIntervals: 1m 5m 15m 30m 1h 4h 1d 1w", extra);
  }
  const now = Date.now();
  if (now - (chartLast.get(chatId) ?? 0) < 8000) return;
  chartLast.set(chatId, now);
  const run = async () => {
    const res = await chartImage(req, lang);
    if (res === "notfound") return say(chatId, es ? `No encontré <b>${esc(req.symbol)}</b> en Binance. Probá con otra moneda, por ejemplo <code>/grafico BTCUSDT 4h</code>.` : `I couldn't find <b>${esc(req.symbol)}</b> on Binance. Try another coin, e.g. <code>/chart BTCUSDT 4h</code>.`, extra);
    if (!res) return say(chatId, es ? "No pude dibujar el gráfico ahora. Probá de nuevo en un momento." : "I couldn't draw the chart right now. Try again in a moment.", extra);
    await sendPhoto(token, chatId, res.png, res.caption, extra as Record<string, number>);
  };
  await runInBackground(run());
}

const priceLast = new Map<number, number>();

/** /precio [monedas]: lo puede pedir cualquiera del grupo (solo en comunidades conectadas), con un respiro de 5 s por chat. */
async function priceCommand(msg: any, args: string[], lang: Lang) {
  const chatId: number = msg.chat.id;
  const extra = msg.is_topic_message && msg.message_thread_id ? { message_thread_id: Number(msg.message_thread_id) } : {};
  const now = Date.now();
  if (now - (priceLast.get(chatId) ?? 0) < 5000) return;
  priceLast.set(chatId, now);
  const run = async () => {
    const quotes = await fetchQuotes(parseQuoteArgs(args));
    if (!quotes.length) return say(chatId, lang === "es" ? "No encontré esa moneda en Binance. Probá con <code>/precio BTC ETH</code>." : "I couldn't find that coin on Binance. Try <code>/price BTC ETH</code>.", extra);
    await say(chatId, quoteMessage(quotes, lang), extra);
  };
  await runInBackground(run());
}

// ─── Herramientas para la comunidad ─────────────────────────────────────────

const toolLast = new Map<string, number>();
/** true = hay que ignorar el pedido (muy seguido en el mismo chat). */
const tooSoon = (chatId: number, cmd: string, ms = 4000) => {
  const k = `${chatId}:${cmd}`;
  const now = Date.now();
  if (now - (toolLast.get(k) ?? 0) < ms) return true;
  toolLast.set(k, now);
  return false;
};
const threadOf = (msg: any): Record<string, number> => (msg.is_topic_message && msg.message_thread_id ? { message_thread_id: Number(msg.message_thread_id) } : {});

/** /calc entrada stop [capital] [riesgo%] [tp]: tamaño de la posición. En privado usa el capital y el riesgo del perfil. */
async function calcCommand(msg: any, args: string[], lang: Lang, userId: string | null) {
  const chatId: number = msg.chat.id;
  let defaults: { capital?: number | null; riskPct?: number | null } = {};
  if (userId) {
    const { data: prof } = await admin.from("profiles").select("capital,risk_pct").eq("id", userId).maybeSingle();
    defaults = { capital: prof ? num(prof.capital) : null, riskPct: prof ? num(prof.risk_pct) : null };
  }
  const input = parseCalcArgs(args, defaults);
  if (!input) return say(chatId, calcUsage(lang), threadOf(msg));
  if (tooSoon(chatId, "calc", 2000)) return; // el respiro solo corre para cálculos hechos: así se puede corregir un dato enseguida
  return say(chatId, calcMessage(input, lang), threadOf(msg));
}

/** /niveles BTC: precio, RSI 1h/4h, tendencia y las señales abiertas de la cuenta de ese activo. */
async function levelsCommand(msg: any, args: string[], lang: Lang, userId: string) {
  const chatId: number = msg.chat.id;
  const extra = threadOf(msg);
  const es = lang === "es";
  const symbol = normalizeSymbol(args[0] ?? "");
  if (!symbol) return say(chatId, es ? "Usá <code>/niveles BTC</code> (o ETH, SOL, XAU…)." : "Use <code>/levels BTC</code> (or ETH, SOL, XAU…).", extra);
  if (tooSoon(chatId, "levels", 5000)) return;
  const run = async () => {
    const { data } = await admin.from("trades").select("symbol,direction,entry,tp,sl,notes,source").eq("user_id", userId).eq("outcome", "ABIERTA").limit(200);
    const base = (x: string) => x.toUpperCase().replace(/\.P$|PERP$/, "").replace(/(USDC|USD)$/, "USDT");
    const open = ((data ?? []) as Array<{ symbol: string; direction: string; entry: number; tp: number; sl: number; notes?: string | null; source?: string | null }>)
      .filter((t) => base(t.symbol) === symbol && t.source !== "bot" && !/^Señal de prueba de VELTRIX|^Señal publicada solo para/.test(t.notes ?? ""))
      .map((t) => ({ direction: t.direction, entry: num(t.entry), tp: num(t.tp), sl: num(t.sl) }));
    const d = await fetchLevels(symbol, open);
    if (!d) return say(chatId, es ? `No encontré <b>${esc(symbol)}</b> en Binance.` : `I couldn't find <b>${esc(symbol)}</b> on Binance.`, extra);
    await say(chatId, levelsMessage(d, lang), extra);
  };
  await runInBackground(run());
}

/** /semana: en un grupo, el ranking de la semana de la cuenta conectada; en privado, el de la propia persona. */
async function weekCommand(msg: any, lang: Lang, userId: string) {
  const chatId: number = msg.chat.id;
  if (tooSoon(chatId, "week", 5000)) return;
  const now = Date.now();
  const trades = await communityTrades(admin, userId, now - WEEK_MS);
  return say(chatId, weeklyMessage(weeklyRanking(trades, now - WEEK_MS, now + 1), lang), threadOf(msg));
}

/** /racha: ganadoras o perdedoras seguidas, y la mejor racha. */
async function streakCommand(chatId: number, link: Link, lang: Lang) {
  const { data } = await admin.from("trades").select("direction,entry,tp,sl,date,outcome,exit,closed_at").eq("user_id", link.user_id).neq("outcome", "ABIERTA").order("closed_at", { ascending: false }).limit(500);
  const rows = ((data ?? []) as Array<Record<string, any>>).map((t) => ({ ...t, entry: num(t.entry), tp: num(t.tp), sl: num(t.sl), exit: t.exit == null ? null : num(t.exit) }));
  return say(chatId, streakMessage(streaks(rows as any), lang));
}

/** /activos btc eth xau: solo recibís las señales de VELTRIX de esos activos. /activos todos: vuelve a recibir todas. */
async function assetsCommand(chatId: number, link: Link, lang: Lang, args: string[]) {
  const es = lang === "es";
  const word = (args[0] ?? "").toLowerCase();
  if (!args.length) {
    const { data, error } = await admin.from("profiles").select("signal_symbols").eq("id", link.user_id).maybeSingle();
    if (error) return say(chatId, es ? "Todavía falta correr el SQL de esta función en Supabase." : "The SQL for this feature has not been run in Supabase yet.");
    const cur = String((data as { signal_symbols?: string | null } | null)?.signal_symbols ?? "").split(",").filter(Boolean);
    return say(chatId, es
      ? `${cur.length ? `Recibís señales de: <b>${esc(cur.map((x) => x.replace(/USDT$/, "")).join(", "))}</b>.` : "Recibís las señales de <b>todos</b> los activos."}\n\nPara elegir: <code>/activos btc eth xau</code>\nPara recibir todas: <code>/activos todos</code>`
      : `${cur.length ? `You get signals for: <b>${esc(cur.map((x) => x.replace(/USDT$/, "")).join(", "))}</b>.` : "You get signals for <b>all</b> assets."}\n\nTo choose: <code>/assets btc eth xau</code>\nTo get all: <code>/assets all</code>`);
  }
  const all = ["todos", "todas", "all", "off", "reset"].includes(word);
  const list = all ? [] : parseSymbolList(args.join(" "));
  if (!all && !list.length) return say(chatId, es ? "No entendí esos activos. Ejemplo: <code>/activos btc eth xau</code>" : "I didn't understand those assets. Example: <code>/assets btc eth xau</code>");
  const { error } = await admin.from("profiles").update({ signal_symbols: list.length ? list.join(",") : null }).eq("id", link.user_id);
  if (error) return say(chatId, es ? "Todavía falta correr el SQL de esta función en Supabase." : "The SQL for this feature has not been run in Supabase yet.");
  return say(chatId, all
    ? (es ? "✅ Listo: vas a recibir las señales de todos los activos." : "✅ Done: you'll get signals for all assets.")
    : (es ? `✅ Listo: solo vas a recibir las señales de <b>${esc(list.map((x) => x.replace(/USDT$/, "")).join(", "))}</b>.` : `✅ Done: you'll only get signals for <b>${esc(list.map((x) => x.replace(/USDT$/, "")).join(", "))}</b>.`));
}

/** /riesgo on|off: aviso cuando hay demasiadas operaciones abiertas. */
async function riskCommand(chatId: number, link: Link, lang: Lang, args: string[]) {
  const es = lang === "es";
  const want = (args[0] ?? "").toLowerCase();
  const on = ["on", "si", "sí", "activar", "yes"].includes(want);
  if (!on && !["off", "no", "desactivar"].includes(want)) return say(chatId, es ? "Usá /riesgo on o /riesgo off." : "Use /risk on or /risk off.");
  const { error } = await admin.from("profiles").update({ risk_reminder: on }).eq("id", link.user_id);
  if (error) return say(chatId, es ? "Todavía falta correr el SQL de esta función en Supabase." : "The SQL for this feature has not been run in Supabase yet.");
  return say(chatId, on ? (es ? "🛡️ Listo: te aviso si juntás demasiadas operaciones abiertas." : "🛡️ Done: I'll warn you if you pile up too many open trades.") : (es ? "Listo, apagué el aviso de exposición." : "Done, I turned the exposure warning off."));
}

// ─── Herramientas dentro de los grupos ──────────────────────────────────────

const groupOwnerOf = async (chatId: number): Promise<string | null> => {
  const { data } = await admin.from("telegram_communities").select("user_id").eq("chat_id", chatId).limit(1).maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
};

/** /miinvitacion: el enlace de invitación propio de quien lo pide (se crea una vez). Cada persona que entre con él se cuenta. */
async function myInviteCommand(msg: any) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  const owner = await groupOwnerOf(chatId);
  if (!token || !owner || !msg.from?.id || msg.from.is_bot) return;
  const lang = await langOf(owner, guessLang(msg.from?.language_code));
  const es = lang === "es";
  const extra = threadOf(msg);
  const inv = await myInvite(admin, token, chatId, msg.from);
  if (!inv) return say(chatId, es ? "No pude crear tu enlace. Avisale a un administrador que me dé el permiso «Invitar con un enlace» (y que corra el SQL de grupos)." : "I couldn't create your link. Ask an admin to give me the “Invite with a link” permission (and run the groups SQL).", extra);
  return say(chatId, es
    ? `🔗 <b>Tu enlace de invitación</b>\n\n${esc(inv.link)}\n\nCada persona que entre con él se cuenta para vos. Lo ves con /misinvitados.`
    : `🔗 <b>Your invite link</b>\n\n${esc(inv.link)}\n\nEveryone who joins with it counts for you. Check it with /myinvites.`, extra);
}

/** /misinvitados: cuántas personas entraron con tu enlace. */
async function myInvitesCommand(msg: any) {
  const chatId: number = msg.chat.id;
  const owner = await groupOwnerOf(chatId);
  if (!owner || !msg.from?.id) return;
  const lang = await langOf(owner, guessLang(msg.from?.language_code));
  const { data } = await admin.from("group_invites").select("joins").eq("chat_id", chatId).eq("tg_user_id", msg.from.id).maybeSingle();
  const n = Number((data as { joins?: number } | null)?.joins ?? 0);
  const es = lang === "es";
  if (!data) return say(chatId, es ? "Todavía no tenés enlace. Pedilo con /miinvitacion." : "You don't have a link yet. Get it with /myinvite.", threadOf(msg));
  return say(chatId, es ? `👥 Entraron <b>${n}</b> ${n === 1 ? "persona" : "personas"} con tu enlace.` : `👥 <b>${n}</b> ${n === 1 ? "person" : "people"} joined with your link.`, threadOf(msg));
}

/** /fijar (respondiendo a un mensaje): lo fija. Solo administradores. */
async function pinCommand(msg: any) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  if (!token || !(await groupOwnerOf(chatId))) return;
  const lang = guessLang(msg.from?.language_code);
  const es = lang === "es";
  const extra = threadOf(msg);
  if (!(await isAdminOf(token, msg))) return say(chatId, T[lang].adminOnly, extra);
  const target = msg.reply_to_message && !msg.reply_to_message.forum_topic_created ? msg.reply_to_message.message_id : null;
  if (!target) return say(chatId, es ? "Respondé al mensaje que querés fijar con /fijar." : "Reply to the message you want to pin with /pin.", extra);
  const ok = await pinReplace(token, chatId, target, null);
  if (!ok) return say(chatId, es ? "No pude fijarlo: necesito el permiso «Fijar mensajes»." : "I couldn't pin it: I need the “Pin messages” permission.", extra);
}

/** /antispam on|off: borra los enlaces que publican los recién llegados (primeras 24 h). Solo administradores. */
async function antispamCommand(msg: any, arg: string | undefined) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  const owner = await groupOwnerOf(chatId);
  if (!token || !owner) return;
  const lang = await langOf(owner, guessLang(msg.from?.language_code));
  const es = lang === "es";
  const extra = threadOf(msg);
  if (!(await isAdminOf(token, msg))) return say(chatId, T[lang].adminOnly, extra);
  const word = String(arg ?? "").toLowerCase();
  const on = ["on", "si", "sí", "activar", "yes"].includes(word);
  if (!on && !["off", "no", "desactivar"].includes(word)) return say(chatId, es ? "Usá /antispam on o /antispam off." : "Use /antispam on or /antispam off.", extra);
  const { error } = await admin.from("telegram_communities").update({ antispam: on }).eq("chat_id", chatId);
  if (error) return say(chatId, es ? "Todavía falta correr el SQL de grupos en Supabase." : "The groups SQL has not been run in Supabase yet.", extra);
  return say(chatId, on
    ? (es ? "🛡️ Listo: voy a borrar los enlaces que publiquen las personas que entraron hace menos de 24 horas (necesito el permiso «Eliminar mensajes»). Los administradores no se ven afectados. Para apagarlo: /antispam off" : "🛡️ Done: I'll delete links posted by people who joined less than 24 hours ago (I need the “Delete messages” permission). Admins aren't affected. To turn it off: /antispam off")
    : (es ? "Listo, apagué el filtro de enlaces de recién llegados." : "Done, I turned off the new-member link filter."), extra);
}

/** Borra el mensaje si trae un enlace, el filtro está encendido, quien lo publica entró hace menos de 24 h y no es administrador. */
async function antispamCheck(msg: any) {
  const token = botToken();
  if (!token || !msg.from?.id || msg.from.is_bot || !hasLink(msg)) return;
  const chatId: number = msg.chat.id;
  const { data: com, error } = await admin.from("telegram_communities").select("antispam").eq("chat_id", chatId).limit(1).maybeSingle();
  if (error || !(com as { antispam?: boolean } | null)?.antispam) return;
  if (!(await isNewMember(admin, chatId, msg.from.id))) return;
  if (await isAdminOf(token, msg)) return;
  await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
}

/** Alguien entró (o salió) del grupo: se anota quién entró y con el enlace de quién, para contar las invitaciones. */
async function handleChatMember(cm: any) {
  const chatId: number | undefined = cm?.chat?.id;
  const user = cm?.new_chat_member?.user;
  if (!chatId || !user || user.is_bot) return;
  const before = cm.old_chat_member?.status;
  const after = cm.new_chat_member?.status;
  const joined = (!before || before === "left" || before === "kicked") && (after === "member" || after === "restricted");
  if (!joined) return;
  if (!(await groupOwnerOf(chatId))) return;
  await recordJoin(admin, chatId, user.id, cm.invite_link?.invite_link ?? null);
}

/**
 * /webhook (chat privado, solo cuentas habilitadas): vuelve a registrar el webhook del bot con todos los tipos de aviso que usa
 * (incluye la entrada de miembros, que hace falta para contar las invitaciones). Se usa una vez después de actualizar.
 */
async function webhookCommand(chatId: number, link: Link, lang: Lang) {
  const es = lang === "es";
  const { data: prof, error } = await admin.from("profiles").select("bot_beta").eq("id", link.user_id).maybeSingle();
  if (error || !(prof as { bot_beta?: boolean } | null)?.bot_beta) return say(chatId, T[lang].help);
  const token = botToken();
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  const base = Deno.env.get("SUPABASE_URL");
  if (!token || !secret || !base) return say(chatId, es ? "Faltan secretos del bot en el servidor." : "The bot secrets are missing on the server.");
  const r = await tgApi(token, "setWebhook", { url: `${base}/functions/v1/telegram-bot`, secret_token: secret, allowed_updates: ["message", "callback_query", "channel_post", "chat_member", "my_chat_member"] });
  return say(chatId, r?.ok ? (es ? "✅ Webhook actualizado: ya recibo las entradas al grupo (para contar invitaciones)." : "✅ Webhook updated: I now receive group joins (to count invitations).") : `${es ? "No se pudo actualizar" : "Could not update"}: ${esc(r?.description ?? "error")}`);
}

async function handleMessage(msg: any) {
  if (msg.chat?.type !== "private") {
    if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length) {
      for (const m of msg.new_chat_members as Array<{ id: number; is_bot?: boolean }>) if (!m.is_bot) await recordJoin(admin, msg.chat.id, m.id, null);
      return welcomeJoin(msg);
    }
    const text = String(msg.text ?? "").trim();
    const [first, ...rest] = text.split(/\s+/);
    const cmd = first.startsWith("/") ? first.split("@")[0].toLowerCase() : null;
    if (!cmd) return antispamCheck(msg); // texto común o con foto: el filtro de enlaces de recién llegados (si está encendido)
    if (cmd === "/miinvitacion" || cmd === "/myinvite") return myInviteCommand(msg);
    if (cmd === "/misinvitados" || cmd === "/myinvites") return myInvitesCommand(msg);
    if (cmd === "/fijar" || cmd === "/pin") return pinCommand(msg);
    if (cmd === "/antispam") return antispamCommand(msg, rest[0]);
    if (cmd === "/comunidad" || cmd === "/community" || cmd === "/desconectarcomunidad" || cmd === "/disconnectcommunity") return communityCommand(msg, cmd, rest[0]);
    if (cmd === "/noticias" || cmd === "/news") return newsCommand(msg, rest[0]);
    if (cmd === "/bienvenida" || cmd === "/welcome") return welcomeCommand(msg, text);
    if (cmd === "/anunciar" || cmd === "/announce") return announceHere(msg, rest);
    if (cmd === "/grafico" || cmd === "/gráfico" || cmd === "/chart" || cmd === "/gr") {
      const { data: com } = await admin.from("telegram_communities").select("user_id").eq("chat_id", msg.chat.id).limit(1).maybeSingle();
      if (!com) return; // solo en las comunidades conectadas a una cuenta de VELTRIX
      return chartCommand(msg, rest, await langOf((com as { user_id: string }).user_id, guessLang(msg.from?.language_code)));
    }
    if (cmd === "/calc" || cmd === "/calcular") {
      const { data: com } = await admin.from("telegram_communities").select("user_id").eq("chat_id", msg.chat.id).limit(1).maybeSingle();
      if (!com) return;
      return calcCommand(msg, rest, await langOf((com as { user_id: string }).user_id, guessLang(msg.from?.language_code)), null);
    }
    if (cmd === "/niveles" || cmd === "/levels" || cmd === "/semana" || cmd === "/week") {
      const { data: com } = await admin.from("telegram_communities").select("user_id").eq("chat_id", msg.chat.id).limit(1).maybeSingle();
      if (!com) return;
      const owner = (com as { user_id: string }).user_id;
      const lang = await langOf(owner, guessLang(msg.from?.language_code));
      return cmd === "/niveles" || cmd === "/levels" ? levelsCommand(msg, rest, lang, owner) : weekCommand(msg, lang, owner);
    }
    if (cmd === "/ayuda" || cmd === "/help") {
      const { data: com } = await admin.from("telegram_communities").select("user_id").eq("chat_id", msg.chat.id).limit(1).maybeSingle();
      if (!com) return;
      const now = Date.now();
      if (now - (priceLast.get(-msg.chat.id) ?? 0) < 15000) return;
      priceLast.set(-msg.chat.id, now);
      const lang = await langOf((com as { user_id: string }).user_id, guessLang(msg.from?.language_code));
      return say(msg.chat.id, groupHelpMessage(lang), msg.is_topic_message && msg.message_thread_id ? { message_thread_id: Number(msg.message_thread_id) } : {});
    }
    if (cmd === "/precio" || cmd === "/price" || cmd === "/p") {
      const { data: com } = await admin.from("telegram_communities").select("user_id").eq("chat_id", msg.chat.id).limit(1).maybeSingle();
      if (!com) return;
      return priceCommand(msg, rest, await langOf((com as { user_id: string }).user_id, guessLang(msg.from?.language_code)));
    }
    if (msg.chat?.id && /^\/\w+/.test(text)) await say(msg.chat.id, T[guessLang(msg.from?.language_code)].groupsHint, msg.is_topic_message && msg.message_thread_id ? { message_thread_id: Number(msg.message_thread_id) } : {});
    return;
  }
  const chatId: number = msg.chat.id;
  const text = String(msg.text ?? msg.caption ?? "").trim();
  if (!text) return;
  const fallback = guessLang(msg.from?.language_code);
  const [first, ...rest] = text.split(/\s+/);
  const cmd = first.startsWith("/") ? first.split("@")[0].toLowerCase() : null;

  if (cmd === "/start" && rest[0]) return linkAccount(chatId, msg.from, rest[0], fallback);

  const link = await linkFor(chatId);
  if (!link) return say(chatId, T[fallback].notLinked);
  const lang = await langOf(link.user_id, fallback);

  switch (cmd) {
    case null:
      return handleSignal(chatId, link, lang, text);
    case "/abiertas":
    case "/open":
      return listOpen(chatId, link, lang);
    case "/grafico":
    case "/gráfico":
    case "/chart":
    case "/gr":
      return chartCommand(msg, rest, lang);
    case "/resumen":
    case "/summary":
      return summary(chatId, link, lang);
    case "/calc":
    case "/calcular":
      return calcCommand(msg, rest, lang, link.user_id);
    case "/niveles":
    case "/levels":
      return levelsCommand(msg, rest, lang, link.user_id);
    case "/semana":
    case "/week":
      return weekCommand(msg, lang, link.user_id);
    case "/racha":
    case "/streak":
      return streakCommand(chatId, link, lang);
    case "/activos":
    case "/assets":
      return assetsCommand(chatId, link, lang, rest);
    case "/riesgo":
    case "/risk":
      return riskCommand(chatId, link, lang, rest);
    case "/desvincular":
    case "/unlink":
      await admin.from("telegram_links").delete().eq("user_id", link.user_id);
      return say(chatId, T[lang].unlinked);
    case "/whatsapp": {
      const want = (rest[0] ?? "").toLowerCase();
      const on = ["on", "si", "sí", "activar", "yes"].includes(want);
      if (!on && !["off", "no", "desactivar"].includes(want)) return say(chatId, T[lang].waUsage);
      await admin.from("profiles").update({ whatsapp_button: on }).eq("id", link.user_id);
      return say(chatId, on ? T[lang].waOn : T[lang].waOff);
    }
    case "/anunciar":
    case "/announce":
      return announce(chatId, link, lang, rest);
    case "/webhook":
      return webhookCommand(chatId, link, lang);
    case "/miinvitacion":
    case "/myinvite":
    case "/misinvitados":
    case "/myinvites":
    case "/fijar":
    case "/pin":
    case "/antispam":
      return say(chatId, lang === "es" ? "ℹ️ Este comando solo funciona <b>dentro del grupo</b> (con el bot como administrador). Escribilo allá." : "ℹ️ This command only works <b>inside the group</b> (with the bot as an admin). Type it there.");
    case "/idioma":
    case "/language": {
      const want = (rest[0] ?? "").toLowerCase();
      if (want !== "es" && want !== "en") return say(chatId, T[lang].langUsage);
      await admin.from("profiles").update({ lang: want }).eq("id", link.user_id);
      return say(chatId, T[want].langSet);
    }
    default:
      return say(chatId, T[lang].help);
  }
}

/**
 * /anunciar ID (chat privado) → muestra cómo se vería el aviso, solo en ese chat, y explica cómo publicarlo.
 * Para publicar hay que escribir el comando DENTRO del grupo, en el tema que corresponda (ver announceHere): así nunca
 * sale en un tema equivocado, como el de las señales.
 * Solo para cuentas habilitadas (profiles.bot_beta); para el resto el comando no existe.
 */
async function announce(chatId: number, link: { user_id: string }, lang: Lang, args: string[]) {
  const { data: prof, error } = await admin.from("profiles").select("bot_beta").eq("id", link.user_id).maybeSingle();
  if (error || !(prof as { bot_beta?: boolean } | null)?.bot_beta) return say(chatId, T[lang].help);
  const id = (args[0] ?? "").toLowerCase();
  const text = ANNOUNCEMENTS[id];
  const es = lang === "es";
  if (!text) return say(chatId, es ? `Avisos disponibles: ${announcementIds().join(", ")}.\nUsá /anunciar ${announcementIds()[0]} para ver cómo queda.` : `Available announcements: ${announcementIds().join(", ")}.\nUse /announce ${announcementIds()[0]} to preview it.`);
  await say(chatId, text[lang]);
  return say(
    chatId,
    es
      ? `👆 Así se vería. Publicalo solo cuando la app nueva esté lanzada y el bot abierto.\n\nPara publicarlo: entrá al grupo, abrí el tema donde lo querés (por ejemplo «Noticias») y escribí ahí:\n/anunciar ${id} confirmar\n\nSolo funciona si sos administrador y el grupo está conectado a tu cuenta.`
      : `👆 This is how it would look. Publish it only when the new app is released and the bot is open.\n\nTo publish it: go to the group, open the topic where you want it (for example “News”) and type there:\n/announce ${id} confirm\n\nIt only works if you are an admin and the group is connected to your account.`,
  );
}

/**
 * /anunciar ID confirmar, escrito DENTRO de un grupo (en el tema donde se quiere el aviso, por ejemplo «Noticias»).
 * Publica ahí mismo. Solo lo puede usar un administrador del grupo, y solo si el grupo está conectado a una cuenta habilitada.
 * Para cualquier otra persona o grupo no hace nada (el comando no existe).
 */
async function announceHere(msg: any, args: string[]) {
  const token = botToken();
  const chatId: number = msg.chat.id;
  if (!token) return;
  const thread: number | null = msg.is_topic_message && msg.message_thread_id ? Number(msg.message_thread_id) : null;
  const extra = thread ? { message_thread_id: thread } : {};
  const member = await tgApi(token, "getChatMember", { chat_id: chatId, user_id: msg.from?.id });
  const status = member?.result?.status;
  if (status !== "creator" && status !== "administrator") return;
  const { data: row } = await admin.from("telegram_communities").select("user_id").eq("chat_id", chatId).limit(1).maybeSingle();
  if (!row) return;
  const owner = (row as { user_id: string }).user_id;
  const { data: prof, error } = await admin.from("profiles").select("bot_beta, lang").eq("id", owner).maybeSingle();
  if (error || !(prof as { bot_beta?: boolean } | null)?.bot_beta) return;
  const lang: Lang = (prof as { lang?: string }).lang === "en" ? "en" : "es";
  const text = ANNOUNCEMENTS[(args[0] ?? "").toLowerCase()];
  if (!text) return say(chatId, lang === "es" ? `Avisos disponibles: ${announcementIds().join(", ")}.` : `Available announcements: ${announcementIds().join(", ")}.`, extra);
  if (!["confirmar", "confirm"].includes((args[1] ?? "").toLowerCase())) {
    const id = (args[0] ?? "").toLowerCase();
    return say(chatId, lang === "es" ? `Para publicarlo acá (en este tema) escribí:\n/anunciar ${id} confirmar` : `To publish it here (in this topic) type:\n/announce ${id} confirm`, extra);
  }
  const r = await sendMessage(token, chatId, text[lang], extra);
  // El aviso queda fijado en su tema (y se suelta el anterior que fijó el bot). Sin el permiso, simplemente no se fija.
  const messageId = r?.result?.message_id;
  if (r?.ok && messageId) {
    const { data: pinRow } = await admin.from("telegram_communities").select("announce_pin_id").eq("chat_id", chatId).limit(1).maybeSingle();
    const prev = (pinRow as { announce_pin_id?: number | null } | null)?.announce_pin_id ?? null;
    if (await pinReplace(token, chatId, messageId, prev)) await admin.from("telegram_communities").update({ announce_pin_id: messageId }).eq("chat_id", chatId);
  }
  return r;
}

// ─── Pedidos de la app ──────────────────────────────────────────────────────

async function handleClient(req: Request, body: Record<string, unknown>) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ ok: false, error: "Sesión no válida. Volvé a ingresar." }, 401);

  const bot = botToken();
  if (!bot) return json({ ok: false, code: "not_configured", error: "El bot de Telegram todavía no está configurado en el servidor." }, 500);

  if (body.action === "link") {
    const username = await botUsername(bot);
    if (!username) return json({ ok: false, error: "No se pudo contactar al bot de Telegram. Probá de nuevo en unos minutos." }, 502);
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    await admin.from("telegram_link_codes").delete().eq("user_id", user.id).eq("kind", "private");
    const { error } = await admin.from("telegram_link_codes").insert({ code, kind: "private", user_id: user.id, expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString() });
    if (error) return json({ ok: false, error: "No se pudo generar el código." }, 500);
    return json({ ok: true, code, botUsername: username, url: `https://t.me/${username}?start=${code}` });
  }
  if (body.action === "community_code") {
    const username = await botUsername(bot);
    if (!username) return json({ ok: false, error: "No se pudo contactar al bot de Telegram. Probá de nuevo en unos minutos." }, 502);
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    await admin.from("telegram_link_codes").delete().eq("user_id", user.id).eq("kind", "community");
    const { error } = await admin.from("telegram_link_codes").insert({ code, kind: "community", user_id: user.id, expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString() });
    if (error) return json({ ok: false, error: "No se pudo generar el código." }, 500);
    return json({
      ok: true,
      code,
      botUsername: username,
      command: `/comunidad@${username} ${code}`,
      addToGroupUrl: `https://t.me/${username}?startgroup=true&admin=${GROUP_ADMIN_RIGHTS.join("+")}`,
      addToChannelUrl: `https://t.me/${username}?startchannel=true&admin=post_messages`,
    });
  }
  return json({ ok: false, error: "Acción desconocida." }, 400);
}

// ─── Entrada ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Pedido no válido." }, 400);
  }

  // Pedido de Telegram: se acepta solo con la cabecera secreta que se configuró en setWebhook.
  if (body && typeof body.update_id === "number") {
    const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return json({ ok: false }, 401);
    try {
      if (body.callback_query) await handleCallback(body.callback_query);
      else if (body.message) await handleMessage(body.message);
      else if (body.channel_post) await handleMessage(body.channel_post);
      else if (body.chat_member) await handleChatMember(body.chat_member);
    } catch (e) {
      console.error("telegram-bot:", e instanceof Error ? e.message : e); // siempre 200: Telegram no debe reintentar
    }
    return json({ ok: true });
  }

  return handleClient(req, body ?? {});
});

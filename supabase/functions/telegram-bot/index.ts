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
import { botToken, esc, sendMessage, tgApi } from "../_shared/telegram.ts";
import type { Lang } from "../_shared/telegram.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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
const fmtR = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1).replace(/\.0$/, "")}R`;

const T = {
  es: {
    help:
      "<b>VELTRIX</b> 👋\n\nPegá acá una señal (o reenviá el mensaje de un canal) y la registro en tu diario.\n\n" +
      "/abiertas — tus señales abiertas\n/resumen — tus resultados en R\n/idioma en — cambiar a inglés\n/desvincular — desconectar este chat\n\n" +
      "Ejemplo:\n<code>BTCUSDT LONG\nEntrada: 65000\nTP: 66500\nSL: 64500</code>",
    notLinked:
      "Este chat todavía no está conectado a una cuenta de VELTRIX.\n\nEntrá a la app o la web → «Conectar Telegram» y tocá el botón: te trae de vuelta acá ya vinculado.",
    badCode: "Ese código no es válido o venció. Volvé a la app o la web y tocá «Conectar Telegram» de nuevo.",
    linked: "✅ <b>Telegram conectado</b>. Ya podés pegar señales acá y te aviso cuando llegue una alerta o se toque un TP/SL.",
    unlinked: "Listo, desconecté este chat de tu cuenta. Podés volver a conectarlo cuando quieras desde la app.",
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
  },
  en: {
    help:
      "<b>VELTRIX</b> 👋\n\nPaste a signal here (or forward a channel message) and I'll log it in your journal.\n\n" +
      "/open — your open signals\n/summary — your results in R\n/language es — switch to Spanish\n/unlink — disconnect this chat\n\n" +
      "Example:\n<code>BTCUSDT LONG\nEntry: 65000\nTP: 66500\nSL: 64500</code>",
    notLinked:
      "This chat isn't connected to a VELTRIX account yet.\n\nOpen the app or the web → “Connect Telegram” and tap the button: it brings you back here already linked.",
    badCode: "That code isn't valid or has expired. Go back to the app or the web and tap “Connect Telegram” again.",
    linked: "✅ <b>Telegram connected</b>. You can now paste signals here, and I'll notify you when an alert arrives or a TP/SL is hit.",
    unlinked: "Done, I disconnected this chat from your account. You can reconnect anytime from the app.",
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
  const { data: row } = await admin.from("telegram_link_codes").select("code, user_id, expires_at").eq("code", code).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
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
    return `${arrow(t.direction)} <b>${esc(t.symbol)}</b> ${sideWord(lang, t.direction)} · ${T[lang].entry} ${t.entry} · TP ${t.tp} · SL ${t.sl} · R:R 1:${rr.toFixed(1)}`;
  });
  return say(chatId, `${T[lang].understood(trades.length)}\n\n${lines.join("\n")}`, {
    reply_markup: { inline_keyboard: [[{ text: T[lang].register(trades.length), callback_data: `ok:${pending.id}` }, { text: T[lang].cancel, callback_data: `no:${pending.id}` }]] },
  });
}

async function handleCallback(cb: any) {
  const token = botToken();
  if (!token) return;
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
  for (const t of pending.trades as Array<{ symbol: string; direction: string; entry: number; tp: number; sl: number }>) {
    const { data: same } = await admin
      .from("trades").select("id").eq("user_id", link.user_id).eq("symbol", t.symbol).eq("direction", t.direction).eq("entry", t.entry).gte("created_at", iso(60_000)).limit(1);
    if (same?.length) { dup++; continue; }
    const { error } = await admin.from("trades").insert({ user_id: link.user_id, symbol: t.symbol, direction: t.direction, entry: t.entry, tp: t.tp, sl: t.sl, date: new Date().toISOString() });
    if (!error) saved++;
  }
  return edit(T[lang].registered(saved, dup));
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
    return `<b>${label}:</b> ${sel.length ? `${fmtR(net)}${extra} · ${sel.length} ${T[lang].ops} · ${Math.round((wins / sel.length) * 100)}% ${T[lang].win}` : "—"}`;
  };
  return say(chatId, [T[lang].summaryTitle, "", block(T[lang].last24, 86_400_000), block(T[lang].last7, 7 * 86_400_000), block(T[lang].last30, 30 * 86_400_000)].join("\n"));
}

async function handleMessage(msg: any) {
  if (msg.chat?.type !== "private") {
    if (msg.chat?.id && /^\/\w+/.test(String(msg.text ?? ""))) await say(msg.chat.id, T[guessLang(msg.from?.language_code)].groupsHint);
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
    case "/resumen":
    case "/summary":
      return summary(chatId, link, lang);
    case "/desvincular":
    case "/unlink":
      await admin.from("telegram_links").delete().eq("user_id", link.user_id);
      return say(chatId, T[lang].unlinked);
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
    await admin.from("telegram_link_codes").delete().eq("user_id", user.id);
    const { error } = await admin.from("telegram_link_codes").insert({ code, user_id: user.id, expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString() });
    if (error) return json({ ok: false, error: "No se pudo generar el código." }, 500);
    return json({ ok: true, code, botUsername: username, url: `https://t.me/${username}?start=${code}` });
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
    } catch (e) {
      console.error("telegram-bot:", e instanceof Error ? e.message : e); // siempre 200: Telegram no debe reintentar
    }
    return json({ ok: true });
  }

  return handleClient(req, body ?? {});
});

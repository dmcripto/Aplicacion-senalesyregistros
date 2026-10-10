// ─── VELTRIX · Publicar en la comunidad de Telegram ─────────────────────────
// El dueño de la cuenta conecta un grupo o canal; cada señal nueva y cada TP/SL que toque se publica ahí.
// Las señales se publican sin datos personales ni dinero: solo el activo, los niveles y el resultado en R.

import { esc, sendMessage, sendPhoto } from "./telegram.ts";
import type { Lang } from "./telegram.ts";
import { voteKeyboard } from "./votes.ts";

export interface CommunityTrade {
  symbol: string;
  direction: string; // LONG | SHORT
  entry: number;
  tp: number; // TP final
  sl: number;
  /** Targets parciales (TP1, TP2…) antes del TP final, del más cercano al más lejano. */
  targets?: number[] | null;
}

const DISCLAIMER = {
  es: "⚠️ Información para registro personal: no es asesoramiento financiero.",
  en: "⚠️ For personal record-keeping: not financial advice.",
};

const SITE = "https://veltrix-trading.vercel.app";
const R_OF = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;
const PCT = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

/** "BTCUSDT" → "BTC/USDT" (si no se reconoce la moneda de cotización, queda igual). */
export function prettyPair(symbol: string): string {
  const m = String(symbol).toUpperCase().match(/^([A-Z0-9]{2,15}?)(USDT|USDC|BUSD|USD)(\.P|PERP)?$/);
  return m ? `${m[1]}/${m[2]}${m[3] ?? ""}` : String(symbol);
}

/** Los targets de la señal con su distancia en %: «Target» si hay uno solo, «Target 1», «Target 2»… si hay varios. El último es el TP final. */
function targetLines(t: CommunityTrade, dir: number): string[] {
  const levels = [...(t.targets ?? []), t.tp];
  const out: string[] = [];
  levels.forEach((n, i) => {
    const pct = t.entry ? ((dir * (n - t.entry)) / t.entry) * 100 : 0;
    out.push(`💠 Target${levels.length > 1 ? ` ${i + 1}` : ""} :- <b>${n}</b>  <i>(${PCT(pct)})</i>`, "");
  });
  return out;
}

/** Qué se sugiere hacer al tocar el target número `n` (1 = el primero). */
export const targetAdvice = (n: number, lang: Lang): string =>
  n <= 1
    ? lang === "en" ? "Close 50% and move the SL to break-even" : "Cerrar 50% y mover el SL a break-even"
    : lang === "en" ? `Lock in profit: move the SL to Target ${n - 1}` : `Asegurar ganancias: mover el SL al Target ${n - 1}`;

/**
 * Aviso extra del resultado según cómo llegó el precio: `reached` = cuántos targets parciales (de `total`) se tocaron antes del cierre.
 * Devuelve null si la operación no tenía targets o no hay nada que aclarar.
 */
export function resultNote(outcome: "TP" | "SL", reached: number, total: number, lang: Lang): string | null {
  if (total <= 0) return null;
  const en = lang === "en";
  if (outcome === "SL") {
    if (reached === 0) return en ? "SL hit before Target 1" : "SL tocado antes del Target 1";
    return en ? `Target ${reached} was reached before the SL` : `Había llegado al Target ${reached} antes del SL`;
  }
  if (reached === 0) return total === 1 ? (en ? "Straight to TP, skipping Target 1" : "Directo al TP, sin pasar por el Target 1") : en ? "Straight to TP, skipping the targets" : "Directo al TP, sin pasar por los targets";
  return null;
}

/**
 * Señal en texto de Telegram, con un emoji por línea y cada dato bien separado: par y dirección, entrada, objetivo (TP) y stop,
 * con su distancia en % y el R:R. `header` es el emoji de arriba (📢 comunidad, 🔔 aviso privado). Sin datos personales ni dinero.
 */
export function signalCardHtml(t: CommunityTrade, lang: Lang, opts: { header?: string; disclaimer?: boolean } = {}): string {
  const en = lang === "en";
  const long = t.direction === "LONG";
  const risk = Math.abs(t.entry - t.sl);
  const rr = risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
  const dir = long ? 1 : -1;
  const slPct = t.entry ? ((dir * (t.sl - t.entry)) / t.entry) * 100 : 0;
  const lines = [
    `${opts.header ?? "📢"} <b>${en ? "NEW SIGNAL" : "NUEVA SEÑAL"}</b>`,
    "",
    `⏳ <b>${esc(prettyPair(t.symbol))}</b> ( ${long ? (en ? "LONG 🟢" : "LONG 🟢") : "SHORT 🔴"} )`,
    "",
    `⛩ ${en ? "Entry" : "Entrada"} ➡️ <b>${t.entry}</b>`,
    "",
    ...targetLines(t, dir),
    `🛑 Stoploss = <b>${t.sl}</b>  <i>(${PCT(slPct)})</i>`,
    "",
    `⚖️ R:R <b>1 : ${rr.toFixed(1)}</b>`,
  ];
  if (opts.disclaimer !== false) lines.push("", `<i>${DISCLAIMER[lang]}</i>`, `<a href="${SITE}">VELTRIX</a>`);
  return lines.join("\n");
}

export const communitySignalMessage = (t: CommunityTrade, lang: Lang) => signalCardHtml(t, lang, { header: "📢" });

/** Porcentaje de movimiento del precio a favor entre la entrada y `price` (según la dirección). */
export const favorPct = (t: Pick<CommunityTrade, "direction" | "entry">, price: number) => (t.entry ? (((t.direction === "LONG" ? 1 : -1) * (price - t.entry)) / t.entry) * 100 : 0);

/** Aviso de target: el precio avanzó a favor; se sugiere tomar parcial / asegurar ganancias. `opts.n` es el número de target (1 por defecto). */
export function partialCardHtml(t: CommunityTrade, level: number, r: number, lang: Lang, opts: { header?: string; disclaimer?: boolean; n?: number } = {}): string {
  const en = lang === "en";
  const n = opts.n ?? 1;
  const lines = [
    `${opts.header ?? "🎯"} <b>${en ? `TARGET ${n} HIT` : `TARGET ${n} ALCANZADO`}</b>`,
    "",
    `⏳ <b>${esc(prettyPair(t.symbol))}</b> ( ${t.direction === "LONG" ? "LONG 🟢" : "SHORT 🔴"} )`,
    "",
    `💰 Profit <b>${PCT(favorPct(t, level))}</b>  <i>(${R_OF(r)})</i>`,
    "",
    `💡 <b>${en ? "Suggested management:" : "Gestión sugerida:"}</b> ${targetAdvice(n, lang).replace(/^./, (c) => c.toLowerCase())}`,
  ];
  if (opts.disclaimer !== false) lines.push("", `<i>${DISCLAIMER[lang]}</i>`, `<a href="${SITE}">VELTRIX</a>`);
  return lines.join("\n");
}

/** Resultado de una operación al tocar TP o SL. */
export function resultCardHtml(symbol: string, outcome: "TP" | "SL", r: number, lang: Lang, opts: { label?: string; note?: string | null } = {}): string {
  const en = lang === "en";
  const ok = outcome === "TP";
  const title = ok ? (en ? "TP HIT" : "TP ALCANZADO") : en ? "SL HIT" : "SL ALCANZADO";
  const label = opts.label ?? (en ? "Result" : "Resultado");
  return [
    `${ok ? "✅" : "❌"} <b>${title}</b> ${ok ? "🎉" : ""}`.trim(),
    "",
    `⏳ <b>${esc(prettyPair(symbol))}</b>`,
    "",
    `${ok ? "🏆" : "📉"} ${label}: <b>${R_OF(r)}</b>`,
    ...(opts.note ? ["", `${ok ? "⚡" : "⚠️"} <i>${esc(opts.note)}</i>`] : []),
  ].join("\n");
}

export const communityResultMessage = (symbol: string, outcome: "TP" | "SL", r: number, lang: Lang, note?: string | null) => resultCardHtml(symbol, outcome, r, lang, { note });

/**
 * Publica en todas las comunidades conectadas de esa cuenta. Nunca lanza errores: un fallo de Telegram
 * no debe romper el registro de la señal. Si el bot ya no está en el grupo, se borra la conexión.
 */
export async function publishToCommunities(
  supabase: any,
  token: string | undefined,
  userId: string,
  build: (lang: Lang) => string,
  /** Imagen tarjeta opcional: si se arma bien se publica la imagen con su texto; si no, el texto de `build`. */
  photo?: (lang: Lang) => Promise<{ png: Uint8Array; caption: string } | null>,
  /** Si se pasa, la publicación lleva los botones 👍/👎 para votar la señal. */
  tradeId?: string,
): Promise<number> {
  try {
    if (!token) return 0;
    const { data: rows } = await supabase.from("telegram_communities").select("id,chat_id,thread_id").eq("user_id", userId);
    if (!rows?.length) return 0;
    const { data: profile } = await supabase.from("profiles").select("lang").eq("id", userId).maybeSingle();
    const lang: Lang = (profile as { lang?: string } | null)?.lang === "en" ? "en" : "es";
    const text = build(lang);
    let img: { png: Uint8Array; caption: string } | null = null;
    if (photo) {
      try {
        img = await photo(lang);
      } catch {
        img = null;
      }
    }
    let ok = 0;
    for (const row of rows as Array<{ id: string; chat_id: number; thread_id?: number | null }>) {
      // En un grupo con temas se publica en el tema donde se conectó.
      const thread = row.thread_id ? { message_thread_id: Number(row.thread_id) } : {};
      const markup = tradeId ? voteKeyboard(tradeId, { up: 0, down: 0 }, lang) : null;
      let r = img ? await sendPhoto(token, Number(row.chat_id), img.png, img.caption, markup ? { ...thread, reply_markup: JSON.stringify(markup) } : thread) : null;
      // Si la imagen no salió (error de Telegram distinto de "el bot ya no está"), se manda el texto.
      if (!r?.ok && r?.error_code !== 403) r = await sendMessage(token, Number(row.chat_id), text, markup ? { ...thread, reply_markup: markup } : thread);
      if (r?.ok) ok++;
      else if (r?.error_code === 403 || r?.error_code === 400) await supabase.from("telegram_communities").delete().eq("id", row.id);
    }
    return ok;
  } catch {
    return 0;
  }
}

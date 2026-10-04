// ─── VELTRIX · Publicar en la comunidad de Telegram ─────────────────────────
// El dueño de la cuenta conecta un grupo o canal; cada señal nueva y cada TP/SL que toque se publica ahí.
// Las señales se publican sin datos personales ni dinero: solo el activo, los niveles y el resultado en R.

import { esc, sendMessage } from "./telegram.ts";
import type { Lang } from "./telegram.ts";

export interface CommunityTrade {
  symbol: string;
  direction: string; // LONG | SHORT
  entry: number;
  tp: number;
  sl: number;
}

const DISCLAIMER = {
  es: "⚠️ Información para registro personal: no es asesoramiento financiero.",
  en: "⚠️ For personal record-keeping: not financial advice.",
};

const SITE = "https://veltrix-trading.vercel.app";
const LINE = "━━━━━━━━━━━━━━━";
const R_OF = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;
const PCT = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

/**
 * Tarjeta de una señal en texto de Telegram: encabezado, activo y dirección, tabla de niveles con la distancia en %
 * y el R:R. `header` es el emoji de arriba (📢 comunidad, 🔔 aviso privado). Sin datos personales ni dinero.
 */
export function signalCardHtml(t: CommunityTrade, lang: Lang, opts: { header?: string; disclaimer?: boolean } = {}): string {
  const en = lang === "en";
  const long = t.direction === "LONG";
  const risk = Math.abs(t.entry - t.sl);
  const rr = risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
  const dir = long ? 1 : -1;
  const tpPct = t.entry ? ((dir * (t.tp - t.entry)) / t.entry) * 100 : 0;
  const slPct = t.entry ? ((dir * (t.sl - t.entry)) / t.entry) * 100 : 0;
  const vals = [String(t.entry), String(t.tp), String(t.sl)];
  const w = Math.max(...vals.map((v) => v.length));
  const row = (label: string, v: string, pct?: string) => `${label.padEnd(8)} ${v.padEnd(w)}${pct ? `  ${pct}` : ""}`;
  const table = [
    row(en ? "ENTRY" : "ENTRADA", vals[0]),
    row("TP", vals[1], PCT(tpPct)),
    row("SL", vals[2], PCT(slPct)),
    row("R:R", `1 : ${rr.toFixed(1)}`),
  ].join("\n");
  const side = long ? (en ? "BUY" : "COMPRA") : en ? "SELL" : "VENTA";
  const lines = [
    `${opts.header ?? "📢"} <b>${en ? "NEW SIGNAL" : "NUEVA SEÑAL"}</b>`,
    LINE,
    `${long ? "🟢" : "🔴"} <b>${esc(t.symbol)}</b>  ·  ${side}`,
    `<pre>${esc(table)}</pre>`,
  ];
  if (opts.disclaimer !== false) lines.push(`<i>${DISCLAIMER[lang]}</i>`, `<a href="${SITE}">VELTRIX</a>`);
  return lines.join("\n");
}

export const communitySignalMessage = (t: CommunityTrade, lang: Lang) => signalCardHtml(t, lang, { header: "📢" });

/** Resultado de una operación al tocar TP o SL. */
export function resultCardHtml(symbol: string, outcome: "TP" | "SL", r: number, lang: Lang, opts: { label?: string } = {}): string {
  const en = lang === "en";
  const ok = outcome === "TP";
  const title = ok ? (en ? "TP HIT" : "TP ALCANZADO") : en ? "SL HIT" : "SL ALCANZADO";
  const label = opts.label ?? (en ? "Result" : "Resultado");
  return [`${ok ? "✅" : "❌"} <b>${title}</b>`, LINE, `<b>${esc(symbol)}</b>`, `${ok ? "🏆" : "📉"} ${label}: <b>${R_OF(r)}</b>`].join("\n");
}

export const communityResultMessage = (symbol: string, outcome: "TP" | "SL", r: number, lang: Lang) => resultCardHtml(symbol, outcome, r, lang);

/**
 * Publica en todas las comunidades conectadas de esa cuenta. Nunca lanza errores: un fallo de Telegram
 * no debe romper el registro de la señal. Si el bot ya no está en el grupo, se borra la conexión.
 */
export async function publishToCommunities(supabase: any, token: string | undefined, userId: string, build: (lang: Lang) => string): Promise<number> {
  try {
    if (!token) return 0;
    const { data: rows } = await supabase.from("telegram_communities").select("id,chat_id,thread_id").eq("user_id", userId);
    if (!rows?.length) return 0;
    const { data: profile } = await supabase.from("profiles").select("lang").eq("id", userId).maybeSingle();
    const lang: Lang = (profile as { lang?: string } | null)?.lang === "en" ? "en" : "es";
    const text = build(lang);
    let ok = 0;
    for (const row of rows as Array<{ id: string; chat_id: number; thread_id?: number | null }>) {
      // En un grupo con temas se publica en el tema donde se conectó.
      const r = await sendMessage(token, Number(row.chat_id), text, row.thread_id ? { message_thread_id: Number(row.thread_id) } : {});
      if (r?.ok) ok++;
      else if (r?.error_code === 403 || r?.error_code === 400) await supabase.from("telegram_communities").delete().eq("id", row.id);
    }
    return ok;
  } catch {
    return 0;
  }
}

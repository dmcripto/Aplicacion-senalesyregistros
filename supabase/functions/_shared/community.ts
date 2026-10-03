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

export function communitySignalMessage(t: CommunityTrade, lang: Lang): string {
  const en = lang === "en";
  const risk = Math.abs(t.entry - t.sl);
  const rr = risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
  const side = t.direction === "LONG" ? (en ? "BUY" : "COMPRA") : en ? "SELL" : "VENTA";
  return [
    `📢 <b>${en ? "New signal" : "Nueva señal"}</b>`,
    `${t.direction === "LONG" ? "▲" : "▼"} <b>${esc(t.symbol)}</b> ${side}`,
    `${en ? "Entry" : "Entrada"} ${t.entry} · TP ${t.tp} · SL ${t.sl} · R:R 1:${rr.toFixed(1)}`,
    "",
    DISCLAIMER[lang],
  ].join("\n");
}

export function communityResultMessage(symbol: string, outcome: "TP" | "SL", r: number, lang: Lang): string {
  const en = lang === "en";
  const ok = outcome === "TP";
  const title = ok ? (en ? "TP hit" : "TP alcanzado") : en ? "SL hit" : "SL alcanzado";
  return `${ok ? "✅" : "❌"} <b>${title}</b> · ${esc(symbol)}\n${en ? "Result" : "Resultado"} ${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}R`;
}

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

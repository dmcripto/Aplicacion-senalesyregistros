// ─── VELTRIX · Botón «Enviar a WhatsApp» en los avisos de Telegram ──────────
// WhatsApp no deja que un bot escriba solo. Con el interruptor activado, cada aviso del bot trae un botón
// que abre WhatsApp con el mensaje ya escrito: un toque y elegís a quién mandarlo. Sin dinero ni datos de la cuenta.

import type { Lang } from "./telegram.ts";

export interface WaSignal {
  symbol: string;
  direction: string; // LONG | SHORT
  entry: number;
  tp: number;
  sl: number;
}

export const WA_LABEL = { es: "📲 Enviar a WhatsApp", en: "📲 Send to WhatsApp" };

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function waSignalText(t: WaSignal, lang: Lang): string {
  const en = lang === "en";
  const risk = Math.abs(t.entry - t.sl);
  const rr = risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
  const side = t.direction === "LONG" ? (en ? "BUY" : "COMPRA") : en ? "SELL" : "VENTA";
  return [
    `📢 ${en ? "New signal" : "Nueva señal"}`,
    `${t.direction === "LONG" ? "▲" : "▼"} ${t.symbol} ${side}`,
    `${en ? "Entry" : "Entrada"} ${t.entry} · TP ${t.tp} · SL ${t.sl} · R:R 1:${rr.toFixed(1)}`,
    en ? "⚠️ For personal record-keeping: not financial advice." : "⚠️ Información para registro personal: no es asesoramiento financiero.",
    "VELTRIX",
  ].join("\n");
}

export function waResultText(symbol: string, outcome: "TP" | "SL", r: number, lang: Lang): string {
  const en = lang === "en";
  const ok = outcome === "TP";
  const title = ok ? (en ? "TP hit" : "TP alcanzado") : en ? "SL hit" : "SL alcanzado";
  return `${ok ? "✅" : "❌"} ${title} · ${symbol}\n${en ? "Result" : "Resultado"} ${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}R\nVELTRIX`;
}

/** Teclado de Telegram con el botón de WhatsApp. */
export const waKeyboard = (text: string, lang: Lang) => ({
  inline_keyboard: [[{ text: WA_LABEL[lang], url: whatsappUrl(text) }]],
});

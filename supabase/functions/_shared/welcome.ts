// ─── VELTRIX · Bienvenida a quienes entran al grupo ─────────────────────────────────────────────────────────────────
// Texto del saludo (HTML de Telegram). Si la cuenta guardó un texto propio se usa ese, con {nombre} y {grupo};
// si no, uno por defecto que explica qué se puede hacer en el grupo.

import { esc } from "./telegram.ts";

export interface Member {
  id: number;
  first_name?: string;
  username?: string;
}

/** Nombres con enlace (mención) separados por coma: «Ana, Luis y Marta». */
export function mentionNames(members: Member[], lang: "es" | "en"): string {
  const parts = members.map((m) => `<a href="tg://user?id=${m.id}">${esc(m.first_name || m.username || "👋")}</a>`);
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${lang === "en" ? "and" : "y"} ${parts[parts.length - 1]}`;
}

const DEFAULT = {
  es: (names: string, title: string) =>
    `👋 ¡Bienvenido/a ${names}${title ? ` a <b>${title}</b>` : ""}!\n\nLeé el mensaje fijado 📌 antes de operar.\n\nCon el bot podés:\n• <code>/grafico BTCUSDT 4h</code> → gráfico de velas (agregá <code>ema</code> o <code>liq</code>)\n• Seguir las señales y la agenda económica en sus temas\n\n⚠️ Contenido educativo, no es asesoramiento financiero.`,
  en: (names: string, title: string) =>
    `👋 Welcome ${names}${title ? ` to <b>${title}</b>` : ""}!\n\nRead the pinned message 📌 before trading.\n\nWith the bot you can:\n• <code>/chart BTCUSDT 4h</code> → candlestick chart (add <code>ema</code> or <code>liq</code>)\n• Follow the signals and the economic calendar in their topics\n\n⚠️ Educational content, not financial advice.`,
};

/** `custom` es el texto propio de la cuenta (sin HTML): se escapa y se reemplazan {nombre}/{name} y {grupo}/{group}. */
export function welcomeGreeting(members: Member[], chatTitle: string | null | undefined, custom: string | null | undefined, lang: "es" | "en"): string {
  const names = mentionNames(members, lang);
  const title = chatTitle ? esc(chatTitle) : "";
  if (custom && custom.trim()) {
    const body = esc(custom).replace(/\{(nombre|name)\}/gi, () => names).replace(/\{(grupo|group)\}/gi, () => title);
    return body;
  }
  return DEFAULT[lang](names, title);
}

/** Mensaje corto que va antes de copiar el mensaje guardado (por ejemplo el «cheat sheet»). */
export const welcomeHello = (members: Member[], lang: "es" | "en") => `👋 ${lang === "en" ? "Welcome" : "¡Bienvenido/a"} ${mentionNames(members, lang)}!`;

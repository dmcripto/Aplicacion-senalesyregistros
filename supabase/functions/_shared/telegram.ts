// ─── VELTRIX · Telegram (API de bots) ───────────────────────────────────────
// Funciones comunes para hablar con Telegram y avisar al usuario desde cualquier función del servidor.

import { waKeyboard } from "./whatsapp.ts";

export type Lang = "es" | "en";

const API = "https://api.telegram.org";

export const botToken = (): string | undefined => Deno.env.get("TELEGRAM_BOT_TOKEN") || undefined;

/** Escapa el texto para usarlo dentro de mensajes con formato HTML. */
export const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function tgApi(token: string, method: string, payload: Record<string, unknown> = {}): Promise<any> {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return await res.json();
  } catch {
    return { ok: false, error_code: 0, description: "network" };
  }
}

export const sendMessage = (token: string, chatId: number, html: string, extra: Record<string, unknown> = {}) =>
  tgApi(token, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

/** Manda una imagen PNG (con texto opcional abajo). Si Telegram la rechaza, devuelve el error igual que sendMessage. */
export async function sendPhoto(token: string, chatId: number, png: Uint8Array, caption: string, extra: Record<string, string | number> = {}): Promise<any> {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption.slice(0, 1000));
    form.append("parse_mode", "HTML");
    for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
    form.append("photo", new Blob([png], { type: "image/png" }), "veltrix.png");
    const res = await fetch(`${API}/bot${token}/sendPhoto`, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
    return await res.json();
  } catch {
    return { ok: false, error_code: 0, description: "network" };
  }
}

/**
 * Avisa por Telegram al usuario si tiene el chat vinculado. `build` arma el texto en su idioma.
 * Nunca lanza errores: un fallo de Telegram no debe romper el registro de la señal.
 * Si el usuario bloqueó al bot, se borra la vinculación.
 */
export async function notifyTelegram(
  supabase: any,
  userId: string,
  build: (lang: Lang) => string,
  /** Texto plano para el botón «Enviar a WhatsApp». Solo se agrega si la persona activó el interruptor. */
  whatsappText?: (lang: Lang) => string,
): Promise<void> {
  try {
    const token = botToken();
    if (!token) return;
    const { data: link } = await supabase.from("telegram_links").select("chat_id").eq("user_id", userId).maybeSingle();
    if (!link) return;
    const { data: profile } = await supabase.from("profiles").select("lang").eq("id", userId).maybeSingle();
    const lang: Lang = (profile as { lang?: string } | null)?.lang === "en" ? "en" : "es";
    let extra: Record<string, unknown> = {};
    if (whatsappText) {
      // Columna opcional: si todavía no existe (falta correr el SQL), simplemente no hay botón.
      const { data: wa } = await supabase.from("profiles").select("whatsapp_button").eq("id", userId).maybeSingle();
      if ((wa as { whatsapp_button?: boolean } | null)?.whatsapp_button === true) extra = { reply_markup: waKeyboard(whatsappText(lang), lang) };
    }
    const r = await sendMessage(token, Number(link.chat_id), build(lang), extra);
    if (!r?.ok && r?.error_code === 403) await supabase.from("telegram_links").delete().eq("user_id", userId);
  } catch {
    /* sin aviso por Telegram */
  }
}

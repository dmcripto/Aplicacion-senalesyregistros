import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyTelegram } from "../supabase/functions/_shared/telegram";
import { waResultText, waSignalText, whatsappUrl } from "../supabase/functions/_shared/whatsapp";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
let sent: Array<{ method: string; payload: any }> = [];

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SIGNAL_IMAGES: "off", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", TELEGRAM_BOT_TOKEN: "TOKEN", TELEGRAM_WEBHOOK_SECRET: "SECRET" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/telegram-bot/index");
});

beforeEach(() => {
  resetDb({ profiles: [{ id: "u1", lang: "es" }], telegram_links: [{ user_id: "u1", chat_id: 555 }], telegram_link_codes: [], telegram_pending: [] });
  sent = [];
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    sent.push({ method: String(url).split("/").pop()!, payload: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true }));
  });
});

const sig = { symbol: "BTCUSDT", direction: "LONG", entry: 65000, tp: 66500, sl: 64500 };
const send = async () => {
  const { createClient } = await import("npm:@supabase/supabase-js@2" as string);
  const c = createClient("x", "y");
  await notifyTelegram(c, "u1", () => "hola", (lang) => waSignalText(sig, lang));
  return sent.find((s) => s.method === "sendMessage")!.payload;
};
const priv = (text: string) =>
  handler(new Request("http://x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "SECRET" }, body: JSON.stringify({ update_id: Math.random(), message: { message_id: 1, chat: { id: 555, type: "private" }, from: { id: 555, language_code: "es" }, text } }) }));

describe("botón de WhatsApp en los avisos de Telegram", () => {
  it("apagado (por defecto): el aviso sale sin botón", async () => {
    expect((await send()).reply_markup).toBeUndefined();
  });

  it("activado: el aviso trae un botón que abre WhatsApp con el mensaje armado", async () => {
    db.tables.profiles[0].whatsapp_button = true;
    const p = await send();
    const btn = p.reply_markup.inline_keyboard[0][0];
    expect(btn.text).toContain("WhatsApp");
    expect(btn.url.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(btn.url.split("text=")[1]);
    expect(text).toContain("BTCUSDT");
    expect(text).toContain("65000");
    expect(text).not.toMatch(/\$|USDT\s\d/); // sin dinero
  });

  it("en inglés el botón y el texto salen en inglés", async () => {
    db.tables.profiles[0].whatsapp_button = true;
    db.tables.profiles[0].lang = "en";
    const p = await send();
    expect(p.reply_markup.inline_keyboard[0][0].text).toBe("📲 Send to WhatsApp");
    expect(decodeURIComponent(p.reply_markup.inline_keyboard[0][0].url)).toContain("New signal");
  });

  it("el texto del resultado lleva el R y el activo", () => {
    expect(waResultText("ETHUSDT", "TP", 2.5, "es")).toContain("+2.5R");
    expect(waResultText("ETHUSDT", "SL", -1, "es")).toContain("−1.0R");
    expect(whatsappUrl("a b&c")).toBe("https://wa.me/?text=a%20b%26c");
  });

  it("/whatsapp on y off cambian el interruptor y /whatsapp solo explica cómo usarlo", async () => {
    await priv("/whatsapp on");
    expect(db.tables.profiles[0].whatsapp_button).toBe(true);
    expect(sent.at(-1)!.payload.text).toContain("WhatsApp");
    await priv("/whatsapp off");
    expect(db.tables.profiles[0].whatsapp_button).toBe(false);
    await priv("/whatsapp");
    expect(sent.at(-1)!.payload.text).toContain("/whatsapp on");
    expect(db.tables.profiles[0].whatsapp_button).toBe(false);
  });
});

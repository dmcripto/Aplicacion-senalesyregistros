import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
type Sent = { method: string; payload: any };
let sent: Sent[] = [];
let blocked = false;

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SIGNAL_IMAGES: "off", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", TELEGRAM_BOT_TOKEN: "TOKEN", TELEGRAM_WEBHOOK_SECRET: "SECRET" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/telegram-bot/index");
});

beforeEach(() => {
  resetDb({
    profiles: [{ id: "u1", lang: "es", capital: 1000, risk_pct: 1, currency: "USD" }],
    telegram_links: [], telegram_link_codes: [], telegram_pending: [],
  });
  sent = [];
  blocked = false;
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const method = String(url).split("/").pop()!;
    const payload = JSON.parse(init.body);
    sent.push({ method, payload });
    if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { username: "veltrix_bot" } }));
    if (blocked && method === "sendMessage") return new Response(JSON.stringify({ ok: false, error_code: 403 }));
    return new Response(JSON.stringify({ ok: true }));
  });
});

const update = (body: unknown, secret = "SECRET") =>
  handler(new Request("http://x/functions/v1/telegram-bot", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(body) }));
let uid = 0;
const msg = (text: string, chatId = 555, extra: any = {}) => update({ update_id: ++uid, message: { message_id: 1, chat: { id: chatId, type: "private" }, from: { id: chatId, language_code: "es" }, text, ...extra } });
const lastText = () => [...sent].reverse().find((s) => s.method === "sendMessage")?.payload.text as string;
const link = (chatId = 555) => db.tables.telegram_links.push({ user_id: "u1", chat_id: chatId });
const clientCall = async (body: unknown, token = "good") =>
  handler(new Request("http://x", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));

describe("seguridad del webhook", () => {
  it("rechaza pedidos de Telegram sin la cabecera secreta correcta", async () => {
    expect((await update({ update_id: 1, message: {} }, "otra")).status).toBe(401);
    expect(sent).toHaveLength(0);
  });
  it("ignora chats grupales", async () => {
    await update({ update_id: 2, message: { chat: { id: -100, type: "group" }, text: "BTCUSDT LONG entry 100 tp 110 sl 95" } });
    expect(db.tables.telegram_pending).toHaveLength(0);
  });
});

describe("vinculación", () => {
  it("la app pide un código y recibe el link del bot", async () => {
    expect((await clientCall({ action: "link" }, "malo")).status).toBe(401);
    const r = await (await clientCall({ action: "link" })).json();
    expect(r.ok).toBe(true);
    expect(r.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(r.url).toBe(`https://t.me/veltrix_bot?start=${r.code}`);
    // un nuevo pedido reemplaza al anterior
    await clientCall({ action: "link" });
    expect(db.tables.telegram_link_codes).toHaveLength(1);
  });

  it("/start CÓDIGO vincula el chat y consume el código", async () => {
    const { code } = await (await clientCall({ action: "link" })).json();
    await msg(`/start ${code}`);
    expect(db.tables.telegram_links).toEqual([expect.objectContaining({ user_id: "u1", chat_id: 555 })]);
    expect(db.tables.telegram_link_codes).toHaveLength(0);
    expect(lastText()).toMatch(/Telegram conectado/);
    // el mismo código no sirve dos veces
    await msg(`/start ${code}`, 999);
    expect(lastText()).toMatch(/no es válido/);
    expect(db.tables.telegram_links).toHaveLength(1);
  });

  it("un código vencido se rechaza", async () => {
    db.tables.telegram_link_codes.push({ code: "ABCDEFGH", user_id: "u1", expires_at: new Date(Date.now() - 1000).toISOString() });
    await msg("/start ABCDEFGH");
    expect(db.tables.telegram_links).toHaveLength(0);
    expect(lastText()).toMatch(/venció/);
  });

  it("un chat sin vincular recibe instrucciones y no registra nada", async () => {
    await msg("BTCUSDT LONG entry 100 tp 110 sl 95");
    expect(lastText()).toMatch(/todavía no está conectado/);
    expect(db.tables.telegram_pending).toHaveLength(0);
    expect(db.tables.trades).toHaveLength(0);
  });

  it("/desvincular borra la conexión", async () => {
    link();
    await msg("/desvincular");
    expect(db.tables.telegram_links).toHaveLength(0);
  });
});

describe("registrar señales", () => {
  beforeEach(link.bind(null, 555));

  it("interpreta la señal, pide confirmar y la registra una sola vez", async () => {
    await msg("#BTC/USDT LONG\nEntry: 65000\nTP: 66500\nSL: 64500");
    const preview = sent.find((s) => s.method === "sendMessage")!;
    expect(preview.payload.text).toMatch(/BTCUSDT/);
    expect(preview.payload.text).toMatch(/R:R 1:3\.0/);
    const buttons = preview.payload.reply_markup.inline_keyboard[0];
    expect(buttons[0].callback_data).toMatch(/^ok:/);
    expect(db.tables.trades).toHaveLength(0); // todavía nada

    const cb = (data: string) => update({ update_id: ++uid, callback_query: { id: "cb1", data, from: { id: 555 }, message: { message_id: 7, chat: { id: 555, type: "private" } } } });
    await cb(buttons[0].callback_data);
    expect(db.tables.trades).toEqual([expect.objectContaining({ user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 65000, tp: 66500, sl: 64500 })]);
    expect(sent.some((s) => s.method === "editMessageText" && /Señal registrada/.test(s.payload.text))).toBe(true);
    expect(sent.some((s) => s.method === "answerCallbackQuery")).toBe(true);

    await cb(buttons[0].callback_data); // Telegram repite el toque
    expect(db.tables.trades).toHaveLength(1);
  });

  it("cancelar no registra nada", async () => {
    await msg("BTCUSDT|COMPRA|100|110|95");
    const id = db.tables.telegram_pending[0].id;
    await update({ update_id: ++uid, callback_query: { id: "c", data: `no:${id}`, from: { id: 555 }, message: { message_id: 7, chat: { id: 555, type: "private" } } } });
    expect(db.tables.trades).toHaveLength(0);
    expect(db.tables.telegram_pending).toHaveLength(0);
  });

  it("un mensaje sin señal explica qué faltó", async () => {
    await msg("hola, cómo va?");
    expect(lastText()).toMatch(/No encontré una señal/);
    expect(db.tables.telegram_pending).toHaveLength(0);
  });

  it("varias señales en un mensaje", async () => {
    await msg("BTCUSDT|COMPRA|100|110|95\nETHUSDT|VENTA|50|45|53");
    expect(db.tables.telegram_pending[0].trades).toHaveLength(2);
    expect(lastText()).toMatch(/2 señales/);
  });

  it("no registra la misma señal dos veces en un minuto y respeta el límite", async () => {
    db.tables.trades.push({ user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 100, created_at: new Date().toISOString() });
    await msg("BTCUSDT|COMPRA|100|110|95");
    await update({ update_id: ++uid, callback_query: { id: "c", data: `ok:${db.tables.telegram_pending[0].id}`, from: { id: 555 }, message: { message_id: 7, chat: { id: 555, type: "private" } } } });
    expect(db.tables.trades).toHaveLength(1);
    expect(sent.some((s) => s.method === "editMessageText" && /ya estaba/.test(s.payload.text))).toBe(true);

    for (let i = 0; i < 20; i++) db.tables.trades.push({ user_id: "u1", symbol: `X${i}`, direction: "LONG", entry: i, created_at: new Date().toISOString() });
    await msg("ETHUSDT|VENTA|50|45|53");
    await update({ update_id: ++uid, callback_query: { id: "c", data: `ok:${db.tables.telegram_pending[0].id}`, from: { id: 555 }, message: { message_id: 8, chat: { id: 555, type: "private" } } } });
    expect(db.tables.trades.some((t) => t.symbol === "ETHUSDT")).toBe(false);
    expect(sent.some((s) => s.method === "editMessageText" && /Demasiadas/.test(s.payload.text))).toBe(true);
  });
});

describe("consultas", () => {
  beforeEach(link.bind(null, 555));
  const closed = (o: any) => ({ user_id: "u1", direction: "LONG", entry: 100, tp: 110, sl: 95, exit: null, closed_at: new Date().toISOString(), ...o });

  it("/abiertas lista las señales abiertas", async () => {
    db.tables.trades.push({ user_id: "u1", symbol: "SOLUSDT", direction: "LONG", entry: 150, tp: 158, sl: 146, outcome: "ABIERTA", date: new Date().toISOString() });
    await msg("/abiertas");
    expect(lastText()).toMatch(/SOLUSDT/);
    db.tables.trades.length = 0;
    await msg("/abiertas");
    expect(lastText()).toMatch(/no tenés señales abiertas/i);
  });

  it("/resumen suma el R y muestra el dinero estimado", async () => {
    db.tables.trades.push(closed({ outcome: "TP" }), closed({ outcome: "SL" }), closed({ outcome: "TP" }));
    await msg("/resumen");
    expect(lastText()).toMatch(/\+3R/);
    expect(lastText()).toMatch(/\+\$30\.00/);
    expect(lastText()).toMatch(/67% acierto/);
  });

  it("/idioma cambia el idioma del bot y del perfil", async () => {
    await msg("/idioma en");
    expect(db.tables.profiles[0].lang).toBe("en");
    expect(lastText()).toMatch(/English/);
    await msg("/open");
    expect(lastText()).toMatch(/no open signals/i);
    await msg("/language xx");
    expect(lastText()).toMatch(/Use \/language/);
  });
});

describe("/anunciar: publicar el aviso oficial en las comunidades", () => {
  const owner = () => { db.tables.profiles[0].bot_beta = true; };
  const community = (chat = -1001) => db.tables.telegram_communities.push({ id: `c${chat}`, user_id: "u1", chat_id: chat, thread_id: null });
  const to = (chat: number) => sent.filter((x) => x.method === "sendMessage" && x.payload.chat_id === chat);

  beforeEach(() => { db.tables.telegram_communities = []; });

  it("para una cuenta sin la llave el comando no existe (muestra la ayuda) y no publica nada", async () => {
    link(); community();
    await msg("/anunciar bot confirmar");
    expect(lastText()).toContain("Pegá acá una señal");
    expect(to(-1001)).toHaveLength(0);
  });

  it("en el chat privado solo muestra cómo se vería y explica dónde publicarlo, nunca publica", async () => {
    owner(); link(); community();
    await msg("/anunciar bot");
    expect(to(555).some((x) => x.payload.text.includes("BOT AUTOMÁTICO"))).toBe(true);
    expect(lastText()).toContain("«Noticias»");
    expect(lastText()).toContain("/anunciar bot confirmar");
    await msg("/anunciar bot confirmar");
    expect(to(-1001)).toHaveLength(0); // ni siquiera con «confirmar»: se publica desde el grupo
  });

  it("un aviso que no existe lista los disponibles", async () => {
    owner(); link(); community();
    await msg("/anunciar inventado confirmar");
    expect(lastText()).toContain("Avisos disponibles: bot");
    expect(to(-1001)).toHaveLength(0);
  });

  it("los textos de los avisos entran en un mensaje de Telegram", async () => {
    const { ANNOUNCEMENTS } = await import("../supabase/functions/_shared/announcements");
    for (const a of Object.values(ANNOUNCEMENTS)) for (const t of [a.es, a.en]) expect(t.length).toBeLessThan(4096);
  });
});

describe("/anunciar escrito dentro del grupo (en el tema Noticias)", () => {
  const group = (text: string, opts: { thread?: number; from?: number } = {}) =>
    update({ update_id: ++uid, message: { message_id: 9, chat: { id: -1002, type: "supergroup" }, from: { id: opts.from ?? 77, language_code: "es" }, text, ...(opts.thread ? { is_topic_message: true, message_thread_id: opts.thread } : {}) } });
  const posted = () => sent.filter((x) => x.method === "sendMessage" && x.payload.chat_id === -1002);
  let role = "administrator";

  beforeEach(() => {
    role = "administrator";
    db.tables.telegram_communities = [{ id: "c1", user_id: "u1", chat_id: -1002, thread_id: 5 }]; // conectado en otro tema (SEÑALES)
    db.tables.profiles[0].bot_beta = true;
    const base = (globalThis as any).fetch;
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      const method = String(url).split("/").pop()!;
      if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: role } }));
      return base(url, init);
    });
  });

  it("un administrador publica en el tema donde escribe el comando", async () => {
    await group("/anunciar bot confirmar", { thread: 9 });
    expect(posted()).toHaveLength(1);
    expect(posted()[0].payload.message_thread_id).toBe(9);
    expect(posted()[0].payload.text).toContain("BOT AUTOMÁTICO");
    expect(posted()[0].payload.text).toContain("veltrix-trading.vercel.app/app");
    expect(posted()[0].payload.text).not.toMatch(/\[[^\]]*\]|2FA|Authenticator/); // nada por completar ni funciones que todavía no existen
  });

  it("publica en inglés si la cuenta está en inglés", async () => {
    db.tables.profiles[0].lang = "en";
    await group("/announce bot confirm", { thread: 9 });
    expect(posted()[0].payload.text).toContain("AUTOMATIC BOT");
  });

  it("sin «confirmar» no publica el aviso: explica cómo hacerlo", async () => {
    await group("/anunciar bot", { thread: 9 });
    expect(posted()).toHaveLength(1);
    expect(posted()[0].payload.text).toContain("/anunciar bot confirmar");
    expect(posted()[0].payload.text).not.toContain("BOT AUTOMÁTICO");
  });

  it("quien no es administrador no logra nada (ni respuesta)", async () => {
    role = "member";
    await group("/anunciar bot confirmar", { thread: 9 });
    expect(posted()).toHaveLength(0);
  });

  it("en un grupo no conectado, o de una cuenta sin la llave, el comando no existe", async () => {
    db.tables.telegram_communities = [];
    await group("/anunciar bot confirmar");
    expect(posted()).toHaveLength(0);
    db.tables.telegram_communities = [{ id: "c1", user_id: "u1", chat_id: -1002, thread_id: null }];
    db.tables.profiles[0].bot_beta = false;
    await group("/anunciar bot confirmar");
    expect(posted()).toHaveLength(0);
  });
});

describe("/noticias: activar la agenda económica en el tema de noticias", () => {
  const group = (text: string, opts: { thread?: number } = {}) =>
    update({ update_id: ++uid, message: { message_id: 9, chat: { id: -1003, type: "supergroup" }, from: { id: 77, language_code: "es" }, text, ...(opts.thread ? { is_topic_message: true, message_thread_id: opts.thread } : {}) } });
  const posted = () => sent.filter((x) => x.method === "sendMessage" && x.payload.chat_id === -1003);
  let role = "administrator";

  beforeEach(() => {
    role = "administrator";
    db.tables.telegram_communities = [{ id: "c1", user_id: "u1", chat_id: -1003, thread_id: 5 }];
    const base = (globalThis as any).fetch;
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      const method = String(url).split("/").pop()!;
      if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: role } }));
      return base(url, init);
    });
  });

  it("un administrador lo activa en el tema donde escribe y el aviso sale en ese mismo tema", async () => {
    await group("/noticias", { thread: 12 });
    expect(db.tables.telegram_communities[0]).toMatchObject({ news_enabled: true, news_thread_id: 12, thread_id: 5 }); // las señales siguen en su tema
    expect(posted()[0].payload.message_thread_id).toBe(12);
    expect(posted()[0].payload.text).toContain("agenda económica");
  });

  it("/noticias off lo apaga", async () => {
    await group("/noticias", { thread: 12 });
    await group("/noticias off", { thread: 12 });
    expect(db.tables.telegram_communities[0]).toMatchObject({ news_enabled: false, news_thread_id: null });
  });

  it("quien no es administrador no cambia nada", async () => {
    role = "member";
    await group("/noticias", { thread: 12 });
    expect(db.tables.telegram_communities[0].news_enabled).toBeUndefined();
  });

  it("en un grupo que no está conectado explica cómo conectarlo", async () => {
    db.tables.telegram_communities = [];
    await group("/news", { thread: 12 });
    expect(posted()[0].payload.text).toContain("/comunidad");
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { communityResultMessage, communitySignalMessage, partialCardHtml, prettyPair, publishToCommunities, resultCardHtml, resultNote, signalCardHtml } from "../supabase/functions/_shared/community";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
type Sent = { method: string; payload: any };
let sent: Sent[] = [];
let memberStatus = "administrator";
let communityBlocked = false;

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SIGNAL_IMAGES: "off", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", TELEGRAM_BOT_TOKEN: "TOKEN", TELEGRAM_WEBHOOK_SECRET: "SECRET" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/telegram-bot/index");
});

const GROUP = -1001234;
beforeEach(() => {
  resetDb({
    profiles: [{ id: "u1", lang: "es" }],
    telegram_links: [], telegram_link_codes: [], telegram_pending: [], telegram_communities: [],
  });
  sent = [];
  memberStatus = "administrator";
  communityBlocked = false;
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const method = String(url).split("/").pop()!;
    const payload = JSON.parse(init.body);
    sent.push({ method, payload });
    if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { username: "veltrix_bot" } }));
    if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: memberStatus } }));
    if (communityBlocked && method === "sendMessage" && payload.chat_id === GROUP) return new Response(JSON.stringify({ ok: false, error_code: 403 }));
    return new Response(JSON.stringify({ ok: true }));
  });
});

let uid = 0;
const update = (body: unknown) =>
  handler(new Request("http://x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "SECRET" }, body: JSON.stringify(body) }));
const inGroup = (text: string, extra: any = {}) =>
  update({ update_id: ++uid, message: { message_id: 1, chat: { id: GROUP, type: "supergroup", title: "Comunidad VELTRIX" }, from: { id: 42, language_code: "es" }, text, ...extra } });
const inChannel = (text: string) => update({ update_id: ++uid, channel_post: { message_id: 1, chat: { id: -1009999, type: "channel", title: "Señales" }, text } });
const priv = (text: string, chatId = 555) =>
  update({ update_id: ++uid, message: { message_id: 1, chat: { id: chatId, type: "private" }, from: { id: chatId, language_code: "es" }, text } });
const client = (body: unknown) => handler(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer good" }, body: JSON.stringify(body) }));
const lastText = () => [...sent].reverse().find((s) => s.method === "sendMessage")?.payload.text as string;
const newCode = async () => (await (await client({ action: "community_code" })).json()) as { ok: boolean; code: string; command: string; addToGroupUrl: string; addToChannelUrl: string };

describe("conectar la comunidad", () => {
  it("la app pide un código y recibe el comando y los enlaces para agregar el bot", async () => {
    const r = await newCode();
    expect(r.ok).toBe(true);
    expect(r.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(r.command).toBe(`/comunidad@veltrix_bot ${r.code}`);
    expect(r.addToGroupUrl).toBe("https://t.me/veltrix_bot?startgroup=true&admin=delete_messages+pin_messages+invite_users+manage_topics+post_stories+edit_stories+delete_stories");
    expect(r.addToChannelUrl).toContain("startchannel=true");
    expect(db.tables.telegram_link_codes[0]).toMatchObject({ kind: "community", user_id: "u1" });
  });

  it("un administrador conecta el grupo con el código y el código se consume", async () => {
    const { code } = await newCode();
    await inGroup(`/comunidad ${code}`);
    expect(db.tables.telegram_communities).toEqual([expect.objectContaining({ user_id: "u1", chat_id: GROUP, title: "Comunidad VELTRIX" })]);
    expect(db.tables.telegram_link_codes).toHaveLength(0);
    expect(lastText()).toMatch(/Comunidad conectada/);
  });

  it("en un grupo con temas, se conecta al tema donde se escribió el comando y responde ahí", async () => {
    const { code } = await newCode();
    await inGroup(`/comunidad ${code}`, { is_topic_message: true, message_thread_id: 777 });
    expect(db.tables.telegram_communities).toEqual([expect.objectContaining({ chat_id: GROUP, thread_id: 777 })]);
    expect([...sent].reverse().find((s) => s.method === "sendMessage")?.payload.message_thread_id).toBe(777);
  });

  it("fuera de un tema (General) no guarda tema", async () => {
    const { code } = await newCode();
    await inGroup(`/comunidad ${code}`);
    expect(db.tables.telegram_communities[0].thread_id).toBeNull();
  });

  it("acepta el comando con el nombre del bot (/comunidad@bot CÓDIGO)", async () => {
    const { code } = await newCode();
    await inGroup(`/comunidad@veltrix_bot ${code}`);
    expect(db.tables.telegram_communities).toHaveLength(1);
  });

  it("alguien que no es administrador no puede conectar", async () => {
    memberStatus = "member";
    const { code } = await newCode();
    await inGroup(`/comunidad ${code}`);
    expect(db.tables.telegram_communities).toHaveLength(0);
    expect(lastText()).toMatch(/administrador/);
    expect(db.tables.telegram_link_codes).toHaveLength(1); // el código sigue sin usarse
  });

  it("un código vencido o inventado no conecta nada", async () => {
    await inGroup("/comunidad ABCD2345");
    expect(db.tables.telegram_communities).toHaveLength(0);
    const { code } = await newCode();
    db.tables.telegram_link_codes[0].expires_at = new Date(Date.now() - 1000).toISOString();
    await inGroup(`/comunidad ${code}`);
    expect(db.tables.telegram_communities).toHaveLength(0);
  });

  it("el código de comunidad no sirve para vincular un chat privado (y al revés)", async () => {
    const { code } = await newCode();
    await priv(`/start ${code}`);
    expect(db.tables.telegram_links).toHaveLength(0);
    const { code: priv_code } = await (await client({ action: "link" })).json();
    await inGroup(`/comunidad ${priv_code}`);
    expect(db.tables.telegram_communities).toHaveLength(0);
  });

  it("pedir un código de comunidad no pisa el código para vincular el celular", async () => {
    await client({ action: "link" });
    await newCode();
    expect(db.tables.telegram_link_codes.map((c) => c.kind).sort()).toEqual(["community", "private"]);
  });

  it("un canal se conecta desde una publicación de administrador", async () => {
    const { code } = await newCode();
    await inChannel(`/comunidad ${code}`);
    expect(db.tables.telegram_communities).toEqual([expect.objectContaining({ chat_id: -1009999, title: "Señales" })]);
  });

  it("/desconectarcomunidad lo desconecta (solo administradores)", async () => {
    db.tables.telegram_communities.push({ user_id: "u1", chat_id: GROUP });
    memberStatus = "member";
    await inGroup("/desconectarcomunidad");
    expect(db.tables.telegram_communities).toHaveLength(1);
    memberStatus = "creator";
    await inGroup("/desconectarcomunidad");
    expect(db.tables.telegram_communities).toHaveLength(0);
  });

  it("otros comandos en el grupo siguen respondiendo «escribime por privado»", async () => {
    await inGroup("/abiertas");
    expect(lastText()).toMatch(/privado/);
  });
});

describe("publicación", () => {
  const link = () => db.tables.telegram_links.push({ user_id: "u1", chat_id: 555 });

  it("al confirmar una señal por Telegram se publica en la comunidad, sin datos personales", async () => {
    link();
    db.tables.telegram_communities.push({ id: "c1", user_id: "u1", chat_id: GROUP });
    await priv("BTCUSDT LONG\nEntrada: 65000\nTP: 66500\nSL: 64500");
    const pending = db.tables.telegram_pending[0];
    await update({ update_id: ++uid, callback_query: { id: "cb", data: `ok:${pending.id}`, from: { id: 555 }, message: { message_id: 7, chat: { id: 555, type: "private" } } } });
    const posted = sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === GROUP);
    expect(posted).toHaveLength(1);
    expect(posted[0].payload.text).toContain("BTC/USDT");
    expect(posted[0].payload.text).toContain("65000");
    expect(posted[0].payload.text).toMatch(/no es asesoramiento financiero/);
    expect(posted[0].payload.text).not.toMatch(/u1|555/);
  });

  it("si la comunidad se conectó en un tema, publica en ese tema", async () => {
    link();
    db.tables.telegram_communities.push({ id: "c1", user_id: "u1", chat_id: GROUP, thread_id: 777 });
    await priv("BTCUSDT LONG\nEntrada: 65000\nTP: 66500\nSL: 64500");
    await update({ update_id: ++uid, callback_query: { id: "cb", data: `ok:${db.tables.telegram_pending[0].id}`, from: { id: 555 }, message: { message_id: 7, chat: { id: 555, type: "private" } } } });
    const posted = sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === GROUP);
    expect(posted).toHaveLength(1);
    expect(posted[0].payload.message_thread_id).toBe(777);
  });

  it("sin tema (canal o General) no manda message_thread_id", async () => {
    link();
    db.tables.telegram_communities.push({ id: "c1", user_id: "u1", chat_id: GROUP, thread_id: null });
    await priv("BTCUSDT LONG\nEntrada: 65000\nTP: 66500\nSL: 64500");
    await update({ update_id: ++uid, callback_query: { id: "cb", data: `ok:${db.tables.telegram_pending[0].id}`, from: { id: 555 }, message: { message_id: 7, chat: { id: 555, type: "private" } } } });
    const posted = sent.find((s) => s.method === "sendMessage" && s.payload.chat_id === GROUP)!;
    expect(posted.payload.message_thread_id).toBeUndefined();
  });

  it("sin comunidad conectada no publica nada", async () => {
    link();
    await priv("BTCUSDT LONG\nEntrada: 65000\nTP: 66500\nSL: 64500");
    await update({ update_id: ++uid, callback_query: { id: "cb", data: `ok:${db.tables.telegram_pending[0].id}`, from: { id: 555 }, message: { message_id: 7, chat: { id: 555, type: "private" } } } });
    expect(sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === GROUP)).toHaveLength(0);
  });
});

describe("mensajes y errores de la comunidad", () => {
  const trade = { symbol: "ETHUSDT", direction: "SHORT", entry: 3000, tp: 2900, sl: 3050 };

  it("la señal incluye activo, niveles, R:R y el aviso legal; en inglés también", () => {
    const es = communitySignalMessage(trade, "es");
    expect(es).toContain("NUEVA SEÑAL");
    expect(es).toContain("SHORT");
    expect(es).toContain("1 : 2.0");
    expect(communitySignalMessage(trade, "en")).toContain("not financial advice");
  });

  it("la señal muestra par, dirección, entrada, objetivo y stop con su distancia en % y el R:R", () => {
    const long = communitySignalMessage({ symbol: "XAUUSD", direction: "LONG", entry: 2000, tp: 2100, sl: 1950 }, "es");
    expect(long).toContain("XAU/USD"); // par legible
    expect(long).toContain("LONG 🟢");
    expect(long).toContain("Entrada ➡️ <b>2000</b>");
    expect(long).toContain("Target :- <b>2100</b>  <i>(+5.00%)</i>");
    expect(long).toContain("Stoploss = <b>1950</b>  <i>(−2.50%)</i>");
    expect(long).toContain("1 : 2.0");
    const short = communitySignalMessage(trade, "es"); // SHORT 3000 → TP 2900, SL 3050
    expect(short).toContain("SHORT 🔴");
    expect(short).toContain("+3.33%"); // TP a favor
    expect(short).toContain("−1.67%"); // SL en contra
  });

  it("el nombre del par se arma con barra y respeta lo que no reconoce", () => {
    expect(prettyPair("BTCUSDT")).toBe("BTC/USDT");
    expect(prettyPair("solusdt.p")).toBe("SOL/USDT.P");
    expect(prettyPair("AAPL")).toBe("AAPL");
  });

  it("un activo con símbolos raros no rompe el formato HTML", () => {
    expect(communitySignalMessage({ symbol: "A<B>&C", direction: "LONG", entry: 1, tp: 2, sl: 0.5 }, "es")).toContain("A&lt;B&gt;&amp;C");
  });

  it("el aviso privado va sin el aviso legal ni el enlace", () => {
    const m = signalCardHtml(trade, "es", { header: "🔔", disclaimer: false });
    expect(m).toContain("🔔");
    expect(m).not.toContain("asesoramiento");
    expect(m).not.toContain("href");
  });

  it("el resultado muestra TP o SL con su R", () => {
    expect(communityResultMessage("BTCUSDT", "TP", 3, "es")).toContain("+3.0R");
    expect(communityResultMessage("BTCUSDT", "SL", -1, "es")).toContain("−1.0R");
    expect(communityResultMessage("BTCUSDT", "SL", -1, "en")).toContain("SL HIT");
    expect(resultCardHtml("BTCUSDT", "TP", 2, "es", { label: "Cierre automático" })).toContain("Cierre automático: <b>+2.0R</b>");
  });

  it("si el bot ya no está en el grupo (403), borra la conexión y no rompe nada", async () => {
    db.tables.telegram_communities.push({ id: "c1", user_id: "u1", chat_id: GROUP }, { id: "c2", user_id: "u1", chat_id: -5 });
    communityBlocked = true;
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const n = await publishToCommunities(createClient("x", "y"), "TOKEN", "u1", () => "hola");
    expect(n).toBe(1); // la otra comunidad sí recibió
    expect(db.tables.telegram_communities.map((c) => c.id)).toEqual(["c2"]);
  });

  it("sin token del bot devuelve 0 sin llamar a nadie", async () => {
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    expect(await publishToCommunities(createClient("x", "y"), undefined, "u1", () => "x")).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("varios targets en los mensajes", () => {
  const t = { symbol: "HYPEUSDT", direction: "LONG", entry: 40.5, tp: 44, sl: 39.5, targets: [41.5, 42.5] };

  it("la señal lista Target 1, Target 2 y Target 3 (el último es el TP final)", () => {
    const m = signalCardHtml(t, "es");
    expect(m).toContain("Target 1 :- <b>41.5</b>  <i>(+2.47%)</i>");
    expect(m).toContain("Target 2 :- <b>42.5</b>");
    expect(m).toContain("Target 3 :- <b>44</b>  <i>(+8.64%)</i>");
    expect(m).toContain("1 : 3.5"); // R:R contra el TP final
    expect(signalCardHtml({ ...t, targets: undefined }, "es")).toContain("Target :- <b>44</b>"); // uno solo: sin número
  });

  it("el aviso de cada target dice su número y qué hacer", () => {
    expect(partialCardHtml(t, 41.5, 1, "es", { n: 1 })).toContain("TARGET 1 ALCANZADO");
    expect(partialCardHtml(t, 41.5, 1, "es", { n: 1 })).toContain("cerrar 50% y mover el SL a break-even");
    const two = partialCardHtml(t, 42.5, 2, "en", { n: 2 });
    expect(two).toContain("TARGET 2 HIT");
    expect(two).toContain("move the SL to Target 1");
  });

  it("el resultado aclara si el SL llegó antes del Target 1 o si fue directo al TP", () => {
    expect(resultNote("SL", 0, 2, "es")).toBe("SL tocado antes del Target 1");
    expect(resultNote("SL", 2, 2, "en")).toBe("Target 2 was reached before the SL");
    expect(resultNote("TP", 0, 1, "es")).toBe("Directo al TP, sin pasar por el Target 1");
    expect(resultNote("TP", 0, 3, "en")).toBe("Straight to TP, skipping the targets");
    expect(resultNote("TP", 1, 2, "es")).toBeNull();
    expect(resultNote("SL", 0, 0, "es")).toBeNull(); // sin targets no hay nada que aclarar
    expect(resultCardHtml("BTCUSDT", "SL", -1, "es", { note: "SL tocado antes del Target 1" })).toContain("⚠️ <i>SL tocado antes del Target 1</i>");
    expect(resultCardHtml("BTCUSDT", "TP", 2, "es", { note: "Directo al TP" })).toContain("⚡ <i>Directo al TP</i>");
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";
import { hasLink, inviteName } from "../supabase/functions/_shared/groupTools";
import { postWeeklyRanking } from "../supabase/functions/_shared/communityTools";
import { createClient } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
type Sent = { method: string; payload: any };
let sent: Sent[] = [];
let role = "member"; // rol que devuelve getChatMember
let linkSeq = 0;
const calls = (m: string) => sent.filter((s) => s.method === m);

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SIGNAL_IMAGES: "off", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "y", TELEGRAM_BOT_TOKEN: "TOKEN", TELEGRAM_WEBHOOK_SECRET: "SECRET" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/telegram-bot/index");
});

beforeEach(() => {
  resetDb({
    profiles: [{ id: "u1", lang: "es", bot_beta: true }, { id: "u2", lang: "es", bot_beta: false }],
    telegram_links: [{ user_id: "u1", chat_id: 555 }, { user_id: "u2", chat_id: 556 }],
    telegram_communities: [{ id: "c1", user_id: "u1", chat_id: -100, antispam: false }],
    group_invites: [], group_joins: [], economic_posts: [],
  });
  sent = [];
  role = "member";
  linkSeq = 0;
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const method = String(url).split("/").pop()!;
    const payload = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
    sent.push({ method, payload });
    if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: role } }));
    if (method === "createChatInviteLink") return new Response(JSON.stringify({ ok: true, result: { invite_link: `https://t.me/+link${++linkSeq}` } }));
    if (method === "sendMessage") return new Response(JSON.stringify({ ok: true, result: { message_id: 900 + sent.length } }));
    return new Response(JSON.stringify({ ok: true }));
  });
});

let uid = 0;
const update = (body: unknown) => handler(new Request("http://x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "SECRET" }, body: JSON.stringify(body) }));
const group = (text: string, from = 11, extra: any = {}) => update({ update_id: ++uid, message: { message_id: 50, chat: { id: -100, type: "supergroup" }, from: { id: from, first_name: "Ana", language_code: "es" }, text, ...extra } });
const priv = (text: string, chat = 555) => update({ update_id: ++uid, message: { message_id: 1, chat: { id: chat, type: "private" }, from: { id: chat, language_code: "es" }, text } });
const joined = (id: number, link?: string) => update({ update_id: ++uid, chat_member: { chat: { id: -100 }, old_chat_member: { status: "left" }, new_chat_member: { status: "member", user: { id, first_name: "Nuevo" } }, ...(link ? { invite_link: { invite_link: link } } : {}) } });
const lastText = () => [...sent].reverse().find((s) => s.method === "sendMessage")?.payload.text as string;

describe("ayudas puras", () => {
  it("detecta enlaces por entidad o por texto", () => {
    expect(hasLink({ text: "mirá https://estafa.com", entities: [{ type: "url" }] })).toBe(true);
    expect(hasLink({ text: "unite a t.me/spam" })).toBe(true);
    expect(hasLink({ text: "hola, ¿cómo andan?" })).toBe(false);
    expect(hasLink({ caption: "www.algo.com" })).toBe(true);
  });
  it("el nombre del enlace entra en 32 caracteres", () => {
    expect(inviteName({ first_name: "Ana" })).toBe("VELTRIX · Ana");
    expect(inviteName({ first_name: "Un nombre larguísimo que no entra en el límite" }).length).toBeLessThanOrEqual(32);
  });
});

describe("enlace de invitación por persona", () => {
  it("/miinvitacion crea el enlace una sola vez y lo guarda", async () => {
    await group("/miinvitacion");
    expect(calls("createChatInviteLink")).toHaveLength(1);
    expect(calls("createChatInviteLink")[0].payload).toMatchObject({ chat_id: -100, name: "VELTRIX · Ana" });
    expect(lastText()).toContain("https://t.me/+link1");
    await group("/miinvitacion");
    expect(calls("createChatInviteLink")).toHaveLength(1);
    expect(db.tables.group_invites).toHaveLength(1);
  });
  it("cuenta a quien entra con el enlace, una sola vez, y no a quien se invita a sí mismo", async () => {
    await group("/miinvitacion", 11);
    await joined(30, "https://t.me/+link1");
    await joined(30, "https://t.me/+link1"); // repetido
    await joined(11, "https://t.me/+link1"); // el mismo dueño
    await joined(31); // entró por otro lado
    expect(db.tables.group_invites[0].joins).toBe(1);
    expect(db.tables.group_joins.map((j: any) => [j.tg_user_id, j.invited_by])).toEqual([[30, 11], [11, null], [31, null]]);
    await group("/misinvitados", 11);
    expect(lastText()).toContain("<b>1</b> persona");
  });
  it("si primero llega el aviso del mensaje y después el del enlace, igual se atribuye y se cuenta una vez", async () => {
    await group("/miinvitacion", 11);
    await group("", 30, { text: undefined, new_chat_members: [{ id: 30, first_name: "Nuevo" }] });
    await joined(30, "https://t.me/+link1");
    await joined(30, "https://t.me/+link1");
    expect(db.tables.group_invites[0].joins).toBe(1);
    expect(db.tables.group_joins.find((j: any) => j.tg_user_id === 30).invited_by).toBe(11);
  });
  it("fuera de una comunidad conectada no hace nada", async () => {
    db.tables.telegram_communities = [];
    await group("/miinvitacion");
    expect(calls("createChatInviteLink")).toHaveLength(0);
  });
  it("sin el permiso o sin el SQL avisa en vez de romperse", async () => {
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      const method = String(url).split("/").pop()!;
      sent.push({ method, payload: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify(method === "createChatInviteLink" ? { ok: false, error_code: 400, description: "not enough rights" } : { ok: true, result: { message_id: 1 } }));
    });
    await group("/miinvitacion");
    expect(lastText()).toContain("Invitar con un enlace");
    expect(db.tables.group_invites).toHaveLength(0);
  });
});

describe("/fijar", () => {
  it("un administrador fija el mensaje al que responde", async () => {
    role = "administrator";
    await group("/fijar", 11, { reply_to_message: { message_id: 77 } });
    expect(calls("pinChatMessage")[0].payload).toMatchObject({ chat_id: -100, message_id: 77, disable_notification: true });
  });
  it("quien no es administrador no puede, y sin responder a un mensaje explica cómo", async () => {
    await group("/fijar", 11, { reply_to_message: { message_id: 77 } });
    expect(calls("pinChatMessage")).toHaveLength(0);
    role = "administrator";
    await group("/fijar");
    expect(lastText()).toContain("Respondé al mensaje");
  });
});

describe("filtro de enlaces de recién llegados", () => {
  const spam = { text: "ganá plata https://estafa.com", entities: [{ type: "url" }] };
  const msgWith = (from: number) => group(spam.text, from, { entities: spam.entities });

  it("apagado de fábrica: no borra nada", async () => {
    await joined(40);
    await msgWith(40);
    expect(calls("deleteMessage")).toHaveLength(0);
  });
  it("encendido: borra el enlace de quien entró hace menos de 24 h", async () => {
    role = "administrator";
    await group("/antispam on");
    expect(db.tables.telegram_communities[0].antispam).toBe(true);
    role = "member";
    await joined(40);
    await msgWith(40);
    expect(calls("deleteMessage")[0].payload).toMatchObject({ chat_id: -100, message_id: 50 });
  });
  it("no borra a veteranos, a administradores ni mensajes sin enlace", async () => {
    role = "administrator";
    await group("/antispam on");
    role = "member";
    await joined(40);
    db.tables.group_joins[0].joined_at = new Date(Date.now() - 30 * 3_600_000).toISOString(); // entró hace 30 h
    await msgWith(40);
    await joined(41);
    await group("hola a todos", 41);
    role = "administrator";
    await msgWith(41);
    expect(calls("deleteMessage")).toHaveLength(0);
  });
  it("solo los administradores lo prenden", async () => {
    await group("/antispam on");
    expect(db.tables.telegram_communities[0].antispam).toBe(false);
  });
});

describe("/webhook", () => {
  it("una cuenta habilitada vuelve a registrar el webhook con las entradas al grupo", async () => {
    await priv("/webhook");
    const w = calls("setWebhook")[0].payload;
    expect(w).toMatchObject({ url: "https://x.supabase.co/functions/v1/telegram-bot", secret_token: "SECRET" });
    expect(w.allowed_updates).toEqual(expect.arrayContaining(["message", "callback_query", "chat_member"]));
    expect(lastText()).toContain("Webhook actualizado");
  });
  it("una cuenta sin la llave beta no lo puede usar", async () => {
    await priv("/webhook", 556);
    expect(calls("setWebhook")).toHaveLength(0);
  });
});

describe("fijar el ranking semanal y los avisos", () => {
  const T0 = Date.parse("2026-10-11T23:30:00Z");
  const closed = { symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 110, sl: 95, date: new Date(T0 - 3e8).toISOString(), outcome: "TP", exit: null, closed_at: new Date(T0 - 8e7).toISOString(), source: null, notes: null };
  it("el ranking queda fijado y suelta el de la semana anterior", async () => {
    resetDb({ profiles: [{ id: "u1", lang: "es", timezone: "UTC" }], telegram_communities: [{ id: "c1", user_id: "u1", chat_id: -100, thread_id: 7, weekly_pin_id: 555 }], economic_posts: [], trades: [{ id: "t1", user_id: "u1", ...closed }] });
    const pins: Array<[number, number, number | null]> = [];
    const n = await postWeeklyRanking({ supabase: createClient() as any, send: async () => ({ ok: true, result: { message_id: 901 } }), pin: async (c, m, p) => { pins.push([c, m, p]); return true; } }, T0);
    expect(n).toBe(1);
    expect(pins).toEqual([[-100, 901, 555]]);
    expect(db.tables.telegram_communities[0].weekly_pin_id).toBe(901);
  });
  it("si no hay permiso para fijar, igual se publica", async () => {
    resetDb({ profiles: [{ id: "u1", lang: "es", timezone: "UTC" }], telegram_communities: [{ id: "c1", user_id: "u1", chat_id: -100 }], economic_posts: [], trades: [{ id: "t1", user_id: "u1", ...closed }] });
    const n = await postWeeklyRanking({ supabase: createClient() as any, send: async () => ({ ok: true, result: { message_id: 902 } }), pin: async () => false }, T0);
    expect(n).toBe(1);
    expect(db.tables.telegram_communities[0].weekly_pin_id).toBeUndefined();
  });
});

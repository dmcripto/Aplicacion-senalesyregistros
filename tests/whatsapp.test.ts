import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyWhatsApp, waDigits, waMask, waResultParams, waSignalParams, waTemplate, waValidPhone } from "../supabase/functions/_shared/waCloud";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
const ENV: Record<string, string | undefined> = {
  SIGNAL_IMAGES: "off",
  SUPABASE_URL: "x",
  SUPABASE_SERVICE_ROLE_KEY: "y",
  WHATSAPP_TOKEN: "WATOKEN",
  WHATSAPP_PHONE_ID: "PHONEID",
  WHATSAPP_VERIFY_TOKEN: "verifica-123",
  WHATSAPP_APP_SECRET: "appsecret",
};
type Call = { url: string; body: any };
let calls: Call[] = [];
let graphFail: { code: number } | null = null;

beforeAll(async () => {
  (globalThis as any).Deno = { env: { get: (k: string) => ENV[k] }, serve: (h: typeof handler) => { handler = h; } };
  await import("../supabase/functions/whatsapp/index");
});

const PHONE = "5491155550000";
const OTHER = "5491166660000";

beforeEach(() => {
  ENV.WHATSAPP_TOKEN = "WATOKEN";
  resetDb({ profiles: [{ id: "u1", lang: "es" }, { id: "u2", lang: "en" }], whatsapp_links: [], whatsapp_codes: [] });
  db.users.other = { id: "u2" };
  calls = [];
  graphFail = null;
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (graphFail) return new Response(JSON.stringify({ error: { code: graphFail.code, message: "falló" } }), { status: 400 });
    return new Response(JSON.stringify({ messages: [{ id: "wamid" }] }));
  });
});

const client = (body: unknown, tok = "good") =>
  handler(new Request("http://x", { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) }));
const sentCode = () => {
  const c = calls.find((x) => x.body?.template?.name === "veltrix_codigo")!;
  return c.body.template.components[0].parameters[0].text as string;
};

describe("ayudas de WhatsApp", () => {
  it("el número se limpia, se valida y se muestra enmascarado", () => {
    expect(waDigits("+54 9 11 5555-0000")).toBe("5491155550000");
    expect(waValidPhone("5491155550000")).toBe(true);
    expect(waValidPhone("0123")).toBe(false);
    expect(waValidPhone("123456")).toBe(false);
    expect(waMask("5491155550000")).toBe("+54 ••••••• 0000");
  });

  it("los valores de la plantilla de señal van en orden y en el idioma de la persona", () => {
    const t = { symbol: "BTCUSDT", direction: "LONG", entry: 65000, tp: 66500, sl: 64500 };
    expect(waSignalParams(t, "es")).toEqual(["BTC/USDT", "COMPRA (LONG)", "65000", "66500", "64500", "3.0"]);
    expect(waSignalParams({ ...t, direction: "SHORT" }, "en")[1]).toBe("SELL (SHORT)");
    expect(waResultParams("ETHUSDT", "SL", -1, "es")).toEqual(["ETH/USDT", "SL alcanzado ❌", "−1.0R"]);
    expect(waResultParams("ETHUSDT", "TP", 2.5, "en")).toEqual(["ETH/USDT", "TP hit ✅", "+2.5R"]);
  });

  it("el mensaje de plantilla limpia saltos de línea y agrega el botón del código solo si se pide", () => {
    const m: any = waTemplate(PHONE, "veltrix_senal", "es", ["a\nb   c"]);
    expect(m.template.components).toHaveLength(1);
    expect(m.template.components[0].parameters[0].text).toBe("a b c");
    const code: any = waTemplate(PHONE, "veltrix_codigo", "es", ["123456"], "123456");
    expect(code.template.components[1]).toMatchObject({ type: "button", sub_type: "url", index: "0" });
  });
});

describe("vincular el número con un código", () => {
  it("sin configuración de Meta, WhatsApp queda apagado (status lo avisa y el resto se rechaza)", async () => {
    ENV.WHATSAPP_TOKEN = undefined;
    expect(await (await client({ action: "status" })).json()).toMatchObject({ ok: true, configured: false, link: null });
    const r = await client({ action: "start", phone: PHONE });
    expect(r.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("pide sesión válida", async () => {
    expect((await client({ action: "status" }, "mala")).status).toBe(401);
  });

  it("start manda el código por WhatsApp con la plantilla de códigos y guarda solo un resumen", async () => {
    const r = await client({ action: "start", phone: "+54 9 11 5555-0000" });
    expect(await r.json()).toMatchObject({ ok: true, minutes: 10 });
    const call = calls[0];
    expect(call.url).toContain("/PHONEID/messages");
    expect(call.body).toMatchObject({ messaging_product: "whatsapp", to: PHONE, type: "template" });
    const code = sentCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(call.body.template.components[1].parameters[0].text).toBe(code); // botón «copiar código»
    const saved = db.tables.whatsapp_codes[0];
    expect(saved.phone).toBe(PHONE);
    expect(JSON.stringify(saved)).not.toContain(code); // el código no se guarda
  });

  it("rechaza un número mal escrito sin mandar nada", async () => {
    const r = await client({ action: "start", phone: "12345" });
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("no deja pedir códigos seguidos ni más de 5 por día", async () => {
    expect((await client({ action: "start", phone: PHONE })).status).toBe(200);
    expect((await client({ action: "start", phone: PHONE })).status).toBe(429); // menos de un minuto
    for (let i = 0; i < 4; i++) {
      db.tables.whatsapp_codes[0].last_sent_at = new Date(Date.now() - 120_000).toISOString();
      expect((await client({ action: "start", phone: PHONE })).status).toBe(200);
    }
    db.tables.whatsapp_codes[0].last_sent_at = new Date(Date.now() - 120_000).toISOString();
    const r = await client({ action: "start", phone: PHONE });
    expect(r.status).toBe(429); // sexto código del día
    expect(calls.filter((c) => c.body?.template).length).toBe(5);
  });

  it("un mismo número no puede recibir más de 5 códigos por día aunque lo pidan cuentas distintas", async () => {
    db.tables.whatsapp_codes.push({ user_id: "otro", phone: PHONE, code_hash: "x", expires_at: new Date(Date.now() + 1e6).toISOString(), attempts: 0, last_sent_at: new Date(0).toISOString(), day: new Date().toISOString().slice(0, 10), sent_today: 5 });
    expect((await client({ action: "start", phone: PHONE })).status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it("si Meta rechaza el envío, avisa con un mensaje entendible (modo de prueba: número no autorizado)", async () => {
    graphFail = { code: 131030 };
    const r = await client({ action: "start", phone: PHONE });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("modo de prueba");
  });

  it("verify con el código correcto vincula el número y borra el código", async () => {
    await client({ action: "start", phone: PHONE });
    const r = await client({ action: "verify", code: sentCode() });
    expect(await r.json()).toMatchObject({ ok: true, link: { phone: "+54 ••••••• 0000", enabled: true } });
    expect(db.tables.whatsapp_links).toEqual([expect.objectContaining({ user_id: "u1", phone: PHONE, enabled: true })]);
    expect(db.tables.whatsapp_codes).toHaveLength(0);
  });

  it("un código incorrecto no vincula y tras 5 intentos hay que pedir otro", async () => {
    await client({ action: "start", phone: PHONE });
    const good = sentCode();
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await client({ action: "verify", code: bad })).status).toBe(400);
    const r = await client({ action: "verify", code: good }); // ya bloqueado: ni el correcto sirve
    expect(r.status).toBe(429);
    expect(db.tables.whatsapp_links).toHaveLength(0);
  });

  it("un código vencido se rechaza", async () => {
    await client({ action: "start", phone: PHONE });
    db.tables.whatsapp_codes[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await client({ action: "verify", code: sentCode() })).status).toBe(400);
  });

  it("el código de una persona no sirve para otra cuenta", async () => {
    await client({ action: "start", phone: PHONE });
    const code = sentCode();
    expect((await client({ action: "verify", code }, "other")).status).toBe(400); // la otra cuenta no pidió código
    expect(db.tables.whatsapp_links).toHaveLength(0);
  });

  it("un número pertenece a una sola cuenta: al vincularlo en otra, se desvincula de la anterior", async () => {
    db.tables.whatsapp_links.push({ user_id: "u2", phone: PHONE, enabled: true });
    await client({ action: "start", phone: PHONE });
    await client({ action: "verify", code: sentCode() });
    expect(db.tables.whatsapp_links).toEqual([expect.objectContaining({ user_id: "u1", phone: PHONE })]);
  });

  it("status muestra el número enmascarado; toggle pausa y reanuda; unlink desvincula", async () => {
    db.tables.whatsapp_links.push({ user_id: "u1", phone: PHONE, enabled: true });
    expect(await (await client({ action: "status" })).json()).toMatchObject({ configured: true, link: { phone: "+54 ••••••• 0000", enabled: true } });
    await client({ action: "toggle", enabled: false });
    expect(db.tables.whatsapp_links[0].enabled).toBe(false);
    await client({ action: "toggle", enabled: true });
    expect(db.tables.whatsapp_links[0].enabled).toBe(true);
    await client({ action: "unlink" });
    expect(db.tables.whatsapp_links).toHaveLength(0);
  });
});

describe("webhook de Meta", () => {
  const sign = (raw: string) => `sha256=${createHmac("sha256", "appsecret").update(raw).digest("hex")}`;
  const inbound = (text: string, from = PHONE, signature?: string) => {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, type: "text", text: { body: text } }] } }] }] });
    return handler(new Request("http://x", { method: "POST", headers: { "x-hub-signature-256": signature ?? sign(raw) }, body: raw }));
  };

  it("verificación: contesta el desafío solo con el token correcto", async () => {
    const ok = await handler(new Request("http://x/?hub.mode=subscribe&hub.verify_token=verifica-123&hub.challenge=abc"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("abc");
    expect((await handler(new Request("http://x/?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=abc"))).status).toBe(403);
  });

  it("rechaza mensajes sin firma válida y no toca nada", async () => {
    db.tables.whatsapp_links.push({ user_id: "u1", phone: PHONE, enabled: true });
    expect((await inbound("BAJA", PHONE, "sha256=mala")).status).toBe(403);
    expect(db.tables.whatsapp_links[0].enabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("BAJA pausa los avisos y contesta; ALTA los reanuda", async () => {
    db.tables.whatsapp_links.push({ user_id: "u1", phone: PHONE, enabled: true });
    expect((await inbound(" Baja! ")).status).toBe(200);
    expect(db.tables.whatsapp_links[0].enabled).toBe(false);
    expect(calls[0].body).toMatchObject({ to: PHONE, type: "text" });
    expect(calls[0].body.text.body).toContain("no vas a recibir más avisos");
    await inbound("ALTA");
    expect(db.tables.whatsapp_links[0].enabled).toBe(true);
    expect(calls[1].body.text.body).toContain("volvés a recibir");
  });

  it("contesta en inglés a quien tiene la cuenta en inglés, ignora otros textos y números sin cuenta", async () => {
    db.tables.whatsapp_links.push({ user_id: "u2", phone: OTHER, enabled: true });
    await inbound("stop", OTHER);
    expect(calls[0].body.text.body).toContain("no longer get");
    calls = [];
    await inbound("hola, ¿qué tal?", OTHER);
    await inbound("baja", "5491100000000"); // sin cuenta vinculada
    expect(calls).toHaveLength(0);
    expect(db.tables.whatsapp_links[0].enabled).toBe(false);
  });
});

describe("avisar por WhatsApp", () => {
  const signal = () => ({ kind: "signal" as const, params: waSignalParams({ symbol: "BTCUSDT", direction: "LONG", entry: 65000, tp: 66500, sl: 64500 }, "es") });
  const run = async () => {
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    await notifyWhatsApp(createClient("x", "y"), "u1", () => signal());
  };

  it("manda la plantilla de señal al número vinculado", async () => {
    db.tables.whatsapp_links.push({ user_id: "u1", phone: PHONE, enabled: true });
    await run();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ to: PHONE, type: "template", template: { name: "veltrix_senal", language: { code: "es" } } });
    expect(calls[0].body.template.components[0].parameters.map((p: any) => p.text)).toEqual(["BTC/USDT", "COMPRA (LONG)", "65000", "66500", "64500", "3.0"]);
  });

  it("no manda nada si no hay número, está pausado o falta la configuración de Meta", async () => {
    await run();
    db.tables.whatsapp_links.push({ user_id: "u1", phone: PHONE, enabled: false });
    await run();
    db.tables.whatsapp_links[0].enabled = true;
    ENV.WHATSAPP_TOKEN = undefined;
    await run();
    expect(calls).toHaveLength(0);
  });

  it("si el número no puede recibir mensajes (131026) se pausa; un error cualquiera no rompe nada", async () => {
    db.tables.whatsapp_links.push({ user_id: "u1", phone: PHONE, enabled: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    graphFail = { code: 500 };
    await run();
    expect(db.tables.whatsapp_links[0].enabled).toBe(true);
    graphFail = { code: 131026 };
    await run();
    expect(db.tables.whatsapp_links[0].enabled).toBe(false);
  });
});

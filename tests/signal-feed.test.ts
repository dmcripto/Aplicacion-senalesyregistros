import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
let fanOutSignal: typeof import("../supabase/functions/_shared/signalFeed").fanOutSignal;
let calls: Array<{ url: string; body: any }> = [];

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => (({ SIGNAL_IMAGES: "off", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", TELEGRAM_BOT_TOKEN: "TOKEN" } as Record<string, string | undefined>)[k]) },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/tradingview-webhook/index");
  ({ fanOutSignal } = await import("../supabase/functions/_shared/signalFeed"));
});

const EMISOR = "5bb21911-8f42-49a2-9fc7-8b18a7be8278";
const COMUN = "6cc32a22-9f53-4ab3-8fc8-9c8a8be9389f";
const post = (body: string, tok = EMISOR) => handler(new Request(`http://x/functions/v1/tradingview-webhook/${tok}`, { method: "POST", body }));
const tg = () => calls.filter((c) => c.url.includes("api.telegram.org"));
const push = () => calls.filter((c) => c.url.includes("exp.host")).flatMap((c) => c.body as any[]);
const copies = () => db.tables.trades.filter((t) => t.source === "veltrix");

beforeEach(() => {
  calls = [];
  resetDb({
    profiles: [
      { id: "u1", webhook_token: EMISOR, lang: "es", signal_provider: true, follow_signals: false },
      { id: "u2", webhook_token: COMUN, lang: "es", signal_provider: false, follow_signals: false },
      { id: "s1", lang: "es", follow_signals: true },
      { id: "s2", lang: "en", follow_signals: true },
      { id: "n1", lang: "es", follow_signals: false },
    ],
    device_tokens: [
      { user_id: "u1", expo_push_token: "ExponentPushToken[emisor]" },
      { user_id: "s1", expo_push_token: "ExponentPushToken[s1]" },
      { user_id: "s2", expo_push_token: "ExponentPushToken[s2]" },
      { user_id: "n1", expo_push_token: "ExponentPushToken[n1]" },
    ],
    telegram_links: [{ user_id: "s1", chat_id: 111 }, { user_id: "n1", chat_id: 999 }],
    telegram_communities: [],
  });
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true }));
  });
});

describe("Señales de VELTRIX: reparto a quienes lo activaron", () => {
  it("copia la señal del emisor solo a quienes la siguen, con la fuente 'veltrix'", async () => {
    const r = await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500");
    expect(r.status).toBe(201);
    const own = db.tables.trades.find((t) => t.user_id === "u1")!;
    expect(own.source).toBeUndefined(); // la del emisor sigue siendo suya
    expect(copies().map((t) => t.user_id).sort()).toEqual(["s1", "s2"]);
    for (const c of copies()) {
      expect(c).toMatchObject({ symbol: "BTCUSDT", direction: "LONG", entry: 65000, tp: 66500, sl: 64500, external_id: own.id });
    }
    expect(db.tables.trades.some((t) => t.user_id === "n1")).toBe(false);
  });

  it("avisa por push en el idioma de cada persona y por Telegram a quien lo vinculó", async () => {
    await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500");
    const p = push();
    const to = (t: string) => p.find((m) => m.to === `ExponentPushToken[${t}]`);
    expect(to("s1")).toMatchObject({ title: "BTCUSDT · COMPRA" });
    expect(to("s2")).toMatchObject({ title: "BTCUSDT · BUY" });
    expect(to("n1")).toBeUndefined();
    expect(to("s1").data.tradeId).toBe(copies().find((t) => t.user_id === "s1")!.id);
    // Telegram: solo s1 lo vinculó (n1 no sigue las señales: no recibe nada)
    expect(tg().map((c) => c.body.chat_id)).toEqual([111]);
    expect(tg()[0].body.text).toMatch(/NUEVA SEÑAL/);
  });

  it("una cuenta común no reparte nada", async () => {
    expect((await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500", COMUN)).status).toBe(201);
    expect(copies()).toHaveLength(0);
    expect(push().map((m) => m.to)).not.toContain("ExponentPushToken[s1]");
  });

  it("copia también los targets parciales", async () => {
    await post("VELTRIX|BTCUSDT|COMPRA|65000|66000/67000/68000|64500");
    expect(copies()[0]).toMatchObject({ tp: 68000, targets: [66000, 67000] });
  });

  it("una persona recibe cada señal una sola vez, aunque se repita el reparto", async () => {
    const sig = { symbol: "ETHUSDT", direction: "SHORT" as const, entry: 3000, tp: 2900, sl: 3050 };
    const a = await fanOutSignal(createClient() as any, "u1", "t-1", sig, new Date().toISOString());
    expect(a).toEqual({ followers: 2, copied: 2 });
    calls = [];
    const b = await fanOutSignal(createClient() as any, "u1", "t-1", sig, new Date().toISOString());
    expect(b.copied).toBe(0);
    expect(push()).toHaveLength(0);
    expect(copies()).toHaveLength(2);
  });

  it("el emisor no se copia a sí mismo aunque también la siga", async () => {
    db.tables.profiles[0].follow_signals = true;
    await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500");
    expect(copies().map((t) => t.user_id)).not.toContain("u1");
  });

  it("si todavía no se corrió el SQL, la señal del emisor se guarda igual y no se reparte", async () => {
    db.missingSelect = ["signal_provider"];
    for (const p of db.tables.profiles) delete p.signal_provider; // la columna no existe en ninguna fila
    const r = await post("VELTRIX|BTCUSDT|COMPRA|65000|66500|64500");
    expect(r.status).toBe(201);
    expect(copies()).toHaveLength(0);
  });

  it("si faltan los targets en la base, la copia se guarda igual con el TP final", async () => {
    db.missingColumns = ["targets"];
    await post("VELTRIX|BTCUSDT|COMPRA|65000|66000/67000/68000|64500");
    expect(copies()).toHaveLength(2);
    expect(copies()[0].tp).toBe(68000);
  });

  it("reparte a más de una tanda de personas", async () => {
    db.tables.profiles.push(...Array.from({ length: 600 }, (_, i) => ({ id: `m${String(i).padStart(3, "0")}`, lang: "es", follow_signals: true })));
    const r = await fanOutSignal(createClient() as any, "u1", "t-2", { symbol: "SOLUSDT", direction: "LONG", entry: 100, tp: 110, sl: 95 }, new Date().toISOString());
    expect(r).toEqual({ followers: 602, copied: 602 });
  });
});

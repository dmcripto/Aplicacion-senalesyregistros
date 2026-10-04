import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: () => Promise<Response>;
type Sent = { method: string; payload: any };
let sent: Sent[] = [];
let candles: number[][] = [];

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SIGNAL_IMAGES: "off", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", TELEGRAM_BOT_TOKEN: "TOKEN" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/auto-close/index");
});

const minutesAgo = (m: number) => Date.now() - m * 60_000;
// Una operación LONG abierta hace 20 min: entrada 100, TP 130, SL 90 → el Target 1 queda en 110.
const trade = (over: Record<string, unknown> = {}) => ({
  id: "t1", user_id: "u1", symbol: "BTCUSDT", direction: "LONG", entry: 100, tp: 130, sl: 90,
  date: new Date(minutesAgo(20)).toISOString(), outcome: "ABIERTA", targets: null, targets_hit: 0, ...over,
});
const row = (minAgo: number, h: number, l: number) => [minutesAgo(minAgo), "100", String(h), String(l), "100"];

beforeEach(() => {
  resetDb({
    profiles: [{ id: "u1", lang: "es", auto_close: true, partial_alerts: true }],
    trades: [trade()],
    telegram_links: [{ user_id: "u1", chat_id: 555 }],
    telegram_communities: [{ id: "c1", user_id: "u1", chat_id: -100, thread_id: 7 }],
    auto_close_runs: [],
  });
  sent = [];
  candles = [row(5, 112, 99)]; // tocó 110 hace 5 minutos y sigue abierta
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const u = String(url);
    if (u.includes("klines")) return new Response(JSON.stringify(candles));
    if (u.includes("api.telegram.org")) {
      sent.push({ method: u.split("/").pop()!, payload: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response("{}");
  });
});

const run = async () => {
  db.tables.auto_close_runs = []; // sin esperar los 25 s entre corridas
  return handler();
};
const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.payload.text as string);

describe("aviso de Target 1 en el cierre automático", () => {
  it("avisa a la persona y a la comunidad (en su tema) y marca la operación", async () => {
    await run();
    const msgs = texts();
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.includes("TARGET 1 ALCANZADO") && m.includes("BTC/USDT") && m.includes("+10.00%") && m.includes("+1.0R"))).toBe(true);
    expect(msgs.some((m) => m.includes("🔔") && !m.includes("asesoramiento"))).toBe(true); // aviso privado
    expect(msgs.some((m) => m.includes("🎯") && m.includes("asesoramiento"))).toBe(true); // comunidad
    expect(sent.find((s) => s.payload.chat_id === -100)!.payload.message_thread_id).toBe(7);
    expect(db.tables.trades[0].targets_hit).toBe(1);
    expect(db.tables.trades[0].outcome).toBe("ABIERTA"); // sigue abierta: solo es un aviso
  });

  it("avisa una sola vez por operación", async () => {
    await run();
    sent = [];
    await run();
    expect(sent).toHaveLength(0);
  });

  it("si el nivel se tocó hace rato (al activar la función) solo la marca, sin avisar", async () => {
    db.tables.trades[0].date = new Date(minutesAgo(300)).toISOString();
    candles = [row(120, 112, 99)];
    await run();
    expect(sent).toHaveLength(0);
    expect(db.tables.trades[0].targets_hit).toBe(1);
  });

  it("no avisa si la persona apagó el aviso", async () => {
    db.tables.profiles[0].partial_alerts = false;
    await run();
    expect(sent).toHaveLength(0);
    expect(db.tables.trades[0].targets_hit).toBe(0);
  });

  it("no avisa si todavía no llegó al nivel ni si el SL se tocó primero (esa se cierra por SL)", async () => {
    candles = [row(5, 108, 99)];
    await run();
    expect(sent).toHaveLength(0);
    candles = [row(8, 105, 89), row(5, 115, 100)];
    await run();
    expect(db.tables.trades[0].outcome).toBe("SL");
    expect(texts().some((m) => m.includes("TARGET 1"))).toBe(false);
  });

  it("si la operación llega directo al TP se cierra y no se manda el aviso del Target 1", async () => {
    candles = [row(5, 131, 99)];
    await run();
    expect(db.tables.trades[0].outcome).toBe("TP");
    expect(texts().some((m) => m.includes("TARGET 1"))).toBe(false);
    expect(texts().some((m) => m.includes("TP ALCANZADO"))).toBe(true);
    expect(texts().every((m) => m.includes("Directo al TP, sin pasar por el Target 1"))).toBe(true); // aviso de que se saltó el Target 1
  });

  it("con el TP cerca (menos de 1,5R) no hay aviso de Target 1", async () => {
    db.tables.trades[0].tp = 112;
    candles = [row(5, 111, 99)];
    await run();
    expect(sent).toHaveLength(0);
  });
});

describe("targets múltiples (TP1, TP2, TP3…)", () => {
  // Entrada 100, TP final 130, SL 90, targets propios en 105 y 115.
  const withTargets = (over: Record<string, unknown> = {}) => trade({ targets: [105, 115], ...over });

  it("avisa cada target por separado y en orden, con la gestión sugerida de cada uno", async () => {
    db.tables.trades = [withTargets()];
    candles = [row(8, 106, 99), row(5, 116, 104)];
    await run();
    const msgs = texts();
    expect(msgs).toHaveLength(4); // 2 targets × (persona + comunidad)
    expect(msgs.filter((m) => m.includes("TARGET 1 ALCANZADO") && m.includes("+5.00%") && m.includes("cerrar 50%"))).toHaveLength(2);
    expect(msgs.filter((m) => m.includes("TARGET 2 ALCANZADO") && m.includes("+15.00%") && m.includes("mover el SL al Target 1"))).toHaveLength(2);
    expect(msgs.findIndex((m) => m.includes("TARGET 1"))).toBeLessThan(msgs.findIndex((m) => m.includes("TARGET 2")));
    expect(db.tables.trades[0].targets_hit).toBe(2);
    expect(db.tables.trades[0].outcome).toBe("ABIERTA");
  });

  it("cada target se avisa una sola vez: si después llega el siguiente solo se avisa ese", async () => {
    db.tables.trades = [withTargets()];
    candles = [row(8, 106, 99)];
    await run();
    expect(texts().filter((m) => m.includes("TARGET 1"))).toHaveLength(2);
    sent = [];
    candles = [row(8, 106, 99), row(2, 117, 105)];
    await run();
    expect(texts().every((m) => m.includes("TARGET 2 ALCANZADO"))).toBe(true);
    expect(texts()).toHaveLength(2);
    expect(db.tables.trades[0].targets_hit).toBe(2);
  });

  it("los targets propios reemplazan al Target 1 automático de 1R", async () => {
    db.tables.trades = [withTargets()];
    candles = [row(5, 108, 99)]; // pasó el 105 pero no el 110 (1R)
    await run();
    expect(texts().every((m) => m.includes("TARGET 1 ALCANZADO") && m.includes("+5.00%"))).toBe(true);
    expect(texts()).toHaveLength(2);
  });

  it("SL tocado antes del Target 1: el resultado lo aclara (persona y comunidad)", async () => {
    db.tables.trades = [withTargets()];
    candles = [row(5, 104, 89)];
    await run();
    expect(db.tables.trades[0].outcome).toBe("SL");
    expect(texts()).toHaveLength(2);
    expect(texts().every((m) => m.includes("SL ALCANZADO") && m.includes("SL tocado antes del Target 1"))).toBe(true);
  });

  it("SL tocado después de haber llegado a un target: el resultado lo cuenta", async () => {
    db.tables.trades = [withTargets({ targets_hit: 1 })];
    candles = [row(8, 106, 99), row(5, 104, 89)];
    await run();
    expect(db.tables.trades[0].outcome).toBe("SL");
    expect(texts().every((m) => m.includes("Había llegado al Target 1 antes del SL"))).toBe(true);
  });

  it("directo al TP con varios targets: se cierra y avisa que no pasó por los targets", async () => {
    db.tables.trades = [withTargets()];
    candles = [row(5, 131, 99)];
    await run();
    expect(db.tables.trades[0].outcome).toBe("TP");
    expect(texts().every((m) => m.includes("Directo al TP, sin pasar por los targets"))).toBe(true);
    expect(texts().some((m) => m.includes("TARGET 1 ALCANZADO"))).toBe(false);
  });

  it("TP después de pasar por los targets: sin aviso de «directo»", async () => {
    db.tables.trades = [withTargets({ targets_hit: 2 })];
    candles = [row(10, 116, 99), row(5, 131, 110)];
    await run();
    expect(db.tables.trades[0].outcome).toBe("TP");
    expect(texts().some((m) => m.includes("Directo al TP"))).toBe(false);
  });

  it("sin targets (TP cerca) no hay notas en el resultado", async () => {
    db.tables.trades = [trade({ tp: 112 })];
    candles = [row(5, 104, 89)];
    await run();
    expect(texts().every((m) => !m.includes("antes del Target"))).toBe(true);
  });
});

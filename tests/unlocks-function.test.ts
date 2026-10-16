import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
const CRON = "secreto-de-segundo-plano-123";
const DAY = 86_400_000;

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", EXCHANGE_CRON_SECRET: CRON, TOKENOMIST_API_KEY: "clave-de-prueba" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/unlocks/index");
});

const call = async (body: unknown = {}, headers: Record<string, string> = {}) => {
  const r = await handler(new Request("http://x/functions/v1/unlocks", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as any };
};

let calls: string[] = [];
beforeEach(() => {
  resetDb({ token_unlocks: [], unlock_raw: [], unlock_history: [] });
  calls = [];
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  vi.stubGlobal("fetch", async (url: any) => {
    const u = new URL(String(url));
    calls.push(u.pathname);
    const j = (b: unknown) => new Response(JSON.stringify(b));
    if (u.pathname === "/v5/token/list") return j({ status: true, data: [{ id: "layerzero", symbol: "ZRO" }, { id: "arbitrum", symbol: "ARB" }] });
    if (u.pathname.startsWith("/v5/unlock/events/")) {
      const now = Date.now();
      // cuatro desbloqueos mensuales ya ocurridos: el último hace 10 días
      return j({ status: true, data: [3, 2, 1, 0].map((i) => ({ unlockDate: new Date(now - (10 + i * 30) * DAY).toISOString(), cliffUnlocks: { valueToMarketCap: 3 } })) });
    }
    if (u.pathname === "/v5/unlock/events/upcoming") return j({ status: true, data: [], metadata: { totalPages: 1 } });
    return new Response("{}", { status: 404 });
  });
});

/** Las esperas entre pedidos (1,1 s) se adelantan con el reloj de prueba. */
async function withTimers<T>(p: Promise<T>): Promise<T> {
  const t = setInterval(() => vi.advanceTimersByTime(1200), 1);
  try {
    return await p;
  } finally {
    clearInterval(t);
  }
}

describe("función unlocks: aprender del período de prueba", () => {
  it("baja la lista de tokens y los eventos de cada uno, guarda las respuestas y el historial, y proyecta el ritmo mensual", async () => {
    const r = await withTimers(call({ learn: true }));
    expect(r.status).toBe(200);
    expect(r.body.learn).toMatchObject({ tokens: 2, fetched: 2, pending: 0 });
    expect(db.tables.unlock_raw.filter((x) => x.kind === "tokens")).toHaveLength(1);
    expect(db.tables.unlock_raw.filter((x) => x.kind === "events").map((x) => x.token).sort()).toEqual(["arbitrum", "layerzero"]);
    expect(db.tables.unlock_history.filter((x) => x.symbol === "ZROUSDT")).toHaveLength(4);
    const proj = db.tables.token_unlocks.filter((x) => x.source === "projected");
    expect(proj.map((x) => x.symbol).sort()).toEqual(["ARBUSDT", "ZROUSDT"]);
    expect(proj[0].pct).toBe(3);
  });

  it("no vuelve a pedir un token ya bajado (la cuota no se gasta de más)", async () => {
    await withTimers(call({ learn: true }));
    for (const r of db.tables.unlock_raw) r.fetched_at = new Date().toISOString(); // la base real lo pone sola
    const before = calls.length;
    const again = await withTimers(call({ learn: true }));
    expect(again.body.learn.fetched).toBe(0);
    expect(calls.length).toBe(before); // ni siquiera pide de nuevo la lista de tokens (se guardó)
  });

  it("si los eventos fallan corta la tanda en el primero y, tras 3 fallas, deja de pedir (no gasta la cuota)", async () => {
    vi.stubGlobal("fetch", async (url: any) => {
      const u = new URL(String(url));
      calls.push(u.pathname);
      if (u.pathname === "/v5/token/list") return new Response(JSON.stringify({ data: [{ id: "a", symbol: "AAA" }, { id: "b", symbol: "BBB" }] }));
      return new Response(JSON.stringify({ status: false, errorMessage: "ruta" }), { status: 404 });
    });
    const first = await withTimers(call({ learn: true }));
    expect(first.status).toBe(502);
    expect(db.tables.unlock_raw.filter((x) => x.kind === "events_error")).toHaveLength(1); // cortó en el primero
    for (let i = 0; i < 3; i++) await withTimers(call({ learn: true }));
    const n = calls.length;
    const stopped = await withTimers(call({ learn: true }));
    expect(stopped.body.learn.error).toContain("frenó");
    expect(calls.length).toBe(n); // ya no pidió nada
  });

  it("si la fuente responde con error en la lista, lo dice y no guarda nada de eventos", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ status: false, errorMessage: "no" }), { status: 403 }));
    const r = await withTimers(call({ learn: true }));
    expect(r.status).toBe(502);
    expect(r.body.learn.error).toContain("403");
    expect(db.tables.unlock_history).toHaveLength(0);
  });

  it("la prueba gratuita solo deja pedir el pasado: con el mensaje real de Tokenomist, ajusta el rango y reintenta", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: any) => {
      const u = new URL(String(url));
      urls.push(u.pathname + u.search);
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (u.pathname === "/v5/token/list") return j({ status: true, data: [{ id: "layerzero", symbol: "ZRO" }] });
      const end = u.searchParams.get("end") ?? "";
      if (end > "2026-10-16") return j({ status: false, statusCode: 422, errorMessage: "Invalid Date Range : The available range for unlock events data are 2025-10-16 - 2026-10-16" }, 422);
      const now = Date.now();
      return j({ status: true, data: [2, 1, 0].map((i) => ({ unlockDate: new Date(now - (10 + i * 30) * DAY).toISOString(), cliffUnlocks: { valueToMarketCap: 3 } })) });
    });
    vi.setSystemTime(new Date("2026-10-16T10:45:00Z"));
    const r = await withTimers(call({ learn: true }));
    expect(r.status).toBe(200);
    expect(r.body.learn).toMatchObject({ tokens: 1, fetched: 1, events: 3 });
    expect(urls.filter((x) => x.startsWith("/v5/unlock/events/")).pop()).toContain("start=2025-10-16&end=2026-10-16");
    expect(db.tables.unlock_raw.filter((x) => x.kind === "events_error")).toHaveLength(0);
  });
});

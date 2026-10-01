import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;
let fetchCalls = 0;
let marketDown = false;

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/liquidation-map/index");
});

const H = 3_600_000;
const T0 = Math.floor(Date.now() / H) * H - 20 * H;
const hours = Array.from({ length: 20 }, (_, i) => T0 + i * H);

beforeEach(() => {
  resetDb({ liquidation_cache: [] });
  fetchCalls = 0;
  marketDown = false;
  vi.stubGlobal("fetch", async (url: any) => {
    fetchCalls++;
    if (marketDown) return new Response("{}", { status: 451 });
    const u = new URL(String(url));
    const j = (b: unknown) => new Response(JSON.stringify(b));
    if (u.pathname === "/fapi/v1/klines") return j(hours.map((t) => [t, "100", "101", "99", "100", "1"]));
    if (u.pathname === "/futures/data/openInterestHist") return j(hours.map((t, i) => ({ sumOpenInterestValue: String(1000 + i * 100), timestamp: t })));
    return j([]);
  });
});

const call = (body: unknown, token = "good") =>
  handler(new Request("http://x", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));

describe("función liquidation-map", () => {
  it("pide sesión y una moneda de la lista", async () => {
    expect((await handler(new Request("http://x", { method: "OPTIONS" }))).status).toBe(204);
    expect((await call({ coin: "BTC" }, "malo")).status).toBe(401);
    expect((await call({ coin: "FAKECOIN" })).status).toBe(400);
  });

  it("calcula, guarda y reutiliza el cálculo durante 10 minutos", async () => {
    const r = await (await call({ coin: "eth" })).json();
    expect(r.ok).toBe(true);
    expect(r.data.symbol).toBe("ETHUSDT");
    expect(db.tables.liquidation_cache).toHaveLength(1);
    const callsAfterFirst = fetchCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const again = await (await call({ coin: "ETH" })).json();
    expect(again.cached).toBe(true);
    expect(fetchCalls).toBe(callsAfterFirst); // no volvió a consultar al exchange

    db.tables.liquidation_cache[0].computed_at = new Date(Date.now() - 11 * 60_000).toISOString();
    await call({ coin: "ETH" });
    expect(fetchCalls).toBeGreaterThan(callsAfterFirst);
  });

  it("si el mercado no responde devuelve lo último guardado, o un error claro", async () => {
    marketDown = true;
    const none = await call({ coin: "BTC" });
    expect(none.status).toBe(502);
    expect((await none.json()).error).toMatch(/Probá de nuevo/);

    db.tables.liquidation_cache.push({ coin: "BTC", source: "binance", payload: { coin: "BTC", buckets: [] }, computed_at: new Date(Date.now() - 60 * 60_000).toISOString() });
    const stale = await (await call({ coin: "BTC" })).json();
    expect(stale).toMatchObject({ ok: true, stale: true });
  });
});

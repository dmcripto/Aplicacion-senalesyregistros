import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", EXCHANGE_ENC_KEY: "una-clave-maestra-larga-de-prueba" } as Record<string, string>)[k] },
    serve: (h: typeof handler) => { handler = h; },
  };
  await import("../supabase/functions/exchanges/index");
});

const call = async (body: unknown, token = "good") => {
  const r = await handler(new Request("http://x/functions/v1/exchanges", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as any };
};

beforeEach(() => {
  resetDb({ profiles: [{ id: "u1", capital: 1000, risk_pct: 1 }], exchange_connections: [], exchange_secrets: [], exchange_ignored: [] });
  vi.stubGlobal("fetch", async (url: any) => {
    const u = new URL(String(url));
    const j = (b: unknown) => new Response(JSON.stringify(b));
    if (u.pathname === "/v5/user/query-api") return j({ retCode: 0, result: { readOnly: 1 } });
    if (u.pathname === "/v5/position/closed-pnl") {
      return j({ retCode: 0, result: { nextPageCursor: "", list: [
        { symbol: "BTCUSDT", side: "Sell", orderId: "o1", closedPnl: "30", avgEntryPrice: "65000", avgExitPrice: "65300", closedSize: "0.1", createdTime: String(Date.now() - 36e5), updatedTime: String(Date.now() - 30e5) },
        { symbol: "ETHUSDT", side: "Buy", orderId: "o2", closedPnl: "-10", avgEntryPrice: "3000", avgExitPrice: "3050", closedSize: "0.2", createdTime: String(Date.now() - 72e5), updatedTime: String(Date.now() - 70e5) },
      ] } });
    }
    return new Response("{}", { status: 404 });
  });
});

const connect = () => call({ action: "connect", exchange: "bybit", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" });

describe("función exchanges", () => {
  it("responde a CORS y rechaza sesiones inválidas", async () => {
    expect((await handler(new Request("http://x", { method: "OPTIONS" }))).status).toBe(204);
    expect((await call({ action: "sync" }, "malo")).status).toBe(401);
  });

  it("valida los datos del pedido", async () => {
    expect((await call({ action: "connect", exchange: "kraken", apiKey: "aaaaaaaaaa", apiSecret: "bbbbbbbbbb" })).status).toBe(400);
    expect((await call({ action: "connect", exchange: "bybit", apiKey: "corta", apiSecret: "x" })).status).toBe(400);
    db.tables.profiles[0].capital = null;
    const r = await connect();
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("need_money");
  });

  it("conecta, importa, cifra el secreto y no duplica", async () => {
    const r = await connect();
    expect(r.body).toMatchObject({ ok: true, imported: 2 });
    expect(db.tables.exchange_connections[0].key_hint).toBe("1234");
    expect(JSON.stringify(db.tables.exchange_secrets)).not.toContain("SECRETSECRET");
    const btc = db.tables.trades.find((t) => t.symbol === "BTCUSDT")!;
    expect(btc).toMatchObject({ direction: "LONG", entry: 65000, exit: 65300, source: "bybit", external_id: "BTCUSDT:o1", user_id: "u1" });

    // dentro de los 30 s no vuelve a consultar
    expect((await call({ action: "sync" })).body.results[0].skipped).toBe(true);
    // pasado ese tiempo consulta pero no duplica
    db.tables.exchange_connections[0].last_sync_at = new Date(Date.now() - 120e3).toISOString();
    expect((await call({ action: "sync" })).body.results[0].imported).toBe(0);
    expect(db.tables.trades).toHaveLength(2);
  });

  it("no reimporta lo que el usuario borró", async () => {
    await connect();
    db.tables.exchange_ignored.push({ user_id: "u1", source: "bybit", external_id: "ETHUSDT:o2" });
    db.tables.trades = db.tables.trades.filter((t) => t.external_id !== "ETHUSDT:o2");
    db.tables.exchange_connections[0].last_sync_at = new Date(Date.now() - 120e3).toISOString();
    await call({ action: "sync" });
    expect(db.tables.trades).toHaveLength(1);
  });

  it("marca la conexión con error si el exchange falla", async () => {
    await connect();
    vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
    db.tables.exchange_connections[0].last_sync_at = new Date(Date.now() - 120e3).toISOString();
    const r = await call({ action: "sync" });
    expect(r.body.results[0].error).toMatch(/bloqueo/);
    expect(db.tables.exchange_connections[0].status).toBe("error");
  });
});

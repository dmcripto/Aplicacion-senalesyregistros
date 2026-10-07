import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y", EXCHANGE_ENC_KEY: "una-clave-maestra-larga-de-prueba", EXCHANGE_CRON_SECRET: "secreto-de-segundo-plano-123" } as Record<string, string>)[k] },
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

  it("guarda el apalancamiento y el tamaño, y completa lo que ya estaba importado sin esos datos", async () => {
    vi.stubGlobal("fetch", async (url: any) => {
      const u = new URL(String(url));
      const j = (b: unknown) => new Response(JSON.stringify(b));
      if (u.pathname === "/v5/user/query-api") return j({ retCode: 0, result: { readOnly: 1 } });
      if (u.pathname === "/v5/position/closed-pnl") {
        return j({ retCode: 0, result: { nextPageCursor: "", list: [
          { symbol: "BTCUSDT", side: "Sell", orderId: "o1", closedPnl: "30", avgEntryPrice: "65000", avgExitPrice: "65300", closedSize: "0.1", createdTime: String(Date.now() - 36e5), updatedTime: String(Date.now() - 18e5), leverage: "25" },
        ] } });
      }
      return new Response("{}", { status: 404 });
    });
    // una operación que ya estaba importada de antes (sin los datos nuevos)
    db.tables.trades = [{ id: "old", user_id: "u1", source: "bybit", external_id: "BTCUSDT:o1", symbol: "BTCUSDT", outcome: "MANUAL" }];
    const r = await connect();
    expect(r.body.ok).toBe(true);
    const t = db.tables.trades.find((x) => x.external_id === "BTCUSDT:o1")!;
    expect(db.tables.trades).toHaveLength(1); // no se duplicó
    expect(t.leverage).toBe(25);
    expect(t.size_usd).toBeCloseTo(6500, 5);
  });

  it("si todavía no se corrió el SQL del apalancamiento, importa igual (sin ese dato)", async () => {
    db.missingColumns = ["leverage", "size_usd"];
    const r = await connect();
    expect(r.body).toMatchObject({ ok: true, imported: 2 });
    expect(db.tables.trades).toHaveLength(2);
    expect(db.tables.trades.every((t) => !("leverage" in t) && !("size_usd" in t))).toBe(true);
  });

  it("acepta también Bitunix y MEXC", async () => {
    vi.stubGlobal("fetch", async (url: any) => {
      const u = new URL(String(url));
      if (u.pathname === "/api/v1/contract/detail") return new Response(JSON.stringify({ success: true, code: 0, data: { contractSize: 0.0001 } }));
      return new Response(JSON.stringify({ success: true, code: 0, data: [{ positionId: "m1", symbol: "BTC_USDT", positionType: 1, state: 3, closeVol: 1000, openAvgPrice: "65000", closeAvgPrice: "65500", realised: "49.5", createTime: String(Date.now() - 72e5), updateTime: String(Date.now() - 36e5) }] }));
    });
    const r = await call({ action: "connect", exchange: "mexc", apiKey: "MEXCKEY12345", apiSecret: "MEXCSECRET1234" });
    expect(r.body).toMatchObject({ ok: true, imported: 1 });
    expect(db.tables.trades[0]).toMatchObject({ symbol: "BTCUSDT", source: "mexc", external_id: "BTC_USDT:m1" });
    expect(db.tables.trades[0].notes).toMatch(/^MEXC/);
  });

  it("Bitget pide la contraseña de la API, la guarda cifrada y la usa al sincronizar", async () => {
    const seen: string[] = [];
    const ctime = String(Date.now() - 72e5), utime = String(Date.now() - 36e5);
    vi.stubGlobal("fetch", async (_url: any, init: any) => {
      seen.push(init?.headers?.["ACCESS-PASSPHRASE"]);
      return new Response(JSON.stringify({ code: "00000", data: { list: [{ symbol: "BTCUSDT", holdSide: "long", openAvgPrice: "65000", closeAvgPrice: "65500", closeTotalPos: "0.1", netProfit: "49", ctime, utime }], endId: "" } }));
    });
    const base = { action: "connect", exchange: "bitget", apiKey: "BGKEY123456", apiSecret: "BGSECRET1234" };
    expect((await call(base)).status).toBe(400);
    const r = await call({ ...base, passphrase: "mi-clave-api" });
    expect(r.body).toMatchObject({ ok: true, imported: 1 });
    expect(JSON.stringify(db.tables.exchange_secrets)).not.toContain("mi-clave-api");
    expect(db.tables.exchange_secrets[0].passphrase_enc).toBeTruthy();
    expect(db.tables.trades[0]).toMatchObject({ source: "bitget", symbol: "BTCUSDT" });
    db.tables.exchange_connections[0].last_sync_at = new Date(Date.now() - 120e3).toISOString();
    await call({ action: "sync" });
    expect(seen.every((x) => x === "mi-clave-api")).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("los exchanges sin contraseña no guardan ninguna", async () => {
    await connect(); // Bybit
    expect(db.tables.exchange_secrets[0].passphrase_enc).toBeNull();
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

  describe("sincronización en segundo plano", () => {
    const cron = async (secret: string | null) => {
      const headers: Record<string, string> = {};
      if (secret !== null) headers["x-cron-secret"] = secret;
      const r = await handler(new Request("http://x/functions/v1/exchanges", { method: "POST", headers, body: "{}" }));
      return { status: r.status, body: (await r.json()) as any };
    };
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

    it("rechaza un secreto incorrecto", async () => {
      await connect();
      expect((await cron("otro-secreto-cualquiera")).status).toBe(401);
      expect((await cron("")).status).toBe(401);
    });

    it("no vuelve a consultar lo que se sincronizó hace poco", async () => {
      await connect();
      const r = await cron("secreto-de-segundo-plano-123");
      expect(r.body).toMatchObject({ ok: true, due: 0, synced: 0 });
    });

    it("importa solas las operaciones nuevas de conexiones atrasadas", async () => {
      await connect();
      db.tables.trades = [];
      Object.assign(db.tables.exchange_connections[0], { last_sync_at: ago(15 * 60e3), last_attempt_at: ago(15 * 60e3) });
      const r = await cron("secreto-de-segundo-plano-123");
      expect(r.body).toMatchObject({ ok: true, due: 1, synced: 1, imported: 2, failed: 0 });
      expect(db.tables.trades).toHaveLength(2);
      expect(db.tables.exchange_connections[0].last_attempt_at).toBeTruthy();
    });

    it("las conexiones con error se reintentan solo cada tanto", async () => {
      await connect();
      Object.assign(db.tables.exchange_connections[0], { status: "error", last_attempt_at: ago(30 * 60e3) });
      expect((await cron("secreto-de-segundo-plano-123")).body.due).toBe(0);
      db.tables.exchange_connections[0].last_attempt_at = ago(7 * 3600e3);
      expect((await cron("secreto-de-segundo-plano-123")).body.due).toBe(1);
    });

    it("salta a quien no cargó capital y riesgo", async () => {
      await connect();
      db.tables.profiles[0].capital = null;
      Object.assign(db.tables.exchange_connections[0], { last_sync_at: ago(20 * 60e3), last_attempt_at: ago(20 * 60e3) });
      expect((await cron("secreto-de-segundo-plano-123")).body).toMatchObject({ due: 1, synced: 0 });
    });
  });

  it("2FA opcional: sin código reciente no deja conectar; con código sí", async () => {
    let seen: any = null;
    db.rpcs.mfa_step_ok = (args) => {
      seen = args;
      return { data: false };
    };
    const payload = Buffer.from(JSON.stringify({ amr: [{ method: "password", timestamp: 1 }] })).toString("base64url");
    const token = `h.${payload}.s`;
    db.users[token] = { id: "u1" };
    const r = await call({ action: "connect", exchange: "bybit", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" }, token);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("mfa_required");
    expect(seen.uid).toBe("u1");
    expect(seen.claims.amr[0].method).toBe("password");
    expect(db.tables.exchange_connections).toHaveLength(0);

    db.rpcs.mfa_step_ok = () => ({ data: true });
    expect((await call({ action: "connect", exchange: "bybit", apiKey: "KEYKEYKEY1234", apiSecret: "SECRETSECRET" }, token)).status).toBe(200);
  });

  it("2FA opcional: si la migración todavía no está, no bloquea", async () => {
    expect((await connect()).status).toBe(200);
  });
});

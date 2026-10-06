import { beforeEach, describe, expect, it, vi } from "vitest";

// El bot está en prueba: la web y la app solo lo cargan si la cuenta tiene la llave profiles.bot_beta.
let tables: Record<string, { data: unknown; error: unknown }> = {};
vi.mock("../src/supabaseClient", () => ({
  supabase: {
    from: (table: string) => {
      const chain: any = { select: () => chain, eq: () => chain, limit: () => chain, maybeSingle: async () => tables[table] ?? { data: null, error: null }, then: (res: any) => res(tables[table] ?? { data: null, error: null }) };
      return chain;
    },
  },
}));
vi.mock("../mobile/src/supabaseClient", () => ({ supabase: { from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => tables[t] ?? { data: null, error: null } }), limit: async () => tables[t] ?? { data: null, error: null } }) }) } }));

const row = { enabled: false, symbols: ["BTCUSDT"], max_open: 3, daily_loss_r: 3, last_tick_at: null, rules: [], profile: "slow", notify: true, scan_top: 20 };

beforeEach(() => {
  tables = {};
});

describe("el bot en prueba: solo cuentas habilitadas", () => {
  it("con la llave carga los ajustes", async () => {
    const { fetchBotSettings } = await import("../src/tradesApi");
    tables = { profiles: { data: { bot_beta: true }, error: null }, bot_settings: { data: row, error: null } };
    const s = await fetchBotSettings("u1");
    expect(s.profile).toBe("slow");
    expect(s.scanTop).toBe(20);
  });

  it("sin la llave el bot queda oculto (falla la carga)", async () => {
    const { fetchBotSettings } = await import("../src/tradesApi");
    tables = { profiles: { data: { bot_beta: false }, error: null }, bot_settings: { data: row, error: null } };
    await expect(fetchBotSettings("u1")).rejects.toThrow("todavía no está disponible");
  });

  it("si la columna todavía no existe también queda oculto", async () => {
    const { fetchBotSettings } = await import("../src/tradesApi");
    tables = { profiles: { data: null, error: { message: "column profiles.bot_beta does not exist" } }, bot_settings: { data: row, error: null } };
    await expect(fetchBotSettings("u1")).rejects.toThrow();
  });

  it("sin fila de perfil tampoco se muestra", async () => {
    const { fetchBotSettings } = await import("../src/tradesApi");
    tables = { profiles: { data: null, error: null }, bot_settings: { data: row, error: null } };
    await expect(fetchBotSettings("u1")).rejects.toThrow();
  });

  it("la app móvil hace la misma comprobación", async () => {
    const { fetchBotSettings } = await import("../mobile/src/tradesApi");
    tables = { profiles: { data: { bot_beta: false }, error: null }, bot_settings: { data: row, error: null } };
    await expect(fetchBotSettings("u1")).rejects.toThrow("todavía no está disponible");
    tables = { profiles: { data: { bot_beta: true }, error: null }, bot_settings: { data: row, error: null } };
    expect((await fetchBotSettings("u1")).enabled).toBe(false);
  });
});

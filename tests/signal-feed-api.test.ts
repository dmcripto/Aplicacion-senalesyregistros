import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, db, resetDb } from "./helpers/fake-supabase";

// La función del cliente web habla con supabase-js: se prueba con la base falsa.
vi.mock("../src/supabaseClient", () => ({ supabase: createClient() }));

let api: typeof import("../src/tradesApi");
beforeEach(async () => {
  (import.meta as any).env = { ...(import.meta as any).env, VITE_SUPABASE_URL: "https://x.supabase.co" };
  api = await import("../src/tradesApi");
  resetDb({ profiles: [] });
});

describe("Señales de VELTRIX (cliente)", () => {
  it("solo se muestra con la llave beta; sin ella o sin el SQL, falla y no aparece nada", async () => {
    db.tables.profiles = [{ id: "u1", bot_beta: false, follow_signals: false }];
    await expect(api.fetchSignalFeed("u1")).rejects.toThrow();
    db.tables.profiles = [{ id: "u1", bot_beta: true, follow_signals: false, signal_provider: false }];
    expect(await api.fetchSignalFeed("u1")).toEqual({ follow: false, provider: false, followers: null });
    db.missingSelect = ["follow_signals"];
    await expect(api.fetchSignalFeed("u1")).rejects.toThrow();
  });

  it("activar y desactivar guarda el cambio en el perfil de la persona", async () => {
    db.tables.profiles = [{ id: "u1", bot_beta: true, follow_signals: false }, { id: "u2", bot_beta: true, follow_signals: false }];
    await api.setFollowSignals("u1", true);
    expect(db.tables.profiles.map((p) => p.follow_signals)).toEqual([true, false]);
    await api.setFollowSignals("u1", false);
    expect(db.tables.profiles[0].follow_signals).toBe(false);
  });

  it("quien publica ve cuántas personas la reciben", async () => {
    db.tables.profiles = [{ id: "u1", bot_beta: true, follow_signals: false, signal_provider: true }];
    db.rpcs.my_signal_followers = () => ({ data: 7 });
    expect(await api.fetchSignalFeed("u1")).toEqual({ follow: false, provider: true, followers: 7 });
  });
});

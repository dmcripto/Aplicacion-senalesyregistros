import { describe, expect, it } from "vitest";
import { BOT_STALE_MIN, DEFAULT_BOT, botStaleMinutes, staleSince } from "../packages/core/src/trading";
import { createBotStore } from "../packages/core/src/botStore";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const on = (lastTickAt: string | null, updatedAt: string | null) => ({ enabled: true, lastTickAt, updatedAt });

describe("alarma: el servidor no revisa el bot", () => {
  it("apagado no avisa nada", () => {
    expect(botStaleMinutes({ enabled: false, lastTickAt: iso(500), updatedAt: iso(900) }, NOW)).toBeNull();
  });

  it("una revisión reciente está bien", () => {
    expect(botStaleMinutes(on(iso(3), iso(600)), NOW)).toBeNull();
    expect(botStaleMinutes(on(iso(BOT_STALE_MIN - 1), iso(600)), NOW)).toBeNull();
  });

  it("avisa cuando pasan 15 minutos o más sin revisión, con los minutos que van", () => {
    expect(botStaleMinutes(on(iso(15), iso(600)), NOW)).toBe(15);
    expect(botStaleMinutes(on(iso(125), iso(600)), NOW)).toBe(125);
  });

  it("recién encendido tiene 15 minutos de margen aunque la última revisión sea vieja", () => {
    expect(botStaleMinutes(on(iso(3000), iso(2)), NOW)).toBeNull();
    expect(botStaleMinutes(on(iso(3000), iso(40)), NOW)).toBe(40);
  });

  it("encendido y sin ninguna revisión: cuenta desde que se encendió", () => {
    expect(botStaleMinutes(on(null, iso(5)), NOW)).toBeNull();
    expect(botStaleMinutes(on(null, iso(30)), NOW)).toBe(30);
  });

  it("sin ninguna fecha no inventa un aviso", () => {
    expect(botStaleMinutes(on(null, null), NOW)).toBeNull();
  });

  it("el tiempo se dice en minutos y, pasadas las dos horas, en horas", () => {
    expect(staleSince(25)).toBe("25 min");
    expect(staleSince(119)).toBe("119 min");
    expect(staleSince(180)).toBe("3 h");
  });
});

describe("el estado del bot se puede refrescar sin parpadear", () => {
  const loaded = (lastTickAt: string | null) => ({ ...DEFAULT_BOT, enabled: true, lastTickAt, rulesSupported: true, profileSupported: true, notifySupported: true, scanSupported: true });

  it("trae la revisión nueva sin pasar por «cargando»", async () => {
    let tick: string | null = null;
    const store = createBotStore({ load: async () => loaded(tick), save: async () => {} });
    await store.load();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getState().status));
    tick = iso(1);
    await store.refresh();
    expect(store.getState().settings.lastTickAt).toBe(tick);
    expect(seen.every((x) => x === "ready")).toBe(true);
  });

  it("si falla la lectura se queda como estaba", async () => {
    let fail = false;
    const store = createBotStore({ load: async () => { if (fail) throw new Error("sin conexión"); return loaded(iso(2)); }, save: async () => {} });
    await store.load();
    fail = true;
    await store.refresh();
    expect(store.getState().status).toBe("ready");
    expect(store.getState().settings.lastTickAt).toBe(iso(2));
  });

  it("no hace nada si todavía no cargó o el bot no existe en el servidor", async () => {
    const store = createBotStore({ load: async () => { throw new Error("no hay tabla"); }, save: async () => {} });
    await store.refresh();
    expect(store.getState().status).toBe("idle");
    await store.load();
    expect(store.getState().status).toBe("missing");
    await store.refresh();
    expect(store.getState().status).toBe("missing");
  });
});

import { describe, expect, it } from "vitest";
import { beat, runWatchdog, watchdogText } from "../supabase/functions/_shared/watchdog";
import type { WatchdogAlert } from "../supabase/functions/_shared/watchdog";

// Base mínima en memoria con lo que usa el vigilante.
function fakeDb(rows: Array<{ name: string; at: string; alerted_at: string | null }>) {
  const t = rows;
  return {
    rows: t,
    from: () => ({
      select: async () => ({ data: t.map((r) => ({ ...r })), error: null }),
      upsert: async (r: any) => { const i = t.findIndex((x) => x.name === r.name); if (i >= 0) t[i] = { ...t[i], at: r.at }; else t.push({ name: r.name, at: r.at, alerted_at: null }); return { error: null }; },
      update: (patch: any) => ({ eq: async (_k: string, v: string) => { const r = t.find((x) => x.name === v); if (r) Object.assign(r, patch); return { error: null }; } }),
    }),
  };
}
const NOW = Date.parse("2026-10-17T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("vigilante de funciones", () => {
  it("no avisa si los latidos son recientes ni si la tarea nunca latió", async () => {
    const db = fakeDb([{ name: "bot", at: ago(3), alerted_at: null }]);
    const got: WatchdogAlert[] = [];
    const r = await runWatchdog(db, async (a) => { got.push(a); }, NOW);
    expect(r).toEqual([]);
    expect(got).toEqual([]);
  });

  it("avisa una vez cuando el bot lleva más de 20 minutos sin latir y repite recién a las 3 horas", async () => {
    const db = fakeDb([{ name: "bot", at: ago(45), alerted_at: null }]);
    const got: WatchdogAlert[] = [];
    const notify = async (a: WatchdogAlert) => { got.push(a); };
    expect((await runWatchdog(db, notify, NOW)).map((a) => a.kind)).toEqual(["down"]);
    expect(got[0].minutes).toBe(45);
    expect((await runWatchdog(db, notify, NOW + 10 * 60_000)).length).toBe(0); // 10 minutos después: no repite
    expect((await runWatchdog(db, notify, NOW + 3 * 3_600_000 + 60_000)).map((a) => a.kind)).toEqual(["down"]); // a las 3 h, recuerda
  });

  it("avisa cuando vuelve a funcionar y limpia el aviso pendiente", async () => {
    const db = fakeDb([{ name: "bot", at: ago(2), alerted_at: ago(60) }]);
    const got: WatchdogAlert[] = [];
    const r = await runWatchdog(db, async (a) => { got.push(a); }, NOW);
    expect(r.map((a) => a.kind)).toEqual(["recovered"]);
    expect(db.rows[0].alerted_at).toBeNull();
  });

  it("beat anota el latido y los textos salen en español e inglés", async () => {
    const db = fakeDb([]);
    await beat(db, "bot", NOW);
    expect(db.rows[0]).toMatchObject({ name: "bot", at: new Date(NOW).toISOString() });
    const a: WatchdogAlert = { job: { name: "bot", maxMin: 20, es: "el bot automático", en: "the automatic bot" }, kind: "down", minutes: 45 };
    expect(watchdogText(a, "es").body).toContain("no corre hace 45 minutos");
    expect(watchdogText(a, "en").body).toContain("has not run for 45 minutes");
    expect(watchdogText({ ...a, kind: "recovered" }, "es").title).toContain("normalidad");
  });
});

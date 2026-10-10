import { beforeEach, describe, expect, it } from "vitest";
import { createClient, db, resetDb } from "./helpers/fake-supabase";
import { alertTexts, decide, emaLast, measure, rsiLast, runAlerts } from "../supabase/functions/_shared/alerts";
import type { AlertRow } from "../supabase/functions/_shared/alerts";
import { ema, rsi } from "../packages/core/src/indicators";

const wave = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 12 + i * 0.05);

describe("cálculos del servidor = los del gráfico", () => {
  it("RSI y EMA dan lo mismo que packages/core", () => {
    for (const p of [5, 14, 30]) {
      expect(rsiLast(wave, p)).toBeCloseTo(rsi(wave, p).at(-1) as number, 10);
      expect(emaLast(wave, p)).toBeCloseTo(ema(wave, p).at(-1) as number, 10);
    }
    expect(rsiLast([1, 2], 14)).toBeNull();
    expect(emaLast([1, 2], 14)).toBeNull();
  });
});

describe("decidir", () => {
  it("la primera medición solo fija el lado; después avisa solo al cruzar hacia el lado pedido", () => {
    const a = { dir: "above" as const, last_side: null };
    expect(decide(a, { value: 90, ref: 100 })).toEqual({ side: "below", fire: false });
    expect(decide({ ...a, last_side: "below" }, { value: 101, ref: 100 })).toEqual({ side: "above", fire: true });
    expect(decide({ ...a, last_side: "above" }, { value: 105, ref: 100 })).toEqual({ side: "above", fire: false }); // ya estaba arriba
    expect(decide({ ...a, last_side: "above" }, { value: 99, ref: 100 })).toEqual({ side: "below", fire: false }); // cruzó, pero hacia el otro lado
    expect(decide({ dir: "below", last_side: "above" }, { value: 99, ref: 100 }).fire).toBe(true);
  });
  it("medir según el tipo de alerta", () => {
    expect(measure({ kind: "price", level: 100, period: null }, { price: 101 })).toEqual({ value: 101, ref: 100 });
    expect(measure({ kind: "price", level: 100, period: null }, { price: null })).toBeNull();
    expect(measure({ kind: "rsi", level: 30, period: 14 }, { closes: wave })?.ref).toBe(30);
    const e = measure({ kind: "ema", level: null, period: 20 }, { closes: wave })!;
    expect(e.value).toBe(wave.at(-1));
    expect(e.ref).toBeCloseTo(emaLast(wave, 20) as number, 10);
    expect(measure({ kind: "ema", level: null, period: 20 }, { closes: [1, 2, 3] })).toBeNull();
  });
});

describe("textos", () => {
  const a = { symbol: "BTCUSDT", kind: "price" as const, tf: "1h" as const, dir: "above" as const, period: null };
  it("precio, RSI y EMA, en español y en inglés, con HTML escapado", () => {
    expect(alertTexts(a, { value: 100120, ref: 100000 }, "es").body).toBe("El precio cruzó por encima de 100,000 (ahora 100,120)");
    expect(alertTexts({ ...a, dir: "below" }, { value: 99900, ref: 100000 }, "en").body).toBe("Price crossed below 100,000 (now 99,900)");
    expect(alertTexts({ ...a, kind: "rsi", period: 14, dir: "below" }, { value: 28.34, ref: 30 }, "es").body).toBe("El RSI 14 (1h) cruzó por debajo de 30 (ahora 28.3)");
    expect(alertTexts({ ...a, kind: "ema", period: 50 }, { value: 101, ref: 100 }, "en").body).toBe("Price closed above the EMA 50 (1h): 101 vs 100");
    const t = alertTexts({ ...a, symbol: "A<B" }, { value: 1, ref: 1 }, "es");
    expect(t.title).toBe("🔔 A<B");
    expect(t.html).toContain("A&lt;B");
    expect(alertTexts({ ...a, symbol: "PEPEUSDT" }, { value: 0.000012345, ref: 0.00001 }, "es").body).toContain("0.00001");
  });
});

describe("runAlerts", () => {
  const supabase = createClient();
  let sent: Array<{ id: string; value: number }>;
  let price: number | null;
  let closes: number[] | null;
  let priceCalls: string[];
  let closeCalls: string[];
  const deps = () => ({
    supabase,
    notify: async (a: AlertRow, m: { value: number }) => void sent.push({ id: a.id, value: m.value }),
    getPrice: async (s: string) => (priceCalls.push(s), price),
    getCloses: async (s: string, tf: string) => (closeCalls.push(`${s}|${tf}`), closes),
  });
  const alert = (o: Partial<AlertRow & { active: boolean }> = {}) => ({ id: "a1", user_id: "u1", symbol: "BTCUSDT", kind: "price", tf: "1h", dir: "above", level: 100, period: null, once: true, active: true, last_side: null, trigger_count: 0, checked_at: null, ...o });

  beforeEach(() => {
    resetDb({ price_alerts: [alert()] });
    sent = [];
    price = 90;
    closes = wave;
    priceCalls = [];
    closeCalls = [];
  });

  it("no avisa en la primera vuelta (solo fija el lado), avisa al cruzar y se apaga si es de una sola vez", async () => {
    expect(await runAlerts(deps())).toBe(0);
    expect(db.tables.price_alerts[0]).toMatchObject({ last_side: "below", active: true });
    price = 101;
    expect(await runAlerts(deps())).toBe(1);
    expect(sent).toEqual([{ id: "a1", value: 101 }]);
    expect(db.tables.price_alerts[0]).toMatchObject({ last_side: "above", active: false, trigger_count: 1 });
    expect(db.tables.price_alerts[0].triggered_at).toBeTruthy();
    expect(await runAlerts(deps())).toBe(0); // apagada: no se revisa más
  });

  it("si es repetida, sigue activa y vuelve a avisar en el próximo cruce", async () => {
    db.tables.price_alerts = [alert({ once: false, last_side: "below" })];
    price = 101;
    expect(await runAlerts(deps())).toBe(1);
    expect(db.tables.price_alerts[0]).toMatchObject({ active: true, last_side: "above" });
    expect(await runAlerts(deps())).toBe(0); // sigue arriba: no repite
    price = 95;
    await runAlerts(deps());
    price = 102;
    expect(await runAlerts(deps())).toBe(1);
    expect(db.tables.price_alerts[0].trigger_count).toBe(2);
  });

  it("dos corridas a la vez no avisan dos veces", async () => {
    db.tables.price_alerts = [alert({ last_side: "below" })];
    price = 101;
    const [x, y] = await Promise.all([runAlerts(deps()), runAlerts(deps())]);
    expect(sent).toHaveLength(1);
    expect(x + y).toBe(1);
  });

  it("pide los datos una sola vez por activo y temporalidad", async () => {
    db.tables.price_alerts = [
      alert({ id: "p1" }),
      alert({ id: "p2", level: 120 }),
      alert({ id: "r1", kind: "rsi", level: 30, period: 14, dir: "below", tf: "1h" }),
      alert({ id: "e1", kind: "ema", level: null, period: 50, tf: "1h" }),
      alert({ id: "e2", kind: "ema", level: null, period: 20, tf: "4h" }),
    ];
    await runAlerts(deps());
    expect(priceCalls).toEqual(["BTCUSDT"]);
    expect(closeCalls.sort()).toEqual(["BTCUSDT|1h", "BTCUSDT|4h"]);
  });

  it("RSI y EMA se miden sobre velas cerradas y avisan al cruzar", async () => {
    const down = [...wave.slice(0, 100)];
    db.tables.price_alerts = [alert({ id: "r1", kind: "rsi", level: 50, period: 14, dir: "above", last_side: "below" })];
    // Una subida fuerte al final deja el RSI por encima de 50.
    closes = [...down, ...Array.from({ length: 20 }, (_, i) => down[99] + (i + 1) * 3)];
    expect(await runAlerts(deps())).toBe(1);
    expect(sent[0].id).toBe("r1");
  });

  it("si no hay datos (par inexistente), no avisa ni rompe, y las demás siguen", async () => {
    db.tables.price_alerts = [alert({ id: "x", symbol: "NOEXISTEUSDT", last_side: "below" }), alert({ id: "ok", last_side: "below" })];
    const d = deps();
    d.getPrice = async (s: string) => (s === "NOEXISTEUSDT" ? null : 101);
    expect(await runAlerts(d)).toBe(1);
    expect(sent.map((s) => s.id)).toEqual(["ok"]);
    expect(db.tables.price_alerts.find((a) => a.id === "x")!.checked_at).toBeTruthy();
  });

  it("un error del aviso no frena la revisión; sin la tabla (falta el SQL) no hace nada", async () => {
    db.tables.price_alerts = [alert({ last_side: "below" })];
    price = 101;
    const d = deps();
    d.notify = async () => {
      throw new Error("telegram caído");
    };
    expect(await runAlerts(d)).toBe(1);
    db.missingSelect = ["trigger_count"];
    expect(await runAlerts(deps())).toBe(0);
  });
});

import { checkAlertDraft } from "../packages/core/src/alerts";
import type { AlertDraft } from "../packages/core/src/alerts";

describe("validación del borrador (mismos límites que la tabla)", () => {
  const base: AlertDraft = { symbol: "BTCUSDT", kind: "price", tf: "1h", dir: "above", level: 100000, period: null, once: true };
  it("precio", () => {
    expect(checkAlertDraft(base)).toEqual({ ok: true });
    expect(checkAlertDraft({ ...base, level: 0 })).toEqual({ ok: false, error: "level" });
    expect(checkAlertDraft({ ...base, level: NaN })).toEqual({ ok: false, error: "level" });
    expect(checkAlertDraft({ ...base, symbol: "btc" })).toEqual({ ok: false, error: "symbol" });
  });
  it("RSI: nivel 1–99 y período 2–100", () => {
    const r: AlertDraft = { ...base, kind: "rsi", level: 30, period: 14 };
    expect(checkAlertDraft(r)).toEqual({ ok: true });
    expect(checkAlertDraft({ ...r, level: 100 })).toEqual({ ok: false, error: "level" });
    expect(checkAlertDraft({ ...r, period: 1 })).toEqual({ ok: false, error: "period" });
    expect(checkAlertDraft({ ...r, period: 14.5 })).toEqual({ ok: false, error: "period" });
  });
  it("EMA: período 2–200, sin nivel", () => {
    const e: AlertDraft = { ...base, kind: "ema", level: null, period: 50 };
    expect(checkAlertDraft(e)).toEqual({ ok: true });
    expect(checkAlertDraft({ ...e, period: 201 })).toEqual({ ok: false, error: "period" });
    expect(checkAlertDraft({ ...e, period: null })).toEqual({ ok: false, error: "period" });
  });
});

import { levelLooksOff, parseAlertLevel } from "../packages/core/src/alerts";

describe("parseAlertLevel / levelLooksOff", () => {
  it("lee el punto de miles cuando el precio actual lo deja claro", () => {
    expect(parseAlertLevel("81.700", 81700)).toBe(81700);
    expect(parseAlertLevel("81,700", 81700)).toBe(81700);
    expect(parseAlertLevel("81700", 81700)).toBe(81700);
    expect(parseAlertLevel("1.234.567", 1_200_000)).toBe(1234567);
  });
  it("mantiene los decimales de precios chicos", () => {
    expect(parseAlertLevel("1.234", 1.2)).toBe(1.234);
    expect(parseAlertLevel("0,5", 0.48)).toBe(0.5);
    expect(parseAlertLevel("82987.7", 83000)).toBe(82987.7);
  });
  it("sin precio de referencia lo lee tal cual", () => {
    expect(parseAlertLevel("81.700", null)).toBe(81.7);
    expect(parseAlertLevel("abc", 81700)).toBeNaN();
  });
  it("detecta un nivel muy lejano al precio", () => {
    expect(levelLooksOff(81.8, 82987)).toBe(true);
    expect(levelLooksOff(81700, 82987)).toBe(false);
    expect(levelLooksOff(500000, 82987)).toBe(true);
    expect(levelLooksOff(81.8, null)).toBe(false);
  });
});

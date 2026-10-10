import { describe, expect, it } from "vitest";
import { MAX_DRAWINGS, MAX_TEXT, cleanDrawings, fibPrices, logicalToTime, measure, timeToLogical } from "../packages/core/src/drawings";

const times = [1000, 1060, 1120, 1180, 1240]; // velas de 60 s

describe("posición en el gráfico", () => {
  it("hora ↔ número de vela, dentro de las velas, antes de la primera y después de la última", () => {
    expect(timeToLogical(times, 60, 1120)).toBe(2);
    expect(timeToLogical(times, 60, 1150)).toBeCloseTo(2.5, 10);
    expect(timeToLogical(times, 60, 1240 + 180)).toBeCloseTo(7, 10);
    expect(timeToLogical(times, 60, 880)).toBeCloseTo(-2, 10);
    for (const l of [-3, 0, 1.25, 2.5, 4, 4.5, 9]) expect(timeToLogical(times, 60, logicalToTime(times, 60, l))).toBeCloseTo(l, 9);
    expect(logicalToTime(times, 60, 6)).toBe(1240 + 120);
  });
  it("si cambia la ventana de velas (entra una nueva y sale la más vieja), el dibujo sigue en su hora", () => {
    const t = logicalToTime(times, 60, 3.5);
    const moved = [...times.slice(1), 1300];
    expect(logicalToTime(moved, 60, timeToLogical(moved, 60, t))).toBeCloseTo(t, 9);
    expect(timeToLogical(moved, 60, t)).toBeCloseTo(2.5, 9); // una posición más a la izquierda
  });
  it("sin velas no rompe", () => {
    expect(timeToLogical([], 60, 5)).toBe(0);
    expect(logicalToTime([], 60, 5)).toBe(0);
  });
});

describe("Fibonacci", () => {
  it("0 en el segundo punto y 1 en el primero", () => {
    const f = fibPrices({ t: 1, p: 200 }, { t: 2, p: 100 });
    expect(f[0]).toEqual({ level: 0, price: 100 });
    expect(f[f.length - 1]).toEqual({ level: 1, price: 200 });
    expect(f.find((x) => x.level === 0.5)!.price).toBe(150);
    expect(f.find((x) => x.level === 0.618)!.price).toBeCloseTo(161.8, 9);
  });
});

describe("lectura de dibujos guardados", () => {
  it("descarta lo roto y mantiene lo válido", () => {
    const raw = [
      { id: "1", kind: "hline", a: { t: 1, p: 2 } },
      { id: "2", kind: "trend", a: { t: 1, p: 2 }, b: { t: 3, p: 4 } },
      { id: "3", kind: "trend", a: { t: 1, p: 2 } }, // falta el segundo punto
      { id: "4", kind: "circulo", a: { t: 1, p: 2 } },
      { id: "5", kind: "rect", a: { t: NaN, p: 2 }, b: { t: 1, p: 1 } },
      null,
      "x",
    ];
    expect(cleanDrawings(raw).map((d) => d.id)).toEqual(["1", "2"]);
    expect(cleanDrawings("nada")).toEqual([]);
    expect(cleanDrawings(null)).toEqual([]);
  });
  it("limita la cantidad y deja los más nuevos", () => {
    const many = Array.from({ length: MAX_DRAWINGS + 10 }, (_, i) => ({ id: String(i), kind: "hline", a: { t: i, p: i } }));
    const c = cleanDrawings(many);
    expect(c).toHaveLength(MAX_DRAWINGS);
    expect(c[c.length - 1].id).toBe(String(MAX_DRAWINGS + 9));
  });
});

describe("herramientas nuevas: línea vertical, rayo, regla y nota", () => {
  it("la vertical y la nota llevan un solo punto; el rayo y la regla, dos", () => {
    const raw = [
      { id: "v", kind: "vline", a: { t: 5, p: 1 } },
      { id: "r", kind: "ray", a: { t: 1, p: 2 }, b: { t: 3, p: 4 } },
      { id: "g", kind: "ruler", a: { t: 1, p: 2 }, b: { t: 3, p: 4 } },
      { id: "n", kind: "text", a: { t: 2, p: 9 }, text: "  soporte  " },
      { id: "r2", kind: "ray", a: { t: 1, p: 2 } }, // al rayo le falta el segundo punto
      { id: "n2", kind: "text", a: { t: 2, p: 9 }, text: "   " }, // nota vacía
    ];
    const c = cleanDrawings(raw);
    expect(c.map((d) => d.id)).toEqual(["v", "r", "g", "n"]);
    expect(c.find((d) => d.id === "n")!.text).toBe("soporte");
    expect(c.find((d) => d.id === "v")!.b).toBeUndefined();
  });
  it("el texto se corta y el color solo se acepta como #rrggbb", () => {
    const [a, b, c] = cleanDrawings([
      { id: "a", kind: "text", a: { t: 1, p: 1 }, text: "x".repeat(MAX_TEXT + 40), color: "#FFAA00" },
      { id: "b", kind: "hline", a: { t: 1, p: 1 }, color: "rojo" },
      { id: "c", kind: "hline", a: { t: 1, p: 1 }, color: "#16d98a" },
    ]);
    expect(a.text).toHaveLength(MAX_TEXT);
    expect(a.color).toBe("#FFAA00");
    expect(b.color).toBeUndefined();
    expect(c.color).toBe("#16d98a");
  });
  it("la regla mide diferencia, porcentaje y tiempo", () => {
    const m = measure({ t: 1000, p: 80000 }, { t: 4600, p: 82000 });
    expect(m.diff).toBe(2000);
    expect(m.pct).toBeCloseTo(2.5, 10);
    expect(m.seconds).toBe(3600);
    expect(measure({ t: 5, p: 100 }, { t: 1, p: 90 }).pct).toBeCloseTo(-10, 10);
  });
});

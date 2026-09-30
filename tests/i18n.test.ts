import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "../packages/core/src/en";
import { detectLang, setLang, t } from "../packages/core/src/i18n";

const root = join(__dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === "dist" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

// Todo texto que pasa por t("...") o tr("...") tiene que tener su traducción al inglés.
describe("traducciones", () => {
  const files = [...walk(join(root, "src")), ...walk(join(root, "mobile/src")), join(root, "mobile/App.tsx"), join(root, "packages/core/src/trading.ts")];
  const literal = /(?<![\w.])(?:t|tr)\(\s*("(?:[^"\\\n]|\\.)*")/g;

  it("no falta ninguna frase en inglés", () => {
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(literal)) {
        let key: string;
        try {
          key = JSON.parse(m[1]);
        } catch {
          continue;
        }
        if (!(key in EN)) missing.push(`${relative(root, f)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("las claves con {variables} conservan las mismas variables en inglés", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const bad = Object.entries(EN).filter(([es, en]) => JSON.stringify(vars(es)) !== JSON.stringify(vars(en)));
    expect(bad.map(([es]) => es)).toEqual([]);
  });

  it("cambia de idioma y reemplaza variables", () => {
    setLang("en");
    expect(t("Copiar")).toBe("Copy");
    expect(t("Conectar {name}", { name: "Binance" })).toBe("Connect Binance");
    setLang("es");
    expect(t("Conectar {name}", { name: "Binance" })).toBe("Conectar Binance");
    expect(t("frase que no existe")).toBe("frase que no existe");
  });

  it("detecta el idioma del dispositivo", () => {
    expect(detectLang("es-AR")).toBe("es");
    expect(detectLang("pt-BR")).toBe("en");
    expect(detectLang(null)).toBe("es");
  });
});

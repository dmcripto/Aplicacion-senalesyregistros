import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareVersions, newerVersion, parseUpdateInfo } from "../packages/core/src/trading";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("aviso de versión nueva de la app", () => {
  it("compara versiones número por número (no como texto)", () => {
    expect(compareVersions("1.5.1", "1.5.0")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.5", "1.5.0")).toBe(0);
    expect(compareVersions("1.4.9", "1.5.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  const ok = { version: "1.6.0", url: "https://github.com/dmcripto/Aplicacion-senalesyregistros/releases/download/android-v1.6.0-30/VELTRIX.apk", notes: "Algo nuevo." };

  it("lee el archivo de versión y rechaza lo que no cuadra o no es de nuestras descargas", () => {
    expect(parseUpdateInfo(ok)).toEqual(ok);
    expect(parseUpdateInfo({ ...ok, notes: "" })?.notes).toBeUndefined();
    expect(parseUpdateInfo(null)).toBeNull();
    expect(parseUpdateInfo({ ...ok, version: "nueva" })).toBeNull();
    expect(parseUpdateInfo({ ...ok, url: "https://malo.example.com/VELTRIX.apk" })).toBeNull();
    expect(parseUpdateInfo({ ...ok, url: "http://github.com/dmcripto/Aplicacion-senalesyregistros/releases/download/x/y.apk" })).toBeNull();
    expect(parseUpdateInfo({ version: "1.6.0" })).toBeNull();
    // el repositorio de descargas aparte también es de confianza; uno ajeno, no
    const apart = { ...ok, url: "https://github.com/dmcripto/veltrix-descargas/releases/download/android-v1.6.1-31/VELTRIX.apk" };
    expect(parseUpdateInfo(apart)).toEqual(apart);
    expect(parseUpdateInfo({ ...ok, url: "https://github.com/otra-persona/veltrix-descargas/releases/download/x/VELTRIX.apk" })).toBeNull();
  });

  it("solo avisa si la versión publicada es más nueva que la instalada", () => {
    expect(newerVersion("1.5.0", parseUpdateInfo(ok))).toEqual(ok);
    expect(newerVersion("1.6.0", parseUpdateInfo(ok))).toBeNull();
    expect(newerVersion("1.7.0", parseUpdateInfo(ok))).toBeNull();
    expect(newerVersion(undefined, parseUpdateInfo(ok))).toBeNull();
    expect(newerVersion("1.5.0", null)).toBeNull();
  });

  it("el archivo publicado coincide con la versión de la app y con el botón de descarga de la web", () => {
    const info = parseUpdateInfo(JSON.parse(read("public/app/version.json")));
    expect(info).not.toBeNull();
    const appVersion = JSON.parse(read("mobile/app.json")).expo.version;
    expect(info!.version).toBe(appVersion); // si se sube la versión de la app, hay que actualizar también public/app/version.json
    expect(info!.url).toContain(`android-v${appVersion}-`);
    expect(read("src/components/DownloadApp.tsx")).toContain(info!.url);
    expect(read("public/app/index.html")).toContain(info!.url);
  });
});

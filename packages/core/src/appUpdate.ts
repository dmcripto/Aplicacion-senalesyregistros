// Aviso de versión nueva de la app de Android. El archivo público /app/version.json (se publica junto con la web) dice cuál es la última versión y
// dónde bajarla; la app lo mira al abrirse y cada vez que vuelve al frente, y avisa si la suya es más vieja.

export interface UpdateInfo {
  version: string; // por ejemplo «1.5.1»
  url: string; // dirección de descarga del APK
  notes?: string; // qué trae (una frase)
}

/** Dirección del archivo que dice cuál es la última versión. */
export const UPDATE_URL = "https://www.veltrix-trading.com.ar/app/version.json";

/** Compara dos versiones con números separados por puntos: negativo si a < b, 0 si son iguales, positivo si a > b. Lo que no es número cuenta como 0. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Lee el archivo de versión con cuidado: si algo no cuadra (o la dirección no es de descarga de nuestro repositorio), devuelve null. */
export function parseUpdateInfo(raw: unknown): UpdateInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const version = typeof r.version === "string" ? r.version.trim() : "";
  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!/^\d+(\.\d+){1,3}$/.test(version)) return null;
  if (!/^https:\/\/github\.com\/dmcripto\/Aplicacion-senalesyregistros\/releases\/download\//.test(url)) return null;
  const notes = typeof r.notes === "string" && r.notes.trim() ? r.notes.trim().slice(0, 200) : undefined;
  return { version, url, notes };
}

/** La versión nueva, si es más reciente que la instalada; si no, null. */
export function newerVersion(current: string | null | undefined, info: UpdateInfo | null): UpdateInfo | null {
  if (!info || !current) return null;
  return compareVersions(info.version, current) > 0 ? info : null;
}

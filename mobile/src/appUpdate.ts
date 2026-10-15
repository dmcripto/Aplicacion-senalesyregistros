import Constants from "expo-constants";
import { UPDATE_URL, newerVersion, parseUpdateInfo } from "@dmcripto/core";
import type { UpdateInfo } from "@dmcripto/core";

/** Mira si hay una versión más nueva de la app. Si no hay conexión o algo falla, devuelve null (nunca molesta ni rompe nada). */
export async function checkAppUpdate(): Promise<UpdateInfo | null> {
  try {
    const current = Constants.expoConfig?.version;
    const res = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(8000), headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) return null;
    return newerVersion(current, parseUpdateInfo(await res.json()));
  } catch {
    return null;
  }
}

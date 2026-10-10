// Después de publicar una versión nueva, una pestaña que quedó abierta con la versión vieja puede pedir un archivo que ya no existe
// («Failed to fetch dynamically imported module»). En vez de mostrar «Algo salió mal», se recarga sola una vez para traer la versión nueva.

const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|Failed to fetch dynamically/i;
const KEY = "veltrix_chunk_reload";

export const isStaleChunkError = (e: unknown): boolean => STALE.test(String((e as { message?: unknown } | null | undefined)?.message ?? e ?? ""));

/** Recarga la página, pero a lo sumo una vez por minuto (para no entrar en un ciclo si el problema es otro). */
export function reloadOnceForNewVersion(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    /* sin almacenamiento: se recarga igual */
  }
  window.location.reload();
  return true;
}

// ─── VELTRIX · Filtro de desbloqueos de tokens ──────────────────────────────
// Un desbloqueo grande (tokens que se liberan de golpe) suele presionar el precio a la baja. Este filtro lo usa así:
//   · «careful» (cuidadoso): no abre COMPRAS cuando falta poco para un desbloqueo grande de ese activo.
//   · «aggressive» (agresivo): además de lo anterior, busca VENTAS antes del desbloqueo: acepta la ruptura a la baja con una
//     condición de tendencia más relajada (solo exige estar bajo la media lenta) y la pone primera si hay más señales que lugares.
// En ningún modo el desbloqueo solo abre una operación: siempre hace falta la ruptura técnica del perfil.
// Las fechas y los porcentajes los carga la función que lee la fuente de datos (tabla token_unlocks); acá no se sabe de dónde vienen.
// Sin dependencias de Deno ni de la red, para probarlo en local. La señal ya filtrada (signalWithUnlock) vive en botStrategy.ts.

export type UnlockMode = "off" | "careful" | "aggressive";
export const UNLOCK_MODES: UnlockMode[] = ["off", "careful", "aggressive"];

export interface UnlockSettings {
  mode: UnlockMode;
  /** Cuántos días antes del desbloqueo se aplica el filtro. */
  windowDays: number;
  /** Tamaño mínimo del desbloqueo, en % de lo que ya circula. */
  minPct: number;
}

export const DEFAULT_UNLOCK: UnlockSettings = { mode: "off", windowDays: 7, minPct: 2 };
export const UNLOCK_LIMITS = { windowDays: { min: 1, max: 30 }, minPct: { min: 0.1, max: 50 } } as const;

/** Un desbloqueo: activo del bot (por ejemplo ARBUSDT), momento y tamaño sobre lo que circula. */
export interface UnlockEvent {
  symbol: string;
  at: number; // ms
  pct: number; // % de la oferta circulante
}

export const isUnlockMode = (x: unknown): x is UnlockMode => typeof x === "string" && (UNLOCK_MODES as string[]).includes(x);

/** Ajustes bien formados a partir de lo que guardó la base (valores fuera de rango se ajustan; modo desconocido = apagado). */
export function cleanUnlock(raw: { mode?: unknown; windowDays?: unknown; minPct?: unknown } | null | undefined): UnlockSettings {
  const num = (v: unknown, lo: number, hi: number, fb: number) => {
    const n = v == null || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
  };
  return {
    mode: isUnlockMode(raw?.mode) ? raw!.mode as UnlockMode : "off",
    windowDays: Math.round(num(raw?.windowDays, UNLOCK_LIMITS.windowDays.min, UNLOCK_LIMITS.windowDays.max, DEFAULT_UNLOCK.windowDays)),
    minPct: num(raw?.minPct, UNLOCK_LIMITS.minPct.min, UNLOCK_LIMITS.minPct.max, DEFAULT_UNLOCK.minPct),
  };
}

/** Normaliza el nombre del activo para comparar (BTCUSDT.P = BTCUSDT). */
const norm = (s: string) => s.toUpperCase().replace(/\.P$|PERP$/, "").replace(/(USDC|USD)$/, "USDT");

/** El desbloqueo grande más cercano que todavía no pasó y cae dentro de la ventana. Null si no hay ninguno (o el filtro está apagado). */
export function bigUnlockAhead(events: UnlockEvent[], symbol: string, now: number, cfg: UnlockSettings): UnlockEvent | null {
  if (cfg.mode === "off") return null;
  const horizon = now + cfg.windowDays * 86_400_000;
  const key = norm(symbol);
  let best: UnlockEvent | null = null;
  for (const e of events) {
    if (norm(e.symbol) !== key || e.at <= now || e.at > horizon || !(e.pct >= cfg.minPct)) continue;
    if (!best || e.at < best.at) best = e;
  }
  return best;
}

/** Frase corta para la nota de la operación (sin datos de la fuente). */
export const unlockNote = (cfg: UnlockSettings, boosted: boolean) =>
  boosted ? "Filtro de desbloqueos (modo agresivo): venta ante un desbloqueo grande cercano." : `Filtro de desbloqueos (${cfg.mode === "aggressive" ? "agresivo" : "cuidadoso"}).`;

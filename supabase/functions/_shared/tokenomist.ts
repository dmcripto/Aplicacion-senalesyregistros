// Lectura de los desbloqueos de Tokenomist (GET /v5/unlock/events/upcoming) y paso al formato de la tabla token_unlocks.
// Sin dependencias de Deno ni de la red, para probarlo en local.

export interface UnlockRow {
  symbol: string; // par del bot, por ejemplo ZROUSDT
  at: string; // ISO
  pct: number; // % de lo que ya circula (valor del desbloqueo / capitalización de mercado)
}

const SYMBOL = /^[A-Z0-9]{2,15}USDT$/;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Convierte la respuesta de Tokenomist en filas para la tabla. Lo que no se entiende se descarta (nunca se inventa un dato). */
export function parseUpcomingUnlocks(data: unknown): UnlockRow[] {
  const out = new Map<string, UnlockRow>();
  for (const item of Array.isArray(data) ? data : []) {
    const it = item as any;
    const sym = String(it?.tokenSymbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const symbol = `${sym}USDT`;
    const ev = it?.upcomingEvent;
    const t = Date.parse(String(ev?.unlockDate ?? ""));
    const cliff = ev?.cliffUnlocks;
    // Tamaño sobre lo que circula: «valueToMarketCap» ya viene en %; si falta, se calcula con el valor y la capitalización.
    let pct = num(cliff?.valueToMarketCap);
    if (pct == null) {
      const value = num(cliff?.cliffValue), cap = num(it?.marketCap);
      pct = value != null && cap != null && cap > 0 ? (value / cap) * 100 : null;
    }
    if (!SYMBOL.test(symbol) || !Number.isFinite(t) || pct == null || pct < 0) continue;
    const at = new Date(t).toISOString();
    const key = `${symbol}|${at}`;
    const prev = out.get(key);
    if (!prev || pct > prev.pct) out.set(key, { symbol, at, pct: Number(pct.toFixed(4)) });
  }
  return [...out.values()];
}

/** Fecha YYYY-MM-DD (UTC) sumando días. */
export const isoDay = (ms: number, addDays = 0) => new Date(ms + addDays * 86_400_000).toISOString().slice(0, 10);

/**
 * La prueba gratuita solo deja pedir cierto rango de fechas, y el mensaje de error lo dice. Se leen las dos formas que mandó Tokenomist:
 *   «date must be within the allowed range: 2025-01-01 to 2026-01-01»
 *   «Invalid Date Range : The available range for unlock events data are 2025-10-16 - 2026-10-16»
 */
export function parseAllowedRange(message: unknown): { from: string; to: string } | null {
  const m = /(?:allowed|available) range[^0-9]*(\d{4}-\d{2}-\d{2})\s*(?:to|-|–|—)\s*(\d{4}-\d{2}-\d{2})/i.exec(String(message ?? ""));
  return m ? { from: m[1], to: m[2] } : null;
}

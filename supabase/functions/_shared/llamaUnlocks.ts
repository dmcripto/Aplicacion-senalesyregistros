// Lectura de los desbloqueos de DefiLlama (calendario de emisiones abierto) y paso al formato de la tabla token_unlocks.
// Alternativa gratuita a Tokenomist. El formato de la respuesta se lee con mucho cuidado (varios nombres posibles por dato) y lo que no se
// entiende se descarta: nunca se inventa un dato. Sin dependencias de Deno ni de la red, para probarlo en local.

import type { UnlockRow } from "./tokenomist.ts";

const LL_SYMBOL = /^[A-Z0-9]{2,15}USDT$/;

const llNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Suma de tokens: un número, o una lista de números (varias categorías que se desbloquean el mismo día). */
const llTokens = (v: unknown): number | null => {
  if (Array.isArray(v)) {
    const nums = v.map(llNum).filter((x): x is number => x != null && x > 0);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }
  return llNum(v);
};

/** Fecha en milisegundos desde segundos, milisegundos o texto ISO. */
const llToMs = (v: unknown): number | null => {
  const n = llNum(v);
  if (n != null) return n < 1e11 ? n * 1000 : n;
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : null;
};

/** El próximo desbloqueo de un activo: «nextEvent» o, si no está, el primero futuro de la lista de eventos. */
function nextEventOf(it: any, nowMs: number): any | null {
  const direct = it?.nextEvent ?? it?.upcomingEvent;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const list = Array.isArray(it?.events) ? it.events : Array.isArray(it?.upcomingEvents) ? it.upcomingEvents : [];
  const future = list
    .map((e: any) => ({ e, t: llToMs(e?.timestamp ?? e?.date) }))
    .filter((x: { t: number | null }) => x.t != null && x.t >= nowMs)
    .sort((a: { t: number }, b: { t: number }) => a.t - b.t);
  return future[0]?.e ?? null;
}

/**
 * Convierte la respuesta de DefiLlama en filas para la tabla. `pct` es el tamaño del desbloqueo sobre lo que ya circula: con la cantidad de tokens
 * y la oferta circulante, o con el valor en dólares y la capitalización. Solo se guardan los de los próximos `horizonDays` días y de al menos `minPct`.
 */
export function parseLlamaEmissions(data: unknown, nowMs: number, horizonDays = 30, minPct = 0.5): UnlockRow[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : [];
  const out = new Map<string, UnlockRow>();
  for (const it of list as any[]) {
    const sym = String(it?.symbol ?? it?.ticker ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const symbol = `${sym}USDT`;
    const ev = nextEventOf(it, nowMs);
    if (!ev || !LL_SYMBOL.test(symbol)) continue;
    const t = llToMs(ev.date ?? ev.timestamp ?? ev.unlockDate);
    if (t == null || t < nowMs - 3_600_000 || t > nowMs + horizonDays * 86_400_000) continue;

    let pct = llNum(ev.unlockPercentage ?? ev.percentOfCirculating);
    if (pct == null) {
      const amount = llTokens(ev.toUnlock ?? ev.noOfTokens ?? ev.tokens);
      const circ = llNum(it.circSupply ?? it.circulatingSupply);
      const price = llNum(it.tPrice ?? it.price);
      const cap = llNum(it.mcap ?? it.marketCap);
      if (amount != null && circ != null && circ > 0) pct = (amount / circ) * 100;
      else if (amount != null && price != null && cap != null && cap > 0) pct = ((amount * price) / cap) * 100;
    }
    if (pct == null || !(pct >= minPct)) continue;
    const at = new Date(t).toISOString();
    const key = `${symbol}|${at}`;
    const prev = out.get(key);
    if (!prev || pct > prev.pct) out.set(key, { symbol, at, pct: Number(pct.toFixed(4)) });
  }
  return [...out.values()];
}

/** Qué forma tiene la respuesta (para el modo de diagnóstico): cuántos activos, y los nombres de los datos del primero. Nunca devuelve los datos en sí. */
export function describeLlama(data: unknown) {
  const list = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : [];
  const first = list[0] as any;
  return {
    items: list.length,
    keys: first && typeof first === "object" ? Object.keys(first).slice(0, 40) : [],
    nextEventKeys: first?.nextEvent && typeof first.nextEvent === "object" ? Object.keys(first.nextEvent) : [],
  };
}

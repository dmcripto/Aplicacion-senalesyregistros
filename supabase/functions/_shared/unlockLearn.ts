// «Aprender» del período de prueba de Tokenomist: se guarda todo lo que la fuente entrega (respuestas completas y, aparte, cada evento ya leído) para que, cuando
// termine la prueba, el sistema siga con lo aprendido: muchos desbloqueos se repiten con un ritmo fijo (por ejemplo, cada mes el mismo día) y se pueden proyectar.
// Todo se lee con cuidado (los nombres de los datos pueden variar) y lo que no se entiende se descarta: nunca se inventa un dato. Sin red ni Deno, para probarlo en local.

export interface HistRow {
  symbol: string; // par del bot, por ejemplo ZROUSDT
  at: string; // ISO
  pct: number; // % sobre lo que circula
}
export interface TokenRef {
  id: string; // identificador para pedir sus eventos (slug)
  symbol: string; // símbolo, por ejemplo ZRO
}

const UL_SYMBOL = /^[A-Z0-9]{2,15}USDT$/;
const DATE_KEYS = ["unlockDate", "date", "timestamp", "startDate"];

const ulNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

const ulToMs = (v: unknown): number | null => {
  const n = ulNum(v);
  if (n != null) return n < 1e11 ? n * 1000 : n;
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : null;
};

/** Recorre cualquier JSON y llama a `visit` con cada objeto (con tope de profundidad). */
function ulWalk(node: unknown, visit: (o: Record<string, unknown>) => void, depth = 0) {
  if (depth > 8 || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) ulWalk(x, visit, depth + 1);
    return;
  }
  visit(node as Record<string, unknown>);
  for (const v of Object.values(node as Record<string, unknown>)) ulWalk(v, visit, depth + 1);
}

/** El primer número que aparece con ese nombre dentro del objeto (a cualquier profundidad razonable). */
function findNumber(node: unknown, key: string, depth = 0): number | null {
  if (depth > 4 || node == null || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (!Array.isArray(o) && key in o) {
    const n = ulNum(o[key]);
    if (n != null) return n;
  }
  for (const v of Object.values(o)) {
    const n = findNumber(v, key, depth + 1);
    if (n != null) return n;
  }
  return null;
}

/** De la lista de tokens de la fuente saca {id, símbolo}: objetos que tengan algo parecido a un identificador y a un símbolo. */
export function extractTokens(json: unknown): TokenRef[] {
  const out = new Map<string, TokenRef>();
  ulWalk(json, (o) => {
    const id = [o.slug, o.tokenId, o.id].find((x) => typeof x === "string" && x.trim() !== "") as string | undefined;
    const sym = [o.tokenSymbol, o.symbol].find((x) => typeof x === "string" && x.trim() !== "") as string | undefined;
    if (!id || !sym) return;
    const symbol = sym.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!UL_SYMBOL.test(`${symbol}USDT`)) return;
    if (!out.has(id)) out.set(id, { id: id.trim(), symbol });
  });
  return [...out.values()];
}

/**
 * De la respuesta de los eventos de un token saca cada desbloqueo (fecha y tamaño en % de lo que circula): objetos con fecha y con «valueToMarketCap»
 * (ya en %), o con valor en dólares y capitalización de mercado. Si hay varios el mismo día, queda el más grande.
 */
export function extractEvents(json: unknown, symbol: string): HistRow[] {
  const sym = `${String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, "")}USDT`;
  if (!UL_SYMBOL.test(sym)) return [];
  const cap = findNumber(json, "marketCap");
  const out = new Map<string, HistRow>();
  ulWalk(json, (o) => {
    const dk = DATE_KEYS.find((k) => k in o && ulToMs(o[k]) != null);
    if (!dk) return;
    const t = ulToMs(o[dk]) as number;
    let pct = findNumber(o, "valueToMarketCap");
    if (pct == null) {
      const value = findNumber(o, "cliffValue") ?? findNumber(o, "unlockValue");
      const c = findNumber(o, "marketCap") ?? cap;
      pct = value != null && c != null && c > 0 ? (value / c) * 100 : null;
    }
    if (pct == null || pct < 0) return;
    const day = new Date(t).toISOString().slice(0, 10);
    const key = `${sym}|${day}`;
    const prev = out.get(key);
    if (!prev || pct > prev.pct) out.set(key, { symbol: sym, at: new Date(t).toISOString(), pct: Number(pct.toFixed(4)) });
  });
  return [...out.values()];
}

const UL_DAY = 86_400_000;
const ulMedian = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Proyecta los próximos desbloqueos de los activos que se repiten con ritmo fijo: al menos 3 desbloqueos grandes (de `minPct` o más) cuyos tiempos
 * entre uno y otro varían poco (±15 %, y no menos de 20 días de ritmo). El tamaño proyectado es la mediana de los últimos tres. Si el último evento
 * conocido es muy viejo respecto de su ritmo, no se proyecta nada. Devuelve solo los que caen en los próximos `horizonDays` días.
 */
export function projectRecurring(history: HistRow[], nowMs: number, horizonDays = 30, minPct = 0.5): HistRow[] {
  const bySymbol = new Map<string, HistRow[]>();
  for (const h of history) {
    if (!(h.pct >= minPct) || !UL_SYMBOL.test(h.symbol)) continue;
    const list = bySymbol.get(h.symbol) ?? [];
    list.push(h);
    bySymbol.set(h.symbol, list);
  }
  const out: HistRow[] = [];
  for (const [symbol, rows] of bySymbol) {
    // Se juntan los de días seguidos (un mismo desbloqueo registrado en dos fechas pegadas) y se queda el más grande.
    const evs: Array<{ t: number; pct: number }> = [];
    for (const r of rows.map((x) => ({ t: Date.parse(x.at), pct: x.pct })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t)) {
      const last = evs[evs.length - 1];
      if (last && r.t - last.t < 3 * UL_DAY) last.pct = Math.max(last.pct, r.pct);
      else evs.push({ ...r });
    }
    const recent = evs.slice(-6);
    if (recent.length < 3) continue;
    const gaps = recent.slice(1).map((e, i) => (e.t - recent[i].t) / UL_DAY);
    const gap = ulMedian(gaps);
    if (gap < 20 || gaps.some((g) => Math.abs(g - gap) > gap * 0.15)) continue;
    const lastT = recent[recent.length - 1].t;
    if (nowMs - lastT > gap * 2.5 * UL_DAY) continue;
    const pct = ulMedian(recent.slice(-3).map((e) => e.pct));
    for (let t = lastT + gap * UL_DAY; t <= nowMs + horizonDays * UL_DAY; t += gap * UL_DAY) {
      if (t < nowMs - UL_DAY) continue;
      out.push({ symbol, at: new Date(Math.round(t)).toISOString(), pct: Number(pct.toFixed(4)) });
    }
  }
  return out;
}

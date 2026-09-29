// ─── DMCRIPTO · Lógica del diario (compartida entre web y móvil) ───────────
// Funciones puras, sin dependencias del DOM ni de un runtime en particular,
// para poder importarse tanto desde la app web (Vite) como desde la app
// móvil (Expo/React Native).

export type Direction = "LONG" | "SHORT";
export type Outcome = "ABIERTA" | "TP" | "SL" | "MANUAL";

export interface Trade {
  id: string;
  symbol: string;
  direction: Direction;
  entry: number;
  tp: number;
  sl: number;
  date: string; // ISO — apertura
  outcome: Outcome;
  exit?: number;
  closedAt?: string;
  notes?: string;
}

export type NewTrade = Omit<Trade, "id" | "outcome" | "closedAt" | "exit">;

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Cálculos ───────────────────────────────────────────────────────────────

export const riskOf = (t: Trade) => Math.abs(t.entry - t.sl);

export const rrOf = (t: Trade) => {
  const risk = riskOf(t);
  return risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
};

/** R obtenido: TP = +R:R planificado · SL = −1 · MANUAL = (salida−entrada)/riesgo */
export const resultR = (t: Trade): number | null => {
  if (t.outcome === "ABIERTA") return null;
  const risk = riskOf(t);
  if (risk <= 0) return 0;
  const dir = t.direction === "LONG" ? 1 : -1;
  if (t.outcome === "TP") return (dir * (t.tp - t.entry)) / risk;
  if (t.outcome === "SL") return -1;
  const exit = t.exit ?? t.entry;
  return (dir * (exit - t.entry)) / risk;
};

export interface Stats {
  total: number;
  abiertas: number;
  cerradas: number;
  ganadas: number;
  perdidas: number;
  winRate: number;
  netR: number;
  avgR: number;
  pf: number | null; // profit factor
  bestR: number;
  worstR: number;
}

export function computeStats(trades: Trade[]): Stats {
  const abiertas = trades.filter((t) => t.outcome === "ABIERTA").length;
  const closed = trades.filter((t) => t.outcome !== "ABIERTA");
  const rs = closed.map((t) => resultR(t) ?? 0);
  const ganadas = rs.filter((r) => r > 0).length;
  const perdidas = rs.filter((r) => r < 0).length;
  const grossWin = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(rs.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  const netR = rs.reduce((a, b) => a + b, 0);
  return {
    total: trades.length,
    abiertas,
    cerradas: closed.length,
    ganadas,
    perdidas,
    winRate: closed.length ? (ganadas / closed.length) * 100 : 0,
    netR,
    avgR: closed.length ? netR / closed.length : 0,
    pf: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    bestR: rs.length ? Math.max(...rs) : 0,
    worstR: rs.length ? Math.min(...rs) : 0,
  };
}

export interface EquityPoint {
  trade: Trade;
  cum: number;
  r: number;
}

export function equitySeries(trades: Trade[]): EquityPoint[] {
  const closed = trades
    .filter((t) => t.outcome !== "ABIERTA")
    .sort(
      (a, b) =>
        new Date(a.closedAt ?? a.date).getTime() -
        new Date(b.closedAt ?? b.date).getTime(),
    );
  let cum = 0;
  return closed.map((t) => {
    const r = resultR(t) ?? 0;
    cum += r;
    return { trade: t, cum, r };
  });
}

export interface MonthRow {
  key: string;
  label: string;
  ops: number;
  cerradas: number;
  winRate: number;
  netR: number;
}

export function monthlySummary(trades: Trade[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const t of trades) {
    const key = (t.date || new Date().toISOString()).slice(0, 7);
    let row = map.get(key);
    if (!row) {
      const d = new Date(key + "-01T12:00:00");
      row = {
        key,
        label: d.toLocaleDateString("es-ES", { month: "short", year: "numeric" }),
        ops: 0,
        cerradas: 0,
        winRate: 0,
        netR: 0,
      };
      map.set(key, row);
    }
    row.ops += 1;
    if (t.outcome !== "ABIERTA") {
      row.cerradas += 1;
      const r = resultR(t) ?? 0;
      row.netR += r;
      if (r > 0) row.winRate += 1;
    }
  }
  const rows = [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
  for (const r of rows) r.winRate = r.cerradas ? (r.winRate / r.cerradas) * 100 : 0;
  return rows;
}

// ─── Parser de alertas ──────────────────────────────────────────────────────
// Formato: DMCRIPTO|SYMBOL|DIRECCION|ENTRADA|TP|SL  (también acepta 5 campos sin prefijo)

const norm = (s: string) =>
  s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

function parseDirection(raw: string): Direction | null {
  const s = norm(raw);
  if (["COMPRA", "LONG", "BUY", "L", "C"].includes(s)) return "LONG";
  if (["VENTA", "SHORT", "SELL", "S", "V"].includes(s)) return "SHORT";
  return null;
}

export interface ParseResult {
  valid: NewTrade[];
  errors: string[];
}

const KEY_ALIASES: Record<"symbol" | "direction" | "entry" | "tp" | "sl", string[]> = {
  symbol: ["symbol", "ticker", "pair", "instrument", "simbolo", "par", "activo"],
  direction: ["direction", "side", "action", "dir", "type", "order", "direccion", "signal", "senal", "position"],
  entry: ["entry", "entryprice", "price", "entrada", "close", "precio", "open"],
  tp: ["tp", "tp1", "takeprofit", "target", "objetivo"],
  sl: ["sl", "stoploss", "stop", "stoploss1"],
};

const normKey = (k: string) =>
  k
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const toNum = (v: unknown) => Number(String(v ?? "").trim().replace(",", "."));

/** Interpreta un objeto con campos de una alerta (JSON o clave=valor), con nombres alternativos. */
function tradeFromFields(fields: Record<string, unknown>, label: string): { value?: NewTrade; error?: string } {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(fields)) byKey.set(normKey(k), v);
  const get = (name: keyof typeof KEY_ALIASES) => {
    for (const alias of KEY_ALIASES[name]) {
      const v = byKey.get(alias);
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return undefined;
  };

  const rawSymbol = String(get("symbol") ?? "").trim();
  const symbol = rawSymbol.includes(":") ? rawSymbol.split(":").pop()! : rawSymbol;
  if (!symbol) return { error: `«${label}» — falta el símbolo.` };

  const dirRaw = String(get("direction") ?? "");
  const direction = parseDirection(dirRaw);
  if (!direction) return { error: `«${label}» — dirección «${dirRaw}» no reconocida (usá COMPRA/VENTA, BUY/SELL o LONG/SHORT).` };

  const entry = toNum(get("entry"));
  const tp = toNum(get("tp"));
  const sl = toNum(get("sl"));
  if (![entry, tp, sl].every((n) => Number.isFinite(n) && n > 0)) {
    return { error: `«${label}» — entrada, TP y SL deben ser números válidos.` };
  }
  return { value: { symbol: norm(symbol), direction, entry, tp, sl, date: new Date().toISOString() } };
}

const short = (s: string) => `${s.slice(0, 42)}${s.length > 42 ? "…" : ""}`;

/**
 * Acepta tres formatos, sin importar qué indicador genere la alerta:
 *  1. Pipes:  DMCRIPTO|SÍMBOLO|DIRECCIÓN|ENTRADA|TP|SL  (una alerta por línea)
 *  2. JSON:   {"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":66500,"sl":64500}
 *  3. Claves: symbol=BTCUSDT side=buy entry=65000 tp=66500 sl=64500
 */
export function parseAlerts(text: string): ParseResult {
  const valid: NewTrade[] = [];
  const errors: string[] = [];
  const body = text.trim();
  if (!body) return { valid, errors: ["Pegá al menos una línea de alerta."] };

  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (!item || typeof item !== "object") {
          errors.push("JSON inválido: cada alerta debe ser un objeto.");
          continue;
        }
        const r = tradeFromFields(item as Record<string, unknown>, short(JSON.stringify(item)));
        if (r.value) valid.push(r.value);
        else errors.push(r.error!);
      }
    } catch {
      errors.push("El JSON no es válido (revisá comillas y comas).");
    }
    return { valid, errors };
  }

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.includes("|") && /[=:]/.test(line)) {
      const fields: Record<string, string> = {};
      for (const m of line.matchAll(/([A-Za-z_]+)\s*[=:]\s*([^\s,;]+)/g)) fields[m[1]] = m[2];
      const r = tradeFromFields(fields, short(line));
      if (r.value) valid.push(r.value);
      else errors.push(r.error!);
      continue;
    }

    let parts = line.split("|").map((p) => p.trim());
    if (parts.length === 6 && norm(parts[0]).startsWith("DMCRIPTO")) parts = parts.slice(1);
    if (parts.length !== 5) {
      errors.push(`«${short(line)}» — se esperan 6 campos separados por |`);
      continue;
    }
    const [symbol, dirRaw, entry, tp, sl] = parts;
    const r = tradeFromFields({ symbol, direction: dirRaw, entry, tp, sl }, short(line));
    if (r.value) valid.push(r.value);
    else errors.push(r.error!);
  }
  return { valid, errors };
}

// ─── Armador de mensajes de alerta ──────────────────────────────────────────

export type AlertFormat = "pipe" | "json";

export interface AlertMessageOptions {
  format: AlertFormat;
  direction: Direction;
  /** Lo que va en cada campo: un {{placeholder}} de TradingView o un número fijo. */
  entry: string;
  tp: string;
  sl: string;
}

/** Genera el texto que hay que pegar en el campo "Mensaje" de la alerta de TradingView. */
export function buildAlertMessage(o: AlertMessageOptions): string {
  const entry = o.entry.trim() || "{{close}}";
  const tp = o.tp.trim() || "TP";
  const sl = o.sl.trim() || "SL";
  if (o.format === "json") {
    const side = o.direction === "LONG" ? "buy" : "sell";
    return `{"symbol":"{{ticker}}","side":"${side}","entry":${entry},"tp":${tp},"sl":${sl}}`;
  }
  return `DMCRIPTO|{{ticker}}|${o.direction === "LONG" ? "COMPRA" : "VENTA"}|${entry}|${tp}|${sl}`;
}

// ─── Formateo ───────────────────────────────────────────────────────────────

export const fmtPrice = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 5 : 2 });

export const fmtR = (r: number, dec = 1) =>
  (r >= 0 ? "+" : "−") + Math.abs(r).toFixed(dec).replace(/\.0$/, "");

export const fmtPct = (n: number, dec = 0) => `${n.toFixed(dec)}%`;

export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) +
    " · " +
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  );
};

export const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ─── CSV ────────────────────────────────────────────────────────────────────

export function tradesToCsv(trades: Trade[]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Fecha", "Activo", "Direccion", "Entrada", "TP", "SL", "Estado", "Salida", "R", "Notas"];
  const rows = trades.map((t) => [
    new Date(t.date).toLocaleString("es-ES"),
    t.symbol,
    t.direction,
    t.entry,
    t.tp,
    t.sl,
    t.outcome,
    t.exit ?? "",
    resultR(t)?.toFixed(2) ?? "",
    t.notes ?? "",
  ]);
  return "﻿" + [head, ...rows].map((r) => r.map(esc).join(";")).join("\n");
}

// ─── Datos de ejemplo ───────────────────────────────────────────────────────

const at = (daysAgo: number, hm: string, plusH = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const [h, m] = hm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  if (plusH) d.setHours(d.getHours() + plusH);
  return d.toISOString();
};

const mk = (
  daysAgo: number,
  hm: string,
  symbol: string,
  direction: Direction,
  entry: number,
  tp: number,
  sl: number,
  outcome: Outcome,
  plusH = 5,
  exit?: number,
): Trade => ({
  id: uid(),
  symbol,
  direction,
  entry,
  tp,
  sl,
  date: at(daysAgo, hm),
  outcome,
  exit,
  closedAt: outcome === "ABIERTA" ? undefined : at(daysAgo, hm, plusH),
});

export function sampleTrades(): Trade[] {
  return [
    mk(45, "09:12", "BTCUSDT", "LONG", 61200, 63100, 60450, "TP", 7),
    mk(42, "15:40", "EURUSD", "SHORT", 1.0865, 1.0805, 1.0892, "SL", 4),
    mk(40, "10:05", "XAUUSD", "LONG", 2352, 2384, 2340, "TP", 9),
    mk(37, "17:22", "SOLUSDT", "LONG", 142.6, 151.4, 139.1, "TP", 6),
    mk(34, "11:48", "NAS100", "SHORT", 18240, 18060, 18330, "SL", 3),
    mk(31, "08:56", "BTCUSDT", "SHORT", 67800, 66100, 68450, "TP", 11),
    mk(28, "14:31", "GBPJPY", "LONG", 191.4, 192.9, 190.75, "MANUAL", 6, 192.3),
    mk(25, "09:44", "ETHUSDT", "LONG", 3120, 3280, 3060, "TP", 8),
    mk(22, "16:10", "US30", "SHORT", 39150, 38750, 39320, "SL", 2),
    mk(19, "10:27", "XAUUSD", "SHORT", 2418, 2392, 2429, "TP", 5),
    mk(15, "13:03", "BTCUSDT", "LONG", 59800, 62200, 59000, "TP", 10),
    mk(12, "09:35", "EURUSD", "LONG", 1.091, 1.0975, 1.0884, "MANUAL", 4, 1.0902),
    mk(9, "15:58", "SOLUSDT", "SHORT", 168.2, 160.5, 171.3, "TP", 7),
    mk(6, "12:16", "NAS100", "LONG", 19420, 19650, 19320, "SL", 3),
    mk(3, "10:49", "ETHUSDT", "SHORT", 3410, 3300, 3455, "TP", 6),
    mk(1, "08:30", "BTCUSDT", "LONG", 65405.8, 66694.4, 65161.1, "ABIERTA"),
    mk(0, "07:15", "XAUUSD", "LONG", 2445, 2470, 2434, "ABIERTA"),
  ];
}

export const EXAMPLE_ALERT = "DMCRIPTO|BTCUSDT|COMPRA|65405.8|66694.4|65161.1";

// ─── DMCRIPTO925 · Lógica del diario ────────────────────────────────────────

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
    .replace(/[\u0300-\u036f]/g, "")
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

export function parseAlerts(text: string): ParseResult {
  const valid: NewTrade[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { valid, errors: ["Pegá al menos una línea de alerta."] };

  for (const line of lines) {
    let parts = line.split("|").map((p) => p.trim());
    if (parts.length === 6 && norm(parts[0]).startsWith("DMCRIPTO")) parts = parts.slice(1);
    if (parts.length !== 5) {
      errors.push(`«${line.slice(0, 42)}${line.length > 42 ? "…" : ""}» — se esperan 6 campos separados por |`);
      continue;
    }
    const [symbol, dirRaw, entryRaw, tpRaw, slRaw] = parts;
    const direction = parseDirection(dirRaw);
    const entry = Number(entryRaw.replace(",", "."));
    const tp = Number(tpRaw.replace(",", "."));
    const sl = Number(slRaw.replace(",", "."));
    if (!symbol) {
      errors.push(`«${line.slice(0, 42)}» — falta el símbolo.`);
      continue;
    }
    if (!direction) {
      errors.push(`«${line.slice(0, 42)}» — dirección «${dirRaw}» no reconocida (usá COMPRA/VENTA o LONG/SHORT).`);
      continue;
    }
    if (![entry, tp, sl].every((n) => Number.isFinite(n) && n > 0)) {
      errors.push(`«${line.slice(0, 42)}» — entrada, TP y SL deben ser números válidos.`);
      continue;
    }
    valid.push({ symbol: norm(symbol), direction, entry, tp, sl, date: new Date().toISOString() });
  }
  return { valid, errors };
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
  return "\uFEFF" + [head, ...rows].map((r) => r.map(esc).join(";")).join("\n");
}

export function downloadCsv(trades: Trade[]) {
  const blob = new Blob([tradesToCsv(trades)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "diario-dmcripto925.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

export const STORAGE_KEY = "dmcripto925.diario.v1";

export const EXAMPLE_ALERT = "DMCRIPTO|BTCUSDT|COMPRA|65405.8|66694.4|65161.1";

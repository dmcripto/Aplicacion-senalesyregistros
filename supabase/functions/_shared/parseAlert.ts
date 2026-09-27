// Parser de una única alerta de TradingView, formato:
// DMCRIPTO|SYMBOL|DIRECCION|ENTRADA|TP|SL  (también acepta 5 campos sin prefijo)
// Espejo minimalista de parseAlerts() en src/lib.ts, sin dependencias del DOM,
// para poder correr en el runtime Deno de las Edge Functions.

export type Direction = "LONG" | "SHORT";

export interface ParsedAlert {
  symbol: string;
  direction: Direction;
  entry: number;
  tp: number;
  sl: number;
}

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

export function parseAlertLine(line: string): { value?: ParsedAlert; error?: string } {
  let parts = line.trim().split("|").map((p) => p.trim());
  if (parts.length === 6 && norm(parts[0]).startsWith("DMCRIPTO")) parts = parts.slice(1);
  if (parts.length !== 5) {
    return { error: `se esperan 5 campos separados por | (symbol|direccion|entrada|tp|sl), se recibieron ${parts.length}` };
  }
  const [symbol, dirRaw, entryRaw, tpRaw, slRaw] = parts;
  const direction = parseDirection(dirRaw);
  const entry = Number(entryRaw.replace(",", "."));
  const tp = Number(tpRaw.replace(",", "."));
  const sl = Number(slRaw.replace(",", "."));
  if (!symbol) return { error: "falta el símbolo" };
  if (!direction) return { error: `dirección «${dirRaw}» no reconocida (usá COMPRA/VENTA o LONG/SHORT)` };
  if (![entry, tp, sl].every((n) => Number.isFinite(n) && n > 0)) {
    return { error: "entrada, TP y SL deben ser números válidos" };
  }
  return { value: { symbol: norm(symbol), direction, entry, tp, sl } };
}

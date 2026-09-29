// Parser de alertas de TradingView para la Edge Function (runtime Deno).
// Espejo de parseAlerts() en packages/core/src/trading.ts: acepta pipes,
// JSON o clave=valor, sin importar qué indicador genere la alerta.

export type Direction = "LONG" | "SHORT";

export interface NewTrade {
  symbol: string;
  direction: Direction;
  entry: number;
  tp: number;
  sl: number;
  date: string;
}

export interface ParseResult {
  valid: NewTrade[];
  errors: string[];
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
 *  1. Pipes:  VELTRIX|SÍMBOLO|DIRECCIÓN|ENTRADA|TP|SL  (una alerta por línea)
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
    if (parts.length === 6) parts = parts.slice(1);
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

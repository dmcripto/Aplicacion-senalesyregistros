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


// ─── Texto libre (Telegram, WhatsApp, Discord…) ─────────────────────────────

const LONG_WORDS = ["LONG", "BUY", "COMPRA", "COMPRAR", "LARGO", "ALCISTA", "BULLISH"];
const SHORT_WORDS = ["SHORT", "SELL", "VENTA", "VENDER", "CORTO", "BAJISTA", "BEARISH"];
const NOT_TICKERS = new Set([
  "ENTRY", "ENTRADA", "ENTER", "ENTRAR", "PRICE", "PRECIO", "STOP", "LOSS", "TAKE", "PROFIT", "TARGET", "TARGETS",
  "TP", "SL", "TP1", "TP2", "TP3", "LEVERAGE", "APALANCAMIENTO", "RISK", "RIESGO", "SIGNAL", "SENAL", "SEÑAL",
  "LIMIT", "MARKET", "ZONA", "ZONE", "SPOT", "FUTURES", "SYMBOL", "PAIR", "PAR", "COIN", "MONEDA", "AND", "THE",
  "FOR", "AT", "EN", "DE", "LA", "EL", "CON", "USDT", "USDC", "USD", "PERP", "MEDIO", "ALTO", "BAJO", "HIGH", "LOW",
]);

/** "65,000.5" · "65.000,5" · "119,13" · "0.000123" → número. */
function toNumber(raw: string, dotThousands = false): number {
  let s = raw.replace(/[^\d.,]/g, "");
  if (dotThousands && /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");
  if (!s) return NaN;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const grp = dec === "." ? "," : ".";
    s = s.split(grp).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    s = after === 3 && lastComma <= 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  return Number(s);
}

const NUM = "(\\d[\\d.,]*\\d|\\d)";

/** Primer número (crudo) tras alguna de las palabras clave; acepta rangos "64000-65000". */
function rawLevelAfter(text: string, keywords: string[]): { a: string; b?: string; range: boolean } | null {
  for (const kw of keywords) {
    const re = new RegExp(`(?:^|[^A-Z0-9])${kw}(?:\\s*\\d(?=\\s*[:=]))?\\s*[:=\\-@]?\\s*(?:[A-Z]{0,6}\\s*)?\\$?\\s*${NUM}(?:\\s*[-–—/]\\s*\\$?${NUM})?`);
    const m = text.match(re);
    if (m && toNumber(m[1]) > 0) return { a: m[1], b: m[2], range: !!m[2] && kw.includes("ENTR") };
  }
  return null;
}

const levelValue = (r: { a: string; b?: string; range: boolean }, dotThousands: boolean) => {
  const a = toNumber(r.a, dotThousands);
  const b = r.b ? toNumber(r.b, dotThousands) : NaN;
  return r.range && Number.isFinite(b) && b > 0 ? (a + b) / 2 : a;
};

export function parseFreeText(input: string): { value?: NewTrade; error?: string } {
  const text = norm(
    input
      .replace(/[*_`~#|>]/g, " ")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
      .replace(/\s+/g, " "),
  );
  if (!text) return { error: "El mensaje está vacío." };

  // Símbolo
  let base: string | null = null;
  let perp = false;
  const named = text.match(/(?:SYMBOL|PAIR|TICKER|PAR|SIMBOLO|COIN|MONEDA|ACTIVO)\s*[:=]\s*([A-Z0-9]{2,15})(?:\s*[/\-_]?\s*(USDT|USDC|USD))?/);
  const pair = text.match(/(?:^|[^A-Z0-9])([A-Z0-9]{2,12})\s?[/\-_]?\s?(USDT|USDC|BUSD|USD)(\.P|PERP)?(?![A-Z0-9])/);
  const tag = text.match(/[$@]([A-Z][A-Z0-9]{1,9})(?![A-Z0-9])/) ?? input.toUpperCase().match(/#([A-Z][A-Z0-9]{1,9})(?![A-Z0-9])/);
  if (named && !NOT_TICKERS.has(named[1])) base = /(USDT|USDC|USD)$/.test(named[1]) ? named[1] : named[1] + (named[2] ?? "USDT");
  else if (pair && !NOT_TICKERS.has(pair[1])) {
    base = `${pair[1]}${pair[2] === "BUSD" ? "USDT" : pair[2]}`;
    perp = !!pair[3];
  } else if (tag && !NOT_TICKERS.has(tag[1])) base = `${tag[1]}USDT`;

  perp = perp || /[$#@]?[A-Z0-9]{2,10}\.P(?![A-Z])/.test(text);

  // Dirección
  const wordRe = (w: string) => new RegExp(`(?:^|[^A-Z])${w}(?![A-Z])`);
  const pos = (words: string[]) => {
    const idx = words.map((w) => text.search(wordRe(w))).filter((i) => i >= 0);
    return idx.length ? Math.min(...idx) : -1;
  };
  const iLong = pos(LONG_WORDS);
  const iShort = pos(SHORT_WORDS);
  let direction: Direction | null = null;
  if (iLong >= 0 && (iShort < 0 || iLong < iShort)) direction = "LONG";
  else if (iShort >= 0) direction = "SHORT";

  // Ticker suelto: la palabra en mayúsculas junto a la dirección ("BTC LONG", "LONG ETH")
  if (!base) {
    const words = text.split(" ").filter((w) => /^[A-Z][A-Z0-9]{1,9}$/.test(w) && !NOT_TICKERS.has(w) && ![...LONG_WORDS, ...SHORT_WORDS].includes(w));
    if (words.length) base = `${words[0]}USDT`;
  }
  if (!base) return { error: "No encontré el activo (ej: BTCUSDT, BTC/USDT o #BTC)." };

  // Niveles
  const rEntry = rawLevelAfter(text, ["ENTRY", "ENTRADA", "ENTRAR", "ENTER", "ZONA DE ENTRADA", "ENTRY ZONE", "PRECIO", "PRICE", "BUY AT", "SELL AT", "COMPRA EN", "VENTA EN", "@"]);
  const rTp = rawLevelAfter(text, ["TAKE PROFIT", "TAKEPROFIT", "TAKE-PROFIT", "TP1", "TP", "TARGET 1", "TARGET", "TARGETS", "OBJETIVO", "OBJETIVOS", "PROFIT"]);
  const rSl = rawLevelAfter(text, ["STOP LOSS", "STOPLOSS", "STOP-LOSS", "SL", "STOP", "PARADA", "CORTE"]);
  if (!rEntry) return { error: "No encontré el precio de entrada (ej: «Entrada: 65000»)." };
  if (!rTp) return { error: "No encontré el take profit (ej: «TP: 66500»)." };
  if (!rSl) return { error: "No encontré el stop loss (ej: «SL: 64500»)." };

  const coherent = (dir: Direction | null, e: number, tp: number, sl: number) =>
    dir === "LONG" ? tp > e && sl < e : dir === "SHORT" ? tp < e && sl > e : tp > e !== sl > e;
  // Un punto seguido de 3 cifras ("3.020") puede ser decimal o miles: se elige la lectura coherente.
  let entry = levelValue(rEntry, false), tp = levelValue(rTp, false), sl = levelValue(rSl, false);
  if (!coherent(direction, entry, tp, sl)) {
    const e2 = levelValue(rEntry, true), t2 = levelValue(rTp, true), s2 = levelValue(rSl, true);
    if (coherent(direction, e2, t2, s2)) {
      [entry, tp, sl] = [e2, t2, s2];
    }
  }
  if (!direction) direction = tp > entry && sl < entry ? "LONG" : tp < entry && sl > entry ? "SHORT" : null;
  if (!direction) return { error: "No pude saber si es compra o venta (usá LONG/SHORT o COMPRA/VENTA)." };

  const ok = direction === "LONG" ? tp > entry && sl < entry : tp < entry && sl > entry;
  if (!ok || ![entry, tp, sl].every((n) => Number.isFinite(n) && n > 0)) {
    return {
      error: `Los niveles no coinciden con ${direction === "LONG" ? "una compra (TP arriba y SL abajo)" : "una venta (TP abajo y SL arriba)"}. Revisá el mensaje.`,
    };
  }
  return { value: { symbol: perp ? `${base}.P` : base, direction, entry, tp, sl, date: new Date().toISOString() } };
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

  if (!body.includes("|")) {
    const blocks = body.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
    for (const block of blocks) {
      if (!block.includes("\n") && /[A-Za-z_]+\s*=\s*\S+/.test(block)) {
        const fields: Record<string, string> = {};
        for (const m of block.matchAll(/([A-Za-z_]+)\s*=\s*([^\s,;]+)/g)) fields[m[1]] = m[2];
        const r = tradeFromFields(fields, short(block));
        if (r.value) {
          valid.push(r.value);
          continue;
        }
      }
      const r = parseFreeText(block);
      if (r.value) valid.push(r.value);
      else errors.push(`«${short(block.replace(/\s+/g, " "))}» — ${r.error}`);
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

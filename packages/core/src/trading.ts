// ─── VELTRIX · Lógica del diario (compartida entre web y móvil) ───────────
// Funciones puras, sin dependencias del DOM ni de un runtime en particular,
// para poder importarse tanto desde la app web (Vite) como desde la app
// móvil (Expo/React Native).

import { getLang, locale, t as tr } from "./i18n";
export * from "./i18n";

export type Direction = "LONG" | "SHORT";
export type Outcome = "ABIERTA" | "TP" | "SL" | "MANUAL";

export interface Trade {
  id: string;
  symbol: string;
  direction: Direction;
  entry: number;
  tp: number; // TP final (el último target)
  sl: number;
  targets?: number[]; // targets parciales (TP1, TP2…) antes del TP final, del más cercano al más lejano
  date: string; // ISO — apertura
  outcome: Outcome;
  exit?: number;
  closedAt?: string;
  notes?: string;
  autoClosed?: boolean;
  source?: string; // exchange de origen si se importó (binance | bybit)
  tags?: string[];
}

export type NewTrade = Omit<Trade, "id" | "outcome" | "closedAt" | "exit" | "autoClosed" | "source">;

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
        label: d.toLocaleDateString(locale(), { month: "short", year: "numeric" }),
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
// Formato: VELTRIX|SYMBOL|DIRECCION|ENTRADA|TP|SL  (también acepta 5 campos sin prefijo)

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

/** Máximo de niveles de take profit por señal (el último es el TP final; los anteriores son targets parciales). */
export const MAX_TARGETS = 5;

/**
 * Separa una lista de take profits en el TP final (el más lejano a favor) y los targets parciales (los demás, del más cercano al más lejano).
 * Ignora los niveles del lado equivocado o repetidos. Con un solo nivel válido no hay targets parciales.
 */
export function splitTargets(direction: Direction, entry: number, levels: number[]): { tp: number; targets?: number[] } | null {
  const dir = direction === "LONG" ? 1 : -1;
  const good = [...new Set(levels.filter((n) => Number.isFinite(n) && n > 0 && dir * (n - entry) > 0))].sort((a, b) => dir * (a - b)).slice(0, MAX_TARGETS);
  if (!good.length) return null;
  const tp = good[good.length - 1];
  return good.length > 1 ? { tp, targets: good.slice(0, -1) } : { tp };
}


const EXTRA_TP_KEYS = ["tp2", "tp3", "tp4", "tp5", "target2", "target3", "target4", "target5", "objetivo2", "objetivo3"];

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
  if (!symbol) return { error: tr("«{label}» — falta el símbolo.", { label }) };

  const dirRaw = String(get("direction") ?? "");
  const direction = parseDirection(dirRaw);
  if (!direction) return { error: tr("«{label}» — dirección «{dir}» no reconocida (usá COMPRA/VENTA, BUY/SELL o LONG/SHORT).", { label, dir: dirRaw }) };

  const entry = toNum(get("entry"));
  // El TP puede traer varios niveles («66000/67000», una lista de JSON o tp1, tp2, tp3…): el más lejano es el TP final.
  const levels: number[] = [];
  const addLevel = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(addLevel);
    for (const part of String(v ?? "").split(/[\/;]/)) {
      const n = toNum(part);
      if (part.trim() && Number.isFinite(n) && n > 0) levels.push(n);
    }
  };
  addLevel(get("tp"));
  for (const k of EXTRA_TP_KEYS) addLevel(byKey.get(k));
  const sl = toNum(get("sl"));
  const split = Number.isFinite(entry) && entry > 0 ? splitTargets(direction, entry, levels) : null;
  const tp = split?.tp ?? levels[0] ?? NaN;
  if (![entry, tp, sl].every((n) => Number.isFinite(n) && n > 0)) {
    return { error: tr("«{label}» — entrada, TP y SL deben ser números válidos.", { label }) };
  }
  return { value: { symbol: norm(symbol), direction, entry, tp, sl, ...(split?.targets ? { targets: split.targets } : {}), date: new Date().toISOString() } };
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

const TP_LABELS = "TAKE PROFITS|TAKE PROFIT|TAKEPROFIT|TARGETS|TARGET|TPS|TP|OBJETIVOS|OBJETIVO";
const NUMN = "\\d[\\d.,]*\\d|\\d";

/** Niveles de TP crudos de un texto: «TP1 65000 · TP2 66000», «Targets: 65000, 66000» o «TP: 65000/66000». Vacío si hay uno solo o ninguno. */
function rawTargets(text: string): string[] {
  const labeled = new Map<number, string>();
  const byIndex = new RegExp(`(?:^|[^A-Z0-9])(?:${TP_LABELS})\\s*([1-9])(?!\\d)\\s*[:=\\-@]*\\s*\\$?\\s*(${NUMN})`, "g");
  for (const m of text.matchAll(byIndex)) if (!labeled.has(Number(m[1]))) labeled.set(Number(m[1]), m[2]);
  if (labeled.size >= 2) return [...labeled.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const list = text.match(new RegExp(`(?:^|[^A-Z0-9])(?:${TP_LABELS})\\s*[:=\\-@]*\\s*\\$?\\s*(?:${NUMN})(?:\\s*[,/;]\\s*\\$?\\s*(?:${NUMN})){1,${MAX_TARGETS - 1}}`));
  return list ? (list[0].match(new RegExp(NUMN, "g")) ?? []) : [];
}

export function parseFreeText(input: string): { value?: NewTrade; error?: string } {
  const text = norm(
    input
      .replace(/[*_`~#|>]/g, " ")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
      .replace(/\s+/g, " "),
  );
  if (!text) return { error: tr("El mensaje está vacío.") };

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
  if (!base) return { error: tr("No encontré el activo (ej: BTCUSDT, BTC/USDT o #BTC).") };

  // Niveles
  const rEntry = rawLevelAfter(text, ["ENTRY", "ENTRADA", "ENTRAR", "ENTER", "ZONA DE ENTRADA", "ENTRY ZONE", "PRECIO", "PRICE", "BUY AT", "SELL AT", "COMPRA EN", "VENTA EN", "@"]);
  const rTp = rawLevelAfter(text, ["TAKE PROFIT", "TAKEPROFIT", "TAKE-PROFIT", "TP1", "TP", "TARGET 1", "TARGET", "TARGETS", "OBJETIVO", "OBJETIVOS", "PROFIT"]);
  const rSl = rawLevelAfter(text, ["STOP LOSS", "STOPLOSS", "STOP-LOSS", "SL", "STOP", "PARADA", "CORTE"]);
  if (!rEntry) return { error: tr("No encontré el precio de entrada (ej: «Entrada: 65000»).") };
  if (!rTp) return { error: tr("No encontré el take profit (ej: «TP: 66500»).") };
  if (!rSl) return { error: tr("No encontré el stop loss (ej: «SL: 64500»).") };

  const coherent = (dir: Direction | null, e: number, tp: number, sl: number) =>
    dir === "LONG" ? tp > e && sl < e : dir === "SHORT" ? tp < e && sl > e : tp > e !== sl > e;
  // Un punto seguido de 3 cifras ("3.020") puede ser decimal o miles: se elige la lectura coherente.
  let entry = levelValue(rEntry, false), tp = levelValue(rTp, false), sl = levelValue(rSl, false);
  let dotThousands = false;
  if (!coherent(direction, entry, tp, sl)) {
    const e2 = levelValue(rEntry, true), t2 = levelValue(rTp, true), s2 = levelValue(rSl, true);
    if (coherent(direction, e2, t2, s2)) {
      [entry, tp, sl] = [e2, t2, s2];
      dotThousands = true;
    }
  }
  if (!direction) direction = tp > entry && sl < entry ? "LONG" : tp < entry && sl > entry ? "SHORT" : null;
  if (!direction) return { error: tr("No pude saber si es compra o venta (usá LONG/SHORT o COMPRA/VENTA).") };

  const ok = direction === "LONG" ? tp > entry && sl < entry : tp < entry && sl > entry;
  if (!ok || ![entry, tp, sl].every((n) => Number.isFinite(n) && n > 0)) {
    return {
      error: direction === "LONG" ? tr("Los niveles no coinciden con una compra (TP arriba y SL abajo). Revisá el mensaje.") : tr("Los niveles no coinciden con una venta (TP abajo y SL arriba). Revisá el mensaje."),
    };
  }
  // Varios targets (TP1, TP2, TP3…): el más lejano es el TP final y los demás quedan como targets parciales.
  const split = splitTargets(direction, entry, [tp, ...rawTargets(text).map((r) => toNumber(r, dotThousands))]);
  if (split) tp = split.tp;
  return { value: { symbol: perp ? `${base}.P` : base, direction, entry, tp, sl, ...(split?.targets ? { targets: split.targets } : {}), date: new Date().toISOString() } };
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
  if (!body) return { valid, errors: [tr("Pegá al menos una línea de alerta.")] };

  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (!item || typeof item !== "object") {
          errors.push(tr("JSON inválido: cada alerta debe ser un objeto."));
          continue;
        }
        const r = tradeFromFields(item as Record<string, unknown>, short(JSON.stringify(item)));
        if (r.value) valid.push(r.value);
        else errors.push(r.error!);
      }
    } catch {
      errors.push(tr("El JSON no es válido (revisá comillas y comas)."));
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
      errors.push(tr("«{line}» — se esperan 6 campos separados por |", { line: short(line) }));
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
  return `VELTRIX|{{ticker}}|${o.direction === "LONG" ? tr("COMPRA") : tr("VENTA")}|${entry}|${tp}|${sl}`;
}


// ─── Análisis ───────────────────────────────────────────────────────────────

export interface GroupRow {
  key: string;
  label: string;
  ops: number;
  winRate: number;
  netR: number;
}

export interface Streaks {
  maxWin: number;
  maxLoss: number;
  current: { type: "win" | "loss" | null; count: number };
}

export interface Analysis {
  closed: number;
  bySymbol: GroupRow[];
  byWeekday: GroupRow[];
  byHour: GroupRow[];
  byDirection: GroupRow[];
  streaks: Streaks;
  insights: string[];
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]; // claves; se traducen al mostrarlas
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOUR_BLOCKS = ["00–03 h", "03–06 h", "06–09 h", "09–12 h", "12–15 h", "15–18 h", "18–21 h", "21–24 h"];
const MIN_SAMPLE = 3;

function groupRows(items: Array<{ key: string; label: string; r: number }>): GroupRow[] {
  const map = new Map<string, { label: string; rs: number[] }>();
  for (const it of items) {
    const row = map.get(it.key) ?? { label: it.label, rs: [] };
    row.rs.push(it.r);
    map.set(it.key, row);
  }
  return [...map.entries()].map(([key, { label, rs }]) => ({
    key,
    label,
    ops: rs.length,
    winRate: (rs.filter((r) => r > 0).length / rs.length) * 100,
    netR: rs.reduce((a, b) => a + b, 0),
  }));
}

/** Rendimiento de las operaciones cerradas por activo, día de la semana, franja horaria y dirección, más rachas. */
export function analyze(trades: Trade[]): Analysis {
  const closed = trades
    .filter((t) => t.outcome !== "ABIERTA")
    .map((t) => ({ t, r: resultR(t) ?? 0, d: new Date(t.date) }))
    .filter((x) => !Number.isNaN(x.d.getTime()));

  const bySymbol = groupRows(closed.map(({ t, r }) => ({ key: t.symbol, label: t.symbol, r }))).sort((a, b) => b.netR - a.netR);

  const byWeekdayMap = groupRows(closed.map(({ d, r }) => ({ key: String(d.getDay()), label: tr(WEEKDAYS[d.getDay()]), r })));
  const byWeekday = WEEK_ORDER.map((n) => byWeekdayMap.find((x) => x.key === String(n)) ?? { key: String(n), label: tr(WEEKDAYS[n]), ops: 0, winRate: 0, netR: 0 });

  const byHourMap = groupRows(closed.map(({ d, r }) => ({ key: String(Math.floor(d.getHours() / 3)), label: HOUR_BLOCKS[Math.floor(d.getHours() / 3)], r })));
  const byHour = HOUR_BLOCKS.map((label, i) => byHourMap.find((x) => x.key === String(i)) ?? { key: String(i), label, ops: 0, winRate: 0, netR: 0 });

  const byDirection = groupRows(closed.map(({ t, r }) => ({ key: t.direction, label: t.direction === "LONG" ? tr("Compras") : tr("Ventas"), r })));

  // Rachas (orden cronológico de cierre); las operaciones en 0R no cortan la racha.
  const ordered = [...closed].sort((a, b) => new Date(a.t.closedAt ?? a.t.date).getTime() - new Date(b.t.closedAt ?? b.t.date).getTime());
  let maxWin = 0, maxLoss = 0, cur: "win" | "loss" | null = null, count = 0;
  for (const { r } of ordered) {
    if (r === 0) continue;
    const type = r > 0 ? "win" : "loss";
    count = type === cur ? count + 1 : 1;
    cur = type;
    if (type === "win") maxWin = Math.max(maxWin, count);
    else maxLoss = Math.max(maxLoss, count);
  }

  const insights: string[] = [];
  const best = (rows: GroupRow[]) => rows.filter((x) => x.ops >= MIN_SAMPLE).sort((a, b) => b.netR - a.netR);
  const low = (x: string) => (getLang() === "es" ? x.toLowerCase() : x);
  const fmt = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1).replace(/\.0$/, "") + "R";
  const sym = best(bySymbol);
  if (sym.length) {
    insights.push(tr("Tu mejor activo es {sym} ({r} en {n} operaciones).", { sym: sym[0].label, r: fmt(sym[0].netR), n: sym[0].ops }));
    const worst = sym[sym.length - 1];
    if (sym.length > 1 && worst.netR < 0) insights.push(tr("Tu activo más costoso es {sym} ({r}). Pensá si conviene seguir operándolo.", { sym: worst.label, r: fmt(worst.netR) }));
  }
  const day = best(byWeekday);
  if (day.length > 1) {
    if (day[0].netR > 0) insights.push(tr("Tu mejor día es el {day} ({r}).", { day: low(day[0].label), r: fmt(day[0].netR) }));
    const w = day[day.length - 1];
    if (w.netR < 0) insights.push(tr("Tu peor día es el {day} ({r}).", { day: low(w.label), r: fmt(w.netR) }));
  }
  const hour = best(byHour);
  if (hour.length > 1) {
    if (hour[0].netR > 0) insights.push(tr("Operás mejor entre {h} ({r}).", { h: hour[0].label, r: fmt(hour[0].netR) }));
    const w = hour[hour.length - 1];
    if (w.netR < 0) insights.push(tr("Evitá operar entre {h}: ahí perdés {r}.", { h: w.label, r: fmt(w.netR) }));
  }
  const dir = byDirection.filter((x) => x.ops >= MIN_SAMPLE);
  if (dir.length === 2 && Math.abs(dir[0].netR - dir[1].netR) >= 1) {
    const [a, b] = dir.sort((x, y) => y.netR - x.netR);
    insights.push(tr("Te va mejor en {a} ({ra}) que en {b} ({rb}).", { a: a.label.toLowerCase(), ra: fmt(a.netR), b: b.label.toLowerCase(), rb: fmt(b.netR) }));
  }

  return { closed: closed.length, bySymbol, byWeekday, byHour, byDirection, streaks: { maxWin, maxLoss, current: { type: cur, count } }, insights };
}

// ─── Límites diarios ────────────────────────────────────────────────────────

export interface DailyLimits {
  maxLossR: number | null; // pérdida máxima del día, en R (positivo)
  maxTrades: number | null; // cantidad máxima de operaciones abiertas en el día
}

export interface DailyStatus {
  lossR: number; // resultado del día en R (negativo = pérdida)
  trades: number;
  lossState: "off" | "ok" | "near" | "reached";
  tradesState: "off" | "ok" | "near" | "reached";
  messages: string[];
  level: "ok" | "warning" | "stop";
}

const sameDay = (iso: string | undefined, start: number) => !!iso && new Date(iso).getTime() >= start;

export function dailyStatus(trades: Trade[], limits: DailyLimits, now = new Date()): DailyStatus {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const s = start.getTime();
  const lossR = trades.filter((t) => t.outcome !== "ABIERTA" && sameDay(t.closedAt ?? t.date, s)).reduce((a, t) => a + (resultR(t) ?? 0), 0);
  const count = trades.filter((t) => sameDay(t.date, s)).length;

  const state = (value: number, limit: number | null): "off" | "ok" | "near" | "reached" =>
    limit == null || limit <= 0 ? "off" : value >= limit ? "reached" : value >= limit * 0.8 ? "near" : "ok";
  const lossState = state(Math.max(0, -lossR), limits.maxLossR);
  const tradesState = state(count, limits.maxTrades);

  const messages: string[] = [];
  if (lossState === "reached") messages.push(tr("Alcanzaste tu pérdida máxima del día ({n}R). Hoy no operes más.", { n: limits.maxLossR ?? 0 }));
  else if (lossState === "near") messages.push(tr("Estás cerca de tu pérdida máxima del día: llevás {a}R de −{b}R.", { a: lossR.toFixed(1).replace(/\.0$/, ""), b: limits.maxLossR ?? 0 }));
  if (tradesState === "reached") messages.push(tr("Llegaste al máximo de {n} operaciones de hoy.", { n: limits.maxTrades ?? 0 }));
  else if (tradesState === "near") messages.push(tr("Llevás {a} de {b} operaciones permitidas hoy.", { a: count, b: limits.maxTrades ?? 0 }));

  const level = lossState === "reached" || tradesState === "reached" ? "stop" : lossState === "near" || tradesState === "near" ? "warning" : "ok";
  return { lossR, trades: count, lossState, tradesState, messages, level };
}


// ─── Capital y dinero ───────────────────────────────────────────────────────

export interface MoneySettings {
  capital: number | null; // capital inicial
  riskPct: number | null; // % del capital que vale 1R
  currency: string; // "USD", "EUR", "ARS"…
}

export const NO_MONEY: MoneySettings = { capital: null, riskPct: null, currency: "USD" };

/** Cuánto dinero vale 1R (riesgo fijo por operación sobre el capital inicial). */
export function rValueMoney(m: MoneySettings): number | null {
  return m.capital && m.riskPct && m.capital > 0 && m.riskPct > 0 ? (m.capital * m.riskPct) / 100 : null;
}

const SYMBOLS: Record<string, string> = { USD: "$", USDT: "$", USDC: "$", EUR: "€", GBP: "£" };

/** "+$120.00" · "−$45.50" · "+ARS 1,200.00" (con signo opcional). */
export function fmtCurrency(n: number, currency: string, signed = true): string {
  const sym = SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase() + " ";
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}${sym}${body}`;
}

export interface BalanceInfo {
  unit: number; // valor de 1R
  pnl: number; // resultado acumulado en dinero
  balance: number; // capital + resultado
  returnPct: number; // rendimiento sobre el capital inicial
}

/** Resultado en dinero de las operaciones cerradas; null si no hay capital y riesgo configurados. */
export function balanceInfo(trades: Trade[], m: MoneySettings): BalanceInfo | null {
  const unit = rValueMoney(m);
  if (unit == null || !m.capital) return null;
  const pnl = computeStats(trades).netR * unit;
  return { unit, pnl, balance: m.capital + pnl, returnPct: (pnl / m.capital) * 100 };
}

// ─── Resumen para compartir ─────────────────────────────────────────────────

export type SharePeriod = "week" | "month" | "all";

export interface ResultSummary {
  period: SharePeriod;
  label: string;
  closed: number;
  netR: number;
  winRate: number;
  pf: number | null;
  bestR: number;
  curve: number[]; // R acumulado (empieza en 0)
}

/** Resumen de resultados (solo en R, sin montos de dinero) de un período, listo para una tarjeta. */
export function summarize(trades: Trade[], period: SharePeriod, now = new Date()): ResultSummary {
  let from = 0;
  let label = tr("Todo el historial");
  if (period === "week") {
    from = now.getTime() - 7 * 86_400_000;
    label = tr("Últimos 7 días");
  } else if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    label = now.toLocaleDateString(locale(), { month: "long", year: "numeric" });
    label = label.charAt(0).toUpperCase() + label.slice(1);
  }
  const inPeriod = trades.filter((t) => t.outcome !== "ABIERTA" && new Date(t.closedAt ?? t.date).getTime() >= from);
  const st = computeStats(inPeriod);
  const curve = [0, ...equitySeries(inPeriod).map((p) => p.cum)];
  return { period, label, closed: st.cerradas, netR: st.netR, winRate: st.winRate, pf: st.pf, bestR: st.bestR, curve };
}

// ─── Etiquetas ──────────────────────────────────────────────────────────────

export const PRESET_TAGS: Array<{ group: string; tags: string[] }> = [
  { group: "Emoción", tags: ["Calma", "Confianza", "Miedo", "Codicia", "FOMO", "Venganza", "Ansiedad"] },
  { group: "Ejecución", tags: ["Seguí el plan", "Sin plan", "Entré tarde", "Moví el stop", "Cerré antes", "Sin stop", "Sobreoperé"] },
  { group: "Setup", tags: ["Señal de comunidad", "Breakout", "Reversión", "Tendencia", "Noticia"] },
];

export const MAX_TAGS = 8;

/** Limpia una lista de etiquetas: sin vacías, sin repetidas (ignora mayúsculas), largo y cantidad acotados. */
export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 24);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export interface TagRow {
  tag: string;
  ops: number;
  winRate: number;
  netR: number;
}

/** Resultado de las operaciones cerradas agrupadas por etiqueta (de peor a mejor R neto). */
export function tagStats(trades: Trade[]): TagRow[] {
  const map = new Map<string, { tag: string; rs: number[] }>();
  for (const t of trades) {
    if (t.outcome === "ABIERTA" || !t.tags?.length) continue;
    const r = resultR(t) ?? 0;
    for (const tag of t.tags) {
      const key = tag.toLowerCase();
      const row = map.get(key) ?? { tag, rs: [] };
      row.rs.push(r);
      map.set(key, row);
    }
  }
  return [...map.values()]
    .map(({ tag, rs }) => ({
      tag,
      ops: rs.length,
      winRate: (rs.filter((r) => r > 0).length / rs.length) * 100,
      netR: rs.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.netR - b.netR);
}

// ─── Calculadora de riesgo ──────────────────────────────────────────────────

export interface PositionInput {
  capital: number;
  riskPct: number; // % del capital que se acepta perder si toca el SL
  entry: number;
  sl: number;
  tp?: number;
  leverage?: number;
  feePct?: number; // comisión por operación (entrada y salida), en %
}

export interface PositionResult {
  riskAmount: number; // dinero que se arriesga
  stopDistance: number;
  stopPct: number; // distancia al SL en % del precio de entrada
  units: number; // cantidad del activo
  notional: number; // valor de la posición
  margin: number | null; // margen necesario (con apalancamiento)
  fees: number; // comisiones estimadas (entrada + salida)
  profitAtTp: number | null;
  rr: number | null;
  direction: Direction;
  warnings: string[];
}

/** Tamaño de posición para arriesgar un % fijo del capital. Devuelve null si faltan datos válidos. */
export function calcPosition(i: PositionInput): PositionResult | null {
  const { capital, riskPct, entry, sl } = i;
  if (![capital, riskPct, entry, sl].every((n) => Number.isFinite(n) && n > 0)) return null;
  const stopDistance = Math.abs(entry - sl);
  if (stopDistance <= 0) return null;

  const direction: Direction = sl < entry ? "LONG" : "SHORT";
  const riskAmount = (capital * riskPct) / 100;
  const feeRate = Number.isFinite(i.feePct) && (i.feePct ?? 0) > 0 ? (i.feePct as number) / 100 : 0;
  // Se descuentan las comisiones del riesgo para que el peor caso siga siendo el % elegido.
  const units = riskAmount / (stopDistance + entry * feeRate * 2);
  const notional = units * entry;
  const leverage = Number.isFinite(i.leverage) && (i.leverage ?? 0) > 0 ? (i.leverage as number) : null;
  const margin = leverage ? notional / leverage : null;
  const fees = notional * feeRate * 2;

  const tp = i.tp != null && Number.isFinite(i.tp) && i.tp > 0 ? i.tp : null;
  const validTp = tp != null && (direction === "LONG" ? tp > entry : tp < entry);
  const profitAtTp = validTp ? units * Math.abs(tp! - entry) - fees : null;
  const rr = validTp ? Math.abs(tp! - entry) / stopDistance : null;

  const warnings: string[] = [];
  if (tp != null && !validTp) warnings.push(direction === "LONG" ? tr("El TP está del lado equivocado: en una compra debe estar arriba de la entrada.") : tr("El TP está del lado equivocado: en una venta debe estar abajo de la entrada."));
  if (riskPct > 5) warnings.push(tr("Arriesgás más del 5 % por operación: es un riesgo muy alto."));
  else if (riskPct > 2) warnings.push(tr("Lo habitual es arriesgar entre 0,5 % y 2 % por operación."));
  const needed = margin ?? notional;
  if (needed > capital) {
    warnings.push(
      margin
        ? tr("Necesitás más margen ({m}) que tu capital. Bajá el riesgo, acercá el stop o subí el apalancamiento.", { m: margin.toFixed(2) })
        : tr("La posición vale más que tu capital: solo podés hacerla con apalancamiento."),
    );
  }
  if (rr != null && rr < 1) warnings.push(tr("La relación riesgo/beneficio es menor a 1:1."));

  return { riskAmount, stopDistance, stopPct: (stopDistance / entry) * 100, units, notional, margin, fees, profitAtTp, rr, direction, warnings };
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
    d.toLocaleDateString(locale(), { day: "2-digit", month: "short" }) +
    " · " +
    d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
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
  const head = ["Fecha", "Activo", "Direccion", "Entrada", "TP", "SL", "Estado", "Salida", "R", "Notas", "Etiquetas"].map((h) => tr(h));
  const rows = trades.map((t) => [
    new Date(t.date).toLocaleString(locale()),
    t.symbol,
    t.direction,
    t.entry,
    t.tp,
    t.sl,
    t.outcome,
    t.exit ?? "",
    resultR(t)?.toFixed(2) ?? "",
    t.notes ?? "",
    (t.tags ?? []).join(" | "),
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

/** Ejemplo de alerta en el idioma activo (COMPRA/BUY). */
export const exampleAlert = () => `VELTRIX|BTCUSDT|${tr("COMPRA")}|65405.8|66694.4|65161.1`;

export const fmtQty = (n: number) =>
  n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export const fmtMoney = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


// ─── Exchanges conectados (solo lectura) ────────────────────────────────────

export type ExchangeId = "binance" | "bybit";
export const EXCHANGE_LIST: Array<{ id: ExchangeId; name: string }> = [
  { id: "binance", name: "Binance" },
  { id: "bybit", name: "Bybit" },
];
export const exchangeName = (id: string) => EXCHANGE_LIST.find((e) => e.id === id)?.name ?? id;

export interface ExchangeConnection {
  id: string;
  exchange: ExchangeId;
  keyHint: string | null; // últimos 4 caracteres de la API key
  status: "active" | "error";
  lastError: string | null;
  lastSyncAt: string | null;
  lastImportCount: number;
}

export interface TelegramCommunity {
  id: string;
  chatId: number;
  title: string | null;
  linkedAt: string;
}

export interface TelegramLink {
  chatId: number;
  username: string | null;
  linkedAt: string;
}

// ─── Mapa de liquidaciones (estimado) ───────────────────────────────────────

export const LIQ_COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "SUI"];

export interface LiquidationBucket {
  price: number; // centro del nivel de precio
  longs: number[]; // dólares estimados de liquidaciones de largos, uno por cada apalancamiento de `leverages`
  shorts: number[]; // idem cortos
}

export interface LiquidationHotspot {
  side: "long" | "short";
  price: number;
  usd: number;
  pct: number; // distancia al precio actual, en %
}

export interface LiquidationMap {
  coin: string;
  symbol: string;
  source: "binance" | "bybit";
  price: number;
  step: number;
  hours: number;
  leverages: number[];
  buckets: LiquidationBucket[]; // de menor a mayor precio
  hotspots: LiquidationHotspot[];
  openInterestUsd: number | null;
  computedAt: number;
}

export interface LiquidationColumn {
  from: number;
  to: number;
  price: number; // centro de la columna
  longs: number[];
  shorts: number[];
  longTotal: number;
  shortTotal: number;
}

const sumArr = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Agrupa los niveles finos del mapa en `cols` columnas dentro de [lo, hi] (para dibujar y para el zoom). */
export function rebinLiquidations(map: LiquidationMap, lo: number, hi: number, cols = 64): LiquidationColumn[] {
  const width = (hi - lo) / cols;
  const out: LiquidationColumn[] = Array.from({ length: cols }, (_, i) => ({
    from: lo + i * width,
    to: lo + (i + 1) * width,
    price: lo + (i + 0.5) * width,
    longs: map.leverages.map(() => 0),
    shorts: map.leverages.map(() => 0),
    longTotal: 0,
    shortTotal: 0,
  }));
  for (const b of map.buckets) {
    if (b.price < lo || b.price >= hi) continue;
    const c = out[Math.min(cols - 1, Math.floor((b.price - lo) / width))];
    b.longs.forEach((v, k) => (c.longs[k] += v));
    b.shorts.forEach((v, k) => (c.shorts[k] += v));
  }
  for (const c of out) {
    c.longTotal = sumArr(c.longs);
    c.shortTotal = sumArr(c.shorts);
  }
  return out;
}

/**
 * Liquidaciones acumuladas desde el precio actual hacia afuera: a cada precio, cuánto se liquidaría
 * (largos si el precio baja hasta ahí, cortos si sube hasta ahí).
 */
export function cumulativeLiquidations(map: LiquidationMap): { longs: Array<{ price: number; usd: number }>; shorts: Array<{ price: number; usd: number }> } {
  const longs: Array<{ price: number; usd: number }> = [];
  let acc = 0;
  for (let i = map.buckets.length - 1; i >= 0; i--) {
    const b = map.buckets[i];
    if (b.price > map.price) continue;
    acc += sumArr(b.longs);
    longs.push({ price: b.price, usd: acc });
  }
  longs.reverse(); // de menor a mayor precio
  const shorts: Array<{ price: number; usd: number }> = [];
  acc = 0;
  for (const b of map.buckets) {
    if (b.price < map.price) continue;
    acc += sumArr(b.shorts);
    shorts.push({ price: b.price, usd: acc });
  }
  return { longs, shorts };
}

/** $1.2B · $15.3M · $820K */
export const fmtUsdShort = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

/** Colores de cada apalancamiento (de menor a mayor). */
export const LEVERAGE_COLORS = ["#3b82f6", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444"];

// ─── Coach con IA ───────────────────────────────────────────────────────────

export type CoachResult =
  | { ok: true; text: string; closed: number; cached: boolean; createdAt: string }
  | { ok: false; reason: "not_enough_data"; needed: number; have: number }
  | { ok: false; reason: "limit"; createdAt: string | null; text: string | null }
  | { ok: false; reason: "refused" | "unavailable" | "no_key" }
  | { ok: false; error: string; reason?: undefined };

/** Mensaje para mostrar cuando el coach no pudo dar un informe. */
export function coachProblem(r: Exclude<CoachResult, { ok: true }>): string {
  if ("error" in r && r.error) return r.error;
  switch (r.reason) {
    case "not_enough_data":
      return tr("Para encontrar patrones necesito al menos {n} operaciones cerradas (tenés {have}). Seguí registrando y volvé.", { n: r.needed, have: r.have });
    case "limit":
      return tr("Ya hiciste varios análisis hoy. Mañana podés pedir uno nuevo.");
    case "no_key":
      return tr("El coach todavía no está activado en el servidor.");
    case "refused":
      return tr("No pude armar un análisis con estos datos. Probá de nuevo más tarde.");
    default:
      return tr("No se pudo generar el análisis ahora. Probá de nuevo en unos minutos.");
  }
}

// ─── Compartir una señal (WhatsApp, etc.) ───────────────────────────────────

// ─── Pantalla de bienvenida (login): qué es VELTRIX ─────────────────────────

export interface WelcomeFeature {
  icon: string;
  title: string;
  text: string;
}

/** Lo que se muestra antes del formulario de ingreso, igual en la web y en la app. Solo promete lo que la app ya hace. */
export function welcomeContent(): { headline: string; lead: string; chips: string[]; features: WelcomeFeature[] } {
  return {
    headline: tr("Tu centro de trading en vivo"),
    lead: tr("Recibí las señales de TradingView en tu celular, seguí cada operación al instante y mejorá con datos reales."),
    chips: [`📡 ${tr("Señales")}`, `🎯 ${tr("Targets")}`, `📒 ${tr("Diario")}`, `🛡️ ${tr("Riesgo")}`, `🗺️ ${tr("Mapa")}`],
    features: [
      { icon: "📡", title: tr("Señales en vivo"), text: tr("Conectá tus alertas de TradingView: cada señal llega sola a tu celular y a Telegram, con una tarjeta lista para compartir.") },
      { icon: "🎯", title: tr("Targets y cierre automático"), text: tr("TP1, TP2, TP3: te avisamos cada vez que el precio toca un target, y cerramos solas tus operaciones cripto en el TP o el SL.") },
      { icon: "📒", title: tr("Diario con estadísticas"), text: tr("Todo queda registrado: R, acierto, profit factor y tu racha diaria. También podés importar desde Binance y Bybit.") },
      { icon: "🛡️", title: tr("Control de riesgo"), text: tr("Calculá cuánto arriesgar en cada operación y poné límites diarios para cuidar tu capital.") },
      { icon: "🗺️", title: tr("Mapa de liquidaciones"), text: tr("Mirá dónde se concentran las liquidaciones del mercado para leer mejor el precio.") },
      { icon: "👥", title: tr("Tu comunidad"), text: tr("Publicá tus señales y resultados en tu grupo o canal de Telegram, sin copiar y pegar.") },
    ],
  };
}

// ─── Demo animada de la bienvenida ──────────────────────────────────────────
// Una señal de ejemplo que avanza sola: aparece la tarjeta, el precio sube, salta cada target y termina en TP.
// Todo sale de demoFrame(t) (t en milisegundos): la web y la app solo dibujan lo que devuelve, así se ve igual en las dos.

export const DEMO_LOOP_MS = 12_000;
const DEMO = { entry: 65000, sl: 64500, targets: [65500, 66000, 67000] };
// [tiempo ms, precio]: sube, se frena un momento en cada target y sigue.
const DEMO_PATH: Array<[number, number]> = [[1500, 65000], [3200, 65500], [4000, 65500], [5400, 66000], [6200, 66000], [8000, 67000], [11000, 67000]];

export interface DemoFrame {
  levels: Array<{ key: string; label: string; value: number; pct: number | null; kind: "target" | "entry" | "stop"; shown: boolean; reached: boolean }>;
  price: number;
  pct: number; // % desde la entrada
  track: number; // posición del precio entre las filas (0 = fila de arriba)
  toast: { n: number; title: string; text: string } | null; // aviso de target alcanzado
  win: { title: string; r: string; burst: number } | null; // TP alcanzado; burst = 0..1 progreso de los destellos
  fade: number; // 0..1 desaparece al final del ciclo
}

export function demoFrame(ms: number): DemoFrame {
  const t = ((ms % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS;
  let price = DEMO.entry;
  for (let i = 1; i < DEMO_PATH.length; i++) {
    const [t0, p0] = DEMO_PATH[i - 1];
    const [t1, p1] = DEMO_PATH[i];
    if (t >= t1) price = p1;
    else if (t > t0) {
      const k = (t - t0) / (t1 - t0);
      price = p0 + (p1 - p0) * (k * k * (3 - 2 * k)); // arranque y frenado suaves
      break;
    }
  }
  if (t < DEMO_PATH[0][0]) price = DEMO.entry;
  const rows = [
    ...[...DEMO.targets].reverse().map((v, i) => ({ v, n: 3 - i, kind: "target" as const })), // arriba: el target más lejano
    { v: DEMO.entry, n: 0, kind: "entry" as const },
    { v: DEMO.sl, n: 0, kind: "stop" as const },
  ];
  const levels = rows.map((r, i) => ({
    key: r.kind === "target" ? `t${r.n}` : r.kind,
    label: r.kind === "target" ? `TARGET ${r.n}` : r.kind === "entry" ? tr("ENTRADA") : tr("STOP LOSS"),
    value: r.v,
    pct: r.kind === "entry" ? null : ((r.v - DEMO.entry) / DEMO.entry) * 100,
    kind: r.kind,
    shown: t > 180 + i * 200,
    reached: r.kind === "target" && price >= r.v - 0.5,
  }));
  // Posición del punto de precio entre las filas (0 = arriba): entre dos niveles se interpola.
  const prices = rows.map((r) => r.v);
  let track = rows.length - 1;
  for (let i = 0; i < prices.length - 1; i++) {
    if (price <= prices[i] && price >= prices[i + 1]) {
      track = i + (prices[i] - price) / (prices[i] - prices[i + 1]);
      break;
    }
  }
  const adviceFor = (n: number) => (n === 1 ? tr("Cerrar 50% y mover el SL a break-even") : tr("Asegurar ganancias: mover el SL al Target {n}", { n: n - 1 }));
  let toast: DemoFrame["toast"] = null;
  for (const [n, from, to] of [[1, 3200, 5200], [2, 5400, 7400]] as const) {
    if (t >= from && t < to) toast = { n, title: tr("TARGET {n} ALCANZADO", { n }), text: `${tr("Profit")} +${(((DEMO.targets[n - 1] - DEMO.entry) / DEMO.entry) * 100).toFixed(2)}% · ${adviceFor(n)}` };
  }
  const win = t >= 8000 && t < 11500 ? { title: tr("TP ALCANZADO"), r: `+${((DEMO.targets[2] - DEMO.entry) / (DEMO.entry - DEMO.sl)).toFixed(1)}R`, burst: Math.min(1, (t - 8000) / 1400) } : null;
  return { levels, price, pct: ((price - DEMO.entry) / DEMO.entry) * 100, track, toast: win ? null : toast, win, fade: t > 11500 ? (t - 11500) / 500 : 0 };
}

/** Textos fijos de la demo (par, dirección, etiquetas). */
export const demoTexts = () => ({
  live: tr("EN VIVO"),
  newSignal: tr("NUEVA SEÑAL"),
  pair: "BTC/USDT",
  side: tr("COMPRA · LONG"),
  following: tr("📡 Siguiendo el precio en tiempo real…"),
});

/** Texto listo para mandar a un contacto o grupo. No incluye dinero ni datos de la cuenta. */
export function signalShareMessage(t: Trade): string {
  const risk = Math.abs(t.entry - t.sl);
  const rr = risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
  const side = t.direction === "LONG" ? tr("COMPRA") : tr("VENTA");
  return [
    `📢 ${tr("Nueva señal")}`,
    `${t.direction === "LONG" ? "▲" : "▼"} ${t.symbol} ${side}`,
    `${tr("Entrada")} ${t.entry} · TP ${t.tp} · SL ${t.sl} · R:R 1:${rr.toFixed(1)}`,
    `⚠️ ${tr("Información para registro personal: no es asesoramiento financiero.")}`,
    "VELTRIX",
  ].join("\n");
}

/** Enlace que abre WhatsApp con el texto ya escrito, para elegir el contacto o grupo. */
export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

// ─── Panel «Tu día» y avance hacia TP/SL ────────────────────────────────────

export interface TodayOverview {
  r: number; // R neto de lo cerrado hoy
  closed: number;
  wins: number;
  losses: number;
  open: number; // señales abiertas (de cualquier día)
  activeStreak: number; // días seguidos con actividad
  greenStreak: number; // días seguidos cerrando en verde
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Resumen del día en la zona horaria del navegador, con las mismas rachas que el resumen diario por Telegram. */
export function todayOverview(trades: Trade[], now = new Date()): TodayOverview {
  const opened = new Set<string>();
  const closedN = new Map<string, number>();
  const closedR = new Map<string, number>();
  let open = 0;
  const today = dayKey(now);
  const out: TodayOverview = { r: 0, closed: 0, wins: 0, losses: 0, open: 0, activeStreak: 0, greenStreak: 0 };
  for (const t of trades) {
    opened.add(dayKey(new Date(t.date)));
    if (t.outcome === "ABIERTA") {
      open++;
      continue;
    }
    const day = dayKey(new Date(t.closedAt ?? t.date));
    const r = resultR(t) ?? 0;
    closedN.set(day, (closedN.get(day) ?? 0) + 1);
    closedR.set(day, (closedR.get(day) ?? 0) + r);
    if (day === today) {
      out.r += r;
      out.closed++;
      if (r > 0) out.wins++;
      else if (r < 0) out.losses++;
    }
  }
  out.open = open;
  const back = (i: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    return dayKey(d);
  };
  for (let i = 0; i < 60; i++) {
    const d = back(i);
    if (!opened.has(d) && !closedN.has(d)) break;
    out.activeStreak++;
  }
  for (let i = 0; i < 60; i++) {
    const d = back(i);
    if (!((closedN.get(d) ?? 0) > 0 && (closedR.get(d) ?? 0) > 0)) break;
    out.greenStreak++;
  }
  return out;
}

/**
 * Qué tan cerca está el precio del TP: 0 = en el SL, 1 = en el TP (sirve igual para LONG y SHORT).
 * `entry` es la posición de la entrada en esa misma escala. `r` es el resultado en R si se cerrara ahora.
 */
export function levelProgress(t: Pick<Trade, "direction" | "entry" | "tp" | "sl">, price: number) {
  const span = t.tp - t.sl;
  if (!span || !isFinite(price)) return null;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const risk = Math.abs(t.entry - t.sl);
  const dir = t.direction === "LONG" ? 1 : -1;
  return {
    pos: clamp((price - t.sl) / span),
    entry: clamp((t.entry - t.sl) / span),
    r: risk > 0 ? (dir * (price - t.entry)) / risk : 0,
  };
}

const NOT_CRYPTO = new Set(["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "XAU", "XAG", "SPX", "NAS", "US", "DXY"]);

/** "BTCUSDT", "BINANCE:SOLUSDT.P", "ETH/USDT" → símbolo de Binance y si es de futuros; null si no es cripto. */
export function binanceSymbol(raw: string): { symbol: string; perp: boolean } | null {
  let s = raw.toUpperCase().trim();
  if (s.includes(":")) s = s.split(":").pop()!;
  const perp = /\.P$|PERP$/.test(s);
  s = s.replace(/\.P$|PERP$/, "").replace(/[-_/]/g, "");
  const m = s.match(/^([A-Z0-9]{2,15}?)(USDT|USDC|BUSD|USD)$/);
  if (!m || NOT_CRYPTO.has(m[1])) return null;
  return { symbol: `${m[1]}${m[2] === "USDC" ? "USDC" : "USDT"}`, perp };
}

// ─── Funciones que se prenden y apagan ──────────────────────────────────────

/**
 * Interruptores de funciones que necesitan algo del servidor.
 * `coach`: el coach con IA necesita la clave de Anthropic y la función `coach` desplegada en Supabase.
 * Mientras esté en false, la tarjeta no se muestra en la web ni en la app. Para prenderlo, cambiar a true.
 */
export const FEATURES = { coach: false } as const;

// ─── Señales por WhatsApp (API oficial) ─────────────────────────────────────

/** Estado de WhatsApp de la cuenta: `configured` es false mientras el servidor no tenga la conexión con Meta. */
export interface WhatsAppState {
  configured: boolean;
  /** El número viene enmascarado (+54 ••••••• 0000). */
  link: { phone: string; enabled: boolean } | null;
}

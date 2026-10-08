// VELTRIX · /precio: precio y variación de 24 h de una o varias monedas, para que cualquiera de la comunidad lo pida en el grupo.
import { fmtChartPrice, normalizeSymbol } from "./chartImage.ts";

export interface Quote {
  symbol: string;
  price: number;
  change: number | null;
}

export const DEFAULT_QUOTE_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

/** «/precio btc eth» → [BTCUSDT, ETHUSDT]. Sin monedas, las principales. Máximo 8, sin repetir. */
export function parseQuoteArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    const s = normalizeSymbol(a.replace(/,/g, ""));
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 8) break;
  }
  return out.length ? out : DEFAULT_QUOTE_COINS;
}

export function quoteLine(q: Quote): string {
  const base = q.symbol.replace(/USDT$/, "");
  const ch = q.change == null ? "" : ` ${q.change >= 0 ? "🟢▲" : "🔴▼"} ${Math.abs(q.change).toFixed(2)}%`;
  return `<b>${base}</b>  <code>${fmtChartPrice(q.price)}</code>${ch}`;
}

export function quoteMessage(quotes: Quote[], lang: "es" | "en"): string {
  const head = lang === "es" ? "💹 <b>Precios ahora</b> · variación 24 h" : "💹 <b>Prices now</b> · 24 h change";
  return `${head}\n\n${quotes.map(quoteLine).join("\n")}`;
}

async function one(symbol: string): Promise<Quote | null> {
  for (const url of [`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const j = await res.json();
      const price = Number(j.lastPrice);
      const change = Number(j.priceChangePercent);
      if (price > 0) return { symbol, price, change: Number.isFinite(change) ? change : null };
    } catch {
      /* se prueba la otra fuente */
    }
  }
  return null;
}

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  return (await Promise.all(symbols.map(one))).filter((q): q is Quote => !!q);
}

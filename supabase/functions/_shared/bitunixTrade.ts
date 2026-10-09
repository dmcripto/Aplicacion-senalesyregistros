// ─── VELTRIX · Órdenes reales en Bitunix (prueba mínima) ────────────────────
// Esto SÍ opera con dinero: se usa solo desde la función «trade», con la clave con permiso de operar de la persona,
// con topes duros (ver la migración 0037) y empezando siempre en «prueba en seco» (no se envía nada).
// La documentación de Bitunix no se pudo consultar al escribirlo: por eso la primera orden real es una orden mínima
// de prueba, confirmada a mano, que se cierra enseguida; recién si sale bien se habilita el modo automático.

import { bitunixSign } from "./exchanges.ts";

type FetchFn = typeof fetch;
const BX = "https://fapi.bitunix.com";

export interface BxPair {
  symbol: string;
  minQty: number; // tamaño mínimo de una orden (moneda base)
  qtyDecimals: number; // decimales permitidos del tamaño
  maxLeverage: number;
  /** Decimales del precio (para redondear stop y objetivo); null si el exchange no lo informó. */
  priceDecimals?: number | null;
  /** Si el exchange solo acepta tamaños múltiplos de un paso (por ejemplo contratos), ese paso en moneda base. */
  qtyStep?: number;
}

export interface BxCfg {
  risk_usdt: number; // lo máximo que se pierde si salta el stop
  max_margin_usdt: number; // lo máximo de margen (plata de la cuenta) que usa una operación
  max_leverage: number;
}

export interface BxSignal {
  symbol: string;
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp: number;
}

export type BxPlan = { ok: true; qty: number; leverage: number; notional: number; margin: number; risk: number } | { ok: false; reason: string };

const MOVED_MAX = 0.005; // si el precio ya se movió más de 0,5 % desde la señal, no se persigue
const floorTo = (n: number, decimals: number) => {
  const k = 10 ** decimals;
  return Math.floor(n * k + 1e-9) / k;
};

/**
 * Cuánto comprar o vender: el tamaño sale del riesgo fijo (qty = riesgo / distancia al stop), sin pasarse del margen máximo.
 * Nunca redondea hacia arriba ni sube el riesgo para llegar al mínimo del exchange: si no entra, se omite la operación.
 */
export function planOrder(sig: BxSignal, price: number, pair: BxPair, cfg: BxCfg): BxPlan {
  if (!(price > 0) || !(sig.entry > 0)) return { ok: false, reason: "Precio no válido." };
  if (![cfg.risk_usdt, cfg.max_margin_usdt, cfg.max_leverage, pair.minQty].every((v) => Number.isFinite(v) && v > 0)) return { ok: false, reason: "Faltan los topes de seguridad: no se opera." };
  const long = sig.direction === "LONG";
  if (Math.abs(price - sig.entry) / sig.entry > MOVED_MAX) return { ok: false, reason: "El precio ya se movió más de 0,5 % desde la señal: no se persigue." };
  const dist = long ? price - sig.sl : sig.sl - price;
  const toTp = long ? sig.tp - price : price - sig.tp;
  if (!(dist > 0) || !(toTp > 0)) return { ok: false, reason: "El precio ya pasó el stop o el objetivo." };
  const levCap = Math.max(1, Math.min(cfg.max_leverage, pair.maxLeverage > 0 ? pair.maxLeverage : cfg.max_leverage));
  const maxNotional = cfg.max_margin_usdt * levCap;
  const wanted = Math.min(cfg.risk_usdt / dist, maxNotional / price);
  const qty = pair.qtyStep && pair.qtyStep > 0 ? floorTo(Math.floor(wanted / pair.qtyStep + 1e-9) * pair.qtyStep, pair.qtyDecimals) : floorTo(wanted, pair.qtyDecimals);
  if (!(qty > 0) || qty < pair.minQty) return { ok: false, reason: `Con tus topes el tamaño (${wanted.toPrecision(2)}) queda por debajo del mínimo del exchange (${pair.minQty}).` };
  const notional = qty * price;
  const leverage = Math.min(levCap, Math.max(1, Math.ceil(notional / cfg.max_margin_usdt)));
  const margin = notional / leverage;
  const risk = qty * dist;
  if (margin > cfg.max_margin_usdt + 1e-9) return { ok: false, reason: "El margen necesario supera tu tope." };
  if (risk > cfg.risk_usdt * 1.001) return { ok: false, reason: "El riesgo superaría tu tope." };
  // El stop tiene que quedar bien antes de la liquidación (con margen aislado se liquida más o menos a 1/apalancamiento).
  if (dist / price > 0.6 / leverage) return { ok: false, reason: "El stop quedaría demasiado cerca de la liquidación con ese apalancamiento." };
  return { ok: true, qty, leverage, notional, margin, risk };
}

const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export interface BxReply {
  ok: boolean;
  status: number;
  code: number | null;
  msg: string;
  data: any;
}

/** Pedido firmado. GET: parámetros en la dirección. POST: cuerpo JSON compacto (entra en la firma). Nunca lanza: devuelve el resultado tal cual. */
export async function bxCall(fetchFn: FetchFn, method: "GET" | "POST", path: string, params: Record<string, string | number>, body: Record<string, unknown> | null, key: string, secret: string): Promise<BxReply> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const ts = String(Date.now());
  const bodyStr = body ? JSON.stringify(body) : "";
  const sign = await bitunixSign(nonce, ts, key, params, secret, bodyStr);
  const query = Object.keys(params).length ? "?" + Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
  try {
    const res = await fetchFn(`${BX}${path}${query}`, {
      method,
      headers: { "api-key": key, nonce, timestamp: ts, sign, "Content-Type": "application/json", language: "en-US" },
      ...(method === "POST" ? { body: bodyStr } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      /* no era JSON */
    }
    const code = j?.code === undefined ? null : Number(j.code);
    return { ok: res.status < 400 && code === 0, status: res.status, code, msg: String(j?.msg ?? j?.message ?? (j ? "" : text.slice(0, 120))), data: j?.data };
  } catch {
    return { ok: false, status: 0, code: null, msg: "No se pudo conectar con Bitunix.", data: null };
  }
}

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

/** Plata disponible en la cuenta de futuros (USDT). */
export async function bxBalance(fetchFn: FetchFn, key: string, secret: string): Promise<{ ok: boolean; available: number; msg: string; code: number | null }> {
  const r = await bxCall(fetchFn, "GET", "/api/v1/futures/account", { marginCoin: "USDT" }, null, key, secret);
  const d = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: r.ok, available: n(d?.available) + n(d?.margin), msg: r.msg, code: r.code };
}

/** Reglas del par (mínimo y decimales). Si no se pueden leer con certeza, devuelve null y no se opera. */
export async function bxPair(fetchFn: FetchFn, key: string, secret: string, symbol: string): Promise<BxPair | null> {
  const r = await bxCall(fetchFn, "GET", "/api/v1/futures/market/trading_pairs", { symbols: symbol }, null, key, secret);
  const list: any[] = Array.isArray(r.data) ? r.data : [];
  const p = list.find((x) => String(x?.symbol).toUpperCase() === symbol.toUpperCase());
  if (!r.ok || !p) return null;
  const minQty = n(p.minTradeVolume);
  const qtyDecimals = Number.isInteger(Number(p.basePrecision)) ? Number(p.basePrecision) : -1;
  if (!(minQty > 0) || qtyDecimals < 0 || qtyDecimals > 12) return null;
  const pd = Number(p.quotePrecision);
  return { symbol, minQty, qtyDecimals, maxLeverage: n(p.maxLeverage) || 20, priceDecimals: Number.isInteger(pd) && pd >= 0 && pd <= 12 ? pd : null };
}

/** Posiciones abiertas ahora en la cuenta. null = no se pudo leer. */
export async function bxPositions(fetchFn: FetchFn, key: string, secret: string): Promise<Array<{ positionId: string; symbol: string; qty: number; side: string }> | null> {
  const r = await bxCall(fetchFn, "GET", "/api/v1/futures/position/get_pending_positions", {}, null, key, secret);
  if (!r.ok) return null;
  const list: any[] = Array.isArray(r.data) ? r.data : [];
  return list.map((p) => ({ positionId: String(p.positionId), symbol: String(p.symbol), qty: n(p.qty), side: String(p.side ?? "") }));
}

/** Margen aislado y apalancamiento del par (antes de abrir). Devuelve los avisos de lo que no se pudo cambiar. */
export async function bxSetup(fetchFn: FetchFn, key: string, secret: string, symbol: string, leverage: number): Promise<string[]> {
  const warn: string[] = [];
  const m = await bxCall(fetchFn, "POST", "/api/v1/futures/account/change_margin_mode", {}, { symbol, marginCoin: "USDT", marginMode: "ISOLATION" }, key, secret);
  if (!m.ok) warn.push(`margen aislado: ${m.msg || m.code}`);
  const l = await bxCall(fetchFn, "POST", "/api/v1/futures/account/change_leverage", {}, { symbol, marginCoin: "USDT", leverage }, key, secret);
  if (!l.ok) warn.push(`apalancamiento: ${l.msg || l.code}`);
  return warn;
}

/** El cuerpo de la orden de mercado con stop y objetivo enviados junto con la orden. */
export function orderBody(sig: BxSignal, qty: number, clientId: string, priceDecimals: number | null = null): Record<string, unknown> {
  const px = (v: number) => String(priceDecimals == null ? v : Number(v.toFixed(priceDecimals)));
  return {
    symbol: sig.symbol,
    qty: String(qty),
    side: sig.direction === "LONG" ? "BUY" : "SELL",
    tradeSide: "OPEN",
    orderType: "MARKET",
    tpPrice: px(sig.tp),
    tpOrderType: "MARKET",
    slPrice: px(sig.sl),
    slOrderType: "MARKET",
    slStopType: "MARK_PRICE",
    clientId,
  };
}

export const bxPlace = (fetchFn: FetchFn, key: string, secret: string, body: Record<string, unknown>) => bxCall(fetchFn, "POST", "/api/v1/futures/trade/place_order", {}, body, key, secret);
export const bxFlashClose = (fetchFn: FetchFn, key: string, secret: string, positionId: string) => bxCall(fetchFn, "POST", "/api/v1/futures/trade/flash_close_position", {}, { positionId }, key, secret);
export const bxCancelAll = (fetchFn: FetchFn, key: string, secret: string) => bxCall(fetchFn, "POST", "/api/v1/futures/trade/cancel_all_orders", {}, {}, key, secret);

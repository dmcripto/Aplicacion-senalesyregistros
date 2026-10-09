// ─── VELTRIX · Órdenes reales en MEXC (futuros) ─────────────────────────────
// Igual que con Bitunix: esto SÍ opera con dinero, solo se usa desde la función «trade», con la clave con permiso
// de operar de la persona, con los topes de la tabla bot_live y empezando siempre en «prueba en seco».
// La documentación de MEXC no se pudo consultar al escribirlo: por eso la primera orden real es una orden mínima de
// prueba, confirmada a mano, que se cierra enseguida; recién si sale bien se habilita el modo automático.
//
// MEXC mide el tamaño en CONTRATOS (cada contrato vale una fracción de la moneda): acá todo se calcula en moneda base
// como en los otros exchanges y se convierte a contratos al armar la orden.

import { mexcSign } from "./exchanges.ts";
import type { BxPair, BxSignal } from "./bitunixTrade.ts";

type FetchFn = typeof fetch;
const MX_BASES = ["https://contract.mexc.com", "https://api.mexc.com"];

export interface MxReply {
  ok: boolean;
  status: number;
  code: number | null;
  msg: string;
  data: any;
}

export interface MxPosition {
  positionId: string;
  symbol: string; // BTCUSDT
  contractSymbol: string; // BTC_USDT
  qty: number; // moneda base
  vol: number; // contratos
  side: "LONG" | "SHORT";
}

/** BTCUSDT → BTC_USDT. */
export const mexcSymbol = (symbol: string) => (symbol.includes("_") ? symbol : symbol.replace(/(USDT|USDC)$/, "_$1"));
export const fromMexcSymbol = (symbol: string) => symbol.replace(/_/g, "");

const mxNum = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};
const mxDecimals = (x: number) => {
  if (!(x > 0)) return 0;
  const s = x.toFixed(12).replace(/0+$/, "");
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
};

/** Pedido firmado. GET: parámetros ordenados en la dirección. POST: cuerpo JSON compacto (entra en la firma). Nunca lanza. */
export async function mexcCall(fetchFn: FetchFn, method: "GET" | "POST", path: string, params: Record<string, string | number>, body: Record<string, unknown> | null, key: string, secret: string): Promise<MxReply> {
  const sorted = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  const bodyStr = body ? JSON.stringify(body) : "";
  const paramString = method === "POST" ? bodyStr : query;
  let last: MxReply = { ok: false, status: 0, code: null, msg: "No se pudo conectar con MEXC.", data: null };
  for (const base of MX_BASES) {
    const ts = String(Date.now());
    const sign = await mexcSign(key, ts, paramString, secret);
    try {
      const res = await fetchFn(`${base}${path}${method === "GET" && query ? `?${query}` : ""}`, {
        method,
        headers: { ApiKey: key, "Request-Time": ts, Signature: sign, "Content-Type": "application/json" },
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
      last = { ok: res.status < 400 && j?.success !== false && (code === null || code === 0) && j !== null, status: res.status, code, msg: String(j?.message ?? j?.msg ?? (j ? "" : text.slice(0, 120))), data: j?.data };
      // Solo se prueba la otra dirección si esta ni siquiera conoce la ruta (404): nunca después de un pedido que pudo llegar.
      if (res.status !== 404) return last;
    } catch {
      last = { ok: false, status: 0, code: null, msg: "No se pudo conectar con MEXC.", data: null };
      if (method === "POST") return last; // un envío que pudo salir no se repite
    }
  }
  return last;
}

/** Plata disponible en la cuenta de futuros (USDT). */
export async function mxBalance(fetchFn: FetchFn, key: string, secret: string): Promise<{ ok: boolean; available: number; msg: string; code: number | null }> {
  const r = await mexcCall(fetchFn, "GET", "/api/v1/private/account/asset/USDT", {}, null, key, secret);
  const d = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: r.ok && d != null, available: mxNum(d?.availableBalance), msg: r.msg, code: r.code };
}

/** Reglas del par a partir del detalle del contrato (pura, para probarla). null = no se entiende: no se opera. */
export function mexcPairFromDetail(d: any, symbol: string): (BxPair & { contractSize: number }) | null {
  const contractSize = mxNum(d?.contractSize);
  const minVol = mxNum(d?.minVol) || 1;
  const volUnit = mxNum(d?.volUnit) || 1;
  if (!(contractSize > 0)) return null;
  const qtyStep = volUnit * contractSize;
  const minQty = minVol * contractSize;
  const qtyDecimals = mxDecimals(qtyStep);
  if (qtyDecimals > 12) return null;
  const ps = mxNum(d?.priceScale);
  const priceDecimals = Number.isInteger(ps) && ps > 0 && ps <= 12 ? ps : d?.priceUnit ? mxDecimals(mxNum(d.priceUnit)) : null;
  return { symbol, minQty, qtyDecimals, qtyStep, maxLeverage: mxNum(d?.maxLeverage) || 20, priceDecimals, contractSize };
}

export async function mxPair(fetchFn: FetchFn, key: string, secret: string, symbol: string): Promise<(BxPair & { contractSize: number }) | null> {
  const r = await mexcCall(fetchFn, "GET", "/api/v1/contract/detail", { symbol: mexcSymbol(symbol) }, null, key, secret);
  const d = Array.isArray(r.data) ? r.data.find((x: any) => String(x?.symbol).toUpperCase() === mexcSymbol(symbol).toUpperCase()) : r.data;
  if (!r.ok || !d) return null;
  return mexcPairFromDetail(d, symbol);
}

/** Posiciones abiertas ahora. null = no se pudo leer. */
export async function mxPositions(fetchFn: FetchFn, key: string, secret: string): Promise<MxPosition[] | null> {
  const r = await mexcCall(fetchFn, "GET", "/api/v1/private/position/open_positions", {}, null, key, secret);
  if (!r.ok) return null;
  const list: any[] = Array.isArray(r.data) ? r.data : [];
  const sizes: Record<string, number> = {};
  const out: MxPosition[] = [];
  for (const p of list) {
    const cs = String(p.symbol);
    if (!(cs in sizes)) {
      const det = await mexcCall(fetchFn, "GET", "/api/v1/contract/detail", { symbol: cs }, null, key, secret);
      const d = Array.isArray(det.data) ? det.data[0] : det.data;
      sizes[cs] = det.ok ? mxNum(d?.contractSize) : 0;
    }
    const vol = mxNum(p.holdVol);
    if (!(vol > 0)) continue;
    out.push({ positionId: String(p.positionId), symbol: fromMexcSymbol(cs), contractSymbol: cs, qty: Number((vol * sizes[cs]).toFixed(12)), vol, side: Number(p.positionType) === 2 ? "SHORT" : "LONG" });
  }
  return out;
}

/** La orden de mercado con stop y objetivo enviados junto con la orden. El tamaño se pasa a contratos. */
export function mexcOrderBody(sig: BxSignal, qty: number, clientId: string, pair: { contractSize: number; priceDecimals?: number | null }, leverage: number): Record<string, unknown> {
  const px = (v: number) => (pair.priceDecimals == null ? v : Number(v.toFixed(pair.priceDecimals)));
  const vol = Math.round(qty / pair.contractSize);
  return {
    symbol: mexcSymbol(sig.symbol),
    vol,
    leverage,
    side: sig.direction === "LONG" ? 1 : 3, // 1 = abrir compra, 3 = abrir venta
    type: 5, // a mercado
    openType: 1, // margen aislado
    externalOid: clientId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32),
    stopLossPrice: px(sig.sl),
    takeProfitPrice: px(sig.tp),
  };
}

export const mxPlace = (fetchFn: FetchFn, key: string, secret: string, body: Record<string, unknown>) => mexcCall(fetchFn, "POST", "/api/v1/private/order/create", {}, body, key, secret);

/** Cierra una posición a mercado con una orden en sentido contrario. */
export const mxClose = (fetchFn: FetchFn, key: string, secret: string, p: MxPosition) =>
  mexcCall(fetchFn, "POST", "/api/v1/private/order/create", {}, { symbol: p.contractSymbol, vol: p.vol, side: p.side === "LONG" ? 4 : 2, type: 5, openType: 1, positionId: Number(p.positionId) || p.positionId, externalOid: `vxclose${Date.now()}` }, key, secret);

/** Cancela las órdenes pendientes y los stops. */
export async function mxCancelAll(fetchFn: FetchFn, key: string, secret: string): Promise<MxReply> {
  const a = await mexcCall(fetchFn, "POST", "/api/v1/private/order/cancel_all", {}, {}, key, secret);
  const b = await mexcCall(fetchFn, "POST", "/api/v1/private/stoporder/cancel_all", {}, {}, key, secret);
  return a.ok && b.ok ? a : { ...(a.ok ? b : a), ok: false };
}

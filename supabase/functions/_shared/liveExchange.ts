// ─── VELTRIX · Bot real: un mismo molde para cada exchange ──────────────────
// La función «trade» (topes, prueba en seco, orden de prueba, botón de pánico) no sabe de qué exchange se trata:
// habla con este molde. Para sumar otro exchange se escribe su módulo (como bitunixTrade.ts o mexcTrade.ts) y se agrega acá.

import { bxBalance, bxCancelAll, bxFlashClose, bxPair, bxPlace, bxPositions, bxSetup, orderBody } from "./bitunixTrade.ts";
import type { BxPair, BxSignal } from "./bitunixTrade.ts";
import { mexcOrderBody, mxBalance, mxCancelAll, mxClose, mxPair, mxPlace, mxPositions } from "./mexcTrade.ts";
import type { MxPosition } from "./mexcTrade.ts";

type FetchFn = typeof fetch;

export type LiveExchangeId = "bitunix" | "mexc";
export const LIVE_EXCHANGES: LiveExchangeId[] = ["bitunix", "mexc"];
export const LIVE_NAMES: Record<LiveExchangeId, string> = { bitunix: "Bitunix", mexc: "MEXC" };
export const isLiveExchange = (x: unknown): x is LiveExchangeId => typeof x === "string" && (LIVE_EXCHANGES as string[]).includes(x);

export interface LivePos {
  symbol: string;
  qty: number;
  /** El resto de los datos que el exchange necesita para cerrarla. */
  raw: unknown;
  positionId: string;
}
export interface LiveReply {
  ok: boolean;
  msg: string;
  code: number | null;
  data?: unknown;
}

export interface LiveEx {
  id: LiveExchangeId;
  name: string;
  /** Pedido de claves que se muestra en la pantalla. */
  balance(f: FetchFn, key: string, secret: string): Promise<{ ok: boolean; available: number; msg: string; code: number | null }>;
  pair(f: FetchFn, key: string, secret: string, symbol: string): Promise<(BxPair & Record<string, unknown>) | null>;
  positions(f: FetchFn, key: string, secret: string): Promise<LivePos[] | null>;
  /** Margen aislado y apalancamiento. Devuelve avisos de lo que no se pudo cambiar. */
  setup(f: FetchFn, key: string, secret: string, symbol: string, leverage: number): Promise<string[]>;
  order(sig: BxSignal, qty: number, clientId: string, pair: BxPair & Record<string, unknown>, leverage: number): Record<string, unknown>;
  place(f: FetchFn, key: string, secret: string, body: Record<string, unknown>): Promise<LiveReply>;
  close(f: FetchFn, key: string, secret: string, pos: LivePos): Promise<LiveReply>;
  cancelAll(f: FetchFn, key: string, secret: string): Promise<LiveReply>;
}

const bitunix: LiveEx = {
  id: "bitunix",
  name: "Bitunix",
  balance: bxBalance,
  pair: bxPair as LiveEx["pair"],
  positions: async (f, k, s) => (await bxPositions(f, k, s))?.map((p) => ({ symbol: p.symbol, qty: p.qty, positionId: p.positionId, raw: p })) ?? null,
  setup: bxSetup,
  order: (sig, qty, clientId, pair) => orderBody(sig, qty, clientId, pair.priceDecimals ?? null),
  place: bxPlace,
  close: (f, k, s, pos) => bxFlashClose(f, k, s, pos.positionId),
  cancelAll: bxCancelAll,
};

const mexc: LiveEx = {
  id: "mexc",
  name: "MEXC",
  balance: mxBalance,
  pair: mxPair as LiveEx["pair"],
  positions: async (f, k, s) => (await mxPositions(f, k, s))?.map((p) => ({ symbol: p.symbol, qty: p.qty, positionId: p.positionId, raw: p })) ?? null,
  // MEXC recibe el margen aislado y el apalancamiento dentro de la propia orden.
  setup: async () => [],
  order: (sig, qty, clientId, pair, leverage) => mexcOrderBody(sig, qty, clientId, { contractSize: Number(pair.contractSize), priceDecimals: pair.priceDecimals ?? null }, leverage),
  place: mxPlace,
  close: (f, k, s, pos) => mxClose(f, k, s, pos.raw as MxPosition),
  cancelAll: mxCancelAll,
};

const REGISTRY: Record<LiveExchangeId, LiveEx> = { bitunix, mexc };
export const liveEx = (id: unknown): LiveEx => REGISTRY[isLiveExchange(id) ? id : "bitunix"];

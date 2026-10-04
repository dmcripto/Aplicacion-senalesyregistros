// ─── VELTRIX · Conexión de solo lectura con exchanges ─────────────────────
// Binance (futuros USDⓈ-M), Bybit (perpetuos lineales), Bitunix y MEXC (futuros). Solo se hacen pedidos
// GET de lectura: VELTRIX nunca opera ni mueve fondos.
// Sin dependencias de Deno ni de Node: solo fetch y WebCrypto, para poder probarlo en local.

export type ExchangeId = "binance" | "bybit" | "bitunix" | "mexc";
export const EXCHANGES: ExchangeId[] = ["binance", "bybit", "bitunix", "mexc"];
export const EXCHANGE_NAMES: Record<ExchangeId, string> = { binance: "Binance", bybit: "Bybit", bitunix: "Bitunix", mexc: "MEXC" };

export interface ClosedPosition {
  externalId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  qty: number; // tamaño en la moneda base
  entry: number;
  exit: number;
  pnl: number; // resultado neto en USDT (después de comisiones cuando el exchange las informa)
  openedAt: number; // ms
  closedAt: number; // ms
}

export interface CheckResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

/** Error con un mensaje pensado para mostrarse tal cual al usuario (en español). */
export class ExchangeError extends Error {}

type FetchFn = typeof fetch;

// ─── Utilidades ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const DAY = 86_400_000;
const WINDOW = 7 * DAY - 60_000; // los dos exchanges limitan cada consulta a 7 días

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

const qs = (params: Record<string, string | number>) =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Reparte [from, to] en ventanas de hasta 7 días. */
export function windows(from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = from; s < to; s += WINDOW + 1) out.push([s, Math.min(to, s + WINDOW)]);
  return out;
}

async function getJson(fetchFn: FetchFn, url: string, headers: Record<string, string>, who: string): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers });
  } catch {
    throw new ExchangeError(`No se pudo conectar con ${who}. Probá de nuevo en unos minutos.`);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* no era JSON */
  }
  if (res.status === 451 || res.status === 403) {
    throw new ExchangeError(`${who} rechazó la conexión desde nuestro servidor (bloqueo regional o de red). Probá de nuevo más tarde.`);
  }
  if (res.status === 429 || res.status === 418) {
    throw new ExchangeError(`${who} limitó los pedidos por unos minutos. Probá de nuevo más tarde.`);
  }
  return { status: res.status, body, text };
}

// ─── Binance (futuros USDⓈ-M) ───────────────────────────────────────────────

const B_SPOT = "https://api.binance.com";
const B_FUT = "https://fapi.binance.com";

/** Firma de Binance: HMAC-SHA256 (hex) de la query string, agregada como &signature=. */
export async function binanceSign(query: string, secret: string) {
  return hmacHex(secret, query);
}

async function binanceGet(fetchFn: FetchFn, host: string, path: string, params: Record<string, string | number>, key: string, secret: string) {
  const query = qs({ ...params, recvWindow: 10_000, timestamp: Date.now() });
  const sig = await binanceSign(query, secret);
  const r = await getJson(fetchFn, `${host}${path}?${query}&signature=${sig}`, { "X-MBX-APIKEY": key }, "Binance");
  const code = r.body?.code;
  if (r.status >= 400 || (typeof code === "number" && code < 0)) {
    if (code === -2014 || code === -2008 || code === -2015 || code === -1022) {
      throw new ExchangeError(
        code === -1022
          ? "Binance no aceptó la clave secreta. Revisá que la copiaste completa."
          : "Binance rechazó la clave. Revisá que esté bien copiada, que tenga activado \"Habilitar lectura\" (y Futuros si operás futuros) y que no tenga restricción de IP.",
      );
    }
    if (code === -1021) throw new ExchangeError("El reloj del servidor no coincide con el de Binance. Probá de nuevo.");
    throw new ExchangeError(`Binance respondió con un error${r.body?.msg ? `: ${r.body.msg}` : ""}.`);
  }
  return r.body;
}

export async function binanceCheck(key: string, secret: string, fetchFn: FetchFn = fetch): Promise<CheckResult> {
  try {
    const perms = await binanceGet(fetchFn, B_SPOT, "/sapi/v1/account/apiRestrictions", {}, key, secret);
    const risky: string[] = [];
    if (perms.enableWithdrawals) risky.push("retiros");
    if (perms.enableSpotAndMarginTrading) risky.push("operar spot y margen");
    if (perms.enableMargin) risky.push("margen");
    if (perms.enableInternalTransfer || perms.permitsUniversalTransfer) risky.push("transferencias");
    if (risky.length) {
      return { ok: false, error: `Esta clave permite ${risky.join(", ")}. Por seguridad, creá una nueva en Binance con SOLO "Habilitar lectura".` };
    }
    await binanceGet(fetchFn, B_FUT, "/fapi/v2/balance", {}, key, secret); // confirma que se pueden leer los futuros
    return {
      ok: true,
      warning: perms.enableFutures
        ? "Esta clave también permite operar futuros. VELTRIX solo lee, pero para más seguridad creá una con solo lectura si tu cuenta lo permite."
        : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

interface BinanceFill {
  id: number;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: string; // BOTH | LONG | SHORT
  price: number;
  qty: number;
  realizedPnl: number;
  commission: number;
  commissionAsset: string;
  time: number;
}

const STABLES = new Set(["USDT", "USDC", "BUSD", "FDUSD"]);

/** Convierte una lista de ejecuciones (fills) en posiciones cerradas: de "cero" a "cero". */
export function buildPositions(fills: BinanceFill[]): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  const groups = new Map<string, BinanceFill[]>();
  for (const f of fills) {
    const k = `${f.symbol}|${f.positionSide}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.time - b.time || a.id - b.id);
    const eps = 1e-12;
    let dir: 1 | -1 | 0 = 0; // 1 = long, -1 = short
    let size = 0;
    let openQty = 0, openCost = 0, closeQty = 0, closeVal = 0, pnl = 0, firstTime = 0;
    const reset = () => {
      dir = 0; size = 0; openQty = 0; openCost = 0; closeQty = 0; closeVal = 0; pnl = 0; firstTime = 0;
    };
    for (const f of list) {
      const fee = STABLES.has(f.commissionAsset) ? f.commission : 0;
      const sideSign = f.side === "BUY" ? 1 : -1;
      // En modo cobertura (LONG/SHORT) la dirección la fija el lado de la posición.
      const hedgeDir = f.positionSide === "LONG" ? 1 : f.positionSide === "SHORT" ? -1 : 0;
      if (dir === 0) {
        if (f.realizedPnl !== 0) continue; // cierra una posición abierta antes del período consultado: no se puede reconstruir
        dir = (hedgeDir || sideSign) as 1 | -1;
        firstTime = f.time;
      }
      const opening = sideSign === dir;
      if (opening) {
        size += f.qty;
        openQty += f.qty;
        openCost += f.qty * f.price;
        pnl -= fee;
      } else {
        const closing = Math.min(f.qty, size);
        size -= closing;
        closeQty += closing;
        closeVal += closing * f.price;
        pnl += f.realizedPnl - fee;
        if (size <= eps) {
          out.push({
            externalId: `${f.symbol}:${f.positionSide}:${f.id}`,
            symbol: f.symbol,
            direction: dir === 1 ? "LONG" : "SHORT",
            qty: openQty,
            entry: openCost / openQty,
            exit: closeVal / closeQty,
            pnl,
            openedAt: firstTime,
            closedAt: f.time,
          });
          const leftover = f.qty - closing;
          reset();
          if (leftover > eps && !hedgeDir) {
            // En modo un solo sentido, un cierre que se pasa de tamaño abre la posición contraria.
            dir = sideSign as 1 | -1;
            size = leftover;
            openQty = leftover;
            openCost = leftover * f.price;
            firstTime = f.time;
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.closedAt - b.closedAt);
}

export async function binanceFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch): Promise<ClosedPosition[]> {
  const symbols = new Set<string>();
  for (const [s, e] of windows(since, now)) {
    const rows = await binanceGet(fetchFn, B_FUT, "/fapi/v1/income", { incomeType: "REALIZED_PNL", startTime: s, endTime: e, limit: 1000 }, key, secret);
    for (const r of rows as Array<{ symbol?: string }>) if (r.symbol) symbols.add(r.symbol);
  }
  const fills: BinanceFill[] = [];
  for (const symbol of symbols) {
    for (const [s, e] of windows(since, now)) {
      let from = s;
      for (let page = 0; page < 20; page++) {
        const rows = (await binanceGet(fetchFn, B_FUT, "/fapi/v1/userTrades", { symbol, startTime: from, endTime: e, limit: 1000 }, key, secret)) as any[];
        for (const r of rows) {
          fills.push({
            id: Number(r.id),
            symbol: r.symbol,
            side: r.side,
            positionSide: r.positionSide ?? "BOTH",
            price: num(r.price),
            qty: num(r.qty),
            realizedPnl: num(r.realizedPnl),
            commission: num(r.commission),
            commissionAsset: String(r.commissionAsset ?? ""),
            time: Number(r.time),
          });
        }
        if (rows.length < 1000) break;
        from = Number(rows[rows.length - 1].time) + 1;
      }
    }
  }
  return buildPositions(fills).filter((p) => p.closedAt >= since);
}

// ─── Bybit (v5, perpetuos lineales) ─────────────────────────────────────────

const BYBIT = "https://api.bybit.com";
const RECV = "10000";

/** Firma de Bybit v5: HMAC-SHA256 (hex) de timestamp + apiKey + recvWindow + queryString. */
export async function bybitSign(timestamp: string, apiKey: string, recvWindow: string, query: string, secret: string) {
  return hmacHex(secret, timestamp + apiKey + recvWindow + query);
}

async function bybitGet(fetchFn: FetchFn, path: string, params: Record<string, string | number>, key: string, secret: string) {
  const query = qs(params);
  const ts = String(Date.now());
  const sig = await bybitSign(ts, key, RECV, query, secret);
  const r = await getJson(
    fetchFn,
    `${BYBIT}${path}${query ? `?${query}` : ""}`,
    { "X-BAPI-API-KEY": key, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": RECV, "X-BAPI-SIGN": sig },
    "Bybit",
  );
  const code = r.body?.retCode;
  if (r.status >= 400 || (code !== undefined && code !== 0)) {
    if (code === 10003 || code === 10004) throw new ExchangeError("Bybit no aceptó la clave o la clave secreta. Revisá que estén bien copiadas.");
    if (code === 10005) throw new ExchangeError("La clave de Bybit no tiene permiso de lectura para posiciones. Activá \"Lectura\" en Contratos.");
    if (code === 10010) throw new ExchangeError("La clave de Bybit tiene restricción de IP. Creala sin restricción de IP (con solo lectura es seguro).");
    if (code === 10002) throw new ExchangeError("El reloj del servidor no coincide con el de Bybit. Probá de nuevo.");
    throw new ExchangeError(`Bybit respondió con un error${r.body?.retMsg ? `: ${r.body.retMsg}` : ""}.`);
  }
  return r.body.result;
}

export async function bybitCheck(key: string, secret: string, fetchFn: FetchFn = fetch): Promise<CheckResult> {
  try {
    let info: any = null;
    try {
      info = await bybitGet(fetchFn, "/v5/user/query-api", {}, key, secret);
    } catch (e) {
      // Bybit solo deja consultar los permisos si la clave tiene algún permiso de billetera.
      // Una clave solo de lectura sin billetera cae acá: se comprueba entonces que se puedan leer las posiciones.
      if (!(e instanceof ExchangeError) || !/permiso de lectura/.test(e.message)) throw e;
    }
    if (info) {
      if (info.readOnly !== 1) {
        return { ok: false, error: "Esta clave permite operar. Por seguridad, creá una nueva en Bybit con permisos de SOLO LECTURA." };
      }
      return { ok: true };
    }
    await bybitGet(fetchFn, "/v5/position/closed-pnl", { category: "linear", limit: 1 }, key, secret);
    return { ok: true, warning: "No pudimos confirmar que la clave sea solo de lectura. Verificá en Bybit que hayas elegido \"Solo lectura\"." };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

export function parseBybitClosed(list: any[]): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  for (const r of list) {
    // "side" es el lado de la orden que cerró: Sell cierra un long, Buy cierra un short.
    const direction = r.side === "Sell" ? "LONG" : r.side === "Buy" ? "SHORT" : null;
    const entry = num(r.avgEntryPrice), exit = num(r.avgExitPrice), qty = num(r.closedSize ?? r.qty);
    if (!direction || !(entry > 0) || !(exit > 0) || !(qty > 0)) continue;
    const closedAt = Number(r.updatedTime ?? r.createdTime);
    out.push({
      externalId: `${r.symbol}:${r.orderId}`,
      symbol: String(r.symbol),
      direction,
      qty,
      entry,
      exit,
      pnl: num(r.closedPnl),
      openedAt: Number(r.createdTime ?? closedAt),
      closedAt,
    });
  }
  return out;
}

export async function bybitFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch): Promise<ClosedPosition[]> {
  const all: ClosedPosition[] = [];
  for (const [s, e] of windows(since, now)) {
    let cursor = "";
    for (let page = 0; page < 30; page++) {
      const params: Record<string, string | number> = { category: "linear", startTime: s, endTime: e, limit: 100 };
      if (cursor) params.cursor = cursor;
      const result = await bybitGet(fetchFn, "/v5/position/closed-pnl", params, key, secret);
      all.push(...parseBybitClosed(result?.list ?? []));
      cursor = result?.nextPageCursor ?? "";
      if (!cursor || !(result?.list?.length > 0)) break;
    }
  }
  return all;
}

// ─── Bitunix (futuros) ──────────────────────────────────────────────────────

const BITUNIX = "https://fapi.bitunix.com";

const sha256Hex = async (text: string) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));

/**
 * Firma de Bitunix: sha256( sha256(nonce + timestamp + apiKey + parámetros ordenados por nombre y pegados como clave+valor) + secreta ).
 * Los pedidos de VELTRIX son GET, así que no hay cuerpo.
 */
export async function bitunixSign(nonce: string, timestamp: string, apiKey: string, params: Record<string, string | number>, secret: string) {
  const sorted = Object.keys(params).sort().map((k) => k + params[k]).join("");
  return sha256Hex((await sha256Hex(nonce + timestamp + apiKey + sorted)) + secret);
}

async function bitunixGet(fetchFn: FetchFn, path: string, params: Record<string, string | number>, key: string, secret: string) {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const ts = String(Date.now());
  const sign = await bitunixSign(nonce, ts, key, params, secret);
  const query = qs(params);
  const r = await getJson(
    fetchFn,
    `${BITUNIX}${path}${query ? `?${query}` : ""}`,
    { "api-key": key, nonce, timestamp: ts, sign, "Content-Type": "application/json", language: "en-US" },
    "Bitunix",
  );
  const code = r.body?.code;
  if (r.status >= 400 || (code !== undefined && Number(code) !== 0)) {
    const c = Number(code);
    if (c === 10003 || c === 10007) throw new ExchangeError("Bitunix no aceptó la clave o la clave secreta. Revisá que estén bien copiadas.");
    if (c === 10004) throw new ExchangeError("La clave de Bitunix tiene restricción de IP. Creala sin restricción de IP (con solo lectura es seguro).");
    if (c === 10005 || c === 10006) throw new ExchangeError("Bitunix limitó los pedidos por unos minutos. Probá de nuevo más tarde.");
    if (r.status === 401) throw new ExchangeError("Bitunix no aceptó la clave. Revisá que esté bien copiada y que tenga permiso de lectura.");
    throw new ExchangeError(`Bitunix respondió con un error${r.body?.msg ? `: ${r.body.msg}` : ""}.`);
  }
  return r.body?.data;
}

export async function bitunixCheck(key: string, secret: string, fetchFn: FetchFn = fetch): Promise<CheckResult> {
  try {
    await bitunixGet(fetchFn, "/api/v1/futures/position/get_history_positions", { limit: 1 }, key, secret);
    // Bitunix no permite consultar los permisos de una clave: se avisa para que la persona lo confirme.
    return { ok: true, warning: "Bitunix no nos deja confirmar los permisos de la clave. Verificá en Bitunix que sea de SOLO LECTURA (sin operar ni retirar)." };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

export function parseBitunixClosed(list: any[]): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  for (const r of list ?? []) {
    const side = String(r.side ?? "").toUpperCase();
    const direction = side === "LONG" || side === "BUY" ? "LONG" : side === "SHORT" || side === "SELL" ? "SHORT" : null;
    const entry = num(r.entryPrice), exit = num(r.closePrice);
    // Tamaño máximo de la posición; si falta, se deduce del resultado bruto y el recorrido del precio.
    const move = Math.abs(exit - entry);
    const qty = num(r.maxQty) > 0 ? num(r.maxQty) : move > 0 ? Math.abs(num(r.realizedPNL)) / move : 0;
    const closedAt = Number(r.mtime ?? r.ctime);
    if (!direction || !(entry > 0) || !(exit > 0) || !(qty > 0) || !Number.isFinite(closedAt)) continue;
    out.push({
      externalId: `${r.symbol}:${r.positionId}`,
      symbol: String(r.symbol),
      direction,
      qty,
      entry,
      exit,
      // realizedPNL no incluye comisiones ni funding: se restan las comisiones y se suma el funding (con su signo).
      pnl: num(r.realizedPNL) - Math.abs(num(r.fee)) + num(r.funding),
      openedAt: Number(r.ctime ?? closedAt),
      closedAt,
    });
  }
  return out;
}

export async function bitunixFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch): Promise<ClosedPosition[]> {
  const all: ClosedPosition[] = [];
  for (const [s, e] of windows(since, now)) {
    for (let skip = 0, page = 0; page < 30; page++, skip += 100) {
      const data = await bitunixGet(fetchFn, "/api/v1/futures/position/get_history_positions", { startTime: s, endTime: e, skip, limit: 100 }, key, secret);
      const list: any[] = data?.positionList ?? [];
      all.push(...parseBitunixClosed(list));
      if (list.length < 100) break;
    }
  }
  return all;
}

// ─── MEXC (futuros) ─────────────────────────────────────────────────────────

const MEXC = "https://contract.mexc.com";

/** Firma de MEXC: HMAC-SHA256 (hex) de apiKey + timestamp + parámetros ordenados (clave=valor&...). */
export async function mexcSign(apiKey: string, timestamp: string, query: string, secret: string) {
  return hmacHex(secret, apiKey + timestamp + query);
}

async function mexcGet(fetchFn: FetchFn, path: string, params: Record<string, string | number>, key: string, secret: string) {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const query = qs(sorted);
  const ts = String(Date.now());
  const sig = await mexcSign(key, ts, query, secret);
  const r = await getJson(
    fetchFn,
    `${MEXC}${path}${query ? `?${query}` : ""}`,
    { ApiKey: key, "Request-Time": ts, Signature: sig, "Content-Type": "application/json" },
    "MEXC",
  );
  const code = r.body?.code;
  if (r.status >= 400 || r.body?.success === false || (code !== undefined && Number(code) !== 0)) {
    const c = Number(code);
    if (c === 602 || c === 10072) throw new ExchangeError("MEXC no aceptó la clave o la clave secreta. Revisá que estén bien copiadas.");
    if (c === 10073 || c === 700003) throw new ExchangeError("El reloj del servidor no coincide con el de MEXC. Probá de nuevo.");
    if (c === 401 || c === 403 || r.status === 401) throw new ExchangeError("La clave de MEXC no tiene permiso para leer Futuros. Activá la lectura de \"Futuros\" y volvé a intentar.");
    throw new ExchangeError(`MEXC respondió con un error${r.body?.message || r.body?.msg ? `: ${r.body.message ?? r.body.msg}` : ""}.`);
  }
  return r.body?.data;
}

export async function mexcCheck(key: string, secret: string, fetchFn: FetchFn = fetch): Promise<CheckResult> {
  try {
    await mexcGet(fetchFn, "/api/v1/private/position/list/history_positions", { page_num: 1, page_size: 1 }, key, secret);
    // MEXC no permite consultar los permisos de una clave: se avisa para que la persona lo confirme.
    return { ok: true, warning: "MEXC no nos deja confirmar los permisos de la clave. Verificá en MEXC que sea de SOLO LECTURA (sin operar ni retirar)." };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

/** MEXC informa el tamaño en contratos: se multiplica por lo que vale cada contrato en la moneda base. */
export function parseMexcClosed(list: any[], contractSizes: Record<string, number>): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  for (const r of list ?? []) {
    if (Number(r.state) !== 3) continue; // 1 y 2 = posición todavía abierta
    const direction = Number(r.positionType) === 1 ? "LONG" : Number(r.positionType) === 2 ? "SHORT" : null;
    const entry = num(r.openAvgPrice ?? r.holdAvgPrice), exit = num(r.closeAvgPrice);
    const size = contractSizes[String(r.symbol)];
    // Sin el valor del contrato se deduce el tamaño del resultado bruto y el recorrido del precio.
    const move = Math.abs(exit - entry);
    const qty = size > 0 ? num(r.closeVol) * size : move > 0 ? Math.abs(num(r.closeProfitLoss)) / move : 0;
    const closedAt = Number(r.updateTime ?? r.createTime);
    if (!direction || !(entry > 0) || !(exit > 0) || !(qty > 0) || !Number.isFinite(closedAt)) continue;
    out.push({
      externalId: `${r.symbol}:${r.positionId}`,
      symbol: String(r.symbol).replace(/_/g, ""),
      direction,
      qty,
      entry,
      exit,
      pnl: num(r.realised), // resultado final ya descontadas las comisiones
      openedAt: Number(r.createTime ?? closedAt),
      closedAt,
    });
  }
  return out;
}

async function mexcContractSize(fetchFn: FetchFn, symbol: string): Promise<number> {
  try {
    const r = await getJson(fetchFn, `${MEXC}/api/v1/contract/detail?symbol=${encodeURIComponent(symbol)}`, {}, "MEXC");
    return num(r.body?.data?.contractSize);
  } catch {
    return 0;
  }
}

export async function mexcFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch): Promise<ClosedPosition[]> {
  const raw: any[] = [];
  // El historial viene sin filtro de fechas: se pide por páginas hasta pasar el período buscado.
  for (let page = 1; page <= 30; page++) {
    const list: any[] = (await mexcGet(fetchFn, "/api/v1/private/position/list/history_positions", { page_num: page, page_size: 100 }, key, secret)) ?? [];
    raw.push(...list.filter((r) => Number(r.updateTime ?? r.createTime) >= since && Number(r.updateTime ?? r.createTime) <= now));
    if (list.length < 100) break;
    const oldest = Math.min(...list.map((r) => Number(r.updateTime ?? r.createTime)));
    if (oldest < since) break;
  }
  const sizes: Record<string, number> = {};
  for (const symbol of new Set(raw.map((r) => String(r.symbol)))) sizes[symbol] = await mexcContractSize(fetchFn, symbol);
  return parseMexcClosed(raw, sizes);
}

// ─── Común ──────────────────────────────────────────────────────────────────

export const checkKey = (ex: ExchangeId, key: string, secret: string, fetchFn?: FetchFn) =>
  ex === "binance" ? binanceCheck(key, secret, fetchFn)
  : ex === "bybit" ? bybitCheck(key, secret, fetchFn)
  : ex === "bitunix" ? bitunixCheck(key, secret, fetchFn)
  : mexcCheck(key, secret, fetchFn);

export const fetchClosed = (ex: ExchangeId, key: string, secret: string, since: number, now?: number, fetchFn?: FetchFn) =>
  ex === "binance" ? binanceFetchClosed(key, secret, since, now, fetchFn)
  : ex === "bybit" ? bybitFetchClosed(key, secret, since, now, fetchFn)
  : ex === "bitunix" ? bitunixFetchClosed(key, secret, since, now, fetchFn)
  : mexcFetchClosed(key, secret, since, now, fetchFn);

export interface TradeRow {
  symbol: string;
  direction: "LONG" | "SHORT";
  entry: number;
  tp: number;
  sl: number;
  date: string;
  outcome: "MANUAL";
  exit: number;
  closed_at: string;
  notes: string;
  source: ExchangeId;
  external_id: string;
}

const round = (n: number) => Number(n.toPrecision(10));

/**
 * Arma la fila del diario a partir de una posición cerrada.
 * `unit` es lo que vale 1R en dinero (capital × riesgo %). Como el exchange no guarda el stop,
 * se toma como stop la distancia en la que la posición perdería exactamente 1R, y como salida
 * el precio que reproduce el resultado NETO real: así el R del diario coincide con el dinero.
 */
export function toTradeRow(p: ClosedPosition, exchange: ExchangeId, unit: number): TradeRow {
  const dir = p.direction === "LONG" ? 1 : -1;
  const slDist = unit / p.qty;
  const exitNet = p.entry + (dir * p.pnl) / p.qty;
  const tpDist = p.pnl > 0 ? Math.abs(exitNet - p.entry) : slDist;
  const name = EXCHANGE_NAMES[exchange];
  return {
    symbol: p.symbol.toUpperCase(),
    direction: p.direction,
    entry: round(p.entry),
    tp: round(p.entry + dir * tpDist),
    sl: round(p.entry - dir * slDist),
    date: new Date(p.openedAt).toISOString(),
    outcome: "MANUAL",
    exit: round(exitNet),
    closed_at: new Date(p.closedAt).toISOString(),
    notes: `${name} · cantidad ${round(p.qty)} · salida real ${round(p.exit)} · resultado neto ${p.pnl >= 0 ? "+" : "−"}${Math.abs(p.pnl).toFixed(2)} USDT`,
    source: exchange,
    external_id: p.externalId,
  };
}

// ─── Cifrado de la clave secreta (AES-GCM) ──────────────────────────────────

async function aesKey(master: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(master));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(plain: string, master: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(master), enc.encode(plain));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(packed: string, master: string): Promise<string> {
  const [iv, ct] = packed.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(master), unb64(ct));
  return new TextDecoder().decode(plain);
}

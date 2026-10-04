// ─── VELTRIX · Conexión de solo lectura con exchanges ─────────────────────
// Binance (futuros USDⓈ-M), Bybit (perpetuos lineales), Bitunix, MEXC, Gate, Bitget, OKX y KuCoin (futuros). Solo se hacen pedidos
// GET de lectura: VELTRIX nunca opera ni mueve fondos.
// Sin dependencias de Deno ni de Node: solo fetch y WebCrypto, para poder probarlo en local.

export type ExchangeId = "binance" | "bybit" | "bitunix" | "mexc" | "gate" | "bitget" | "okx" | "kucoin";
export const EXCHANGES: ExchangeId[] = ["binance", "bybit", "bitunix", "mexc", "gate", "bitget", "okx", "kucoin"];
export const EXCHANGE_NAMES: Record<ExchangeId, string> = { binance: "Binance", bybit: "Bybit", bitunix: "Bitunix", mexc: "MEXC", gate: "Gate", bitget: "Bitget", okx: "OKX", kucoin: "KuCoin" };
/** Exchanges que además de la clave y la secreta piden una contraseña de la API (passphrase). */
export const NEEDS_PASSPHRASE: ExchangeId[] = ["bitget", "okx", "kucoin"];

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
  raw?: string; // datos tal como los informó el exchange, para verificar (solo exchanges todavía sin comprobar con cuentas reales)
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
      raw: `Bitunix informó: realizedPNL ${r.realizedPNL} · fee ${r.fee} · funding ${r.funding}`,
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

// ─── Gate (futuros perpetuos USDT) ──────────────────────────────────────────

const GATE = "https://api.gateio.ws";
const GATE_PATH = "/api/v4/futures/usdt/position_close";

const hmacHex512 = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
};
const sha512Hex = async (text: string) => toHex(await crypto.subtle.digest("SHA-512", enc.encode(text)));

/** Firma de Gate v4: HMAC-SHA512 (hex) de "MÉTODO\nruta\nquery\nsha512(cuerpo)\ntimestamp en segundos". */
export async function gateSign(method: string, path: string, query: string, timestamp: string, secret: string) {
  return hmacHex512(secret, [method.toUpperCase(), path, query, await sha512Hex(""), timestamp].join("\n"));
}

async function gateGet(fetchFn: FetchFn, path: string, params: Record<string, string | number>, key: string, secret: string) {
  const query = qs(params);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await gateSign("GET", path, query, ts, secret);
  const r = await getJson(fetchFn, `${GATE}${path}${query ? `?${query}` : ""}`, { KEY: key, Timestamp: ts, SIGN: sig, "Content-Type": "application/json" }, "Gate");
  const label = r.body?.label;
  if (r.status >= 400 || (typeof label === "string" && label)) {
    if (label === "INVALID_KEY" || label === "INVALID_SIGNATURE") throw new ExchangeError("Gate no aceptó la clave o la clave secreta. Revisá que estén bien copiadas.");
    if (label === "IP_FORBIDDEN") throw new ExchangeError("La clave de Gate tiene restricción de IP. Creala sin restricción de IP (con solo lectura es seguro).");
    if (label === "REQUEST_EXPIRED") throw new ExchangeError("El reloj del servidor no coincide con el de Gate. Probá de nuevo.");
    if (label === "FORBIDDEN") throw new ExchangeError("La clave de Gate no tiene permiso para leer Futuros. Activá la lectura de \"Futuros perpetuos\" y volvé a intentar.");
    if (label === "TOO_MANY_REQUESTS") throw new ExchangeError("Gate limitó los pedidos por unos minutos. Probá de nuevo más tarde.");
    throw new ExchangeError(`Gate respondió con un error${r.body?.message ? `: ${r.body.message}` : ""}.`);
  }
  return r.body;
}

export async function gateCheck(key: string, secret: string, fetchFn: FetchFn = fetch): Promise<CheckResult> {
  try {
    await gateGet(fetchFn, GATE_PATH, { limit: 1 }, key, secret);
    // Gate no permite consultar los permisos de una clave: se avisa para que la persona lo confirme.
    return { ok: true, warning: "Gate no nos deja confirmar los permisos de la clave. Verificá en Gate que sea de SOLO LECTURA (sin operar ni retirar)." };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

/** Gate informa el tamaño en contratos: se multiplica por lo que vale cada contrato en la moneda base (quanto_multiplier). */
export function parseGateClosed(list: any[], multipliers: Record<string, number>): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  for (const r of list ?? []) {
    const direction = r.side === "long" ? "LONG" : r.side === "short" ? "SHORT" : null;
    // En un largo, long_price es la entrada y short_price la salida; en un corto, al revés.
    const entry = num(direction === "LONG" ? r.long_price : r.short_price);
    const exit = num(direction === "LONG" ? r.short_price : r.long_price);
    const mult = multipliers[String(r.contract)];
    const pnl = num(r.pnl); // ya incluye comisiones y funding
    // Sin el valor del contrato se deduce el tamaño del resultado de precio (pnl_pnl) y el recorrido.
    const move = Math.abs(exit - entry);
    const qty = mult > 0 ? num(r.max_size) * mult : move > 0 ? Math.abs(num(r.pnl_pnl)) / move : 0;
    const closedAt = Number(r.time) * 1000;
    if (!direction || !(entry > 0) || !(exit > 0) || !(qty > 0) || !Number.isFinite(closedAt)) continue;
    const openedAt = Number(r.first_open_time) * 1000;
    out.push({
      externalId: `${r.contract}:${r.side}:${r.first_open_time}:${r.time}`,
      symbol: String(r.contract).replace(/_/g, ""),
      direction,
      qty,
      entry,
      exit,
      pnl,
      openedAt: Number.isFinite(openedAt) ? openedAt : closedAt,
      closedAt,
    });
  }
  return out;
}

async function gateMultiplier(fetchFn: FetchFn, contract: string): Promise<number> {
  try {
    const r = await getJson(fetchFn, `${GATE}/api/v4/futures/usdt/contracts/${encodeURIComponent(contract)}`, {}, "Gate");
    return num(r.body?.quanto_multiplier);
  } catch {
    return 0;
  }
}

export async function gateFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch): Promise<ClosedPosition[]> {
  const raw: any[] = [];
  for (const [s, e] of windows(since, now)) {
    for (let offset = 0, page = 0; page < 30; page++, offset += 100) {
      const list: any[] = (await gateGet(fetchFn, GATE_PATH, { from: Math.floor(s / 1000), to: Math.floor(e / 1000), limit: 100, offset }, key, secret)) ?? [];
      raw.push(...(Array.isArray(list) ? list : []));
      if (!Array.isArray(list) || list.length < 100) break;
    }
  }
  const mults: Record<string, number> = {};
  for (const c of new Set(raw.map((r) => String(r.contract)))) mults[c] = await gateMultiplier(fetchFn, c);
  return parseGateClosed(raw, mults);
}

// ─── Bitget (futuros USDT) ──────────────────────────────────────────────────

const BITGET = "https://api.bitget.com";
const BITGET_PATH = "/api/v2/mix/position/history-position";

const hmacBase64 = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
};

/** Firma de Bitget: HMAC-SHA256 en base64 de timestamp + MÉTODO + ruta + ?query. */
export async function bitgetSign(timestamp: string, method: string, pathWithQuery: string, secret: string) {
  return hmacBase64(secret, timestamp + method.toUpperCase() + pathWithQuery);
}

async function bitgetGet(fetchFn: FetchFn, path: string, params: Record<string, string | number>, key: string, secret: string, pass: string) {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const query = qs(sorted);
  const ts = String(Date.now());
  const full = `${path}${query ? `?${query}` : ""}`;
  const sig = await bitgetSign(ts, "GET", full, secret);
  const r = await getJson(fetchFn, `${BITGET}${full}`, { "ACCESS-KEY": key, "ACCESS-SIGN": sig, "ACCESS-TIMESTAMP": ts, "ACCESS-PASSPHRASE": pass, "Content-Type": "application/json" }, "Bitget");
  const code = r.body?.code;
  if (r.status >= 400 || (code !== undefined && String(code) !== "00000")) {
    const c = String(code);
    if (["40006", "40009", "40010", "40012"].includes(c)) throw new ExchangeError("Bitget no aceptó la clave, la clave secreta o la contraseña de la API. Revisá que estén bien copiadas.");
    if (c === "40011" || c === "40001" || c === "40002") throw new ExchangeError("Faltan datos de la clave de Bitget. Revisá la clave, la secreta y la contraseña de la API.");
    if (c === "40014") throw new ExchangeError("La clave de Bitget no tiene permiso para leer Futuros. Activá la lectura de \"Futuros\" y volvé a intentar.");
    if (c === "40018") throw new ExchangeError("La clave de Bitget tiene restricción de IP. Creala sin restricción de IP (con solo lectura es seguro).");
    if (c === "40004" || c === "40008" || c === "40005") throw new ExchangeError("El reloj del servidor no coincide con el de Bitget. Probá de nuevo.");
    throw new ExchangeError(`Bitget respondió con un error${r.body?.msg ? `: ${r.body.msg}` : ""}.`);
  }
  return r.body?.data;
}

export async function bitgetCheck(key: string, secret: string, fetchFn: FetchFn = fetch, pass = ""): Promise<CheckResult> {
  if (!pass) return { ok: false, error: "Bitget pide también la contraseña de la API (passphrase)." };
  try {
    await bitgetGet(fetchFn, BITGET_PATH, { productType: "USDT-FUTURES", limit: 1 }, key, secret, pass);
    // Bitget no permite consultar los permisos de una clave: se avisa para que la persona lo confirme.
    return { ok: true, warning: "Bitget no nos deja confirmar los permisos de la clave. Verificá en Bitget que sea de SOLO LECTURA (sin operar ni retirar)." };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

export function parseBitgetClosed(list: any[]): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  for (const r of list ?? []) {
    const direction = r.holdSide === "long" ? "LONG" : r.holdSide === "short" ? "SHORT" : null;
    const entry = num(r.openAvgPrice), exit = num(r.closeAvgPrice);
    const qty = num(r.closeTotalPos) > 0 ? num(r.closeTotalPos) : num(r.openTotalPos);
    const closedAt = Number(r.utime ?? r.ctime);
    if (!direction || !(entry > 0) || !(exit > 0) || !(qty > 0) || !Number.isFinite(closedAt)) continue;
    out.push({
      externalId: r.positionId ? `${r.symbol}:${r.positionId}` : `${r.symbol}:${r.holdSide}:${r.ctime}`,
      symbol: String(r.symbol),
      direction,
      qty,
      entry,
      exit,
      pnl: r.netProfit !== undefined ? num(r.netProfit) : num(r.pnl) + num(r.openFee) + num(r.closeFee) + num(r.totalFunding), // neto de comisiones y funding
      openedAt: Number(r.ctime ?? closedAt),
      closedAt,
    });
  }
  return out;
}

export async function bitgetFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch, pass = ""): Promise<ClosedPosition[]> {
  const all: ClosedPosition[] = [];
  for (const [s, e] of windows(since, now)) {
    let cursor = "";
    for (let page = 0; page < 30; page++) {
      const params: Record<string, string | number> = { productType: "USDT-FUTURES", startTime: s, endTime: e, limit: 100 };
      if (cursor) params.idLessThan = cursor;
      const data = await bitgetGet(fetchFn, BITGET_PATH, params, key, secret, pass);
      const list: any[] = data?.list ?? [];
      all.push(...parseBitgetClosed(list));
      cursor = data?.endId ? String(data.endId) : "";
      if (!cursor || list.length < 100) break;
    }
  }
  return all;
}

// ─── OKX (perpetuos y futuros) ──────────────────────────────────────────────

const OKX = "https://www.okx.com";
const OKX_PATH = "/api/v5/account/positions-history";

/** Firma de OKX: HMAC-SHA256 en base64 de timestamp ISO + MÉTODO + ruta + ?query. */
export async function okxSign(timestamp: string, method: string, pathWithQuery: string, secret: string) {
  return hmacBase64(secret, timestamp + method.toUpperCase() + pathWithQuery);
}

async function okxGet(fetchFn: FetchFn, path: string, params: Record<string, string | number>, key: string, secret: string, pass: string) {
  const query = qs(params);
  const ts = new Date().toISOString();
  const full = `${path}${query ? `?${query}` : ""}`;
  const sig = await okxSign(ts, "GET", full, secret);
  const r = await getJson(fetchFn, `${OKX}${full}`, { "OK-ACCESS-KEY": key, "OK-ACCESS-SIGN": sig, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": pass, "Content-Type": "application/json" }, "OKX");
  const code = r.body?.code;
  if (r.status >= 400 || (code !== undefined && String(code) !== "0")) {
    const c = String(code);
    if (c === "50111" || c === "50113" || c === "50105" || c === "50114") throw new ExchangeError("OKX no aceptó la clave, la clave secreta o la contraseña de la API. Revisá que estén bien copiadas.");
    if (c === "50103" || c === "50104") throw new ExchangeError("Faltan datos de la clave de OKX. Revisá la clave, la secreta y la contraseña de la API.");
    if (c === "50110") throw new ExchangeError("La clave de OKX tiene restricción de IP. Creala sin restricción de IP (con solo lectura es seguro).");
    if (c === "50102") throw new ExchangeError("El reloj del servidor no coincide con el de OKX. Probá de nuevo.");
    if (c === "50011" || r.status === 429) throw new ExchangeError("OKX limitó los pedidos por unos minutos. Probá de nuevo más tarde.");
    throw new ExchangeError(`OKX respondió con un error${r.body?.msg ? `: ${r.body.msg}` : ""}.`);
  }
  return r.body?.data;
}

export async function okxCheck(key: string, secret: string, fetchFn: FetchFn = fetch, pass = ""): Promise<CheckResult> {
  if (!pass) return { ok: false, error: "OKX pide también la contraseña de la API (passphrase)." };
  try {
    const cfg = await okxGet(fetchFn, "/api/v5/account/config", {}, key, secret, pass);
    const perm = String(cfg?.[0]?.perm ?? "");
    if (/trade|withdraw/.test(perm)) {
      return { ok: false, error: "Esta clave permite operar o retirar. Por seguridad, creá una nueva en OKX con permisos de SOLO LECTURA." };
    }
    return perm ? { ok: true } : { ok: true, warning: "No pudimos confirmar que la clave sea solo de lectura. Verificá en OKX que hayas elegido \"Solo lectura\"." };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

/** OKX informa el tamaño en contratos: se multiplica por el valor del contrato (ctVal × ctMult). */
export function parseOkxClosed(list: any[], contractValues: Record<string, number>): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  for (const r of list ?? []) {
    const entry = num(r.openAvgPx), exit = num(r.closeAvgPx);
    const pnl = num(r.realizedPnl); // ya incluye comisiones, funding y penalidad de liquidación
    // En modo neto "direction" viene como "net": el lado se deduce del recorrido del precio y del signo del resultado de precio.
    const dirOfPrice = (exit - entry) * num(r.pnl); // positivo: subió y ganó (o bajó y perdió) → largo
    const direction = r.direction === "long" ? "LONG" : r.direction === "short" ? "SHORT" : dirOfPrice > 0 ? "LONG" : dirOfPrice < 0 ? "SHORT" : null;
    const cv = contractValues[String(r.instId)];
    const move = Math.abs(exit - entry);
    const qty = cv > 0 ? num(r.closeTotalPos) * cv : move > 0 ? Math.abs(num(r.pnl)) / move : 0;
    const closedAt = Number(r.uTime ?? r.cTime);
    if (!direction || !(entry > 0) || !(exit > 0) || !(qty > 0) || !Number.isFinite(closedAt)) continue;
    out.push({
      externalId: `${r.instId}:${r.posId}`,
      symbol: String(r.instId).replace(/-SWAP$/, "").replace(/-/g, ""),
      direction,
      qty,
      entry,
      exit,
      pnl,
      openedAt: Number(r.cTime ?? closedAt),
      closedAt,
    });
  }
  return out;
}

async function okxContractValue(fetchFn: FetchFn, instType: string, instId: string): Promise<number> {
  try {
    const r = await getJson(fetchFn, `${OKX}/api/v5/public/instruments?instType=${instType}&instId=${encodeURIComponent(instId)}`, {}, "OKX");
    const d = r.body?.data?.[0];
    return num(d?.ctVal) * (num(d?.ctMult) || 1);
  } catch {
    return 0;
  }
}

export async function okxFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch, pass = ""): Promise<ClosedPosition[]> {
  const raw: any[] = [];
  const types = new Map<string, string>();
  for (const instType of ["SWAP", "FUTURES"]) {
    let after = "";
    for (let page = 0; page < 30; page++) {
      const params: Record<string, string | number> = { instType, limit: 100 };
      if (after) params.after = after; // trae lo anterior a esa fecha
      const list: any[] = (await okxGet(fetchFn, OKX_PATH, params, key, secret, pass)) ?? [];
      for (const r of list) {
        const t = Number(r.uTime ?? r.cTime);
        if (t >= since && t <= now) {
          raw.push(r);
          types.set(String(r.instId), instType);
        }
      }
      if (list.length < 100) break;
      const oldest = Math.min(...list.map((r) => Number(r.uTime ?? r.cTime)));
      if (!(oldest > since)) break;
      after = String(oldest);
    }
  }
  const values: Record<string, number> = {};
  for (const [id, t] of types) values[id] = await okxContractValue(fetchFn, t, id);
  return parseOkxClosed(raw, values);
}

// ─── KuCoin (futuros) ───────────────────────────────────────────────────────

const KUCOIN = "https://api-futures.kucoin.com";
const KUCOIN_PATH = "/api/v1/history-positions";

/** Firma de KuCoin: HMAC-SHA256 en base64 de timestamp + MÉTODO + ruta + ?query. */
export async function kucoinSign(timestamp: string, method: string, pathWithQuery: string, secret: string) {
  return hmacBase64(secret, timestamp + method.toUpperCase() + pathWithQuery);
}

async function kucoinGet(fetchFn: FetchFn, path: string, params: Record<string, string | number>, key: string, secret: string, pass: string) {
  const query = qs(params);
  const ts = String(Date.now());
  const full = `${path}${query ? `?${query}` : ""}`;
  const sig = await kucoinSign(ts, "GET", full, secret);
  const r = await getJson(
    fetchFn,
    `${KUCOIN}${full}`,
    {
      "KC-API-KEY": key,
      "KC-API-SIGN": sig,
      "KC-API-TIMESTAMP": ts,
      "KC-API-PASSPHRASE": await hmacBase64(secret, pass), // con la versión 2 de la clave, la contraseña va firmada
      "KC-API-KEY-VERSION": "2",
      "Content-Type": "application/json",
    },
    "KuCoin",
  );
  const code = r.body?.code;
  if (r.status >= 400 || (code !== undefined && String(code) !== "200000")) {
    const c = String(code);
    if (["400003", "400004", "400005"].includes(c) || r.status === 401) throw new ExchangeError("KuCoin no aceptó la clave, la clave secreta o la contraseña de la API. Revisá que estén bien copiadas.");
    if (c === "400001") throw new ExchangeError("Faltan datos de la clave de KuCoin. Revisá la clave, la secreta y la contraseña de la API.");
    if (c === "400006") throw new ExchangeError("La clave de KuCoin tiene restricción de IP. Creala sin restricción de IP (con solo lectura es seguro).");
    if (c === "400007") throw new ExchangeError("La clave de KuCoin no tiene permiso para leer Futuros. Revisá los permisos de la clave y volvé a intentar.");
    if (c === "400002") throw new ExchangeError("El reloj del servidor no coincide con el de KuCoin. Probá de nuevo.");
    if (c === "429000") throw new ExchangeError("KuCoin limitó los pedidos por unos minutos. Probá de nuevo más tarde.");
    throw new ExchangeError(`KuCoin respondió con un error${r.body?.msg ? `: ${r.body.msg}` : ""}.`);
  }
  return r.body?.data;
}

export async function kucoinCheck(key: string, secret: string, fetchFn: FetchFn = fetch, pass = ""): Promise<CheckResult> {
  if (!pass) return { ok: false, error: "KuCoin pide también la contraseña de la API (passphrase)." };
  try {
    await kucoinGet(fetchFn, KUCOIN_PATH, { limit: 1 }, key, secret, pass);
    // KuCoin no permite consultar los permisos de una clave: se avisa para que la persona lo confirme.
    return { ok: true, warning: "KuCoin no nos deja confirmar los permisos de la clave. Verificá en KuCoin que sea de SOLO LECTURA (sin operar ni retirar)." };
  } catch (e) {
    return { ok: false, error: e instanceof ExchangeError ? e.message : "No se pudo verificar la clave." };
  }
}

/** KuCoin informa el tamaño en lotes: se multiplica por el valor del lote (multiplier). El pnl ya viene neto de comisiones y funding. */
export function parseKucoinClosed(list: any[], multipliers: Record<string, number>): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  for (const r of list ?? []) {
    const type = String(r.type ?? "").toUpperCase();
    const side = String(r.side ?? "").toLowerCase();
    const direction = side === "long" || type.endsWith("LONG") ? "LONG" : side === "short" || type.endsWith("SHORT") ? "SHORT" : null;
    const entry = num(r.openPrice), exit = num(r.closePrice);
    const pnl = num(r.pnl);
    const mult = Math.abs(multipliers[String(r.symbol)] ?? 0);
    // Sin el tamaño se deduce del resultado bruto (pnl + comisión − funding) y el recorrido del precio.
    const move = Math.abs(exit - entry);
    const gross = Math.abs(pnl + num(r.tradeFee) - num(r.fundingFee));
    const qty = mult > 0 && num(r.closeSize) > 0 ? num(r.closeSize) * mult : move > 0 ? gross / move : 0;
    const closedAt = Number(r.closeTime);
    if (!direction || !(entry > 0) || !(exit > 0) || !(qty > 0) || !Number.isFinite(closedAt)) continue;
    out.push({
      externalId: `${r.symbol}:${r.closeId ?? r.positionId ?? closedAt}`,
      symbol: String(r.symbol).replace(/M$/, "").replace(/^XBT/, "BTC"),
      direction,
      qty,
      entry,
      exit,
      pnl,
      openedAt: Number(r.openTime ?? closedAt),
      closedAt,
    });
  }
  return out;
}

async function kucoinMultiplier(fetchFn: FetchFn, symbol: string): Promise<number> {
  try {
    const r = await getJson(fetchFn, `${KUCOIN}/api/v1/contracts/${encodeURIComponent(symbol)}`, {}, "KuCoin");
    return num(r.body?.data?.multiplier);
  } catch {
    return 0;
  }
}

export async function kucoinFetchClosed(key: string, secret: string, since: number, now = Date.now(), fetchFn: FetchFn = fetch, pass = ""): Promise<ClosedPosition[]> {
  const raw: any[] = [];
  for (const [s, e] of windows(since, now)) {
    for (let pageId = 1; pageId <= 30; pageId++) {
      const data = await kucoinGet(fetchFn, KUCOIN_PATH, { from: s, to: e, limit: 100, pageId }, key, secret, pass);
      const items: any[] = data?.items ?? [];
      raw.push(...items);
      const totalPage = Number(data?.totalPage);
      if (items.length < 100 || (Number.isFinite(totalPage) && pageId >= totalPage)) break;
    }
  }
  const mults: Record<string, number> = {};
  for (const sym of new Set(raw.map((r) => String(r.symbol)))) mults[sym] = await kucoinMultiplier(fetchFn, sym);
  return parseKucoinClosed(raw, mults);
}

// ─── Común ──────────────────────────────────────────────────────────────────

export const checkKey = (ex: ExchangeId, key: string, secret: string, fetchFn?: FetchFn, pass?: string) =>
  ex === "binance" ? binanceCheck(key, secret, fetchFn)
  : ex === "bybit" ? bybitCheck(key, secret, fetchFn)
  : ex === "bitunix" ? bitunixCheck(key, secret, fetchFn)
  : ex === "mexc" ? mexcCheck(key, secret, fetchFn)
  : ex === "gate" ? gateCheck(key, secret, fetchFn)
  : ex === "bitget" ? bitgetCheck(key, secret, fetchFn, pass)
  : ex === "okx" ? okxCheck(key, secret, fetchFn, pass)
  : kucoinCheck(key, secret, fetchFn, pass);

export const fetchClosed = (ex: ExchangeId, key: string, secret: string, since: number, now?: number, fetchFn?: FetchFn, pass?: string) =>
  ex === "binance" ? binanceFetchClosed(key, secret, since, now, fetchFn)
  : ex === "bybit" ? bybitFetchClosed(key, secret, since, now, fetchFn)
  : ex === "bitunix" ? bitunixFetchClosed(key, secret, since, now, fetchFn)
  : ex === "mexc" ? mexcFetchClosed(key, secret, since, now, fetchFn)
  : ex === "gate" ? gateFetchClosed(key, secret, since, now, fetchFn)
  : ex === "bitget" ? bitgetFetchClosed(key, secret, since, now, fetchFn, pass)
  : ex === "okx" ? okxFetchClosed(key, secret, since, now, fetchFn, pass)
  : kucoinFetchClosed(key, secret, since, now, fetchFn, pass);

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
    notes: `${name} · cantidad ${round(p.qty)} · salida real ${round(p.exit)} · resultado neto ${p.pnl >= 0 ? "+" : "−"}${Math.abs(p.pnl).toFixed(2)} USDT${p.raw ? ` · ${p.raw}` : ""}`,
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

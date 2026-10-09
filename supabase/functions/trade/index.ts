// VELTRIX · bot con dinero real (prueba mínima) en cualquiera de los 8 exchanges, a elección de cada persona.
//
//   POST /functions/v1/trade   (con la sesión de la persona en Authorization)
//     { action: "status" }
//     { action: "connect_key", exchange?, apiKey, apiSecret }     ← exchange: bitunix (por defecto), mexc, binance, bybit, okx, bitget, bingx o gate; apiPassphrase en okx y bitget; pide el código de 2FA si la persona lo activó
//     { action: "disconnect_key", exchange? }                      ← ídem
//     { action: "test_order", confirm?: boolean }       ← sin confirm: solo muestra lo que enviaría; con confirm: orden mínima real + cierre
//     { action: "panic" }                               ← apaga el bot real, cancela órdenes y cierra posiciones (no pide 2FA)
//
//   POST /functions/v1/trade   (con x-cron-secret: la función del bot)
//     { action: "execute", userId, tradeId }            ← abre (o arma en seco) la orden de una operación nueva del bot
//
// Todo está limitado por los topes de la tabla bot_live (CHECK en la base) y solo funciona en cuentas con bot_beta.

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret, encryptSecret } from "../_shared/exchanges.ts";
import { planOrder } from "../_shared/bitunixTrade.ts";
import type { BxCfg, BxSignal } from "../_shared/bitunixTrade.ts";
import { isLiveExchange, liveEx, LIVE_EXCHANGES, LIVE_NEEDS_PASS } from "../_shared/liveExchange.ts";
import { LV_PASS_SEP } from "../_shared/liveMore.ts";
import type { LiveExchangeId } from "../_shared/liveExchange.ts";
import { sendExpoPush } from "../_shared/expoPush.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_ERRORS = 3; // errores seguidos: el bot real se apaga solo
const LIVE_COLUMNS = "user_id, exchange, enabled, dry_run, verified, max_margin_usdt, risk_usdt, max_leverage, max_open, daily_loss_usdt, errors, last_error";

interface Live {
  user_id: string;
  exchange?: string | null;
  enabled: boolean;
  dry_run: boolean;
  verified: boolean;
  max_margin_usdt: number;
  risk_usdt: number;
  max_leverage: number;
  max_open: number;
  daily_loss_usdt: number;
  errors: number;
  last_error: string | null;
}

const cfgOf = (l: Live): BxCfg => ({ risk_usdt: Number(l.risk_usdt), max_margin_usdt: Number(l.max_margin_usdt), max_leverage: Number(l.max_leverage) });

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Marcas de la sesión (la firma ya la verificó auth.getUser): acá solo se leen las del 2FA. */
function claimsOf(token: string): Record<string, unknown> {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return {};
  }
}

/** true = se puede seguir (sin 2FA, o con un código reciente). */
async function stepOk(userId: string, token: string): Promise<boolean> {
  const { data, error } = await admin.rpc("mfa_step_ok", { uid: userId, claims: claimsOf(token) });
  if (error) return /mfa_step_ok/i.test(error.message ?? ""); // sin la migración del 2FA nadie lo tiene activado
  return data !== false;
}

async function livePrice(symbol: string): Promise<number | null> {
  for (const url of [`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`, `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { price?: string; result?: { list?: Array<{ lastPrice?: string }> } };
      const p = Number(j.price ?? j.result?.list?.[0]?.lastPrice);
      if (Number.isFinite(p) && p > 0) return p;
    } catch {
      /* se prueba con el siguiente proveedor */
    }
  }
  return null;
}

async function isBeta(userId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("bot_beta").eq("id", userId).maybeSingle();
  return (data as { bot_beta?: boolean } | null)?.bot_beta === true;
}

async function loadLive(userId: string): Promise<Live | null> {
  const { data } = await admin.from("bot_live").select(LIVE_COLUMNS).eq("user_id", userId).maybeSingle();
  return (data as Live | null) ?? null;
}

async function loadKey(userId: string, exchange: LiveExchangeId): Promise<{ key: string; secret: string; hint: string } | null> {
  const master = Deno.env.get("EXCHANGE_ENC_KEY");
  if (!master || master.length < 16) return null;
  const { data } = await admin.from("trade_keys").select("api_key, secret_enc, key_hint").eq("user_id", userId).eq("exchange", exchange).maybeSingle();
  if (!data) return null;
  try {
    return { key: data.api_key, secret: await decryptSecret(data.secret_enc, master), hint: data.key_hint };
  } catch {
    return null;
  }
}

interface OrderLog {
  user_id: string;
  exchange?: LiveExchangeId;
  trade_id?: string | null;
  symbol: string;
  side: string;
  qty?: number | null;
  leverage?: number | null;
  kind: "bot" | "test" | "panic";
  dry_run: boolean;
  status: "dry_run" | "sent" | "rejected" | "skipped" | "error";
  note?: string;
  request?: unknown;
  response?: unknown;
}
const logOrder = async (o: OrderLog) => {
  const { error } = await admin.from("live_orders").insert({ ...o, trade_id: o.trade_id ?? null, exchange: o.exchange ?? "bitunix" });
  if (error) console.error("live_orders:", error.message);
};

async function pushTo(userId: string, title: string, body: string) {
  try {
    const { data: tokens } = await admin.from("device_tokens").select("expo_push_token").eq("user_id", userId);
    if (tokens?.length) await sendExpoPush(tokens.map((t: { expo_push_token: string }) => ({ to: t.expo_push_token, title, body })));
  } catch {
    /* el aviso es un extra */
  }
}

/** Cuenta un error seguido; con MAX_ERRORS se apaga el bot real y se avisa. */
async function recordFailure(userId: string, live: Live, message: string) {
  const errors = (live.errors ?? 0) + 1;
  const off = errors >= MAX_ERRORS;
  await admin.from("bot_live").update({ errors, last_error: message.slice(0, 300), ...(off ? { enabled: false } : {}) }).eq("user_id", userId);
  await pushTo(userId, off ? "⛔ Bot real apagado" : "⚠️ Orden real con problemas", off ? `Se apagó solo tras ${MAX_ERRORS} errores seguidos: ${message}` : message);
}

// ─── Orden del bot (la llama la función del bot con el secreto compartido) ───

async function execute(userId: string, tradeId: string) {
  const live = await loadLive(userId);
  if (!live?.enabled || !(await isBeta(userId))) return { status: "off" };
  const ex = liveEx(live.exchange);
  const { data: trade } = await admin.from("trades").select("id, symbol, direction, entry, sl, tp").eq("id", tradeId).eq("user_id", userId).eq("source", "bot").eq("outcome", "ABIERTA").maybeSingle();
  if (!trade) return { status: "skipped", note: "La operación ya no está abierta." };
  const { data: done } = await admin.from("live_orders").select("id").eq("trade_id", tradeId).eq("kind", "bot").in("status", ["sent", "dry_run"]).limit(1);
  if (done?.length) return { status: "skipped", note: "Ya se procesó." };

  const sig: BxSignal = { symbol: trade.symbol, direction: trade.direction, entry: Number(trade.entry), sl: Number(trade.sl), tp: Number(trade.tp) };
  const base = { user_id: userId, exchange: ex.id, trade_id: tradeId, symbol: sig.symbol, side: sig.direction === "LONG" ? "BUY" : "SELL", kind: "bot" as const, dry_run: live.dry_run };
  const skip = async (note: string) => {
    await logOrder({ ...base, status: "skipped", note });
    return { status: "skipped", note };
  };

  // Tope diario: la pérdida máxima posible del día (órdenes enviadas × riesgo de cada una) no puede pasar el límite.
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count: sentToday } = await admin.from("live_orders").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "bot").eq("status", "sent").gte("created_at", dayAgo);
  if (((sentToday ?? 0) + 1) * Number(live.risk_usdt) > Number(live.daily_loss_usdt) + 1e-9) return skip("Tope diario alcanzado: por hoy no se envían más órdenes reales.");

  const creds = await loadKey(userId, ex.id);
  if (!creds) return skip("Falta la clave con permiso de operar.");
  const price = await livePrice(sig.symbol);
  if (price == null) return skip("No se pudo leer el precio actual.");
  const pair = await ex.pair(fetch, creds.key, creds.secret, sig.symbol);
  if (!pair) return skip(`No se pudieron leer las reglas del par en ${ex.name}: no se opera.`);
  const plan = planOrder(sig, price, pair, cfgOf(live));
  if (!plan.ok) return skip(plan.reason);

  const body = ex.order(sig, plan.qty, `vx${tradeId.replace(/-/g, "").slice(0, 16)}`, pair, plan.leverage);
  const summary = `${sig.symbol} ${base.side} ${plan.qty} · x${plan.leverage} · margen ${plan.margin.toFixed(2)} · riesgo ${plan.risk.toFixed(3)} USDT`;
  if (live.dry_run) {
    await logOrder({ ...base, qty: plan.qty, leverage: plan.leverage, status: "dry_run", note: `En seco: ${summary}`, request: body });
    await pushTo(userId, `🧪 En seco · ${sig.symbol}`, `Habría enviado: ${summary}`);
    return { status: "dry_run", plan, body };
  }

  // Envío real: antes, una mirada a la cuenta (saldo y posiciones abiertas).
  const bal = await ex.balance(fetch, creds.key, creds.secret);
  if (!bal.ok) {
    await logOrder({ ...base, qty: plan.qty, leverage: plan.leverage, status: "error", note: `No se pudo leer el saldo: ${bal.msg || bal.code}` });
    await recordFailure(userId, live, `No se pudo leer el saldo de ${ex.name}: ${bal.msg || bal.code}`);
    return { status: "error" };
  }
  if (bal.available < plan.margin * 1.05) return skip(`Saldo insuficiente (${bal.available.toFixed(2)} USDT disponibles).`);
  const open = await ex.positions(fetch, creds.key, creds.secret);
  if (open == null) {
    await recordFailure(userId, live, `No se pudieron leer las posiciones abiertas de ${ex.name}.`);
    return skip("No se pudieron leer las posiciones abiertas: por seguridad no se opera.");
  }
  if (open.length >= Number(live.max_open)) return skip(`Ya hay ${open.length} posición(es) abierta(s) (máximo ${live.max_open}).`);

  const warnings = await ex.setup(fetch, creds.key, creds.secret, sig.symbol, plan.leverage);
  const r = await ex.place(fetch, creds.key, creds.secret, body);
  if (!r.ok) {
    await logOrder({ ...base, qty: plan.qty, leverage: plan.leverage, status: "rejected", note: `${ex.name} rechazó la orden: ${r.msg || r.code}`, request: body, response: { code: r.code, msg: r.msg } });
    await recordFailure(userId, live, `${ex.name} rechazó la orden de ${sig.symbol}: ${r.msg || r.code}`);
    return { status: "rejected", msg: r.msg };
  }
  await logOrder({ ...base, qty: plan.qty, leverage: plan.leverage, status: "sent", note: [summary, ...warnings].join(" · "), request: body, response: r.data });
  await admin.from("bot_live").update({ errors: 0, last_error: null }).eq("user_id", userId);
  await pushTo(userId, `🟢 Orden real enviada · ${sig.symbol}`, summary);
  return { status: "sent", plan };
}

// ─── Orden de prueba (mínima, confirmada a mano) ─────────────────────────────

async function testOrder(userId: string, confirm: boolean) {
  const live = await loadLive(userId);
  const ex = liveEx(live?.exchange);
  if (!live) return { ok: false, error: `Primero conectá la clave de ${ex.name}.` };
  const creds = await loadKey(userId, ex.id);
  if (!creds) return { ok: false, error: `Primero conectá la clave de ${ex.name}.` };
  const steps: string[] = [];
  const bal = await ex.balance(fetch, creds.key, creds.secret);
  steps.push(bal.ok ? `Saldo de futuros leído: ${bal.available.toFixed(2)} USDT.` : `⚠️ No se pudo leer el saldo: ${bal.msg || bal.code}.`);
  const price = await livePrice("BTCUSDT");
  const pair = await ex.pair(fetch, creds.key, creds.secret, "BTCUSDT");
  steps.push(pair ? `Reglas de BTCUSDT leídas: mínimo ${pair.minQty}, ${pair.qtyDecimals} decimales.` : "⚠️ No se pudieron leer las reglas del par BTCUSDT.");
  if (!bal.ok || price == null || !pair) return { ok: false, steps, error: "No se pudo preparar la prueba. Revisá los avisos." };
  // Señal de prueba con stop y objetivo a ±1 % del precio (si con eso no entra en tus topes, a ±0,5 %); el tamaño sale de tus topes.
  let sig: BxSignal = { symbol: "BTCUSDT", direction: "LONG", entry: price, sl: price * 0.99, tp: price * 1.01 };
  let plan = planOrder(sig, price, pair, cfgOf(live));
  if (!plan.ok) {
    sig = { ...sig, sl: price * 0.995, tp: price * 1.005 };
    plan = planOrder(sig, price, pair, cfgOf(live));
  }
  if (!plan.ok) return { ok: false, steps, error: `Con tus topes no entra una orden de prueba: ${plan.reason}` };
  if (bal.available < plan.margin * 1.05) return { ok: false, steps, error: `Saldo insuficiente para la prueba (hacen falta unos ${plan.margin.toFixed(2)} USDT de margen).` };
  const body = ex.order(sig, plan.qty, `vxtest${Date.now()}`, pair, plan.leverage);
  steps.push(`Orden armada: comprar ${plan.qty} BTC (≈ ${plan.notional.toFixed(2)} USDT) con apalancamiento x${plan.leverage}, margen ${plan.margin.toFixed(2)} USDT, stop y objetivo pegados al precio. Riesgo: ${plan.risk.toFixed(3)} USDT.`);
  const base = { user_id: userId, exchange: ex.id, symbol: "BTCUSDT", side: "BUY", qty: plan.qty, leverage: plan.leverage, kind: "test" as const };

  if (!confirm) {
    await logOrder({ ...base, dry_run: true, status: "dry_run", note: "Vista previa de la orden de prueba.", request: body });
    return { ok: true, preview: true, steps, request: body };
  }

  const warnings = await ex.setup(fetch, creds.key, creds.secret, "BTCUSDT", plan.leverage);
  if (warnings.length) steps.push(`⚠️ ${warnings.join("; ")}`);
  const placed = await ex.place(fetch, creds.key, creds.secret, body);
  if (!placed.ok) {
    await logOrder({ ...base, dry_run: false, status: "rejected", note: `${ex.name} rechazó la orden de prueba: ${placed.msg || placed.code}`, request: body, response: { code: placed.code, msg: placed.msg } });
    steps.push(`❌ ${ex.name} rechazó la orden: ${placed.msg || placed.code}.`);
    return { ok: false, steps, error: "La orden de prueba no salió. No se habilitó nada." };
  }
  steps.push(`✅ ${ex.name} aceptó la orden de prueba.`);
  await new Promise((r) => setTimeout(r, 2500));
  const pos = await ex.positions(fetch, creds.key, creds.secret);
  const mine = pos?.find((p) => p.symbol === "BTCUSDT");
  steps.push(mine ? `✅ La posición aparece abierta (${mine.qty} BTC).` : "⚠️ No se encontró la posición abierta (puede haberse cerrado sola o no leerse).");
  let closed = false;
  if (mine) {
    const c = await ex.close(fetch, creds.key, creds.secret, mine);
    await new Promise((r) => setTimeout(r, 2000));
    const after = await ex.positions(fetch, creds.key, creds.secret);
    closed = c.ok && !!after && !after.some((p) => p.symbol === "BTCUSDT");
    steps.push(closed ? "✅ La posición se cerró." : `❌ No se pudo confirmar el cierre (${c.msg || c.code}). CERRALA A MANO en ${ex.name} ahora.`);
  }
  await logOrder({ ...base, dry_run: false, status: "sent", note: steps.join(" | "), request: body, response: placed.data });
  const verified = placed.ok && !!mine && closed;
  if (verified) {
    await admin.from("bot_live").update({ verified: true, errors: 0, last_error: null }).eq("user_id", userId);
    // La prueba queda guardada junto a la clave de ese exchange: al volver a él no hay que repetirla.
    await admin.from("trade_keys").update({ verified: true }).eq("user_id", userId).eq("exchange", ex.id);
  }
  return { ok: verified, verified, steps, error: verified ? undefined : "La prueba no salió completa: el modo automático sigue sin habilitarse." };
}

// ─── Apagado total ───────────────────────────────────────────────────────────

async function panic(userId: string) {
  // Lo primero y lo más importante: que no se abra nada nuevo.
  await admin.from("bot_live").update({ enabled: false, dry_run: true }).eq("user_id", userId);
  const steps = ["⛔ El bot real quedó apagado."];
  const ex = liveEx((await loadLive(userId))?.exchange);
  const creds = await loadKey(userId, ex.id);
  if (!creds) return { ok: true, steps: [...steps, "No hay clave guardada: no hay nada más que cerrar desde acá."] };
  const c = await ex.cancelAll(fetch, creds.key, creds.secret);
  steps.push(c.ok ? "Órdenes pendientes canceladas." : `⚠️ No se pudieron cancelar las órdenes pendientes (${c.msg || c.code}).`);
  const pos = await ex.positions(fetch, creds.key, creds.secret);
  if (pos == null) steps.push(`⚠️ No se pudieron leer las posiciones: revisalas a mano en ${ex.name}.`);
  else if (!pos.length) steps.push("No hay posiciones abiertas.");
  let failed = pos == null;
  for (const p of pos ?? []) {
    const r = await ex.close(fetch, creds.key, creds.secret, p);
    if (!r.ok) failed = true;
    steps.push(r.ok ? `✅ Cerrada ${p.symbol}.` : `❌ No se pudo cerrar ${p.symbol} (${r.msg || r.code}): cerrala a mano en ${ex.name}.`);
  }
  await logOrder({ user_id: userId, exchange: ex.id, symbol: "-", side: "-", kind: "panic", dry_run: false, status: failed ? "error" : "sent", note: steps.join(" | ") });
  return { ok: !failed, steps };
}

// ─── Entrada ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Pedido no válido." }, 400);
  }

  // La función del bot (con el secreto compartido) solo puede pedir «execute».
  const cronGiven = req.headers.get("x-cron-secret");
  if (cronGiven !== null) {
    // La función del bot usa BOT_CRON_SECRET (o, si no existe, EXCHANGE_CRON_SECRET).
    const secrets = [Deno.env.get("BOT_CRON_SECRET"), Deno.env.get("EXCHANGE_CRON_SECRET")].filter((x): x is string => !!x && x.length >= 16);
    if (!secrets.some((x) => same(cronGiven, x))) return json({ ok: false, error: "No autorizado." }, 401);
    if (body.action !== "execute" || typeof body.userId !== "string" || typeof body.tradeId !== "string") return json({ ok: false, error: "Pedido no válido." }, 400);
    try {
      return json({ ok: true, ...(await execute(body.userId, body.tradeId)) });
    } catch (e) {
      console.error("execute:", e instanceof Error ? e.message : e);
      return json({ ok: false, error: "Error al preparar la orden." }, 500);
    }
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ ok: false, error: "Sesión no válida. Volvé a ingresar." }, 401);
  if (!(await isBeta(user.id))) return json({ ok: false, error: "El bot con dinero real todavía no está disponible para tu cuenta." }, 403);

  const master = Deno.env.get("EXCHANGE_ENC_KEY");
  const needMfa = () => json({ ok: false, code: "mfa_required", error: "Confirmá con el código de Google Authenticator para hacer este cambio." }, 403);

  try {
    switch (body.action) {
      case "status": {
        const { data: ks } = await admin.from("trade_keys").select("exchange, key_hint").eq("user_id", user.id);
        const keys: Record<string, string> = {};
        for (const k of (ks ?? []) as Array<{ exchange: string; key_hint: string }>) keys[k.exchange] = k.key_hint;
        const live = await loadLive(user.id);
        const cur = liveEx(live?.exchange).id;
        return json({ ok: true, exchanges: LIVE_EXCHANGES, exchange: cur, keys, hasKey: cur in keys, keyHint: keys[cur] ?? null, live });
      }
      case "connect_key": {
        if (body.exchange !== undefined && !isLiveExchange(body.exchange)) return json({ ok: false, error: "Ese exchange todavía no está disponible para el bot real." }, 400);
        const ex = liveEx(body.exchange);
        if (!master || master.length < 16) return json({ ok: false, code: "not_configured", error: "Falta EXCHANGE_ENC_KEY en el servidor." }, 500);
        if (!(await stepOk(user.id, token))) return needMfa();
        const apiKey = String(body.apiKey ?? "").trim();
        const apiSecretOnly = String(body.apiSecret ?? "").trim();
        const apiPass = String(body.apiPassphrase ?? "").trim();
        if (LIVE_NEEDS_PASS.includes(ex.id) && (apiPass.length < 1 || apiPass.length > 200 || apiPass.includes(LV_PASS_SEP))) return json({ ok: false, error: `${ex.name} pide también la contraseña de la API (la que elegiste al crear la clave).` }, 400);
        const apiSecret = LIVE_NEEDS_PASS.includes(ex.id) ? apiSecretOnly + LV_PASS_SEP + apiPass : apiSecretOnly;
        if (apiKey.length < 8 || apiKey.length > 200 || apiSecretOnly.length < 8 || apiSecretOnly.length > 400) return json({ ok: false, error: "Revisá la clave y la clave secreta: parecen incompletas." }, 400);
        const bal = await ex.balance(fetch, apiKey, apiSecret);
        if (!bal.ok) return json({ ok: false, error: `${ex.name} no aceptó la clave (${bal.msg || (bal.code ?? "sin respuesta")}). Revisá que tenga permiso de futuros y de operar, y que esté bien copiada.` }, 400);
        const { error } = await admin.from("trade_keys").upsert({ user_id: user.id, exchange: ex.id, key_hint: apiKey.slice(-4), api_key: apiKey, secret_enc: await encryptSecret(apiSecret, master), verified: false }, { onConflict: "user_id,exchange" });
        if (error) return json({ ok: false, error: "No se pudo guardar la clave." }, 500);
        // Una clave nueva siempre empieza apagada, en seco y sin verificar.
        const { error: lerr } = await admin.from("bot_live").upsert({ user_id: user.id, exchange: ex.id, enabled: false, dry_run: true, verified: false, errors: 0, last_error: null }, { onConflict: "user_id" });
        if (lerr) return json({ ok: false, error: "No se pudo preparar el bot real." }, 500);
        return json({ ok: true, available: bal.available, keyHint: apiKey.slice(-4), exchange: ex.id });
      }
      case "use_exchange": {
        // Cambiar a un exchange que ya tiene clave guardada: queda apagado y en seco; la prueba mínima ya hecha en ese exchange se conserva.
        if (!isLiveExchange(body.exchange)) return json({ ok: false, error: "Ese exchange todavía no está disponible para el bot real." }, 400);
        const { data: k } = await admin.from("trade_keys").select("key_hint, verified").eq("user_id", user.id).eq("exchange", body.exchange).maybeSingle();
        if (!k) return json({ ok: false, error: "Primero conectá la clave de ese exchange." }, 400);
        const { error } = await admin.from("bot_live").upsert({ user_id: user.id, exchange: body.exchange, enabled: false, dry_run: true, verified: !!(k as { verified?: boolean }).verified, errors: 0, last_error: null }, { onConflict: "user_id" });
        if (error) return json({ ok: false, error: "No se pudo cambiar de exchange." }, 500);
        return json({ ok: true, exchange: body.exchange, verified: !!(k as { verified?: boolean }).verified });
      }
      case "disconnect_key": {
        if (body.exchange !== undefined && !isLiveExchange(body.exchange)) return json({ ok: false, error: "Ese exchange todavía no está disponible para el bot real." }, 400);
        if (!(await stepOk(user.id, token))) return needMfa();
        const live = await loadLive(user.id);
        const target = liveEx(body.exchange ?? live?.exchange).id;
        // Solo se apaga el bot si la clave que se borra es la del exchange activo.
        if (liveEx(live?.exchange).id === target) await admin.from("bot_live").update({ enabled: false, dry_run: true, verified: false }).eq("user_id", user.id);
        await admin.from("trade_keys").delete().eq("user_id", user.id).eq("exchange", target);
        return json({ ok: true });
      }
      case "test_order": {
        const confirm = body.confirm === true;
        if (confirm && !(await stepOk(user.id, token))) return needMfa();
        return json(await testOrder(user.id, confirm));
      }
      case "panic":
        return json(await panic(user.id));
      default:
        return json({ ok: false, error: "Acción desconocida." }, 400);
    }
  } catch (e) {
    console.error("trade:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Algo salió mal. Probá de nuevo en un momento." }, 500);
  }
});

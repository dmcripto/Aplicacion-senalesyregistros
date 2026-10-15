// Conexión de solo lectura con exchanges (Binance, Bybit, Bitunix, MEXC, Gate, Bitget, OKX, KuCoin, BingX).
//
//   POST /functions/v1/exchanges   (con la sesión del usuario en Authorization)
//   { "action": "connect", "exchange": "binance" | "bybit" | "bitunix" | "mexc" | "gate" | "bitget" | "okx" | "kucoin" | "bingx", "apiKey": "...", "apiSecret": "...", "passphrase": "..." }
//     (la contraseña de la API, passphrase, solo la piden Bitget, OKX y KuCoin)
//   { "action": "sync" }
//
// Sincronización en segundo plano: pg_cron llama cada 10 minutos con el encabezado x-cron-secret
// (secreto EXCHANGE_CRON_SECRET) y se actualizan solas las conexiones que toca revisar.
//
// La clave secreta se guarda cifrada (AES-GCM) con el secreto EXCHANGE_ENC_KEY de la función.
// Solo se hacen pedidos GET de lectura: nunca se opera ni se mueven fondos.

import { createClient } from "npm:@supabase/supabase-js@2";
import { EXCHANGES, NEEDS_PASSPHRASE, ExchangeError, checkKey, decryptSecret, encryptSecret, fetchClosed, fetchOpen, toOpenTradeRow, toTradeRow } from "../_shared/exchanges.ts";
import type { ExchangeId, OpenPosition } from "../_shared/exchanges.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ONE_DAY = 86_400_000;
const MIN_GAP_MS = 30_000; // no sincronizar la misma conexión más de una vez cada 30 s
const AUTO_EVERY_MS = 9 * 60_000; // en segundo plano, cada conexión se revisa cada ~10 minutos
const AUTO_RETRY_ERROR_MS = 6 * 3_600_000; // una conexión con error se reintenta cada 6 horas
const AUTO_BATCH = 30; // conexiones por corrida
const AUTO_BUDGET_MS = 100_000; // tiempo máximo por corrida (la función corta a los ~150 s)
const AUTO_PARALLEL = 3;

interface Connection {
  id: string;
  user_id: string;
  exchange: ExchangeId;
  last_sync_at: string | null;
  last_attempt_at?: string | null;
  status?: string;
}

async function unitOf(userId: string): Promise<number | null> {
  const { data } = await admin.from("profiles").select("capital, risk_pct").eq("id", userId).maybeSingle();
  const capital = Number(data?.capital), risk = Number(data?.risk_pct);
  return capital > 0 && risk > 0 ? (capital * risk) / 100 : null;
}

/** Trae las operaciones cerradas del exchange y las guarda en el diario (sin duplicar). */
const BOT_REAL_TAG = "Bot real";
const BOT_REAL_WINDOW = 15 * 60_000;

/**
 * Qué posiciones abrió el bot con dinero real (y no vos a mano): coinciden con una orden «enviada» del bot en las «Últimas órdenes»
 * (mismo exchange, par y lado, con la hora a menos de 15 minutos de la apertura). Sin la tabla, o sin órdenes, devuelve vacío.
 */
async function botRealIds(userId: string, exchange: string, list: Array<{ externalId: string; symbol: string; direction: string; openedAtMs: number }>): Promise<Set<string>> {
  const out = new Set<string>();
  if (!list.length) return out;
  try {
    const { data } = await admin.from("live_orders").select("symbol, side, created_at").eq("user_id", userId).eq("exchange", exchange).eq("kind", "bot").eq("status", "sent").gte("created_at", new Date(Date.now() - 40 * 86_400_000).toISOString()).limit(500);
    const orders = ((data ?? []) as Array<{ symbol: string; side: string; created_at: string }>).map((o) => ({ symbol: String(o.symbol).toUpperCase(), long: String(o.side).toUpperCase() === "BUY", at: new Date(o.created_at).getTime() }));
    for (const p of list) {
      const long = p.direction === "LONG";
      if (orders.some((o) => o.symbol === p.symbol.toUpperCase() && o.long === long && Math.abs(o.at - p.openedAtMs) <= BOT_REAL_WINDOW)) out.add(p.externalId);
    }
  } catch {
    /* sin la tabla: no se marca nada */
  }
  return out;
}

async function syncOne(conn: Connection, master: string, unit: number): Promise<{ imported: number; warning?: string; open?: number }> {
  const { data: secret } = await admin.from("exchange_secrets").select("api_key, secret_enc, passphrase_enc").eq("connection_id", conn.id).maybeSingle();
  if (!secret) throw new ExchangeError("Falta la clave de esta conexión. Desconectala y volvé a conectarla.");
  const apiSecret = await decryptSecret(secret.secret_enc, master);
  const passphrase = secret.passphrase_enc ? await decryptSecret(secret.passphrase_enc, master) : undefined;

  const now = Date.now();
  // Primera vez: 14 días. Después: desde la última sincronización con un día de margen (lo repetido no se duplica).
  const since = conn.last_sync_at ? Math.max(new Date(conn.last_sync_at).getTime() - ONE_DAY, now - 30 * ONE_DAY) : now - 14 * ONE_DAY;
  const closed = await fetchClosed(conn.exchange, secret.api_key, apiSecret, since, now, undefined, passphrase);

  // Posiciones abiertas ahora (Bitunix, Binance y Bybit). Se leen antes para saber cuáles de las que el diario tiene como abiertas ya cerraron.
  let openList: OpenPosition[] = [];
  let openError: unknown = null;
  try {
    openList = await fetchOpen(conn.exchange, secret.api_key, apiSecret, undefined, passphrase);
  } catch (e) {
    openError = e;
  }

  // Cuáles abrió el bot con dinero real: se marcan con la etiqueta «Bot real» (y se dice en la nota).
  const botIds = await botRealIds(conn.user_id, conn.exchange, [...closed, ...openList].map((p) => ({ externalId: p.externalId, symbol: p.symbol, direction: p.direction, openedAtMs: Number(p.openedAt) })));
  const botMark = <T extends { notes: string }>(r: T, id: string): T & { tags?: string[] } => (botIds.has(id) ? { ...r, notes: `🤖 ${BOT_REAL_TAG} · ${r.notes}`, tags: [BOT_REAL_TAG] } : r);

  // Las posiciones que se importaron como abiertas y ya cerraron se completan con el resultado real (sin duplicar).
  try {
    // Si el exchange cambió el id al cerrar, se reconoce la misma operación por par, lado y precio de entrada.
    if (!openError && closed.length) {
      const live = new Set(openList.map((o) => o.externalId));
      const { data: staleRows } = await admin.from("trades").select("id, symbol, direction, entry, external_id").eq("user_id", conn.user_id).eq("source", conn.exchange).eq("outcome", "ABIERTA").like("notes", "%posición abierta%").limit(200);
      const taken = new Set<string>();
      for (const r of (staleRows ?? []) as Array<{ id: string; symbol: string; direction: string; entry: number; external_id: string }>) {
        if (live.has(r.external_id) || closed.some((c) => c.externalId === r.external_id) || String(r.external_id).startsWith("open:")) continue;
        const m = closed.find((c) => !taken.has(c.externalId) && c.symbol.toUpperCase() === r.symbol && c.direction === r.direction && Math.abs(c.entry - Number(r.entry)) / Number(r.entry) < 0.002);
        if (!m) continue;
        taken.add(m.externalId);
        await admin.from("trades").update({ external_id: m.externalId }).eq("id", r.id);
      }
    }
    const { data: openRows } = await admin.from("trades").select("external_id").eq("user_id", conn.user_id).eq("source", conn.exchange).eq("outcome", "ABIERTA").in("external_id", closed.map((c) => c.externalId)).limit(500);
    const wasOpen = new Set((openRows ?? []).map((r: { external_id: string }) => r.external_id));
    for (const p of closed.filter((c) => wasOpen.has(c.externalId))) {
      const row = botMark(toTradeRow(p, conn.exchange, unit), p.externalId);
      await admin.from("trades").update({ tp: row.tp, sl: row.sl, outcome: "MANUAL", exit: row.exit, closed_at: row.closed_at, notes: row.notes, ...(row.tags ? { tags: row.tags } : {}) }).eq("user_id", conn.user_id).eq("source", conn.exchange).eq("external_id", p.externalId).eq("outcome", "ABIERTA");
    }
  } catch (e) {
    console.error("cerrar abiertas:", e instanceof Error ? e.message : e);
  }

  const { data: ignoredRows } = await admin.from("exchange_ignored").select("external_id").eq("user_id", conn.user_id).eq("source", conn.exchange);
  const ignored = new Set((ignoredRows ?? []).map((r: { external_id: string }) => r.external_id));
  const seen = new Set<string>();
  const rows = closed
    .filter((p) => !ignored.has(p.externalId) && !seen.has(p.externalId) && !!seen.add(p.externalId))
    .map((p) => ({ ...botMark(toTradeRow(p, conn.exchange, unit), p.externalId), user_id: conn.user_id }));

  // Las columnas de apalancamiento y tamaño pueden no existir todavía (falta correr el SQL): entonces se importa igual, sin ellas.
  const withoutManagement = <T extends Record<string, unknown>>(r: T) => {
    const { leverage: _l, size_usd: _s, ...rest } = r as Record<string, unknown>;
    return rest;
  };
  let withManagement = true;
  let imported = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    let { data, error } = await admin.from("trades").upsert(withManagement ? chunk : chunk.map(withoutManagement), { onConflict: "user_id,source,external_id", ignoreDuplicates: true }).select("id");
    if (error && withManagement && /leverage|size_usd/i.test(error.message)) {
      withManagement = false;
      ({ data, error } = await admin.from("trades").upsert(chunk.map(withoutManagement), { onConflict: "user_id,source,external_id", ignoreDuplicates: true }).select("id"));
    }
    if (error) throw new Error(error.message);
    imported += data?.length ?? 0;
  }
  // Las operaciones que ya estaban importadas (de antes de existir estos datos) se completan con lo que informa el exchange.
  if (withManagement && rows.length) {
    try {
      const { data: missing } = await admin.from("trades").select("external_id").eq("user_id", conn.user_id).eq("source", conn.exchange).is("size_usd", null).in("external_id", rows.map((r) => r.external_id)).limit(500);
      const need = new Set((missing ?? []).map((m: { external_id: string }) => m.external_id));
      for (const r of rows.filter((x) => need.has(x.external_id))) {
        await admin.from("trades").update({ leverage: r.leverage, size_usd: r.size_usd }).eq("user_id", conn.user_id).eq("source", conn.exchange).eq("external_id", r.external_id).is("size_usd", null);
      }
    } catch (e) {
      console.error("completar apalancamiento:", e instanceof Error ? e.message : e);
    }
  }
  // Posiciones abiertas ahora (solo Bitunix): aparecen en el diario mientras siguen abiertas. Si falla, no afecta lo demás.
  let warning: string | undefined;
  let openCount: number | undefined;
  try {
    if (openError) throw openError;
    const open = openList;
    openCount = open.length;
    const openRows = open.filter((p) => !ignored.has(p.externalId)).map((p) => ({ ...botMark(toOpenTradeRow(p, conn.exchange, unit), p.externalId), user_id: conn.user_id }));
    // Las provisorias («open:…») que ya no están abiertas se borran: al cerrarse se importó la operación real.
    if (conn.exchange !== "bitunix") {
      const { data: stale } = await admin.from("trades").select("id, external_id").eq("user_id", conn.user_id).eq("source", conn.exchange).eq("outcome", "ABIERTA").like("external_id", "open:%");
      const live = new Set(openRows.map((r) => r.external_id));
      const gone = (stale ?? []).filter((r: { external_id: string }) => !live.has(r.external_id)).map((r: { id: string }) => r.id);
      if (gone.length) await admin.from("trades").delete().in("id", gone);
    }
    if (openRows.length) {
      let { error } = await admin.from("trades").upsert(openRows, { onConflict: "user_id,source,external_id", ignoreDuplicates: true });
      if (error && /leverage|size_usd/i.test(error.message)) ({ error } = await admin.from("trades").upsert(openRows.map(withoutManagement), { onConflict: "user_id,source,external_id", ignoreDuplicates: true }));
      if (error) {
        console.error("abiertas:", error.message);
        warning = `No se pudieron guardar las posiciones abiertas: ${error.message}`;
      }
      // Si cambiaste el TP o el SL en el exchange, el diario se actualiza.
      for (const r of openRows) {
        await admin.from("trades").update({ tp: r.tp, sl: r.sl, notes: r.notes, ...(r.tags ? { tags: r.tags } : {}) }).eq("user_id", conn.user_id).eq("source", conn.exchange).eq("external_id", r.external_id).eq("outcome", "ABIERTA");
      }
    }
  } catch (e) {
    console.error("abiertas:", e instanceof Error ? e.message : e);
    warning = `No se pudieron leer las posiciones abiertas: ${e instanceof Error ? e.message : "error desconocido"}`;
  }
  return { imported, warning, open: openCount };
}

/** Anota el resultado del intento. Si la columna last_attempt_at todavía no existe, guarda igual lo demás. */
async function markConnection(id: string, fields: Record<string, unknown>) {
  const { error } = await admin.from("exchange_connections").update({ ...fields, last_attempt_at: new Date().toISOString() }).eq("id", id);
  if (error) await admin.from("exchange_connections").update(fields).eq("id", id);
}

async function runSync(conn: Connection, master: string, unit: number) {
  try {
    const { imported, warning, open } = await syncOne(conn, master, unit);
    await markConnection(conn.id, { status: "active", last_error: null, last_sync_at: new Date().toISOString(), last_import_count: imported });
    return { exchange: conn.exchange, imported, open, warning };
  } catch (e) {
    const message = e instanceof ExchangeError ? e.message : "No se pudo sincronizar. Probá de nuevo en unos minutos.";
    await markConnection(conn.id, { status: "error", last_error: message });
    return { exchange: conn.exchange, imported: 0, error: message };
  }
}

/** Compara dos textos sin dar pistas por el tiempo que tarda. */
/** Marcas de la sesión (la firma ya la verificó auth.getUser): acá solo se leen las del 2FA. */
function claimsOf(token: string): Record<string, unknown> {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return {};
  }
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Corrida de segundo plano: sincroniza las conexiones que ya les toca, las más atrasadas primero. */
async function syncAll(master: string) {
  const started = Date.now();
  const { data, error } = await admin
    .from("exchange_connections")
    .select("id, user_id, exchange, last_sync_at, last_attempt_at, status")
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(500);
  if (error) return { ok: false, error: error.message };

  const due = ((data ?? []) as Connection[])
    .filter((c) => {
      const last = new Date(c.last_attempt_at ?? c.last_sync_at ?? 0).getTime();
      return started - last >= (c.status === "error" ? AUTO_RETRY_ERROR_MS : AUTO_EVERY_MS);
    })
    .slice(0, AUTO_BATCH);

  const units = new Map<string, number | null>();
  let imported = 0, failed = 0, done = 0;
  for (let i = 0; i < due.length && Date.now() - started < AUTO_BUDGET_MS; i += AUTO_PARALLEL) {
    await Promise.all(
      due.slice(i, i + AUTO_PARALLEL).map(async (conn) => {
        if (!units.has(conn.user_id)) units.set(conn.user_id, await unitOf(conn.user_id));
        const unit = units.get(conn.user_id);
        if (unit == null) return; // sin capital ni % de riesgo no se puede convertir a R
        const r = await runSync(conn, master, unit);
        done++;
        imported += r.imported;
        if (r.error) failed++;
      }),
    );
  }
  return { ok: true, due: due.length, synced: done, imported, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Corrida de segundo plano (pg_cron): se identifica con el secreto compartido, no con una sesión.
  const cronGiven = req.headers.get("x-cron-secret");
  if (cronGiven !== null) {
    const cronSecret = Deno.env.get("EXCHANGE_CRON_SECRET");
    if (!cronSecret || cronSecret.length < 16 || !sameSecret(cronGiven, cronSecret)) return json({ ok: false, error: "No autorizado." }, 401);
    const key = Deno.env.get("EXCHANGE_ENC_KEY");
    if (!key || key.length < 16) return json({ ok: false, code: "not_configured", error: "Falta EXCHANGE_ENC_KEY." }, 500);
    return json(await syncAll(key));
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ ok: false, error: "Sesión no válida. Volvé a ingresar." }, 401);

  const master = Deno.env.get("EXCHANGE_ENC_KEY");
  if (!master || master.length < 16) {
    return json({ ok: false, code: "not_configured", error: "La conexión con exchanges todavía no está configurada en el servidor." }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Pedido no válido." }, 400);
  }

  const unit = await unitOf(user.id);

  if (body.action === "connect") {
    // 2FA opcional: quien lo activó confirma con un código reciente antes de conectar un exchange.
    const { data: stepOk, error: stepErr } = await admin.rpc("mfa_step_ok", { uid: user.id, claims: claimsOf(token) });
    if (stepErr) {
      // Si todavía no se corrió la migración del 2FA, nadie puede tenerlo activado: no se bloquea nada.
      if (!/mfa_step_ok/i.test(stepErr.message ?? "")) return json({ ok: false, error: "No se pudo verificar la sesión." }, 500);
    } else if (stepOk === false) {
      return json({ ok: false, code: "mfa_required", error: "Confirmá con el código de Google Authenticator para hacer este cambio." }, 403);
    }
    const exchange = body.exchange as ExchangeId;
    const apiKey = String(body.apiKey ?? "").trim();
    const apiSecret = String(body.apiSecret ?? "").trim();
    const passphrase = String(body.passphrase ?? "").trim();
    if (!EXCHANGES.includes(exchange)) return json({ ok: false, error: "Exchange no disponible todavía." }, 400);
    if (apiKey.length < 8 || apiKey.length > 200 || apiSecret.length < 8 || apiSecret.length > 400) {
      return json({ ok: false, error: "Revisá la clave y la clave secreta: parecen incompletas." }, 400);
    }
    if (NEEDS_PASSPHRASE.includes(exchange) && (passphrase.length < 1 || passphrase.length > 100)) {
      return json({ ok: false, error: "Este exchange pide también la contraseña de la API (passphrase): la que elegiste al crear la clave." }, 400);
    }
    if (unit == null) {
      return json({ ok: false, code: "need_money", error: "Antes cargá tu capital y el % de riesgo en \"Capital y dinero\": se usan para convertir tus resultados a R." }, 400);
    }

    const check = await checkKey(exchange, apiKey, apiSecret, undefined, NEEDS_PASSPHRASE.includes(exchange) ? passphrase : undefined);
    if (!check.ok) return json({ ok: false, error: check.error }, 400);

    const { data: conn, error } = await admin
      .from("exchange_connections")
      .upsert({ user_id: user.id, exchange, key_hint: apiKey.slice(-4), status: "active", last_error: null, last_sync_at: null }, { onConflict: "user_id,exchange" })
      .select("id, user_id, exchange, last_sync_at")
      .single();
    if (error || !conn) return json({ ok: false, error: "No se pudo guardar la conexión." }, 500);

    const { error: secretError } = await admin
      .from("exchange_secrets")
      .upsert(
        {
          connection_id: conn.id,
          api_key: apiKey,
          secret_enc: await encryptSecret(apiSecret, master),
          passphrase_enc: NEEDS_PASSPHRASE.includes(exchange) ? await encryptSecret(passphrase, master) : null,
        },
        { onConflict: "connection_id" },
      );
    if (secretError) return json({ ok: false, error: "No se pudo guardar la clave de forma segura." }, 500);

    const result = await runSync(conn as Connection, master, unit);
    return json({ ok: !result.error, warning: check.warning, imported: result.imported, error: result.error });
  }

  if (body.action === "sync") {
    if (unit == null) return json({ ok: false, code: "need_money", error: "Cargá tu capital y el % de riesgo en \"Capital y dinero\"." }, 400);
    const { data: conns } = await admin.from("exchange_connections").select("id, user_id, exchange, last_sync_at").eq("user_id", user.id);
    const results = [];
    for (const conn of (conns ?? []) as Connection[]) {
      if (conn.last_sync_at && Date.now() - new Date(conn.last_sync_at).getTime() < MIN_GAP_MS) {
        results.push({ exchange: conn.exchange, imported: 0, skipped: true });
        continue;
      }
      results.push(await runSync(conn, master, unit));
    }
    return json({ ok: true, results });
  }

  return json({ ok: false, error: "Acción desconocida." }, 400);
});

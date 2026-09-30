// Conexión de solo lectura con exchanges (Binance, Bybit).
//
//   POST /functions/v1/exchanges   (con la sesión del usuario en Authorization)
//   { "action": "connect", "exchange": "binance" | "bybit", "apiKey": "...", "apiSecret": "..." }
//   { "action": "sync" }
//
// La clave secreta se guarda cifrada (AES-GCM) con el secreto EXCHANGE_ENC_KEY de la función.
// Solo se hacen pedidos GET de lectura: nunca se opera ni se mueven fondos.

import { createClient } from "npm:@supabase/supabase-js@2";
import { EXCHANGES, ExchangeError, checkKey, decryptSecret, encryptSecret, fetchClosed, toTradeRow } from "../_shared/exchanges.ts";
import type { ExchangeId } from "../_shared/exchanges.ts";

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

interface Connection {
  id: string;
  user_id: string;
  exchange: ExchangeId;
  last_sync_at: string | null;
}

async function unitOf(userId: string): Promise<number | null> {
  const { data } = await admin.from("profiles").select("capital, risk_pct").eq("id", userId).maybeSingle();
  const capital = Number(data?.capital), risk = Number(data?.risk_pct);
  return capital > 0 && risk > 0 ? (capital * risk) / 100 : null;
}

/** Trae las operaciones cerradas del exchange y las guarda en el diario (sin duplicar). */
async function syncOne(conn: Connection, master: string, unit: number) {
  const { data: secret } = await admin.from("exchange_secrets").select("api_key, secret_enc").eq("connection_id", conn.id).maybeSingle();
  if (!secret) throw new ExchangeError("Falta la clave de esta conexión. Desconectala y volvé a conectarla.");
  const apiSecret = await decryptSecret(secret.secret_enc, master);

  const now = Date.now();
  const since = now - (conn.last_sync_at ? 7 : 14) * ONE_DAY;
  const closed = await fetchClosed(conn.exchange, secret.api_key, apiSecret, since, now);

  const { data: ignoredRows } = await admin.from("exchange_ignored").select("external_id").eq("user_id", conn.user_id).eq("source", conn.exchange);
  const ignored = new Set((ignoredRows ?? []).map((r: { external_id: string }) => r.external_id));
  const rows = closed
    .filter((p) => !ignored.has(p.externalId))
    .map((p) => ({ ...toTradeRow(p, conn.exchange, unit), user_id: conn.user_id }));

  let imported = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin
      .from("trades")
      .upsert(rows.slice(i, i + 200), { onConflict: "user_id,source,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    imported += data?.length ?? 0;
  }
  return imported;
}

async function runSync(conn: Connection, master: string, unit: number) {
  try {
    const imported = await syncOne(conn, master, unit);
    await admin
      .from("exchange_connections")
      .update({ status: "active", last_error: null, last_sync_at: new Date().toISOString(), last_import_count: imported })
      .eq("id", conn.id);
    return { exchange: conn.exchange, imported };
  } catch (e) {
    const message = e instanceof ExchangeError ? e.message : "No se pudo sincronizar. Probá de nuevo en unos minutos.";
    await admin.from("exchange_connections").update({ status: "error", last_error: message }).eq("id", conn.id);
    return { exchange: conn.exchange, imported: 0, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

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
    const exchange = body.exchange as ExchangeId;
    const apiKey = String(body.apiKey ?? "").trim();
    const apiSecret = String(body.apiSecret ?? "").trim();
    if (!EXCHANGES.includes(exchange)) return json({ ok: false, error: "Exchange no disponible todavía." }, 400);
    if (apiKey.length < 8 || apiKey.length > 200 || apiSecret.length < 8 || apiSecret.length > 400) {
      return json({ ok: false, error: "Revisá la clave y la clave secreta: parecen incompletas." }, 400);
    }
    if (unit == null) {
      return json({ ok: false, code: "need_money", error: "Antes cargá tu capital y el % de riesgo en \"Capital y dinero\": se usan para convertir tus resultados a R." }, 400);
    }

    const check = await checkKey(exchange, apiKey, apiSecret);
    if (!check.ok) return json({ ok: false, error: check.error }, 400);

    const { data: conn, error } = await admin
      .from("exchange_connections")
      .upsert({ user_id: user.id, exchange, key_hint: apiKey.slice(-4), status: "active", last_error: null, last_sync_at: null }, { onConflict: "user_id,exchange" })
      .select("id, user_id, exchange, last_sync_at")
      .single();
    if (error || !conn) return json({ ok: false, error: "No se pudo guardar la conexión." }, 500);

    const { error: secretError } = await admin
      .from("exchange_secrets")
      .upsert({ connection_id: conn.id, api_key: apiKey, secret_enc: await encryptSecret(apiSecret, master) }, { onConflict: "connection_id" });
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

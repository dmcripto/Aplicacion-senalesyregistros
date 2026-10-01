// Mapa de liquidaciones estimado a partir de datos públicos (Binance, con Bybit de respaldo).
//
//   POST /functions/v1/liquidation-map   (con la sesión del usuario)   { "coin": "BTC" }
//
// El cálculo se guarda 10 minutos por moneda: aunque entren muchos usuarios, al exchange se le pide poco.
// Si el exchange no responde, se devuelve el último cálculo guardado marcado como "stale".

import { createClient } from "npm:@supabase/supabase-js@2";
import { COINS, buildMap } from "../_shared/liquidations.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const FRESH_MS = 10 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ ok: false, error: "Sesión no válida. Volvé a ingresar." }, 401);

  let body: { coin?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* sin cuerpo */
  }
  const coin = String(body.coin ?? "BTC").toUpperCase();
  if (!COINS.includes(coin)) return json({ ok: false, error: "Moneda no disponible." }, 400);

  const { data: cached } = await admin.from("liquidation_cache").select("payload, computed_at").eq("coin", coin).maybeSingle();
  const age = cached ? Date.now() - new Date(cached.computed_at).getTime() : Infinity;
  if (cached && age < FRESH_MS) return json({ ok: true, data: cached.payload, cached: true });

  try {
    const data = await buildMap(coin);
    await admin.from("liquidation_cache").upsert({ coin, source: data.source, payload: data, computed_at: new Date().toISOString() }, { onConflict: "coin" });
    return json({ ok: true, data });
  } catch {
    if (cached) return json({ ok: true, data: cached.payload, stale: true });
    return json({ ok: false, error: "No se pudieron obtener los datos del mercado ahora. Probá de nuevo en unos minutos." }, 502);
  }
});

// Recibe el webhook de una alerta de TradingView, la guarda en `trades` y
// dispara una notificación push a los dispositivos del usuario dueño del
// token.
//
// URL: POST /functions/v1/tradingview-webhook/<webhook_token>
// Body (texto plano): DMCRIPTO|SYMBOL|DIRECCION|ENTRADA|TP|SL

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseAlertLine } from "../_shared/parseAlert.ts";
import { sendExpoPush } from "../_shared/expoPush.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookToken = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!webhookToken) {
    return new Response("Falta el token del webhook en la URL", { status: 400 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("webhook_token", webhookToken)
    .maybeSingle();

  if (profileError) {
    return new Response(`Error buscando el perfil: ${profileError.message}`, { status: 500 });
  }
  if (!profile) {
    return new Response("Token de webhook desconocido", { status: 404 });
  }

  const body = (await req.text()).trim();
  if (!body) {
    return new Response("El cuerpo de la alerta está vacío", { status: 400 });
  }

  const { value: alert, error: parseError } = parseAlertLine(body);
  if (!alert) {
    return new Response(`No se pudo interpretar la alerta: ${parseError}`, { status: 422 });
  }

  const { data: trade, error: insertError } = await supabase
    .from("trades")
    .insert({
      user_id: profile.id,
      symbol: alert.symbol,
      direction: alert.direction,
      entry: alert.entry,
      tp: alert.tp,
      sl: alert.sl,
      date: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    return new Response(`Error guardando la operación: ${insertError.message}`, { status: 500 });
  }

  const { data: tokens } = await supabase
    .from("device_tokens")
    .select("expo_push_token")
    .eq("user_id", profile.id);

  if (tokens?.length) {
    await sendExpoPush(
      tokens.map((t) => ({
        to: t.expo_push_token,
        title: `${alert.symbol} · ${alert.direction === "LONG" ? "COMPRA" : "VENTA"}`,
        body: `Entrada ${alert.entry} · TP ${alert.tp} · SL ${alert.sl}`,
        data: { tradeId: trade.id },
      })),
    );
  }

  return new Response(JSON.stringify({ ok: true, trade }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
});

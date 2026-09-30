// Recibe el webhook de una alerta de TradingView, la guarda en `trades` y
// dispara una notificación push a los dispositivos del usuario dueño del
// token.
//
// URL: POST /functions/v1/tradingview-webhook/<webhook_token>
// Body (texto plano o JSON): VELTRIX|SYMBOL|DIRECCION|ENTRADA|TP|SL
//   o {"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":66500,"sl":64500}

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseAlerts } from "../_shared/parseAlert.ts";
import { sendExpoPush } from "../_shared/expoPush.ts";
import { esc, notifyTelegram } from "../_shared/telegram.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Límites por usuario para evitar abusos y alertas duplicadas.
const MAX_BODY_BYTES = 4000;
const MAX_PER_MINUTE = 20;
const MAX_PER_DAY = 500;

const tooMany = (msg: string, retryAfter: number) =>
  new Response(msg, { status: 429, headers: { "Retry-After": String(retryAfter) } });

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookToken = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!webhookToken) {
    return new Response("Falta el token del webhook en la URL", { status: 400 });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(webhookToken)) {
    return new Response("Token de webhook desconocido", { status: 404 });
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

  const now = Date.now();
  const since = (ms: number) => new Date(now - ms).toISOString();
  const countSince = async (ms: number) => {
    const { count } = await supabase
      .from("trades")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .gte("created_at", since(ms));
    return count ?? 0;
  };
  if ((await countSince(60_000)) >= MAX_PER_MINUTE) {
    return tooMany(`Demasiadas alertas: el máximo es ${MAX_PER_MINUTE} por minuto.`, 60);
  }
  if ((await countSince(86_400_000)) >= MAX_PER_DAY) {
    return tooMany(`Límite diario alcanzado: el máximo es ${MAX_PER_DAY} alertas por día.`, 3600);
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return new Response("El cuerpo de la alerta es demasiado grande", { status: 413 });
  }
  const body = (await req.text()).trim();
  if (body.length > MAX_BODY_BYTES) {
    return new Response("El cuerpo de la alerta es demasiado grande", { status: 413 });
  }
  if (!body) {
    return new Response("El cuerpo de la alerta está vacío", { status: 400 });
  }

  const { valid, errors } = parseAlerts(body);
  const alert = valid[0];
  if (!alert) {
    return new Response(`No se pudo interpretar la alerta: ${errors.join(" · ")}`, { status: 422 });
  }

  // TradingView a veces dispara la misma alerta dos veces: se ignora si ya entró en el último minuto.
  const { data: duplicate } = await supabase
    .from("trades")
    .select("id")
    .eq("user_id", profile.id)
    .eq("symbol", alert.symbol)
    .eq("direction", alert.direction)
    .eq("entry", alert.entry)
    .gte("created_at", since(60_000))
    .limit(1);
  if (duplicate?.length) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
    // Idioma del usuario (columna opcional: si todavía no existe, se usa español).
    const { data: langRow } = await supabase.from("profiles").select("lang").eq("id", profile.id).maybeSingle();
    const en = (langRow as { lang?: string } | null)?.lang === "en";
    await sendExpoPush(
      tokens.map((t) => ({
        to: t.expo_push_token,
        title: `${alert.symbol} · ${alert.direction === "LONG" ? (en ? "BUY" : "COMPRA") : en ? "SELL" : "VENTA"}`,
        body: `${en ? "Entry" : "Entrada"} ${alert.entry} · TP ${alert.tp} · SL ${alert.sl}`,
        data: { tradeId: trade.id },
      })),
    );
  }

  // Aviso por Telegram (si el usuario vinculó su chat).
  await notifyTelegram(supabase, profile.id, (lang) => {
    const side = alert.direction === "LONG" ? (lang === "en" ? "BUY" : "COMPRA") : lang === "en" ? "SELL" : "VENTA";
    return `🔔 <b>${lang === "en" ? "New signal" : "Nueva señal"}</b>\n${alert.direction === "LONG" ? "▲" : "▼"} <b>${esc(alert.symbol)}</b> ${side}\n${
      lang === "en" ? "Entry" : "Entrada"
    } ${alert.entry} · TP ${alert.tp} · SL ${alert.sl}`;
  });

  return new Response(JSON.stringify({ ok: true, trade }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
});

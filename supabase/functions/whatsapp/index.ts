// Señales por WhatsApp (API oficial de Meta).
//
// 1) Pedidos de la app (POST con la sesión de la persona):
//    · status  → { configured, link }   (si no está configurado, la app no muestra nada)
//    · start   → { phone }  manda un código de 6 dígitos por WhatsApp a ese número
//    · verify  → { code }   si coincide, vincula el número a la cuenta
//    · toggle  → { enabled } pausa o reanuda los avisos
//    · unlink  → desvincula
// 2) Webhook de Meta:
//    · GET  → verificación (hub.verify_token == WHATSAPP_VERIFY_TOKEN)
//    · POST → mensajes que la gente escribe al número de VELTRIX. «BAJA» pausa los avisos y «ALTA» los reanuda.
//
// Secretos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.
// Desactivar «Verify JWT»: Meta no manda sesión; el webhook se protege con la firma y los pedidos de la app validan la sesión acá.

import { createClient } from "npm:@supabase/supabase-js@2";
import { waConfig, waDigits, waMask, waSendCode, waSendText, waValidPhone } from "../_shared/waCloud.ts";
import type { Lang } from "../_shared/telegram.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 60;
const DAILY_CAP = 5; // códigos por día, por persona y por número

const today = () => new Date().toISOString().slice(0, 10);
const encoder = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}
/** Comparación de tiempo constante. */
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

async function langOfUser(userId: string): Promise<Lang> {
  const { data } = await admin.from("profiles").select("lang").eq("id", userId).maybeSingle();
  return (data as { lang?: string } | null)?.lang === "en" ? "en" : "es";
}

// ─── Pedidos de la app ──────────────────────────────────────────────────────

async function handleClient(req: Request, body: Record<string, unknown>) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ ok: false, error: "Sesión no válida. Volvé a ingresar." }, 401);
  const cfg = waConfig();
  const action = String(body.action ?? "");

  if (action === "status") {
    const { data: link } = await admin.from("whatsapp_links").select("phone, enabled").eq("user_id", user.id).maybeSingle();
    return json({ ok: true, configured: !!cfg, link: link ? { phone: waMask(String(link.phone)), enabled: link.enabled !== false } : null });
  }
  if (!cfg) return json({ ok: false, code: "not_configured", error: "Las señales por WhatsApp todavía no están disponibles." }, 503);

  if (action === "start") {
    const phone = waDigits(String(body.phone ?? ""));
    if (!waValidPhone(phone)) return json({ ok: false, error: "Escribí tu número con el código de país, por ejemplo +54 9 11 5555 5555." }, 400);
    const { data: prev } = await admin.from("whatsapp_codes").select("*").eq("user_id", user.id).maybeSingle();
    if (prev && Date.now() - new Date(prev.last_sent_at).getTime() < COOLDOWN_SECONDS * 1000) {
      return json({ ok: false, error: "Esperá un minuto antes de pedir otro código." }, 429);
    }
    const sentToday = prev && prev.day === today() ? Number(prev.sent_today) : 0;
    const { data: samePhone } = await admin.from("whatsapp_codes").select("sent_today").eq("phone", phone).eq("day", today());
    const phoneToday = ((samePhone ?? []) as Array<{ sent_today: number }>).reduce((a, r) => a + Number(r.sent_today), 0);
    if (sentToday >= DAILY_CAP || phoneToday >= DAILY_CAP) return json({ ok: false, error: "Pediste demasiados códigos hoy. Probá mañana." }, 429);

    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const { error } = await admin.from("whatsapp_codes").upsert(
      {
        user_id: user.id,
        phone,
        code_hash: await sha256(`${code}:${user.id}:${phone}`),
        expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
        attempts: 0,
        last_sent_at: new Date().toISOString(),
        day: today(),
        sent_today: sentToday + 1,
      },
      { onConflict: "user_id" },
    );
    if (error) return json({ ok: false, error: "No se pudo generar el código." }, 500);
    const sent = await waSendCode(cfg, phone, code, await langOfUser(user.id));
    if (!sent.ok) {
      const msg = sent.code === 131030 ? "Ese número todavía no está autorizado en el modo de prueba de WhatsApp." : "No se pudo enviar el código por WhatsApp. Revisá el número e intentá de nuevo.";
      return json({ ok: false, error: msg }, 502);
    }
    return json({ ok: true, minutes: CODE_MINUTES });
  }

  if (action === "verify") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    const { data: row } = await admin.from("whatsapp_codes").select("*").eq("user_id", user.id).maybeSingle();
    if (!row) return json({ ok: false, error: "Primero pedí un código." }, 400);
    if (new Date(row.expires_at).getTime() < Date.now()) return json({ ok: false, error: "El código venció. Pedí uno nuevo." }, 400);
    if (Number(row.attempts) >= MAX_ATTEMPTS) return json({ ok: false, error: "Demasiados intentos. Pedí un código nuevo." }, 429);
    const expected = String(row.code_hash);
    if (!code || !same(await sha256(`${code}:${user.id}:${row.phone}`), expected)) {
      await admin.from("whatsapp_codes").update({ attempts: Number(row.attempts) + 1 }).eq("user_id", user.id);
      return json({ ok: false, error: "Código incorrecto." }, 400);
    }
    await admin.from("whatsapp_links").delete().eq("phone", row.phone).neq("user_id", user.id); // un número, una cuenta
    const { error } = await admin.from("whatsapp_links").upsert({ user_id: user.id, phone: row.phone, enabled: true, verified_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) return json({ ok: false, error: "No se pudo vincular el número." }, 500);
    await admin.from("whatsapp_codes").delete().eq("user_id", user.id);
    return json({ ok: true, link: { phone: waMask(String(row.phone)), enabled: true } });
  }

  if (action === "toggle") {
    const { error } = await admin.from("whatsapp_links").update({ enabled: body.enabled !== false }).eq("user_id", user.id);
    return error ? json({ ok: false, error: "No se pudo guardar el cambio." }, 500) : json({ ok: true });
  }

  if (action === "unlink") {
    await admin.from("whatsapp_links").delete().eq("user_id", user.id);
    await admin.from("whatsapp_codes").delete().eq("user_id", user.id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Acción desconocida." }, 400);
}

// ─── Webhook de Meta ────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
const STOP = new Set(["baja", "stop", "parar", "pausar", "cancelar", "unsubscribe"]);
const START = new Set(["alta", "start", "activar", "reanudar", "subscribe"]);

const REPLIES = {
  es: {
    stop: "Listo, no vas a recibir más avisos de VELTRIX por WhatsApp. Para volver a activarlos, escribí ALTA.",
    start: "Listo, volvés a recibir los avisos de VELTRIX por WhatsApp. Para pausarlos, escribí BAJA.",
  },
  en: {
    stop: "Done, you will no longer get VELTRIX alerts on WhatsApp. To turn them back on, write ALTA.",
    start: "Done, you will get VELTRIX alerts on WhatsApp again. To pause them, write BAJA.",
  },
};

async function handleMeta(req: Request, raw: string) {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });
  const given = req.headers.get("x-hub-signature-256") ?? "";
  if (!same(given, `sha256=${await hmac(secret, raw)}`)) return new Response("bad signature", { status: 403 });
  const cfg = waConfig();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok");
  }
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const msg of change?.value?.messages ?? []) {
        const from = waDigits(msg?.from ?? "");
        const word = norm(String(msg?.text?.body ?? ""));
        const stop = STOP.has(word);
        if (!from || msg?.type !== "text" || (!stop && !START.has(word))) continue;
        const { data: link } = await admin.from("whatsapp_links").select("user_id").eq("phone", from).maybeSingle();
        if (!link) continue;
        await admin.from("whatsapp_links").update({ enabled: !stop }).eq("phone", from);
        if (cfg) {
          const lang = await langOfUser(String(link.user_id));
          await waSendText(cfg, from, REPLIES[lang][stop ? "stop" : "start"]);
        }
      }
    }
  }
  return new Response("ok");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const verify = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    if (verify && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === verify) return new Response(q.get("hub.challenge") ?? "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
  const raw = await req.text();
  if (req.headers.get("x-hub-signature-256")) return handleMeta(req, raw);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false, error: "Pedido inválido." }, 400);
  }
  return handleClient(req, body);
});

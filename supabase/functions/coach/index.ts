// Coach de disciplina con IA: lee tu diario, calcula tus patrones con código y le pide a Claude que los explique.
//
//   POST /functions/v1/coach   (con la sesión del usuario en Authorization)
//
// Secretos de la función: ANTHROPIC_API_KEY (de console.anthropic.com) y, si querés cambiar de modelo, COACH_MODEL.
// Límites: un informe nuevo como máximo cada 6 horas si el diario no cambió, y 3 por día por persona.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0";
import { coachReport } from "../_shared/coach.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("COACH_MODEL") || "claude-opus-5-5";
// Modelos que aceptan el nivel de esfuerzo y la red de seguridad automática ante rechazos.
const BIG = /^claude-(opus|sonnet|fable)/.test(MODEL);
const FALLBACK = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL);

async function ask(system: string, user: string): Promise<string | null> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
  const base: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (BIG) base.output_config = { effort: "low" }; // es un texto corto: no hace falta pensar mucho
  const run = (params: Record<string, unknown>) => (client as any).beta.messages.create(params);
  let res: any;
  try {
    res = await run(FALLBACK ? { ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : base);
  } catch (e) {
    // Si la red de seguridad automática no está disponible, se repite sin ella.
    if (FALLBACK && (e as { status?: number }).status === 400) res = await run(base);
    else throw e;
  }
  if (res.stop_reason === "refusal") return null;
  const text = (res.content as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
  return text || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ ok: false, error: "Sesión no válida. Volvé a ingresar." }, 401);

  try {
    const r = await coachReport({ supabase: admin, ask, hasKey: !!Deno.env.get("ANTHROPIC_API_KEY") }, user.id);
    return json(r);
  } catch (e) {
    console.error("coach:", e instanceof Error ? e.message : e);
    return json({ ok: false, reason: "unavailable" });
  }
});

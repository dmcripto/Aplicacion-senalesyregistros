// ─── VELTRIX · WhatsApp Cloud API (oficial, de Meta) ────────────────────────
// Manda mensajes de plantilla al número que cada persona vinculó y confirmó con un código.
// Secretos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID (y opcionales WHATSAPP_CODE_TEMPLATE, WHATSAPP_SIGNAL_TEMPLATE, WHATSAPP_RESULT_TEMPLATE).

import { prettyPair } from "./community.ts";
import type { CommunityTrade } from "./community.ts";
import type { Lang } from "./telegram.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface WaConfig {
  token: string;
  phoneId: string;
  templates: { code: string; signal: string; result: string };
}

const env = (k: string): string | undefined => {
  try {
    return (globalThis as any).Deno?.env?.get(k) || undefined;
  } catch {
    return undefined;
  }
};

/** null si falta la configuración de Meta: en ese caso WhatsApp queda apagado y nadie ve nada raro. */
export function waConfig(): WaConfig | null {
  const token = env("WHATSAPP_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) return null;
  return {
    token,
    phoneId,
    templates: {
      code: env("WHATSAPP_CODE_TEMPLATE") ?? "veltrix_codigo",
      signal: env("WHATSAPP_SIGNAL_TEMPLATE") ?? "veltrix_senal",
      result: env("WHATSAPP_RESULT_TEMPLATE") ?? "veltrix_resultado",
    },
  };
}

/** Solo los números, con código de país y sin ceros ni signos: 5491155550000. */
export const waDigits = (s: string) => String(s ?? "").replace(/\D/g, "");
export const waValidPhone = (digits: string) => /^[1-9]\d{7,14}$/.test(digits);
/** +54 9 **** 0000: se muestra sin dejar el número completo a la vista. */
export const waMask = (digits: string) => (digits.length > 6 ? `+${digits.slice(0, 2)} ${"•".repeat(Math.max(3, digits.length - 6))} ${digits.slice(-4)}` : `+${digits}`);

export interface WaResult {
  ok: boolean;
  status: number;
  code?: number; // código de error de Meta
  error?: string;
}

/** Manda un mensaje por la API. Nunca lanza errores. */
export async function waSend(cfg: WaConfig, payload: Record<string, unknown>): Promise<WaResult> {
  try {
    const res = await fetch(`${GRAPH}/${cfg.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok && !body?.error) return { ok: true, status: res.status };
    return { ok: false, status: res.status, code: body?.error?.code, error: body?.error?.message };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network" };
  }
}

/** Mensaje de plantilla: `params` van en orden en {{1}}, {{2}}…; `urlParam` es para el botón «copiar código» de la plantilla de códigos. */
export function waTemplate(to: string, name: string, lang: Lang, params: string[], urlParam?: string) {
  const components: Array<Record<string, unknown>> = [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text).replace(/\s+/g, " ").trim() })) }];
  if (urlParam !== undefined) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlParam }] });
  return { to, type: "template", template: { name, language: { code: lang }, components } };
}

/** Código de confirmación al número que la persona quiere vincular. */
export const waSendCode = (cfg: WaConfig, to: string, code: string, lang: Lang) => waSend(cfg, waTemplate(to, cfg.templates.code, lang, [code], code));

/** Texto libre (solo permitido dentro de las 24 h desde que la persona escribió, por ejemplo para contestar BAJA). */
export const waSendText = (cfg: WaConfig, to: string, body: string) => waSend(cfg, { to, type: "text", text: { body } });

/** Valores de la plantilla de señal: par, dirección, entrada, target, stop, riesgo/beneficio. */
export function waSignalParams(t: CommunityTrade, lang: Lang): string[] {
  const en = lang === "en";
  const long = t.direction === "LONG";
  const risk = Math.abs(t.entry - t.sl);
  const rr = risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
  return [prettyPair(t.symbol), long ? (en ? "BUY (LONG)" : "COMPRA (LONG)") : en ? "SELL (SHORT)" : "VENTA (SHORT)", String(t.entry), String(t.tp), String(t.sl), rr.toFixed(1)];
}

/** Valores de la plantilla de resultado: par, qué pasó y el R. */
export function waResultParams(symbol: string, outcome: "TP" | "SL", r: number, lang: Lang): string[] {
  const en = lang === "en";
  const ok = outcome === "TP";
  const what = ok ? (en ? "TP hit ✅" : "TP alcanzado ✅") : en ? "SL hit ❌" : "SL alcanzado ❌";
  return [prettyPair(symbol), what, `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}R`];
}

/**
 * Avisa por WhatsApp a la persona si vinculó su número y no lo pausó. Nunca lanza errores:
 * un fallo de WhatsApp no debe romper el registro de la señal.
 */
export async function notifyWhatsApp(
  supabase: any,
  userId: string,
  build: (lang: Lang) => { kind: "signal" | "result"; params: string[] },
): Promise<void> {
  try {
    const cfg = waConfig();
    if (!cfg) return;
    const { data: link } = await supabase.from("whatsapp_links").select("phone, enabled").eq("user_id", userId).maybeSingle();
    if (!link || link.enabled === false) return;
    const { data: profile } = await supabase.from("profiles").select("lang").eq("id", userId).maybeSingle();
    const lang: Lang = (profile as { lang?: string } | null)?.lang === "en" ? "en" : "es";
    const spec = build(lang);
    const r = await waSend(cfg, waTemplate(link.phone, cfg.templates[spec.kind], lang, spec.params));
    // 131026: el número no tiene WhatsApp o no puede recibir mensajes → se pausa para no seguir intentando.
    if (!r.ok && r.code === 131026) await supabase.from("whatsapp_links").update({ enabled: false }).eq("user_id", userId);
    if (!r.ok) console.error("whatsapp:", r.code ?? r.status, r.error ?? "");
  } catch (e) {
    console.error("whatsapp:", e instanceof Error ? e.message : e);
  }
}

// ─── VELTRIX · reporte de errores propio ────────────────────────────────────
// Manda a la tabla `client_errors` los fallos inesperados (con la sesión iniciada) para poder corregirlos.
// Sin servicios de terceros. Máximo 10 por sesión y sin repetir el mismo mensaje.

import { supabase } from "./supabaseClient";

const seen = new Set<string>();
let sent = 0;

export async function reportError(err: unknown, context = "") {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
    const message = String(e.message).slice(0, 500);
    if (sent >= 10 || seen.has(message)) return;
    seen.add(message);
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    sent++;
    await supabase.from("client_errors").insert({
      user_id: uid,
      platform: "web",
      app_version: "web",
      message,
      stack: (e.stack ?? "").slice(0, 4000),
      context: context.slice(0, 300),
    });
  } catch {
    /* un fallo al reportar nunca debe causar otro fallo */
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener("error", (ev) => void reportError(ev.error ?? ev.message, "window.onerror"));
  window.addEventListener("unhandledrejection", (ev) => void reportError(ev.reason, "unhandledrejection"));
}

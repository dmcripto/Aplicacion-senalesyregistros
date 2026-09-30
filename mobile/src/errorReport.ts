// ─── VELTRIX · reporte de errores propio (app) ──────────────────────────────
// Manda a la tabla `client_errors` los fallos inesperados (con la sesión iniciada) para poder corregirlos.
// Sin servicios de terceros. Máximo 10 por sesión y sin repetir el mismo mensaje.

import { Platform } from "react-native";
import Constants from "expo-constants";
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
      platform: Platform.OS,
      app_version: Constants.expoConfig?.version ?? null,
      message,
      stack: (e.stack ?? "").slice(0, 4000),
      context: context.slice(0, 300),
    });
  } catch {
    /* un fallo al reportar nunca debe causar otro fallo */
  }
}

export function installGlobalErrorHandlers() {
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } };
  const utils = g.ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    void reportError(error, isFatal ? "fatal" : "js");
    previous(error, isFatal);
  });
}

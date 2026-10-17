// ─── VELTRIX · Vigilante de funciones ───────────────────────────────────────
// Las tareas automáticas (el bot cada 5 minutos, la sincronización de exchanges cada 10) dejan un «latido» al terminar bien.
// Si una se detiene (error, límite de CPU, tarea apagada), el vigilante avisa por Telegram y por la app a quienes administran
// el proyecto (cuentas con el bot habilitado) y avisa de nuevo cuando vuelve a funcionar.

export interface WatchedJob {
  name: string;
  /** Minutos sin latido a partir de los cuales se avisa. */
  maxMin: number;
  es: string;
  en: string;
}

export const WATCHED_JOBS: WatchedJob[] = [
  { name: "bot", maxMin: 20, es: "el bot automático", en: "the automatic bot" },
  { name: "exchanges", maxMin: 35, es: "la sincronización con los exchanges", en: "the exchange sync" },
];

const REMIND_MS = 3 * 3_600_000; // mientras siga caída, se repite el aviso cada 3 horas

/** Anota que la tarea terminó bien. Nunca rompe a quien la llama (si la tabla todavía no existe, no hace nada). */
export async function beat(supabase: any, name: string, now = Date.now()): Promise<void> {
  try {
    await supabase.from("system_heartbeat").upsert({ name, at: new Date(now).toISOString() }, { onConflict: "name" });
  } catch {
    /* sin la tabla (migración 0067): se sigue sin vigilante */
  }
}

export interface WatchdogAlert {
  job: WatchedJob;
  kind: "down" | "recovered";
  minutes: number;
}

/** Revisa los latidos; devuelve los avisos que corresponde mandar (y deja anotado cuándo se mandaron para no repetirlos). */
export async function runWatchdog(supabase: any, notify: (alert: WatchdogAlert) => Promise<void>, now = Date.now(), jobs: WatchedJob[] = WATCHED_JOBS): Promise<WatchdogAlert[]> {
  const sent: WatchdogAlert[] = [];
  let rows: Array<{ name: string; at: string; alerted_at: string | null }> = [];
  try {
    const { data, error } = await supabase.from("system_heartbeat").select("name, at, alerted_at");
    if (error) return sent;
    rows = (data ?? []) as typeof rows;
  } catch {
    return sent;
  }
  for (const job of jobs) {
    const row = rows.find((r) => r.name === job.name);
    if (!row) continue; // nunca latió: puede ser una tarea que todavía no se configuró; no se avisa
    const age = now - new Date(row.at).getTime();
    const minutes = Math.round(age / 60_000);
    const stale = age > job.maxMin * 60_000;
    const alertedAt = row.alerted_at ? new Date(row.alerted_at).getTime() : null;
    if (stale && (alertedAt == null || now - alertedAt >= REMIND_MS)) {
      const alert: WatchdogAlert = { job, kind: "down", minutes };
      await notify(alert).catch(() => undefined);
      await supabase.from("system_heartbeat").update({ alerted_at: new Date(now).toISOString() }).eq("name", job.name);
      sent.push(alert);
    } else if (!stale && alertedAt != null) {
      const alert: WatchdogAlert = { job, kind: "recovered", minutes };
      await notify(alert).catch(() => undefined);
      await supabase.from("system_heartbeat").update({ alerted_at: null }).eq("name", job.name);
      sent.push(alert);
    }
  }
  return sent;
}

export const watchdogText = (a: WatchdogAlert, lang: "es" | "en"): { title: string; body: string } => {
  const name = lang === "en" ? a.job.en : a.job.es;
  if (a.kind === "recovered") {
    return lang === "en" ? { title: "✅ Back to normal", body: `${name[0].toUpperCase()}${name.slice(1)} is running again.` } : { title: "✅ Todo volvió a la normalidad", body: `${name[0].toUpperCase()}${name.slice(1)} volvió a funcionar.` };
  }
  return lang === "en"
    ? { title: "⚠️ A VELTRIX task stopped", body: `${name[0].toUpperCase()}${name.slice(1)} has not run for ${a.minutes} minutes. Check the function Logs in Supabase.` }
    : { title: "⚠️ Se detuvo una tarea de VELTRIX", body: `${name[0].toUpperCase()}${name.slice(1)} no corre hace ${a.minutes} minutos. Revisá los Logs de la función en Supabase.` };
};

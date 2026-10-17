// Copia de seguridad semanal de las tablas importantes (ver _shared/backup.ts).
//
//   POST /functions/v1/backup   con el encabezado x-cron-secret (= EXCHANGE_CRON_SECRET)
//
// La dispara sola la función auto-close una vez por semana (y la primera vez que se despliega). Se puede forzar a mano llamándola con el mismo
// encabezado. Guarda los archivos en el depósito privado «backups» (Storage); se bajan desde Supabase > Storage > backups.

import { createClient } from "npm:@supabase/supabase-js@2";
import { runBackup } from "../_shared/backup.ts";
import { beat } from "../_shared/watchdog.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const secret = Deno.env.get("EXCHANGE_CRON_SECRET");
  const given = req.headers.get("x-cron-secret");
  if (!secret || secret.length < 16 || !given || !same(given, secret)) return json({ ok: false, error: "No autorizado" }, 401);
  try {
    const r = await runBackup(admin);
    await beat(admin, "backup");
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("backup:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "backup" }, 500);
  }
});

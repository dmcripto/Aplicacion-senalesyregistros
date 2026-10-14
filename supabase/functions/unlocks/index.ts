// Carga el calendario de desbloqueos de tokens (Tokenomist) en la tabla token_unlocks para el filtro del bot.
//
//   Se llama una vez por día (pg_cron). Cada corrida usa pocas llamadas a la API (la prueba tiene 1.000 por mes):
//   si ya se cargó hace menos de 20 horas, no hace nada (así nadie puede gastar la cuota llamando de afuera).
//   Secreto necesario: TOKENOMIST_API_KEY. Con el encabezado x-cron-secret (= EXCHANGE_CRON_SECRET) se puede forzar una carga.

import { createClient } from "npm:@supabase/supabase-js@2";
import { isoDay, parseUpcomingUnlocks } from "../_shared/tokenomist.ts";
import type { UnlockRow } from "../_shared/tokenomist.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const API = "https://api.tokenomist.ai/v5/unlock/events/upcoming";
const HORIZON_DAYS = 30; // el filtro del bot mira como mucho 30 días adelante
const MIN_VALUE_TO_MCAP = 0.5; // ignora desbloqueos menores al 0,5 % de lo que circula
const PAGE_SIZE = 100;
const MAX_PAGES = 6;
const MIN_GAP_MS = 20 * 3_600_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const apiKey = Deno.env.get("TOKENOMIST_API_KEY");
  if (!apiKey) return json({ ok: false, error: "Falta el secreto TOKENOMIST_API_KEY." }, 500);

  const cron = Deno.env.get("EXCHANGE_CRON_SECRET");
  const force = !!cron && req.headers.get("x-cron-secret") === cron;

  if (!force) {
    const { data: last } = await admin.from("token_unlocks").select("updated_at").eq("source", "tokenomist").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.updated_at as string).getTime() < MIN_GAP_MS) return json({ ok: true, skipped: true });
  }

  const now = Date.now();
  const rows: UnlockRow[] = [];
  let calls = 0;
  let credit: unknown = null;
  let end = isoDay(now, HORIZON_DAYS);
  let retried = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ start: isoDay(now), end, minValueToMarketCap: String(MIN_VALUE_TO_MCAP), page: String(page), pageSize: String(PAGE_SIZE) });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${API}?${q}`, { headers: { "x-api-key": apiKey, Accept: "application/json" }, signal: ctl.signal });
    } catch (e) {
      return json({ ok: false, error: `No se pudo consultar Tokenomist: ${e instanceof Error ? e.message : "error"}`, calls }, 502);
    } finally {
      clearTimeout(timer);
    }
    calls++;
    const body = await res.json().catch(() => null);
    // La prueba gratuita solo deja pedir cierto rango de fechas («date must be within the allowed range: A to B»): se ajusta y se reintenta una vez.
    const allowed = /allowed range:\s*(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/i.exec(String(body?.errorMessage ?? ""));
    if (res.status === 422 && allowed && !retried && allowed[2] < end) {
      retried = true;
      end = allowed[2];
      page--;
      continue;
    }
    if (!res.ok || !body || body.status === false) return json({ ok: false, error: `Tokenomist respondió ${res.status}`, detail: JSON.stringify(body ?? {}).slice(0, 300), calls }, 502);
    rows.push(...parseUpcomingUnlocks(body.data));
    credit = body.metadata?.credit ?? credit;
    const pages = Number(body.metadata?.totalPages ?? 1);
    if (!(page < pages)) break;
  }

  const stamp = new Date().toISOString();
  const unique = new Map(rows.map((r) => [`${r.symbol}|${r.at}`, r]));
  const payload = [...unique.values()].map((r) => ({ ...r, source: "tokenomist", updated_at: stamp }));
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await admin.from("token_unlocks").upsert(payload.slice(i, i + 200), { onConflict: "symbol,at" });
    if (error) return json({ ok: false, error: error.message, calls }, 500);
  }
  // Los que ya pasaron (y los de la fuente que ya no figuran) se limpian.
  await admin.from("token_unlocks").delete().lt("at", new Date(now - 86_400_000).toISOString());
  if (payload.length) await admin.from("token_unlocks").delete().eq("source", "tokenomist").lt("updated_at", stamp);

  return json({ ok: true, loaded: payload.length, calls, credit });
});

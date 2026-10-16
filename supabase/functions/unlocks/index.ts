// Carga el calendario de desbloqueos de tokens en la tabla token_unlocks para el filtro del bot.
//
//   Fuentes (se elige con el secreto UNLOCKS_SOURCE):
//     · «defillama»  → calendario abierto de DefiLlama, sin clave y sin costo. Si UNLOCKS_SOURCE no existe y no hay clave de Tokenomist, es la que se usa.
//     · «tokenomist» → Tokenomist (pago; necesita TOKENOMIST_API_KEY). Es la que se usa si existe la clave y no se eligió otra.
//   Datos cargados a mano (source = 'manual') se respetan: esta función no los borra hasta que pasan.
//
//   Se llama una vez por día (pg_cron). Si ya se cargó hace menos de 20 horas, no hace nada. Con el encabezado x-cron-secret
//   (= EXCHANGE_CRON_SECRET) se puede forzar una carga, y con {"probe": true} en el cuerpo se ve cómo responde la fuente sin guardar nada.

import { createClient } from "npm:@supabase/supabase-js@2";
import { isoDay, parseAllowedRange, parseUpcomingUnlocks } from "../_shared/tokenomist.ts";
import type { UnlockRow } from "../_shared/tokenomist.ts";
import { describeLlama, parseLlamaEmissions } from "../_shared/llamaUnlocks.ts";
import { extractEvents, extractTokens, projectRecurring } from "../_shared/unlockLearn.ts";
import type { HistRow } from "../_shared/unlockLearn.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const API = "https://api.tokenomist.ai/v5/unlock/events/upcoming";
const LLAMA_URL = Deno.env.get("LLAMA_EMISSIONS_URL") ?? "https://api.llama.fi/emissions";
const HORIZON_DAYS = 30; // el filtro del bot mira como mucho 30 días adelante
const MIN_VALUE_TO_MCAP = 0.5; // ignora desbloqueos menores al 0,5 % de lo que circula
const PAGE_SIZE = 100;
const MAX_PAGES = 6;
const MIN_GAP_MS = 20 * 3_600_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });


// ─── Aprender del período de prueba ─────────────────────────────────────────
// Se bajan y guardan las respuestas completas de Tokenomist (lista de tokens y eventos de cada uno, con hasta un año hacia atrás) mientras dura la prueba,
// y cada desbloqueo leído se acumula en unlock_history. De ahí se proyectan los que se repiten con ritmo fijo (ver unlockLearn.ts).
// Tope duro: no se vuelve a pedir un token ya bajado, así que nadie puede gastar la cuota llamando de afuera.

const LEARN_BATCH = 20; // tokens por corrida (con 1,1 s entre pedidos entra en el tiempo de la función)
const LEARN_GAP_MS = 1_100; // la fuente permite 60 pedidos por minuto
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tokGet(apiKey: string, path: string, q: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const qs = new URLSearchParams(q).toString();
  const res = await fetch(`https://api.tokenomist.ai${path}${qs ? `?${qs}` : ""}`, { headers: { "x-api-key": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function appendHistory(rows: HistRow[], source: string) {
  const at = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, source, seen_at: at }));
  for (let i = 0; i < payload.length; i += 200) await admin.from("unlock_history").upsert(payload.slice(i, i + 200), { onConflict: "symbol,at,source", ignoreDuplicates: false });
}

async function learnStep(apiKey: string, now: number) {
  const out = { tokens: 0, fetched: 0, events: 0, pending: 0, error: null as string | null, shape: null as unknown };
  // Freno: si la fuente ya falló varias veces (ruta equivocada, clave vencida, fin de la prueba), no se sigue pidiendo (la cuota es de 1.000 por mes).
  // Para reintentar después de arreglarlo:  delete from unlock_raw where kind in ('tokens_error', 'events_error');
  const { count: failures } = await admin.from("unlock_raw").select("id", { count: "exact", head: true }).in("kind", ["tokens_error", "events_error"]);
  if ((failures ?? 0) >= 3) {
    out.error = "La fuente falló 3 veces seguidas; se frenó para no gastar la cuota. Mirá la tabla unlock_raw (kind terminado en _error) y, al arreglarlo, borrá esas filas para reintentar.";
    return out;
  }
  // 1) lista de tokens (una vez por mes)
  const { data: stored } = await admin.from("unlock_raw").select("response, fetched_at").eq("kind", "tokens").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  let tokenJson: unknown = stored && now - new Date(stored.fetched_at as string).getTime() < 30 * 86_400_000 ? stored.response : null;
  if (!tokenJson) {
    const r = await tokGet(apiKey, "/v5/token/list", { page: "1", pageSize: "100" });
    await admin.from("unlock_raw").insert({ kind: r.status === 200 && r.body ? "tokens" : "tokens_error", request: "/v5/token/list", response: { status: r.status, body: r.body } });
    if (r.status !== 200 || !r.body) {
      out.error = `Lista de tokens: respondió ${r.status} ${JSON.stringify(r.body ?? {}).slice(0, 200)}`;
      return out;
    }
    tokenJson = { status: r.status, body: r.body };
  }
  const tokens = extractTokens(tokenJson);
  out.tokens = tokens.length;
  if (!tokens.length) {
    out.error = "No se pudo leer ningún token de la lista (¿otro formato?).";
    out.shape = JSON.stringify(tokenJson).slice(0, 400);
    return out;
  }
  // 2) eventos de cada token que todavía no se bajó
  const { data: done } = await admin.from("unlock_raw").select("token").eq("kind", "events").limit(5000);
  const doneSet = new Set((done ?? []).map((r: { token: string }) => r.token));
  const todo = tokens.filter((t) => !doneSet.has(t.id));
  out.pending = Math.max(0, todo.length - LEARN_BATCH);
  for (const tk of todo.slice(0, LEARN_BATCH)) {
    await sleep(LEARN_GAP_MS);
    const q: Record<string, string> = { start: isoDay(now, -365), end: isoDay(now, 30) };
    let r = await tokGet(apiKey, `/v5/unlock/events/${encodeURIComponent(tk.id)}`, q);
    const allowed = parseAllowedRange(r.body?.errorMessage);
    if (r.status === 422 && allowed) {
      await sleep(LEARN_GAP_MS);
      r = await tokGet(apiKey, `/v5/unlock/events/${encodeURIComponent(tk.id)}`, { start: allowed.from, end: allowed.to });
    }
    const raw = JSON.stringify({ status: r.status, body: r.body });
    if (r.status !== 200 || !r.body) {
      // Se guarda lo que respondió (para ver el motivo) y se corta la tanda: no se sigue pidiendo si el primero ya falló.
      await admin.from("unlock_raw").insert({ kind: "events_error", token: tk.id, request: `/v5/unlock/events/${tk.id}`, response: { status: r.status, body: r.body } });
      out.error = `Eventos de ${tk.id}: respondió ${r.status} ${raw.slice(0, 200)}`;
      break;
    }
    await admin.from("unlock_raw").insert({ kind: "events", token: tk.id, request: `/v5/unlock/events/${tk.id}`, response: raw.length < 900_000 ? JSON.parse(raw) : { status: r.status, truncated: true } });
    out.fetched++;
    if (r.status === 200 && r.body) {
      const ev = extractEvents(r.body, tk.symbol);
      out.events += ev.length;
      await appendHistory(ev, "tokenomist");
      if (!out.shape && ev.length === 0) out.shape = JSON.stringify(r.body).slice(0, 400); // para ver el formato si no se entendió nada
    }
  }
  return out;
}

/** Proyecta los desbloqueos con ritmo fijo a partir de lo acumulado y los carga como fuente «projected» (solo donde la fuente principal no trae nada cerca). */
async function projectStep(now: number) {
  const { data } = await admin.from("unlock_history").select("symbol, at, pct").limit(20000);
  const proj = projectRecurring(((data ?? []) as Array<{ symbol: string; at: string; pct: number }>).map((r) => ({ symbol: r.symbol, at: r.at, pct: Number(r.pct) })), now, HORIZON_DAYS, MIN_VALUE_TO_MCAP);
  const { data: real } = await admin.from("token_unlocks").select("symbol, at").neq("source", "projected").gte("at", new Date(now - 86_400_000).toISOString());
  const near = new Map<string, number[]>();
  for (const r of (real ?? []) as Array<{ symbol: string; at: string }>) near.set(r.symbol, [...(near.get(r.symbol) ?? []), Date.parse(r.at)]);
  const rows = proj.filter((p) => !(near.get(p.symbol) ?? []).some((t) => Math.abs(t - Date.parse(p.at)) < 5 * 86_400_000));
  await admin.from("token_unlocks").delete().eq("source", "projected");
  if (rows.length) {
    const at = new Date().toISOString();
    await admin.from("token_unlocks").upsert(rows.map((r) => ({ ...r, source: "projected", updated_at: at })), { onConflict: "symbol,at" });
  }
  return rows.length;
}

const stamp = () => new Date().toISOString();

/** Guarda las filas de una fuente y borra las de esa misma fuente que ya no figuran (y todo lo que ya pasó). */
async function save(rows: UnlockRow[], source: string, now: number) {
  const at = stamp();
  const unique = new Map(rows.map((r) => [`${r.symbol}|${r.at}`, r]));
  const payload = [...unique.values()].map((r) => ({ ...r, source, updated_at: at }));
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await admin.from("token_unlocks").upsert(payload.slice(i, i + 200), { onConflict: "symbol,at" });
    if (error) return { error: error.message, loaded: 0 };
  }
  await admin.from("token_unlocks").delete().lt("at", new Date(now - 86_400_000).toISOString());
  if (payload.length) await admin.from("token_unlocks").delete().eq("source", source).lt("updated_at", at);
  return { error: null as string | null, loaded: payload.length };
}

async function loadLlama(now: number, probe: boolean): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(LLAMA_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
  } catch (e) {
    return json({ ok: false, error: `No se pudo consultar DefiLlama: ${e instanceof Error ? e.message : "error"}` }, 502);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) return json({ ok: false, error: `DefiLlama respondió ${res.status}`, detail: JSON.stringify(body ?? {}).slice(0, 300) }, 502);
  const rows = parseLlamaEmissions(body, now, HORIZON_DAYS, MIN_VALUE_TO_MCAP);
  if (probe) return json({ ok: true, probe: true, source: "defillama", shape: describeLlama(body), parsed: rows.length, sample: rows.slice(0, 5) });
  // Una respuesta vacía o que no se entiende no borra lo que ya había cargado.
  if (!rows.length) return json({ ok: false, error: "DefiLlama respondió, pero no se pudo leer ningún desbloqueo (¿cambió el formato?). No se tocó la tabla.", shape: describeLlama(body) }, 502);
  const r = await save(rows, "defillama", now);
  if (r.error) return json({ ok: false, error: r.error }, 500);
  await appendHistory(rows, "defillama");
  const projected = await projectStep(now).catch(() => 0);
  return json({ ok: true, source: "defillama", loaded: r.loaded, projected });
}

Deno.serve(async (req) => {
  const cron = Deno.env.get("EXCHANGE_CRON_SECRET");
  const force = !!cron && req.headers.get("x-cron-secret") === cron;
  const reqBody = (await req.json().catch(() => ({}))) as { probe?: unknown; learn?: unknown } | null;
  const probe = force && reqBody?.probe === true;
  const learnOnly = reqBody?.learn === true;

  const apiKey = Deno.env.get("TOKENOMIST_API_KEY");
  const chosen = (Deno.env.get("UNLOCKS_SOURCE") ?? "").toLowerCase();
  const source = chosen === "defillama" || chosen === "tokenomist" ? chosen : apiKey ? "tokenomist" : "defillama";

  // Solo aprender (lo llama el cron cada 15 minutos mientras dura la prueba): baja los tokens que falten y vuelve a proyectar. Sin nada pendiente no hace ninguna llamada.
  if (learnOnly) {
    if (!apiKey) return json({ ok: true, learn: "sin clave de Tokenomist: no hay nada que aprender" });
    const l = await learnStep(apiKey, Date.now()).catch((e) => ({ error: e instanceof Error ? e.message : "error", fetched: 0 }));
    if ((l as { error?: string | null }).error) console.error("unlocks learn:", (l as { error?: string | null }).error);
    if ((l as { fetched?: number }).fetched) await projectStep(Date.now()).catch(() => 0);
    return json({ ok: !(l as { error?: string | null }).error, learn: l }, (l as { error?: string | null }).error ? 502 : 200);
  }

  if (!force) {
    const { data: last } = await admin.from("token_unlocks").select("updated_at").eq("source", source).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.updated_at as string).getTime() < MIN_GAP_MS) return json({ ok: true, skipped: true });
  }
  if (source === "defillama") return await loadLlama(Date.now(), probe);
  if (!apiKey) return json({ ok: false, error: "Falta el secreto TOKENOMIST_API_KEY (o elegí UNLOCKS_SOURCE=defillama)." }, 500);

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
    const allowed = parseAllowedRange(body?.errorMessage);
    if (res.status === 422 && allowed && !retried && allowed.to < end) {
      retried = true;
      end = allowed.to;
      page--;
      continue;
    }
    if (!res.ok || !body || body.status === false) return json({ ok: false, error: `Tokenomist respondió ${res.status}`, detail: JSON.stringify(body ?? {}).slice(0, 300), calls }, 502);
    rows.push(...parseUpcomingUnlocks(body.data));
    credit = body.metadata?.credit ?? credit;
    const pages = Number(body.metadata?.totalPages ?? 1);
    if (!(page < pages)) break;
  }

  if (probe) return json({ ok: true, probe: true, source: "tokenomist", parsed: rows.length, calls });
  const saved = await save(rows, "tokenomist", now);
  if (saved.error) return json({ ok: false, error: saved.error, calls }, 500);
  await appendHistory(rows, "tokenomist");
  const learn = await learnStep(apiKey, now).catch((e) => ({ error: e instanceof Error ? e.message : "error" }));
  const projected = await projectStep(now).catch(() => 0);
  return json({ ok: true, source: "tokenomist", loaded: saved.loaded, calls, credit, learn, projected });

});

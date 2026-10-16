// ─── VELTRIX · Resumen semanal del bot con IA ───────────────────────────────
// Los números se calculan acá, con código (exactos y comprobables). La IA solo recibe esos datos ya calculados y los explica en lenguaje simple:
// no calcula nada y no inventa cifras. No da señales ni consejos de inversión. Sin dependencias de Deno ni de Node, para poder probarlo en local.

import { rOf } from "./dailySummary.ts";
import type { SumTrade } from "./dailySummary.ts";

export interface BotTrade extends SumTrade {
  symbol: string;
  source?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

export const BOT_PERIOD_DAYS = 7;
export const BOT_MIN_CLOSED = 5; // con menos operaciones cerradas del bot no hay nada que resumir
const BC_MIN_GROUP = 3;

export interface BotGroup {
  n: number;
  wins: number;
  winRate: number; // %
  netR: number;
  avgR: number;
}

export interface BotFacts {
  periodDays: number;
  /** El perfil elegido (simulado). */
  chosen: BotGroup | null;
  /** Prueba paralela «entradas filtradas» (simulada). */
  filtered: BotGroup | null;
  /** Prueba «corredor» (simulada, la que quedó de antes). */
  runner: BotGroup | null;
  /** Operaciones del bot con dinero real: resultado neto en USDT leído de lo que informó el exchange. */
  real: { n: number; wins: number; netUsdt: number | null; open: number } | null;
  /** Operaciones reales que tienen su copia simulada: cuántas terminaron igual (las dos ganaron o las dos perdieron). */
  realVsSim: { pairs: number; same: number; different: Array<{ symbol: string; real: string; sim: string }> } | null;
  openBot: number; // operaciones simuladas del bot que siguen abiertas
  bySymbol: { best: { symbol: string; n: number; avgR: number } | null; worst: { symbol: string; n: number; avgR: number } | null };
  profileName: string | null; // perfil que usó la mayoría de las operaciones simuladas del perfil elegido
}

const bcRound = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const TAG_PARALLEL = "Filtro 4h";
const TAG_RUNNER = "Corredor";
const TAG_REAL = "Bot real";

function groupOf(rs: number[]): BotGroup | null {
  if (!rs.length) return null;
  const wins = rs.filter((r) => r > 0).length;
  const net = rs.reduce((a, b) => a + b, 0);
  return { n: rs.length, wins, winRate: Math.round((wins / rs.length) * 100), netR: bcRound(net), avgR: bcRound(net / rs.length) };
}

/** El perfil que dice la nota de una operación simulada del bot («🤖 Bot simulado (perfil lento con objetivo amplio, …)»). */
export function profileOf(notes: string | null | undefined): string | null {
  const m = /perfil ([^,)]+)/i.exec(String(notes ?? ""));
  return m ? m[1].trim() : null;
}

/** Resultado neto en USDT que el exchange informó (la nota de las importadas dice «resultado neto −0.11 USDT»). */
export function netUsdtOf(notes: string | null | undefined): number | null {
  const m = /resultado neto\s*([+\-−])\s*([0-9]+(?:\.[0-9]+)?)\s*USDT/i.exec(String(notes ?? ""));
  if (!m) return null;
  const v = Number(m[2]);
  return Number.isFinite(v) ? (m[1] === "+" ? v : -v) : null;
}

const has = (t: BotTrade, tag: string) => !!t.tags?.includes(tag);
const closedAt = (t: BotTrade) => new Date(t.closed_at ?? t.date).getTime();

export function computeBotFacts(trades: BotTrade[], now: number): BotFacts | null {
  const since = now - BOT_PERIOD_DAYS * 86_400_000;
  const botSim = trades.filter((t) => t.source === "bot");
  const real = trades.filter((t) => has(t, TAG_REAL));
  const simClosed = botSim.filter((t) => t.outcome !== "ABIERTA" && closedAt(t) >= since);
  const realClosed = real.filter((t) => t.outcome !== "ABIERTA" && closedAt(t) >= since);
  if (simClosed.length + realClosed.length < BOT_MIN_CLOSED) return null;

  const chosenT = simClosed.filter((t) => !has(t, TAG_PARALLEL) && !has(t, TAG_RUNNER));
  const filteredT = simClosed.filter((t) => has(t, TAG_PARALLEL));
  const runnerT = simClosed.filter((t) => has(t, TAG_RUNNER));

  // Perfil más usado entre las operaciones del perfil elegido.
  const counts = new Map<string, number>();
  for (const t of chosenT) {
    const p = profileOf(t.notes);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const profileName = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Por activo (solo operaciones simuladas del perfil elegido, con muestra mínima).
  const bySym = new Map<string, number[]>();
  for (const t of chosenT) bySym.set(t.symbol, [...(bySym.get(t.symbol) ?? []), rOf(t)]);
  const syms = [...bySym.entries()].filter(([, rs]) => rs.length >= BC_MIN_GROUP).map(([symbol, rs]) => ({ symbol, n: rs.length, avgR: bcRound(rs.reduce((a, b) => a + b, 0) / rs.length) }));
  const sorted = [...syms].sort((a, b) => b.avgR - a.avgR);
  const best = sorted[0] && sorted[0].avgR > 0 ? sorted[0] : null;
  const worst = sorted.length > 1 && sorted[sorted.length - 1].avgR < 0 ? sorted[sorted.length - 1] : null;

  // Reales contra su copia simulada: mismo activo y lado, abiertas con menos de 15 minutos de diferencia.
  const pairs: BotFacts["realVsSim"] = { pairs: 0, same: 0, different: [] };
  for (const r of realClosed) {
    const copy = chosenT.find((s) => s.symbol === r.symbol && s.direction === r.direction && Math.abs(new Date(s.date).getTime() - new Date(r.date).getTime()) <= 15 * 60_000);
    if (!copy) continue;
    const rr = netUsdtOf(r.notes) ?? rOf(r);
    const real_ = rr > 0 ? "ganó" : "perdió";
    const sim_ = rOf(copy) > 0 ? "ganó" : "perdió";
    pairs.pairs++;
    if (real_ === sim_) pairs.same++;
    else pairs.different.push({ symbol: r.symbol, real: real_, sim: sim_ });
  }

  const usdt = realClosed.map((t) => netUsdtOf(t.notes));
  const known = usdt.filter((x): x is number => x != null);
  const realFacts: BotFacts["real"] = real.length
    ? {
        n: realClosed.length,
        wins: realClosed.filter((t, i) => (usdt[i] ?? rOf(t)) > 0).length,
        netUsdt: known.length && known.length === usdt.length ? bcRound(known.reduce((a, b) => a + b, 0), 3) : null,
        open: real.filter((t) => t.outcome === "ABIERTA").length,
      }
    : null;

  return {
    periodDays: BOT_PERIOD_DAYS,
    chosen: groupOf(chosenT.map(rOf)),
    filtered: groupOf(filteredT.map(rOf)),
    runner: groupOf(runnerT.map(rOf)),
    real: realFacts,
    realVsSim: pairs.pairs ? pairs : null,
    openBot: botSim.filter((t) => t.outcome === "ABIERTA").length,
    bySymbol: { best, worst },
    profileName,
  };
}

// ─── Mensaje para la IA ─────────────────────────────────────────────────────

export function buildBotPrompt(facts: BotFacts, lang: "es" | "en"): { system: string; user: string } {
  const en = lang === "en";
  const system = en
    ? `You are the assistant inside VELTRIX, a trading journal with an automatic bot. You receive FACTS already calculated from the bot's trades of the last 7 days (R = result measured in units of risk: +1.2R means a win of 1.2 times the amount risked; "simulated" trades are not sent to any exchange; "real" trades were placed by the bot with real money on the person's exchange, with the net USDT result reported by the exchange).

Rules:
- Use ONLY the numbers in the facts. Never invent, estimate or recalculate figures. If a field is null or missing, say nothing about it.
- Explain how the bot did and what stands out: the chosen profile, the parallel tests ("filtered entries" and "runner"), and, if present, real trades versus their simulated copies (differences usually come from small price differences between exchanges).
- Never give trade signals, price predictions or investment advice, and never tell the person to buy, sell or change their risk. This is a description of what happened, not a recommendation.
- Be warm, direct and plain. No jargon, no emojis except at most one at the start.
- A week is a very small sample: say so when numbers rest on few trades (under 20), and never promise gains.
- Format, in English, 170 words maximum:
  1) One sentence with the overall picture.
  2) Up to 4 short bullets with what stands out (profile result, tests, real vs simulated, best or worst asset if present).
  3) One single measurable thing to keep an eye on next week (for example: "check the skipped orders list" or "compare again after N more real trades").`
    : `Sos el asistente dentro de VELTRIX, un diario de trading con un bot automático. Recibís HECHOS ya calculados a partir de las operaciones del bot de los últimos 7 días (R = resultado medido en unidades de riesgo: +1,2R significa ganar 1,2 veces lo arriesgado; las operaciones «simuladas» no se envían a ningún exchange; las «reales» las puso el bot con dinero real en el exchange de la persona, con el resultado neto en USDT que informa el exchange).

Reglas:
- Usá SOLO los números de los hechos. No inventes, estimes ni recalcules cifras. Si un campo es null o falta, no digas nada sobre eso.
- Explicá cómo le fue al bot y qué se destaca: el perfil elegido, las pruebas paralelas («entradas filtradas» y «corredor») y, si hay, las operaciones reales contra su copia simulada (las diferencias suelen venir de pequeñas diferencias de precio entre exchanges).
- Nunca des señales, predicciones de precio ni consejos de inversión, y nunca le digas a la persona que compre, venda o cambie su riesgo. Es una descripción de lo que pasó, no una recomendación.
- Sé cálido, directo y simple. Sin jerga, sin emojis salvo uno al comienzo como máximo.
- Una semana es una muestra muy chica: decilo cuando los números se apoyen en pocas operaciones (menos de 20) y nunca prometas ganancias.
- Formato, en español rioplatense (vos), máximo 170 palabras:
  1) Una frase con el panorama general.
  2) Hasta 4 viñetas cortas con lo que se destaca (resultado del perfil, pruebas, reales contra simuladas, mejor o peor activo si hay).
  3) Una sola cosa medible para mirar la próxima semana (por ejemplo: «revisar la lista de órdenes omitidas» o «volver a comparar con N operaciones reales más»).`;
  const user = `${en ? "FACTS (JSON):" : "HECHOS (JSON):"}\n${JSON.stringify(facts)}`;
  return { system, user };
}

// ─── Resumen con caché y límites ────────────────────────────────────────────

export const BOT_MIN_GAP_MS = 12 * 3_600_000; // si los datos no cambiaron, se reutiliza el último resumen durante 12 horas
export const BOT_MAX_PER_DAY = 2;

export type BotCoachResult =
  | { ok: true; text: string; closed: number; cached: boolean; createdAt: string }
  | { ok: false; reason: "not_enough_data"; needed: number; have: number }
  | { ok: false; reason: "limit"; createdAt: string | null; text: string | null }
  | { ok: false; reason: "refused" | "unavailable" | "no_key" };

interface BotCoachDeps {
  supabase: any;
  ask: (system: string, user: string) => Promise<string | null>;
  hasKey: boolean;
}

export async function botCoachReport(deps: BotCoachDeps, userId: string, now = Date.now()): Promise<BotCoachResult> {
  const { supabase } = deps;
  const { data: profile } = await supabase.from("profiles").select("lang").eq("id", userId).maybeSingle();
  const lang: "es" | "en" = (profile as { lang?: string } | null)?.lang === "en" ? "en" : "es";
  const since = new Date(now - (BOT_PERIOD_DAYS + 7) * 86_400_000).toISOString();
  const { data: trades } = await supabase
    .from("trades")
    .select("symbol,direction,entry,tp,sl,date,outcome,exit,closed_at,notes,tags,source")
    .eq("user_id", userId)
    .gte("date", since)
    .limit(2000);
  const list = (trades ?? []) as BotTrade[];
  const facts = computeBotFacts(list, now);
  if (!facts) {
    const have = list.filter((t) => (t.source === "bot" || t.tags?.includes(TAG_REAL)) && t.outcome !== "ABIERTA").length;
    return { ok: false, reason: "not_enough_data", needed: BOT_MIN_CLOSED, have };
  }
  const closedCount = (facts.chosen?.n ?? 0) + (facts.filtered?.n ?? 0) + (facts.runner?.n ?? 0) + (facts.real?.n ?? 0);

  const { data: recent } = await supabase.from("bot_coach_reports").select("text,closed_count,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(BOT_MAX_PER_DAY);
  const last = (recent ?? [])[0] as { text: string; closed_count: number; created_at: string } | undefined;
  if (last && last.closed_count === closedCount && now - new Date(last.created_at).getTime() < BOT_MIN_GAP_MS) {
    return { ok: true, text: last.text, closed: closedCount, cached: true, createdAt: last.created_at };
  }
  const todayCount = (recent ?? []).filter((r: { created_at: string }) => now - new Date(r.created_at).getTime() < 86_400_000).length;
  if (todayCount >= BOT_MAX_PER_DAY) return { ok: false, reason: "limit", createdAt: last?.created_at ?? null, text: last?.text ?? null };

  if (!deps.hasKey) return { ok: false, reason: "no_key" };
  const { system, user } = buildBotPrompt(facts, lang);
  let text: string | null;
  try {
    text = await deps.ask(system, user);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!text || !text.trim()) return { ok: false, reason: "refused" };

  const createdAt = new Date(now).toISOString();
  await supabase.from("bot_coach_reports").insert({ user_id: userId, text: text.trim(), closed_count: closedCount, created_at: createdAt });
  const { data: all } = await supabase.from("bot_coach_reports").select("id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  const old = (all ?? []).slice(10).map((r: { id: string }) => r.id);
  if (old.length) await supabase.from("bot_coach_reports").delete().in("id", old);
  return { ok: true, text: text.trim(), closed: closedCount, cached: false, createdAt };
}

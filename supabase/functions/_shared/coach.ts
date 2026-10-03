// ─── VELTRIX · Coach de disciplina con IA ───────────────────────────────────
// Los números se calculan acá, con código (exactos y comprobables). La IA solo recibe esos datos ya calculados
// y los explica en lenguaje simple: no calcula nada y no inventa cifras. No da señales ni consejos de inversión.
// Sin dependencias de Deno ni de Node, para poder probarlo en local.

import { rOf, localDay } from "./dailySummary.ts";
import type { SumTrade } from "./dailySummary.ts";

export interface CoachTrade extends SumTrade {
  symbol: string;
  notes?: string | null;
  tags?: string[] | null;
}

export interface CoachProfile {
  timezone?: string | null;
  lang?: string | null;
  daily_loss_limit?: number | null;
  daily_trade_limit?: number | null;
}

export const MIN_CLOSED = 10; // con menos operaciones cerradas no hay patrones confiables
export const PERIOD_DAYS = 45;
const MIN_GROUP = 3; // un grupo con menos operaciones no se usa para sacar conclusiones

export interface Group {
  name: string;
  n: number;
  netR: number;
  avgR: number;
  winRate: number; // %
}

export interface CoachFacts {
  periodDays: number;
  closed: number;
  winRate: number; // %
  netR: number;
  avgR: number;
  profitFactor: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  plannedRR: number | null; // R:R medio planeado
  bySymbol: { best: Group | null; worst: Group | null };
  byWeekday: { best: Group | null; worst: Group | null };
  byDayPart: { best: Group | null; worst: Group | null };
  byDirection: Group[];
  afterLoss: { n: number; avgR: number | null; vsOverall: number | null }; // operaciones abiertas hasta 60 min después de un SL
  heavyDays: { days: number; avgR: number | null; limit: number | null }; // días con más operaciones que lo normal / el límite propio
  holdMinutes: { wins: number | null; losses: number | null }; // mediana
  withNotes: { pct: number; avgRWith: number | null; avgRWithout: number | null };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function group(name: string, rs: number[]): Group {
  const wins = rs.filter((r) => r > 0).length;
  return { name, n: rs.length, netR: round(rs.reduce((a, b) => a + b, 0)), avgR: round(rs.reduce((a, b) => a + b, 0) / rs.length), winRate: Math.round((wins / rs.length) * 100) };
}

function bestWorst(map: Map<string, number[]>): { best: Group | null; worst: Group | null } {
  const groups = [...map.entries()].filter(([, rs]) => rs.length >= MIN_GROUP).map(([k, rs]) => group(k, rs));
  if (groups.length < 2) return { best: null, worst: null };
  const sorted = [...groups].sort((a, b) => b.avgR - a.avgR);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return { best: best.avgR > 0 ? best : null, worst: worst.avgR < 0 ? worst : null };
}

const push = (m: Map<string, number[]>, k: string, v: number) => m.set(k, [...(m.get(k) ?? []), v]);

/** Franja del día según la hora local de apertura. */
function dayPart(hour: number, en: boolean): string {
  if (hour >= 6 && hour < 12) return en ? "morning (6-12)" : "mañana (6-12)";
  if (hour >= 12 && hour < 18) return en ? "afternoon (12-18)" : "tarde (12-18)";
  if (hour >= 18) return en ? "evening (18-24)" : "noche (18-24)";
  return en ? "night (0-6)" : "madrugada (0-6)";
}

const localParts = (ts: string | number, tz: string) => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", hour12: false });
  const parts = f.formatToParts(new Date(ts));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return { hour, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd) };
};

export function computeFacts(trades: CoachTrade[], p: CoachProfile, now: number): CoachFacts | null {
  const en = p.lang === "en";
  const tz = p.timezone && isValidTz(p.timezone) ? p.timezone : "UTC";
  const since = now - PERIOD_DAYS * 86_400_000;
  const closed = trades
    .filter((t) => t.outcome !== "ABIERTA" && new Date(t.closed_at ?? t.date).getTime() >= since)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (closed.length < MIN_CLOSED) return null;

  const rs = closed.map(rOf);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const sumWins = wins.reduce((a, b) => a + b, 0);
  const sumLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const overall = rs.reduce((a, b) => a + b, 0) / rs.length;

  const bySymbol = new Map<string, number[]>();
  const byWeekday = new Map<string, number[]>();
  const byPart = new Map<string, number[]>();
  const byDir = new Map<string, number[]>();
  const perDay = new Map<string, number[]>();
  closed.forEach((t, i) => {
    const r = rs[i];
    push(bySymbol, t.symbol, r);
    const { hour, weekday } = localParts(t.date, tz);
    push(byWeekday, (en ? WEEKDAYS_EN : WEEKDAYS_ES)[weekday], r);
    push(byPart, dayPart(hour, en), r);
    push(byDir, t.direction === "LONG" ? (en ? "buys (LONG)" : "compras (LONG)") : en ? "sells (SHORT)" : "ventas (SHORT)", r);
    push(perDay, localDay(t.date, tz), r);
  });

  // Después de una pérdida: operaciones abiertas hasta 60 min después de que se cerró un SL.
  const slCloses = closed.filter((t) => t.outcome === "SL" || rOf(t) < 0).map((t) => new Date(t.closed_at ?? t.date).getTime());
  const afterLossR: number[] = [];
  closed.forEach((t, i) => {
    const opened = new Date(t.date).getTime();
    if (slCloses.some((c) => opened > c && opened - c <= 3_600_000)) afterLossR.push(rs[i]);
  });
  const afterAvg = avg(afterLossR);

  // Días "cargados": más operaciones que el límite propio, o el doble de lo habitual si no hay límite.
  const counts = [...perDay.values()].map((a) => a.length);
  const limit = p.daily_trade_limit && p.daily_trade_limit > 0 ? p.daily_trade_limit : null;
  const threshold = limit ?? Math.max(3, Math.ceil((median(counts) ?? 1) * 2));
  const heavy = [...perDay.values()].filter((a) => a.length > threshold);
  const heavyR = heavy.flat();

  const holdW: number[] = [];
  const holdL: number[] = [];
  closed.forEach((t, i) => {
    if (!t.closed_at) return;
    const mins = (new Date(t.closed_at).getTime() - new Date(t.date).getTime()) / 60_000;
    if (mins < 0 || mins > 60 * 24 * 14) return;
    (rs[i] > 0 ? holdW : holdL).push(mins);
  });

  const withNotes = closed.map((t) => !!(t.notes && t.notes.trim()) || !!t.tags?.length);
  const rWith = rs.filter((_, i) => withNotes[i]);
  const rWithout = rs.filter((_, i) => !withNotes[i]);

  const planned = closed.map((t) => {
    const risk = Math.abs(t.entry - t.sl);
    return risk > 0 ? Math.abs(t.tp - t.entry) / risk : null;
  }).filter((x): x is number => x != null);

  const rnd = (x: number | null, d = 2) => (x == null ? null : round(x, d));
  return {
    periodDays: PERIOD_DAYS,
    closed: closed.length,
    winRate: Math.round((wins.length / closed.length) * 100),
    netR: round(rs.reduce((a, b) => a + b, 0)),
    avgR: round(overall),
    profitFactor: sumLoss > 0 ? round(sumWins / sumLoss) : null,
    avgWinR: rnd(avg(wins)),
    avgLossR: rnd(avg(losses)),
    plannedRR: rnd(avg(planned)),
    bySymbol: bestWorst(bySymbol),
    byWeekday: bestWorst(byWeekday),
    byDayPart: bestWorst(byPart),
    byDirection: [...byDir.entries()].filter(([, a]) => a.length >= MIN_GROUP).map(([k, a]) => group(k, a)),
    afterLoss: { n: afterLossR.length, avgR: rnd(afterAvg), vsOverall: afterAvg == null ? null : round(afterAvg - overall) },
    heavyDays: { days: heavy.length, avgR: rnd(avg(heavyR)), limit },
    holdMinutes: { wins: rnd(median(holdW), 0), losses: rnd(median(holdL), 0) },
    withNotes: { pct: Math.round((rWith.length / closed.length) * 100), avgRWith: rnd(avg(rWith)), avgRWithout: rnd(avg(rWithout)) },
  };
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ─── Mensaje para la IA ─────────────────────────────────────────────────────

export function buildPrompt(facts: CoachFacts, lang: "es" | "en"): { system: string; user: string } {
  const en = lang === "en";
  const system = en
    ? `You are the discipline coach inside VELTRIX, a trading journal. You receive FACTS already calculated from the trader's own journal (R = result measured in units of risk: +2R means the trade earned twice what was risked).

Rules:
- Use ONLY the numbers in the facts. Never invent, estimate or recalculate figures. If a field is null or missing, say nothing about it.
- Talk about behavior and habits (when, how often, what happens after a loss, notes), not about what to buy or sell. Never give trade signals, price predictions or investment advice.
- Be warm, direct and specific, like a good coach. No lectures, no jargon, no emojis except at most one at the start.
- Past results do not predict the future: do not promise gains.
- Format, in English, 150 words maximum:
  1) One sentence with the overall picture.
  2) Up to 3 short bullets with the most useful patterns (what is working, what is costing the trader).
  3) One single concrete action for the next week, measurable.
- Sample sizes are small: mention the number of trades when a pattern rests on few (under 8).`
    : `Sos el coach de disciplina dentro de VELTRIX, un diario de trading. Recibís HECHOS ya calculados a partir del propio diario de la persona (R = resultado medido en unidades de riesgo: +2R significa que ganó el doble de lo que arriesgó).

Reglas:
- Usá SOLO los números de los hechos. No inventes, estimes ni recalcules cifras. Si un campo es null o falta, no digas nada sobre eso.
- Hablá de conducta y hábitos (cuándo, con qué frecuencia, qué pasa después de una pérdida, notas), no de qué comprar o vender. Nunca des señales, predicciones de precio ni consejos de inversión.
- Sé cálido, directo y concreto, como un buen entrenador. Sin sermones, sin jerga, sin emojis salvo uno al comienzo como máximo.
- Los resultados pasados no predicen el futuro: no prometas ganancias.
- Formato, en español rioplatense (vos), máximo 150 palabras:
  1) Una frase con el panorama general.
  2) Hasta 3 viñetas cortas con los patrones más útiles (qué funciona, qué le está costando).
  3) Una sola acción concreta y medible para la próxima semana.
- Las muestras son chicas: nombrá la cantidad de operaciones cuando un patrón se apoye en pocas (menos de 8).`;
  const user = `${en ? "FACTS (JSON):" : "HECHOS (JSON):"}\n${JSON.stringify(facts)}`;
  return { system, user };
}

// ─── Informe con caché y límites ────────────────────────────────────────────

export const MIN_GAP_MS = 6 * 3_600_000; // si no cambió nada, se reutiliza el último informe durante 6 horas
export const MAX_PER_DAY = 3;

export type CoachResult =
  | { ok: true; text: string; closed: number; cached: boolean; createdAt: string }
  | { ok: false; reason: "not_enough_data"; needed: number; have: number }
  | { ok: false; reason: "limit"; createdAt: string | null; text: string | null }
  | { ok: false; reason: "refused" | "unavailable" | "no_key" };

interface CoachDeps {
  supabase: any;
  /** Llama a la IA con el mensaje y devuelve el texto (o null si se negó). Lanza un error si el servicio falla. */
  ask: (system: string, user: string) => Promise<string | null>;
  hasKey: boolean;
}

export async function coachReport(deps: CoachDeps, userId: string, now = Date.now()): Promise<CoachResult> {
  const { supabase } = deps;
  const { data: profile } = await supabase.from("profiles").select("timezone,lang,daily_loss_limit,daily_trade_limit").eq("id", userId).maybeSingle();
  const prof: CoachProfile = profile ?? {};
  const since = new Date(now - (PERIOD_DAYS + 7) * 86_400_000).toISOString();
  const { data: trades } = await supabase
    .from("trades")
    .select("symbol,direction,entry,tp,sl,date,outcome,exit,closed_at,notes,tags")
    .eq("user_id", userId)
    .gte("date", since)
    .limit(2000);
  const facts = computeFacts((trades ?? []) as CoachTrade[], prof, now);
  const closedCount = facts?.closed ?? 0;
  if (!facts) {
    const have = ((trades ?? []) as CoachTrade[]).filter((t) => t.outcome !== "ABIERTA").length;
    return { ok: false, reason: "not_enough_data", needed: MIN_CLOSED, have };
  }

  const { data: recent } = await supabase
    .from("coach_reports")
    .select("text,closed_count,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_PER_DAY);
  const last = (recent ?? [])[0] as { text: string; closed_count: number; created_at: string } | undefined;

  // Mismo diario y poco tiempo: se devuelve el informe anterior sin gastar una consulta nueva.
  if (last && last.closed_count === closedCount && now - new Date(last.created_at).getTime() < MIN_GAP_MS) {
    return { ok: true, text: last.text, closed: closedCount, cached: true, createdAt: last.created_at };
  }
  const todayCount = (recent ?? []).filter((r: any) => now - new Date(r.created_at).getTime() < 86_400_000).length;
  if (todayCount >= MAX_PER_DAY) {
    return { ok: false, reason: "limit", createdAt: last?.created_at ?? null, text: last?.text ?? null };
  }

  if (!deps.hasKey) return { ok: false, reason: "no_key" };
  const lang: "es" | "en" = prof.lang === "en" ? "en" : "es";
  const { system, user } = buildPrompt(facts, lang);
  let text: string | null;
  try {
    text = await deps.ask(system, user);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!text || !text.trim()) return { ok: false, reason: "refused" };

  const createdAt = new Date(now).toISOString();
  await supabase.from("coach_reports").insert({ user_id: userId, text: text.trim(), closed_count: closedCount, created_at: createdAt });
  // Se guardan solo los últimos informes de cada persona.
  const { data: all } = await supabase.from("coach_reports").select("id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  const old = (all ?? []).slice(10).map((r: any) => r.id);
  if (old.length) await supabase.from("coach_reports").delete().in("id", old);
  return { ok: true, text: text.trim(), closed: closedCount, cached: false, createdAt };
}

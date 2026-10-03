// ─── VELTRIX · Resumen diario y rachas ──────────────────────────────────────
// Cada noche (21:00 en la zona horaria de cada persona) se manda por Telegram y como notificación un resumen del día:
// operaciones cerradas, resultado en R (y en dinero si cargó su capital) y tres rachas.
// Sin dependencias de Deno ni de Node, para poder probarlo en local.

export interface SumTrade {
  direction: "LONG" | "SHORT";
  entry: number;
  tp: number;
  sl: number;
  date: string; // apertura
  outcome: string; // ABIERTA | TP | SL | MANUAL
  exit: number | null;
  closed_at: string | null;
}

export interface SumProfile {
  timezone: string | null;
  lang?: string | null;
  capital?: number | null;
  risk_pct?: number | null;
  currency?: string | null;
  daily_loss_limit?: number | null;
  daily_trade_limit?: number | null;
}

export interface DaySummary {
  day: string; // YYYY-MM-DD en la zona de la persona
  opened: number; // operaciones abiertas hoy
  closed: number;
  wins: number;
  losses: number;
  netR: number;
  stillOpen: number;
  activeStreak: number; // días seguidos con actividad
  greenStreak: number; // días seguidos cerrando en verde
  disciplineStreak: number | null; // días con actividad dentro de los límites (null si no hay límites)
}

export const SUMMARY_HOUR = 21; // hora local del aviso
const LOOKBACK_DAYS = 60;

/** R obtenido: TP = +R:R planificado · SL = −1 · MANUAL = (salida−entrada)/riesgo. */
export function rOf(t: SumTrade): number {
  const risk = Math.abs(t.entry - t.sl);
  if (t.outcome === "ABIERTA" || risk <= 0) return 0;
  const dir = t.direction === "LONG" ? 1 : -1;
  if (t.outcome === "TP") return (dir * (t.tp - t.entry)) / risk;
  if (t.outcome === "SL") return -1;
  return (dir * ((t.exit ?? t.entry) - t.entry)) / risk;
}

const validTz = (tz: string | null | undefined): string | null => {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
};

/** Día calendario (YYYY-MM-DD) de un instante en una zona horaria. */
export function localDay(ts: number | string | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

export function localHour(ts: number | Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(ts));
  return Number(h) % 24;
}

const shiftDay = (day: string, delta: number): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

/** ¿Ya es la hora del resumen para esta persona? (entre las 21:00 y la medianoche). */
export function isSummaryTime(now: number, tz: string | null | undefined): boolean {
  const z = validTz(tz);
  return !!z && localHour(now, z) >= SUMMARY_HOUR;
}

export function summarize(trades: SumTrade[], p: SumProfile, now: number): DaySummary | null {
  const tz = validTz(p.timezone);
  if (!tz) return null;
  const today = localDay(now, tz);

  const opened = new Map<string, number>(); // día → operaciones abiertas
  const closedR = new Map<string, number>(); // día → R neto de lo cerrado
  const closedN = new Map<string, number>();
  let stillOpen = 0;
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    const od = localDay(t.date, tz);
    opened.set(od, (opened.get(od) ?? 0) + 1);
    if (t.outcome === "ABIERTA") {
      stillOpen++;
      continue;
    }
    const cd = localDay(t.closed_at ?? t.date, tz);
    const r = rOf(t);
    closedR.set(cd, (closedR.get(cd) ?? 0) + r);
    closedN.set(cd, (closedN.get(cd) ?? 0) + 1);
    if (cd === today) {
      if (r > 0) wins++;
      else if (r < 0) losses++;
    }
  }

  const active = (d: string) => (opened.get(d) ?? 0) > 0 || (closedN.get(d) ?? 0) > 0;
  const netOf = (d: string) => closedR.get(d) ?? 0;

  let activeStreak = 0;
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    if (!active(shiftDay(today, -i))) break;
    activeStreak++;
  }

  let greenStreak = 0;
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const d = shiftDay(today, -i);
    if (!((closedN.get(d) ?? 0) > 0 && netOf(d) > 0)) break;
    greenStreak++;
  }

  // Disciplina: los días sin operar no cortan la racha; cuenta los días con actividad hasta el primero que rompió un límite.
  const lossLimit = p.daily_loss_limit && p.daily_loss_limit > 0 ? p.daily_loss_limit : null;
  const tradeLimit = p.daily_trade_limit && p.daily_trade_limit > 0 ? p.daily_trade_limit : null;
  let disciplineStreak: number | null = null;
  if (lossLimit != null || tradeLimit != null) {
    disciplineStreak = 0;
    for (let i = 0; i < LOOKBACK_DAYS; i++) {
      const d = shiftDay(today, -i);
      if (!active(d)) continue;
      const brokeTrades = tradeLimit != null && (opened.get(d) ?? 0) > tradeLimit;
      const brokeLoss = lossLimit != null && netOf(d) <= -lossLimit;
      if (brokeTrades || brokeLoss) break;
      disciplineStreak++;
    }
  }

  return {
    day: today,
    opened: opened.get(today) ?? 0,
    closed: closedN.get(today) ?? 0,
    wins,
    losses,
    netR: netOf(today),
    stillOpen,
    activeStreak,
    greenStreak,
    disciplineStreak,
  };
}

/** Hoy no pasó nada: no se manda nada, para no molestar. */
export const hasActivity = (s: DaySummary) => s.opened > 0 || s.closed > 0;

const fmtR = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;
const SYMBOLS: Record<string, string> = { USD: "$", USDT: "$", USDC: "$", EUR: "€", GBP: "£" };
const fmtMoney = (n: number, cur: string) => {
  const sym = SYMBOLS[cur.toUpperCase()] ?? cur.toUpperCase() + " ";
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}${sym}${body}`;
};

const days = (n: number, en: boolean) => (en ? `${n} day${n === 1 ? "" : "s"}` : `${n} día${n === 1 ? "" : "s"}`);

/** Mensaje en HTML de Telegram. */
export function buildSummaryMessage(s: DaySummary, p: SumProfile, lang: "es" | "en"): string {
  const en = lang === "en";
  const lines: string[] = [];
  lines.push(`📊 <b>${en ? "Today's summary" : "Resumen de hoy"}</b> · VELTRIX`);
  lines.push("");

  if (s.closed > 0) {
    lines.push(
      `${en ? "Closed" : "Cerradas"}: <b>${s.closed}</b> (${s.wins} ✅ · ${s.losses} ❌)`,
    );
    const unit = p.capital && p.risk_pct && p.capital > 0 && p.risk_pct > 0 ? (p.capital * p.risk_pct) / 100 : null;
    const money = unit != null ? ` · ${fmtMoney(s.netR * unit, p.currency ?? "USD")}` : "";
    lines.push(`${en ? "Result" : "Resultado"}: <b>${fmtR(s.netR)}</b>${money}`);
  } else {
    lines.push(en ? "No trades closed today." : "Hoy no cerraste operaciones.");
  }
  if (s.opened > 0) lines.push(`${en ? "Opened today" : "Abiertas hoy"}: ${s.opened}`);
  if (s.stillOpen > 0) lines.push(`${en ? "Still open" : "Siguen abiertas"}: ${s.stillOpen}`);

  const streaks: string[] = [];
  if (s.activeStreak >= 2) streaks.push(en ? `🔥 Logging for <b>${days(s.activeStreak, en)}</b> in a row` : `🔥 Registrás hace <b>${days(s.activeStreak, en)}</b> seguidos`);
  if (s.greenStreak >= 2) streaks.push(en ? `🟢 <b>${days(s.greenStreak, en)}</b> in the green in a row` : `🟢 <b>${days(s.greenStreak, en)}</b> en verde seguidos`);
  if (s.disciplineStreak != null && s.disciplineStreak >= 2)
    streaks.push(en ? `🛡️ <b>${days(s.disciplineStreak, en)}</b> within your limits` : `🛡️ <b>${days(s.disciplineStreak, en)}</b> dentro de tus límites`);
  if (streaks.length) {
    lines.push("");
    lines.push(...streaks);
  }

  lines.push("");
  if (s.closed === 0) lines.push(en ? "Resting is part of the plan too." : "Descansar también es parte del plan.");
  else if (s.netR > 0) lines.push(en ? "Good day. Same plan tomorrow." : "Buen día. Mañana, el mismo plan.");
  else if (s.netR < 0) lines.push(en ? "Tough day. Check if you followed your plan: a loss within the plan is not a mistake." : "Día difícil. Revisá si seguiste tu plan: una pérdida dentro del plan no es un error.");
  else lines.push(en ? "Flat day. Consistency is what matters." : "Día parejo. Lo que importa es la constancia.");
  return lines.join("\n");
}

/** Texto corto para la notificación del celular. */
export function buildSummaryPush(s: DaySummary, lang: "es" | "en"): { title: string; body: string } {
  const en = lang === "en";
  const parts: string[] = [];
  if (s.closed > 0) parts.push(fmtR(s.netR));
  else parts.push(en ? "no closed trades" : "sin cerradas");
  if (s.activeStreak >= 2) parts.push(`🔥 ${days(s.activeStreak, en)}`);
  return { title: `📊 ${en ? "Today's summary" : "Resumen de hoy"}`, body: parts.join(" · ") };
}

// ─── Envío ──────────────────────────────────────────────────────────────────

interface Deps {
  supabase: any;
  /** Manda un mensaje de Telegram; devuelve el resultado de la API. */
  telegram: (chatId: number, html: string) => Promise<{ ok?: boolean; error_code?: number } | void>;
  push: (messages: Array<{ to: string; title: string; body: string; data?: Record<string, unknown> }>) => Promise<void>;
}

/**
 * Revisa a quién le toca el resumen (a partir de las 21:00 de su zona horaria, una vez por día) y se lo manda.
 * Devuelve cuántos resúmenes se enviaron.
 */
export async function sendDailySummaries(deps: Deps, now = Date.now()): Promise<number> {
  const { supabase } = deps;
  const { data: links } = await supabase.from("telegram_links").select("user_id,chat_id");
  const { data: tokens } = await supabase.from("device_tokens").select("user_id,expo_push_token");
  const chatOf = new Map<string, number>((links ?? []).map((l: any) => [l.user_id as string, Number(l.chat_id)]));
  const tokensOf = new Map<string, string[]>();
  for (const t of tokens ?? []) tokensOf.set(t.user_id, [...(tokensOf.get(t.user_id) ?? []), t.expo_push_token]);
  const ids = [...new Set([...chatOf.keys(), ...tokensOf.keys()])];
  if (!ids.length) return 0;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,timezone,lang,capital,risk_pct,currency,daily_loss_limit,daily_trade_limit,daily_summary,last_summary_date")
    .in("id", ids);

  let sent = 0;
  for (const p of profiles ?? []) {
    if (p.daily_summary === false) continue;
    const tz = validTz(p.timezone);
    if (!tz || !isSummaryTime(now, tz)) continue;
    const today = localDay(now, tz);
    if (p.last_summary_date === today) continue;

    // Se marca antes de armar el mensaje: si algo falla, no se reintenta cada 10 minutos toda la noche.
    await supabase.from("profiles").update({ last_summary_date: today }).eq("id", p.id);

    const since = new Date(now - (LOOKBACK_DAYS + 10) * 86_400_000).toISOString();
    const { data: trades } = await supabase
      .from("trades")
      .select("direction,entry,tp,sl,date,outcome,exit,closed_at")
      .eq("user_id", p.id)
      .gte("date", since)
      .limit(2000);
    const s = summarize((trades ?? []) as SumTrade[], p, now);
    if (!s || !hasActivity(s)) continue;

    const lang: "es" | "en" = p.lang === "en" ? "en" : "es";
    const chat = chatOf.get(p.id);
    if (chat != null) {
      const r = await deps.telegram(chat, buildSummaryMessage(s, p, lang));
      if (r && r.ok === false && r.error_code === 403) await supabase.from("telegram_links").delete().eq("user_id", p.id);
    }
    const mine = tokensOf.get(p.id);
    if (mine?.length) {
      const msg = buildSummaryPush(s, lang);
      await deps.push(mine.map((to) => ({ to, ...msg })));
    }
    sent++;
  }
  return sent;
}

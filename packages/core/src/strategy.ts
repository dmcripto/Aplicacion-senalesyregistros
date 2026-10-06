// ─── VELTRIX · Estrategia sugerida ──────────────────────────────────────────
// Arma reglas concretas a partir de las operaciones cerradas del diario (incluidas
// las que se importan solas desde el exchange). Es estadística sobre el pasado:
// no promete ganancias. Cada regla trae su evidencia, su nivel de confianza y,
// cuando se puede, una comprobación con operaciones que no se usaron para armarla.
// Va aparte de trading.ts para no engordarlo; el R de cada operación lo pasa quien llama.

import { getLang, t as tr } from "./i18n";
import type { Trade } from "./trading";

export type Confidence = "low" | "medium" | "high";
export type EdgeVerdict = "none" | "unproven" | "likely";

export interface StrategyMetrics {
  n: number;
  winRate: number; // %
  avgWin: number; // R, positivo
  avgLoss: number; // R, positivo
  payoff: number; // avgWin / avgLoss
  expectancy: number; // R promedio por operación
  profitFactor: number | null; // null = sin pérdidas
  netR: number;
  maxDrawdownR: number; // caída máxima de la curva, en R (positivo)
  maxLossStreak: number;
}

/**
 * Lo que el bot automático sabe hacer con una regla. Mismo formato que en supabase/functions/_shared/botStrategy.ts
 * (la función del servidor no puede importar el núcleo, así que el tipo y `actionId` se repiten allá).
 */
export type BotDim = "symbol" | "weekday" | "hour" | "direction";
export type BotAction = { op: "skip" | "only"; dim: BotDim; key: string } | { op: "maxPerDay"; n: number } | { op: "stopAfterLosses"; n: number };

export const actionId = (a: BotAction) => ("dim" in a ? `${a.op}:${a.dim}:${a.key}` : `${a.op}:${a.n}`);

export interface StrategyRule {
  /** Identificador estable (sirve de clave en pantalla). */
  id: string;
  kind: "avoid" | "focus" | "risk" | "habit";
  title: string;
  why: string;
  confidence: Confidence;
  /** Cuánto habría cambiado el R neto con esta regla (solo avoid/focus). */
  impactR?: number;
  /** Si el bot automático puede aplicarla, qué haría; si no, queda solo como consejo para vos. */
  action?: BotAction;
  /** Frase que explica qué hará el bot si se aplica. */
  effect?: string;
}

export interface StrategyValidation {
  trainN: number;
  testN: number;
  avoidedN: number; // operaciones recientes que la regla habría evitado
  avoidedR: number; // lo que esas operaciones sumaron (negativo = la regla ayudó)
  held: boolean;
}

export type StrategyPlan =
  | { ok: false; needed: number; have: number }
  | {
      ok: true;
      profile: StrategyMetrics;
      edge: EdgeVerdict;
      style: string;
      headline: string;
      rules: StrategyRule[];
      before: StrategyMetrics;
      after: StrategyMetrics | null; // con las reglas de "evitar" aplicadas a lo ya ocurrido
      avoidedTrades: number;
      validation: StrategyValidation | null;
      lowSample: boolean; // menos de 30 operaciones: cualquier conclusión es provisoria
      source: string; // "all" | "manual" | id del exchange cuyas operaciones se usaron
    };

export const STRATEGY_MIN_TRADES = 10;
const MIN_SEG = 5; // mínimo de operaciones para opinar de un grupo
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const HOUR_BLOCKS = ["00–03 h", "03–06 h", "06–09 h", "09–12 h", "12–15 h", "15–18 h", "18–21 h", "21–24 h"];

interface Row {
  t: Trade;
  r: number;
  open: number; // ms de apertura
  close: number; // ms de cierre (o apertura si no hay)
  cap: number | null; // capital de la persona (para medir el tamaño de la posición contra él)
}

interface Seg {
  dim: "symbol" | "weekday" | "hour" | "direction" | "tag" | "leverage" | "size" | "duration";
  key: string;
  label: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtR = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1).replace(/\.0$/, "") + "R";
const num1 = (n: number) => n.toFixed(1).replace(/\.0$/, "");

export function metricsOf(rs: number[]): StrategyMetrics {
  const n = rs.length;
  if (!n) return { n: 0, winRate: 0, avgWin: 0, avgLoss: 0, payoff: 0, expectancy: 0, profitFactor: null, netR: 0, maxDrawdownR: 0, maxLossStreak: 0 };
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const gain = wins.reduce((a, b) => a + b, 0);
  const loss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const avgWin = wins.length ? gain / wins.length : 0;
  const avgLoss = losses.length ? loss / losses.length : 0;
  let cum = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
  for (const r of rs) {
    cum += r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    if (r < 0) maxStreak = Math.max(maxStreak, ++streak);
    else if (r > 0) streak = 0;
  }
  return {
    n,
    winRate: (wins.length / n) * 100,
    avgWin,
    avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : 0,
    expectancy: (gain - loss) / n,
    profitFactor: loss > 0 ? gain / loss : null,
    netR: gain - loss,
    maxDrawdownR: dd,
    maxLossStreak: maxStreak,
  };
}

/** ¿La ventaja es real o puede ser suerte? Compara el promedio con su margen de error (t ≈ 2). */
function edgeOf(rs: number[]): EdgeVerdict {
  const m = metricsOf(rs);
  if (m.expectancy <= 0) return "none";
  if (rs.length < 30) return "unproven";
  const mean = m.expectancy;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (rs.length - 1));
  if (sd === 0) return "likely";
  return mean / (sd / Math.sqrt(rs.length)) >= 2 ? "likely" : "unproven";
}

// ─── Cómo se gestionó la operación: apalancamiento, tamaño y duración ────────

function leverageSeg(x: number): Seg {
  if (x <= 3) return { dim: "leverage", key: "L1", label: tr("hasta 3x") };
  if (x <= 10) return { dim: "leverage", key: "L2", label: tr("entre 4x y 10x") };
  if (x <= 25) return { dim: "leverage", key: "L3", label: tr("entre 11x y 25x") };
  return { dim: "leverage", key: "L4", label: tr("más de 25x") };
}

/** Tamaño de la posición contra el capital: cuántas veces el capital vale lo que se operó. */
function sizeSeg(times: number): Seg {
  if (times <= 0.5) return { dim: "size", key: "S1", label: tr("hasta la mitad de tu capital") };
  if (times <= 2) return { dim: "size", key: "S2", label: tr("entre la mitad y 2 veces tu capital") };
  if (times <= 5) return { dim: "size", key: "S3", label: tr("entre 2 y 5 veces tu capital") };
  return { dim: "size", key: "S4", label: tr("más de 5 veces tu capital") };
}

function durationSeg(hours: number): Seg {
  if (hours < 1) return { dim: "duration", key: "D1", label: tr("menos de 1 hora") };
  if (hours < 4) return { dim: "duration", key: "D2", label: tr("entre 1 y 4 horas") };
  if (hours < 24) return { dim: "duration", key: "D3", label: tr("entre 4 y 24 horas") };
  return { dim: "duration", key: "D4", label: tr("más de 1 día") };
}

function segsOf(row: Row): Seg[] {
  const d = new Date(row.open);
  const out: Seg[] = [
    { dim: "symbol", key: row.t.symbol, label: row.t.symbol },
    { dim: "weekday", key: String(d.getDay()), label: tr(WEEKDAYS[d.getDay()]) },
    { dim: "hour", key: String(Math.floor(d.getHours() / 3)), label: HOUR_BLOCKS[Math.floor(d.getHours() / 3)] },
    { dim: "direction", key: row.t.direction, label: row.t.direction === "LONG" ? tr("compras") : tr("ventas") },
  ];
  for (const tag of row.t.tags ?? []) out.push({ dim: "tag", key: tag, label: tag });
  // Gestión de la operación: solo cuando se conoce el dato (si falta, la operación no cuenta en ese grupo).
  if (row.t.leverage != null && row.t.leverage > 0) out.push(leverageSeg(row.t.leverage));
  if (row.t.sizeUsd != null && row.t.sizeUsd > 0 && row.cap != null && row.cap > 0) out.push(sizeSeg(row.t.sizeUsd / row.cap));
  const hrs = (row.close - row.open) / 3_600_000;
  if (hrs > 0) out.push(durationSeg(hrs));
  return out;
}

const segId = (s: Seg) => `${s.dim}:${s.key}`;

function phrase(s: Seg, verb: "avoid" | "focus"): string {
  const low = (x: string) => (getLang() === "es" ? x.toLowerCase() : x);
  switch (s.dim) {
    case "symbol":
      return verb === "avoid" ? tr("Dejá de operar {x} por ahora", { x: s.label }) : tr("Concentrate en {x}", { x: s.label });
    case "weekday":
      return verb === "avoid" ? tr("Evitá operar los {x}", { x: low(s.label) }) : tr("Operá más los {x}", { x: low(s.label) });
    case "hour":
      return verb === "avoid" ? tr("Evitá operar entre {x}", { x: s.label }) : tr("Operá entre {x}", { x: s.label });
    case "direction":
      return verb === "avoid" ? tr("Evitá las {x} por ahora", { x: s.label }) : tr("Priorizá las {x}", { x: s.label });
    case "leverage":
      return verb === "avoid" ? tr("Evitá operar con {x} de apalancamiento", { x: s.label }) : tr("Con {x} de apalancamiento te va mejor: quedate en ese rango", { x: s.label });
    case "size":
      return verb === "avoid" ? tr("Achicá tus posiciones: las de {x} te están costando", { x: s.label }) : tr("Las posiciones de {x} te funcionan: mantené ese tamaño", { x: s.label });
    case "duration":
      return verb === "avoid" ? tr("Las operaciones de {x} te están costando: revisá cuándo entrás y cuándo salís", { x: s.label }) : tr("Tus mejores operaciones duran {x}: dales ese tiempo", { x: s.label });
    default:
      return verb === "avoid" ? tr("Revisá el método «{x}»: te está costando", { x: s.label }) : tr("Reforzá el método «{x}»", { x: s.label });
  }
}

const BOT_DIMS = ["symbol", "weekday", "hour", "direction"] as const;

/** Qué hará el bot con la regla, en una frase (según el grupo `seg` del que salió). */
function effectOf(a: BotAction, seg?: Seg): string {
  const low = (x: string) => (getLang() === "es" ? x.toLowerCase() : x);
  if (a.op === "maxPerDay") return tr("El bot abrirá como máximo {n} operaciones por día.", { n: a.n });
  if (a.op === "stopAfterLosses") return tr("Tras {n} pérdidas seguidas el bot frena el resto del día.", { n: a.n });
  const label = seg?.label ?? a.key;
  const skip = a.op === "skip";
  switch (a.dim) {
    case "symbol":
      return skip ? tr("El bot no operará {x}.", { x: label }) : tr("El bot operará solo {x}.", { x: label });
    case "weekday":
      return skip ? tr("El bot no anotará señales los {x}.", { x: low(label) }) : tr("El bot solo operará los {x}.", { x: low(label) });
    case "hour":
      return skip ? tr("El bot no anotará señales entre {x}.", { x: label }) : tr("El bot solo anotará señales entre {x}.", { x: label });
    default:
      return skip ? tr("El bot no abrirá {x}.", { x: label }) : tr("El bot solo abrirá {x}.", { x: label });
  }
}

/** La misma frase, a partir de la regla guardada (sin necesidad del plan): «El bot no operará ETHUSDT.» */
export function ruleSentence(a: BotAction): string {
  if (!("dim" in a)) return effectOf(a);
  const label =
    a.dim === "weekday" ? tr(WEEKDAYS[Number(a.key)] ?? a.key) : a.dim === "hour" ? (HOUR_BLOCKS[Number(a.key)] ?? a.key) : a.dim === "direction" ? (a.key === "LONG" ? tr("compras") : tr("ventas")) : a.key;
  return effectOf(a, { dim: a.dim, key: a.key, label });
}

/** La acción que el bot puede aplicar para un grupo (null si el grupo no tiene sentido para el bot, p. ej. una etiqueta). */
function actionOfSeg(seg: Seg, op: "skip" | "only"): BotAction | null {
  return (BOT_DIMS as readonly string[]).includes(seg.dim) ? { op, dim: seg.dim as BotDim, key: seg.key } : null;
}

interface SegStat {
  seg: Seg;
  n: number;
  netR: number;
  exp: number;
  consistent: boolean; // el signo se repite en la mitad vieja y en la nueva
  idx: number[]; // posiciones de sus operaciones
}

function segmentStats(rows: Row[]): SegStat[] {
  const byId = new Map<string, { seg: Seg; idx: number[] }>();
  rows.forEach((row, i) => {
    for (const s of segsOf(row)) {
      const e = byId.get(segId(s)) ?? { seg: s, idx: [] };
      e.idx.push(i);
      byId.set(segId(s), e);
    }
  });
  const half = Math.floor(rows.length / 2);
  const out: SegStat[] = [];
  for (const { seg, idx } of byId.values()) {
    if (idx.length < MIN_SEG) continue;
    const rs = idx.map((i) => rows[i].r);
    const netR = rs.reduce((a, b) => a + b, 0);
    const a = idx.filter((i) => i < half).map((i) => rows[i].r);
    const b = idx.filter((i) => i >= half).map((i) => rows[i].r);
    const sign = (xs: number[]) => Math.sign(xs.reduce((s, x) => s + x, 0));
    out.push({ seg, n: idx.length, netR, exp: netR / idx.length, idx, consistent: a.length >= 2 && b.length >= 2 && sign(a) !== 0 && sign(a) === sign(b) });
  }
  return out;
}

const capConfidence = (c: Confidence, total: number): Confidence => (total < 20 ? "low" : total < 40 && c === "high" ? "medium" : c);

function confidenceOf(s: SegStat, total: number): Confidence {
  const c: Confidence = s.n >= 15 && s.consistent ? "high" : s.n >= 8 || s.consistent ? "medium" : "low";
  return capConfidence(c, total);
}

/** Qué grupos conviene evitar: pierden de forma clara y empeoran al promedio del resto. */
function avoidList(rows: Row[], stats: SegStat[]): SegStat[] {
  const total = rows.reduce((a, r) => a + r.r, 0);
  return stats
    .filter((s) => s.exp <= -0.3 && s.netR <= -1.5 && (total - s.netR) / Math.max(1, rows.length - s.n) > s.exp)
    .sort((a, b) => a.netR - b.netR);
}

function applyAvoid(rows: Row[], avoid: SegStat[]): { kept: Row[]; dropped: Row[] } {
  const ids = new Set(avoid.map((s) => segId(s.seg)));
  const kept: Row[] = [], dropped: Row[] = [];
  for (const row of rows) (segsOf(row).some((s) => ids.has(segId(s))) ? dropped : kept).push(row);
  return { kept, dropped };
}

/** Un solo grupo por tipo (el peor), para que el plan no se llene de reglas que se pisan. */
function onePerDim(list: SegStat[], max = 3): SegStat[] {
  const seen = new Set<string>();
  const out: SegStat[] = [];
  for (const s of list) {
    if (seen.has(s.seg.dim)) continue;
    // si casi las mismas operaciones ya quedaron cubiertas por otra regla, esta no agrega nada
    const dup = out.some((o) => {
      const mine = new Set(o.idx);
      const shared = s.idx.filter((i) => mine.has(i)).length;
      return shared / Math.min(s.idx.length, o.idx.length) >= 0.9;
    });
    if (dup) continue;
    seen.add(s.seg.dim);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const hours = (rows: Row[]) => rows.map((x) => (x.close - x.open) / 3_600_000).filter((h) => h > 0);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Plan de trading armado con lo que ya pasó en tu cuenta.
 * @param rOf resultado en R de una operación (resultR del núcleo); null/undefined = no cerrada.
 * @param riskPct riesgo por operación que usás hoy (opcional) para traducir las caídas a % del capital.
 */
export function buildStrategy(trades: Trade[], rOf: (t: Trade) => number | null, opts: { riskPct?: number | null; capital?: number | null; source?: string } = {}): StrategyPlan {
  const rows: Row[] = trades
    .map((t) => ({ t, r: rOf(t), open: new Date(t.date).getTime(), close: new Date(t.closedAt ?? t.date).getTime(), cap: opts.capital && opts.capital > 0 ? opts.capital : null }))
    .filter((x): x is Row => x.t.outcome !== "ABIERTA" && x.r != null && !Number.isNaN(x.open))
    .map((x) => ({ ...x, close: Number.isNaN(x.close) ? x.open : x.close }))
    .sort((a, b) => a.close - b.close);

  if (rows.length < STRATEGY_MIN_TRADES) return { ok: false, needed: STRATEGY_MIN_TRADES, have: rows.length };

  const rs = rows.map((x) => x.r);
  const profile = metricsOf(rs);
  const edge = edgeOf(rs);
  const total = rows.length;
  const stats = segmentStats(rows);
  const rules: StrategyRule[] = [];

  // 1) Qué evitar (lo que más plata te costó, con evidencia)
  const avoid = avoidList(rows, stats);
  const shownAvoid = onePerDim(avoid);
  for (const s of shownAvoid) {
    const action = actionOfSeg(s.seg, "skip");
    rules.push({
      id: action ? actionId(action) : `avoid:${s.seg.dim}:${s.seg.key}`,
      ...(action ? { action, effect: effectOf(action, s.seg) } : {}),
      kind: "avoid",
      title: phrase(s.seg, "avoid"),
      why: tr("En {n} operaciones sumaste {r} ({e} por operación). Sin ellas tu resultado habría sido {t}.", { n: s.n, r: fmtR(s.netR), e: fmtR(s.exp), t: fmtR(profile.netR - s.netR) }),
      confidence: confidenceOf(s, total),
      impactR: round1(-s.netR),
    });
  }

  // 2) Dónde tenés ventaja (para concentrar el esfuerzo)
  const focus = stats
    .filter((s) => s.exp >= 0.3 && s.netR >= 1.5 && s.exp > profile.expectancy)
    .sort((a, b) => b.netR - a.netR);
  for (const s of onePerDim(focus, 2)) {
    const action = actionOfSeg(s.seg, "only");
    rules.push({
      id: action ? actionId(action) : `focus:${s.seg.dim}:${s.seg.key}`,
      ...(action ? { action, effect: effectOf(action, s.seg) } : {}),
      kind: "focus",
      title: phrase(s.seg, "focus"),
      why: tr("En {n} operaciones sumaste {r} ({e} por operación), por encima de tu promedio de {a}.", { n: s.n, r: fmtR(s.netR), e: fmtR(s.exp), a: fmtR(profile.expectancy) }),
      confidence: confidenceOf(s, total) === "high" ? "medium" : confidenceOf(s, total), // lo que mejor salió en el pasado se sobreestima
      impactR: round1(s.netR),
    });
  }

  // 3) Relación ganancia/pérdida: ¿cuánto tienen que pagar tus operaciones para ser rentables?
  const w = profile.winRate / 100;
  const needPayoff = w > 0 && w < 1 ? (1 - w) / w : null;
  if (needPayoff != null && profile.avgLoss > 0 && profile.expectancy <= 0.05 && profile.payoff < needPayoff + 0.2) {
    const target = Math.ceil((needPayoff + 0.3) * 10) / 10;
    rules.push({
      id: "habit:payoff",
      kind: "habit",
      title: tr("Buscá que tus ganancias promedio sean al menos {x} veces tu pérdida promedio", { x: num1(target) }),
      why: tr("Acertás {w}% de las veces y tus ganancias son {p} veces tus pérdidas. Con ese acierto necesitás {need} para empatar.", { w: Math.round(profile.winRate), p: num1(profile.payoff), need: num1(Math.ceil(needPayoff * 10) / 10) }),
      confidence: capConfidence(total >= 30 ? "high" : "medium", total),
    });
  } else if (profile.winRate < 40 && profile.payoff >= 1.8 && profile.expectancy > 0) {
    rules.push({
      id: "habit:big-winners",
      kind: "habit",
      title: tr("Tu fuerte son pocas ganadoras grandes: no cortes las ganancias antes de tiempo"),
      why: tr("Acertás {w}% pero ganás {p} veces lo que perdés. Ese estilo se arruina si cerrás las ganadoras temprano.", { w: Math.round(profile.winRate), p: num1(profile.payoff) }),
      confidence: capConfidence(total >= 30 ? "high" : "medium", total),
    });
  }

  // 4) Pérdidas que se dejan correr (disposición a no cortar)
  const winH = hours(rows.filter((x) => x.r > 0));
  const lossH = hours(rows.filter((x) => x.r < 0));
  if (winH.length >= 3 && lossH.length >= 3) {
    const wA = avg(winH), lA = avg(lossH);
    if (lA > wA * 1.5 && lA - wA >= 0.5) {
      rules.push({
        id: "habit:cut-losses",
        kind: "habit",
        title: tr("Cortá antes las pérdidas: respetá el stop"),
        why: tr("Tus pérdidas duran en promedio {l} h y tus ganancias {w} h. Esperás más cuando va mal.", { l: num1(lA), w: num1(wA) }),
        confidence: capConfidence(winH.length >= 8 && lossH.length >= 8 ? "medium" : "low", total),
      });
    }
  }

  // 5) Sobreoperar: los días con muchas operaciones, ¿rinden peor?
  const perDay = new Map<string, Row[]>();
  for (const x of rows) {
    const k = new Date(x.open).toDateString();
    perDay.set(k, [...(perDay.get(k) ?? []), x]);
  }
  const busy = [...perDay.values()].filter((d) => d.length >= 4).flat();
  const calm = [...perDay.values()].filter((d) => d.length < 4).flat();
  if (busy.length >= 8 && calm.length >= 8) {
    const eB = avg(busy.map((x) => x.r)), eC = avg(calm.map((x) => x.r));
    if (eB <= eC - 0.3 && eB < 0) {
      const cap: BotAction = { op: "maxPerDay", n: 3 };
      rules.push({
        id: actionId(cap),
        action: cap,
        effect: effectOf(cap),
        kind: "habit",
        title: tr("Poné un tope de 3 operaciones por día"),
        why: tr("En los días con 4 o más operaciones perdés {a} por operación; en los demás, {b}.", { a: fmtR(eB), b: fmtR(eC) }),
        confidence: capConfidence("medium", total),
      });
    }
  }

  // 6) Riesgo: rachas y caídas
  if (profile.maxLossStreak >= 3) {
    const stop: BotAction = { op: "stopAfterLosses", n: 3 };
    rules.push({
      id: actionId(stop),
      action: stop,
      effect: effectOf(stop),
      kind: "risk",
      title: tr("Después de 3 pérdidas seguidas, frená el día"),
      why: tr("Tu peor racha fue de {n} pérdidas seguidas. Parar a las 3 corta la cuesta abajo y te deja pensar.", { n: profile.maxLossStreak }),
      confidence: "medium",
    });
  }
  if (profile.maxDrawdownR > 0) {
    const safe = Math.min(2, Math.max(0.25, Math.floor((20 / profile.maxDrawdownR) * 20) / 20));
    const cur = opts.riskPct && opts.riskPct > 0 ? opts.riskPct : null;
    const pct = (risk: number) => Math.round(profile.maxDrawdownR * risk);
    if (cur != null && cur > safe) {
      rules.push({
        id: "risk:lower",
        kind: "risk",
        title: tr("Bajá el riesgo por operación a {x}%", { x: num1(safe) }),
        why: tr("Tu peor caída fue de {d}R: con {c}% por operación eso es −{p}% del capital. Con {s}% sería −{q}%. Una caída futura puede ser peor.", { d: num1(profile.maxDrawdownR), c: num1(cur), p: pct(cur), s: num1(safe), q: pct(safe) }),
        confidence: capConfidence("medium", total),
      });
    } else if (cur != null) {
      rules.push({
        id: "risk:keep",
        kind: "risk",
        title: tr("Mantené el riesgo por operación en {x}% o menos", { x: num1(cur) }),
        why: tr("Tu peor caída fue de {d}R: con {c}% por operación eso es −{p}% del capital. Una caída futura puede ser peor.", { d: num1(profile.maxDrawdownR), c: num1(cur), p: pct(cur) }),
        confidence: capConfidence("medium", total),
      });
    } else {
      rules.push({
        id: "risk:cap",
        kind: "risk",
        title: tr("Arriesgá {x}% o menos por operación", { x: num1(safe) }),
        why: tr("Tu peor caída fue de {d}R. Con {s}% por operación eso es −{q}% del capital. Una caída futura puede ser peor.", { d: num1(profile.maxDrawdownR), s: num1(safe), q: pct(safe) }),
        confidence: capConfidence("medium", total),
      });
    }
  }
  if (edge === "none") {
    rules.unshift({
      id: "risk:demo",
      kind: "risk",
      title: tr("Mientras no veas un promedio positivo, operá en demo o con el riesgo mínimo"),
      why: tr("Hoy tu promedio es {e} por operación. No tiene sentido arriesgar más hasta que las reglas de abajo muestren que lo revierten.", { e: fmtR(profile.expectancy) }),
      confidence: capConfidence("high", total), // con pocas operaciones un promedio chico puede ser casualidad
    });
  }

  // Qué habría pasado aplicando lo que se evita (sobre lo ya ocurrido: sesgado a favor, se avisa)
  const { kept, dropped } = applyAvoid(rows, shownAvoid);
  const after = shownAvoid.length && kept.length >= 5 ? metricsOf(kept.map((x) => x.r)) : null;

  // Comprobación: reglas armadas con el 65% más viejo, probadas en el 35% más nuevo
  let validation: StrategyValidation | null = null;
  const split = Math.floor(rows.length * 0.65);
  const train = rows.slice(0, split), test = rows.slice(split);
  if (train.length >= 10 && test.length >= 8) {
    const trainAvoid = onePerDim(avoidList(train, segmentStats(train)));
    if (trainAvoid.length) {
      const { dropped: d } = applyAvoid(test, trainAvoid);
      if (d.length) {
        const avoidedR = d.reduce((a, x) => a + x.r, 0);
        validation = { trainN: train.length, testN: test.length, avoidedN: d.length, avoidedR: round1(avoidedR), held: avoidedR < 0 };
      }
    }
  }

  // Primero lo que protege (riesgo), después hábitos y, al final, los filtros por activo/día/hora (los más frágiles).
  const order: Record<StrategyRule["kind"], number> = { risk: 0, habit: 1, avoid: 2, focus: 3 };
  rules.sort((a, b) => order[a.kind] - order[b.kind]);

  const style =
    profile.winRate >= 55 && profile.payoff < 1
      ? tr("Muchos aciertos con ganancias chicas")
      : profile.winRate < 45 && profile.payoff >= 1.8
        ? tr("Pocos aciertos pero ganancias grandes")
        : tr("Equilibrado entre aciertos y tamaño de ganancia");

  const lowSample = total < 30;
  const headline =
    edge === "likely"
      ? tr("Tus datos muestran una ventaja que parece real: {e} por operación en {n} operaciones. Cuidala con las reglas de abajo.", { e: fmtR(profile.expectancy), n: total })
      : edge === "unproven"
        ? tr("Ganás {e} por operación, pero con {n} operaciones todavía puede ser suerte. Seguí registrando y probá las reglas.", { e: fmtR(profile.expectancy), n: total })
        : lowSample
          ? tr("Con {n} operaciones todavía no se puede decir si ganás o perdés: hoy tu promedio es {e} por operación. Seguí registrando y probá las reglas.", { n: total, e: fmtR(profile.expectancy) })
          : tr("Por ahora perdés {e} por operación. Hay cosas concretas para corregir.", { e: fmtR(Math.abs(profile.expectancy)).replace("+", "") });

  return {
    ok: true,
    profile,
    edge,
    style,
    headline,
    rules,
    before: profile,
    after,
    avoidedTrades: dropped.length,
    validation,
    lowSample,
    source: opts.source ?? "all",
  };
}

/** Nivel de confianza en texto corto para mostrar junto a cada regla. */
export const confidenceLabel = (c: Confidence) => (c === "high" ? tr("Confianza alta") : c === "medium" ? tr("Confianza media") : tr("Confianza baja"));

export interface StrategySource {
  id: string; // "manual" o el id del exchange de origen
  count: number; // operaciones cerradas de ese origen
}

/** De dónde vienen las operaciones cerradas: cada exchange conectado y las cargadas a mano o por señales. */
export function strategySources(trades: Trade[]): StrategySource[] {
  const map = new Map<string, number>();
  for (const x of trades) {
    if (x.outcome === "ABIERTA") continue;
    const id = x.source || "manual";
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return [...map.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => (a.id === "manual" ? 1 : b.id === "manual" ? -1 : b.count - a.count));
}

/** Solo las operaciones de un origen ("all" = todas). */
export const filterBySource = (trades: Trade[], source: string) => (source === "all" ? trades : trades.filter((x) => (x.source || "manual") === source));

// ─── Qué tan firme es una regla para aplicarla al bot ───────────────────────

/** Operaciones simuladas del propio bot que hacen falta para fiarse de filtros por activo, día u hora. */
export const BOT_OWN_MIN = 100;

export type RuleEvidence = "discipline" | "bot" | "hypothesis";

/**
 * - «discipline»: tope diario o freno por pérdidas; no dependen de adivinar nada, sirven con cualquier estrategia.
 * - «bot»: filtro armado con 100 o más operaciones del propio bot.
 * - «hypothesis»: filtro armado con tus operaciones (otra estrategia) o con pocas del bot: hay que comprobarlo.
 * null = la regla no se puede aplicar al bot (solo es un consejo).
 */
export function ruleEvidence(plan: Extract<StrategyPlan, { ok: true }>, rule: StrategyRule): RuleEvidence | null {
  if (!rule.action) return null;
  if (!("dim" in rule.action)) return "discipline";
  return plan.source === "bot" && plan.profile.n >= BOT_OWN_MIN ? "bot" : "hypothesis";
}

export interface BacktestRow {
  n: number;
  expectancy: number;
}

/** Frase honesta que compara el bot sin reglas contra el bot con las reglas de la persona. */
export function backtestVerdict(base: BacktestRow, withRules: BacktestRow | null, fmt: (n: number) => string): string {
  if (!withRules) return "";
  if (withRules.n < 15) return tr("Con tus reglas quedan solo {n} operaciones en estos meses: no alcanza para saber si ayudan.", { n: withRules.n });
  const d = withRules.expectancy - base.expectancy;
  if (d > 0.05) return tr("Con tus reglas mejora: de {a} a {b} por operación. Es un buen indicio, pero hay que confirmarlo en modo simulado.", { a: fmt(base.expectancy), b: fmt(withRules.expectancy) });
  if (d < -0.05) return tr("Con tus reglas empeora: de {a} a {b} por operación. Conviene sacarlas.", { a: fmt(base.expectancy), b: fmt(withRules.expectancy) });
  return tr("Con tus reglas casi no cambia ({a} contra {b} por operación): no aportan nada medible.", { a: fmt(base.expectancy), b: fmt(withRules.expectancy) });
}

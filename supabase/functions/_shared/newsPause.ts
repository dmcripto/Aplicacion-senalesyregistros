// ─── VELTRIX · Pausa del bot por datos económicos ───────────────────────────
// Alrededor de un dato de ALTO impacto (inflación, empleo, tasas de la Fed…) el precio se mueve bruscamente y los stops
// saltan con facilidad. El bot no abre operaciones nuevas desde unos minutos antes hasta unos minutos después del dato.
// Las operaciones que ya están abiertas siguen como estaban, con su TP y su SL.
// Sin dependencias de Deno ni de Node, para poder probarlo en local.

export interface NewsEvent {
  starts_at: string;
  title: string;
  title_es?: string | null;
  country: string;
}

export interface PauseCfg {
  enabled: boolean;
  before: number; // minutos antes del dato
  after: number; // minutos después
}

export const DEFAULT_PAUSE: PauseCfg = { enabled: true, before: 30, after: 30 };
export const MAX_PAUSE_MIN = 180;

const clampMin = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(MAX_PAUSE_MIN, Math.max(0, Math.round(n))) : fallback;
};

/** Ajustes de pausa de una persona desde su fila (sin fila o con datos raros: los de fábrica). */
export function pauseCfgOf(row: { enabled?: unknown; before_min?: unknown; after_min?: unknown } | null | undefined): PauseCfg {
  if (!row) return DEFAULT_PAUSE;
  return { enabled: row.enabled !== false, before: clampMin(row.before_min, DEFAULT_PAUSE.before), after: clampMin(row.after_min, DEFAULT_PAUSE.after) };
}

/** Si ahora hay que estar en pausa: devuelve el dato responsable y hasta cuándo dura la pausa (el que la termina más tarde). */
export function activeNewsPause(events: NewsEvent[], cfg: PauseCfg, now: number): { event: NewsEvent; until: number } | null {
  if (!cfg.enabled) return null;
  let best: { event: NewsEvent; until: number } | null = null;
  for (const e of events) {
    const at = new Date(e.starts_at).getTime();
    if (!Number.isFinite(at)) continue;
    const from = at - cfg.before * 60_000;
    const until = at + cfg.after * 60_000;
    if (now >= from && now <= until && (!best || until > best.until)) best = { event: e, until };
  }
  return best;
}

/** «CPI m/m» → «🇺🇸 Inflación (CPI) m/m», para mostrar al usuario. */
export const pauseLabel = (e: NewsEvent, lang: "es" | "en") => `${e.country} ${lang === "es" ? (e.title_es || e.title) : e.title}`;

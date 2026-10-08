// ─── VELTRIX · Aviso de apertura y cierre de las bolsas (Tokio, Londres, Nueva York) ────────────────────────────────
// Se publica en el mismo tema «Noticias» de las comunidades (el que se activa con /noticias). Los horarios son los reales
// de cada bolsa en su zona (cambian solos con el horario de verano), de lunes a viernes. No se tienen en cuenta los feriados.

import { claim, unclaim } from "./economy.ts";
import type { NewsDeps } from "./economy.ts";

export interface MarketSession {
  id: string;
  es: string;
  en: string;
  flag: string;
  tz: string;
  open: [number, number];
  close: [number, number];
}

export const MARKET_SESSIONS: MarketSession[] = [
  { id: "tokyo", es: "Tokio", en: "Tokyo", flag: "🇯🇵", tz: "Asia/Tokyo", open: [9, 0], close: [15, 30] },
  { id: "london", es: "Londres", en: "London", flag: "🇬🇧", tz: "Europe/London", open: [8, 0], close: [16, 30] },
  { id: "newyork", es: "Nueva York", en: "New York", flag: "🇺🇸", tz: "America/New_York", open: [9, 30], close: [16, 0] },
];

/** Cuánto después de la hora se sigue publicando (por si una vuelta se retrasa). Más tarde ya no tiene sentido avisar. */
export const SESSION_WINDOW_MIN = 15;

interface Local {
  y: number;
  m: number;
  d: number;
  weekday: number; // 0 = domingo
}

function localParts(ms: number, tz: string): Local {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
}

/** Diferencia (ms) entre la hora de pared de `tz` y UTC en ese instante. */
function offsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(ms / 1000) * 1000;
}

/** El instante UTC en que en `tz` son las hh:mm de ese día. */
export function zonedMs(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - offsetMs(guess - offsetMs(guess, tz), tz);
}

export interface DueSession {
  key: string;
  session: MarketSession;
  kind: "open" | "close";
}

/** Qué aperturas y cierres tocan publicar ahora (los de los últimos SESSION_WINDOW_MIN minutos). */
export function dueSessions(now: number): DueSession[] {
  const out: DueSession[] = [];
  for (const session of MARKET_SESSIONS) {
    const l = localParts(now, session.tz);
    if (l.weekday === 0 || l.weekday === 6) continue;
    for (const kind of ["open", "close"] as const) {
      const [hh, mm] = session[kind];
      const at = zonedMs(l.y, l.m, l.d, hh, mm, session.tz);
      if (now >= at && now - at < SESSION_WINDOW_MIN * 60_000) out.push({ key: `sess:${session.id}:${kind}:${l.y}-${l.m}-${l.d}`, session, kind });
    }
  }
  return out;
}

export function sessionMessage(s: MarketSession, kind: "open" | "close", lang: "es" | "en"): string {
  const name = lang === "en" ? s.en : s.es;
  const verb = kind === "open" ? (lang === "en" ? "Opens" : "Abre") : lang === "en" ? "Closes" : "Cierra";
  return `${kind === "open" ? "🔔" : "🔕"} <i>${verb}</i> ${s.flag} <b>${name}</b>`;
}

/** Publica las aperturas y cierres que toquen en las comunidades con noticias activadas. Devuelve cuántos mensajes salieron. */
export async function postSessionAlerts(deps: NewsDeps, now = Date.now()): Promise<number> {
  const due = dueSessions(now);
  if (!due.length) return 0;
  const { supabase } = deps;
  const { data: rows, error } = await supabase.from("telegram_communities").select("id,user_id,chat_id,news_thread_id").eq("news_enabled", true);
  if (error || !rows?.length) return 0;
  const owners = [...new Set(rows.map((r: any) => r.user_id as string))];
  const { data: profiles } = await supabase.from("profiles").select("id,lang").in("id", owners);
  const langOf = new Map<string, string | null>((profiles ?? []).map((p: any) => [p.id as string, p.lang as string | null]));

  let sent = 0;
  for (const row of rows as any[]) {
    const lang: "es" | "en" = langOf.get(row.user_id) === "en" ? "en" : "es";
    const chatId = Number(row.chat_id);
    for (const d of due) {
      if (!(await claim(supabase, d.key, chatId))) continue;
      const r = await deps.send(chatId, sessionMessage(d.session, d.kind, lang), row.news_thread_id ? Number(row.news_thread_id) : null);
      if (r?.ok) {
        sent++;
        continue;
      }
      await unclaim(supabase, d.key, chatId);
      if (r?.error_code === 403) await supabase.from("telegram_communities").delete().eq("id", row.id);
      else if (r?.error_code === 400) await supabase.from("telegram_communities").update({ news_enabled: false }).eq("id", row.id);
      break;
    }
  }
  return sent;
}

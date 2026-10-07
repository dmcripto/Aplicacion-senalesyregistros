// ─── VELTRIX · Agenda económica ─────────────────────────────────────────────
// Datos económicos que mueven el mercado (inflación, empleo, tasas de la Fed…). Se leen de un calendario público,
// se guardan en la tabla `economic_events` (la web los muestra en una tarjeta) y el bot los publica en el tema
// «Noticias» de las comunidades de Telegram que lo activaron con /noticias:
//   · un resumen del día a las 8:00 (hora de la cuenta dueña de la comunidad)
//   · un aviso 30 minutos antes de cada dato de alto impacto
// Sin dependencias de Deno ni de Node, para poder probarlo en local.

import { localDay, localHour, validTz } from "./dailySummary.ts";
import { esc } from "./telegram.ts";

export const FEED_URLS = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json"];

export type Impact = "High" | "Medium";

export interface EconEvent {
  id: string;
  starts_at: string; // ISO
  country: string; // moneda: USD, EUR…
  title: string;
  title_es: string;
  impact: Impact;
  forecast: string | null;
  previous: string | null;
}

export const DIGEST_HOUR = 8; // desde esta hora local se publica el resumen del día…
export const DIGEST_UNTIL = 12; // …y hasta esta (más tarde ya no tiene sentido anunciar «lo de hoy»)
export const REMIND_MIN = 30; // minutos de aviso previo (alto impacto)
const REFRESH_OK_MS = 3 * 3_600_000; // el calendario cambia poco: se vuelve a leer cada 3 horas
const REFRESH_FAIL_MS = 30 * 60_000;
const KEEP_DAYS = 3;

// ─── Qué es relevante ───────────────────────────────────────────────────────

/** Alto impacto de cualquier país, y de impacto medio solo los de Estados Unidos (los que más mueven al mercado cripto). */
export function isRelevant(impact: string, country: string): boolean {
  return impact === "High" || (impact === "Medium" && country === "USD");
}

// ─── Nombres en español ─────────────────────────────────────────────────────

const ES: Array<[RegExp, string]> = [
  [/\bADP Non-Farm Employment Change\b/i, "Empleo privado ADP"],
  [/\bNon-Farm Employment Change\b/i, "Empleo no agrícola (NFP)"],
  [/\bUnemployment Rate\b/i, "Tasa de desempleo"],
  [/\bUnemployment Claims\b/i, "Pedidos de subsidio por desempleo"],
  [/\bCore CPI\b/i, "Inflación subyacente (Core CPI)"],
  [/\bCPI\b/i, "Inflación (CPI)"],
  [/\bCore PCE Price Index\b/i, "Inflación PCE subyacente"],
  [/\bPCE Price Index\b/i, "Inflación PCE"],
  [/\bCore PPI\b/i, "Precios al productor subyacentes (Core PPI)"],
  [/\bPPI\b/i, "Precios al productor (PPI)"],
  [/\bFOMC Meeting Minutes\b/i, "Minutas de la Fed (FOMC)"],
  [/\bFOMC Statement\b/i, "Comunicado de la Fed (FOMC)"],
  [/\bFOMC Press Conference\b/i, "Conferencia de prensa de la Fed"],
  [/\bFederal Funds Rate\b/i, "Tasa de interés de la Fed"],
  [/\bFOMC\b/i, "Fed (FOMC)"],
  [/\bMain Refinancing Rate\b/i, "Tasa de interés del BCE"],
  [/\bOfficial Bank Rate\b/i, "Tasa de interés del Banco de Inglaterra"],
  [/\bBOJ Policy Rate\b/i, "Tasa de interés del Banco de Japón"],
  [/\bRetail Sales\b/i, "Ventas minoristas"],
  [/\bAdvance GDP\b/i, "PIB (adelanto)"],
  [/\bPrelim GDP\b/i, "PIB (preliminar)"],
  [/\bFinal GDP\b/i, "PIB (final)"],
  [/\bGDP\b/i, "PIB"],
  [/\bISM Manufacturing PMI\b/i, "PMI manufacturero ISM"],
  [/\bISM Services PMI\b/i, "PMI de servicios ISM"],
  [/\bManufacturing PMI\b/i, "PMI manufacturero"],
  [/\bServices PMI\b/i, "PMI de servicios"],
  [/\bJOLTS Job Openings\b/i, "Ofertas de empleo (JOLTS)"],
  [/\bConsumer Confidence\b/i, "Confianza del consumidor"],
  [/\bUnivers?ity of Michigan\b|\bRevised UoM\b|\bPrelim UoM\b/i, "Sentimiento del consumidor (Michigan)"],
  [/\bCrude Oil Inventories\b/i, "Inventarios de petróleo"],
  [/\bDurable Goods Orders\b/i, "Pedidos de bienes duraderos"],
  [/\bTrade Balance\b/i, "Balanza comercial"],
  [/\bSpeaks\b/i, "habla"],
];

/** Nombre en español de los datos más conocidos; si no se reconoce, queda el original. */
export function titleEs(title: string): string {
  const s = String(title).trim();
  for (const [re, es] of ES) if (re.test(s)) return s.replace(re, es);
  return s;
}

// ─── Leer el calendario ─────────────────────────────────────────────────────

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 40) : null;
};

/** Convierte lo que devuelve el calendario público en eventos. Descarta lo que no sirve (sin fecha, bajo impacto, feriados). */
export function parseFeed(raw: unknown): EconEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: EconEvent[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const impact = String(r?.impact ?? "");
    const country = String(r?.country ?? "").toUpperCase().slice(0, 3);
    const title = String(r?.title ?? "").trim().slice(0, 120);
    const ms = Date.parse(String(r?.date ?? ""));
    if (!title || !country || !Number.isFinite(ms) || !isRelevant(impact, country)) continue;
    const starts_at = new Date(ms).toISOString();
    out.push({
      id: `${country}|${title}|${starts_at}`.slice(0, 200),
      starts_at,
      country,
      title,
      title_es: titleEs(title),
      impact: impact as Impact,
      forecast: clean(r?.forecast),
      previous: clean(r?.previous),
    });
  }
  return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * Baja el calendario y lo guarda. Se limita solo: una vez cada 3 horas (30 minutos si falló), así no se pasa
 * del límite del servicio gratuito aunque lo llamen cada 5 minutos. Devuelve cuántos eventos guardó (0 si no tocaba).
 */
export async function refreshEvents(supabase: any, now = Date.now(), fetcher: typeof fetch = fetch): Promise<number> {
  const { data: st, error: stErr } = await supabase.from("economy_state").select("fetched_at,ok").eq("id", 1).maybeSingle();
  if (stErr) return 0; // todavía no se corrió el SQL
  if (st?.fetched_at) {
    const age = now - new Date(st.fetched_at).getTime();
    if (age < (st.ok ? REFRESH_OK_MS : REFRESH_FAIL_MS)) return 0;
  }
  // Se anota el intento antes de salir a buscar: si algo se cuelga, no se reintenta cada 5 minutos.
  await supabase.from("economy_state").upsert({ id: 1, fetched_at: new Date(now).toISOString(), ok: false });

  const events: EconEvent[] = [];
  let anyOk = false;
  for (const url of FEED_URLS) {
    try {
      const res = await fetcher(url, { headers: { "User-Agent": "Mozilla/5.0 VELTRIX", Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      events.push(...parseFeed(await res.json()));
      anyOk = true;
    } catch {
      /* sin ese calendario por ahora */
    }
  }
  if (!anyOk) return 0;
  const fetched_at = new Date(now).toISOString();
  if (events.length) {
    const { error } = await supabase.from("economic_events").upsert(events.map((e) => ({ ...e, fetched_at })), { onConflict: "id" });
    if (error) return 0;
  }
  await supabase.from("economy_state").upsert({ id: 1, fetched_at, ok: true });
  await supabase.from("economic_events").delete().lt("starts_at", new Date(now - KEEP_DAYS * 86_400_000).toISOString());
  return events.length;
}

// ─── Mensajes de Telegram ───────────────────────────────────────────────────

const FLAG: Record<string, string> = { USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵", CNY: "🇨🇳", CAD: "🇨🇦", AUD: "🇦🇺", NZD: "🇳🇿", CHF: "🇨🇭" };
export const flagOf = (country: string) => FLAG[country] ?? "🌐";
export const impactDot = (i: Impact) => (i === "High" ? "🔴" : "🟠");

const hhmm = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

const nameOf = (e: EconEvent, lang: "es" | "en") => esc(lang === "es" ? e.title_es : e.title);

function figures(e: EconEvent, lang: "es" | "en"): string {
  const parts: string[] = [];
  if (e.forecast) parts.push(`${lang === "es" ? "Esperado" : "Forecast"}: <b>${esc(e.forecast)}</b>`);
  if (e.previous) parts.push(`${lang === "es" ? "Anterior" : "Previous"}: <b>${esc(e.previous)}</b>`);
  return parts.join(" · ");
}

/** Resumen del día: los datos de hoy (en la zona horaria de quien conectó la comunidad). Null si hoy no hay nada. */
export function digestMessage(events: EconEvent[], now: number, tzIn: string | null | undefined, lang: "es" | "en"): string | null {
  const tz = validTz(tzIn);
  if (!tz) return null;
  const today = localDay(now, tz);
  const list = events.filter((e) => localDay(e.starts_at, tz) === today).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!list.length) return null;
  const en = lang === "en";
  const day = new Intl.DateTimeFormat(en ? "en-US" : "es-AR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(now));
  const lines = [`🗓 <b>${en ? "ECONOMIC CALENDAR" : "AGENDA ECONÓMICA"}</b> · ${esc(day)}`, ""];
  for (const e of list) {
    lines.push(`${impactDot(e.impact)} <b>${hhmm(e.starts_at, tz)}</b> ${flagOf(e.country)} ${nameOf(e, lang)}`);
    const f = figures(e, lang);
    if (f) lines.push(`     ${f}`);
  }
  lines.push(
    "",
    en
      ? "💡 Releases marked 🔴 often move crypto hard: expect volatility around the time."
      : "💡 Los datos marcados 🔴 suelen mover fuerte al mercado cripto: ojo con la volatilidad cerca de la hora.",
    `<i>${en ? `Times in ${esc(tz)}.` : `Horarios en ${esc(tz)}.`}</i>`,
  );
  return lines.join("\n");
}

/** Aviso previo de un dato de alto impacto. */
export function reminderMessage(e: EconEvent, now: number, lang: "es" | "en"): string {
  const en = lang === "en";
  const mins = Math.max(1, Math.round((new Date(e.starts_at).getTime() - now) / 60_000));
  const lines = [
    `⏰ <b>${en ? `IN ${mins} MIN` : `EN ${mins} MIN`}</b> · ${impactDot(e.impact)} ${flagOf(e.country)} <b>${nameOf(e, lang)}</b>`,
  ];
  const f = figures(e, lang);
  if (f) lines.push("", f);
  lines.push("", en ? "⚠️ Expect sharp moves: consider reducing size or waiting for the release." : "⚠️ Se esperan movimientos bruscos: conviene achicar el tamaño o esperar a que salga el dato.");
  return lines.join("\n");
}

// ─── Publicar en «Noticias» ─────────────────────────────────────────────────

interface NewsDeps {
  supabase: any;
  /** Manda un mensaje de Telegram a un chat (y tema); devuelve la respuesta de la API. */
  send: (chatId: number, html: string, thread: number | null) => Promise<{ ok?: boolean; error_code?: number } | void>;
}

/** Marca «ya publicado» antes de enviar (si dos corridas coinciden, solo una publica). Devuelve true si le tocaba a esta. */
async function claim(supabase: any, key: string, chatId: number): Promise<boolean> {
  const { data, error } = await supabase.from("economic_posts").upsert({ key, chat_id: chatId }, { onConflict: "key,chat_id", ignoreDuplicates: true }).select("key");
  return !error && !!data?.length;
}

const unclaim = (supabase: any, key: string, chatId: number) => supabase.from("economic_posts").delete().eq("key", key).eq("chat_id", chatId);

/**
 * Publica lo que corresponda en las comunidades con noticias activadas: el resumen del día (desde las 8:00 de la zona de la
 * cuenta dueña) y el aviso previo de los datos de alto impacto. Devuelve cuántos mensajes salieron.
 */
export async function postEconomyNews(deps: NewsDeps, now = Date.now()): Promise<number> {
  const { supabase } = deps;
  const { data: rows, error } = await supabase.from("telegram_communities").select("id,user_id,chat_id,news_thread_id").eq("news_enabled", true);
  if (error || !rows?.length) return 0;
  const { data: events } = await supabase
    .from("economic_events")
    .select("id,starts_at,country,title,title_es,impact,forecast,previous")
    .gte("starts_at", new Date(now - 86_400_000).toISOString())
    .lte("starts_at", new Date(now + 2 * 86_400_000).toISOString())
    .order("starts_at");
  const all = (events ?? []) as EconEvent[];
  if (!all.length) return 0;

  const owners = [...new Set(rows.map((r: any) => r.user_id as string))];
  const { data: profiles } = await supabase.from("profiles").select("id,timezone,lang").in("id", owners);
  const profOf = new Map<string, { timezone: string | null; lang: string | null }>((profiles ?? []).map((p: any) => [p.id as string, p]));

  let sent = 0;
  const deliver = async (row: any, key: string, html: string) => {
    const chatId = Number(row.chat_id);
    if (!(await claim(supabase, key, chatId))) return;
    const thread = row.news_thread_id ? Number(row.news_thread_id) : null;
    const r = await deps.send(chatId, html, thread);
    if (r?.ok) return void sent++;
    await unclaim(supabase, key, chatId); // que se reintente en la próxima vuelta
    if (r?.error_code === 403) await supabase.from("telegram_communities").delete().eq("id", row.id); // el bot ya no está
    else if (r?.error_code === 400) await supabase.from("telegram_communities").update({ news_enabled: false }).eq("id", row.id); // el tema ya no existe
  };

  for (const row of rows as any[]) {
    const prof = profOf.get(row.user_id);
    const lang: "es" | "en" = prof?.lang === "en" ? "en" : "es";
    const tz = validTz(prof?.timezone);

    // Resumen del día.
    if (tz && localHour(now, tz) >= DIGEST_HOUR && localHour(now, tz) < DIGEST_UNTIL) {
      const html = digestMessage(all, now, tz, lang);
      if (html) await deliver(row, `digest:${localDay(now, tz)}`, html);
    }

    // Aviso previo de los de alto impacto.
    for (const e of all) {
      const ms = new Date(e.starts_at).getTime();
      if (e.impact !== "High" || ms <= now || ms - now > REMIND_MIN * 60_000) continue;
      await deliver(row, `pre:${e.id}`, reminderMessage(e, now, lang));
    }
  }

  // Limpieza de marcas viejas.
  await supabase.from("economic_posts").delete().lt("created_at", new Date(now - 7 * 86_400_000).toISOString());
  return sent;
}

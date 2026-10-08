import { useEffect, useMemo, useState } from "react";
import { cx, econTitleEs, getLang, t } from "../lib";
import { fetchEconomy } from "../tradesApi";
import type { EconomyEvent } from "../tradesApi";

const SHOWN = 5;
const FLAG: Record<string, string> = { USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵", CNY: "🇨🇳", CAD: "🇨🇦", AUD: "🇦🇺", NZD: "🇳🇿", CHF: "🇨🇭" };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** «en 2 h 15 min», «en 40 min», «ahora». */
function countdown(ms: number): string {
  if (ms <= 0) return t("ahora");
  const m = Math.round(ms / 60_000);
  if (m < 60) return t("en {n} min", { n: Math.max(1, m) });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? t("en {h} h {m} min", { h, m: rest }) : t("en {h} h", { h });
}

/** Agenda económica: los próximos datos que suelen mover el mercado (inflación, empleo, tasas…), en tu hora local. Chica y sin configurar nada. */
export default function EconomyCard({ now }: { now: Date }) {
  const [events, setEvents] = useState<EconomyEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchEconomy()
        .then((e) => alive && setEvents(e))
        .catch(() => {});
    load();
    const id = window.setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const list = useMemo(() => (events ?? []).slice(0, SHOWN), [events]);
  if (!events?.length) return null; // sin datos todavía (o sin el SQL): la tarjeta no se muestra

  const en = getLang() === "en";
  const timeFmt = new Intl.DateTimeFormat(en ? "en-GB" : "es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const dayLabel = (d: Date) => (dayKey(d) === dayKey(now) ? t("Hoy") : dayKey(d) === dayKey(tomorrow) ? t("Mañana") : new Intl.DateTimeFormat(en ? "en-US" : "es-AR", { weekday: "short", day: "numeric" }).format(d));
  const next = list.find((e) => new Date(e.starts_at).getTime() > now.getTime());

  return (
    <section className="glass glow-card rounded-xl px-4 py-3.5 sm:px-5" aria-label={t("Agenda económica")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-fog">🗓 {t("Agenda económica")}</h2>
        {next && (
          <span className="num text-[11.5px] text-gold">
            {t("Próximo dato")}: {countdown(new Date(next.starts_at).getTime() - now.getTime())}
          </span>
        )}
      </div>
      <ul className="divide-y divide-line/60">
        {list.map((e) => {
          const at = new Date(e.starts_at);
          const past = at.getTime() <= now.getTime();
          const high = e.impact === "High";
          const figures = [e.forecast && `${t("Esperado")} ${e.forecast}`, e.previous && `${t("Anterior")} ${e.previous}`].filter(Boolean).join(" · ");
          return (
            <li key={e.id} className={cx("flex items-start gap-3 py-2", past && "opacity-60")}>
              <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", high ? "bg-bear" : "bg-gold")} title={high ? t("Impacto alto") : t("Impacto medio")} />
              <span className="num w-[6.4rem] shrink-0 whitespace-nowrap text-[12px] text-dim">
                {dayLabel(at)} <b className="text-snow">{timeFmt.format(at)}</b>
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-snow">
                <span aria-hidden>{FLAG[e.country] ?? "🌐"}</span> <span className="text-dim">{e.country}</span> {en ? e.title : econTitleEs(e.title)}
                {figures && <span className="num block text-[11px] text-dim">{figures}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-bear align-middle" /> {t("impacto alto")} · <span className="mx-1 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle" /> {t("medio")} · {t("Horarios en tu hora local. Cerca de estos datos el mercado suele moverse fuerte.")}
      </p>
    </section>
  );
}

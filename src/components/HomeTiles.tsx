import { cx, t } from "../lib";
import { IconTile } from "../icons";
import { NAV_ITEMS } from "../nav";
import type { NavKey } from "../nav";
import type { View } from "../nav";

/** «Accesos rápidos» de Inicio: una tarjeta por pantalla, con una línea que explica para qué sirve. */
export default function HomeTiles({ go, botReady, botOn, openCount }: { go: (v: View, panel?: string) => void; botReady: boolean; botOn: boolean; openCount: number }) {
  const tiles: Array<{ key: NavKey; badge?: { text: string; on: boolean } }> = [
    { key: "journal", badge: openCount ? { text: t("{n} abiertas", { n: openCount }), on: true } : undefined },
    { key: "chart" },
    { key: "analysis" },
    ...(botReady ? [{ key: "bot" as NavKey, badge: { text: botOn ? t("Encendido") : t("Apagado"), on: botOn } }] : []),
    { key: "connections" },
    { key: "tools" },
  ];
  return (
    <section aria-label={t("Accesos rápidos")}>
      <div className="mb-3 flex items-end gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-wide text-snow">{t("ACCESOS RÁPIDOS")}</h2>
          <p className="text-[11px] uppercase tracking-[0.16em] text-dim">{t("Todo lo que podés hacer en VELTRIX")}</p>
        </div>
        <div className="mb-2 hidden h-px flex-1 bg-gradient-to-r from-line to-transparent sm:block" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(({ key, badge }) => {
          const it = NAV_ITEMS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => go(it.view, it.panel)}
              className="group glass flex items-start gap-4 rounded-xl p-5 text-left transition-all hover:-translate-y-0.5 hover:border-gold/50"
            >
              <IconTile name={it.icon} tone={it.tone} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-snow">{t(it.title)}</span>
                  {badge && (
                    <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", badge.on ? "border-bull/40 bg-bull/10 text-bull" : "border-line text-dim")}>{badge.text}</span>
                  )}
                </span>
                <span className="mt-1 block text-[12.5px] leading-snug text-dim">{t(it.desc)}</span>
                <span className="mt-3 inline-block text-[12px] font-semibold text-gold transition-transform group-hover:translate-x-0.5">{t("Abrir")} →</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Título de una pantalla: nombre grande, una línea de explicación y (a la derecha) acciones. */
export function PageHead({ view, right }: { view: View; right?: React.ReactNode }) {
  const it = view === "bot" ? { ...NAV_ITEMS.bot, title: "Bot", desc: "Automático, con dinero real y señales de VELTRIX." } : NAV_ITEMS[view];
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
      <div>
        <h1 className="font-display flex items-center gap-3 text-3xl font-extrabold tracking-wide text-snow sm:text-4xl">
          <IconTile name={it.icon} tone={it.tone} size="md" />
          {t(it.title)}
        </h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-dim">{t(it.desc)}</p>
      </div>
      {right}
    </div>
  );
}

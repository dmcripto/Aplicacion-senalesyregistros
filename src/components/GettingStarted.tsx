import { useCallback, useEffect, useState } from "react";
import { cx, t } from "../lib";
import { fetchConnections, fetchTelegramLink } from "../tradesApi";
import { IconCheck } from "../ui";
import { OPEN_ASSISTANT_EVENT } from "../nav";
import type { View } from "../nav";

const HIDDEN_KEY = "veltrix_guide_hidden_v1";
export const ASSISTANT_USED_KEY = "veltrix_assistant_used_v1";
export const ASSISTANT_USED_EVENT = "veltrix:assistant-used";

const read = (k: string) => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};
const write = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {
    /* sin almacenamiento: la guía igual funciona */
  }
};

interface Step {
  id: string;
  title: string;
  text: string;
  done: boolean;
  cta: string;
  run: () => void;
}

/**
 * Guía de inicio: una lista de pasos que se tildan solos según lo que ya hiciste (capital, exchange, Telegram, bot, primera operación, asistente).
 * Cada paso lleva con un toque a la pantalla donde se hace, y el primero sin completar se resalta como «siguiente».
 */
export default function GettingStarted({
  go,
  hasCapital,
  tradeCount,
  botReady,
  botOn,
  forced,
  onLoadSample,
  onClose,
}: {
  go: (v: View, panel?: string) => void;
  hasCapital: boolean;
  tradeCount: number;
  botReady: boolean;
  botOn: boolean;
  /** La persona la pidió con «Ver guía de inicio»: se muestra aunque ya esté completa u oculta. */
  forced: boolean;
  onLoadSample?: () => void;
  onClose: () => void;
}) {
  const [conns, setConns] = useState<number | null>(null);
  const [tg, setTg] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(() => read(ASSISTANT_USED_KEY));
  const [hidden, setHidden] = useState(() => read(HIDDEN_KEY));

  useEffect(() => {
    let alive = true;
    fetchConnections()
      .then((c) => alive && setConns(c.length))
      .catch(() => alive && setConns(0));
    fetchTelegramLink()
      .then((l) => alive && setTg(!!l))
      .catch(() => alive && setTg(false));
    const on = () => setAsked(true);
    window.addEventListener(ASSISTANT_USED_EVENT, on);
    return () => {
      alive = false;
      window.removeEventListener(ASSISTANT_USED_EVENT, on);
    };
  }, []);

  const hide = useCallback(() => {
    write(HIDDEN_KEY);
    setHidden(true);
    onClose();
  }, [onClose]);

  if (conns == null || tg == null) return null; // se espera a saber qué ya hizo, para no mostrar pasos tildados de más

  const steps: Step[] = [
    { id: "capital", title: t("Cargá tu capital"), text: t("Con tu capital y tu riesgo, VELTRIX te dice cuánto operar y cuánto ganás o perdés en dinero."), done: hasCapital, cta: t("Cargar capital"), run: () => go("account") },
    { id: "exchange", title: t("Conectá tu exchange"), text: t("Con una clave de solo lectura, tus operaciones entran solas al diario."), done: conns > 0, cta: t("Conectar"), run: () => go("connections") },
    { id: "telegram", title: t("Vinculá Telegram"), text: t("Recibí avisos de señales y resultados donde ya mirás todo el día."), done: tg, cta: t("Vincular"), run: () => go("connections") },
    ...(botReady ? [{ id: "bot", title: t("Probá el bot automático"), text: t("Encendelo en simulado: no usa dinero y anota todo en tu diario."), done: botOn, cta: t("Ir al bot"), run: () => go("bot", "bot") }] : []),
    { id: "trade", title: t("Tené tu primera operación"), text: t("Cargala a mano, pegá una señal o importala de tu exchange."), done: tradeCount > 0, cta: tradeCount === 0 && onLoadSample ? t("Cargar ejemplos") : t("Ir al diario"), run: () => (tradeCount === 0 && onLoadSample ? onLoadSample() : go("journal")) },
    { id: "assistant", title: t("Hacele una pregunta al asistente"), text: t("Preguntale lo que no entiendas: cómo funciona algo o cómo te fue."), done: asked, cta: t("Abrir asistente"), run: () => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT)) },
  ];
  const doneN = steps.filter((s) => s.done).length;
  const complete = doneN === steps.length;
  if (!forced && (hidden || complete)) return null;
  const nextId = steps.find((s) => !s.done)?.id;
  const pct = Math.round((doneN / steps.length) * 100);

  return (
    <section className="glass glow-card welcome-card rounded-lg border-gold/40 bg-golddeep/30 p-5" data-tilt="soft" aria-label={t("Guía de inicio")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-wide text-snow sm:text-3xl">
            <span className="brand-word">{complete ? t("¡TODO LISTO!") : t("EMPEZÁ EN POCOS PASOS")}</span>
          </h2>
          <p className="mt-0.5 text-[12px] text-fog sm:text-[13px]">
            {complete ? t("Completaste la guía. Ya tenés VELTRIX configurado a tu medida.") : t("Se tildan solos a medida que los hacés. Tocá el botón de cada paso para ir directo.")}
          </p>
        </div>
        <button type="button" onClick={hide} className="rounded-md border border-line px-3 py-1.5 text-[11px] font-semibold text-fog transition-colors hover:border-line2 hover:text-snow">
          {t("Ocultar guía")}
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Progreso de la guía")}>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/70">
          <div className="h-full rounded-full bg-gradient-to-r from-gold to-bull transition-[width] duration-700 ease-out" style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
        <span className="num text-[12px] font-bold text-snow">
          {doneN}/{steps.length}
        </span>
      </div>

      <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((s, i) => {
          const next = s.id === nextId;
          return (
            <li
              key={s.id}
              className={cx(
                "step-card flex gap-3 rounded-md border bg-panel/70 p-3.5 transition-all duration-300",
                s.done ? "border-bull/40" : next ? "border-gold/70 shadow-[0_0_0_1px_rgba(46,196,241,0.25),0_0_24px_-6px_rgba(46,196,241,0.45)]" : "border-line",
              )}
              style={{ ["--i" as string]: i } as React.CSSProperties}
            >
              <span
                className={cx(
                  "num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-all duration-500",
                  s.done ? "scale-110 bg-bull text-ink" : next ? "bg-gold text-ink" : "border border-line2 text-dim",
                )}
              >
                {s.done ? <IconCheck className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <b className={cx("block text-[13px]", s.done ? "text-bull" : "text-snow")}>
                  {s.title}
                  {next && <span className="ml-2 rounded-full bg-gold px-2 py-0.5 align-middle text-[9.5px] font-extrabold uppercase tracking-wider text-ink">{t("Siguiente")}</span>}
                </b>
                <span className="block text-[12px] leading-relaxed text-fog">{s.text}</span>
                {!s.done && (
                  <button
                    type="button"
                    onClick={s.run}
                    className={cx(
                      "mt-2 rounded-md px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wider transition-all active:scale-[0.98]",
                      next ? "bg-gold text-ink hover:brightness-110" : "border border-line text-fog hover:border-gold/50 hover:text-gold",
                    )}
                  >
                    {s.cta}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

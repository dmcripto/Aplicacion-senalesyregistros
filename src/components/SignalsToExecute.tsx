import { useEffect, useMemo, useRef, useState } from "react";
import { ago, cx, exchangeName, exchangeTradeUrl, fmtPrice, signalGuide, t } from "../lib";
import type { ExchangeId, Trade } from "../lib";
import { fetchConnections } from "../tradesApi";
import { useMoney } from "../money";
import { LevelBar, TriDown, TriUp } from "../ui";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

const canNotify = () => typeof window !== "undefined" && "Notification" in window;
const NEW_MS = 3 * 60_000; // una señal se marca como «nueva» durante 3 minutos

/** Avisa (pestaña en segundo plano, título y aviso del navegador) cuando llega una señal abierta nueva mientras la web está abierta. */
function useNewSignalAlerts(open: Trade[], loading: boolean) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Record<string, number>>({});

  useEffect(() => {
    if (loading) return;
    if (seen.current === null) {
      seen.current = new Set(open.map((x) => x.id)); // lo que ya estaba al abrir no cuenta como nuevo
      return;
    }
    const added = open.filter((x) => !seen.current!.has(x.id));
    if (!added.length) return;
    for (const x of added) seen.current.add(x.id);
    const now = Date.now();
    setFresh((f) => ({ ...f, ...Object.fromEntries(added.map((x) => [x.id, now])) }));
    const first = added[0];
    const label = `${first.symbol} · ${first.direction === "LONG" ? t("COMPRA") : t("VENTA")}`;
    if (document.hidden) {
      const old = document.title;
      document.title = `🔔 ${label}`;
      const back = () => {
        if (!document.hidden) {
          document.title = old;
          document.removeEventListener("visibilitychange", back);
        }
      };
      document.addEventListener("visibilitychange", back);
      if (canNotify() && Notification.permission === "granted") {
        try {
          new Notification(t("Nueva señal en VELTRIX"), { body: `${label} · ${t("Entrada")} ${fmtPrice(first.entry)}`, tag: "veltrix-signal" });
        } catch {
          /* algunos navegadores no permiten crearlas desde la página */
        }
      }
    }
  }, [open, loading]);

  // Quita la marca «nueva» pasados los minutos.
  useEffect(() => {
    if (!Object.keys(fresh).length) return;
    const id = window.setInterval(() => setFresh((f) => Object.fromEntries(Object.entries(f).filter(([, at]) => Date.now() - at < NEW_MS))), 20_000);
    return () => window.clearInterval(id);
  }, [fresh]);

  return fresh;
}

/** Señales abiertas explicadas de un vistazo: qué hacer, a qué precio y cuánto, con botones para copiar y abrir el exchange. */
export default function SignalsToExecute({ trades, prices, loading, now, notify }: { trades: Trade[]; prices: Record<string, number>; loading: boolean; now: Date; notify: Notify }) {
  const { money } = useMoney();
  const open = useMemo(() => trades.filter((x) => x.outcome === "ABIERTA").sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [trades]);
  const fresh = useNewSignalAlerts(open, loading);
  const [exchanges, setExchanges] = useState<ExchangeId[]>([]);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(canNotify() ? Notification.permission : "unsupported");

  useEffect(() => {
    let alive = true;
    fetchConnections()
      .then((c) => alive && setExchanges(c.map((x) => x.exchange)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!open.length) return null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(t("Datos copiados."), "ok");
    } catch {
      notify(t("No se pudo copiar."), "err");
    }
  };
  const ask = async () => {
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      /* el navegador no lo permite */
    }
  };

  return (
    <section className="glass glow-card overflow-hidden rounded-xl border border-gold/30 p-4 sm:p-5" aria-label={t("Señales para ejecutar")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-xl font-bold tracking-wide text-snow sm:text-2xl">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-gold" />
          {t("SEÑALES PARA EJECUTAR")} · {open.length}
        </h2>
        {perm === "default" && (
          <button onClick={ask} className="rounded-md border border-gold/45 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10">
            🔔 {t("Avisarme en este navegador")}
          </button>
        )}
        {perm === "granted" && <span className="text-[11px] font-semibold text-bull">🔔 {t("Avisos del navegador activados")}</span>}
      </div>

      <ul className="grid gap-3 lg:grid-cols-2">
        {open.slice(0, 6).map((tr) => {
          const g = signalGuide(tr, money);
          const accent = g.long ? "bull" : "bear";
          const isNew = fresh[tr.id] != null && now.getTime() - fresh[tr.id] < NEW_MS + 20_000;
          const own = tr.source && tr.source !== "bot" ? tr.source : null;
          const ex = g.simulated ? null : (own && exchanges.includes(own as ExchangeId) ? (own as ExchangeId) : exchanges[0]) ?? null;
          const url = ex ? exchangeTradeUrl(ex, tr.symbol) : null;
          return (
            <li key={tr.id} className={cx("min-w-0 rounded-xl border-2 bg-ink/50 p-4", accent === "bull" ? "border-bull/45" : "border-bear/45", isNew && "ring-2 ring-gold/70")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-extrabold tracking-wider", accent === "bull" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear")}>
                  {g.long ? <TriUp className="h-3 w-3" /> : <TriDown className="h-3 w-3" />}
                  {g.sideLabel}
                </span>
                <span className="num text-lg font-extrabold text-snow">{tr.symbol}</span>
                {isNew && <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink">{t("Nueva")}</span>}
                {g.simulated && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fog">🤖 {t("Simulada")}</span>}
                <span className="ml-auto text-[11px] text-dim">{ago(tr.date, now.getTime())}</span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-line bg-panel/60 px-2 py-2">
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">{t("Entrada")}</p>
                  <p className="num text-[15px] font-extrabold text-snow">{fmtPrice(tr.entry)}</p>
                </div>
                <div className="rounded-lg border border-bear/30 bg-bear/5 px-2 py-2">
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-bear">Stop</p>
                  <p className="num text-[15px] font-extrabold text-snow">{fmtPrice(tr.sl)}</p>
                </div>
                <div className="rounded-lg border border-bull/30 bg-bull/5 px-2 py-2">
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-bull">{t("Objetivo")}</p>
                  <p className="num text-[15px] font-extrabold text-snow">{fmtPrice(tr.tp)}</p>
                </div>
              </div>
              <p className="num mt-1.5 text-center text-[11px] text-dim">
                {g.rr != null && <>R:R 1:{g.rr.toFixed(2)}</>}
                {g.stopPct != null && <> · {t("Stop a {p}% del precio", { p: g.stopPct.toFixed(2) })}</>}
              </p>

              {prices[tr.id] != null && <LevelBar trade={tr} price={prices[tr.id]} className="mt-2" />}

              <ol className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-fog">
                {g.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    {!g.simulated && <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-bold text-gold">{i + 1}</span>}
                    <span>{s}</span>
                  </li>
                ))}
              </ol>

              {!g.simulated && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => copy(g.copyText)} className="rounded-md border border-line px-3 py-2 text-[12px] font-bold text-snow transition-colors hover:border-line2 hover:bg-white/5">
                    📋 {t("Copiar datos")}
                  </button>
                  {url && ex && (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-[12px] font-bold text-gold transition-colors hover:bg-gold/20">
                      ↗ {t("Abrir en {name}", { name: exchangeName(ex) })}
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {open.length > 6 && <p className="mt-2 text-[11px] text-dim">+{open.length - 6} {t("más en el libro de operaciones")}</p>}
      <p className="mt-3 text-[10.5px] leading-relaxed text-dim">{t("Es información para tu propio análisis, no una recomendación ni una orden. VELTRIX no opera por vos: la decisión y la operación son tuyas.")}</p>
    </section>
  );
}

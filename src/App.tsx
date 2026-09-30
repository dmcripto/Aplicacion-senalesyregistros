import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMUNITY_URL,
  computeStats,
  cx,
  downloadCsv,
  fmtPct,
  fmtR,
  resultR,
  rrOf,
  sampleTrades,
} from "./lib";
import type { Trade } from "./lib";
import { useCountUp, useFlashId, useNow, useSession, useTrades } from "./hooks";
import {
  CloseModal,
  IconCheck,
  IconClipboard,
  IconDownload,
  IconTelegram,
  Reveal,
  ShieldLogo,
  ToastStack,
  TriDown,
  TriUp,
} from "./ui";
import type { ToastData } from "./ui";
import { supabase } from "./supabaseClient";
import {
  closeTradeManually,
  deleteAllTrades,
  deleteTradeById,
  fetchAutoClose,
  setAutoClose,
  fetchWebhookUrl,
  regenerateWebhookUrl,
  deleteMyAccount,
  insertFullTrades,
  insertTrades,
  markTradeOutcome,
  reopenTradeById,
} from "./tradesApi";
import type { NewTrade } from "./lib";
import Auth from "./components/Auth";
import ResetPassword from "./components/ResetPassword";
import EquityChart from "./components/EquityChart";
import TradeForm from "./components/TradeForm";
import TradeTable from "./components/TradeTable";
import MonthlySummary from "./components/MonthlySummary";
import AlertBuilder from "./components/AlertBuilder";
import RiskCalculator from "./components/RiskCalculator";

// ─── Cinta de operaciones cerradas ──────────────────────────────────────────

function Ticker({ trades }: { trades: Trade[] }) {
  const closed = useMemo(
    () =>
      trades
        .filter((t) => t.outcome !== "ABIERTA")
        .sort(
          (a, b) =>
            new Date(b.closedAt ?? b.date).getTime() - new Date(a.closedAt ?? a.date).getTime(),
        )
        .slice(0, 18),
    [trades],
  );

  const renderTrack = (ariaHidden: boolean) => (
    <div aria-hidden={ariaHidden} className="flex shrink-0 items-center">
      {closed.map((t) => {
        const r = resultR(t) ?? 0;
        return (
          <span key={(ariaHidden ? "b-" : "a-") + t.id} className="num flex items-center gap-1.5 px-4 text-[11px] font-semibold">
            <span className="text-fog">{t.symbol}</span>
            {t.direction === "LONG" ? (
              <TriUp className="h-2 w-2 text-bull" />
            ) : (
              <TriDown className="h-2 w-2 text-bear" />
            )}
            <span className={r >= 0 ? "text-bull" : "text-bear"}>{fmtR(r)}R</span>
            <span className="pl-4 text-line2">◆</span>
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="relative overflow-hidden border-b border-line bg-panel/85 backdrop-blur-sm">
      {closed.length ? (
        <div className="ticker-track flex w-max py-1.5">
          {renderTrack(false)}
          {renderTrack(true)}
        </div>
      ) : (
        <p className="num py-1.5 text-center text-[11px] text-dim">
          VELTRIX · cuando cierres operaciones, el ticker de resultados corre acá
        </p>
      )}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-ink to-transparent" />
      <span className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink to-transparent" />
    </div>
  );
}

// ─── Banda de estadísticas ──────────────────────────────────────────────────

function StatsBand({ trades }: { trades: Trade[] }) {
  const stats = useMemo(() => computeStats(trades), [trades]);
  const netR = useCountUp(stats.netR);
  const winRate = useCountUp(stats.winRate);
  const avgR = useCountUp(stats.avgR);
  const winPos = stats.winRate >= 50;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1.15fr]">
      <div className="col-span-2 bg-panel px-5 py-4 md:col-span-4 md:py-5 xl:col-span-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">R neto acumulado</p>
        <p
          className={cx(
            "font-display text-[52px] font-extrabold leading-none tracking-wide md:text-6xl",
            stats.netR > 0 ? "text-bull" : stats.netR < 0 ? "text-bear" : "text-fog",
          )}
        >
          {fmtR(netR)}
          <span className="ml-1 text-2xl text-fog">R</span>
        </p>
        <p className="num mt-1.5 text-[11px] text-dim">
          mejor {fmtR(stats.bestR)}R · peor {fmtR(stats.worstR)}R
        </p>
      </div>

      <div className="bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">Acierto</p>
        <p className={cx("num mt-1 text-3xl font-bold leading-none", winPos ? "text-bull" : "text-bear")}>
          {fmtPct(winRate)}
        </p>
        <p className="num mt-1.5 text-[11px] text-dim">
          {stats.ganadas}G · {stats.perdidas}P
        </p>
      </div>

      <div className="bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">Profit factor</p>
        <p className="num mt-1 text-3xl font-bold leading-none text-snow">
          {stats.pf === null ? "∞" : stats.cerradas ? stats.pf.toFixed(2) : "—"}
        </p>
        <p className="num mt-1.5 text-[11px] text-dim">ganancia / pérdida</p>
      </div>

      <div className="bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">R promedio</p>
        <p
          className={cx(
            "num mt-1 text-3xl font-bold leading-none",
            stats.avgR > 0 ? "text-bull" : stats.avgR < 0 ? "text-bear" : "text-fog",
          )}
        >
          {stats.cerradas ? fmtR(avgR) : "—"}
        </p>
        <p className="num mt-1.5 text-[11px] text-dim">por operación cerrada</p>
      </div>

      <div className="bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">Operaciones</p>
        <p className="num mt-1 text-3xl font-bold leading-none text-snow">{stats.total}</p>
        <p className="num mt-1.5 flex items-center gap-1.5 text-[11px] text-dim">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" />
          {stats.abiertas} abiertas · {stats.cerradas} cerradas
        </p>
      </div>
    </div>
  );
}

// ─── Webhook de TradingView ─────────────────────────────────────────────────

function WebhookCard({ userId, notify }: { userId: string; notify: Notify }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenArmed, setRegenArmed] = useState(false);
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches);
  const [autoClose, setAutoCloseState] = useState(true);

  useEffect(() => {
    fetchAutoClose(userId).then(setAutoCloseState).catch(() => {});
  }, [userId]);

  const toggleAutoClose = async () => {
    const next = !autoClose;
    setAutoCloseState(next);
    try {
      await setAutoClose(userId, next);
      notify(next ? "Cierre automático activado." : "Cierre automático desactivado.");
    } catch (err) {
      setAutoCloseState(!next);
      notify(err instanceof Error ? err.message : "No se pudo guardar el cambio.", "err");
    }
  };

  useEffect(() => {
    if (!regenArmed) return;
    const id = window.setTimeout(() => setRegenArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [regenArmed]);

  const regenerate = async () => {
    setRegenArmed(false);
    try {
      setUrl(await regenerateWebhookUrl());
      notify("URL regenerada. Actualizala en tus alertas de TradingView: la anterior dejó de funcionar.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "No se pudo regenerar la URL.", "err");
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchWebhookUrl(userId)
      .then((u) => !cancelled && setUrl(u))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "No se pudo obtener la URL."));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify("URL de webhook copiada al portapapeles.");
    } catch {
      notify("No se pudo copiar automáticamente — seleccioná el texto a mano.", "err");
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b border-line px-5 py-4 text-left"
      >
        <span>
          <span className="block font-display text-2xl font-bold tracking-wide text-snow">CONECTÁ TU FUENTE DE SEÑALES</span>
          <span className="block text-[11px] uppercase tracking-[0.16em] text-dim">
            Enviá tus señales a esta URL, vengan de donde vengan
          </span>
        </span>
        <span className="shrink-0 text-lg text-gold" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
      <div className="space-y-3 p-5">
        {error && <p className="text-[12px] text-bear">{error}</p>}
        {url && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-ink px-3 py-2.5">
            <code className="num flex-1 truncate text-[11px] text-fog">{url}</code>
            <button
              onClick={copy}
              className="shrink-0 rounded border border-line px-2.5 py-1.5 text-[11px] font-semibold text-fog transition-colors hover:border-line2 hover:bg-raise hover:text-snow"
            >
              <IconClipboard className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-ink/40 p-3 text-[11.5px] leading-relaxed text-fog">
          <input
            type="checkbox"
            checked={autoClose}
            onChange={toggleAutoClose}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-gold)]"
          />
          <span>
            <b className="text-snow">Cierre automático:</b> VELTRIX sigue el precio (criptomonedas) y marca TP o SL
            solo cuando el precio los toca. Si una misma vela toca ambos, se toma SL.
          </span>
        </label>
        <details className="group rounded-md border border-line bg-ink/40 text-[11.5px] leading-relaxed text-fog">
          <summary className="cursor-pointer select-none px-3 py-2.5 font-bold uppercase tracking-[0.12em] text-gold">
            ¿Desde dónde puedo enviar señales?
          </summary>
          <ul className="space-y-2 border-t border-line px-3 py-3">
            <li><b className="text-snow">TradingView</b> (plan con webhooks): pegá la URL en "Webhook URL" de la alerta.</li>
            <li><b className="text-snow">Telegram, WhatsApp o Discord:</b> copiá el mensaje de la señal y pegalo en "Registrar → Pegar señal". Lo interpreta solo.</li>
            <li><b className="text-snow">Zapier, Make o n8n:</b> usá la acción "Webhooks → POST" hacia esta URL con el texto de la señal como cuerpo.</li>
            <li><b className="text-snow">Bots y plataformas propias:</b> un POST con JSON, por ejemplo <span className="num text-gold">{"{"}"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":66500,"sl":64500{"}"}</span>.</li>
            <li><b className="text-snow">A mano:</b> "Registrar → Manual".</li>
          </ul>
        </details>
        <AlertBuilder notify={notify} />
        {url &&
          (regenArmed ? (
            <button
              onClick={regenerate}
              className="w-full rounded-md border border-bear bg-bear/15 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-bear transition-colors hover:bg-bear/30"
            >
              Confirmar: la URL actual dejará de funcionar
            </button>
          ) : (
            <button
              onClick={() => setRegenArmed(true)}
              className="w-full rounded-md border border-line px-3 py-2 text-[11px] font-semibold text-dim transition-colors hover:border-line2 hover:text-fog"
            >
              Regenerar URL del webhook
            </button>
          ))}
      </div>
      )}
    </section>
  );
}

// ─── Bienvenida ─────────────────────────────────────────────────────────────

const WELCOME_KEY = "veltrix_welcome_v1";

function WelcomeCard() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) !== "done";
    } catch {
      return false;
    }
  });
  if (!visible) return null;
  const close = () => {
    setVisible(false);
    try {
      localStorage.setItem(WELCOME_KEY, "done");
    } catch {
      /* sin almacenamiento */
    }
  };
  const steps = [
    ["1", "Cargá tu primera señal", 'Pegá un mensaje de Telegram o WhatsApp en "Registrar operación", o cargala a mano.'],
    ["2", "Conectá tu fuente", 'Abajo, en "Conectá tu fuente de señales", copiá tu URL personal para TradingView u otras herramientas.'],
    ["3", "Mirá tus resultados", "VELTRIX calcula tu R neto, acierto y curva de capital. El cierre de TP y SL puede ser automático."],
  ];
  return (
    <section className="rounded-lg border border-gold/40 bg-golddeep/30 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-wide text-snow">BIENVENIDO A VELTRIX</h2>
          <p className="text-[12px] text-fog">Empezá en tres pasos.</p>
        </div>
        <button
          onClick={close}
          className="shrink-0 rounded-md border border-line px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-fog transition-colors hover:border-line2 hover:text-snow"
        >
          Entendido
        </button>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map(([n, title, text]) => (
          <li key={n} className="flex gap-3 rounded-md border border-line bg-panel/70 p-3.5">
            <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold text-[13px] font-bold text-ink">
              {n}
            </span>
            <span>
              <b className="block text-[13px] text-snow">{title}</b>
              <span className="text-[12px] leading-relaxed text-fog">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

function Dashboard({ userId }: { userId: string }) {
  const { trades, loading } = useTrades(userId);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [manualTrade, setManualTrade] = useState<Trade | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [flashId, flash] = useFlashId();
  const now = useNow(1000);

  useEffect(() => {
    if (!deleteArmed) return;
    const id = window.setTimeout(() => setDeleteArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [deleteArmed]);

  const deleteAccount = async () => {
    try {
      await deleteMyAccount();
    } catch (err) {
      setDeleteArmed(false);
      notify(err instanceof Error ? err.message : "No se pudo eliminar la cuenta.", "err");
    }
  };

  useEffect(() => {
    if (!clearArmed) return;
    const id = window.setTimeout(() => setClearArmed(false), 2800);
    return () => window.clearTimeout(id);
  }, [clearArmed]);

  const notify = useCallback<Notify>((msg, kind = "ok") => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const addTrades = useCallback(
    async (list: NewTrade[]) => {
      try {
        const ids = await insertTrades(userId, list);
        if (ids[0]) flash(ids[0]);
        notify(
          list.length === 1
            ? `Operación registrada: ${list[0].symbol} ${list[0].direction} @ ${list[0].entry}`
            : `${list.length} operaciones registradas en el diario.`,
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : "No se pudo registrar la operación.", "err");
      }
    },
    [userId, flash, notify],
  );

  const markOutcome = useCallback(
    async (id: string, outcome: "TP" | "SL") => {
      const t = trades.find((x) => x.id === id);
      try {
        await markTradeOutcome(id, outcome);
        if (t) {
          const r = outcome === "TP" ? rrOf(t) : -1;
          notify(`${t.symbol} cerrada en ${outcome} · ${fmtR(r)}R`, outcome === "TP" ? "ok" : "err");
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : "No se pudo cerrar la operación.", "err");
      }
    },
    [trades, notify],
  );

  const reopenTrade = useCallback(
    async (id: string) => {
      try {
        await reopenTradeById(id);
        notify("Operación reabierta.", "info");
      } catch (err) {
        notify(err instanceof Error ? err.message : "No se pudo reabrir la operación.", "err");
      }
    },
    [notify],
  );

  const deleteTrade = useCallback(
    async (id: string) => {
      try {
        await deleteTradeById(id);
        notify("Operación eliminada del diario.", "info");
      } catch (err) {
        notify(err instanceof Error ? err.message : "No se pudo eliminar la operación.", "err");
      }
    },
    [notify],
  );

  const closeManual = useCallback(
    async (exit: number) => {
      if (!manualTrade) return;
      const risk = Math.abs(manualTrade.entry - manualTrade.sl);
      const dir = manualTrade.direction === "LONG" ? 1 : -1;
      const r = risk > 0 ? (dir * (exit - manualTrade.entry)) / risk : 0;
      try {
        await closeTradeManually(manualTrade.id, exit);
        notify(
          r === 0
            ? `${manualTrade.symbol} cerrada en Break Even · 0R`
            : `${manualTrade.symbol} cerrada manualmente · ${fmtR(r)}R`,
          r >= 0 ? "ok" : "err",
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : "No se pudo cerrar la operación.", "err");
      } finally {
        setManualTrade(null);
      }
    },
    [manualTrade, notify],
  );

  const loadSample = useCallback(async () => {
    try {
      await insertFullTrades(userId, sampleTrades());
      notify("17 operaciones de ejemplo cargadas — explorá el diario.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "No se pudieron cargar los datos de ejemplo.", "err");
    }
  }, [userId, notify]);

  const exportCsv = useCallback(() => {
    if (!trades.length) return;
    downloadCsv(trades);
    notify("CSV exportado — compatible con Excel y Google Sheets.");
  }, [trades, notify]);

  const clearAll = useCallback(async () => {
    try {
      await deleteAllTrades(userId);
      notify("Diario borrado por completo.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "No se pudo borrar el diario.", "err");
    } finally {
      setClearArmed(false);
    }
  }, [userId, notify]);

  return (
    <div className="min-h-screen">
      <Ticker trades={trades} />

      {/* Cabecera */}
      <header className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-4 px-4 py-5 lg:px-8">
        <div className="flex items-center gap-3.5">
          <ShieldLogo className="h-14 w-14 drop-shadow-[0_0_18px_rgba(46,196,241,.35)]" />
          <div>
            <h1 className="font-display text-[34px] font-extrabold leading-none tracking-[0.04em] text-snow sm:text-4xl">
              VELTRIX
            </h1>
            <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-fog">
              Diario de trading · En vivo
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden items-center gap-3 rounded-md border border-line bg-panel/70 px-3.5 py-2 sm:flex">
            <span className="live-dot h-2 w-2 rounded-full bg-bull" />
            <div>
              <p className="num text-[13px] font-bold leading-none text-snow">
                {now.toLocaleTimeString("es-ES")}
              </p>
              <p className="num mt-0.5 text-[10px] capitalize text-dim">
                {now.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" })}
              </p>
            </div>
          </div>
          <a
            href={COMMUNITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-cyan/45 bg-cyan/10 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-cyan transition-all hover:-translate-y-px hover:bg-cyan/20 active:scale-[0.98]"
          >
            <IconTelegram className="h-4 w-4" /> Comunidad
          </a>
          <button
            onClick={exportCsv}
            disabled={!trades.length}
            className="flex items-center gap-2 rounded-md border border-gold/45 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold transition-all hover:-translate-y-px hover:bg-gold/10 hover:shadow-[0_6px_20px_rgba(46,196,241,.15)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
          >
            <IconDownload className="h-3.5 w-3.5" /> Exportar CSV
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="rounded-md border border-line px-3.5 py-2.5 text-[12px] font-semibold text-dim transition-colors hover:border-line2 hover:text-snow"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="mx-auto h-px max-w-[1440px] bg-gradient-to-r from-gold/50 via-line to-transparent" />

      {/* Contenido */}
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 pb-14 pt-5 lg:px-8">
        <WelcomeCard />
        <Reveal>
          <StatsBand trades={trades} />
        </Reveal>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-5 max-lg:contents">
            <Reveal delay={70} className="max-lg:order-4">
              <div className="overflow-hidden rounded-lg border border-line bg-panel">
                <EquityChart trades={trades} />
              </div>
            </Reveal>
            <Reveal delay={140} className="max-lg:order-1">
              {loading ? (
                <div className="rounded-lg border border-line bg-panel px-6 py-16 text-center text-sm text-fog">
                  Cargando diario…
                </div>
              ) : (
                <TradeTable
                  trades={trades}
                  flashId={flashId}
                  onMark={markOutcome}
                  onManual={setManualTrade}
                  onDelete={deleteTrade}
                  onReopen={reopenTrade}
                  onLoadSample={loadSample}
                />
              )}
            </Reveal>
          </div>

          <aside className="space-y-5 max-lg:contents">
            <Reveal delay={110} className="max-lg:order-2">
              <TradeForm onAdd={addTrades} notify={notify} />
            </Reveal>
            <Reveal delay={130} className="max-lg:order-3">
              <RiskCalculator notify={notify} />
            </Reveal>
            <Reveal delay={150} className="max-lg:order-6">
              <WebhookCard userId={userId} notify={notify} />
            </Reveal>
            {trades.length > 0 && (
              <Reveal delay={180} className="max-lg:order-5">
                <MonthlySummary trades={trades} />
              </Reveal>
            )}
          </aside>
        </div>
      </main>

      {/* Pie */}
      <footer className="border-t border-line bg-panel/60">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-5 lg:px-8">
          <p className="text-[11.5px] text-dim">
            <span className="font-bold text-fog">VELTRIX</span> — tu diario se sincroniza en la nube entre
            web y móvil.
          </p>
          <div className="flex flex-wrap items-center gap-2">
          {deleteArmed ? (
            <button
              onClick={deleteAccount}
              className="rounded-md border border-bear bg-bear/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-bear transition-colors hover:bg-bear/30"
            >
              Confirmar: eliminar cuenta y todos mis datos
            </button>
          ) : (
            <button
              onClick={() => setDeleteArmed(true)}
              className="rounded-md border border-line px-3.5 py-1.5 text-[11px] font-semibold text-dim transition-colors hover:border-bear/50 hover:text-bear"
            >
              Eliminar mi cuenta
            </button>
          )}
          {trades.length > 0 &&
            (clearArmed ? (
              <button
                onClick={clearAll}
                className="rounded-md border border-bear bg-bear/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-bear transition-colors hover:bg-bear/30"
              >
                Confirmar borrado total
              </button>
            ) : (
              <button
                onClick={() => setClearArmed(true)}
                className="rounded-md border border-line px-3.5 py-1.5 text-[11px] font-semibold text-dim transition-colors hover:border-bear/50 hover:text-bear"
              >
                Borrar diario
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto max-w-[1440px] border-t border-line/60 px-4 py-4 lg:px-8">
          <p className="text-[10.5px] leading-relaxed text-dim">
            VELTRIX es una herramienta de registro y no constituye asesoramiento financiero ni recomendación de
            inversión. Operar en mercados financieros implica riesgo de pérdida. Los resultados pasados no garantizan
            resultados futuros. No está afiliado a TradingView.{" "}
            <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="text-cyan underline hover:text-snow">
              Comunidad
            </a>{" · "}
            <a href="/terms.html" target="_blank" rel="noopener" className="text-fog underline hover:text-snow">
              Términos
            </a>{" · "}
            <a href="/privacy.html" target="_blank" rel="noopener" className="text-fog underline hover:text-snow">
              Privacidad
            </a>{" · "}
            <a href="/delete-account.html" target="_blank" rel="noopener" className="text-fog underline hover:text-snow">
              Eliminar datos
            </a>
          </p>
        </div>
      </footer>

      {manualTrade && (
        <CloseModal trade={manualTrade} onConfirm={closeManual} onCancel={() => setManualTrade(null)} />
      )}

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

export default function App() {
  const { session, isRecovery, clearRecovery } = useSession();
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  if (isRecovery) {
    return (
      <ResetPassword
        onDone={(notice) => {
          clearRecovery();
          setAuthNotice(notice);
        }}
      />
    );
  }

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <IconCheck className="h-6 w-6 animate-pulse text-gold" />
      </div>
    );
  }

  if (!session) return <Auth initialNotice={authNotice} />;

  return <Dashboard userId={session.user.id} />;
}

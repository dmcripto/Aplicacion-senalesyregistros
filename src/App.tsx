import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EXAMPLE_ALERT,
  STORAGE_KEY,
  computeStats,
  cx,
  downloadCsv,
  fmtPct,
  fmtR,
  resultR,
  rrOf,
  sampleTrades,
  uid,
} from "./lib";
import type { NewTrade, Trade } from "./lib";
import { useCountUp, useFlashId, useLocalStorage, useNow } from "./hooks";
import {
  CloseModal,
  IconDownload,
  Reveal,
  ShieldLogo,
  ToastStack,
  TriDown,
  TriUp,
} from "./ui";
import type { ToastData } from "./ui";
import EquityChart from "./components/EquityChart";
import TradeForm from "./components/TradeForm";
import TradeTable from "./components/TradeTable";
import MonthlySummary from "./components/MonthlySummary";

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
          DMCRIPTO925 · cuando cierres operaciones, el ticker de resultados corre acá
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

      <div className="col-span-2 bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:col-span-1 md:py-5">
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

// ─── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [trades, setTrades] = useLocalStorage<Trade[]>(STORAGE_KEY, []);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [manualTrade, setManualTrade] = useState<Trade | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [flashId, flash] = useFlashId();
  const now = useNow(1000);

  useEffect(() => {
    if (!clearArmed) return;
    const id = window.setTimeout(() => setClearArmed(false), 2800);
    return () => window.clearTimeout(id);
  }, [clearArmed]);

  const notify = useCallback((msg: string, kind: "ok" | "err" | "info" = "ok") => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const addTrades = useCallback(
    (list: NewTrade[]) => {
      const withIds: Trade[] = list.map((n) => ({ ...n, id: uid(), outcome: "ABIERTA" as const }));
      setTrades((prev) => [...withIds, ...prev]);
      flash(withIds[0].id);
      notify(
        list.length === 1
          ? `Operación registrada: ${list[0].symbol} ${list[0].direction} @ ${list[0].entry}`
          : `${list.length} operaciones registradas en el diario.`,
      );
    },
    [setTrades, flash, notify],
  );

  const markOutcome = useCallback(
    (id: string, outcome: "TP" | "SL") => {
      const t = trades.find((x) => x.id === id);
      setTrades((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, outcome, closedAt: new Date().toISOString() } : x,
        ),
      );
      if (t) {
        const r = outcome === "TP" ? rrOf(t) : -1;
        notify(`${t.symbol} cerrada en ${outcome} · ${fmtR(r)}R`, outcome === "TP" ? "ok" : "err");
      }
    },
    [trades, setTrades, notify],
  );

  const reopenTrade = useCallback(
    (id: string) => {
      setTrades((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, outcome: "ABIERTA" as const, closedAt: undefined, exit: undefined } : x,
        ),
      );
      notify("Operación reabierta.", "info");
    },
    [setTrades, notify],
  );

  const deleteTrade = useCallback(
    (id: string) => {
      setTrades((prev) => prev.filter((x) => x.id !== id));
      notify("Operación eliminada del diario.", "info");
    },
    [setTrades, notify],
  );

  const closeManual = useCallback(
    (exit: number) => {
      if (!manualTrade) return;
      const risk = Math.abs(manualTrade.entry - manualTrade.sl);
      const dir = manualTrade.direction === "LONG" ? 1 : -1;
      const r = risk > 0 ? (dir * (exit - manualTrade.entry)) / risk : 0;
      setTrades((prev) =>
        prev.map((x) =>
          x.id === manualTrade.id
            ? { ...x, outcome: "MANUAL" as const, exit, closedAt: new Date().toISOString() }
            : x,
        ),
      );
      setManualTrade(null);
      notify(
        r === 0
          ? `${manualTrade.symbol} cerrada en Break Even · 0R`
          : `${manualTrade.symbol} cerrada manualmente · ${fmtR(r)}R`,
        r >= 0 ? "ok" : "err",
      );
    },
    [manualTrade, setTrades, notify],
  );

  const loadSample = useCallback(() => {
    setTrades(sampleTrades());
    notify("17 operaciones de ejemplo cargadas — explorá el diario.", "info");
  }, [setTrades, notify]);

  const exportCsv = useCallback(() => {
    if (!trades.length) return;
    downloadCsv(trades);
    notify("CSV exportado — compatible con Excel y Google Sheets.");
  }, [trades, notify]);

  const clearAll = useCallback(() => {
    setTrades([]);
    setClearArmed(false);
    notify("Diario borrado por completo.", "info");
  }, [setTrades, notify]);

  return (
    <div className="min-h-screen">
      <Ticker trades={trades} />

      {/* Cabecera */}
      <header className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-4 px-4 py-5 lg:px-8">
        <div className="flex items-center gap-3.5">
          <ShieldLogo className="h-12 w-12 drop-shadow-[0_0_18px_rgba(243,183,30,.25)]" />
          <div>
            <h1 className="font-display text-[34px] font-extrabold leading-none tracking-[0.04em] text-snow sm:text-4xl">
              DMCRIPTO<span className="text-gold">925</span>
            </h1>
            <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-fog">
              Diario de trading · SMC / ICT
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
          <button
            onClick={exportCsv}
            disabled={!trades.length}
            className="flex items-center gap-2 rounded-md border border-gold/45 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold transition-all hover:-translate-y-px hover:bg-gold/10 hover:shadow-[0_6px_20px_rgba(243,183,30,.15)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
          >
            <IconDownload className="h-3.5 w-3.5" /> Exportar CSV
          </button>
        </div>
      </header>

      <div className="mx-auto h-px max-w-[1440px] bg-gradient-to-r from-gold/50 via-line to-transparent" />

      {/* Contenido */}
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 pb-14 pt-5 lg:px-8">
        <Reveal>
          <StatsBand trades={trades} />
        </Reveal>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-5">
            <Reveal delay={70}>
              <div className="overflow-hidden rounded-lg border border-line bg-panel">
                <EquityChart trades={trades} />
              </div>
            </Reveal>
            <Reveal delay={140}>
              <TradeTable
                trades={trades}
                flashId={flashId}
                onMark={markOutcome}
                onManual={setManualTrade}
                onDelete={deleteTrade}
                onReopen={reopenTrade}
                onLoadSample={loadSample}
              />
            </Reveal>
          </div>

          <aside className="space-y-5">
            <Reveal delay={110}>
              <TradeForm onAdd={addTrades} notify={notify} />
            </Reveal>
            {trades.length > 0 && (
              <Reveal delay={180}>
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
            <span className="font-bold text-fog">DMCRIPTO925</span> — tus operaciones se guardan solo en este
            navegador. Formato de alerta:{" "}
            <span className="num rounded bg-ink px-1.5 py-0.5 text-[10.5px] text-gold">{EXAMPLE_ALERT}</span>
          </p>
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
      </footer>

      {manualTrade && (
        <CloseModal trade={manualTrade} onConfirm={closeManual} onCancel={() => setManualTrade(null)} />
      )}

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

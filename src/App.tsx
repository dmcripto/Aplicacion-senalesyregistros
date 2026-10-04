import { trackGlow } from "./glowTracking";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMMUNITY_URL,
  computeStats,
  cx,
  dailyStatus,
  FEATURES,
  downloadCsv,
  fmtPct,
  fmtR,
  getLang,
  locale,
  resultR,
  rrOf,
  sampleTrades,
} from "./lib";
import { NO_MONEY, balanceInfo, fmtCurrency } from "./lib";
import type { DailyLimits, MoneySettings, Trade } from "./lib";
import { useCountUp, useFlashId, useNow, usePrices, useSession, useTpCelebration, useTrades } from "./hooks";
import {
  CloseModal,
  NotesModal,
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
  updateTradeNotes,
  fetchLimits,
  saveLimits,
  fetchMoney,
  saveMoney,
  saveLang,
  saveTimezone,
  insertFullTrades,
  insertTrades,
  markTradeOutcome,
  reopenTradeById,
} from "./tradesApi";
import type { NewTrade } from "./lib";
import { LangSwitch, legalUrl } from "./lang";
import Auth from "./components/Auth";
import ResetPassword from "./components/ResetPassword";
import EquityChart from "./components/EquityChart";
import TradeForm from "./components/TradeForm";
import TradeTable from "./components/TradeTable";
import MonthlySummary from "./components/MonthlySummary";
import AlertBuilder from "./components/AlertBuilder";
import RiskCalculator from "./components/RiskCalculator";
import TagStats from "./components/TagStats";
import Analysis from "./components/Analysis";
import MoneyCard from "./components/MoneyCard";
import ExchangeCard from "./components/ExchangeCard";
import TelegramCard from "./components/TelegramCard";
import Panel, { jumpToPanel, openAllPanels } from "./components/Panel";
import LiquidationMap from "./components/LiquidationMap";
import CoachCard from "./components/CoachCard";
import WhatsAppCard from "./components/WhatsAppCard";
import TodayCard from "./components/TodayCard";
import Celebration from "./components/Celebration";
import { MoneyContext, makeMoneyCtx, useMoney } from "./money";
import ShareCard from "./components/ShareCard";
import DailyLimitsCard, { LimitBanner } from "./components/DailyLimits";
import { t } from "./lib";

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
          {t("VELTRIX · cuando cierres operaciones, el ticker de resultados corre acá")}
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
  const { money } = useMoney();
  const bal = useMemo(() => balanceInfo(trades, money), [trades, money]);

  return (
    <div className="glow-card grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-[0_18px_40px_-26px_rgba(0,0,0,.75)] md:grid-cols-4 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1.15fr]">
      <div className="stat-cell col-span-2 bg-panel px-5 py-4 md:col-span-4 md:py-5 xl:col-span-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">{t("R neto acumulado")}</p>
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
          {t("mejor")} {fmtR(stats.bestR)}R · {t("peor")} {fmtR(stats.worstR)}R
        </p>
        {bal && (
          <p className="num mt-1 text-[12px] font-semibold text-fog">
            <span className={bal.pnl >= 0 ? "text-bull" : "text-bear"}>{fmtCurrency(bal.pnl, money.currency)}</span>
            {" · " + t("balance") + " "}
            <span className="text-snow">{fmtCurrency(bal.balance, money.currency, false)}</span>
            {" ("}
            <span className={bal.returnPct >= 0 ? "text-bull" : "text-bear"}>
              {bal.returnPct >= 0 ? "+" : "−"}
              {Math.abs(bal.returnPct).toFixed(1)}%
            </span>
            {")"}
          </p>
        )}
      </div>

      <div className="stat-cell bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">{t("Acierto")}</p>
        <p className={cx("num mt-1 text-3xl font-bold leading-none", winPos ? "text-bull" : "text-bear")}>
          {fmtPct(winRate)}
        </p>
        <p className="num mt-1.5 text-[11px] text-dim">
          {stats.ganadas}G · {stats.perdidas}P
        </p>
      </div>

      <div className="stat-cell bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">{t("Profit factor")}</p>
        <p className="num mt-1 text-3xl font-bold leading-none text-snow">
          {stats.pf === null ? "∞" : stats.cerradas ? stats.pf.toFixed(2) : "—"}
        </p>
        <p className="num mt-1.5 text-[11px] text-dim">{t("ganancia / pérdida")}</p>
      </div>

      <div className="stat-cell bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">{t("R promedio")}</p>
        <p
          className={cx(
            "num mt-1 text-3xl font-bold leading-none",
            stats.avgR > 0 ? "text-bull" : stats.avgR < 0 ? "text-bear" : "text-fog",
          )}
        >
          {stats.cerradas ? fmtR(avgR) : "—"}
        </p>
        <p className="num mt-1.5 text-[11px] text-dim">{t("por operación cerrada")}</p>
      </div>

      <div className="stat-cell bg-panel px-5 py-4 transition-colors hover:bg-panel2 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog">{t("Operaciones")}</p>
        <p className="num mt-1 text-3xl font-bold leading-none text-snow">{stats.total}</p>
        <p className="num mt-1.5 flex items-center gap-1.5 text-[11px] text-dim">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" />
          {stats.abiertas} {t("abiertas")} · {stats.cerradas} {t("cerradas")}
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
  const [autoClose, setAutoCloseState] = useState(true);

  useEffect(() => {
    fetchAutoClose(userId).then(setAutoCloseState).catch(() => {});
  }, [userId]);

  const toggleAutoClose = async () => {
    const next = !autoClose;
    setAutoCloseState(next);
    try {
      await setAutoClose(userId, next);
      notify(next ? t("Cierre automático activado.") : t("Cierre automático desactivado."));
    } catch (err) {
      setAutoCloseState(!next);
      notify(err instanceof Error ? err.message : t("No se pudo guardar el cambio."), "err");
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
      notify(t("URL regenerada. Actualizala en tus alertas de TradingView: la anterior dejó de funcionar."));
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudo regenerar la URL."), "err");
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchWebhookUrl(userId)
      .then((u) => !cancelled && setUrl(u))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : t("No se pudo obtener la URL.")));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify(t("URL de webhook copiada al portapapeles."));
    } catch {
      notify(t("No se pudo copiar automáticamente — seleccioná el texto a mano."), "err");
    }
  };

  return (
    <Panel
      id="webhook"
      title={t("CONECTÁ TU FUENTE DE SEÑALES")}
      subtitle={t("Enviá tus señales a esta URL, vengan de donde vengan")}
      summary={autoClose ? t("Cierre automático activado") : t("Cierre automático desactivado")}
      defaultOpen={false}
    >
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
            <b className="text-snow">{t("Cierre automático:")}</b>{" "}
            {t("VELTRIX sigue el precio (criptomonedas) y marca TP o SL solo cuando el precio los toca. Si una misma vela toca ambos, se toma SL.")}
          </span>
        </label>
        <details className="group rounded-md border border-line bg-ink/40 text-[11.5px] leading-relaxed text-fog">
          <summary className="cursor-pointer select-none px-3 py-2.5 font-bold uppercase tracking-[0.12em] text-gold">
            {t("¿Desde dónde puedo enviar señales?")}
          </summary>
          <ul className="space-y-2 border-t border-line px-3 py-3">
            <li><b className="text-snow">TradingView</b> {t("(plan con webhooks): pegá la URL en \"Webhook URL\" de la alerta.")}</li>
            <li><b className="text-snow">{t("Telegram, WhatsApp o Discord:")}</b> {t("copiá el mensaje de la señal y pegalo en \"Registrar → Pegar señal\". Lo interpreta solo.")}</li>
            <li><b className="text-snow">{t("Zapier, Make o n8n:")}</b> {t("usá la acción \"Webhooks → POST\" hacia esta URL con el texto de la señal como cuerpo.")}</li>
            <li><b className="text-snow">{t("Bots y plataformas propias:")}</b> {t("un POST con JSON, por ejemplo")} <span className="num text-gold">{"{"}"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":66500,"sl":64500{"}"}</span>.</li>
            <li><b className="text-snow">{t("A mano:")}</b> {t("\"Registrar → Manual\".")}</li>
          </ul>
        </details>
        <AlertBuilder notify={notify} />
        {url &&
          (regenArmed ? (
            <button
              onClick={regenerate}
              className="w-full rounded-md border border-bear bg-bear/15 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-bear transition-colors hover:bg-bear/30"
            >
              {t("Confirmar: la URL actual dejará de funcionar")}
            </button>
          ) : (
            <button
              onClick={() => setRegenArmed(true)}
              className="w-full rounded-md border border-line px-3 py-2 text-[11px] font-semibold text-dim transition-colors hover:border-line2 hover:text-fog"
            >
              {t("Regenerar URL del webhook")}
            </button>
          ))}
      </div>
    </Panel>
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
    ["1", t("Cargá tu primera señal"), t("Pegá un mensaje de Telegram o WhatsApp en \"Registrar operación\", o cargala a mano.")],
    ["2", t("Conectá tu fuente"), t("Abajo, en \"Conectá tu fuente de señales\", copiá tu URL personal para TradingView u otras herramientas.")],
    ["3", t("Mirá tus resultados"), t("VELTRIX calcula tu R neto, acierto y curva de capital. El cierre de TP y SL puede ser automático.")],
  ];
  return (
    <section className="rounded-lg border border-gold/40 bg-golddeep/30 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-wide text-snow">{t("BIENVENIDO A VELTRIX")}</h2>
          <p className="text-[12px] text-fog">{t("Empezá en tres pasos.")}</p>
        </div>
        <button
          onClick={close}
          className="shrink-0 rounded-md border border-line px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-fog transition-colors hover:border-line2 hover:text-snow"
        >
          {t("Entendido")}
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
  const { trades, loading, removeLocal, restoreLocal } = useTrades(userId);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [manualTrade, setManualTrade] = useState<Trade | null>(null);
  const [notesTrade, setNotesTrade] = useState<Trade | null>(null);
  const [sharing, setSharing] = useState(false);
  const [money, setMoney] = useState<MoneySettings>(NO_MONEY);
  const moneyCtx = useMemo(() => makeMoneyCtx(money), [money]);

  useEffect(() => {
    fetchMoney(userId).then(setMoney).catch(() => {});
    saveLang(userId, getLang()).catch(() => {});
    saveTimezone(userId).catch(() => {});
  }, [userId]);
  const [limits, setLimits] = useState<DailyLimits>({ maxLossR: null, maxTrades: null });
  const limitStatus = useMemo(() => dailyStatus(trades, limits), [trades, limits]);

  useEffect(() => {
    fetchLimits(userId).then(setLimits).catch(() => {});
  }, [userId]);

  const [clearArmed, setClearArmed] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [flashId, flash] = useFlashId();
  const now = useNow(1000);
  const prices = usePrices(trades);
  const [tpHit, clearTpHit] = useTpCelebration(trades);

  // Resplandor e inclinación 3D que siguen al cursor en las tarjetas con la clase glow-card.
  useEffect(() => trackGlow(), []);

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
      notify(err instanceof Error ? err.message : t("No se pudo eliminar la cuenta."), "err");
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

  const persistLimits = useCallback(
    async (l: DailyLimits) => {
      try {
        await saveLimits(userId, l);
        setLimits(l);
        notify(t("Límites guardados."));
      } catch (err) {
        notify(err instanceof Error ? err.message : t("No se pudieron guardar los límites."), "err");
      }
    },
    [userId, notify],
  );

  const persistMoney = useCallback(
    async (m: MoneySettings) => {
      try {
        await saveMoney(userId, m);
        setMoney(m);
        notify(t("Capital guardado."));
      } catch (err) {
        notify(err instanceof Error ? err.message : t("No se pudo guardar el capital."), "err");
      }
    },
    [userId, notify],
  );

  const addTrades = useCallback(
    async (list: NewTrade[]) => {
      if (limitStatus.level === "stop" && !window.confirm(`${limitStatus.messages.join("\n")}\n\n${t("¿Querés registrar la operación igual?")}`)) return;
      try {
        const ids = await insertTrades(userId, list);
        if (ids[0]) flash(ids[0]);
        notify(
          list.length === 1
            ? t("Operación registrada: {sym} {dir} @ {entry}", { sym: list[0].symbol, dir: list[0].direction, entry: list[0].entry })
            : t("{n} operaciones registradas en el diario.", { n: list.length }),
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : t("No se pudo registrar la operación."), "err");
      }
    },
    [userId, flash, notify, limitStatus],
  );

  const markOutcome = useCallback(
    async (id: string, outcome: "TP" | "SL") => {
      const tr = trades.find((x) => x.id === id);
      try {
        await markTradeOutcome(id, outcome);
        if (tr) {
          const r = outcome === "TP" ? rrOf(tr) : -1;
          notify(t("{sym} cerrada en {out} · {r}R", { sym: tr.symbol, out: outcome, r: fmtR(r) }), outcome === "TP" ? "ok" : "err");
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : t("No se pudo cerrar la operación."), "err");
      }
    },
    [trades, notify],
  );

  const reopenTrade = useCallback(
    async (id: string) => {
      try {
        await reopenTradeById(id);
        notify(t("Operación reabierta."), "info");
      } catch (err) {
        notify(err instanceof Error ? err.message : t("No se pudo reabrir la operación."), "err");
      }
    },
    [notify],
  );

  // Borrar es de un solo toque: la operación sale de la lista en el momento y durante 6 segundos se puede deshacer.
  // Recién pasado ese tiempo se borra de verdad; si se cierra la página antes, se borra al salir.
  const pendingDeletes = useRef(new Map<string, number>());
  const deleteTrade = useCallback(
    (id: string) => {
      const tr = trades.find((x) => x.id === id);
      if (!tr || pendingDeletes.current.has(id)) return;
      removeLocal([id]);
      const toastId = crypto.randomUUID();
      const drop = () => setToasts((list) => list.filter((x) => x.id !== toastId));
      const timer = window.setTimeout(async () => {
        pendingDeletes.current.delete(id);
        drop();
        try {
          await deleteTradeById(id);
        } catch (err) {
          restoreLocal(tr);
          notify(err instanceof Error ? err.message : t("No se pudo eliminar la operación."), "err");
        }
      }, 6000);
      pendingDeletes.current.set(id, timer);
      setToasts((list) => [
        ...list.slice(-3),
        {
          id: toastId,
          msg: t("Operación eliminada: {sym}", { sym: tr.symbol }),
          kind: "info",
          action: {
            label: t("Deshacer"),
            onClick: () => {
              window.clearTimeout(timer);
              pendingDeletes.current.delete(id);
              restoreLocal(tr);
            },
          },
        },
      ]);
    },
    [trades, removeLocal, restoreLocal, notify],
  );

  // Si se cierra la pestaña con borrados pendientes, se terminan de borrar.
  useEffect(() => {
    const flush = () => {
      for (const [id, timer] of pendingDeletes.current) {
        window.clearTimeout(timer);
        void deleteTradeById(id).catch(() => {});
      }
      pendingDeletes.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const saveNotes = useCallback(
    async (notes: string, tags: string[]) => {
      if (!notesTrade) return;
      try {
        await updateTradeNotes(notesTrade.id, notes, tags);
        notify(t("Notas guardadas."));
      } catch (err) {
        notify(err instanceof Error ? err.message : t("No se pudieron guardar las notas."), "err");
      } finally {
        setNotesTrade(null);
      }
    },
    [notesTrade, notify],
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
            ? t("{sym} cerrada en Break Even · 0R", { sym: manualTrade.symbol })
            : t("{sym} cerrada manualmente · {r}R", { sym: manualTrade.symbol, r: fmtR(r) }),
          r >= 0 ? "ok" : "err",
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : t("No se pudo cerrar la operación."), "err");
      } finally {
        setManualTrade(null);
      }
    },
    [manualTrade, notify],
  );

  const loadSample = useCallback(async () => {
    try {
      await insertFullTrades(userId, sampleTrades());
      notify(t("17 operaciones de ejemplo cargadas — explorá el diario."), "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudieron cargar los datos de ejemplo."), "err");
    }
  }, [userId, notify]);

  const exportCsv = useCallback(() => {
    if (!trades.length) return;
    downloadCsv(trades);
    notify(t("CSV exportado — compatible con Excel y Google Sheets."));
  }, [trades, notify]);

  const clearAll = useCallback(async () => {
    try {
      await deleteAllTrades(userId);
      removeLocal("all");
      notify(t("Diario borrado por completo."), "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudo borrar el diario."), "err");
    } finally {
      setClearArmed(false);
    }
  }, [userId, notify, removeLocal]);

  return (
    <MoneyContext.Provider value={moneyCtx}>
    <div className="min-h-screen">
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      {tpHit && <Celebration symbol={tpHit.symbol} token={tpHit.token} onDone={clearTpHit} />}
      <Ticker trades={trades} />

      {/* Cabecera */}
      <header className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:gap-y-4 sm:py-5 lg:px-8">
        <div className="flex items-center gap-3.5">
          <span className="brand-logo"><ShieldLogo className="h-11 w-11 sm:h-14 sm:w-14" /></span>
          <div>
            <h1 className="font-display text-[28px] font-extrabold leading-none tracking-[0.04em] text-snow sm:text-4xl">
              <span className="brand-word">VELTRIX</span>
            </h1>
            <p className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.22em] text-fog sm:text-[10.5px] sm:tracking-[0.28em]">
              {t("Diario de trading · En vivo")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-3 rounded-md border border-line bg-panel/70 px-3.5 py-2 sm:flex">
            <span className="live-dot h-2 w-2 rounded-full bg-bull" />
            <div>
              <p className="num text-[13px] font-bold leading-none text-snow">
                {now.toLocaleTimeString(locale())}
              </p>
              <p className="num mt-0.5 text-[10px] capitalize text-dim">
                {now.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "short" })}
              </p>
            </div>
          </div>
          <a
            href={COMMUNITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t("Comunidad")}
            aria-label={t("Comunidad")}
            className="flex items-center gap-2 rounded-md border border-cyan/45 bg-cyan/10 px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider text-cyan transition-all hover:-translate-y-px hover:bg-cyan/20 active:scale-[0.98] sm:px-4"
          >
            <IconTelegram className="h-4 w-4" /> <span className="hidden sm:inline">{t("Comunidad")}</span>
          </a>
          <button
            onClick={() => setSharing(true)}
            disabled={!trades.length}
            title={t("Compartir")}
            aria-label={t("Compartir")}
            className="flex items-center gap-2 rounded-md border border-bull/45 bg-bull/10 px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider text-bull transition-all hover:-translate-y-px hover:bg-bull/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 sm:px-4"
          >
            <span className="text-[15px] leading-none">↗</span><span className="hidden sm:inline">{t("Compartir")}</span>
          </button>
          <button
            onClick={exportCsv}
            disabled={!trades.length}
            title={t("Exportar CSV")}
            aria-label={t("Exportar CSV")}
            className="flex items-center gap-2 rounded-md border border-gold/45 px-3 py-2.5 sm:px-4 text-[12px] font-bold uppercase tracking-wider text-gold transition-all hover:-translate-y-px hover:bg-gold/10 hover:shadow-[0_6px_20px_rgba(46,196,241,.15)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
          >
            <IconDownload className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("Exportar CSV")}</span>
          </button>
          <LangSwitch />
          <button
            onClick={() => supabase.auth.signOut()}
            className="rounded-md border border-line px-3 py-2.5 text-[12px] font-semibold text-dim transition-colors hover:border-line2 hover:text-snow sm:px-3.5"
          >
            {t("Salir")}
          </button>
        </div>
      </header>

      <div className="mx-auto h-px max-w-[1440px] bg-gradient-to-r from-gold/50 via-line to-transparent" />

      {/* Contenido */}
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 pb-14 pt-5 lg:px-8">
        <WelcomeCard />
        <LimitBanner status={limitStatus} />
        <Reveal>
          <TodayCard trades={trades} prices={prices} now={now} />
        </Reveal>
        <Reveal delay={90}>
          <StatsBand trades={trades} />
        </Reveal>

        {/* Atajos a cada sección y abrir/cerrar todo */}
        <nav className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden" aria-label={t("Secciones")}>
          {(
            [
              ["register", t("Registrar")],
              ["journal", t("Diario")],
              ["analysis", t("Análisis")],
              ["liqmap", t("Mapa")],
              ["telegram", t("Conexiones")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => jumpToPanel(id)}
              className="shrink-0 whitespace-nowrap rounded-md border border-line px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-fog transition-colors hover:border-line2 hover:text-snow"
            >
              {label}
            </button>
          ))}
          <span className="ml-auto flex shrink-0 gap-2 whitespace-nowrap pl-2">
            <button
              type="button"
              onClick={() => openAllPanels(true)}
              className="rounded-md border border-line px-3 py-1.5 text-[11px] font-semibold text-dim transition-colors hover:border-line2 hover:text-fog"
            >
              {t("Expandir todo")}
            </button>
            <button
              type="button"
              onClick={() => openAllPanels(false)}
              className="rounded-md border border-line px-3 py-1.5 text-[11px] font-semibold text-dim transition-colors hover:border-line2 hover:text-fog"
            >
              {t("Contraer todo")}
            </button>
          </span>
        </nav>

        {/* Panel principal: curva | registrar; libro a todo el ancho; análisis | herramientas.
            Cada sección se abre y se cierra; las columnas son independientes para no dejar huecos. */}
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <Reveal delay={70} className="min-w-0 max-lg:order-5">
            <EquityChart trades={trades} />
          </Reveal>
          <Reveal delay={110} className="max-lg:order-2">
            <TradeForm onAdd={addTrades} notify={notify} />
          </Reveal>

          <Reveal delay={140} className="min-w-0 max-lg:order-1 lg:col-span-2">
            {loading ? (
              <div className="rounded-lg border border-line bg-panel px-6 py-16 text-center text-sm text-fog">
                {t("Cargando diario…")}
              </div>
            ) : (
              <TradeTable
                trades={trades}
                flashId={flashId}
                onMark={markOutcome}
                onManual={setManualTrade}
                onDelete={deleteTrade}
                onReopen={reopenTrade}
                onNotes={setNotesTrade}
                onLoadSample={loadSample}
                prices={prices}
              />
            )}
          </Reveal>

          <div className="min-w-0 space-y-5 max-lg:contents">
            <Reveal delay={160} className="max-lg:order-6">
              <Analysis trades={trades} />
            </Reveal>
            {FEATURES.coach && (
              <Reveal delay={170} className="max-lg:order-6">
                <CoachCard closedCount={trades.filter((x) => x.outcome !== "ABIERTA").length} />
              </Reveal>
            )}
            {trades.length > 0 && (
              <Reveal delay={180} className="max-lg:order-7">
                <MonthlySummary trades={trades} />
              </Reveal>
            )}
          </div>
          <div className="space-y-5 max-lg:contents">
            <Reveal delay={130} className="max-lg:order-3">
              <RiskCalculator notify={notify} />
            </Reveal>
            <Reveal delay={150} className="max-lg:order-4">
              <DailyLimitsCard limits={limits} status={limitStatus} onSave={persistLimits} />
            </Reveal>
            {trades.some((x) => x.tags?.length) && (
              <Reveal delay={200} className="max-lg:order-8">
                <TagStats trades={trades} />
              </Reveal>
            )}
          </div>
        </div>

        {/* El mapa ocupa todo el ancho: es un gráfico ancho y así no deja huecos al costado */}
        <Reveal delay={175}>
          <LiquidationMap />
        </Reveal>

        {/* Conexiones y ajustes: dos columnas parejas, debajo del diario */}
        <section className="space-y-4 pt-1">
          <div className="flex items-end gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-wide text-snow">{t("CONEXIONES Y AJUSTES")}</h2>
              <p className="text-[11px] uppercase tracking-[0.16em] text-dim">{t("Tus señales, tu exchange, tu capital y tus límites")}</p>
            </div>
            <div className="mb-2 hidden h-px flex-1 bg-gradient-to-r from-line to-transparent sm:block" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
            <Reveal delay={150} className="min-w-0">
              <WebhookCard userId={userId} notify={notify} />
            </Reveal>
            <div className="min-w-0 space-y-5">
              <Reveal delay={154}>
                <TelegramCard userId={userId} notify={notify} />
              </Reveal>
              <WhatsAppCard notify={notify} />
              <Reveal delay={158}>
                <ExchangeCard money={money} notify={notify} />
              </Reveal>
              <Reveal delay={165}>
                <MoneyCard money={money} trades={trades} onSave={persistMoney} />
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      {/* Pie */}
      <footer className="border-t border-line bg-panel/60">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-5 lg:px-8">
          <p className="text-[11.5px] text-dim">
            <span className="font-bold text-fog">VELTRIX</span> — {t("tu diario se sincroniza en la nube entre web y móvil.")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
          {deleteArmed ? (
            <button
              onClick={deleteAccount}
              className="rounded-md border border-bear bg-bear/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-bear transition-colors hover:bg-bear/30"
            >
              {t("Confirmar: eliminar cuenta y todos mis datos")}
            </button>
          ) : (
            <button
              onClick={() => setDeleteArmed(true)}
              className="rounded-md border border-line px-3.5 py-1.5 text-[11px] font-semibold text-dim transition-colors hover:border-bear/50 hover:text-bear"
            >
              {t("Eliminar mi cuenta")}
            </button>
          )}
          {trades.length > 0 &&
            (clearArmed ? (
              <button
                onClick={clearAll}
                className="rounded-md border border-bear bg-bear/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-bear transition-colors hover:bg-bear/30"
              >
                {t("Confirmar borrado total")}
              </button>
            ) : (
              <button
                onClick={() => setClearArmed(true)}
                className="rounded-md border border-line px-3.5 py-1.5 text-[11px] font-semibold text-dim transition-colors hover:border-bear/50 hover:text-bear"
              >
                {t("Borrar diario")}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto max-w-[1440px] border-t border-line/60 px-4 py-4 lg:px-8">
          <p className="text-[10.5px] leading-relaxed text-dim">
            {t("VELTRIX no constituye asesoramiento financiero ni recomendación de inversión. Operar en mercados financieros implica riesgo de pérdida. Los resultados pasados no garantizan resultados futuros. No está afiliado a TradingView.")}{" "}
            <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className="text-cyan underline hover:text-snow">
              {t("Comunidad")}
            </a>{" · "}
            <a href={legalUrl("terms")} target="_blank" rel="noopener" className="text-fog underline hover:text-snow">
              {t("Términos")}
            </a>{" · "}
            <a href={legalUrl("privacy")} target="_blank" rel="noopener" className="text-fog underline hover:text-snow">
              {t("Privacidad")}
            </a>{" · "}
            <a href={legalUrl("delete-account")} target="_blank" rel="noopener" className="text-fog underline hover:text-snow">
              {t("Eliminar datos")}
            </a>
          </p>
        </div>
      </footer>

      {sharing && <ShareCard trades={trades} onClose={() => setSharing(false)} notify={notify} />}
      {notesTrade && (
        <NotesModal trade={notesTrade} onSave={saveNotes} onCancel={() => setNotesTrade(null)} />
      )}
      {manualTrade && (
        <CloseModal trade={manualTrade} onConfirm={closeManual} onCancel={() => setManualTrade(null)} />
      )}

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
    </MoneyContext.Provider>
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

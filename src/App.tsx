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
  resultR,
  rrOf,
  sampleTrades,
} from "./lib";
import { NO_MONEY, balanceInfo, fmtCurrency } from "./lib";
import type { DailyLimits, MoneySettings, Trade } from "./lib";
import { useBot } from "./botStore";
import { useCountUp, useFlashId, useNow, usePrices, useSession, useTpCelebration, useTrades } from "./hooks";
import {
  CloseModal,
  NotesModal,
  IconCheck,
  IconClipboard,
  IconDownload,
  Reveal,
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
  reopenTradeById, sendTestSignal } from "./tradesApi";
import type { NewTrade } from "./lib";
import { legalUrl } from "./lang";
import Auth from "./components/Auth";
import ResetPassword from "./components/ResetPassword";
import { MfaCard, MfaProvider, mfaErrorText, useMfa } from "./components/Mfa";
import EquityChart from "./components/EquityChart";
import TradeForm from "./components/TradeForm";
import TradeTable from "./components/TradeTable";
import MonthlySummary from "./components/MonthlySummary";
import AlertBuilder from "./components/AlertBuilder";
import RiskCalculator from "./components/RiskCalculator";
import TagStats from "./components/TagStats";
import Analysis from "./components/Analysis";
import StrategyCard from "./components/StrategyCard";
import MoneyCard from "./components/MoneyCard";
import ExchangeCard from "./components/ExchangeCard";
import BotCard from "./components/BotCard";
import LiveBotCard from "./components/LiveBotCard";
import SignalFeedCard from "./components/SignalFeedCard";
import InviteCard from "./components/InviteCard";
import TelegramCard from "./components/TelegramCard";
import Panel, { jumpToPanel, openAllPanels } from "./components/Panel";
import LiquidationMap from "./components/LiquidationMap";
import ChartCard from "./components/ChartCard";
import HomeTiles, { PageHead } from "./components/HomeTiles";
import { HomeHero, HomeStatus, RecentTrades } from "./components/HomeExtras";
import { NavBar, useView } from "./nav";
import type { View } from "./nav";
import CoachCard from "./components/CoachCard";
import WhatsAppCard from "./components/WhatsAppCard";
import TodayCard from "./components/TodayCard";
import EconomyCard from "./components/EconomyCard";
import SignalsToExecute from "./components/SignalsToExecute";
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
  const botReady = useBot().status === "ready"; // la señal de prueba es solo para cuentas habilitadas
  const [testing, setTesting] = useState(false);
  const mfa = useMfa();

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await sendTestSignal();
      if (r.ok) notify(t("Listo: te mandamos una señal de prueba. Tiene que aparecer arriba y llegarte el aviso."), "ok");
      else notify(r.error ?? t("No se pudo mandar la señal de prueba."), "err");
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudo mandar la señal de prueba."), "err");
    } finally {
      setTesting(false);
    }
  };

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
    if (!(await mfa.ask(t("Vas a cambiar la URL de tu webhook: la anterior dejará de funcionar.")))) return;
    try {
      setUrl(await regenerateWebhookUrl());
      notify(t("URL regenerada. Actualizala en tus alertas de TradingView: la anterior dejó de funcionar."));
    } catch (err) {
      notify(mfaErrorText(err, t("No se pudo regenerar la URL.")), "err");
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
        {botReady && (
          <div className="rounded-md border border-gold/30 bg-gold/5 p-3">
            <button
              onClick={sendTest}
              disabled={testing}
              className="w-full rounded-md border border-gold/50 px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10 disabled:opacity-40"
            >
              🧪 {testing ? t("Mandando…") : t("Mandarme una señal de prueba")}
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-dim">
              {t("Crea una señal de BTC con el precio de ahora y te avisa por la app y por tu Telegram. Es solo para vos: no se publica en ninguna comunidad. Borrala del Diario cuando termines de probar.")}
            </p>
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

function WelcomeCard({ onLoadSample }: { onLoadSample?: () => void }) {
  const steps = [
    ["1", t("Cargá tu primera señal"), t("Pegá un mensaje de Telegram o WhatsApp en \"Registrar operación\", o cargala a mano.")],
    ["2", t("Conectá tu fuente"), t("Abajo, en \"Conectá tu fuente de señales\", copiá tu URL personal para TradingView u otras herramientas.")],
    ["3", t("Mirá tus resultados"), t("VELTRIX calcula tu R neto, acierto y curva de capital. El cierre de TP y SL puede ser automático.")],
  ];
  return (
    <section className="glass glow-card welcome-card rounded-lg border-gold/40 bg-golddeep/30 p-5" data-tilt="soft">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold tracking-wide text-snow sm:text-3xl">
          <span className="brand-word">{t("BIENVENIDO A VELTRIX")}</span>
        </h2>
        <p className="mt-0.5 text-[12px] text-fog sm:text-[13px]">{t("Empezá en tres pasos.")}</p>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map(([n, title, text], i) => (
          <li key={n} className="step-card flex gap-3 rounded-md border border-line bg-panel/70 p-3.5" style={{ ["--i" as string]: i } as React.CSSProperties}>
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
      {onLoadSample && (
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={onLoadSample}
            className="rounded-md bg-gold px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98]"
          >
            {t("Cargar operaciones de ejemplo")}
          </button>
          <p className="mt-1.5 text-[11px] text-dim">{t("O explorá la app con datos de ejemplo; después las borrás cuando quieras.")}</p>
        </div>
      )}
    </section>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

function Dashboard({ userId, email }: { userId: string; email?: string }) {
  const { trades, loading, removeLocal, restoreLocal } = useTrades(userId);
  // La guía de inicio se muestra mientras no hay operaciones; después se puede volver a abrir desde el pie.
  const [guide, setGuide] = useState(false);
  // Con el diario vacío se esconden las secciones que no tendrían nada que mostrar; aparecen solas al haber operaciones.
  const empty = !loading && trades.length === 0;
  const botState = useBot();
  const botReady = botState.status === "ready"; // el botón del bot aparece solo si el servidor ya tiene el bot
  const [view, setView] = useView();
  // Ir a una pantalla y, si hace falta, abrir y mostrar una sección de esa pantalla.
  const go = (v: View, panel?: string) => {
    setView(v);
    if (panel) window.setTimeout(() => jumpToPanel(panel), 350);
  };
  // Las secciones que se abren y se cierran quedan abiertas al entrar a su pantalla.
  useEffect(() => {
    if (view === "home") return;
    const id = window.setTimeout(() => openAllPanels(true), 60);
    return () => window.clearTimeout(id);
  }, [view]);
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

  const mfaGate = useMfa();
  const deleteAccount = async () => {
    if (!(await mfaGate.ask(t("Vas a eliminar tu cuenta y todos tus datos.")))) {
      setDeleteArmed(false);
      return;
    }
    try {
      await deleteMyAccount();
    } catch (err) {
      setDeleteArmed(false);
      notify(mfaErrorText(err, t("No se pudo eliminar la cuenta.")), "err");
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

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setSharing(true)}
        disabled={!trades.length}
        className="flex items-center gap-2 rounded-md border border-bull/45 bg-bull/10 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-bull transition-colors hover:bg-bull/20 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <span className="text-[15px] leading-none">↗</span>
        {t("Compartir")}
      </button>
      <button
        onClick={exportCsv}
        disabled={!trades.length}
        className="flex items-center gap-2 rounded-md border border-gold/45 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <IconDownload className="h-3.5 w-3.5" /> {t("Exportar CSV")}
      </button>
    </div>
  );

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

      <NavBar view={view} setView={go} botReady={botReady} email={email} now={now} communityUrl={COMMUNITY_URL} onSignOut={() => supabase.auth.signOut()} />

      {/* Contenido: cada pantalla es una página; la barra de arriba lleva de una a otra */}
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 pb-14 pt-6 lg:px-8">
        {view === "home" && (
          <>
            <HomeHero email={email} trades={trades} now={now} go={go} />
            {!loading && (trades.length === 0 || guide) && <WelcomeCard onLoadSample={trades.length === 0 ? loadSample : undefined} />}
            <LimitBanner status={limitStatus} />
            {/* Señales para ejecutar a un lado y, al otro, tu día y la agenda económica: si no hay señales, lo demás ocupa todo el ancho */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] items-start gap-5">
              <SignalsToExecute trades={trades} prices={prices} loading={loading} now={now} notify={notify} />
              <div className="min-w-0 space-y-5">
                {!empty && (
                  <Reveal>
                    <TodayCard trades={trades} prices={prices} now={now} />
                  </Reveal>
                )}
                <EconomyCard now={now} />
              </div>
            </div>
            {!empty && (
              <>
                <Reveal delay={90}>
                  <StatsBand trades={trades} />
                </Reveal>
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                  <Reveal delay={70} className="min-w-0">
                    <EquityChart trades={trades} />
                  </Reveal>
                  <RecentTrades trades={trades} go={go} />
                </div>
              </>
            )}
            <HomeStatus botReady={botReady} botOn={botState.settings.enabled} userId={userId} go={go} />
            <HomeTiles go={go} botReady={botReady} botOn={botState.settings.enabled} openCount={trades.filter((x) => x.outcome === "ABIERTA").length} />
          </>
        )}

        {view === "journal" && (
          <>
            <PageHead view="journal" right={actions} />
            <div className={cx("grid grid-cols-[minmax(0,1fr)] items-start gap-5", !empty && "lg:grid-cols-[minmax(0,1fr)_400px]")}>
              {!empty && <EquityChart trades={trades} />}
              <TradeForm onAdd={addTrades} notify={notify} />
            </div>
            {loading ? (
              <div className="rounded-lg border border-line bg-panel px-6 py-16 text-center text-sm text-fog">{t("Cargando diario…")}</div>
            ) : (
              !empty && (
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
              )
            )}
            {!empty && (
              <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
                <MonthlySummary trades={trades} />
                {trades.some((x) => x.tags?.length) && <TagStats trades={trades} />}
              </div>
            )}
          </>
        )}

        {view === "analysis" && (
          <>
            <PageHead view="analysis" />
            {empty ? (
              <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-[13px] text-dim">{t("Cuando tengas operaciones cerradas, acá vas a ver qué te funciona y qué no.")}</p>
            ) : (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
                  <Analysis trades={trades} />
                  <StrategyCard trades={trades} notify={notify} />
                </div>
                {FEATURES.coach && <CoachCard closedCount={trades.filter((x) => x.outcome !== "ABIERTA").length} />}
              </>
            )}
          </>
        )}

        {view === "tools" && (
          <>
            <PageHead view="tools" />
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
              <RiskCalculator notify={notify} />
              <DailyLimitsCard limits={limits} status={limitStatus} onSave={persistLimits} />
            </div>
          </>
        )}

        {view === "chart" && (
          <>
            <PageHead view="chart" />
            <ChartCard trades={trades} userId={userId} notify={notify} />
          </>
        )}

        {view === "liq" && (
          <>
            <PageHead view="liq" />
            <LiquidationMap />
          </>
        )}

        {view === "bot" && (
          <>
            <PageHead view="bot" />
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
              <BotCard userId={userId} notify={notify} />
              <div className="min-w-0 space-y-5">
                <LiveBotCard userId={userId} notify={notify} />
                <SignalFeedCard userId={userId} notify={notify} />
              </div>
            </div>
          </>
        )}

        {view === "connections" && (
          <>
            <PageHead view="connections" />
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
              <div className="min-w-0 space-y-5">
                <WebhookCard userId={userId} notify={notify} />
                <WhatsAppCard notify={notify} />
              </div>
              <div className="min-w-0 space-y-5">
                <TelegramCard userId={userId} notify={notify} />
                <ExchangeCard money={money} notify={notify} onSaveMoney={persistMoney} />
              </div>
            </div>
          </>
        )}

        {view === "account" && (
          <>
            <PageHead view="account" />
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
              <div className="min-w-0 space-y-5">
                <MoneyCard money={money} trades={trades} onSave={persistMoney} />
                <InviteCard notify={notify} />
              </div>
              <MfaCard notify={notify} />
            </div>
          </>
        )}
      </main>

      {/* Pie */}
      <footer className="border-t border-line bg-panel/60">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-5 lg:px-8">
          <p className="text-[11.5px] text-dim">
            <span className="font-bold text-fog">VELTRIX</span> — {t("tu diario se sincroniza en la nube entre web y móvil.")}
            {email && (
              <>
                {" · "}
                {t("Sesión de")} <span className="num text-fog">{email}</span>
              </>
            )}
            {trades.length > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => {
                    setGuide((g) => !g);
                    if (!guide) window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="font-semibold text-cyan underline underline-offset-2 hover:text-snow"
                >
                  {guide ? t("Ocultar guía de inicio") : t("Ver guía de inicio")}
                </button>
              </>
            )}
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

  return (
    <MfaProvider>
      <Dashboard userId={session.user.id} email={session.user.email} />
    </MfaProvider>
  );
}

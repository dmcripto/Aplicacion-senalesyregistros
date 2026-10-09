import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LIVE, LIVE_EXCHANGES, LIVE_LIMITS, ago, clampLive, cx, liveExchangeName, liveKeyGuide, liveStatusLabel, t } from "../lib";
import type { LiveOrder, LiveSettings } from "../lib";
import { useBot } from "../botStore";
import { connectTradeKey, disconnectTradeKey, fetchLive, liveStop, saveLive, switchLiveExchange, testLiveOrder } from "../tradesApi";
import type { LiveView } from "../tradesApi";
import { mfaErrorText, useMfa } from "./Mfa";
import Panel from "./Panel";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;
const label = "mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog";
const field = "num w-full rounded-md border border-line bg-ink px-3 py-2 text-[13px] text-snow outline-none focus:border-gold";

function NumField({ name, value, onChange, min, max, step }: { name: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <label className="block">
      <span className={label}>{name}</span>
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={field} />
    </label>
  );
}

/** Bot con dinero real (prueba mínima) en Bitunix o MEXC, a elección. Solo se ve en cuentas con la llave beta y cuando el servidor ya lo tiene. */
export default function LiveBotCard({ userId, notify }: { userId: string; notify: Notify }) {
  const bot = useBot();
  const mfa = useMfa();
  const [view, setView] = useState<LiveView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [limits, setLimits] = useState<LiveSettings>(DEFAULT_LIVE);
  const [report, setReport] = useState<{ title: string; steps: string[]; ok: boolean } | null>(null);
  const [stopArmed, setStopArmed] = useState(false);
  const [pick, setPick] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const v = await fetchLive(userId);
      setView(v);
      setLimits(v.live);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, [userId]);

  useEffect(() => {
    if (bot.status === "ready") void reload();
  }, [bot.status, reload]);

  useEffect(() => {
    if (!stopArmed) return;
    const id = window.setTimeout(() => setStopArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [stopArmed]);

  if (bot.status !== "ready" || unavailable || !view) return null;
  const { live } = view;
  // El exchange que se está mirando: el activo del bot, o el que la persona tocó para conectarlo.
  const shown = pick ?? view.exchange;
  const exName = liveExchangeName(shown);
  const hasShownKey = !!view.keys[shown];
  const hint = view.keys[shown] ?? view.keyHint;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("No se pudo completar."), "err");
    } finally {
      setBusy(null);
    }
  };

  const choose = (id: string) =>
    run("exchange", async () => {
      setPick(id);
      // Si ya tiene clave guardada ahí, se pasa a ese exchange (queda apagado y hay que repetir la prueba); si no, se muestra para conectarla.
      if (id !== view.exchange && view.keys[id]) {
        const r = await switchLiveExchange(id);
        if (!r.ok) return notify(r.error ?? t("No se pudo cambiar de exchange."), "err");
        setPick(null);
        notify(t("Ahora el bot real usa {x}. Quedó apagado: repetí la prueba.", { x: liveExchangeName(id) }), "info");
        await reload();
      }
    });

  const connect = () =>
    run("connect", async () => {
      if (!(await mfa.ask(t("Vas a guardar una clave de {x} con permiso de operar.", { x: exName })))) return;
      const r = await connectTradeKey(apiKey.trim(), apiSecret.trim(), shown);
      if (!r.ok) return notify(r.code === "mfa_required" ? mfaErrorText(new Error("mfa_required"), "") : (r.error ?? t("No se pudo conectar.")), "err");
      setApiKey("");
      setApiSecret("");
      setPick(null);
      notify(t("Clave guardada. Saldo disponible en futuros: {n} USDT.", { n: (r.available ?? 0).toFixed(2) }));
      await reload();
    });

  const disconnect = () =>
    run("disconnect", async () => {
      if (!(await mfa.ask(t("Vas a borrar la clave de {x} del bot.", { x: exName })))) return;
      const r = await disconnectTradeKey(shown);
      if (!r.ok) return notify(r.error ?? t("No se pudo desconectar."), "err");
      notify(t("Clave borrada. El bot real quedó apagado."), "info");
      await reload();
    });

  const preview = () =>
    run("preview", async () => {
      const r = await testLiveOrder(false);
      setReport({ title: t("Esto es lo que se enviaría (no se envió nada)"), steps: [...(r.steps ?? []), ...(r.error ? [`⚠️ ${r.error}`] : [])], ok: r.ok });
      await reload();
    });

  const realTest = () =>
    run("test", async () => {
      if (!(await mfa.ask(t("Vas a enviar una orden real mínima a {x} y cerrarla enseguida.", { x: exName })))) return;
      const r = await testLiveOrder(true);
      if (!r.ok && r.code === "mfa_required") return notify(mfaErrorText(new Error("mfa_required"), ""), "err");
      setReport({ title: r.verified ? t("Prueba real superada") : t("La prueba real no salió completa"), steps: [...(r.steps ?? []), ...(r.error ? [`⚠️ ${r.error}`] : [])], ok: !!r.verified });
      await reload();
    });

  const patch = (p: Parameters<typeof saveLive>[1], okMsg?: string) =>
    run("save", async () => {
      await saveLive(userId, p);
      if (okMsg) notify(okMsg);
      await reload();
    });

  const saveLimits = () =>
    patch(
      {
        maxMarginUsdt: clampLive(limits.maxMarginUsdt, 1, LIVE_LIMITS.maxMarginUsdt, DEFAULT_LIVE.maxMarginUsdt),
        riskUsdt: clampLive(limits.riskUsdt, 0.01, LIVE_LIMITS.riskUsdt, DEFAULT_LIVE.riskUsdt),
        maxLeverage: Math.round(clampLive(limits.maxLeverage, 1, LIVE_LIMITS.maxLeverage, DEFAULT_LIVE.maxLeverage)),
        dailyLossUsdt: clampLive(limits.dailyLossUsdt, 0.05, LIVE_LIMITS.dailyLossUsdt, DEFAULT_LIVE.dailyLossUsdt),
      },
      t("Topes guardados."),
    );

  const stop = () =>
    run("stop", async () => {
      setStopArmed(false);
      const r = await liveStop();
      setReport({ title: r.ok ? t("Todo apagado") : t("Apagado con avisos: revisá {x}", { x: exName }), steps: r.steps ?? [], ok: !!r.ok });
      await reload();
    });

  const mode = live.enabled ? (live.dryRun ? t("En seco") : t("Enviando órdenes reales")) : t("Apagado");

  return (
    <Panel id="live" title={t("BOT CON DINERO REAL")} subtitle={t("{x} · monto mínimo · con topes de seguridad", { x: liveExchangeName(view.exchange) })} summary={mode} defaultOpen={false}>
      <div className="space-y-4 p-5">
        <div className="rounded-md border border-bear/40 bg-bear/5 p-3.5 text-[12px] leading-relaxed text-fog">
          <p className="font-bold text-bear">⚠️ {t("Esto opera con plata de verdad")}</p>
          <p className="mt-1">
            {t("La estrategia todavía no demostró ganar: con montos tan chicos las comisiones pueden pesar más que cualquier ganancia. Usalo solo para comprobar que todo funciona, con plata que puedas perder. Nunca se usan retiros.")}
          </p>
        </div>

        <div>
          <p className={label}>{t("Exchange del bot real")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {LIVE_EXCHANGES.map((id) => (
              <button key={id} type="button" onClick={() => choose(id)} disabled={busy != null} className={cx("rounded-md border px-3 py-1.5 text-[12px] font-bold transition-colors disabled:opacity-40", shown === id ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-gold/50")}>
                {liveExchangeName(id)}
                {view.keys[id] && <span className={cx("ml-1.5 text-[10px]", shown === id ? "text-ink/70" : "text-bull")}>✓</span>}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-dim">{t("Elegí el exchange donde vos podés crear la clave de API. Cada uno tiene su propia clave y su propia prueba.")}</p>
        </div>

        {!hasShownKey ? (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-fog">{liveKeyGuide(shown)}</p>
            <label className="block">
              <span className={label}>{t("Clave (API key)")}</span>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} className={field} />
            </label>
            <label className="block">
              <span className={label}>{t("Clave secreta (secret)")}</span>
              <input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} type="password" autoComplete="off" spellCheck={false} className={field} />
            </label>
            <button onClick={connect} disabled={busy != null || apiKey.trim().length < 8 || apiSecret.trim().length < 8} className="w-full rounded-md border border-gold/50 bg-gold/10 px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20 disabled:opacity-40">
              {busy === "connect" ? t("Verificando…") : t("Guardar clave de {x}", { x: exName })}
            </button>
          </div>
        ) : shown !== view.exchange ? (
          <button onClick={() => choose(shown)} disabled={busy != null} className="w-full rounded-md border border-gold/50 bg-gold/10 px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold hover:bg-gold/20 disabled:opacity-40">
            {t("Usar {x} para el bot real", { x: exName })}
          </button>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-ink/50 px-3 py-2.5">
              <p className="text-[12.5px] text-snow">
                ✅ {t("Clave guardada")} <span className="num text-dim">····{hint}</span> · <span className={cx("font-bold", live.verified ? "text-bull" : "text-gold")}>{live.verified ? t("Prueba real superada") : t("Falta la prueba real")}</span>
              </p>
              <button onClick={disconnect} disabled={busy != null} className="rounded border border-line px-2.5 py-1 text-[11px] font-semibold text-dim hover:border-bear/50 hover:text-bear disabled:opacity-40">
                {t("Borrar clave")}
              </button>
            </div>

            {live.lastError && (
              <p role="alert" className="rounded-md border border-bear/40 bg-bear/10 p-3 text-[12px] text-fog">
                ⚠️ {live.lastError}
              </p>
            )}

            <div className="space-y-2 rounded-md border border-line p-3.5">
              <p className={label}>{t("Paso 1 · Probar sin riesgo")}</p>
              <p className="text-[12px] leading-relaxed text-dim">{t("Lee tu saldo y las reglas de BTCUSDT y arma la orden mínima, pero no envía nada.")}</p>
              <button onClick={preview} disabled={busy != null} className="w-full rounded-md border border-line px-3 py-2 text-[12px] font-bold text-snow hover:border-line2 hover:bg-white/5 disabled:opacity-40">
                {busy === "preview" ? t("Verificando…") : t("Ver qué enviaría (sin enviar)")}
              </button>
            </div>

            <div className="space-y-2 rounded-md border border-line p-3.5">
              <p className={label}>{t("Paso 2 · Orden real de prueba")}</p>
              <p className="text-[12px] leading-relaxed text-dim">{t("Envía UNA orden mínima de BTCUSDT con stop y objetivo, confirma que aparece la posición y la cierra enseguida. Cuesta unos centavos de comisión. Solo si sale perfecta se habilita enviar órdenes reales.")}</p>
              <button onClick={realTest} disabled={busy != null} className="w-full rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-gold hover:bg-gold/20 disabled:opacity-40">
                {busy === "test" ? t("Probando…") : t("Hacer la orden real de prueba")}
              </button>
            </div>

            <div className="space-y-3 rounded-md border border-line p-3.5">
              <p className={label}>{t("Topes de seguridad")}</p>
              <div className="grid grid-cols-2 gap-3">
                <NumField name={t("Margen máximo (USDT)")} value={limits.maxMarginUsdt} min={1} max={LIVE_LIMITS.maxMarginUsdt} step={0.5} onChange={(v) => setLimits({ ...limits, maxMarginUsdt: v })} />
                <NumField name={t("Riesgo por operación (USDT)")} value={limits.riskUsdt} min={0.01} max={LIVE_LIMITS.riskUsdt} step={0.01} onChange={(v) => setLimits({ ...limits, riskUsdt: v })} />
                <NumField name={t("Apalancamiento máximo")} value={limits.maxLeverage} min={1} max={LIVE_LIMITS.maxLeverage} step={1} onChange={(v) => setLimits({ ...limits, maxLeverage: v })} />
                <NumField name={t("Pérdida máxima por día (USDT)")} value={limits.dailyLossUsdt} min={0.05} max={LIVE_LIMITS.dailyLossUsdt} step={0.05} onChange={(v) => setLimits({ ...limits, dailyLossUsdt: v })} />
              </div>
              <p className="text-[11px] leading-relaxed text-dim">{t("Una sola posición abierta a la vez. Si hay 3 errores seguidos, el bot real se apaga solo.")}</p>
              <button onClick={saveLimits} disabled={busy != null} className="w-full rounded-md border border-line px-3 py-2 text-[12px] font-bold text-snow hover:border-line2 hover:bg-white/5 disabled:opacity-40">
                {t("Guardar topes")}
              </button>
            </div>

            <div className="space-y-3 rounded-md border border-line p-3.5">
              <p className={label}>{t("Paso 3 · Encender")}</p>
              <label className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-snow">{t("Bot real encendido")}</span>
                <input type="checkbox" checked={live.enabled} disabled={busy != null} onChange={(e) => patch({ enabled: e.target.checked }, e.target.checked ? t("Bot real encendido.") : t("Bot real apagado."))} className="h-5 w-5 accent-[#2ec4f1]" />
              </label>
              <label className={cx("flex items-center justify-between gap-3", !live.verified && "opacity-50")}>
                <span className="text-[12.5px] text-snow">
                  {t("Enviar órdenes de verdad")}
                  <span className="block text-[11px] text-dim">{live.verified ? t("Si lo apagás, el bot solo arma las órdenes «en seco» y las anota.") : t("Se habilita después de la orden real de prueba.")}</span>
                </span>
                <input type="checkbox" checked={!live.dryRun} disabled={busy != null || !live.verified} onChange={(e) => patch({ dryRun: !e.target.checked }, e.target.checked ? t("Ahora el bot envía órdenes reales.") : t("Vuelve a modo «en seco»."))} className="h-5 w-5 accent-[#2ec4f1]" />
              </label>
              <p className="text-[11.5px] text-fog">
                {t("Modo actual")}: <b className="text-snow">{mode}</b>
              </p>
            </div>

            <div>
              {stopArmed ? (
                <button onClick={stop} className="w-full rounded-md border border-bear bg-bear px-3 py-3 text-[12px] font-extrabold uppercase tracking-wider text-white">
                  {t("Confirmar: apagar y cerrar todo ahora")}
                </button>
              ) : (
                <button onClick={() => setStopArmed(true)} disabled={busy != null} className="w-full rounded-md border border-bear/60 bg-bear/10 px-3 py-3 text-[12px] font-extrabold uppercase tracking-wider text-bear hover:bg-bear/20 disabled:opacity-40">
                  ⛔ {t("Apagar todo y cerrar posiciones")}
                </button>
              )}
              <p className="mt-1 text-[11px] text-dim">{t("Apaga el bot real, cancela las órdenes pendientes y cierra las posiciones abiertas. Siempre revisá {x} por las dudas.", { x: exName })}</p>
            </div>
          </>
        )}

        {report && (
          <div className={cx("rounded-md border p-3.5 text-[12.5px] leading-relaxed", report.ok ? "border-bull/40 bg-bull/5" : "border-gold/40 bg-gold/5")}>
            <p className="mb-1 font-bold text-snow">{report.title}</p>
            <ul className="space-y-1 text-fog">
              {report.steps.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}

        {view.orders.length > 0 && (
          <div>
            <p className={label}>{t("Últimas órdenes del bot real")}</p>
            <ul className="space-y-1.5">
              {view.orders.map((o: LiveOrder) => (
                <li key={o.id} className="rounded-md border border-line bg-ink/40 px-3 py-2 text-[11.5px] text-fog">
                  <p className="flex flex-wrap items-center gap-2">
                    <b className="num text-snow">{o.symbol}</b>
                    <span className={cx("rounded-full border px-2 py-px text-[10px] font-bold", o.status === "sent" ? "border-bull/50 text-bull" : o.status === "rejected" || o.status === "error" ? "border-bear/50 text-bear" : "border-line text-dim")}>{liveStatusLabel(o.status)}</span>
                    {o.kind !== "bot" && <span className="text-[10px] uppercase text-dim">{o.kind === "test" ? t("prueba") : t("apagado")}</span>}
                    <span className="ml-auto text-dim">{ago(o.createdAt, Date.now())}</span>
                  </p>
                  {o.note && <p className="mt-0.5 break-words text-dim">{o.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

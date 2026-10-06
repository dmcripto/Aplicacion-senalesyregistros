import { useState } from "react";
import { BOT_ASSETS, actionId, backtestVerdict, cx, fmtDateTime, fmtR, ruleSentence, t } from "../lib";
import type { BotBacktest, BotSettings, BotStatsRow } from "../lib";
import { useBot } from "../botStore";
import { runBotBacktest } from "../tradesApi";
import Panel from "./Panel";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;
const label = "mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog";
const short = (s: string) => s.replace("USDT", "");

function Tile({ name, value, tone }: { name: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-md border border-line bg-ink/50 p-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-dim">{name}</p>
      <p className={cx("num text-base font-bold", tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-snow")}>{value}</p>
    </div>
  );
}

function StatsLine({ s }: { s: BotStatsRow }) {
  if (!s.n) return <span className="text-dim">{t("sin operaciones")}</span>;
  return (
    <span className="num">
      {s.n} {t("ops")} · {Math.round(s.winRate)}% · <b className={s.expectancy > 0 ? "text-bull" : s.expectancy < 0 ? "text-bear" : "text-fog"}>{fmtR(s.expectancy)}R</b>
    </span>
  );
}

export default function BotCard({ userId, notify }: { userId: string; notify: Notify }) {
  const { status, settings: s, store } = useBot();
  const ready = status === "ready";
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<BotBacktest | null>(null);

  const update = async (patch: Partial<BotSettings>) => {
    const next = { ...s, ...patch };
    if (!next.symbols.length) return notify(t("Dejá al menos un activo."), "err");
    try {
      await store.update(patch);
      if (patch.enabled !== undefined) notify(next.enabled ? t("Bot encendido (modo simulado).") : t("Bot apagado."), "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudo guardar el cambio."), "err");
    }
  };

  const toggleSymbol = (sym: string) => update({ symbols: s.symbols.includes(sym) ? s.symbols.filter((x) => x !== sym) : [...s.symbols, sym] });

  const probar = async () => {
    setBusy(true);
    setTest(null);
    try {
      const r = await runBotBacktest(s.symbols, 120);
      if (!r.ok) notify(r.error ?? t("No se pudo hacer la prueba."), "err");
      else setTest(r as BotBacktest);
    } finally {
      setBusy(false);
    }
  };

  const verdict = (b: Extract<BotBacktest, { ok: true }>) => {
    const tot = b.total;
    if (tot.n === 0) return t("En este tramo no hubo ninguna señal.");
    if (tot.expectancy <= 0) return t("En este tramo la estrategia no ganó: promedió {e} por operación. No tiene sentido pasarla a dinero real.", { e: `${fmtR(tot.expectancy)}R` });
    if (tot.n < 30) return t("Dio {e} por operación, pero con {n} operaciones no alcanza para concluir nada.", { e: `${fmtR(tot.expectancy)}R`, n: tot.n });
    return t("Dio {e} por operación en {n} operaciones. Es una prueba sobre el pasado: lo que importa es cómo se comporta de ahora en adelante en modo simulado.", { e: `${fmtR(tot.expectancy)}R`, n: tot.n });
  };

  if (status === "missing" || status === "idle" || status === "loading") return null; // todavía no está el bot en el servidor

  return (
    <Panel id="bot" title={t("BOT AUTOMÁTICO")} subtitle={t("Modo simulado · sin plata real")} summary={s.enabled ? t("Encendido") : t("Apagado")} defaultOpen={false}>
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-ink/40 p-3.5">
          <div>
            <p className="text-[13px] font-bold text-snow">{s.enabled ? t("Bot encendido") : t("Bot apagado")}</p>
            <p className="text-[11px] text-dim">
              {s.enabled
                ? s.lastTickAt
                  ? t("Última revisión: {when}", { when: fmtDateTime(s.lastTickAt) })
                  : t("Esperando la primera revisión del servidor…")
                : t("No anota ninguna operación.")}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={s.enabled}
            aria-label={t("Encender o apagar el bot")}
            disabled={!ready}
            onClick={() => update({ enabled: !s.enabled })}
            className={cx("relative h-8 w-14 shrink-0 rounded-full border transition-colors disabled:opacity-40", s.enabled ? "border-bull bg-bull/30" : "border-line bg-ink")}
          >
            <span className={cx("absolute top-0.5 h-6 w-6 rounded-full transition-all", s.enabled ? "left-[26px] bg-bull" : "left-0.5 bg-fog")} />
          </button>
        </div>

        <p className="rounded-md border border-gold/30 bg-golddeep/25 p-3 text-[12px] leading-relaxed text-fog">
          {t("Por ahora el bot opera en modo simulado: cuando la estrategia da una señal la anota como una operación en tu diario (con la etiqueta «Bot simulado») y la cierra cuando el precio toca el objetivo o el stop. No toca tu exchange ni tu dinero. Así medimos si funciona antes de pensar en operaciones reales.")}
        </p>

        <div>
          <span className={label}>{t("Activos")}</span>
          <div className="flex flex-wrap gap-1.5">
            {BOT_ASSETS.map((a) => (
              <button
                key={a}
                onClick={() => toggleSymbol(a)}
                className={cx("rounded-md border px-3 py-1.5 text-[12px] font-bold transition-colors", s.symbols.includes(a) ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow")}
              >
                {short(a)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={label}>{t("Operaciones abiertas a la vez")}</span>
            <select className="field" value={s.maxOpen} onChange={(e) => update({ maxOpen: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>{t("Pérdida máxima por día")}</span>
            <select className="field" value={s.dailyLossR} onChange={(e) => update({ dailyLossR: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}R
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <span className={label}>{t("Reglas de tu estrategia sugerida")}</span>
          {s.rules.length === 0 ? (
            <p className="text-[11.5px] leading-relaxed text-dim">{t("Ninguna todavía. En «Estrategia sugerida» podés elegir reglas y el bot las aplica.")}</p>
          ) : (
            <ul className="space-y-1.5">
              {s.rules.map((r) => (
                <li key={actionId(r)} className="flex items-center justify-between gap-2 rounded-md border border-line bg-ink/40 px-3 py-2 text-[12px] text-snow">
                  <span>{ruleSentence(r)}</span>
                  <button
                    onClick={() => store.remove(actionId(r)).catch((e: unknown) => notify(e instanceof Error ? e.message : t("No se pudo guardar el cambio."), "err"))}
                    className="shrink-0 rounded border border-line px-2 py-0.5 text-[10.5px] font-semibold text-dim hover:border-bear/50 hover:text-bear"
                  >
                    {t("Quitar")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {s.rules.length > 0 && <p className="mt-1.5 text-[10.5px] leading-relaxed text-dim">{t("Para saber si te ayudan, corré «Probar con los últimos 4 meses»: compara el bot con y sin tus reglas.")}</p>}
        </div>

        <details className="rounded-md border border-line bg-ink/40 text-[11.5px]">
          <summary className="cursor-pointer select-none px-3 py-2.5 font-bold uppercase tracking-[0.12em] text-gold">{t("Cómo decide")}</summary>
          <ul className="list-disc space-y-1 border-t border-line px-3 py-3 pl-7 leading-relaxed text-fog">
            <li>{t("Mira velas de 1 hora ya cerradas, nunca el futuro.")}</li>
            <li>{t("Solo compra si la tendencia es alcista (media de 50 velas sobre la de 200) y solo vende si es bajista.")}</li>
            <li>{t("Entra cuando el precio rompe el máximo (o mínimo) de las últimas 20 velas.")}</li>
            <li>{t("Stop a 1,5 veces el ATR (el rango normal del activo). Objetivo: el doble de lo arriesgado (2R).")}</li>
            <li>{t("Una operación por activo a la vez. Si llegás a la pérdida máxima del día, no abre más hasta mañana.")}</li>
          </ul>
        </details>

        <div className="space-y-3 border-t border-line pt-4">
          <button onClick={probar} disabled={busy || !ready} className="w-full rounded-md border border-gold/45 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10 disabled:opacity-40">
            {busy ? t("Probando con el historial…") : t("Probar con los últimos 4 meses")}
          </button>
          {test?.ok && (
            <div className="space-y-2.5">
              <p className="rounded-md border border-line bg-ink/40 p-3 text-[12px] leading-relaxed text-snow">{verdict(test)}</p>
              {test.withRules && (
                <div className="space-y-1.5 rounded-md border border-gold/40 bg-golddeep/25 p-3 text-[12px] leading-relaxed text-snow">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{t("Con y sin tus reglas")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      [t("Sin reglas"), test.total],
                      [t("Con tus {n} reglas", { n: test.rulesApplied }), test.withRules],
                    ].map(([name, st]) => (
                      <div key={name as string} className="rounded-md border border-line bg-ink/50 p-2.5">
                        <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-dim">{name as string}</p>
                        <p className={cx("num text-base font-bold", (st as BotStatsRow).expectancy > 0 ? "text-bull" : (st as BotStatsRow).expectancy < 0 ? "text-bear" : "text-fog")}>{fmtR((st as BotStatsRow).expectancy)}R</p>
                        <p className="num text-[10.5px] text-fog">{(st as BotStatsRow).n} {t("ops")} · {Math.round((st as BotStatsRow).winRate)}%</p>
                      </div>
                    ))}
                  </div>
                  <p>{backtestVerdict(test.total, test.withRules, (n) => `${fmtR(n)}R`)}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile name={t("Operaciones")} value={String(test.total.n)} />
                <Tile name={t("Acierto")} value={`${Math.round(test.total.winRate)}%`} />
                <Tile name={t("Promedio por operación")} value={`${fmtR(test.total.expectancy)}R`} tone={test.total.expectancy > 0 ? "bull" : test.total.expectancy < 0 ? "bear" : undefined} />
                <Tile name={t("Peor caída")} value={`${test.total.maxDrawdownR.toFixed(1).replace(/\.0$/, "")}R`} tone="bear" />
              </div>
              <ul className="space-y-1 text-[12px] text-fog">
                {test.symbols.map((x) => (
                  <li key={x.symbol} className="flex justify-between gap-2">
                    <span className="font-semibold text-snow">{short(x.symbol)}</span>
                    {x.error ? <span className="text-bear">{t("sin datos")}</span> : <StatsLine s={x.stats} />}
                  </li>
                ))}
              </ul>
              {!test.withRules && s.rules.length > 0 && <p className="text-[11px] text-dim">{t("La prueba no trae la comparación con tus reglas: falta actualizar la función del servidor.")}</p>}
              <p className="text-[10.5px] leading-relaxed text-dim">
                {t("Prueba sobre los últimos {d} días de precios reales, con un costo de comisión y deslizamiento incluido. Si una vela toca stop y objetivo a la vez se cuenta el stop. El pasado no garantiza el futuro: la prueba de verdad es el modo simulado, día a día.", { d: test.days })}
              </p>
            </div>
          )}
        </div>
        <p className="text-[10.5px] leading-relaxed text-dim">{t("Es una herramienta de práctica y estudio. No es asesoramiento financiero ni garantiza ganancias.")}</p>
      </div>
    </Panel>
  );
}

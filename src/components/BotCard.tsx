import { useState } from "react";
import { BOT_ASSETS, BOT_PROFILE_LIST, BOT_SCAN_LIST, actionId, backtestVerdict, botHowItDecides, botProfileInfo, cx, fmtDateTime, fmtR, labPasses, labVariantInfo, labVerdict, ruleSentence, t } from "../lib";
import type { BotBacktest, BotLab, BotSettings, BotStatsRow } from "../lib";
import { useBot } from "../botStore";
import { runBotBacktest, runBotLab } from "../tradesApi";
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
  const { status, settings: s, store, profileSupported, notifySupported, scanSupported } = useBot();
  const ready = status === "ready";
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<BotBacktest | null>(null);
  const [labBusy, setLabBusy] = useState(false);
  const [lab, setLab] = useState<Extract<BotLab, { ok: true }> | null>(null);

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

  const probarLab = async () => {
    setLabBusy(true);
    setLab(null);
    try {
      const r = await runBotLab(s.symbols);
      if (!r.ok) notify(r.error ?? t("No se pudo hacer la prueba."), "err");
      else setLab(r as Extract<BotLab, { ok: true }>);
    } finally {
      setLabBusy(false);
    }
  };

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

        {notifySupported && (
          <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-ink/40 px-3.5 py-3">
            <span>
              <span className="block text-[12.5px] font-bold text-snow">{t("Avisarme de cada operación")}</span>
              <span className="block text-[11px] leading-snug text-dim">{t("Cuando el bot anota o cierra una operación, te llega a la app y a tu Telegram (si lo vinculaste). Son avisos solo tuyos: no se publica en ninguna comunidad.")}</span>
            </span>
            <input type="checkbox" checked={s.notify} onChange={(e) => update({ notify: e.target.checked })} className="h-5 w-5 shrink-0 accent-[#2ec4f1]" />
          </label>
        )}

        <p className="rounded-md border border-gold/30 bg-golddeep/25 p-3 text-[12px] leading-relaxed text-fog">
          {t("Por ahora el bot opera en modo simulado: cuando la estrategia da una señal la anota como una operación en tu diario (con la etiqueta «Bot simulado») y la cierra cuando el precio toca el objetivo o el stop. No toca tu exchange ni tu dinero. Así medimos si funciona antes de pensar en operaciones reales.")}
        </p>

        {profileSupported && (
          <div>
            <span className={label}>{t("Perfil de estrategia")}</span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {BOT_PROFILE_LIST.map((id) => (
                <button
                  key={id}
                  onClick={() => update({ profile: id })}
                  className={cx("rounded-md border px-2 py-2 text-[12px] font-bold transition-colors", s.profile === id ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow")}
                >
                  {botProfileInfo(id).name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-dim">{botProfileInfo(s.profile).blurb}</p>
          </div>
        )}

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

        {scanSupported && (
          <div>
            <span className={label}>{t("Alcance")}</span>
            <div className="grid grid-cols-3 gap-2">
              {BOT_SCAN_LIST.map((n) => (
                <button
                  key={n}
                  onClick={() => update({ scanTop: n })}
                  className={cx("rounded-md border px-2 py-2 text-[12px] font-bold transition-colors", s.scanTop === n ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow")}
                >
                  {n === 0 ? t("Solo mis activos") : t("Top {n} por volumen", { n })}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
              {s.scanTop === 0
                ? t("El bot mira solo los activos que elegiste arriba.")
                : t("Además de tus activos, el bot mira los {n} futuros más operados y, si hay varias señales a la vez, toma primero las más fuertes. Sigue siendo simulado.", { n: s.scanTop })}
            </p>
          </div>
        )}

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
            {botHowItDecides(s.profile).map((x) => (
              <li key={x}>{x}</li>
            ))}
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
              {test.byProfile && (
                <div className="space-y-1.5 rounded-md border border-line bg-ink/40 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{t("Los perfiles, sin reglas")}</p>
                  <ul className="space-y-1 text-[12px] text-fog">
                    {test.byProfile.map((x) => (
                      <li key={x.id} className="flex justify-between gap-2">
                        <span className={cx("font-semibold", x.current ? "text-gold" : "text-snow")}>
                          {botProfileInfo(x.id).name}
                          {x.current ? ` · ${t("el tuyo")}` : ""}
                        </span>
                        <StatsLine s={x.stats} />
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10.5px] leading-relaxed text-dim">{t("Con pocas opciones es difícil engañarse, pero igual: elegir el que mejor salió en el pasado no asegura que siga igual. Confirmalo en modo simulado.")}</p>
                </div>
              )}
              {!!test.scanned && (
                <p className="rounded-md border border-line bg-ink/40 p-2.5 text-[11px] leading-relaxed text-dim">
                  {t("La prueba incluye {n} activos (los más operados de hoy). Ojo: elegir los de más volumen de hoy favorece a los que ya subieron, así que el resultado del pasado sale algo más lindo que el real. Abajo se ven los 10 con más operaciones.", { n: test.scanned })}
                </p>
              )}
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
          <button onClick={probarLab} disabled={labBusy || !ready} className="w-full rounded-md border border-line px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-fog transition-colors hover:border-line2 hover:text-snow disabled:opacity-40">
            {labBusy ? t("Probando variantes con un año de precios…") : t("Probar variantes de 4 horas (1 año)")}
          </button>
          {lab && (
            <div className="space-y-2.5 rounded-md border border-line bg-ink/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{t("Laboratorio de variantes")}</p>
              <p className="text-[12px] leading-relaxed text-snow">{labVerdict(lab.variants)}</p>
              {!!lab.scanned && (
                <p className="rounded-md border border-line bg-ink/50 p-2.5 text-[11px] leading-relaxed text-dim">
                  {t("Esta prueba usa {n} activos (los más operados de hoy), solo con velas de 4 horas. Elegir los de más volumen de hoy favorece a los que ya subieron: el resultado del pasado sale algo más lindo que el real.", { n: lab.scanned })}
                </p>
              )}
              <ul className="space-y-2">
                {lab.variants.map((v) => (
                  <li key={v.id} className={cx("rounded-md border p-2.5", labPasses(v) ? "border-bull/50 bg-bull/5" : "border-line bg-ink/50")}>
                    <p className="text-[12px] font-bold text-snow">
                      {labVariantInfo(v.id).name}
                      {labPasses(v) ? ` · ${t("pasa la vara")}` : ""}
                    </p>
                    <p className="text-[10.5px] leading-relaxed text-dim">{labVariantInfo(v.id).blurb}</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-fog">
                      {([[t("Año completo"), v.whole], [t("1.ª mitad"), v.first], [t("2.ª mitad"), v.second]] as Array<[string, BotStatsRow]>).map(([name, st]) => (
                        <div key={name}>
                          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-dim">{name}</p>
                          <StatsLine s={st} />
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[10.5px] leading-relaxed text-dim">
                {t("Pasa la vara solo si gana en el año completo y en cada mitad, con operaciones suficientes. Probar muchas versiones y quedarse con la mejor engaña: por eso nada de esto se usa en serio sin confirmarlo antes en modo simulado.")}
              </p>
            </div>
          )}
        </div>
        <p className="text-[10.5px] leading-relaxed text-dim">{t("Es una herramienta de práctica y estudio. No es asesoramiento financiero ni garantiza ganancias.")}</p>
      </div>
    </Panel>
  );
}

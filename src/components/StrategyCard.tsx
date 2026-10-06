import { useMemo, useState } from "react";
import { confidenceLabel, cx, exchangeName, filterBySource, fmtR, strategyPlan, strategySources, t } from "../lib";
import type { Confidence, StrategyRule, Trade } from "../lib";
import { useMoney } from "../money";
import Panel from "./Panel";

const ICON: Record<StrategyRule["kind"], string> = { avoid: "🚫", focus: "🎯", risk: "🛡️", habit: "🧭" };
const CONF: Record<Confidence, string> = { high: "border-bull/50 text-bull", medium: "border-gold/50 text-gold", low: "border-line text-dim" };

const Tile = ({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) => (
  <div className="rounded-md border border-line bg-ink/50 p-3">
    <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-dim">{label}</p>
    <p className={cx("num text-lg font-bold", tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-snow")}>{value}</p>
  </div>
);

export default function StrategyCard({ trades }: { trades: Trade[] }) {
  const { money } = useMoney();
  const sources = useMemo(() => strategySources(trades), [trades]);
  const [picked, setPicked] = useState("all");
  const source = sources.some((x) => x.id === picked) ? picked : "all";
  const use = useMemo(() => filterBySource(trades, source), [trades, source]);
  const plan = useMemo(() => strategyPlan(use, { riskPct: money.riskPct, source }), [use, money.riskPct, source]);
  const showPicker = sources.some((x) => x.id !== "manual");
  const nameOf = (id: string) => (id === "manual" ? t("A mano y señales") : exchangeName(id as never));

  const summary = !plan.ok
    ? `${plan.have}/${plan.needed} ${t("operaciones")}`
    : plan.edge === "likely"
      ? t("Ventaja probable")
      : plan.edge === "unproven"
        ? t("Ventaja sin comprobar")
        : t("Sin ventaja todavía");

  return (
    <Panel id="strategy" title={t("ESTRATEGIA SUGERIDA")} subtitle={t("Reglas armadas con tus propias operaciones")} summary={summary} defaultOpen={false}>
      <div className="space-y-4 p-5">
        {showPicker && (
          <div>
            <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog">{t("Ver la estrategia de")}</p>
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "all", label: t("Todas") }, ...sources.map((x) => ({ id: x.id, label: `${nameOf(x.id)} · ${x.count}` }))].map((o) => (
                <button
                  key={o.id}
                  onClick={() => setPicked(o.id)}
                  className={cx("rounded-md border px-2.5 py-1.5 text-[11px] font-bold transition-colors", source === o.id ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!plan.ok ? (
          <p className="rounded-md border border-line bg-ink/40 p-4 text-[12.5px] leading-relaxed text-fog">
            {t("Para sugerirte una estrategia necesito al menos {n} operaciones cerradas (tenés {have}). Conectá tu exchange o seguí registrando y volvé.", { n: plan.needed, have: plan.have })}
          </p>
        ) : (
          <>
            <p className={cx("rounded-md border p-3 text-[12.5px] leading-relaxed", plan.edge === "likely" ? "border-bull/40 bg-bull/10 text-snow" : plan.edge === "unproven" || plan.lowSample ? "border-gold/40 bg-golddeep/25 text-snow" : "border-bear/40 bg-bear/10 text-snow")}>
              {plan.headline}
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Tile label={t("Acierto")} value={`${Math.round(plan.profile.winRate)}%`} />
              <Tile label={t("Ganancia / pérdida")} value={plan.profile.payoff ? plan.profile.payoff.toFixed(1) : "—"} />
              <Tile label={t("Promedio por operación")} value={`${fmtR(plan.profile.expectancy)}R`} tone={plan.profile.expectancy > 0 ? "bull" : plan.profile.expectancy < 0 ? "bear" : undefined} />
              <Tile label={t("Factor de beneficio")} value={plan.profile.profitFactor == null ? "∞" : plan.profile.profitFactor.toFixed(2)} />
              <Tile label={t("Peor caída")} value={`${plan.profile.maxDrawdownR.toFixed(1).replace(/\.0$/, "")}R`} tone="bear" />
            </div>
            <p className="text-[11px] text-dim">{t("Tu estilo")}: {plan.style}</p>

            <div className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{t("Tu plan sugerido")}</p>
              {plan.rules.length === 0 ? (
                <p className="text-[12px] text-fog">{t("Todavía no encuentro patrones claros. Seguí registrando: con más operaciones aparecen.")}</p>
              ) : (
                plan.rules.map((r) => (
                  <div key={r.title} className="rounded-md border border-line bg-ink/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12.5px] font-bold leading-snug text-snow">
                        {ICON[r.kind]} {r.title}
                      </p>
                      <span className={cx("shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider", CONF[r.confidence])}>{confidenceLabel(r.confidence)}</span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-fog">{r.why}</p>
                  </div>
                ))
              )}
            </div>

            {plan.after && (
              <div className="rounded-md border border-line bg-ink/40 p-3 text-[12px] leading-relaxed text-fog">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{t("¿Y si hubieras evitado eso?")}</p>
                <p>
                  {t("Habrías hecho {a} operaciones menos y tu resultado pasaba de {b} a {c}.", { a: plan.avoidedTrades, b: `${fmtR(plan.before.netR)}R`, c: `${fmtR(plan.after.netR)}R` })}
                </p>
                <p className="mt-1 text-[11px] text-dim">{t("Es una cuenta sobre lo que ya pasó: siempre sale mejor de lo que va a salir. Mirá el control de abajo.")}</p>
              </div>
            )}

            {plan.validation && (
              <p className={cx("rounded-md border p-3 text-[12px] leading-relaxed", plan.validation.held ? "border-bull/40 bg-bull/10 text-snow" : "border-bear/40 bg-bear/10 text-snow")}>
                {plan.validation.held
                  ? t("Control: armé las reglas con tus {a} operaciones más viejas y las probé en las {b} más nuevas. Lo que evitarías sumó {r}: la regla se sostuvo.", { a: plan.validation.trainN, b: plan.validation.testN, r: `${fmtR(plan.validation.avoidedR)}R` })
                  : t("Control: armé las reglas con tus {a} operaciones más viejas y las probé en las {b} más nuevas. Lo que evitarías sumó {r}: la regla no se sostuvo, tomala con cuidado.", { a: plan.validation.trainN, b: plan.validation.testN, r: `${fmtR(plan.validation.avoidedR)}R` })}
              </p>
            )}

            <div className="rounded-md border border-gold/30 bg-golddeep/25 p-3 text-[11.5px] leading-relaxed text-fog">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gold">{t("Cómo probarlo")}</p>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>{t("Elegí 2 o 3 reglas, no todas juntas.")}</li>
                <li>{t("Seguilas durante las próximas 20 operaciones, en demo o con el riesgo mínimo.")}</li>
                <li>{t("Volvé acá: si tu promedio por operación mejoró, mantenelas; si no, descartalas.")}</li>
              </ol>
            </div>
            <p className="text-[10.5px] leading-relaxed text-dim">
              {t("Son patrones de tu historial, no una garantía. Con pocas operaciones pueden ser casualidad, por eso cada regla trae su nivel de confianza. No es asesoramiento financiero.")}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

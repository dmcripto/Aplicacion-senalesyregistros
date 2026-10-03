import { useState } from "react";
import { coachProblem, fmtDateTime, t } from "../lib";
import type { CoachResult } from "../lib";
import { fetchCoach } from "../tradesApi";
import Panel from "./Panel";

/** Coach de disciplina con IA: explica tus patrones a partir de datos calculados de tu diario. */
export default function CoachCard({ closedCount }: { closedCount: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CoachResult | null>(null);

  const analyze = async () => {
    setBusy(true);
    try {
      setResult(await fetchCoach());
    } finally {
      setBusy(false);
    }
  };

  const text = result && (result.ok ? result.text : "text" in result ? result.text : null);

  return (
    <Panel
      id="coach"
      title={t("COACH CON IA")}
      subtitle={t("Qué patrones tenés y qué cambiar esta semana")}
      summary={t("Analizá tu diario con un toque")}
      defaultOpen={false}
    >
      <div className="space-y-3 p-5">
        {!result && (
          <p className="text-[12px] leading-relaxed text-fog">
            {t("El coach mira tus operaciones cerradas de los últimos 45 días, calcula tus patrones (horarios, activos, qué pasa después de una pérdida, tus notas) y te los explica en pocas líneas, con una acción para la semana. Necesita al menos 10 operaciones cerradas.")}
          </p>
        )}

        {result && !result.ok && <p className="rounded-md border border-gold/40 bg-golddeep/30 px-3 py-2.5 text-[12px] leading-relaxed text-gold">{coachProblem(result)}</p>}

        {text && (
          <div className="rounded-md border border-line bg-ink/40 p-4">
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-snow">{text}</p>
            {result && result.ok && (
              <p className="mt-3 text-[10.5px] text-dim">
                {t("Basado en {n} operaciones cerradas", { n: result.closed })} · {fmtDateTime(result.createdAt)}
                {result.cached ? ` · ${t("guardado, sin cambios en tu diario")}` : ""}
              </p>
            )}
          </div>
        )}

        <button
          onClick={analyze}
          disabled={busy || closedCount === 0}
          className="w-full rounded-md bg-gold px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 disabled:opacity-50"
        >
          {busy ? t("Analizando…") : result?.ok ? t("Actualizar análisis") : t("Analizar mi diario")}
        </button>
        <p className="text-[10.5px] leading-relaxed text-dim">
          {t("Es un análisis automático de tus hábitos hecho con IA, no un consejo de inversión ni una señal. Para generarlo se envían a un servicio de IA estadísticas calculadas de tu diario (no tus claves ni tus datos personales).")}
        </p>
      </div>
    </Panel>
  );
}

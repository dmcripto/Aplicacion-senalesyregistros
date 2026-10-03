import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { coachProblem, fmtDateTime, t } from "@dmcripto/core";
import type { CoachResult } from "@dmcripto/core";
import { fetchCoach } from "./tradesApi";
import { colors } from "./theme";

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
    <View style={s.card}>
      <Text style={s.title}>{t("COACH CON IA")}</Text>
      <Text style={s.sub}>{t("Qué patrones tenés y qué cambiar esta semana")}</Text>
      {!result && (
        <Text style={s.hint}>
          {t("El coach mira tus operaciones cerradas de los últimos 45 días, calcula tus patrones (horarios, activos, qué pasa después de una pérdida, tus notas) y te los explica en pocas líneas, con una acción para la semana. Necesita al menos 10 operaciones cerradas.")}
        </Text>
      )}
      {result && !result.ok && (
        <View style={s.notice}>
          <Text style={s.noticeText}>{coachProblem(result)}</Text>
        </View>
      )}
      {text ? (
        <View style={s.report}>
          <Text style={s.reportText}>{text}</Text>
          {result && result.ok && (
            <Text style={s.meta}>
              {t("Basado en {n} operaciones cerradas", { n: result.closed })} · {fmtDateTime(result.createdAt)}
              {result.cached ? ` · ${t("guardado, sin cambios en tu diario")}` : ""}
            </Text>
          )}
        </View>
      ) : null}
      <TouchableOpacity style={[s.btn, (busy || closedCount === 0) && { opacity: 0.5 }]} onPress={analyze} disabled={busy || closedCount === 0}>
        {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={s.btnText}>{result?.ok ? t("Actualizar análisis") : t("Analizar mi diario")}</Text>}
      </TouchableOpacity>
      <Text style={s.hint}>
        {t("Es un análisis automático de tus hábitos hecho con IA, no un consejo de inversión ni una señal. Para generarlo se envían a un servicio de IA estadísticas calculadas de tu diario (no tus claves ni tus datos personales).")}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, marginBottom: 16, gap: 10 },
  title: { color: colors.snow, fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },
  sub: { color: colors.dim, fontSize: 10.5, letterSpacing: 1.1, textTransform: "uppercase" },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  notice: { borderWidth: 1, borderColor: colors.gold + "66", borderRadius: 8, padding: 10, backgroundColor: colors.golddeep + "44" },
  noticeText: { color: colors.gold, fontSize: 12, lineHeight: 17 },
  report: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 14, backgroundColor: colors.ink + "88", gap: 8 },
  reportText: { color: colors.snow, fontSize: 13, lineHeight: 19 },
  meta: { color: colors.dim, fontSize: 10.5 },
  btn: { backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "800", fontSize: 12.5, letterSpacing: 0.5 },
});

import { StyleSheet, Text, View } from "react-native";
import { t } from "@dmcripto/core";
import { Icon, IconTile } from "./icons";
import type { IconName, Tone } from "./icons";
import { colors } from "./theme";

/** Ícono de línea (y su color) para cada función de la bienvenida; el texto viene del núcleo con un emoji que acá no se usa. */
export const FEATURE_ICON: Record<string, [IconName, Tone]> = {
  "📡": ["radio", "cyan"],
  "🎯": ["trend", "green"],
  "📒": ["journal", "violet"],
  "🛡️": ["shield", "green"],
  "🗺️": ["drop", "amber"],
  "👥": ["send", "cyan"],
};

/** Etiquetas de lo que incluye y tres datos de confianza. */
export function Highlights() {
  const pills: Array<[IconName, Tone, string]> = [
    ["radio", "cyan", t("Señales en vivo")],
    ["candles", "green", t("Gráfico con indicadores")],
    ["calendar", "amber", t("Agenda económica")],
    ["bell", "violet", t("Alertas propias")],
  ];
  const trust: Array<[IconName, string]> = [
    ["shield", t("Claves de exchange solo de lectura")],
    ["radio", t("Avisos en la app y en Telegram")],
    ["candles", t("Web y Android con la misma cuenta")],
  ];
  return (
    <View style={{ marginTop: 14, gap: 12, alignItems: "center" }}>
      <View style={st.pills}>
        {pills.map(([icon, tone, label]) => (
          <View key={label} style={st.pill}>
            <IconTile name={icon} tone={tone} size={26} />
            <Text style={st.pillText}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={{ gap: 6 }}>
        {trust.map(([icon, label]) => (
          <View key={label} style={st.trust}>
            <Icon name={icon} color={colors.bull} size={14} />
            <Text style={st.trustText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Cómo funciona, en tres pasos. */
export function Steps() {
  const steps: Array<[IconName, Tone, string, string]> = [
    ["link", "cyan", t("Conectá"), t("Copiá tu enlace personal en la alerta de TradingView, o pegá cualquier señal de Telegram, WhatsApp o Discord.")],
    ["bell", "green", t("Recibí"), t("Cada señal y cada target te llega a la app y a Telegram, con una tarjeta lista para compartir.")],
    ["trend", "violet", t("Mejorá"), t("Tu diario calcula R, acierto y racha solo, y el análisis te muestra qué corregir.")],
  ];
  return (
    <View style={{ gap: 10 }}>
      <Text style={st.title}>{t("Cómo funciona").toUpperCase()}</Text>
      {steps.map(([icon, tone, title, text], i) => (
        <View key={title} style={st.step}>
          <IconTile name={icon} tone={tone} size={42} />
          <View style={{ flex: 1 }}>
            <Text style={st.stepTitle}>
              {i + 1}. {title}
            </Text>
            <Text style={st.stepText}>{text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(16,23,32,0.8)", borderRadius: 999, paddingVertical: 3, paddingLeft: 3, paddingRight: 12 },
  pillText: { color: colors.snow, fontSize: 12, fontWeight: "700" },
  trust: { flexDirection: "row", alignItems: "center", gap: 8 },
  trustText: { color: colors.fog, fontSize: 12, fontWeight: "600" },
  title: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginTop: 6 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14 },
  stepTitle: { color: colors.snow, fontSize: 15, fontWeight: "800" },
  stepText: { color: colors.fog, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
});

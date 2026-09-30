import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { setupPush } from "../push";
import { Logo } from "../ui";
import { colors } from "../theme";

const SLIDES = [
  {
    title: "Bienvenido a VELTRIX",
    text: "Tu diario de trading con señales en vivo. Registrá cada operación y mirá tus resultados en R, tu curva de capital y tu evolución mes a mes.",
    points: ["Estadísticas claras: acierto, profit factor y R promedio", "Todo sincronizado entre la app y la web"],
  },
  {
    title: "Recibí señales de donde quieras",
    text: "No importa qué plataforma uses. VELTRIX entiende tus señales sin complicarte.",
    points: [
      "TradingView u otra herramienta: pegá tu URL personal (Ajustes)",
      "Telegram o WhatsApp: copiá el mensaje y pegalo en Registrar",
      "O cargalas a mano en un minuto",
    ],
  },
  {
    title: "Que no se te escape ninguna",
    text: "Activá las notificaciones para enterarte al instante cuando llega una señal o cuando se toca tu TP o SL.",
    points: ["Cierre automático de TP y SL (criptomonedas)", "Podés apagarlo cuando quieras en Ajustes"],
  },
];

export default function OnboardingScreen({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const last = i === SLIDES.length - 1;
  const slide = SLIDES[i];

  const next = async () => {
    if (!last) return setI(i + 1);
    setBusy(true);
    try {
      await setupPush(userId);
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Logo size={110} />
        </View>
        <Text style={s.title}>{slide.title}</Text>
        <Text style={s.text}>{slide.text}</Text>
        <View style={{ gap: 10, marginTop: 20 }}>
          {slide.points.map((p) => (
            <View key={p} style={s.point}>
              <Text style={s.check}>✓</Text>
              <Text style={s.pointText}>{p}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <View style={s.dots}>
          {SLIDES.map((_, k) => (
            <View key={k} style={[s.dot, k === i && s.dotOn]} />
          ))}
        </View>
        <TouchableOpacity style={s.primary} onPress={next} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={s.primaryText}>{last ? "Activar notificaciones y empezar" : "Siguiente"}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={onDone} disabled={busy} style={{ paddingVertical: 10 }}>
          <Text style={s.skip}>{last ? "Ahora no" : "Saltar"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 24, paddingTop: 48, flexGrow: 1, justifyContent: "center" },
  title: { color: colors.snow, fontSize: 26, fontWeight: "900", textAlign: "center", letterSpacing: 0.3 },
  text: { color: colors.fog, fontSize: 14.5, lineHeight: 22, textAlign: "center", marginTop: 12 },
  point: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "rgba(16,23,32,0.85)", borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 },
  check: { color: colors.bull, fontWeight: "900", fontSize: 15 },
  pointText: { color: colors.snow, fontSize: 13.5, lineHeight: 19, flex: 1 },
  footer: { padding: 20, paddingBottom: 28, alignItems: "center", gap: 6 },
  dots: { flexDirection: "row", gap: 8, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line2 },
  dotOn: { width: 24, backgroundColor: colors.gold },
  primary: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 15, alignSelf: "stretch", alignItems: "center" },
  primaryText: { color: colors.ink, fontWeight: "900", fontSize: 14.5, letterSpacing: 0.3 },
  skip: { color: colors.dim, fontSize: 13, fontWeight: "600" },
});

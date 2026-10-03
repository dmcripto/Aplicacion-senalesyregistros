import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { fmtR, summarize } from "@dmcripto/core";
import type { SharePeriod, Trade } from "@dmcripto/core";
import { AreaChart, Logo } from "./ui";
import { colors } from "./theme";
import { t } from "@dmcripto/core";

const PERIODS: Array<[SharePeriod, string]> = [
  ["week", "7 días"],
  ["month", "Este mes"],
  ["all", "Todo"],
];

export default function ShareCardModal({ visible, trades, onClose }: { visible: boolean; trades: Trade[]; onClose: () => void }) {
  const [period, setPeriod] = useState<SharePeriod>("month");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<View>(null);
  const s = useMemo(() => summarize(trades, period), [trades, period]);
  const good = s.netR >= 0;
  const accent = s.closed === 0 ? colors.fog : good ? colors.bull : colors.bear;

  const share = async () => {
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t("No disponible"), t("Este dispositivo no permite compartir imágenes desde la app."));
        return;
      }
      const uri = await captureRef(cardRef, { format: "png", quality: 1, width: 1080, height: 1350, result: "tmpfile" });
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: t("Compartir mi resultado") });
    } catch (err) {
      Alert.alert(t("Error"), err instanceof Error ? err.message : t("No se pudo compartir la imagen."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.bg}>
        <View style={st.sheet}>
          <View style={st.head}>
            <Text style={st.title}>{t("Compartir mi resultado")}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={st.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={st.tabs}>
            {PERIODS.map(([key, label]) => (
              <TouchableOpacity key={key} style={[st.tab, period === key && st.tabOn]} onPress={() => setPeriod(key)}>
                <Text style={[st.tabText, period === key && { color: colors.ink }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View ref={cardRef} collapsable={false} style={st.card}>
            <LinearGradient colors={["#070b11", "#0a1a2a"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={["rgba(46,196,241,0.28)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 0.5 }} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={["transparent", good ? "rgba(22,217,138,0.22)" : "rgba(255,77,103,0.2)"]} start={{ x: 0.3, y: 0.6 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

            <View style={st.cardTop}>
              <Logo size={34} />
              <View style={{ flex: 1 }}>
                <Text allowFontScaling={false} style={st.brand}>VELTRIX</Text>
                <Text allowFontScaling={false} style={st.brandSub}>{t("Diario de trading")}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text allowFontScaling={false} style={st.period}>{s.label}</Text>
                <Text allowFontScaling={false} style={st.periodSub}>
                  {s.closed} {s.closed === 1 ? t("operación") : t("operaciones")}
                </Text>
              </View>
            </View>

            <Text allowFontScaling={false} style={st.kicker}>{t("RESULTADO NETO")}</Text>
            <Text allowFontScaling={false} style={[st.big, { color: accent, textShadowColor: accent }]}>{s.closed === 0 ? "0R" : `${fmtR(s.netR)}R`}</Text>

            <View style={st.chart}>
              <AreaChart values={s.curve} color={accent === colors.fog ? colors.cyan : accent} height={54} />
            </View>

            <View style={st.stats}>
              <Stat label={t("ACIERTO")} value={s.closed ? `${Math.round(s.winRate)}%` : "—"} />
              <Stat label="PROFIT FACTOR" value={s.closed ? (s.pf == null ? "∞" : s.pf.toFixed(2)) : "—"} />
              <Stat label={t("MEJOR")} value={s.closed ? `${fmtR(s.bestR)}R` : "—"} />
            </View>

            <Text allowFontScaling={false} style={st.cta}>{t("Llevá tu diario de trading con VELTRIX")}</Text>
            <View style={st.badge}>
              <Svg width={16} height={18} viewBox="0 0 42 48">
                <Path d="M0 0 L23 24 L0 48 Z" fill="#00a0ff" />
                <Path d="M0 0 L31 17.8 L23 24 Z" fill="#00e676" />
                <Path d="M31 17.8 L42 24 L31 30.2 L23 24 Z" fill="#ffd500" />
                <Path d="M0 48 L23 24 L31 30.2 Z" fill="#ff3d57" />
              </Svg>
              <View>
                <Text allowFontScaling={false} style={st.badgeTop}>{t("PRÓXIMAMENTE EN")}</Text>
                <Text allowFontScaling={false} style={st.badgeMain}>Google Play</Text>
              </View>
            </View>
            <Text allowFontScaling={false} style={st.legal}>{t("Resultados pasados no garantizan resultados futuros. No es asesoramiento financiero.")}</Text>
          </View>

          <TouchableOpacity style={st.shareBtn} onPress={share} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={st.shareText}>{t("Compartir imagen")}</Text>}
          </TouchableOpacity>
          <Text style={st.note}>{t("Solo muestra resultados en R: sin montos de dinero ni datos de tu cuenta.")}</Text>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.stat}>
      <Text allowFontScaling={false} style={st.statLabel}>{label}</Text>
      <Text allowFontScaling={false} style={st.statValue}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,.75)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, paddingBottom: 24 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { color: colors.snow, fontWeight: "900", fontSize: 16 },
  close: { color: colors.fog, fontSize: 18 },
  tabs: { flexDirection: "row", backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 3, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabOn: { backgroundColor: colors.gold },
  tabText: { color: colors.fog, fontWeight: "800", fontSize: 12 },
  card: { alignSelf: "center", width: 300, height: 375, borderRadius: 14, overflow: "hidden", padding: 14, justifyContent: "flex-start", borderWidth: 1, borderColor: colors.line },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { color: colors.snow, fontWeight: "900", fontSize: 17, lineHeight: 20, letterSpacing: 0.6 },
  brandSub: { color: colors.gold, fontSize: 9.5, fontWeight: "700" },
  period: { color: colors.snow, fontWeight: "800", fontSize: 10.5 },
  periodSub: { color: colors.fog, fontSize: 9 },
  kicker: { color: colors.fog, fontSize: 9, fontWeight: "800", letterSpacing: 1.5, textAlign: "center", marginTop: 10 },
  big: { fontSize: 52, lineHeight: 60, fontWeight: "900", textAlign: "center", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  chart: { backgroundColor: "rgba(16,23,32,0.85)", borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 8, marginTop: 4 },
  stats: { flexDirection: "row", gap: 6, marginTop: 8 },
  stat: { flex: 1, backgroundColor: "rgba(16,23,32,0.85)", borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, alignItems: "center" },
  statLabel: { color: colors.fog, fontSize: 7.5, lineHeight: 10, fontWeight: "800", letterSpacing: 0.8 },
  statValue: { color: colors.snow, fontSize: 17, lineHeight: 21, fontWeight: "900", marginTop: 1 },
  cta: { color: colors.snow, fontSize: 10.5, lineHeight: 14, fontWeight: "800", textAlign: "center", marginTop: 7 },
  badge: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#000", borderWidth: 1, borderColor: "#a6a6a6", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 4, marginTop: 5 },
  badgeTop: { color: "#fff", fontSize: 5.5, lineHeight: 8, fontWeight: "700", letterSpacing: 0.4 },
  badgeMain: { color: "#fff", fontSize: 13, lineHeight: 16, fontWeight: "700", marginTop: -1 },
  legal: { color: colors.dim, fontSize: 6.5, lineHeight: 9, textAlign: "center", marginTop: 4 },
  shareBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 14 },
  shareText: { color: colors.ink, fontWeight: "900", fontSize: 14 },
  note: { color: colors.dim, fontSize: 10.5, textAlign: "center", marginTop: 8 },
});

import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Trade } from "@dmcripto/core";
import { t } from "@dmcripto/core";
import LiquidationMapView from "../LiquidationMapView";
import ChartSection from "../ChartSection";
import EconomySection from "../EconomySection";
import { colors } from "../theme";

type Part = "chart" | "liq" | "agenda";

/** Mercado: gráfico de análisis, mapa de liquidaciones y agenda económica. */
export default function MapScreen({ userId, trades }: { userId: string; trades: Trade[] }) {
  const [part, setPart] = useState<Part>("chart");
  const parts: Array<{ k: Part; label: string }> = [
    { k: "chart", label: t("Gráfico") },
    { k: "liq", label: t("Liquidaciones") },
    { k: "agenda", label: t("Agenda") },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={st.seg}>
        {parts.map((p) => (
          <TouchableOpacity key={p.k} onPress={() => setPart(p.k)} style={[st.segBtn, part === p.k && st.segOn]}>
            <Text style={[st.segText, part === p.k && { color: colors.ink }]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {part === "chart" && <ChartSection userId={userId} trades={trades} />}
      {part === "liq" && <LiquidationMapView />}
      {part === "agenda" && <EconomySection />}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  seg: { flexDirection: "row", gap: 8, marginBottom: 14 },
  segBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  segOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  segText: { color: colors.fog, fontWeight: "800", fontSize: 12.5 },
});

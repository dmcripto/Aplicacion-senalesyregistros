import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { FEATURES, resultR } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { AnalysisBlock, Empty, StrategyBlock, EquityBars, MonthlyList, StatsGrid, TagList, TradeCard } from "../components";
import ShareCardModal from "../ShareCardModal";
import CoachCard from "../CoachCard";
import { colors } from "../theme";
import { t } from "@dmcripto/core";
import { ScreenHead } from "../HomeParts";

type Filter = "all" | "won" | "lost";
const LABELS: Record<Filter, string> = { all: "Todas", won: "Ganadas", lost: "Perdidas" };

export default function JournalScreen({
  trades,
  loading,
  refreshing,
  refresh,
}: {
  trades: Trade[];
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sharing, setSharing] = useState(false);
  const closed = trades.filter((t) => t.outcome !== "ABIERTA");
  const data = closed.filter((t) => {
    const r = resultR(t) ?? 0;
    return filter === "all" ? true : filter === "won" ? r > 0 : r < 0;
  });

  return (
    <>
    <ShareCardModal visible={sharing} trades={trades} onClose={() => setSharing(false)} />
    <FlatList
      style={{ flex: 1 }}
      data={data}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} />}
      ListHeaderComponent={
        <>
          <ScreenHead icon="journal" tone="violet" title={t("Diario")} sub={t("Tu historial, tu curva y qué corregir")} />
          <StatsGrid trades={trades} />
          <TouchableOpacity style={s.shareBtn} onPress={() => setSharing(true)} disabled={!closed.length}>
            <Text style={s.shareText}>{t("↗ Compartir mi resultado")}</Text>
          </TouchableOpacity>
          <EquityBars trades={trades} />
          <MonthlyList trades={trades} />
          <AnalysisBlock trades={trades} />
          <StrategyBlock trades={trades} />
          {FEATURES.coach && <CoachCard closedCount={closed.length} />}
          <TagList trades={trades} />
          <Text style={s.title}>{t("HISTORIAL")}</Text>
          <View style={s.chips}>
            {(Object.keys(LABELS) as Filter[]).map((f) => (
              <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipOn]} onPress={() => setFilter(f)}>
                <Text style={[s.chipText, filter === f && s.chipTextOn]}>{t(LABELS[f])}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      }
      ListEmptyComponent={
        !loading ? <Empty title={t("SIN OPERACIONES CERRADAS")} text={t("Cuando marques TP, SL o un cierre manual en una señal, queda registrada acá.")} /> : null
      }
      renderItem={({ item }) => <TradeCard trade={item} />}
    />
    </>
  );
}

const s = StyleSheet.create({
  shareBtn: { borderWidth: 1, borderColor: colors.bull + "66", backgroundColor: colors.bull + "14", borderRadius: 12, paddingVertical: 12, alignItems: "center", marginBottom: 16 },
  shareText: { color: colors.bull, fontWeight: "900", fontSize: 13.5, letterSpacing: 0.3 },
  title: { color: colors.fog, fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8 },
  chips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: colors.ink },
});

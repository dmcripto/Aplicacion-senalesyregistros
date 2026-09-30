import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Trade } from "@dmcripto/core";
import { CommunityCard, Empty, StatsGrid, TradeCard } from "../components";
import { colors } from "../theme";

export default function SignalsScreen({
  trades,
  loading,
  refreshing,
  refresh,
  onCalculate,
}: {
  trades: Trade[];
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  onCalculate?: (t: Trade) => void;
}) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const data = filter === "open" ? trades.filter((t) => t.outcome === "ABIERTA") : trades.slice(0, 30);

  return (
    <FlatList
      style={{ flex: 1 }}
      data={data}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} />}
      ListHeaderComponent={
        <>
          <StatsGrid trades={trades} />
          <CommunityCard />
          <View style={s.chips}>
            {(["open", "all"] as const).map((f) => (
              <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipOn]} onPress={() => setFilter(f)}>
                <Text style={[s.chipText, filter === f && s.chipTextOn]}>{f === "open" ? "Abiertas" : "Últimas 30"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      }
      ListEmptyComponent={
        !loading ? (
          <Empty
            title={filter === "open" ? "SIN SEÑALES ABIERTAS" : "AÚN NO HAY SEÑALES"}
            text="Cuando llegue una alerta de TradingView aparece acá con una notificación. También podés cargarla a mano desde la pestaña Registrar."
          />
        ) : null
      }
      renderItem={({ item }) => <TradeCard trade={item} onCalculate={onCalculate} />}
    />
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: colors.ink },
});

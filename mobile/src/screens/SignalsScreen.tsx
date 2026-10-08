import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { DailyStatus, Trade } from "@dmcripto/core";
import { LimitBanner, CommunityCard, Empty, StatsGrid, TradeCard } from "../components";
import { HomeHero, HomeStatus } from "../HomeParts";
import EconomySection from "../EconomySection";
import { IconTile } from "../icons";
import { colors } from "../theme";
import { t } from "@dmcripto/core";

export default function SignalsScreen({
  trades,
  loading,
  refreshing,
  refresh,
  onCalculate,
  limitStatus,
  userId,
  email,
  go,
}: {
  trades: Trade[];
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  onCalculate?: (t: Trade) => void;
  limitStatus?: DailyStatus;
  userId: string;
  email?: string;
  go: (tab: "add" | "map" | "settings") => void;
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
          <HomeHero email={email} trades={trades} go={go} />
          {limitStatus && <LimitBanner status={limitStatus} />}
          <HomeStatus userId={userId} go={go} />
          <EconomySection limit={3} />
          <StatsGrid trades={trades} />
          <CommunityCard />
          <View style={s.sectionHead}>
            <IconTile name="radio" tone="cyan" size={32} />
            <Text style={s.sectionTitle}>{t("TUS SEÑALES")}</Text>
          </View>
          <View style={s.chips}>
            {(["open", "all"] as const).map((f) => (
              <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipOn]} onPress={() => setFilter(f)}>
                <Text style={[s.chipText, filter === f && s.chipTextOn]}>{f === "open" ? t("Abiertas") : t("Últimas 30")}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      }
      ListEmptyComponent={
        !loading ? (
          <Empty
            title={filter === "open" ? t("SIN SEÑALES ABIERTAS") : t("AÚN NO HAY SEÑALES")}
            text={t("Cuando llegue una alerta de TradingView aparece acá con una notificación. También podés cargarla a mano desde la pestaña Registrar.")}
          />
        ) : null
      }
      renderItem={({ item }) => <TradeCard trade={item} onCalculate={onCalculate} />}
    />
  );
}

const s = StyleSheet.create({
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  sectionTitle: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  chips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: colors.ink },
});

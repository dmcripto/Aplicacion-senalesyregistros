import { useMemo } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  computeStats,
  fmtDateTime,
  fmtPct,
  fmtPrice,
  fmtR,
  resultR,
  rrOf,
} from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { useTrades } from "../hooks";
import { deleteTradeById, markTradeOutcome, reopenTradeById } from "../tradesApi";
import { colors } from "../theme";

function StatsHeader({ trades }: { trades: Trade[] }) {
  const stats = useMemo(() => computeStats(trades), [trades]);
  return (
    <View style={styles.statsRow}>
      <View style={[styles.statCard, styles.statCardWide]}>
        <Text style={styles.statLabel}>R neto</Text>
        <Text
          style={[
            styles.statValueBig,
            { color: stats.netR > 0 ? colors.bull : stats.netR < 0 ? colors.bear : colors.fog },
          ]}
        >
          {fmtR(stats.netR)}R
        </Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Acierto</Text>
        <Text style={[styles.statValue, { color: stats.winRate >= 50 ? colors.bull : colors.bear }]}>
          {fmtPct(stats.winRate)}
        </Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Operaciones</Text>
        <Text style={styles.statValue}>{stats.total}</Text>
        <Text style={styles.statSub}>{stats.abiertas} abiertas</Text>
      </View>
    </View>
  );
}

function TradeRow({
  trade,
  onMark,
  onReopen,
  onDelete,
}: {
  trade: Trade;
  onMark: (id: string, outcome: "TP" | "SL") => void;
  onReopen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const abierta = trade.outcome === "ABIERTA";
  const r = resultR(trade);
  const confirmDelete = () =>
    Alert.alert("Eliminar operación", `¿Borrar ${trade.symbol} del diario?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => onDelete(trade.id) },
    ]);

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.symbol}>{trade.symbol}</Text>
          <Text style={[styles.dir, { color: trade.direction === "LONG" ? colors.bull : colors.bear }]}>
            {trade.direction}
          </Text>
        </View>
        <Text style={styles.meta}>
          {fmtDateTime(trade.date)} · Entrada {fmtPrice(trade.entry)} · R:R 1:{rrOf(trade).toFixed(2)}
        </Text>
        <Text
          style={[
            styles.outcome,
            { color: abierta ? colors.gold : (r ?? 0) >= 0 ? colors.bull : colors.bear },
          ]}
        >
          {abierta ? "ABIERTA" : `${trade.outcome === "MANUAL" ? "CIERRE" : trade.outcome} · ${fmtR(r ?? 0)}R`}
        </Text>
      </View>
      <View style={styles.actions}>
        {abierta ? (
          <>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBull]} onPress={() => onMark(trade.id, "TP")}>
              <Text style={styles.actionBullText}>TP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBear]} onPress={() => onMark(trade.id, "SL")}>
              <Text style={styles.actionBearText}>SL</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.actionBtn} onPress={() => onReopen(trade.id)}>
            <Text style={styles.actionText}>Reabrir</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionBtn} onPress={confirmDelete}>
          <Text style={[styles.actionText, { color: colors.bear }]}>Borrar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function JournalScreen({ userId }: { userId: string }) {
  const { trades, loading, refreshing, refresh } = useTrades(userId);

  const handleMark = async (id: string, outcome: "TP" | "SL") => {
    try {
      await markTradeOutcome(id, outcome);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "No se pudo actualizar la operación.");
    }
  };
  const handleReopen = async (id: string) => {
    try {
      await reopenTradeById(id);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "No se pudo reabrir la operación.");
    }
  };
  const handleDelete = async (id: string) => {
    try {
      await deleteTradeById(id);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "No se pudo eliminar la operación.");
    }
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={trades}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} />}
        ListHeaderComponent={<StatsHeader trades={trades} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>EL DIARIO ESTÁ VACÍO</Text>
              <Text style={styles.emptyText}>
                Configurá tu webhook en la pestaña Ajustes y esperá la primera alerta de TradingView.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TradeRow trade={item} onMark={handleMark} onReopen={handleReopen} onDelete={handleDelete} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
  },
  statCardWide: { flex: 1.4 },
  statLabel: { color: colors.fog, fontSize: 9, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  statValueBig: { fontSize: 26, fontWeight: "800", marginTop: 4 },
  statValue: { color: colors.snow, fontSize: 20, fontWeight: "800", marginTop: 4 },
  statSub: { color: colors.dim, fontSize: 10, marginTop: 2 },
  row: {
    flexDirection: "row",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  symbol: { color: colors.snow, fontWeight: "800", fontSize: 14 },
  dir: { fontWeight: "700", fontSize: 11 },
  meta: { color: colors.dim, fontSize: 11, marginTop: 3 },
  outcome: { fontWeight: "700", fontSize: 12, marginTop: 5 },
  actions: { justifyContent: "center", gap: 6 },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  actionText: { color: colors.fog, fontSize: 11, fontWeight: "700" },
  actionBull: { borderColor: "rgba(22,217,138,.4)", backgroundColor: "rgba(22,217,138,.1)" },
  actionBullText: { color: colors.bull, fontSize: 11, fontWeight: "700" },
  actionBear: { borderColor: "rgba(255,77,103,.4)", backgroundColor: "rgba(255,77,103,.1)" },
  actionBearText: { color: colors.bear, fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: { color: colors.snow, fontWeight: "800", fontSize: 16, letterSpacing: 1 },
  emptyText: { color: colors.fog, fontSize: 12, textAlign: "center", marginTop: 8, lineHeight: 18 },
});

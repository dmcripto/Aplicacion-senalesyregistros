import { useMemo, useState } from "react";
import { Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { computeStats, equitySeries, fmtDateTime, fmtPct, fmtPrice, fmtR, monthlySummary, resultR, rrOf } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { closeTradeManually, deleteTradeById, markTradeOutcome, reopenTradeById } from "./tradesApi";
import { colors } from "./theme";

const rColor = (r: number) => (r > 0 ? colors.bull : r < 0 ? colors.bear : colors.fog);

const fail = (err: unknown, fallback: string) =>
  Alert.alert("Error", err instanceof Error ? err.message : fallback);

export function StatTile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
      <Text style={[s.tileValue, color ? { color } : null]}>{value}</Text>
      {sub ? <Text style={s.tileSub}>{sub}</Text> : null}
    </View>
  );
}

export function StatsGrid({ trades }: { trades: Trade[] }) {
  const st = useMemo(() => computeStats(trades), [trades]);
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <View style={s.tileRow}>
        <StatTile label="R neto" value={`${fmtR(st.netR)}R`} color={rColor(st.netR)} />
        <StatTile label="Acierto" value={fmtPct(st.winRate)} color={st.cerradas ? (st.winRate >= 50 ? colors.bull : colors.bear) : colors.fog} sub={`${st.ganadas}G · ${st.perdidas}P`} />
        <StatTile label="Ops" value={String(st.total)} sub={`${st.abiertas} abiertas`} />
      </View>
      <View style={s.tileRow}>
        <StatTile label="Profit factor" value={st.pf == null ? "∞" : st.pf.toFixed(2)} />
        <StatTile label="R promedio" value={st.cerradas ? `${fmtR(st.avgR)}R` : "—"} color={rColor(st.avgR)} />
        <StatTile label="Mejor / peor" value={st.cerradas ? `${fmtR(st.bestR)} / ${fmtR(st.worstR)}` : "—"} />
      </View>
    </View>
  );
}

export function EquityBars({ trades }: { trades: Trade[] }) {
  const pts = useMemo(() => equitySeries(trades).slice(-40), [trades]);
  if (pts.length < 2) return null;
  const H = 110;
  const max = Math.max(0, ...pts.map((p) => p.cum));
  const min = Math.min(0, ...pts.map((p) => p.cum));
  const span = max - min || 1;
  const zeroY = (max / span) * H;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>CURVA DE CAPITAL (R)</Text>
      <View style={{ height: H, flexDirection: "row", alignItems: "stretch", gap: 2 }}>
        {pts.map((p, i) => {
          const h = Math.max(2, (Math.abs(p.cum) / span) * H);
          return (
            <View key={i} style={{ flex: 1 }}>
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  height: h,
                  top: p.cum >= 0 ? zeroY - h : zeroY,
                  backgroundColor: p.cum >= 0 ? colors.bull : colors.bear,
                  borderRadius: 2,
                }}
              />
            </View>
          );
        })}
        <View style={{ position: "absolute", left: 0, right: 0, top: zeroY, height: 1, backgroundColor: colors.line2 }} />
      </View>
      <Text style={s.tileSub}>Acumulado: {fmtR(pts[pts.length - 1].cum)}R en {pts.length} operaciones</Text>
    </View>
  );
}

export function MonthlyList({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => monthlySummary(trades), [trades]);
  if (!rows.length) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>RESUMEN MENSUAL</Text>
      {rows.map((r) => (
        <View key={r.key} style={s.monthRow}>
          <Text style={[s.monthLabel, { textTransform: "capitalize" }]}>{r.label}</Text>
          <Text style={s.monthCell}>{r.ops} ops</Text>
          <Text style={s.monthCell}>{r.cerradas ? `${Math.round(r.winRate)}%` : "—"}</Text>
          <Text style={[s.monthR, { color: rColor(r.netR) }]}>{r.cerradas ? `${fmtR(r.netR)}R` : "—"}</Text>
        </View>
      ))}
    </View>
  );
}

function CloseModal({ trade, onClose }: { trade: Trade | null; onClose: () => void }) {
  const [value, setValue] = useState("");
  const submit = async () => {
    if (!trade) return;
    const exit = Number(value.replace(",", "."));
    if (!Number.isFinite(exit) || exit <= 0) return Alert.alert("Precio inválido", "Ingresá un precio de salida válido.");
    try {
      await closeTradeManually(trade.id, exit);
      setValue("");
      onClose();
    } catch (err) {
      fail(err, "No se pudo cerrar la operación.");
    }
  };
  return (
    <Modal visible={!!trade} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalBg}>
        <View style={s.modal}>
          <Text style={s.modalTitle}>Cerrar {trade?.symbol} a mercado</Text>
          <Text style={s.tileSub}>Precio de salida</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            placeholder={trade ? String(trade.entry) : ""}
            placeholderTextColor={colors.dim}
            style={s.input}
            autoFocus
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnGold, { flex: 1 }]} onPress={submit}>
              <Text style={[s.btnText, { color: colors.ink }]}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function TradeCard({ trade, big }: { trade: Trade; big?: boolean }) {
  const [closing, setClosing] = useState<Trade | null>(null);
  const abierta = trade.outcome === "ABIERTA";
  const r = resultR(trade);
  const long = trade.direction === "LONG";

  const run = (fn: () => Promise<void>, msg: string) => fn().catch((e) => fail(e, msg));
  const confirmDelete = () =>
    Alert.alert("Eliminar operación", `¿Borrar ${trade.symbol} del diario?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => run(() => deleteTradeById(trade.id), "No se pudo eliminar.") },
    ]);

  return (
    <View style={[s.card, abierta && { borderColor: long ? "rgba(22,217,138,.45)" : "rgba(255,77,103,.45)" }]}>
      <View style={s.cardTop}>
        <Text style={s.symbol}>{trade.symbol}</Text>
        <View style={[s.badge, { backgroundColor: long ? colors.bulldeep : colors.beardeep }]}>
          <Text style={[s.badgeText, { color: long ? colors.bull : colors.bear }]}>{long ? "COMPRA" : "VENTA"}</Text>
        </View>
        <Text style={[s.status, { color: abierta ? colors.gold : rColor(r ?? 0) }]}>
          {abierta ? "ABIERTA" : `${trade.outcome === "MANUAL" ? "CIERRE" : trade.outcome} · ${fmtR(r ?? 0)}R`}
        </Text>
      </View>

      <View style={s.levels}>
        <Level label="ENTRADA" value={fmtPrice(trade.entry)} />
        <Level label="TAKE PROFIT" value={fmtPrice(trade.tp)} color={colors.bull} />
        <Level label="STOP LOSS" value={fmtPrice(trade.sl)} color={colors.bear} />
        <Level label="R:R" value={`1:${rrOf(trade).toFixed(2)}`} />
      </View>
      <Text style={s.date}>
        {fmtDateTime(trade.date)}
        {trade.exit != null ? ` · Salida ${fmtPrice(trade.exit)}` : ""}
      </Text>

      <View style={s.actions}>
        {abierta ? (
          <>
            <TouchableOpacity style={[s.btn, s.btnBull]} onPress={() => run(() => markTradeOutcome(trade.id, "TP"), "No se pudo marcar TP.")}>
              <Text style={[s.btnText, { color: colors.bull }]}>Tocó TP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnBear]} onPress={() => run(() => markTradeOutcome(trade.id, "SL"), "No se pudo marcar SL.")}>
              <Text style={[s.btnText, { color: colors.bear }]}>Tocó SL</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btn} onPress={() => setClosing(trade)}>
              <Text style={s.btnText}>Cerrar</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={s.btn} onPress={() => run(() => reopenTradeById(trade.id), "No se pudo reabrir.")}>
            <Text style={s.btnText}>Reabrir</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.btn} onPress={confirmDelete}>
          <Text style={[s.btnText, { color: colors.bear }]}>Borrar</Text>
        </TouchableOpacity>
      </View>
      <CloseModal trade={closing} onClose={() => setClosing(null)} />
    </View>
  );
}

function Level({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.levelLabel} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
      <Text style={[s.levelValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 24 }}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}


const s = StyleSheet.create({
  tileRow: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, minHeight: 68 },
  tileLabel: { color: colors.fog, fontSize: 9, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  tileValue: { color: colors.snow, fontSize: 17, fontWeight: "800", marginTop: 4 },
  tileSub: { color: colors.dim, fontSize: 10, marginTop: 2 },
  section: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, marginBottom: 16 },
  sectionTitle: { color: colors.fog, fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 10 },
  monthRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  monthLabel: { flex: 1.4, color: colors.snow, fontWeight: "600", fontSize: 12.5 },
  monthCell: { flex: 1, color: colors.fog, fontSize: 12, textAlign: "right" },
  monthR: { flex: 1, fontWeight: "800", fontSize: 12.5, textAlign: "right" },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  symbol: { color: colors.snow, fontWeight: "800", fontSize: 16 },
  badge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  status: { marginLeft: "auto", fontWeight: "800", fontSize: 12 },
  levels: { flexDirection: "row", gap: 8, marginTop: 12 },
  levelLabel: { color: colors.dim, fontSize: 8.5, fontWeight: "700", letterSpacing: 0.8 },
  levelValue: { color: colors.snow, fontSize: 13.5, fontWeight: "700", marginTop: 2 },
  date: { color: colors.dim, fontSize: 11, marginTop: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  btn: { borderWidth: 1, borderColor: colors.line2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: "center" },
  btnText: { color: colors.fog, fontSize: 12, fontWeight: "700" },
  btnBull: { borderColor: "rgba(22,217,138,.4)", backgroundColor: "rgba(22,217,138,.1)" },
  btnBear: { borderColor: "rgba(255,77,103,.4)", backgroundColor: "rgba(255,77,103,.1)" },
  btnGold: { backgroundColor: colors.gold, borderColor: colors.gold },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.65)", justifyContent: "center", padding: 24 },
  modal: { backgroundColor: colors.panel, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 18 },
  modalTitle: { color: colors.snow, fontWeight: "800", fontSize: 15, marginBottom: 10 },
  input: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, color: colors.snow, fontSize: 15, marginTop: 6 },
  emptyTitle: { color: colors.snow, fontWeight: "800", fontSize: 16, letterSpacing: 1, textAlign: "center" },
  emptyText: { color: colors.fog, fontSize: 12, textAlign: "center", marginTop: 8, lineHeight: 18 },
});

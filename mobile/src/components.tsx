import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { MAX_TAGS, PRESET_TAGS, cleanTags, computeStats, equitySeries, tagStats, fmtDateTime, fmtPct, fmtPrice, fmtR, monthlySummary, resultR, rrOf } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { closeTradeManually, deleteTradeById, markTradeOutcome, reopenTradeById, updateTradeNotes } from "./tradesApi";
import { AreaChart, RangeBar, timeAgo } from "./ui";
import { COMMUNITY_URL, openLink } from "./legal";
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
  const curve = useMemo(() => [0, ...equitySeries(trades).slice(-40).map((p) => p.cum)], [trades]);
  const accent = st.netR > 0 ? colors.bull : st.netR < 0 ? colors.bear : colors.fog;
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <View style={[s.hero, { borderColor: st.netR === 0 ? colors.line : accent + "55" }]}>
        <LinearGradient
          colors={[accent + "26", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={s.heroLabel}>RESULTADO NETO</Text>
        <Text style={[s.heroValue, { color: accent, textShadowColor: accent + "aa" }]}>{fmtR(st.netR)}R</Text>
        <Text style={s.tileSub}>
          {st.cerradas} cerradas · {st.abiertas} abiertas · {st.ganadas}G / {st.perdidas}P
        </Text>
        <View style={{ marginTop: 10 }}>
          <AreaChart values={curve} color={accent === colors.fog ? colors.cyan : accent} />
        </View>
      </View>
      <View style={s.tileRow}>
        <StatTile label="Acierto" value={st.cerradas ? fmtPct(st.winRate) : "—"} color={st.cerradas ? (st.winRate >= 50 ? colors.bull : colors.bear) : colors.fog} />
        <StatTile label="Profit factor" value={!st.cerradas ? "—" : st.pf == null ? "∞" : st.pf.toFixed(2)} color={st.pf == null || (st.pf ?? 0) >= 1 ? colors.gold : colors.bear} />
        <StatTile label="R promedio" value={st.cerradas ? `${fmtR(st.avgR)}R` : "—"} color={rColor(st.avgR)} />
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

export function TagList({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => tagStats(trades), [trades]);
  if (!rows.length) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>RESULTADO POR ETIQUETA</Text>
      {rows.map((r) => (
        <View key={r.tag} style={s.monthRow}>
          <Text style={[s.monthLabel, { flex: 1.6 }]} numberOfLines={1}>
            {r.tag}
          </Text>
          <Text style={s.monthCell}>{r.ops} ops</Text>
          <Text style={s.monthCell}>{Math.round(r.winRate)}%</Text>
          <Text style={[s.monthR, { color: rColor(r.netR) }]}>{fmtR(r.netR)}R</Text>
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

function NotesModal({ trade, onClose }: { trade: Trade | null; onClose: () => void }) {
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (trade) {
      setNotes(trade.notes ?? "");
      setTags(trade.tags ?? []);
      setCustom("");
    }
  }, [trade]);

  const has = (tag: string) => tags.some((x) => x.toLowerCase() === tag.toLowerCase());
  const toggle = (tag: string) =>
    setTags((cur) => (has(tag) ? cur.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : cleanTags([...cur, tag])));
  const addCustom = () => {
    if (custom.trim()) setTags((cur) => cleanTags([...cur, custom]));
    setCustom("");
  };
  const customTags = tags.filter((x) => !PRESET_TAGS.some((g) => g.tags.includes(x)));

  const save = async () => {
    if (!trade) return;
    try {
      await updateTradeNotes(trade.id, notes, tags);
      onClose();
    } catch (err) {
      fail(err, "No se pudieron guardar las notas.");
    }
  };

  return (
    <Modal visible={!!trade} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[s.modalBg, { justifyContent: "flex-end", padding: 0 }]}>
        <View style={[s.modal, { maxHeight: "92%", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>Notas y etiquetas · {trade?.symbol}</Text>
            <Text style={s.tileSub}>¿Qué pasó en esta operación?</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={600}
              placeholder="Por qué entraste, cómo te sentiste, qué aprendiste…"
              placeholderTextColor={colors.dim}
              style={[s.input, { minHeight: 90, textAlignVertical: "top" }]}
            />
            {PRESET_TAGS.map((g) => (
              <View key={g.group} style={{ marginTop: 12 }}>
                <Text style={s.tagGroup}>{g.group.toUpperCase()}</Text>
                <View style={s.tagWrap}>
                  {g.tags.map((tag) => (
                    <TouchableOpacity key={tag} style={[s.tagChip, has(tag) && s.tagChipOn]} onPress={() => toggle(tag)}>
                      <Text style={[s.tagChipText, has(tag) && { color: colors.ink }]}>{tag}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            <Text style={[s.tagGroup, { marginTop: 12 }]}>ETIQUETA PROPIA</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={custom}
                onChangeText={setCustom}
                onSubmitEditing={addCustom}
                maxLength={24}
                placeholder="Ej: Apertura de Nueva York"
                placeholderTextColor={colors.dim}
                style={[s.input, { flex: 1 }]}
              />
              <TouchableOpacity style={s.btn} onPress={addCustom}>
                <Text style={s.btnText}>Agregar</Text>
              </TouchableOpacity>
            </View>
            {customTags.length > 0 && (
              <View style={[s.tagWrap, { marginTop: 8 }]}>
                {customTags.map((tag) => (
                  <TouchableOpacity key={tag} style={[s.tagChip, s.tagChipOn]} onPress={() => toggle(tag)}>
                    <Text style={[s.tagChipText, { color: colors.ink }]}>{tag} ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={[s.tileSub, { marginTop: 8 }]}>
              {tags.length}/{MAX_TAGS} etiquetas
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnGold, { flex: 1 }]} onPress={save}>
              <Text style={[s.btnText, { color: colors.ink }]}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function TradeCard({ trade, onCalculate }: { trade: Trade; big?: boolean; onCalculate?: (t: Trade) => void }) {
  const [closing, setClosing] = useState<Trade | null>(null);
  const [editingNotes, setEditingNotes] = useState<Trade | null>(null);
  const abierta = trade.outcome === "ABIERTA";
  const r = resultR(trade);
  const long = trade.direction === "LONG";

  const run = (fn: () => Promise<void>, msg: string) => fn().catch((e) => fail(e, msg));
  const confirmDelete = () =>
    Alert.alert("Eliminar operación", `¿Borrar ${trade.symbol} del diario?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => run(() => deleteTradeById(trade.id), "No se pudo eliminar.") },
    ]);

  const accent = long ? colors.bull : colors.bear;
  const tap = (fn: () => void) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    fn();
  };

  return (
    <View style={[s.card, { borderColor: abierta ? accent + "55" : colors.line }]}>
      <View style={[s.stripe, { backgroundColor: abierta ? accent : colors.line2 }]} />
      <View style={{ flex: 1, padding: 14 }}>
        <View style={s.cardTop}>
          <View style={[s.arrow, { backgroundColor: accent + "22", borderColor: accent + "66" }]}>
            <Text style={[s.arrowText, { color: accent }]}>{long ? "▲" : "▼"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.symbol} numberOfLines={1}>
              {trade.symbol}
            </Text>
            <Text style={s.date}>
              {long ? "COMPRA" : "VENTA"} · {timeAgo(trade.date)}
            </Text>
          </View>
          <View style={[s.pill, { borderColor: abierta ? colors.gold + "88" : rColor(r ?? 0) + "88", backgroundColor: (abierta ? colors.gold : rColor(r ?? 0)) + "1a" }]}>
            {abierta && <View style={s.pillDot} />}
            <Text style={[s.pillText, { color: abierta ? colors.gold : rColor(r ?? 0) }]}>
              {abierta ? "ABIERTA" : `${trade.outcome === "MANUAL" ? "CIERRE" : trade.outcome} ${fmtR(r ?? 0)}R`}
            </Text>
          </View>
        </View>

        <RangeBar trade={trade} style={{ marginTop: 14 }} />

        <View style={s.levels}>
          <Level label="ENTRADA" value={fmtPrice(trade.entry)} />
          <Level label="TAKE PROFIT" value={fmtPrice(trade.tp)} color={colors.bull} />
          <Level label="STOP LOSS" value={fmtPrice(trade.sl)} color={colors.bear} />
          <Level label="R:R" value={`1:${rrOf(trade).toFixed(2)}`} color={colors.gold} />
        </View>
        {trade.exit != null && <Text style={s.date}>Salida {fmtPrice(trade.exit)}</Text>}
        {trade.autoClosed && <Text style={[s.date, { color: colors.cyan }]}>⚡ Cerrada automáticamente</Text>}
        {!!trade.tags?.length && (
          <View style={[s.tagWrap, { marginTop: 8 }]}>
            {trade.tags.map((tag) => (
              <View key={tag} style={s.tagMini}>
                <Text style={s.tagMiniText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
        {!!trade.notes && (
          <Text style={s.noteText} numberOfLines={3}>
            “{trade.notes}”
          </Text>
        )}

        <View style={s.actions}>
          {abierta ? (
            <>
              <TouchableOpacity style={[s.btn, s.btnBull]} onPress={tap(() => run(() => markTradeOutcome(trade.id, "TP"), "No se pudo marcar TP."))}>
                <Text style={[s.btnText, { color: colors.bull }]}>Tocó TP</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnBear]} onPress={tap(() => run(() => markTradeOutcome(trade.id, "SL"), "No se pudo marcar SL."))}>
                <Text style={[s.btnText, { color: colors.bear }]}>Tocó SL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={() => setClosing(trade)}>
                <Text style={s.btnText}>Cerrar</Text>
              </TouchableOpacity>
              {onCalculate && (
                <TouchableOpacity style={s.btn} onPress={() => onCalculate(trade)}>
                  <Text style={[s.btnText, { color: colors.gold }]}>Calcular</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <TouchableOpacity style={s.btn} onPress={() => run(() => reopenTradeById(trade.id), "No se pudo reabrir.")}>
              <Text style={s.btnText}>Reabrir</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.btn} onPress={() => setEditingNotes(trade)}>
            <Text style={s.btnText}>✎ Notas</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={confirmDelete}>
            <Text style={[s.btnText, { color: colors.bear }]}>Borrar</Text>
          </TouchableOpacity>
        </View>
      </View>
      <CloseModal trade={closing} onClose={() => setClosing(null)} />
      <NotesModal trade={editingNotes} onClose={() => setEditingNotes(null)} />
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

export function CommunityCard() {
  return (
    <TouchableOpacity style={s.community} onPress={() => openLink(COMMUNITY_URL)} activeOpacity={0.85}>
      <View style={s.communityIcon}>
        <Text style={s.communityIconText}>✈</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.communityTitle}>Comunidad de VELTRIX</Text>
        <Text style={s.communityText}>Sumate en Telegram: señales, ideas y otros traders.</Text>
      </View>
      <Text style={s.communityGo}>Unirme ›</Text>
    </TouchableOpacity>
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
  hero: { borderWidth: 1, borderRadius: 14, padding: 16, overflow: "hidden", backgroundColor: "rgba(16,23,32,0.85)" },
  heroLabel: { color: colors.fog, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  heroValue: { fontSize: 44, fontWeight: "900", marginTop: 2, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 },
  stripe: { width: 4 },
  arrow: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  arrowText: { fontSize: 16, fontWeight: "900" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold },
  pillText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  community: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.cyan + "66",
    backgroundColor: colors.cyan + "14",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  communityIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.cyan + "26", alignItems: "center", justifyContent: "center" },
  communityIconText: { color: colors.cyan, fontSize: 18 },
  communityTitle: { color: colors.snow, fontWeight: "800", fontSize: 13.5 },
  communityText: { color: colors.fog, fontSize: 11.5, marginTop: 2 },
  communityGo: { color: colors.cyan, fontWeight: "800", fontSize: 12 },
  tagGroup: { color: colors.dim, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2, marginBottom: 6 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagChip: { borderWidth: 1, borderColor: colors.line2, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  tagChipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  tagChipText: { color: colors.fog, fontSize: 12, fontWeight: "700" },
  tagMini: { borderWidth: 1, borderColor: colors.gold + "66", backgroundColor: colors.gold + "14", borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  tagMiniText: { color: colors.gold, fontSize: 10.5, fontWeight: "700" },
  noteText: { color: colors.fog, fontSize: 12, fontStyle: "italic", marginTop: 8, lineHeight: 17 },
  tileRow: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, backgroundColor: "rgba(16,23,32,0.85)", borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, minHeight: 68 },
  tileLabel: { color: colors.fog, fontSize: 9, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  tileValue: { color: colors.snow, fontSize: 17, fontWeight: "800", marginTop: 4 },
  tileSub: { color: colors.dim, fontSize: 10, marginTop: 2 },
  section: { backgroundColor: "rgba(16,23,32,0.85)", borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, marginBottom: 16 },
  sectionTitle: { color: colors.fog, fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 10 },
  monthRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  monthLabel: { flex: 1.4, color: colors.snow, fontWeight: "600", fontSize: 12.5 },
  monthCell: { flex: 1, color: colors.fog, fontSize: 12, textAlign: "right" },
  monthR: { flex: 1, fontWeight: "800", fontSize: 12.5, textAlign: "right" },
  card: { flexDirection: "row", backgroundColor: "rgba(16,23,32,0.9)", borderWidth: 1, borderRadius: 14, marginBottom: 10, overflow: "hidden" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  symbol: { color: colors.snow, fontWeight: "900", fontSize: 17, letterSpacing: 0.3 },
  badge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  status: { marginLeft: "auto", fontWeight: "800", fontSize: 12 },
  levels: { flexDirection: "row", gap: 8, marginTop: 12 },
  levelLabel: { color: colors.dim, fontSize: 8.5, fontWeight: "700", letterSpacing: 0.8 },
  levelValue: { color: colors.snow, fontSize: 13.5, fontWeight: "700", marginTop: 2 },
  date: { color: colors.dim, fontSize: 11, marginTop: 2, letterSpacing: 0.4 },
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

import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { BOT_ASSETS, MAX_TAGS, PRESET_TAGS, actionId, analyze, balanceInfo, confidenceLabel, filterBySource, strategyPlan, strategySources, exchangeName, fmtCurrency, cleanTags, computeStats, equitySeries, tagStats, fmtDateTime, fmtPct, fmtPrice, fmtR, monthlySummary, resultR, rrOf, signalShareMessage, whatsappShareUrl } from "@dmcripto/core";
import type { Confidence, DailyStatus, GroupRow, StrategyRule, Trade } from "@dmcripto/core";
import { closeTradeManually, deleteTradeById, markTradeOutcome, reopenTradeById, updateTradeNotes } from "./tradesApi";
import { AreaChart, RangeBar, timeAgo } from "./ui";
import { COMMUNITY_URL, openLink } from "./legal";
import { colors } from "./theme";
import { useBot } from "./botStore";
import { useMoney } from "./money";
import { t } from "@dmcripto/core";

const rColor = (r: number) => (r > 0 ? colors.bull : r < 0 ? colors.bear : colors.fog);

const fail = (err: unknown, fallback: string) =>
  Alert.alert(t("Error"), err instanceof Error ? err.message : fallback);

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
  const { money } = useMoney();
  const bal = useMemo(() => balanceInfo(trades, money), [trades, money]);
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <View style={[s.hero, { borderColor: st.netR === 0 ? colors.line : accent + "55" }]}>
        <LinearGradient
          colors={[accent + "26", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={s.heroLabel}>{t("RESULTADO NETO")}</Text>
        <Text style={[s.heroValue, { color: accent, textShadowColor: accent + "aa" }]}>{fmtR(st.netR)}R</Text>
        <Text style={s.tileSub}>
          {st.cerradas} {t("cerradas")} · {st.abiertas} {t("abiertas")} · {st.ganadas}G / {st.perdidas}P
        </Text>
        {bal && (
          <Text style={[s.heroMoney, { color: accent }]}>
            {fmtCurrency(bal.pnl, money.currency)} · balance {fmtCurrency(bal.balance, money.currency, false)}
            {bal.returnPct != null ? ` (${bal.returnPct >= 0 ? "+" : ""}${bal.returnPct.toFixed(1)}%)` : ""}
          </Text>
        )}
        <View style={{ marginTop: 10 }}>
          <AreaChart values={curve} color={accent === colors.fog ? colors.cyan : accent} />
        </View>
      </View>
      <View style={s.tileRow}>
        <StatTile label={t("Acierto")} value={st.cerradas ? fmtPct(st.winRate) : "—"} color={st.cerradas ? (st.winRate >= 50 ? colors.bull : colors.bear) : colors.fog} />
        <StatTile label={t("Profit factor")} value={!st.cerradas ? "—" : st.pf == null ? "∞" : st.pf.toFixed(2)} color={st.pf == null || (st.pf ?? 0) >= 1 ? colors.gold : colors.bear} />
        <StatTile label={t("R promedio")} value={st.cerradas ? `${fmtR(st.avgR)}R` : "—"} color={rColor(st.avgR)} />
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
      <Text style={s.sectionTitle}>{t("CURVA DE CAPITAL (R)")}</Text>
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
      <Text style={s.tileSub}>{t("Acumulado")}: {fmtR(pts[pts.length - 1].cum)}R {t("en")} {pts.length} {t("operaciones")}</Text>
    </View>
  );
}

export function MonthlyList({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => monthlySummary(trades), [trades]);
  const { money, unit } = useMoney();
  if (!rows.length) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{t("RESUMEN MENSUAL")}</Text>
      {rows.map((r) => (
        <View key={r.key} style={s.monthRow}>
          <Text style={[s.monthLabel, { textTransform: "capitalize" }]}>{r.label}</Text>
          <Text style={s.monthCell}>{r.ops} {t("ops")}</Text>
          <Text style={s.monthCell}>{r.cerradas ? `${Math.round(r.winRate)}%` : "—"}</Text>
          <View style={{ alignItems: "flex-end", minWidth: 74 }}>
            <Text style={[s.monthR, { color: rColor(r.netR), flex: 0 }]}>{r.cerradas ? `${fmtR(r.netR)}R` : "—"}</Text>
            {unit && r.cerradas ? (
              <Text style={[s.monthMoney, { color: rColor(r.netR) }]}>{fmtCurrency(r.netR * unit, money.currency)}</Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function LimitBanner({ status }: { status: DailyStatus }) {
  if (!status.messages.length) return null;
  const stop = status.level === "stop";
  const color = stop ? colors.bear : colors.gold;
  return (
    <View style={[s.limit, { borderColor: color + "88", backgroundColor: color + "18" }]}>
      <Text style={[s.limitTitle, { color }]}>{stop ? t("⛔ FRENÁ POR HOY") : t("⚠ CUIDADO CON TU LÍMITE DIARIO")}</Text>
      {status.messages.map((m) => (
        <Text key={m} style={s.limitText}>
          {m}
        </Text>
      ))}
    </View>
  );
}

type AView = "symbol" | "weekday" | "hour" | "direction";
const AVIEWS: Array<[AView, string]> = [
  ["symbol", "Activo"],
  ["weekday", "Día"],
  ["hour", "Hora"],
  ["direction", "Dirección"],
];

export function AnalysisBlock({ trades }: { trades: Trade[] }) {
  const a = useMemo(() => analyze(trades), [trades]);
  const [view, setView] = useState<AView>("symbol");
  if (a.closed < 2) return null;
  const rows: GroupRow[] = view === "symbol" ? a.bySymbol : view === "weekday" ? a.byWeekday : view === "hour" ? a.byHour : a.byDirection;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.netR)));
  const cur = a.streaks.current;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{t("ANÁLISIS")}</Text>
      <View style={s.tileRow}>
        <StatTile label={t("Mejor racha")} value={String(a.streaks.maxWin)} color={colors.bull} />
        <StatTile label={t("Peor racha")} value={String(a.streaks.maxLoss)} color={colors.bear} />
        <StatTile label={t("Racha actual")} value={String(cur.count)} color={cur.type === "win" ? colors.bull : cur.type === "loss" ? colors.bear : colors.fog} sub={cur.type === "win" ? t("ganadas") : cur.type === "loss" ? t("perdidas") : ""} />
      </View>
      {a.insights.length > 0 && (
        <View style={s.insights}>
          {a.insights.map((i) => (
            <Text key={i} style={s.insightText}>
              💡 {i}
            </Text>
          ))}
        </View>
      )}
      <View style={s.segment}>
        {AVIEWS.map(([key, label]) => (
          <TouchableOpacity key={key} style={[s.segBtn, view === key && s.segBtnOn]} onPress={() => setView(key)}>
            <Text style={[s.segText, view === key && { color: colors.ink }]}>{t(label)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.key} style={s.barRow}>
          <Text style={s.barLabel} numberOfLines={1}>
            {r.label}
          </Text>
          <View style={s.barTrack}>
            {r.ops > 0 && (
              <View style={{ width: `${Math.max(4, (Math.abs(r.netR) / max) * 100)}%`, height: "100%", borderRadius: 4, backgroundColor: r.netR >= 0 ? colors.bull : colors.bear }} />
            )}
          </View>
          <Text style={[s.barValue, { color: r.ops ? rColor(r.netR) : colors.dim }]}>{r.ops ? `${fmtR(r.netR)}R` : "—"}</Text>
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
      <Text style={s.sectionTitle}>{t("RESULTADO POR ETIQUETA")}</Text>
      {rows.map((r) => (
        <View key={r.tag} style={s.monthRow}>
          <Text style={[s.monthLabel, { flex: 1.6 }]} numberOfLines={1}>
            {t(r.tag)}
          </Text>
          <Text style={s.monthCell}>{r.ops} {t("ops")}</Text>
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
    if (!Number.isFinite(exit) || exit <= 0) return Alert.alert(t("Precio inválido"), t("Ingresá un precio de salida válido."));
    try {
      await closeTradeManually(trade.id, exit);
      setValue("");
      onClose();
    } catch (err) {
      fail(err, t("No se pudo cerrar la operación."));
    }
  };
  return (
    <Modal visible={!!trade} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalBg}>
        <View style={s.modal}>
          <Text style={s.modalTitle}>{t("Cerrar")} {trade?.symbol} {t("a mercado")}</Text>
          <Text style={s.tileSub}>{t("Precio de salida")}</Text>
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
              <Text style={s.btnText}>{t("Cancelar")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnGold, { flex: 1 }]} onPress={submit}>
              <Text style={[s.btnText, { color: colors.ink }]}>{t("Cerrar")}</Text>
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
      fail(err, t("No se pudieron guardar las notas."));
    }
  };

  return (
    <Modal visible={!!trade} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[s.modalBg, { justifyContent: "flex-end", padding: 0 }]}>
        <View style={[s.modal, { maxHeight: "92%", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>{t("Notas y etiquetas")} · {trade?.symbol}</Text>
            <Text style={s.tileSub}>{t("¿Qué pasó en esta operación?")}</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={600}
              placeholder={t("Por qué entraste, cómo te sentiste, qué aprendiste…")}
              placeholderTextColor={colors.dim}
              style={[s.input, { minHeight: 90, textAlignVertical: "top" }]}
            />
            {PRESET_TAGS.map((g) => (
              <View key={g.group} style={{ marginTop: 12 }}>
                <Text style={s.tagGroup}>{t(g.group).toUpperCase()}</Text>
                <View style={s.tagWrap}>
                  {g.tags.map((tag) => (
                    <TouchableOpacity key={tag} style={[s.tagChip, has(tag) && s.tagChipOn]} onPress={() => toggle(tag)}>
                      <Text style={[s.tagChipText, has(tag) && { color: colors.ink }]}>{t(tag)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            <Text style={[s.tagGroup, { marginTop: 12 }]}>{t("ETIQUETA PROPIA")}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={custom}
                onChangeText={setCustom}
                onSubmitEditing={addCustom}
                maxLength={24}
                placeholder={t("Ej: Apertura de Nueva York")}
                placeholderTextColor={colors.dim}
                style={[s.input, { flex: 1 }]}
              />
              <TouchableOpacity style={s.btn} onPress={addCustom}>
                <Text style={s.btnText}>{t("Agregar")}</Text>
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
              {tags.length}/{MAX_TAGS} {t("etiquetas")}
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnText}>{t("Cancelar")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnGold, { flex: 1 }]} onPress={save}>
              <Text style={[s.btnText, { color: colors.ink }]}>{t("Guardar")}</Text>
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
  const abierta = trade.outcome === t("ABIERTA");
  const r = resultR(trade);
  const long = trade.direction === "LONG";
  const { money, unit } = useMoney();

  const run = (fn: () => Promise<void>, msg: string) => fn().catch((e) => fail(e, msg));
  const confirmDelete = () =>
    Alert.alert(t("Eliminar operación"), t("¿Borrar {sym} del diario?", { sym: trade.symbol }), [
      { text: t("Cancelar"), style: "cancel" },
      { text: t("Borrar"), style: "destructive", onPress: () => run(() => deleteTradeById(trade.id), t("No se pudo eliminar.")) },
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
              {long ? t("COMPRA") : t("VENTA")} · {timeAgo(trade.date)}{trade.source ? ` · ⇄ ${exchangeName(trade.source)}` : ""}
            </Text>
          </View>
          <View style={[s.pill, { borderColor: abierta ? colors.gold + "88" : rColor(r ?? 0) + "88", backgroundColor: (abierta ? colors.gold : rColor(r ?? 0)) + "1a" }]}>
            {abierta && <View style={s.pillDot} />}
            <Text style={[s.pillText, { color: abierta ? colors.gold : rColor(r ?? 0) }]}>
              {abierta
                ? t("ABIERTA")
                : `${trade.outcome === "MANUAL" ? t("CIERRE") : trade.outcome} ${fmtR(r ?? 0)}R${unit ? ` · ${fmtCurrency((r ?? 0) * unit, money.currency)}` : ""}`}
            </Text>
          </View>
        </View>

        <RangeBar trade={trade} style={{ marginTop: 14 }} />

        <View style={s.levels}>
          <Level label={t("ENTRADA")} value={fmtPrice(trade.entry)} />
          <Level label={t("TAKE PROFIT")} value={fmtPrice(trade.tp)} color={colors.bull} />
          <Level label={t("STOP LOSS")} value={fmtPrice(trade.sl)} color={colors.bear} />
          <Level label="R:R" value={`1:${rrOf(trade).toFixed(2)}`} color={colors.gold} />
        </View>
        {!!trade.targets?.length && <Text style={[s.date, { color: colors.bull }]}>{trade.targets.map((n, i) => `T${i + 1} ${fmtPrice(n)}`).join(" · ")}</Text>}
        {trade.exit != null && <Text style={s.date}>{t("Salida")} {fmtPrice(trade.exit)}</Text>}
        {trade.autoClosed && <Text style={[s.date, { color: colors.cyan }]}>{t("⚡ Cerrada automáticamente")}</Text>}
        {!!trade.tags?.length && (
          <View style={[s.tagWrap, { marginTop: 8 }]}>
            {trade.tags.map((tag) => (
              <View key={tag} style={s.tagMini}>
                <Text style={s.tagMiniText}>{t(tag)}</Text>
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
              <TouchableOpacity style={[s.btn, s.btnBull]} onPress={tap(() => run(() => markTradeOutcome(trade.id, "TP"), t("No se pudo marcar TP.")))}>
                <Text style={[s.btnText, { color: colors.bull }]}>{t("Tocó TP")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnBear]} onPress={tap(() => run(() => markTradeOutcome(trade.id, "SL"), t("No se pudo marcar SL.")))}>
                <Text style={[s.btnText, { color: colors.bear }]}>{t("Tocó SL")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={() => setClosing(trade)}>
                <Text style={s.btnText}>{t("Cerrar")}</Text>
              </TouchableOpacity>
              {onCalculate && (
                <TouchableOpacity style={s.btn} onPress={() => onCalculate(trade)}>
                  <Text style={[s.btnText, { color: colors.gold }]}>{t("Calcular")}</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <TouchableOpacity style={s.btn} onPress={() => run(() => reopenTradeById(trade.id), t("No se pudo reabrir."))}>
              <Text style={s.btnText}>{t("Reabrir")}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.btn} onPress={() => openLink(whatsappShareUrl(signalShareMessage(trade)))} accessibilityLabel={t("Enviar esta señal por WhatsApp")}>
            <Text style={[s.btnText, { color: colors.bull }]}>WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={() => setEditingNotes(trade)}>
            <Text style={s.btnText}>{"✎ "}{t("Notas")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={confirmDelete}>
            <Text style={[s.btnText, { color: colors.bear }]}>{t("Borrar")}</Text>
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
        <Text style={s.communityTitle}>{t("Comunidad de VELTRIX")}</Text>
        <Text style={s.communityText}>{t("Sumate en Telegram: señales, ideas y otros traders.")}</Text>
      </View>
      <Text style={s.communityGo}>{t("Unirme ›")}</Text>
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


const RULE_ICON: Record<StrategyRule["kind"], string> = { avoid: "🚫", focus: "🎯", risk: "🛡️", habit: "🧭" };
const CONF_COLOR: Record<Confidence, string> = { high: colors.bull, medium: colors.gold, low: colors.dim };

/** Estrategia sugerida: reglas armadas con las operaciones cerradas (incluidas las del exchange). */
export function StrategyBlock({ trades }: { trades: Trade[] }) {
  const { money } = useMoney();
  const bot = useBot();
  const canApply = bot.status === "ready" && bot.rulesSupported;
  const sources = useMemo(() => strategySources(trades), [trades]);
  const [picked, setPicked] = useState("all");
  const source = sources.some((x) => x.id === picked) ? picked : "all";
  const use = useMemo(() => filterBySource(trades, source), [trades, source]);
  const plan = useMemo(() => strategyPlan(use, { riskPct: money.riskPct, source }), [use, money.riskPct, source]);
  const nameOf = (id: string) => (id === "manual" ? t("A mano y señales") : exchangeName(id as never));
  const tone = !plan.ok ? colors.line : plan.edge === "likely" ? colors.bull : plan.edge === "unproven" || plan.lowSample ? colors.gold : colors.bear;
  const fmtBest = (n: number) => `${fmtR(n)}R`;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{t("ESTRATEGIA SUGERIDA")}</Text>
      <Text style={st.sub}>{t("Reglas armadas con tus propias operaciones")}</Text>
      {sources.some((x) => x.id !== "manual") && (
        <>
          <Text style={st.head}>{t("Ver la estrategia de")}</Text>
          <View style={st.pickRow}>
            {[{ id: "all", label: t("Todas") }, ...sources.map((x) => ({ id: x.id, label: `${nameOf(x.id)} · ${x.count}` }))].map((o) => (
              <TouchableOpacity key={o.id} style={[st.pick, source === o.id && st.pickOn]} onPress={() => setPicked(o.id)}>
                <Text style={[st.pickText, source === o.id && { color: colors.ink }]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
      {!plan.ok ? (
        <Text style={st.note}>{t("Para sugerirte una estrategia necesito al menos {n} operaciones cerradas (tenés {have}). Conectá tu exchange o seguí registrando y volvé.", { n: plan.needed, have: plan.have })}</Text>
      ) : (
        <>
          <View style={[st.headline, { borderColor: tone + "66", backgroundColor: tone + "18" }]}>
            <Text style={st.headlineText}>{plan.headline}</Text>
          </View>
          <View style={s.tileRow}>
            <StatTile label={t("Acierto")} value={`${Math.round(plan.profile.winRate)}%`} />
            <StatTile label={t("Ganancia / pérdida")} value={plan.profile.payoff ? plan.profile.payoff.toFixed(1) : "—"} />
            <StatTile label={t("Promedio por operación")} value={fmtBest(plan.profile.expectancy)} color={rColor(plan.profile.expectancy)} />
          </View>
          <View style={s.tileRow}>
            <StatTile label={t("Factor de beneficio")} value={plan.profile.profitFactor == null ? "∞" : plan.profile.profitFactor.toFixed(2)} />
            <StatTile label={t("Peor caída")} value={`${plan.profile.maxDrawdownR.toFixed(1).replace(/\.0$/, "")}R`} color={colors.bear} />
          </View>
          <Text style={st.note}>
            {t("Tu estilo")}: {plan.style}
          </Text>
          <Text style={st.head}>{t("Tu plan sugerido")}</Text>
          {plan.rules.length === 0 ? (
            <Text style={st.note}>{t("Todavía no encuentro patrones claros. Seguí registrando: con más operaciones aparecen.")}</Text>
          ) : (
            plan.rules.map((r) => {
              const notBot = !!r.action && "dim" in r.action && r.action.dim === "symbol" && !(BOT_ASSETS as readonly string[]).includes(r.action.key);
              const applied = !!r.action && bot.store.isApplied(actionId(r.action));
              const oops = (e: unknown) => Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
              return (
              <View key={r.id} style={st.rule}>
                <View style={st.ruleTop}>
                  <Text style={st.ruleTitle}>
                    {RULE_ICON[r.kind]} {r.title}
                  </Text>
                  <Text style={[st.badge, { color: CONF_COLOR[r.confidence], borderColor: CONF_COLOR[r.confidence] + "88" }]}>{confidenceLabel(r.confidence)}</Text>
                </View>
                <Text style={st.ruleWhy}>{r.why}</Text>
                {canApply && r.action && (
                  <View style={st.botRow}>
                    <Text style={[st.small, { flex: 1, marginTop: 0 }]}>🤖 {notBot ? t("El bot no opera este activo.") : r.effect}</Text>
                    {notBot ? null : applied ? (
                      <TouchableOpacity style={[st.apply, { borderColor: colors.bull + "88", backgroundColor: colors.bull + "18" }]} onPress={() => bot.store.remove(actionId(r.action!)).catch(oops)}>
                        <Text style={[st.applyText, { color: colors.bull }]}>✓ {t("Aplicada")} · {t("Quitar")}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={[st.apply, { backgroundColor: colors.gold, borderColor: colors.gold }]} onPress={() => bot.store.apply(r.action!).catch(oops)}>
                        <Text style={[st.applyText, { color: colors.ink }]}>{t("Aplicar al bot")}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
              );
            })
          )}
          {canApply && plan.rules.some((r) => r.action) && (
            <Text style={st.small}>
              {bot.settings.enabled ? t("Las reglas que apliques las usa el bot desde la próxima señal.") : t("El bot está apagado: las reglas se guardan y las usa cuando lo enciendas, en Conexiones → Bot automático.")}{" "}
              {t("Salen de tus operaciones, pero el bot usa su propia estrategia: probalas en modo simulado antes de confiar en ellas.")}
            </Text>
          )}
          {plan.after && (
            <View style={st.rule}>
              <Text style={st.head}>{t("¿Y si hubieras evitado eso?")}</Text>
              <Text style={st.ruleWhy}>{t("Habrías hecho {a} operaciones menos y tu resultado pasaba de {b} a {c}.", { a: plan.avoidedTrades, b: fmtBest(plan.before.netR), c: fmtBest(plan.after.netR) })}</Text>
              <Text style={st.small}>{t("Es una cuenta sobre lo que ya pasó: siempre sale mejor de lo que va a salir. Mirá el control de abajo.")}</Text>
            </View>
          )}
          {plan.validation && (
            <View style={[st.headline, { borderColor: (plan.validation.held ? colors.bull : colors.bear) + "66", backgroundColor: (plan.validation.held ? colors.bull : colors.bear) + "18" }]}>
              <Text style={st.headlineText}>
                {plan.validation.held
                  ? t("Control: armé las reglas con tus {a} operaciones más viejas y las probé en las {b} más nuevas. Lo que evitarías sumó {r}: la regla se sostuvo.", { a: plan.validation.trainN, b: plan.validation.testN, r: fmtBest(plan.validation.avoidedR) })
                  : t("Control: armé las reglas con tus {a} operaciones más viejas y las probé en las {b} más nuevas. Lo que evitarías sumó {r}: la regla no se sostuvo, tomala con cuidado.", { a: plan.validation.trainN, b: plan.validation.testN, r: fmtBest(plan.validation.avoidedR) })}
              </Text>
            </View>
          )}
          <View style={s.insights}>
            <Text style={st.head}>{t("Cómo probarlo")}</Text>
            <Text style={s.insightText}>1. {t("Elegí 2 o 3 reglas, no todas juntas.")}</Text>
            <Text style={s.insightText}>2. {t("Seguilas durante las próximas 20 operaciones, en demo o con el riesgo mínimo.")}</Text>
            <Text style={s.insightText}>3. {t("Volvé acá: si tu promedio por operación mejoró, mantenelas; si no, descartalas.")}</Text>
          </View>
          <Text style={st.small}>{t("Son patrones de tu historial, no una garantía. Con pocas operaciones pueden ser casualidad, por eso cada regla trae su nivel de confianza. No es asesoramiento financiero.")}</Text>
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  pickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  pick: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  pickOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  pickText: { color: colors.fog, fontSize: 11.5, fontWeight: "800" },
  sub: { color: colors.dim, fontSize: 11, marginBottom: 8 },
  note: { color: colors.fog, fontSize: 12, lineHeight: 17, marginTop: 8 },
  small: { color: colors.dim, fontSize: 10.5, lineHeight: 15, marginTop: 6 },
  head: { color: colors.gold, fontSize: 10, fontWeight: "800", letterSpacing: 1.6, marginTop: 12, marginBottom: 4 },
  headline: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 10 },
  headlineText: { color: colors.snow, fontSize: 12.5, lineHeight: 18 },
  rule: { backgroundColor: "rgba(16,23,32,0.85)", borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginTop: 8 },
  ruleTop: { flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "flex-start" },
  ruleTitle: { color: colors.snow, fontSize: 13, fontWeight: "700", flex: 1, lineHeight: 18 },
  ruleWhy: { color: colors.fog, fontSize: 12, lineHeight: 17, marginTop: 4 },
  botRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8, paddingTop: 8 },
  apply: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  applyText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  badge: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, textTransform: "uppercase" },
});

const s = StyleSheet.create({
  hero: { borderWidth: 1, borderRadius: 14, padding: 16, overflow: "hidden", backgroundColor: "rgba(16,23,32,0.85)" },
  heroLabel: { color: colors.fog, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  heroMoney: { fontSize: 13, fontWeight: "800", marginTop: 6 },
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
  limit: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, gap: 4 },
  limitTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  limitText: { color: colors.snow, fontSize: 12.5, lineHeight: 18 },
  insights: { backgroundColor: colors.gold + "12", borderWidth: 1, borderColor: colors.gold + "44", borderRadius: 10, padding: 10, gap: 6, marginTop: 10 },
  insightText: { color: colors.fog, fontSize: 12, lineHeight: 17 },
  segment: { flexDirection: "row", backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 3, marginTop: 12, marginBottom: 8 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center" },
  segBtnOn: { backgroundColor: colors.gold },
  segText: { color: colors.fog, fontSize: 11, fontWeight: "800" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  barLabel: { color: colors.snow, fontSize: 12, fontWeight: "700", width: 84 },
  barTrack: { flex: 1, height: 9, backgroundColor: colors.ink, borderRadius: 4, overflow: "hidden" },
  barValue: { width: 52, textAlign: "right", fontWeight: "800", fontSize: 12 },
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
  monthMoney: { fontSize: 10.5, fontWeight: "700", opacity: 0.85 },
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

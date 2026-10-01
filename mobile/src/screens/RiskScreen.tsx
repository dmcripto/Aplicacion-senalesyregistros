import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { calcPosition, fmtMoney, fmtPrice, fmtQty } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { colors } from "../theme";
import LiquidationMapView from "../LiquidationMapView";
import { useMoney } from "../money";
import { t } from "@dmcripto/core";

const STORE_KEY = "veltrix_risk_settings_v1";

const baseOf = (symbol: string) => {
  const s = symbol.toUpperCase().replace(/^.*:/, "").replace(/\.P$|PERP$/, "");
  return s.replace(/(USDT|USDC|BUSD|USD)$/, "") || s;
};

export default function RiskScreen({ prefill, onPrefillUsed }: { prefill: Trade | null; onPrefillUsed: () => void }) {
  const [capital, setCapital] = useState("");
  const [riskPct, setRiskPct] = useState("1");
  const [leverage, setLeverage] = useState("");
  const [fee, setFee] = useState("");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [symbol, setSymbol] = useState("");
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"calc" | "map">("calc");
  const { money } = useMoney();

  // Si configuraste tu capital en Ajustes, la calculadora lo usa de base.
  useEffect(() => {
    if (money.capital != null) setCapital(String(money.capital));
    if (money.riskPct != null) setRiskPct(String(money.riskPct));
  }, [money.capital, money.riskPct]);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((v) => {
        if (!v) return;
        const s = JSON.parse(v) as { capital?: string; riskPct?: string; leverage?: string; fee?: string };
        if (s.capital) setCapital(s.capital);
        if (s.riskPct) setRiskPct(s.riskPct);
        if (s.leverage != null) setLeverage(s.leverage);
        if (s.fee != null) setFee(s.fee);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ capital, riskPct, leverage, fee })).catch(() => {});
  }, [capital, riskPct, leverage, fee]);

  useEffect(() => {
    if (!prefill) return;
    setEntry(String(prefill.entry));
    setSl(String(prefill.sl));
    setTp(String(prefill.tp));
    setSymbol(prefill.symbol);
    onPrefillUsed();
  }, [prefill, onPrefillUsed]);

  const n = (v: string) => Number(v.replace(",", "."));
  const res = useMemo(
    () =>
      calcPosition({
        capital: n(capital),
        riskPct: n(riskPct),
        entry: n(entry),
        sl: n(sl),
        tp: tp.trim() ? n(tp) : undefined,
        leverage: leverage.trim() ? n(leverage) : undefined,
        feePct: fee.trim() ? n(fee) : undefined,
      }),
    [capital, riskPct, entry, sl, tp, leverage, fee],
  );

  const unit = symbol ? baseOf(symbol) : "unidades";
  const copy = async () => {
    if (!res) return;
    await Clipboard.setStringAsync(String(Number(res.units.toPrecision(6))));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, flex = 1) => (
    <View style={{ flex }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        style={s.input}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.segment}>
          {(["calc", "map"] as const).map((v) => (
            <TouchableOpacity key={v} style={[s.segBtn, view === v && s.segBtnOn]} onPress={() => setView(v)}>
              <Text style={[s.segText, view === v && { color: colors.ink }]}>{v === "calc" ? t("Calculadora") : t("Mapa de liquidaciones")}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {view === "map" ? (
          <LiquidationMapView />
        ) : (
          <>
        <Text style={s.title}>{t("CALCULADORA DE RIESGO")}</Text>
        <Text style={s.sub}>{t("Cuánto operar para no perder más de lo que decidiste.")}</Text>

        <View style={s.card}>
          <Text style={s.section}>{t("TU CUENTA")}</Text>
          <View style={s.row}>
            {field(t("CAPITAL ($)"), capital, setCapital, "1000")}
            {field(t("RIESGO (%)"), riskPct, setRiskPct, "1")}
          </View>
          <View style={s.row}>
            {field(t("APALANCAMIENTO (x)"), leverage, setLeverage, t("opcional"))}
            {field(t("COMISIÓN (%)"), fee, setFee, t("opcional"))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.section}>{t("LA OPERACIÓN")}{symbol ? ` · ${symbol}` : ""}</Text>
          <View style={s.row}>
            {field(t("ENTRADA"), entry, setEntry, "65000")}
            {field(t("STOP LOSS"), sl, setSl, "64350")}
            {field(t("TAKE PROFIT"), tp, setTp, t("opcional"))}
          </View>
        </View>

        {res ? (
          <View style={[s.card, s.result]}>
            <Text style={s.section}>{t("RESULTADO")} · {res.direction === "LONG" ? t("COMPRA") : t("VENTA")}</Text>
            <Text style={s.bigLabel}>{t("CANTIDAD A OPERAR")}</Text>
            <Text style={s.big}>
              {fmtQty(res.units)} <Text style={s.bigUnit}>{unit}</Text>
            </Text>
            <TouchableOpacity style={s.copyBtn} onPress={copy}>
              <Text style={s.copyText}>{copied ? t("¡Copiado!") : t("Copiar cantidad")}</Text>
            </TouchableOpacity>

            <View style={s.grid}>
              <Item label={t("Arriesgás")} value={fmtMoney(res.riskAmount)} color={colors.bear} />
              <Item label={t("Valor de la posición")} value={fmtMoney(res.notional)} />
              {res.margin != null && <Item label={t("Margen necesario")} value={fmtMoney(res.margin)} />}
              <Item label={t("Distancia al stop")} value={`${res.stopPct.toFixed(2)} % (${fmtPrice(res.stopDistance)})`} />
              {res.fees > 0 && <Item label={t("Comisiones estimadas")} value={fmtMoney(res.fees)} />}
              {res.profitAtTp != null && <Item label={t("Ganás si toca el TP")} value={fmtMoney(res.profitAtTp)} color={colors.bull} />}
              {res.rr != null && <Item label={t("Riesgo : beneficio")} value={`1 : ${res.rr.toFixed(2)}`} color={colors.gold} />}
            </View>

            {res.warnings.map((w) => (
              <View key={w} style={s.warn}>
                <Text style={s.warnText}>⚠ {w}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.hint}>{t("Completá capital, riesgo, entrada y stop loss para ver cuánto operar.")}</Text>
        )}

        <Text style={s.disclaimer}>{t("Cálculo orientativo. Verificá siempre los valores en tu plataforma antes de operar.")}</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Item({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.item}>
      <Text style={s.itemLabel}>{label}</Text>
      <Text style={[s.itemValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  segment: { flexDirection: "row", backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 3, marginBottom: 14 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  segBtnOn: { backgroundColor: colors.gold },
  segText: { color: colors.fog, fontWeight: "800", fontSize: 11.5 },
  title: { color: colors.snow, fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  sub: { color: colors.fog, fontSize: 12.5, marginTop: 4, marginBottom: 14 },
  card: { backgroundColor: "rgba(16,23,32,0.9)", borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, marginBottom: 12, gap: 10 },
  result: { borderColor: colors.gold + "66" },
  section: { color: colors.fog, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  row: { flexDirection: "row", gap: 8 },
  label: { color: colors.fog, fontSize: 9, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },
  input: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: colors.snow, fontSize: 14 },
  bigLabel: { color: colors.dim, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  big: { color: colors.gold, fontSize: 32, fontWeight: "900" },
  bigUnit: { color: colors.fog, fontSize: 16, fontWeight: "700" },
  copyBtn: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.line2, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  copyText: { color: colors.fog, fontSize: 12, fontWeight: "700" },
  grid: { gap: 8, marginTop: 4 },
  item: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  itemLabel: { color: colors.fog, fontSize: 12.5 },
  itemValue: { color: colors.snow, fontSize: 13.5, fontWeight: "800" },
  warn: { backgroundColor: colors.bear + "1a", borderColor: colors.bear + "55", borderWidth: 1, borderRadius: 8, padding: 10 },
  warnText: { color: colors.bear, fontSize: 12, lineHeight: 17 },
  hint: { color: colors.dim, fontSize: 12.5, textAlign: "center", marginVertical: 16 },
  disclaimer: { color: colors.dim, fontSize: 10.5, textAlign: "center", marginTop: 8 },
});

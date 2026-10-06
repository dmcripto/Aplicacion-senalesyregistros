import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { exampleAlert, fmtPrice, parseAlerts, rrOf, sampleTrades } from "@dmcripto/core";
import type { DailyStatus, Direction, NewTrade, ParseResult, Trade } from "@dmcripto/core";
import { insertFullTrades, insertTrades } from "../tradesApi";
import { colors } from "../theme";
import { t } from "@dmcripto/core";

export default function AddScreen({ userId, onAdded, limitStatus }: { userId: string; onAdded: () => void; limitStatus?: DailyStatus }) {
  const [mode, setMode] = useState<"paste" | "manual">("paste");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [clip, setClip] = useState<string | null>(null);

  useEffect(() => {
    Clipboard.getStringAsync()
      .then((c) => {
        if (c && parseAlerts(c).valid.length > 0) setClip(c);
      })
      .catch(() => {});
  }, []);
  const [busy, setBusy] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<Direction>("LONG");
  const [entry, setEntry] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [leverage, setLeverage] = useState("");

  const doSave = async (list: NewTrade[]) => {
    setBusy(true);
    try {
      await insertTrades(userId, list);
      onAdded();
    } catch (err) {
      Alert.alert(t("Error"), err instanceof Error ? err.message : t("No se pudo guardar."));
    } finally {
      setBusy(false);
    }
  };

  const save = (list: NewTrade[]) =>
    new Promise<void>((resolve) => {
      if (limitStatus?.level === "stop") {
        Alert.alert(t("Frená por hoy"), `${limitStatus.messages.join("\n")}\n\n${t("¿Querés registrar la operación igual?")}`, [
          { text: t("No"), style: "cancel", onPress: () => resolve() },
          { text: t("Registrar igual"), style: "destructive", onPress: () => doSave(list).then(resolve) },
        ]);
      } else {
        doSave(list).then(resolve);
      }
    });

  const interpret = (value = text) => setParsed(parseAlerts(value));

  const confirm = async () => {
    if (!parsed?.valid.length) return;
    await save(parsed.valid);
    setText("");
    setParsed(null);
  };

  const useClip = () => {
    if (!clip) return;
    setText(clip);
    setParsed(parseAlerts(clip));
    setClip(null);
  };

  const paste = async () => {
    const c = await Clipboard.getStringAsync();
    setText(c);
    if (c.trim()) setParsed(parseAlerts(c));
  };

  const saveManual = async () => {
    const n = (v: string) => Number(v.replace(",", "."));
    const lev = leverage.trim() ? n(leverage.replace(/x$/i, "")) : null;
    const list: NewTrade[] = [{ symbol: symbol.trim().toUpperCase(), direction, entry: n(entry), tp: n(tp), sl: n(sl), date: new Date().toISOString(), ...(lev != null && Number.isFinite(lev) && lev >= 1 && lev <= 1000 ? { leverage: lev } : {}) }];
    if (!list[0].symbol || ![list[0].entry, list[0].tp, list[0].sl].every((x) => Number.isFinite(x) && x > 0)) {
      return Alert.alert(t("Faltan datos"), t("Completá símbolo, entrada, TP y SL con números válidos."));
    }
    if (lev != null && !(Number.isFinite(lev) && lev >= 1 && lev <= 1000)) return Alert.alert(t("Faltan datos"), t("Apalancamiento inválido (ej: 10)."));
    await save(list);
    setLeverage("");
    setSymbol("");
    setEntry("");
    setTp("");
    setSl("");
  };

  const loadSamples = async () => {
    setBusy(true);
    try {
      await insertFullTrades(userId, sampleTrades());
      onAdded();
    } catch (err) {
      Alert.alert(t("Error"), err instanceof Error ? err.message : t("No se pudo cargar el ejemplo."));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, opts?: { numeric?: boolean; placeholder?: string }) => (
    <View style={{ flex: 1 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType={opts?.numeric ? "decimal-pad" : "default"}
        autoCapitalize="characters"
        placeholder={opts?.placeholder}
        placeholderTextColor={colors.dim}
        style={s.input}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.tabs}>
          {(["paste", "manual"] as const).map((m) => (
            <TouchableOpacity key={m} style={[s.tab, mode === m && s.tabOn]} onPress={() => setMode(m)}>
              <Text style={[s.tabText, mode === m && { color: colors.ink }]}>{m === "paste" ? t("Pegar señal") : t("Manual")}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === "paste" ? (
          <View style={s.card}>
            {clip && !text && (
              <TouchableOpacity style={s.clipBanner} onPress={useClip} activeOpacity={0.8}>
                <Text style={s.clipTitle}>{t("Detectamos una señal en tu portapapeles")}</Text>
                <Text style={s.clipText} numberOfLines={2}>
                  {clip}
                </Text>
                <Text style={s.clipAction}>{t("Tocá para usarla")}</Text>
              </TouchableOpacity>
            )}
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                setParsed(null);
              }}
              multiline
              placeholder={t("Pegá una señal de cualquier fuente, por ejemplo:\n#BTC/USDT LONG\nEntry: 65000\nTP: 66500\nSL: 64500\n\nO en formato simple:\n") + exampleAlert()}
              placeholderTextColor={colors.dim}
              style={[s.input, { minHeight: 150, textAlignVertical: "top" }]}
              autoCapitalize="none"
            />
            <View style={s.row}>
              <TouchableOpacity style={[s.btn, s.btnGold, { flex: 1 }]} onPress={() => interpret()} disabled={busy || !text.trim()}>
                <Text style={[s.btnText, { color: colors.ink }]}>{t("Interpretar")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={paste}>
                <Text style={s.btnText}>{t("Pegar")}</Text>
              </TouchableOpacity>
            </View>

            {parsed?.valid.map((v, i) => (
              <View key={i} style={s.previewRow}>
                <Text style={[s.previewDir, { color: v.direction === "LONG" ? colors.bull : colors.bear }]}>
                  {v.direction === "LONG" ? "▲" : "▼"}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.previewSymbol}>{v.symbol}</Text>
                  <Text style={s.previewLevels}>
                    {t("Entrada")} {fmtPrice(v.entry)} · TP {[...(v.targets ?? []), v.tp].map(fmtPrice).join(" / ")} · SL {fmtPrice(v.sl)}
                  </Text>
                </View>
                <Text style={s.previewRR}>1:{rrOf({ ...v, id: "", outcome: "ABIERTA" } as Trade).toFixed(2)}</Text>
              </View>
            ))}
            {parsed?.errors.map((e, i) => (
              <Text key={i} style={s.err}>
                {e}
              </Text>
            ))}
            {parsed && parsed.valid.length > 0 && (
              <TouchableOpacity style={[s.btn, s.btnBull]} onPress={confirm} disabled={busy}>
                <Text style={[s.btnText, { color: colors.ink }]}>
                  {t("Confirmar")} {parsed.valid.length} {parsed.valid.length === 1 ? t("operación") : t("operaciones")}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={s.hint}>
              {t("Funciona con mensajes de Telegram, WhatsApp o Discord, alertas de cualquier plataforma o tu propio formato. Revisá lo que entendió antes de confirmar.")}
            </Text>
          </View>
        ) : (
          <View style={s.card}>
            {field(t("SÍMBOLO"), symbol, setSymbol, { placeholder: "BTCUSDT" })}
            <View style={s.row}>
              {(["LONG", "SHORT"] as const).map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[s.btn, { flex: 1 }, direction === d && { backgroundColor: d === "LONG" ? colors.bulldeep : colors.beardeep, borderColor: d === "LONG" ? colors.bull : colors.bear }]}
                  onPress={() => setDirection(d)}
                >
                  <Text style={[s.btnText, direction === d && { color: d === "LONG" ? colors.bull : colors.bear }]}>{d === "LONG" ? t("COMPRA") : t("VENTA")}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.row}>
              {field(t("ENTRADA"), entry, setEntry, { numeric: true })}
              {field(t("TAKE PROFIT"), tp, setTp, { numeric: true })}
              {field(t("STOP LOSS"), sl, setSl, { numeric: true })}
            </View>
            {field(t("APALANCAMIENTO (x, opcional)"), leverage, setLeverage, { numeric: true, placeholder: "10" })}
            <TouchableOpacity style={[s.btn, s.btnGold]} onPress={saveManual} disabled={busy}>
              <Text style={[s.btnText, { color: colors.ink }]}>{t("Guardar operación")}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={s.btn} onPress={loadSamples} disabled={busy}>
          <Text style={s.btnText}>{t("Cargar operaciones de ejemplo")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { flexDirection: "row", backgroundColor: colors.panel, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 4, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  tabOn: { backgroundColor: colors.gold },
  tabText: { color: colors.fog, fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginBottom: 16, gap: 10 },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  label: { color: colors.fog, fontSize: 9.5, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },
  input: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: colors.snow, fontSize: 13 },
  btn: { borderWidth: 1, borderColor: colors.line2, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, alignItems: "center" },
  btnGold: { backgroundColor: colors.gold, borderColor: colors.gold },
  btnText: { color: colors.fog, fontWeight: "700", fontSize: 12.5 },
  clipBanner: { borderWidth: 1, borderColor: colors.gold + "88", backgroundColor: colors.gold + "14", borderRadius: 10, padding: 12, gap: 4 },
  clipTitle: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  clipText: { color: colors.fog, fontSize: 11.5 },
  clipAction: { color: colors.snow, fontSize: 11, fontWeight: "700", marginTop: 2 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, backgroundColor: colors.ink },
  previewDir: { fontSize: 18, fontWeight: "900" },
  previewSymbol: { color: colors.snow, fontWeight: "800", fontSize: 14 },
  previewLevels: { color: colors.fog, fontSize: 11, marginTop: 2 },
  previewRR: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  btnBull: { backgroundColor: colors.bull, borderColor: colors.bull },
  err: { color: colors.bear, fontSize: 11.5 },
  hint: { color: colors.dim, fontSize: 11 },
});

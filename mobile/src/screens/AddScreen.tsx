import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { EXAMPLE_ALERT, parseAlerts, sampleTrades } from "@dmcripto/core";
import type { Direction, NewTrade } from "@dmcripto/core";
import { insertFullTrades, insertTrades } from "../tradesApi";
import { colors } from "../theme";

export default function AddScreen({ userId, onAdded }: { userId: string; onAdded: () => void }) {
  const [mode, setMode] = useState<"paste" | "manual">("paste");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<Direction>("LONG");
  const [entry, setEntry] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");

  const save = async (list: NewTrade[]) => {
    setBusy(true);
    try {
      await insertTrades(userId, list);
      onAdded();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const interpret = async () => {
    const { valid, errors: errs } = parseAlerts(text);
    setErrors(errs);
    if (!valid.length) return;
    await save(valid);
    if (!errs.length) setText("");
  };

  const paste = async () => setText(await Clipboard.getStringAsync());

  const saveManual = async () => {
    const n = (v: string) => Number(v.replace(",", "."));
    const list = [{ symbol: symbol.trim().toUpperCase(), direction, entry: n(entry), tp: n(tp), sl: n(sl), date: new Date().toISOString() }];
    if (!list[0].symbol || ![list[0].entry, list[0].tp, list[0].sl].every((x) => Number.isFinite(x) && x > 0)) {
      return Alert.alert("Faltan datos", "Completá símbolo, entrada, TP y SL con números válidos.");
    }
    await save(list);
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
      Alert.alert("Error", err instanceof Error ? err.message : "No se pudo cargar el ejemplo.");
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
              <Text style={[s.tabText, mode === m && { color: colors.ink }]}>{m === "paste" ? "Pegar alerta" : "Manual"}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === "paste" ? (
          <View style={s.card}>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              placeholder={`VELTRIX|SYMBOL|DIRECCION|ENTRADA|TP|SL\n${EXAMPLE_ALERT}`}
              placeholderTextColor={colors.dim}
              style={[s.input, { minHeight: 110, textAlignVertical: "top" }]}
              autoCapitalize="none"
            />
            <View style={s.row}>
              <TouchableOpacity style={[s.btn, s.btnGold, { flex: 1 }]} onPress={interpret} disabled={busy}>
                <Text style={[s.btnText, { color: colors.ink }]}>Interpretar y guardar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={paste}>
                <Text style={s.btnText}>Pegar</Text>
              </TouchableOpacity>
            </View>
            {errors.map((e, i) => (
              <Text key={i} style={s.err}>
                {e}
              </Text>
            ))}
            <Text style={s.hint}>Aceptá varias líneas a la vez. Dirección: COMPRA/VENTA o LONG/SHORT.</Text>
          </View>
        ) : (
          <View style={s.card}>
            {field("SÍMBOLO", symbol, setSymbol, { placeholder: "BTCUSDT" })}
            <View style={s.row}>
              {(["LONG", "SHORT"] as const).map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[s.btn, { flex: 1 }, direction === d && { backgroundColor: d === "LONG" ? colors.bulldeep : colors.beardeep, borderColor: d === "LONG" ? colors.bull : colors.bear }]}
                  onPress={() => setDirection(d)}
                >
                  <Text style={[s.btnText, direction === d && { color: d === "LONG" ? colors.bull : colors.bear }]}>{d === "LONG" ? "COMPRA" : "VENTA"}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.row}>
              {field("ENTRADA", entry, setEntry, { numeric: true })}
              {field("TAKE PROFIT", tp, setTp, { numeric: true })}
              {field("STOP LOSS", sl, setSl, { numeric: true })}
            </View>
            <TouchableOpacity style={[s.btn, s.btnGold]} onPress={saveManual} disabled={busy}>
              <Text style={[s.btnText, { color: colors.ink }]}>Guardar operación</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={s.btn} onPress={loadSamples} disabled={busy}>
          <Text style={s.btnText}>Cargar operaciones de ejemplo</Text>
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
  err: { color: colors.bear, fontSize: 11.5 },
  hint: { color: colors.dim, fontSize: 11 },
});

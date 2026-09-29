import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { buildAlertMessage } from "@dmcripto/core";
import type { AlertFormat, Direction } from "@dmcripto/core";
import { colors } from "./theme";

export default function AlertBuilder() {
  const [format, setFormat] = useState<AlertFormat>("pipe");
  const [direction, setDirection] = useState<Direction>("LONG");
  const [entry, setEntry] = useState("{{close}}");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [copied, setCopied] = useState(false);

  const message = useMemo(() => buildAlertMessage({ format, direction, entry, tp, sl }), [format, direction, entry, tp, sl]);

  const copy = async () => {
    await Clipboard.setStringAsync(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress}>
      <Text style={[s.chipText, on && { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />
    </View>
  );

  return (
    <View style={{ gap: 10 }}>
      <Text style={s.hint}>
        Funciona con cualquier indicador. Elegí la dirección y escribí en TP y SL lo que tu indicador entrega (un{" "}
        {'{{plot("nombre")}}'} de TradingView o un número fijo). Copiá el mensaje en el campo "Mensaje" de la alerta.
      </Text>
      <View style={s.row}>
        {chip("COMPRA", direction === "LONG", () => setDirection("LONG"))}
        {chip("VENTA", direction === "SHORT", () => setDirection("SHORT"))}
      </View>
      {field("ENTRADA", entry, setEntry, "{{close}}")}
      {field("TAKE PROFIT", tp, setTp, '{{plot("TP")}}')}
      {field("STOP LOSS", sl, setSl, '{{plot("SL")}}')}
      <View style={s.row}>
        {chip("Formato simple", format === "pipe", () => setFormat("pipe"))}
        {chip("Formato JSON", format === "json", () => setFormat("json"))}
      </View>
      <View style={s.output}>
        <Text selectable style={s.outputText}>
          {message}
        </Text>
      </View>
      <TouchableOpacity style={s.copyBtn} onPress={copy}>
        <Text style={s.copyText}>{copied ? "¡Copiado!" : "Copiar mensaje"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  row: { flexDirection: "row", gap: 8 },
  chip: { flex: 1, borderWidth: 1, borderColor: colors.line2, borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontSize: 12, fontWeight: "700" },
  label: { color: colors.fog, fontSize: 9.5, fontWeight: "700", letterSpacing: 1 },
  input: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: colors.snow, fontSize: 13 },
  output: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10 },
  outputText: { color: colors.gold, fontSize: 11.5 },
  copyBtn: { backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  copyText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
});

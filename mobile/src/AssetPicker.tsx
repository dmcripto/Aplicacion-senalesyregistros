import { useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BOT_MAX_SYMBOLS, botAssetGroups, botAssetName, t } from "@dmcripto/core";
import { colors } from "./theme";

/** Lista desplegable para elegir los activos del bot (cripto, oro, plata, petróleo, acciones…), con buscador. */
export default function AssetPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const full = selected.length >= BOT_MAX_SYMBOLS;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return botAssetGroups()
      .map((g) => ({ ...g, items: g.items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.sym.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length);
  }, [q, open]);

  const toggle = (sym: string) => {
    if (selected.includes(sym)) {
      if (selected.length > 1) onChange(selected.filter((x) => x !== sym));
    } else if (!full) onChange([...selected, sym]);
  };

  return (
    <View>
      <View style={s.wrap}>
        {selected.map((sym) => (
          <TouchableOpacity key={sym} style={[s.chip, s.chipOn]} onPress={() => toggle(sym)} disabled={selected.length <= 1}>
            <Text style={[s.chipText, { color: colors.ink }]}>
              {botAssetName(sym)}
              {selected.length > 1 ? "  ✕" : ""}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[s.chip, s.add]} onPress={() => setOpen(true)}>
          <Text style={[s.chipText, { color: colors.cyan }]}>＋ {t("Agregar activos")} ▾</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.hint}>{t("{n} de {max} elegidos. Si el exchange no tiene el activo, el bot lo omite.", { n: selected.length, max: BOT_MAX_SYMBOLS })}</Text>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>{t("Elegí tus activos")}</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Text style={[s.chipText, { color: colors.gold, fontSize: 15 }]}>{t("Listo")}</Text>
            </TouchableOpacity>
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder={t("Buscar: oro, petróleo, MSTR, ENA…")} placeholderTextColor={colors.dim} autoCapitalize="none" autoCorrect={false} style={s.input} />
          <Text style={s.hint}>
            {selected.length}/{BOT_MAX_SYMBOLS}
            {full ? ` · ${t("Llegaste al máximo: sacá uno para agregar otro.")}` : ""}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            {groups.length === 0 && <Text style={s.hint}>{t("No hay resultados.")}</Text>}
            {groups.map((g) => (
              <View key={g.id} style={{ marginTop: 14 }}>
                <Text style={s.group}>{g.label}</Text>
                <View style={s.wrap}>
                  {g.items.map((i) => {
                    const on = selected.includes(i.sym);
                    return (
                      <TouchableOpacity key={i.sym} disabled={!on && full} style={[s.chip, on && s.chipOn, !on && full && { opacity: 0.35 }]} onPress={() => toggle(i.sym)}>
                        <Text style={[s.chipText, on && { color: colors.ink }]}>
                          {on ? "✓ " : ""}
                          {i.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  add: { borderColor: colors.cyan },
  chipText: { color: colors.fog, fontWeight: "800", fontSize: 12.5 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  sheet: { flex: 1, backgroundColor: colors.ink, paddingTop: 54, paddingHorizontal: 16 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { color: colors.snow, fontSize: 20, fontWeight: "800" },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, color: colors.snow, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  group: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8 },
});

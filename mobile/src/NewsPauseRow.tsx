import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { t } from "@dmcripto/core";
import { fetchNewsPause, saveNewsPause } from "./tradesApi";
import type { NewsPauseState } from "./tradesApi";
import { colors } from "./theme";

/** Pausa del bot alrededor de los datos económicos de alto impacto. */
export default function NewsPauseRow({ userId }: { userId: string }) {
  const [p, setP] = useState<NewsPauseState | null>(null);
  const [before, setBefore] = useState("30");
  const [after, setAfter] = useState("30");

  useEffect(() => {
    let alive = true;
    const load = (first: boolean) =>
      fetchNewsPause(userId).then((r) => {
        if (!alive || !r) return;
        setP((prev) => ({ ...r, ...(prev && !first ? { enabled: prev.enabled, before: prev.before, after: prev.after } : {}) }));
        if (first) {
          setBefore(String(r.before));
          setAfter(String(r.after));
        }
      });
    void load(true);
    const id = setInterval(() => void load(false), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [userId]);

  if (!p) return null;
  const num = (v: string, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(180, Math.max(0, Math.round(n))) : d;
  };
  const save = async (next: Pick<NewsPauseState, "enabled" | "before" | "after">) => {
    try {
      await saveNewsPause(userId, next);
      setP({ ...p, ...next });
    } catch (e) {
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    }
  };
  const paused = p.enabled && p.pausedUntil && new Date(p.pausedUntil).getTime() > Date.now();

  return (
    <View style={st.box}>
      <View style={st.row}>
        <View style={{ flex: 1 }}>
          <Text style={st.name}>{t("Pausar cerca de datos económicos")}</Text>
          <Text style={st.hint}>{t("No abre operaciones nuevas desde un rato antes hasta un rato después de un dato de alto impacto (los 🔴 de la agenda económica). Las que ya están abiertas siguen igual, con su TP y su SL.")}</Text>
        </View>
        <Switch value={p.enabled} onValueChange={(v) => void save({ enabled: v, before: num(before, 30), after: num(after, 30) })} trackColor={{ true: colors.bull + "88", false: colors.line }} thumbColor={p.enabled ? colors.bull : colors.fog} />
      </View>
      {p.enabled && (
        <View style={st.row}>
          <Text style={st.hint}>{t("Minutos antes")}</Text>
          <TextInput value={before} onChangeText={setBefore} onEndEditing={() => void save({ enabled: true, before: num(before, 30), after: num(after, 30) })} keyboardType="number-pad" style={st.input} />
          <Text style={st.hint}>{t("Minutos después")}</Text>
          <TextInput value={after} onChangeText={setAfter} onEndEditing={() => void save({ enabled: true, before: num(before, 30), after: num(after, 30) })} keyboardType="number-pad" style={st.input} />
        </View>
      )}
      {paused && (
        <Text style={st.paused}>
          ⏸ {t("Bot en pausa por")} {p.pausedEvent} · {t("hasta las")} {new Date(p.pausedUntil!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
        </Text>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { color: colors.snow, fontSize: 13, fontWeight: "800" },
  hint: { color: colors.fog, fontSize: 11, lineHeight: 16 },
  input: { width: 56, borderWidth: 1, borderColor: colors.line, borderRadius: 6, color: colors.snow, paddingVertical: 6, paddingHorizontal: 8, fontSize: 13, textAlign: "center" },
  paused: { color: colors.gold, fontSize: 12, fontWeight: "700", borderWidth: 1, borderColor: colors.gold + "66", borderRadius: 8, padding: 10 },
});

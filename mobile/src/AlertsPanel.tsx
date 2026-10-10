import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ALERT_TFS, MAX_ACTIVE_ALERTS, checkAlertDraft, fmtPrice, levelLooksOff, parseAlertLevel, t } from "@dmcripto/core";
import type { AlertKind, AlertSide, AlertTf, UserAlert } from "@dmcripto/core";
import { createAlert, deleteAlert, setAlertActive } from "./tradesApi";
import { colors } from "./theme";

export function describeAlert(a: Pick<UserAlert, "kind" | "tf" | "dir" | "level" | "period">): string {
  const up = a.dir === "above";
  if (a.kind === "price") return up ? t("El precio cruza por encima de {n}", { n: fmtPrice(a.level ?? 0) }) : t("El precio cruza por debajo de {n}", { n: fmtPrice(a.level ?? 0) });
  if (a.kind === "rsi") return up ? t("El RSI {p} ({tf}) cruza por encima de {n}", { p: a.period ?? 0, tf: a.tf, n: a.level ?? 0 }) : t("El RSI {p} ({tf}) cruza por debajo de {n}", { p: a.period ?? 0, tf: a.tf, n: a.level ?? 0 });
  return up ? t("El precio cierra por encima de la EMA {p} ({tf})", { p: a.period ?? 0, tf: a.tf }) : t("El precio cierra por debajo de la EMA {p} ({tf})", { p: a.period ?? 0, tf: a.tf });
}

const KINDS: Array<{ k: AlertKind; label: () => string }> = [
  { k: "price", label: () => t("Precio") },
  { k: "rsi", label: () => t("RSI") },
  { k: "ema", label: () => t("Cierre vs EMA") },
];

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[st.chip, on && st.chipOn]}>
      <Text style={[st.chipText, on && { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Alertas propias: «avisame cuando el precio / el RSI / la EMA cruce tal nivel». El servidor las revisa cada minuto. */
export default function AlertsPanel({ userId, symbol, tf: chartTf, lastPrice, alerts, reload }: { userId: string; symbol: string; tf: AlertTf; lastPrice: number | null; alerts: UserAlert[]; reload: () => void }) {
  const [kind, setKind] = useState<AlertKind>("price");
  const [dir, setDir] = useState<AlertSide>("above");
  const [level, setLevel] = useState("");
  const touched = useRef(false);
  const [period, setPeriod] = useState("14");
  const [tf, setTf] = useState<AlertTf>(chartTf);
  const [once, setOnce] = useState(true);
  const [busy, setBusy] = useState(false);
  const active = alerts.filter((a) => a.active).length;

  const num = (v: string) => Number(v.trim().replace(",", "."));
  const lvl = (v: string) => (kind === "price" ? parseAlertLevel(v, lastPrice) : num(v));
  const draft = { symbol, kind, tf, dir, level: kind === "ema" ? null : lvl(level), period: kind === "price" ? null : num(period), once };
  const check = checkAlertDraft(draft);
  const suggestion = kind === "price" ? (lastPrice ? String(Number(lastPrice.toPrecision(7))) : "") : kind === "rsi" ? "30" : "";
  useEffect(() => {
    touched.current = false;
  }, [kind, symbol]);
  useEffect(() => {
    if (!touched.current) setLevel(suggestion);
  }, [suggestion]);

  const create = async () => {
    if (!check.ok) return Alert.alert(t("Error"), check.error === "level" ? (kind === "rsi" ? t("El nivel del RSI tiene que estar entre 1 y 99.") : t("Poné un precio mayor a 0.")) : t("Revisá el período."));
    if (kind === "price" && draft.level != null && levelLooksOff(draft.level, lastPrice)) return Alert.alert(t("Error"), t("Ese precio está muy lejos del actual ({n}). Escribilo completo y sin puntos de miles, por ejemplo {e}.", { n: fmtPrice(lastPrice ?? 0), e: String(Math.round(lastPrice ?? 0)) }));
    setBusy(true);
    try {
      await createAlert(userId, draft);
      Alert.alert(t("Alerta creada"), t("Alerta creada: te aviso por la app y por Telegram."));
      touched.current = false;
      setLevel(suggestion);
      reload();
    } catch (e) {
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo crear la alerta."));
    } finally {
      setBusy(false);
    }
  };
  const run = async (f: () => Promise<void>) => {
    try {
      await f();
      reload();
    } catch (e) {
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    }
  };

  return (
    <View style={st.card}>
      <View style={st.row}>
        <Text style={st.title}>🔔 {t("MIS ALERTAS")}</Text>
        <Text style={st.dim}>
          {active}/{MAX_ACTIVE_ALERTS} {t("activas")}
        </Text>
      </View>
      <View style={st.wrap}>
        {KINDS.map((x) => (
          <Chip key={x.k} on={kind === x.k} label={x.label()} onPress={() => setKind(x.k)} />
        ))}
      </View>
      <View style={st.wrap}>
        <Chip on={dir === "above"} label={kind === "ema" ? t("Cierra por encima") : t("Cruza por encima")} onPress={() => setDir("above")} />
        <Chip on={dir === "below"} label={kind === "ema" ? t("Cierra por debajo") : t("Cruza por debajo")} onPress={() => setDir("below")} />
      </View>
      <View style={st.wrap}>
        {kind !== "ema" && (
          <TextInput
            value={level}
            onChangeText={(v) => {
              touched.current = true;
              setLevel(v);
            }}
            keyboardType="decimal-pad"
            placeholder={kind === "price" ? t("Precio") : t("Nivel del RSI")}
            placeholderTextColor={colors.dim}
            style={[st.input, { minWidth: 110 }]}
          />
        )}
        {kind !== "price" && (
          <>
            <TextInput value={period} onChangeText={setPeriod} keyboardType="number-pad" placeholder={t("Período")} placeholderTextColor={colors.dim} style={[st.input, { width: 70 }]} />
            {ALERT_TFS.map((x) => (
              <Chip key={x} on={tf === x} label={x} onPress={() => setTf(x)} />
            ))}
          </>
        )}
      </View>
      <View style={st.row}>
        <Text style={st.hint}>
          {t("Avisarme una sola vez")} · {symbol}
        </Text>
        <Switch value={once} onValueChange={setOnce} trackColor={{ true: colors.bull + "88", false: colors.line }} thumbColor={once ? colors.bull : colors.fog} />
      </View>
      <TouchableOpacity disabled={busy || !check.ok} onPress={create} style={[st.create, (busy || !check.ok) && { opacity: 0.4 }]}>
        <Text style={st.createText}>{t("Crear alerta")}</Text>
      </TouchableOpacity>

      {alerts.length === 0 ? (
        <Text style={st.hint}>{t("Todavía no tenés alertas. Creá una y te aviso por la app y por Telegram cuando se cumpla, aunque tengas VELTRIX cerrado.")}</Text>
      ) : (
        alerts.map((a) => (
          <View key={a.id} style={st.item}>
            <View style={[st.dot, { backgroundColor: a.active ? colors.bull : a.triggerCount > 0 ? colors.gold : colors.dim }]} />
            <View style={{ flex: 1 }}>
              <Text style={st.itemText}>
                <Text style={{ fontWeight: "800" }}>{a.symbol}</Text> · {describeAlert(a)}
              </Text>
              <Text style={st.dim}>{a.active ? (a.once ? t("Activa · una sola vez") : t("Activa · cada vez que cruce")) : a.triggerCount > 0 ? t("Ya avisó") : t("En pausa")}</Text>
            </View>
            <TouchableOpacity onPress={() => run(() => setAlertActive(a.id, !a.active))} style={st.small}>
              <Text style={st.smallText}>{a.active ? t("Pausar") : t("Activar")}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => run(() => deleteAlert(a.id))} style={st.small}>
              <Text style={[st.smallText, { color: colors.bear }]}>{t("Borrar")}</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
      <Text style={st.dim}>{t("Una alerta salta cuando el valor cruza el nivel, no mientras se queda de un lado. El RSI y la EMA se miden con la vela ya cerrada. Se revisan cada minuto.")}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, gap: 10, marginTop: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: colors.fog, fontSize: 10.5, fontWeight: "800", letterSpacing: 1.6 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontWeight: "800", fontSize: 12 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, color: colors.snow, paddingVertical: 8, paddingHorizontal: 10, fontSize: 14 },
  create: { borderWidth: 1, borderColor: colors.gold + "88", backgroundColor: colors.gold + "18", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  createText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  hint: { color: colors.fog, fontSize: 11.5, lineHeight: 17 },
  dim: { color: colors.dim, fontSize: 10.5, lineHeight: 15 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  itemText: { color: colors.snow, fontSize: 12.5, lineHeight: 18 },
  small: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8 },
  smallText: { color: colors.fog, fontSize: 10.5, fontWeight: "800" },
});

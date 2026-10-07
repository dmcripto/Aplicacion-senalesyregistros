import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { EXCHANGE_LIST, exchangeName, exchangeSteps, needsPassphrase, fmtCurrency, fmtDateTime, t } from "@dmcripto/core";
import type { ExchangeConnection, ExchangeId, MoneySettings } from "@dmcripto/core";
import { mfaErrorText, useMfa } from "./MfaSection";
import { connectExchange, disconnectExchange, fetchConnections, syncExchanges } from "./tradesApi";
import { useMoney } from "./money";
import { colors } from "./theme";

/** Primer paso: sin capital y riesgo no se puede convertir lo importado a R, así que se piden acá mismo. */
function CapitalStep({ onSave, currency }: { onSave: (m: MoneySettings) => Promise<void>; currency: string }) {
  const [capital, setCapital] = useState("");
  const [risk, setRisk] = useState("1");
  const [busy, setBusy] = useState(false);
  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  const cap = num(capital), rk = num(risk);
  const ok = cap != null && rk != null && rk <= 100;
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await onSave({ capital: cap, riskPct: rk, currency: currency || "USD" });
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : t("No se pudo guardar."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.notice}>
      <Text style={s.stepTitle}>{t("Paso 1 · Tu capital")}</Text>
      <Text style={s.hint}>{t("Para pasar tus operaciones a R necesitamos tu capital y cuánto arriesgás por operación. Es una estimación y lo podés cambiar cuando quieras.")}</Text>
      <Text style={s.label}>{t("Capital inicial").toUpperCase()}</Text>
      <TextInput value={capital} onChangeText={setCapital} keyboardType="decimal-pad" placeholder="1000" placeholderTextColor={colors.dim} style={s.input} />
      <Text style={s.label}>{t("Riesgo (%)").toUpperCase()}</Text>
      <TextInput value={risk} onChangeText={setRisk} keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.dim} style={s.input} />
      {ok ? <Text style={s.hint}>{t("1R equivale a")} {fmtCurrency((cap! * rk!) / 100, currency || "USD", false)}</Text> : null}
      <TouchableOpacity style={[s.btn, (!ok || busy) && { opacity: 0.4 }]} onPress={save} disabled={!ok || busy}>
        {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={s.btnText}>{t("Guardar y seguir")}</Text>}
      </TouchableOpacity>
    </View>
  );
}

/** Conexión de solo lectura con ocho exchanges (dentro de Ajustes). */
export default function ExchangeSection({ onSaveMoney }: { onSaveMoney: (m: MoneySettings) => Promise<void> }) {
  const mfa = useMfa();
  const { unit, money } = useMoney();
  const [conns, setConns] = useState<ExchangeConnection[]>([]);
  const [exchange, setExchange] = useState<ExchangeId>("binance");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [guide, setGuide] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setConns(await fetchConnections());
    } catch {
      setConns([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    if (!(await mfa.ask(t("Vas a conectar un exchange a tu cuenta.")))) return;
    setBusy(true);
    try {
      const r = await connectExchange(exchange, apiKey.trim(), apiSecret.trim(), needsPassphrase(exchange) ? passphrase.trim() : undefined);
      if (!r.ok) return Alert.alert("Error", r.code === "mfa_required" ? mfaErrorText(new Error("mfa_required"), "") : (r.error ?? t("No se pudo conectar.")));
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      Alert.alert(t("Listo"), t("{name} conectado. Operaciones importadas: {n}.", { name: exchangeName(exchange), n: r.imported ?? 0 }) + (r.warning ? `\n\n${r.warning}` : ""));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await syncExchanges();
      if (!r.ok) return Alert.alert("Error", r.error ?? t("No se pudo sincronizar."));
      const total = (r.results ?? []).reduce((a, x) => a + x.imported, 0);
      const failed = (r.results ?? []).find((x) => x.error);
      if (failed?.error) Alert.alert("Error", failed.error);
      else Alert.alert(t("Listo"), total ? t("Sincronizado: {n} operaciones nuevas.", { n: total }) : t("Todo al día: no hay operaciones nuevas."));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = (c: ExchangeConnection) =>
    Alert.alert(t("Desconectar"), t("Se borra la clave guardada de {name}. Las operaciones ya importadas quedan en tu diario.", { name: exchangeName(c.exchange) }), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Desconectar"),
        style: "destructive",
        onPress: async () => {
          if (!(await mfa.ask(t("Vas a desconectar un exchange: se borra la clave guardada.")))) return;
          disconnectExchange(c.id).then(reload).catch((e) => Alert.alert("Error", mfaErrorText(e, t("No se pudo desconectar."))));
        },
      },
    ]);

  const canConnect = unit != null && apiKey.trim().length >= 8 && apiSecret.trim().length >= 8 && (!needsPassphrase(exchange) || passphrase.trim().length > 0) && !busy;

  return (
    <View style={s.card}>
      {conns.length ? (
        conns.map((c) => (
          <View key={c.id} style={s.conn}>
            <View style={s.row}>
              <Text style={s.name}>
                {exchangeName(c.exchange)} <Text style={s.hintKey}>••••{c.keyHint}</Text>
              </Text>
              <Text style={[s.status, { color: c.status === "active" ? colors.bull : colors.bear }]}>
                {c.status === "active" ? t("Conectado") : t("Con error")}
              </Text>
            </View>
            <Text style={s.hint}>
              {c.lastSyncAt ? t("Última sincronización: {when} · {n} nuevas", { when: fmtDateTime(c.lastSyncAt), n: c.lastImportCount }) : t("Todavía sin sincronizar")}
            </Text>
            {c.status === "active" ? <Text style={s.hint}>{t("Se actualiza sola cada ~10 minutos, aunque no abras la app.")}</Text> : null}
            {c.status === "error" && c.lastError ? <Text style={s.error}>{c.lastError}</Text> : null}
            <TouchableOpacity onPress={() => disconnect(c)} style={{ alignSelf: "flex-end" }}>
              <Text style={s.link}>{t("Desconectar")}</Text>
            </TouchableOpacity>
          </View>
        ))
      ) : (
        <Text style={s.hint}>
          {t("Conectá tu exchange (Binance, Bybit, Bitunix, MEXC, Gate, Bitget, OKX, KuCoin o BingX) con una clave de solo lectura y VELTRIX trae tus operaciones cerradas al diario, sin copiarlas a mano.")}
        </Text>
      )}

      {conns.length > 0 && (
        <TouchableOpacity style={s.outline} onPress={syncNow} disabled={busy || unit == null}>
          {busy ? <ActivityIndicator color={colors.gold} /> : <Text style={s.outlineText}>{t("Sincronizar ahora")}</Text>}
        </TouchableOpacity>
      )}

      {unit == null && <CapitalStep onSave={onSaveMoney} currency={money.currency} />}
      {unit != null && (
        <>
      <Text style={s.label}>{t("Exchange")}</Text>
      <TouchableOpacity style={[s.drop, listOpen && { borderColor: colors.gold }]} onPress={() => setListOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: listOpen }}>
        <Text style={s.dropText}>{exchangeName(exchange)}</Text>
        <Text style={s.dropArrow}>{listOpen ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {listOpen && (
        <View style={s.dropList}>
          {EXCHANGE_LIST.map((e, i) => (
            <TouchableOpacity
              key={e.id}
              style={[s.dropItem, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }, e.id === exchange && { backgroundColor: colors.gold + "22" }]}
              onPress={() => {
                setExchange(e.id);
                setListOpen(false);
              }}
            >
              <Text style={[s.dropItemText, e.id === exchange && { color: colors.gold }]}>{e.name}</Text>
              {conns.some((c) => c.exchange === e.id) && <Text style={s.dropConn}>{t("Conectado")}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity onPress={() => setGuide((g) => !g)}>
        <Text style={s.link}>{guide ? "▾ " : "▸ "}{t("Cómo crear la clave (solo lectura)")}</Text>
      </TouchableOpacity>
      {guide && (
        <View style={{ gap: 4 }}>
          {exchangeSteps(exchange).map((x, i) => (
            <Text key={x} style={s.hint}>{i + 1}. {x}</Text>
          ))}
        </View>
      )}

      <Text style={s.label}>API KEY</Text>
      <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.dim} style={s.input} />
      <Text style={s.label}>{t("Clave secreta (Secret)")}</Text>
      <TextInput value={apiSecret} onChangeText={setApiSecret} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholderTextColor={colors.dim} style={s.input} />

      {needsPassphrase(exchange) && (
        <>
          <Text style={s.label}>{t("Contraseña de la API (passphrase)")}</Text>
          <TextInput value={passphrase} onChangeText={setPassphrase} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholderTextColor={colors.dim} style={s.input} />
        </>
      )}

      <TouchableOpacity style={[s.btn, !canConnect && { opacity: 0.4 }]} onPress={connect} disabled={!canConnect}>
        {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={s.btnText}>{t("Conectar {name}", { name: exchangeName(exchange) })}</Text>}
      </TouchableOpacity>
      <Text style={s.hint}>
        {t("Tu clave secreta se guarda cifrada en el servidor y no se vuelve a mostrar. VELTRIX solo lee: rechaza claves que permitan operar o retirar. Las operaciones se importan con tu 1R (capital × riesgo %) y quedan marcadas con el exchange de origen.")}
      </Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  drop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 },
  dropText: { color: colors.snow, fontSize: 14, fontWeight: "800" },
  dropArrow: { color: colors.gold, fontSize: 10 },
  dropList: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, overflow: "hidden", backgroundColor: colors.ink },
  dropItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12 },
  dropItemText: { color: colors.fog, fontSize: 13.5, fontWeight: "700" },
  dropConn: { color: colors.bull, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10 },
  conn: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, gap: 4, backgroundColor: colors.ink },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { color: colors.snow, fontSize: 13.5, fontWeight: "800" },
  hintKey: { color: colors.dim, fontSize: 11, fontWeight: "400" },
  status: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  error: { color: colors.bear, fontSize: 11.5, lineHeight: 16 },
  notice: { borderWidth: 1, borderColor: colors.gold + "66", borderRadius: 8, padding: 12, gap: 8 },
  stepTitle: { color: colors.gold, fontSize: 10.5, fontWeight: "800", letterSpacing: 1.4 },
  link: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  label: { color: colors.fog, fontSize: 9.5, fontWeight: "700", letterSpacing: 1 },
  input: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: colors.snow, fontSize: 14 },
  chip: { flex: 1, minWidth: 72, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontWeight: "800", fontSize: 12.5 },
  btn: { backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "800", fontSize: 12.5, letterSpacing: 0.5 },
  outline: { borderWidth: 1, borderColor: colors.gold + "88", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  outlineText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
});

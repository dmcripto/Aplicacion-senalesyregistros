import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { BOT_ASSETS, DEFAULT_BOT, fmtDateTime, fmtR, t } from "@dmcripto/core";
import type { BotBacktest, BotSettings, BotStatsRow } from "@dmcripto/core";
import { fetchBotSettings, runBotBacktest, saveBotSettings } from "./tradesApi";
import { colors } from "./theme";

const short = (s: string) => s.replace("USDT", "");
const rColor = (r: number) => (r > 0 ? colors.bull : r < 0 ? colors.bear : colors.fog);

function Line({ s }: { s: BotStatsRow }) {
  if (!s.n) return <Text style={st.dim}>{t("sin operaciones")}</Text>;
  return (
    <Text style={st.hint}>
      {s.n} {t("ops")} · {Math.round(s.winRate)}% ·{" "}
      <Text style={{ color: rColor(s.expectancy), fontWeight: "800" }}>{fmtR(s.expectancy)}R</Text>
    </Text>
  );
}

/** Bot automático en modo simulado: interruptor, activos, límites y prueba con el historial. */
export default function BotSection({ userId, titleStyle }: { userId: string; titleStyle?: StyleProp<TextStyle> }) {
  const [s, setS] = useState<BotSettings>(DEFAULT_BOT);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false); // solo se muestra si el servidor ya tiene la tabla del bot
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<Extract<BotBacktest, { ok: true }> | null>(null);

  useEffect(() => {
    fetchBotSettings(userId)
      .then((v) => {
        setS(v);
        setAvailable(true);
      })
      .catch(() => setAvailable(false)) // la tabla todavía no existe en el servidor: no se muestra nada
      .finally(() => setReady(true));
  }, [userId]);

  const update = async (patch: Partial<BotSettings>) => {
    const next = { ...s, ...patch };
    if (!next.symbols.length) return Alert.alert(t("Error"), t("Dejá al menos un activo."));
    const prev = s;
    setS(next);
    try {
      await saveBotSettings(userId, next);
    } catch (e) {
      setS(prev);
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    }
  };

  const toggleSymbol = (a: string) => update({ symbols: s.symbols.includes(a) ? s.symbols.filter((x) => x !== a) : [...s.symbols, a] });

  const probar = async () => {
    setBusy(true);
    setTest(null);
    try {
      const r = await runBotBacktest(s.symbols, 120);
      if (!r.ok) Alert.alert(t("Error"), r.error ?? t("No se pudo hacer la prueba."));
      else setTest(r as Extract<BotBacktest, { ok: true }>);
    } finally {
      setBusy(false);
    }
  };

  const verdict = (b: Extract<BotBacktest, { ok: true }>) => {
    const tot = b.total;
    if (tot.n === 0) return t("En este tramo no hubo ninguna señal.");
    if (tot.expectancy <= 0) return t("En este tramo la estrategia no ganó: promedió {e} por operación. No tiene sentido pasarla a dinero real.", { e: `${fmtR(tot.expectancy)}R` });
    if (tot.n < 30) return t("Dio {e} por operación, pero con {n} operaciones no alcanza para concluir nada.", { e: `${fmtR(tot.expectancy)}R`, n: tot.n });
    return t("Dio {e} por operación en {n} operaciones. Es una prueba sobre el pasado: lo que importa es cómo se comporta de ahora en adelante en modo simulado.", { e: `${fmtR(tot.expectancy)}R`, n: tot.n });
  };

  if (!available) return null;

  return (
    <>
    <Text style={titleStyle}>{t("BOT AUTOMÁTICO")}</Text>
    <View style={st.card}>
      <View style={st.row}>
        <View style={{ flex: 1 }}>
          <Text style={st.name}>{s.enabled ? t("Bot encendido") : t("Bot apagado")}</Text>
          <Text style={st.hint}>
            {s.enabled
              ? s.lastTickAt
                ? t("Última revisión: {when}", { when: fmtDateTime(s.lastTickAt) })
                : t("Esperando la primera revisión del servidor…")
              : t("No anota ninguna operación.")}
          </Text>
        </View>
        <Switch value={s.enabled} disabled={!ready} onValueChange={(v) => update({ enabled: v })} trackColor={{ true: colors.bull + "88", false: colors.line }} thumbColor={s.enabled ? colors.bull : colors.fog} />
      </View>

      <View style={st.notice}>
        <Text style={st.hint}>
          {t("Por ahora el bot opera en modo simulado: cuando la estrategia da una señal la anota como una operación en tu diario (con la etiqueta «Bot simulado») y la cierra cuando el precio toca el objetivo o el stop. No toca tu exchange ni tu dinero. Así medimos si funciona antes de pensar en operaciones reales.")}
        </Text>
      </View>

      <Text style={st.label}>{t("Activos")}</Text>
      <View style={st.wrap}>
        {BOT_ASSETS.map((a) => (
          <TouchableOpacity key={a} style={[st.chip, s.symbols.includes(a) && st.chipOn]} onPress={() => toggleSymbol(a)}>
            <Text style={[st.chipText, s.symbols.includes(a) && { color: colors.ink }]}>{short(a)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={st.label}>{t("Operaciones abiertas a la vez")}</Text>
      <View style={st.wrap}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} style={[st.chip, s.maxOpen === n && st.chipOn]} onPress={() => update({ maxOpen: n })}>
            <Text style={[st.chipText, s.maxOpen === n && { color: colors.ink }]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={st.label}>{t("Pérdida máxima por día")}</Text>
      <View style={st.wrap}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} style={[st.chip, s.dailyLossR === n && st.chipOn]} onPress={() => update({ dailyLossR: n })}>
            <Text style={[st.chipText, s.dailyLossR === n && { color: colors.ink }]}>{n}R</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={st.label}>{t("Cómo decide")}</Text>
      <Text style={st.hint}>• {t("Mira velas de 1 hora ya cerradas, nunca el futuro.")}</Text>
      <Text style={st.hint}>• {t("Solo compra si la tendencia es alcista (media de 50 velas sobre la de 200) y solo vende si es bajista.")}</Text>
      <Text style={st.hint}>• {t("Entra cuando el precio rompe el máximo (o mínimo) de las últimas 20 velas.")}</Text>
      <Text style={st.hint}>• {t("Stop a 1,5 veces el ATR (el rango normal del activo). Objetivo: el doble de lo arriesgado (2R).")}</Text>
      <Text style={st.hint}>• {t("Una operación por activo a la vez. Si llegás a la pérdida máxima del día, no abre más hasta mañana.")}</Text>

      <TouchableOpacity style={st.outline} onPress={probar} disabled={busy || !ready}>
        {busy ? <ActivityIndicator color={colors.gold} /> : <Text style={st.outlineText}>{t("Probar con los últimos 4 meses")}</Text>}
      </TouchableOpacity>
      {test && (
        <View style={{ gap: 6 }}>
          <View style={st.notice}>
            <Text style={[st.hint, { color: colors.snow }]}>{verdict(test)}</Text>
          </View>
          <View style={st.row}>
            <Text style={st.hint}>{t("Operaciones")}: {test.total.n}</Text>
            <Text style={st.hint}>{t("Acierto")}: {Math.round(test.total.winRate)}%</Text>
          </View>
          <View style={st.row}>
            <Text style={st.hint}>
              {t("Promedio por operación")}: <Text style={{ color: rColor(test.total.expectancy), fontWeight: "800" }}>{fmtR(test.total.expectancy)}R</Text>
            </Text>
            <Text style={st.hint}>
              {t("Peor caída")}: <Text style={{ color: colors.bear, fontWeight: "800" }}>{test.total.maxDrawdownR.toFixed(1).replace(/\.0$/, "")}R</Text>
            </Text>
          </View>
          {test.symbols.map((x) => (
            <View key={x.symbol} style={st.row}>
              <Text style={st.name}>{short(x.symbol)}</Text>
              {x.error ? <Text style={[st.hint, { color: colors.bear }]}>{t("sin datos")}</Text> : <Line s={x.stats} />}
            </View>
          ))}
          <Text style={st.dim}>
            {t("Prueba sobre los últimos {d} días de precios reales, con un costo de comisión y deslizamiento incluido. Si una vela toca stop y objetivo a la vez se cuenta el stop. El pasado no garantiza el futuro: la prueba de verdad es el modo simulado, día a día.", { d: test.days })}
          </Text>
        </View>
      )}
      <Text style={st.dim}>{t("Es una herramienta de práctica y estudio. No es asesoramiento financiero ni garantiza ganancias.")}</Text>
    </View>
    </>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { color: colors.snow, fontSize: 13.5, fontWeight: "800" },
  hint: { color: colors.fog, fontSize: 11.5, lineHeight: 17 },
  dim: { color: colors.dim, fontSize: 10.5, lineHeight: 15 },
  label: { color: colors.fog, fontSize: 9.5, fontWeight: "700", letterSpacing: 1, marginTop: 4 },
  notice: { borderWidth: 1, borderColor: colors.gold + "66", borderRadius: 8, padding: 12, gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minWidth: 56, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontWeight: "800", fontSize: 12.5 },
  outline: { borderWidth: 1, borderColor: colors.gold + "88", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  outlineText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
});

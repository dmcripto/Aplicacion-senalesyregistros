import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { DEFAULT_LIVE, LIVE_EXCHANGES, LIVE_LIMITS, ago, clampLive, liveExchangeName, liveKeyGuide, liveNeedsPass, liveStatusLabel, t } from "@dmcripto/core";
import type { LiveSettings } from "@dmcripto/core";
import { useBot } from "./botStore";
import { supabase } from "./supabaseClient";
import { connectTradeKey, disconnectTradeKey, fetchLive, liveStop, saveLive, switchLiveExchange, testLiveOrder } from "./tradesApi";
import type { LiveView } from "./tradesApi";
import { mfaErrorText, useMfa } from "./MfaSection";
import { colors } from "./theme";

function Num({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flex: 1, minWidth: "45%" }}>
      <Text style={s.label}>{name}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={s.input} placeholderTextColor={colors.dim} />
    </View>
  );
}

/** Bot con dinero real (prueba mínima) con el exchange que cada persona elija. Solo aparece en cuentas con la llave beta y con el servidor listo. */
export default function LiveSection({ titleStyle }: { titleStyle?: StyleProp<TextStyle> }) {
  const bot = useBot();
  const mfa = useMfa();
  const [userId, setUserId] = useState<string | null>(null);
  const [view, setView] = useState<LiveView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPass, setApiPass] = useState("");
  const [openList, setOpenList] = useState(false);
  const [lim, setLim] = useState({ margin: "4", risk: "0.1", lev: "10", daily: "0.5" });
  const [report, setReport] = useState<{ title: string; steps: string[]; ok: boolean } | null>(null);
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
  }, []);

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      const v = await fetchLive(userId);
      setView(v);
      setLim({ margin: String(v.live.maxMarginUsdt), risk: String(v.live.riskUsdt), lev: String(v.live.maxLeverage), daily: String(v.live.dailyLossUsdt) });
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, [userId]);

  useEffect(() => {
    if (bot.status === "ready") void reload();
  }, [bot.status, reload]);

  if (bot.status !== "ready" || unavailable || !view || !userId) return null;
  const live: LiveSettings = view.live;
  // El exchange que se está mirando: el activo del bot, o el que la persona tocó para conectarlo.
  const shown = pick ?? view.exchange;
  const exName = liveExchangeName(shown);
  const hasShownKey = !!view.keys[shown];
  const hint = view.keys[shown] ?? view.keyHint;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo completar."));
    } finally {
      setBusy(null);
    }
  };

  const choose = (id: string) =>
    run("exchange", async () => {
      setPick(id);
      // Si ya tiene clave guardada ahí, se pasa a ese exchange (queda apagado; la prueba ya hecha en ese exchange se conserva); si no, se muestra para conectarla.
      if (id !== view.exchange && view.keys[id]) {
        const r = await switchLiveExchange(id);
        if (!r.ok) return Alert.alert(t("Error"), r.error ?? t("No se pudo cambiar de exchange."));
        setPick(null);
        Alert.alert(t("Listo"), r.verified ? t("Ahora el bot real usa {x}. Quedó apagado; su prueba real ya estaba hecha.", { x: liveExchangeName(id) }) : t("Ahora el bot real usa {x}. Quedó apagado: falta su prueba real.", { x: liveExchangeName(id) }));
        await reload();
      }
    });

  const connect = () =>
    run("connect", async () => {
      if (!(await mfa.ask(t("Vas a guardar una clave de {x} con permiso de operar.", { x: exName })))) return;
      const r = await connectTradeKey(apiKey.trim(), apiSecret.trim(), shown, apiPass.trim());
      if (!r.ok) return Alert.alert(t("Error"), r.code === "mfa_required" ? mfaErrorText(new Error("mfa_required"), "") : (r.error ?? t("No se pudo conectar.")));
      setApiKey("");
      setApiSecret("");
      setApiPass("");
      setPick(null);
      Alert.alert(t("Listo"), t("Clave guardada. Saldo disponible en futuros: {n} USDT.", { n: (r.available ?? 0).toFixed(2) }));
      await reload();
    });

  const disconnect = () =>
    Alert.alert(t("Borrar clave"), t("Vas a borrar la clave de {x} del bot.", { x: exName }), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Borrar clave"),
        style: "destructive",
        onPress: () =>
          run("disconnect", async () => {
            const r = await disconnectTradeKey(shown);
            if (!r.ok) return Alert.alert(t("Error"), r.error ?? t("No se pudo desconectar."));
            await reload();
          }),
      },
    ]);

  const preview = () =>
    run("preview", async () => {
      const r = await testLiveOrder(false);
      setReport({ title: t("Esto es lo que se enviaría (no se envió nada)"), steps: [...(r.steps ?? []), ...(r.error ? [`⚠️ ${r.error}`] : [])], ok: r.ok });
      await reload();
    });

  const realTest = () =>
    Alert.alert(t("Hacer la orden real de prueba"), t("Envía UNA orden mínima de BTCUSDT con stop y objetivo, confirma que aparece la posición y la cierra enseguida. Cuesta unos centavos de comisión. Solo si sale perfecta se habilita enviar órdenes reales."), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Hacer la orden real de prueba"),
        onPress: () =>
          run("test", async () => {
            if (!(await mfa.ask(t("Vas a enviar una orden real mínima a {x} y cerrarla enseguida.", { x: exName })))) return;
            const r = await testLiveOrder(true);
            if (!r.ok && r.code === "mfa_required") return Alert.alert(t("Error"), mfaErrorText(new Error("mfa_required"), ""));
            setReport({ title: r.verified ? t("Prueba real superada") : t("La prueba real no salió completa"), steps: [...(r.steps ?? []), ...(r.error ? [`⚠️ ${r.error}`] : [])], ok: !!r.verified });
            await reload();
          }),
      },
    ]);

  const patch = (p: Parameters<typeof saveLive>[1], okMsg?: string) =>
    run("save", async () => {
      await saveLive(userId, p);
      if (okMsg) Alert.alert(t("Listo"), okMsg);
      await reload();
    });

  const saveLimits = () =>
    patch(
      {
        maxMarginUsdt: clampLive(Number(lim.margin.replace(",", ".")), 1, LIVE_LIMITS.maxMarginUsdt, DEFAULT_LIVE.maxMarginUsdt),
        riskUsdt: clampLive(Number(lim.risk.replace(",", ".")), 0.01, LIVE_LIMITS.riskUsdt, DEFAULT_LIVE.riskUsdt),
        maxLeverage: Math.round(clampLive(Number(lim.lev.replace(",", ".")), 1, LIVE_LIMITS.maxLeverage, DEFAULT_LIVE.maxLeverage)),
        dailyLossUsdt: clampLive(Number(lim.daily.replace(",", ".")), 0.05, LIVE_LIMITS.dailyLossUsdt, DEFAULT_LIVE.dailyLossUsdt),
      },
      t("Topes guardados."),
    );

  const stop = () =>
    Alert.alert(t("Apagar todo y cerrar posiciones"), t("Apaga el bot real, cancela las órdenes pendientes y cierra las posiciones abiertas. Siempre revisá {x} por las dudas.", { x: exName }), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Confirmar: apagar y cerrar todo ahora"),
        style: "destructive",
        onPress: () =>
          run("stop", async () => {
            const r = await liveStop();
            setReport({ title: r.ok ? t("Todo apagado") : t("Apagado con avisos: revisá {x}", { x: exName }), steps: r.steps ?? [], ok: !!r.ok });
            await reload();
          }),
      },
    ]);

  const mode = live.enabled ? (live.dryRun ? t("En seco") : t("Enviando órdenes reales")) : t("Apagado");

  return (
    <>
      <Text style={titleStyle ?? s.title}>{t("BOT CON DINERO REAL")}</Text>
      <View style={s.card}>
        <View style={s.warn}>
          <Text style={{ color: colors.bear, fontWeight: "800", fontSize: 12.5 }}>{"⚠️ "}{t("Esto opera con plata de verdad")}</Text>
          <Text style={s.hint}>{t("La estrategia todavía no demostró ganar: con montos tan chicos las comisiones pueden pesar más que cualquier ganancia. Usalo solo para comprobar que todo funciona, con plata que puedas perder. Nunca se usan retiros.")}</Text>
                  <Text style={[s.hint, { color: colors.snow, fontWeight: "700" }]}>{t("Esto no constituye un consejo de inversión ni asesoramiento financiero. Cada persona decide y opera bajo su propia responsabilidad, y puede perder todo lo que arriesga.")}</Text>
        </View>

        <Text style={s.label}>{t("Exchange del bot real")}</Text>
        <TouchableOpacity disabled={busy != null} onPress={() => setOpenList((o) => !o)} style={[s.chip, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, busy != null && { opacity: 0.5 }]}>
          <Text style={s.chipText}>{liveExchangeName(shown)}{shown === view.exchange && view.keys[shown] ? ` · ${t("en uso por el bot")}` : view.keys[shown] ? ` · ${t("clave guardada")}` : ` · ${t("sin clave")}`}</Text>
          <Text style={{ color: colors.gold }}>{openList ? "▴" : "▾"}</Text>
        </TouchableOpacity>
        {openList && (
          <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, overflow: "hidden" }}>
            {LIVE_EXCHANGES.map((id) => (
              <TouchableOpacity key={id} disabled={busy != null} onPress={() => { setOpenList(false); choose(id); }} style={{ paddingVertical: 11, paddingHorizontal: 14, backgroundColor: shown === id ? colors.gold : "transparent" }}>
                <Text style={[s.chipText, shown === id && { color: colors.ink }]}>{liveExchangeName(id)}{id === view.exchange && view.keys[id] ? ` · ${t("en uso por el bot")}` : view.keys[id] ? ` · ${t("clave guardada")}` : ` · ${t("sin clave")}`}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={s.hint}>{t("Elegí el exchange donde vos podés crear la clave de API. Cada uno tiene su propia clave y su propia prueba.")}</Text>

        {!hasShownKey ? (
          <>
            <Text style={s.hint}>{liveKeyGuide(shown)}</Text>
            <Text style={s.label}>{t("Clave (API key)")}</Text>
            <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} style={s.input} />
            <Text style={s.label}>{t("Clave secreta (secret)")}</Text>
            <TextInput value={apiSecret} onChangeText={setApiSecret} autoCapitalize="none" autoCorrect={false} secureTextEntry style={s.input} />
            {liveNeedsPass(shown) && (
              <>
                <Text style={s.label}>{t("Contraseña de la API (passphrase)")}</Text>
                <TextInput value={apiPass} onChangeText={setApiPass} autoCapitalize="none" autoCorrect={false} secureTextEntry style={s.input} />
              </>
            )}
            <TouchableOpacity style={[s.outline, (busy != null || apiKey.trim().length < 8 || apiSecret.trim().length < 8 || (liveNeedsPass(shown) && !apiPass.trim())) && { opacity: 0.4 }]} disabled={busy != null || apiKey.trim().length < 8 || apiSecret.trim().length < 8 || (liveNeedsPass(shown) && !apiPass.trim())} onPress={connect}>
              {busy === "connect" ? <ActivityIndicator color={colors.gold} /> : <Text style={s.outlineText}>{t("Guardar clave de {x}", { x: exName })}</Text>}
            </TouchableOpacity>
          </>
        ) : shown !== view.exchange ? (
          <TouchableOpacity style={[s.outline, busy != null && { opacity: 0.4 }]} disabled={busy != null} onPress={() => choose(shown)}>
            <Text style={s.outlineText}>{t("Usar {x} para el bot real", { x: exName })}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={s.hint}>
              {"✅ "}{t("Clave guardada")} ····{hint} · <Text style={{ color: live.verified ? colors.bull : colors.gold, fontWeight: "800" }}>{live.verified ? t("Prueba real superada") : t("Falta la prueba real")}</Text>
            </Text>
            <TouchableOpacity onPress={disconnect} disabled={busy != null}>
              <Text style={[s.hint, { textDecorationLine: "underline" }]}>{t("Borrar clave")}</Text>
            </TouchableOpacity>
            {live.lastError && <Text style={[s.hint, { color: colors.bear }]}>{"⚠️ "}{live.lastError}</Text>}

            <Text style={s.label}>{t("Paso 1 · Probar sin riesgo")}</Text>
            <Text style={s.hint}>{t("Lee tu saldo y las reglas de BTCUSDT y arma la orden mínima, pero no envía nada.")}</Text>
            <TouchableOpacity style={[s.outline, busy != null && { opacity: 0.4 }]} disabled={busy != null} onPress={preview}>
              {busy === "preview" ? <ActivityIndicator color={colors.gold} /> : <Text style={s.outlineText}>{t("Ver qué enviaría (sin enviar)")}</Text>}
            </TouchableOpacity>

            <Text style={s.label}>{t("Paso 2 · Orden real de prueba")}</Text>
            <TouchableOpacity style={[s.btn, busy != null && { opacity: 0.4 }]} disabled={busy != null} onPress={realTest}>
              {busy === "test" ? <ActivityIndicator color={colors.ink} /> : <Text style={s.btnText}>{t("Hacer la orden real de prueba")}</Text>}
            </TouchableOpacity>

            <Text style={s.label}>{t("Topes de seguridad")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Num name={t("Margen máximo (USDT)")} value={lim.margin} onChange={(v) => setLim({ ...lim, margin: v })} />
              <Num name={t("Riesgo por operación (USDT)")} value={lim.risk} onChange={(v) => setLim({ ...lim, risk: v })} />
              <Num name={t("Apalancamiento máximo")} value={lim.lev} onChange={(v) => setLim({ ...lim, lev: v })} />
              <Num name={t("Pérdida máxima por día (USDT)")} value={lim.daily} onChange={(v) => setLim({ ...lim, daily: v })} />
            </View>
            <Text style={s.hint}>{t("Una sola posición abierta a la vez. Si hay 3 errores seguidos, el bot real se apaga solo.")}</Text>
            <TouchableOpacity style={[s.outline, busy != null && { opacity: 0.4 }]} disabled={busy != null} onPress={saveLimits}>
              <Text style={s.outlineText}>{t("Guardar topes")}</Text>
            </TouchableOpacity>

            <Text style={s.label}>{t("Paso 3 · Encender")}</Text>
            <View style={s.row}>
              <Text style={s.rowText}>{t("Bot real encendido")}</Text>
              <Switch value={live.enabled} disabled={busy != null} onValueChange={(v) => patch({ enabled: v })} trackColor={{ true: colors.gold, false: colors.line }} />
            </View>
            <View style={[s.row, !live.verified && { opacity: 0.5 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowText}>{t("Enviar órdenes de verdad")}</Text>
                <Text style={s.hint}>{live.verified ? t("Si lo apagás, el bot solo arma las órdenes «en seco» y las anota.") : t("Se habilita después de la orden real de prueba.")}</Text>
              </View>
              <Switch value={!live.dryRun} disabled={busy != null || !live.verified} onValueChange={(v) => patch({ dryRun: !v })} trackColor={{ true: colors.gold, false: colors.line }} />
            </View>
            <Text style={s.hint}>
              {t("Modo actual")}: <Text style={{ color: colors.snow, fontWeight: "800" }}>{mode}</Text>
            </Text>

            <TouchableOpacity style={[s.danger, busy != null && { opacity: 0.4 }]} disabled={busy != null} onPress={stop}>
              <Text style={s.dangerText}>{"⛔ "}{t("Apagar todo y cerrar posiciones")}</Text>
            </TouchableOpacity>
          </>
        )}

        {report && (
          <View style={[s.report, { borderColor: report.ok ? colors.bull + "66" : colors.gold + "66" }]}>
            <Text style={{ color: colors.snow, fontWeight: "800", fontSize: 12.5 }}>{report.title}</Text>
            {report.steps.map((x, i) => (
              <Text key={i} style={s.hint}>{x}</Text>
            ))}
          </View>
        )}

        {view.orders.length > 0 && (
          <>
            <Text style={s.label}>{t("Últimas órdenes del bot real")}</Text>
            {view.orders.map((o) => (
              <View key={o.id} style={s.order}>
                <Text style={{ color: colors.snow, fontWeight: "800", fontSize: 12 }}>
                  {o.symbol} · <Text style={{ color: o.status === "sent" ? colors.bull : o.status === "rejected" || o.status === "error" ? colors.bear : colors.dim }}>{liveStatusLabel(o.status)}</Text>
                  {o.kind !== "bot" ? ` · ${o.kind === "test" ? t("prueba") : t("apagado")}` : ""} · {ago(o.createdAt, Date.now())}
                </Text>
                {o.note && <Text style={s.hint}>{o.note}</Text>}
              </View>
            ))}
          </>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  title: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginTop: 6, marginBottom: 8 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10 },
  warn: { borderWidth: 1, borderColor: colors.bear + "66", backgroundColor: colors.bear + "11", borderRadius: 8, padding: 12, gap: 4 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  label: { color: colors.fog, fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 4 },
  input: { color: colors.snow, fontSize: 14, backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  btn: { backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
  outline: { borderWidth: 1, borderColor: colors.gold + "88", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center" },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontWeight: "800", fontSize: 12.5 },
  outlineText: { color: colors.gold, fontWeight: "800", fontSize: 12, textAlign: "center" },
  danger: { borderWidth: 1, borderColor: colors.bear, backgroundColor: colors.bear + "22", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 6 },
  dangerText: { color: colors.bear, fontWeight: "800", fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowText: { color: colors.snow, fontSize: 13 },
  report: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 4 },
  order: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, gap: 2 },
});

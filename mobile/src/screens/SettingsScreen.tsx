import { useEffect, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { balanceInfo, fmtCurrency, tradesToCsv } from "@dmcripto/core";
import type { DailyLimits, DailyStatus, MoneySettings, Trade } from "@dmcripto/core";
import { supabase } from "../supabaseClient";
import { deleteAllTrades, deleteMyAccount, fetchAutoClose, fetchDailySummary, fetchPartialAlerts, setPartialAlerts, fetchWebhookUrl, fetchWhatsappButton, setWhatsappButton, regenerateWebhookUrl, setAutoClose, setDailySummary } from "../tradesApi";
import AlertBuilder from "../AlertBuilder";
import { CommunityCard } from "../components";
import { sendTestPush, setupPush } from "../push";
import type { PushStatus } from "../push";
import { disclaimer, LEGAL_LINKS, openLink } from "../legal";
import { colors } from "../theme";
import { LangSwitch } from "../lang";
import ExchangeSection from "../ExchangeSection";
import TelegramSection from "../TelegramSection";
import WhatsAppSection from "../WhatsAppSection";
import { useMoney } from "../money";
import { t } from "@dmcripto/core";

export default function SettingsScreen({
  userId,
  email,
  trades,
  limits,
  limitStatus,
  onSaveLimits,
  onSaveMoney,
}: {
  userId: string;
  email?: string;
  trades: Trade[];
  limits: DailyLimits;
  limitStatus: DailyStatus;
  onSaveLimits: (l: DailyLimits) => Promise<void>;
  onSaveMoney: (m: MoneySettings) => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoClose, setAutoCloseState] = useState(true);
  const [dailySummary, setDailySummaryState] = useState(true);
  const [waButton, setWaButtonState] = useState(false);
  const [partialAlerts, setPartialAlertsState] = useState(true);
  const [lossStr, setLossStr] = useState("");
  const [tradesStr, setTradesStr] = useState("");

  useEffect(() => {
    setLossStr(limits.maxLossR == null ? "" : String(limits.maxLossR));
    setTradesStr(limits.maxTrades == null ? "" : String(limits.maxTrades));
  }, [limits]);

  const positive = (v: string) => {
    const n = Number(v.replace(",", "."));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  const saveLimitsNow = () =>
    onSaveLimits({ maxLossR: positive(lossStr), maxTrades: positive(tradesStr) ? Math.round(positive(tradesStr)!) : null })
      .then(() => Alert.alert(t("Listo"), t("Límites guardados.")))
      .catch((e) => Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudieron guardar los límites.")));

  const { money, unit } = useMoney();
  const [capStr, setCapStr] = useState("");
  const [riskStr, setRiskStr] = useState("");
  const [curStr, setCurStr] = useState("USD");
  useEffect(() => {
    setCapStr(money.capital == null ? "" : String(money.capital));
    setRiskStr(money.riskPct == null ? "" : String(money.riskPct));
    setCurStr(money.currency);
  }, [money]);
  const bal = balanceInfo(trades, money);
  const saveMoneyNow = () => {
    const risk = positive(riskStr);
    if (risk != null && risk > 100) return Alert.alert(t("Revisá el riesgo"), t("El riesgo por operación no puede pasar de 100 %."));
    return onSaveMoney({
      capital: positive(capStr),
      riskPct: risk,
      currency: curStr.trim().toUpperCase().slice(0, 5) || "USD",
    })
      .then(() => Alert.alert(t("Listo"), t("Capital guardado. Ahora ves tus resultados también en dinero.")))
      .catch((e) => Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar.")));
  };

  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const checkPush = async () => {
    setPushBusy(true);
    setPushNote(null);
    try {
      setPush(await setupPush(userId));
    } finally {
      setPushBusy(false);
    }
  };

  const testPush = async () => {
    if (!push?.token) return;
    setPushBusy(true);
    try {
      setPushNote(await sendTestPush(push.token));
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    checkPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    fetchAutoClose(userId).then(setAutoCloseState).catch(() => {});
    fetchDailySummary(userId).then(setDailySummaryState).catch(() => {});
    fetchWhatsappButton(userId).then(setWaButtonState).catch(() => {});
    fetchPartialAlerts(userId).then(setPartialAlertsState).catch(() => {});
  }, [userId]);

  const toggleDailySummary = (value: boolean) => {
    setDailySummaryState(value);
    setDailySummary(userId, value).catch((e) => {
      setDailySummaryState(!value);
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    });
  };

  const togglePartialAlerts = (value: boolean) => {
    setPartialAlertsState(value);
    setPartialAlerts(userId, value).catch((e) => {
      setPartialAlertsState(!value);
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    });
  };

  const toggleWaButton = (value: boolean) => {
    setWaButtonState(value);
    setWhatsappButton(userId, value).catch((e) => {
      setWaButtonState(!value);
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    });
  };

  const toggleAutoClose = (value: boolean) => {
    setAutoCloseState(value);
    setAutoClose(userId, value).catch((e) => {
      setAutoCloseState(!value);
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    });
  };

  useEffect(() => {
    let cancelled = false;
    fetchWebhookUrl(userId)
      .then((u) => !cancelled && setUrl(u))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : t("No se pudo obtener la URL.")));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const copy = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerate = () =>
    Alert.alert(
      t("Regenerar URL del webhook"),
      t("La URL actual dejará de funcionar. Vas a tener que actualizarla en tus alertas de TradingView."),
      [
        { text: t("Cancelar"), style: "cancel" },
        {
          text: t("Regenerar"),
          style: "destructive",
          onPress: () =>
            regenerateWebhookUrl()
              .then(setUrl)
              .catch((e) => Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo regenerar la URL."))),
        },
      ],
    );
  const deleteAccount = () =>
    Alert.alert(
      t("Eliminar mi cuenta"),
      t("Se borran tu cuenta y todos tus datos (operaciones, webhook y dispositivos) de forma permanente. No se puede deshacer."),
      [
        { text: t("Cancelar"), style: "cancel" },
        {
          text: t("Eliminar todo"),
          style: "destructive",
          onPress: () =>
            deleteMyAccount().catch((e) => Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo eliminar la cuenta."))),
        },
      ],
    );
  const exportCsv = () => Share.share({ title: t("VELTRIX diario.csv"), message: tradesToCsv(trades) });
  const clearAll = () =>
    Alert.alert(t("Borrar todo el diario"), t("Se eliminan todas tus operaciones (también en la web). No se puede deshacer."), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Borrar todo"),
        style: "destructive",
        onPress: () => deleteAllTrades(userId).catch((e) => Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo borrar."))),
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16 }}>
      <CommunityCard />

      <Text style={styles.sectionTitle}>{t("IDIOMA")} / LANGUAGE</Text>
      <View style={styles.card}>
        <LangSwitch wide />
      </View>

      <Text style={styles.sectionTitle}>{t("CAPITAL Y DINERO")}</Text>
      <View style={styles.card}>
        {bal ? (
          <Text style={[styles.hint, { color: colors.snow, fontWeight: "800" }]}>
            {t("Balance")} {fmtCurrency(bal.balance, money.currency, false)} · {t("resultado")} {fmtCurrency(bal.pnl, money.currency)}
          </Text>
        ) : (
          <Text style={styles.hint}>{t("Cargá tu capital y el % que arriesgás por operación para ver tus resultados en dinero, no solo en R.")}</Text>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 2, gap: 4 }}>
            <Text style={styles.fieldLabel}>{t("CAPITAL")}</Text>
            <TextInput value={capStr} onChangeText={setCapStr} keyboardType="decimal-pad" placeholder="ej: 1000" placeholderTextColor={colors.dim} style={styles.fieldInput} />
          </View>
          <View style={{ flex: 1.3, gap: 4 }}>
            <Text style={styles.fieldLabel}>{t("RIESGO (%)")}</Text>
            <TextInput value={riskStr} onChangeText={setRiskStr} keyboardType="decimal-pad" placeholder="ej: 1" placeholderTextColor={colors.dim} style={styles.fieldInput} />
          </View>
          <View style={{ flex: 1.2, gap: 4 }}>
            <Text style={styles.fieldLabel}>{t("MONEDA")}</Text>
            <TextInput value={curStr} onChangeText={setCurStr} autoCapitalize="characters" maxLength={5} placeholder="USD" placeholderTextColor={colors.dim} style={styles.fieldInput} />
          </View>
        </View>
        {unit ? <Text style={styles.hint}>{t("1R equivale a")} {fmtCurrency(unit, curStr.trim().toUpperCase() || money.currency, false)}.</Text> : null}
        <TouchableOpacity style={styles.copyBtn} onPress={saveMoneyNow}>
          <Text style={styles.copyText}>{t("Guardar capital")}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>{t("Es una estimación: multiplica tus R por lo que arriesgás. Las tarjetas para compartir siguen mostrando solo R.")}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t("BOT DE TELEGRAM")}</Text>
      <TelegramSection userId={userId} />
      <WhatsAppSection />

      <Text style={styles.sectionTitle}>{t("CONECTAR EXCHANGE")}</Text>
      <ExchangeSection />

      <Text style={styles.sectionTitle}>{t("LÍMITES DIARIOS")}</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          {t("Hoy")}: {limitStatus.lossR.toFixed(1).replace(/\.0$/, "")}R · {limitStatus.trades} {t("operaciones")}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.fieldLabel}>{t("PÉRDIDA MÁX. (R)")}</Text>
            <TextInput value={lossStr} onChangeText={setLossStr} keyboardType="decimal-pad" placeholder={t("ej: 3")} placeholderTextColor={colors.dim} style={styles.fieldInput} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.fieldLabel}>{t("OPERACIONES MÁX.")}</Text>
            <TextInput value={tradesStr} onChangeText={setTradesStr} keyboardType="number-pad" placeholder={t("ej: 5")} placeholderTextColor={colors.dim} style={styles.fieldInput} />
          </View>
        </View>
        <TouchableOpacity style={styles.copyBtn} onPress={saveLimitsNow}>
          <Text style={styles.copyText}>{t("Guardar límites")}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          {t("Dejá un campo vacío para no usar ese límite. Te avisamos al llegar al 80 % y cuando lo alcanzás.")}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>{t("NOTIFICACIONES")}</Text>
      <View style={styles.card}>
        <Text style={[styles.hint, { color: push ? (push.ok ? colors.bull : colors.bear) : colors.dim }]}>
          {push ? push.message : t("Revisando…")}
        </Text>
        {pushNote && <Text style={styles.hint}>{pushNote}</Text>}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={[styles.signOut, { flex: 1 }]} onPress={checkPush} disabled={pushBusy}>
            <Text style={[styles.signOutText, { color: colors.fog }]}>{t("Revisar")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.signOut, { flex: 1, opacity: push?.token ? 1 : 0.4 }]}
            onPress={testPush}
            disabled={pushBusy || !push?.token}
          >
            <Text style={[styles.signOutText, { color: colors.gold }]}>{t("Enviar prueba")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t("CUENTA")}</Text>
      <View style={styles.card}>
        {email && <Text style={styles.email}>{email}</Text>}
        <TouchableOpacity style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>{t("Cerrar sesión")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerLink} onPress={deleteAccount}>
          <Text style={styles.dangerLinkText}>{t("Eliminar mi cuenta y mis datos")}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>{t("CIERRE AUTOMÁTICO")}</Text>
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={[styles.hint, { flex: 1 }]}>
            {t("VELTRIX sigue el precio y marca TP o SL solo cuando el precio los toca (criptomonedas). Si una misma vela toca ambos, se toma SL. Podés apagarlo si preferís cerrar a mano.")}
          </Text>
          <Switch
            value={autoClose}
            onValueChange={toggleAutoClose}
            trackColor={{ false: colors.line2, true: colors.gold }}
            thumbColor={colors.snow}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t("RESUMEN DIARIO")}</Text>
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={[styles.hint, { flex: 1 }]}>
            {t("Cada noche a las 21:00 te mandamos por Telegram y como notificación cómo te fue en el día, con tus rachas. Si ese día no operaste, no te molestamos.")}
          </Text>
          <Switch
            value={dailySummary}
            onValueChange={toggleDailySummary}
            trackColor={{ false: colors.line2, true: colors.gold }}
            thumbColor={colors.snow}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t("AVISO DE TARGET 1")}</Text>
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={[styles.hint, { flex: 1 }]}>
            {t("Cuando una operación abierta avanza 1R a favor, te avisamos (y a tu comunidad) para tomar beneficios parciales y mover el SL a break-even.")}
          </Text>
          <Switch
            value={partialAlerts}
            onValueChange={togglePartialAlerts}
            trackColor={{ false: colors.line2, true: colors.gold }}
            thumbColor={colors.snow}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t("BOTÓN DE WHATSAPP")}</Text>
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={[styles.hint, { flex: 1 }]}>
            {t("Cada aviso del bot de Telegram trae un botón «Enviar a WhatsApp». Lo tocás y se abre WhatsApp con el mensaje armado para elegir a quién mandarlo.")}
          </Text>
          <Switch
            value={waButton}
            onValueChange={toggleWaButton}
            trackColor={{ false: colors.line2, true: colors.gold }}
            thumbColor={colors.snow}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t("DATOS")}</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.signOut} onPress={exportCsv} disabled={!trades.length}>
          <Text style={[styles.signOutText, { color: colors.gold }]}>{t("Exportar diario (CSV)")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.signOut} onPress={clearAll} disabled={!trades.length}>
          <Text style={styles.signOutText}>{t("Borrar todo el diario")}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>{t("CONECTÁ TU FUENTE DE SEÑALES")}</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>{t("Enviá tus señales a esta URL, vengan de donde vengan (TradingView con webhooks, Zapier, Make, n8n, bots propios). Si recibís señales por Telegram o WhatsApp, pegá el mensaje en Registrar → Pegar señal.")}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        {url && (
          <>
            <View style={styles.urlBox}>
              <Text selectable style={styles.urlText}>
                {url}
              </Text>
            </View>
            <TouchableOpacity style={styles.copyBtn} onPress={copy}>
              <Text style={styles.copyText}>{copied ? t("¡Copiado!") : t("Copiar URL")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.signOut} onPress={regenerate}>
              <Text style={[styles.signOutText, { color: colors.fog }]}>Regenerar URL</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <Text style={styles.sectionTitle}>{t("ARMADOR DE ALERTAS")}</Text>
      <View style={styles.card}>
        <AlertBuilder />
      </View>

      <Text style={styles.sectionTitle}>{t("LEGAL")}</Text>
      <View style={styles.card}>
        <TouchableOpacity onPress={() => openLink(LEGAL_LINKS.terms)}>
          <Text style={styles.legalLink}>{t("Términos de uso")}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openLink(LEGAL_LINKS.privacy)}>
          <Text style={styles.legalLink}>{t("Política de privacidad")}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openLink(LEGAL_LINKS.deleteData)}>
          <Text style={styles.legalLink}>{t("Eliminación de datos")}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>{disclaimer()}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sectionTitle: {
    color: colors.fog,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
    gap: 10,
  },
  email: { color: colors.snow, fontSize: 13, fontWeight: "600" },
  signOut: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  signOutText: { color: colors.bear, fontWeight: "700", fontSize: 12 },
  fieldLabel: { color: colors.fog, fontSize: 9.5, fontWeight: "700", letterSpacing: 1 },
  fieldInput: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: colors.snow, fontSize: 14 },
  dangerLink: { alignItems: "center", paddingVertical: 6 },
  dangerLinkText: { color: colors.dim, fontSize: 11.5, textDecorationLine: "underline" },
  legalLink: { color: colors.gold, fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  urlBox: {
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 10,
  },
  urlText: { color: colors.fog, fontSize: 11.5 },
  copyBtn: { backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  copyText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
  error: { color: colors.bear, fontSize: 12 },
});

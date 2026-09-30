import { useEffect, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { tradesToCsv } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { supabase } from "../supabaseClient";
import { deleteAllTrades, deleteMyAccount, fetchAutoClose, fetchWebhookUrl, regenerateWebhookUrl, setAutoClose } from "../tradesApi";
import AlertBuilder from "../AlertBuilder";
import { CommunityCard } from "../components";
import { DISCLAIMER, LEGAL_LINKS, openLink } from "../legal";
import { colors } from "../theme";

export default function SettingsScreen({ userId, email, trades }: { userId: string; email?: string; trades: Trade[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoClose, setAutoCloseState] = useState(true);

  useEffect(() => {
    fetchAutoClose(userId).then(setAutoCloseState).catch(() => {});
  }, [userId]);

  const toggleAutoClose = (value: boolean) => {
    setAutoCloseState(value);
    setAutoClose(userId, value).catch((e) => {
      setAutoCloseState(!value);
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo guardar el cambio.");
    });
  };

  useEffect(() => {
    let cancelled = false;
    fetchWebhookUrl(userId)
      .then((u) => !cancelled && setUrl(u))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "No se pudo obtener la URL."));
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
      "Regenerar URL del webhook",
      "La URL actual dejará de funcionar. Vas a tener que actualizarla en tus alertas de TradingView.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Regenerar",
          style: "destructive",
          onPress: () =>
            regenerateWebhookUrl()
              .then(setUrl)
              .catch((e) => Alert.alert("Error", e instanceof Error ? e.message : "No se pudo regenerar la URL.")),
        },
      ],
    );
  const deleteAccount = () =>
    Alert.alert(
      "Eliminar mi cuenta",
      "Se borran tu cuenta y todos tus datos (operaciones, webhook y dispositivos) de forma permanente. No se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar todo",
          style: "destructive",
          onPress: () =>
            deleteMyAccount().catch((e) => Alert.alert("Error", e instanceof Error ? e.message : "No se pudo eliminar la cuenta.")),
        },
      ],
    );
  const exportCsv = () => Share.share({ title: "VELTRIX diario.csv", message: tradesToCsv(trades) });
  const clearAll = () =>
    Alert.alert("Borrar todo el diario", "Se eliminan todas tus operaciones (también en la web). No se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar todo",
        style: "destructive",
        onPress: () => deleteAllTrades(userId).catch((e) => Alert.alert("Error", e instanceof Error ? e.message : "No se pudo borrar.")),
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16 }}>
      <CommunityCard />

      <Text style={styles.sectionTitle}>CUENTA</Text>
      <View style={styles.card}>
        {email && <Text style={styles.email}>{email}</Text>}
        <TouchableOpacity style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerLink} onPress={deleteAccount}>
          <Text style={styles.dangerLinkText}>Eliminar mi cuenta y mis datos</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>CIERRE AUTOMÁTICO</Text>
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={[styles.hint, { flex: 1 }]}>
            VELTRIX sigue el precio y marca TP o SL solo cuando el precio los toca (criptomonedas). Si una misma vela
            toca ambos, se toma SL. Podés apagarlo si preferís cerrar a mano.
          </Text>
          <Switch
            value={autoClose}
            onValueChange={toggleAutoClose}
            trackColor={{ false: colors.line2, true: colors.gold }}
            thumbColor={colors.snow}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>DATOS</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.signOut} onPress={exportCsv} disabled={!trades.length}>
          <Text style={[styles.signOutText, { color: colors.gold }]}>Exportar diario (CSV)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.signOut} onPress={clearAll} disabled={!trades.length}>
          <Text style={styles.signOutText}>Borrar todo el diario</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>CONECTÁ TU FUENTE DE SEÑALES</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>Enviá tus señales a esta URL, vengan de donde vengan (TradingView con webhooks, Zapier, Make, n8n, bots propios). Si recibís señales por Telegram o WhatsApp, pegá el mensaje en Registrar → Pegar señal.</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        {url && (
          <>
            <View style={styles.urlBox}>
              <Text selectable style={styles.urlText}>
                {url}
              </Text>
            </View>
            <TouchableOpacity style={styles.copyBtn} onPress={copy}>
              <Text style={styles.copyText}>{copied ? "¡Copiado!" : "Copiar URL"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.signOut} onPress={regenerate}>
              <Text style={[styles.signOutText, { color: colors.fog }]}>Regenerar URL</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <Text style={styles.sectionTitle}>ARMADOR DE ALERTAS</Text>
      <View style={styles.card}>
        <AlertBuilder />
      </View>

      <Text style={styles.sectionTitle}>LEGAL</Text>
      <View style={styles.card}>
        <TouchableOpacity onPress={() => openLink(LEGAL_LINKS.terms)}>
          <Text style={styles.legalLink}>Términos de uso</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openLink(LEGAL_LINKS.privacy)}>
          <Text style={styles.legalLink}>Política de privacidad</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openLink(LEGAL_LINKS.deleteData)}>
          <Text style={styles.legalLink}>Eliminación de datos</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>{DISCLAIMER}</Text>
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

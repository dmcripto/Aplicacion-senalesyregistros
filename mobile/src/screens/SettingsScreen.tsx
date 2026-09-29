import { useEffect, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { tradesToCsv } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { supabase } from "../supabaseClient";
import { deleteAllTrades, fetchWebhookUrl } from "../tradesApi";
import AlertBuilder from "../AlertBuilder";
import { colors } from "../theme";

export default function SettingsScreen({ userId, email, trades }: { userId: string; email?: string; trades: Trade[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const exportCsv = () => Share.share({ title: "DMCRIPTO diario.csv", message: tradesToCsv(trades) });
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
      <Text style={styles.sectionTitle}>CUENTA</Text>
      <View style={styles.card}>
        {email && <Text style={styles.email}>{email}</Text>}
        <TouchableOpacity style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>
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

      <Text style={styles.sectionTitle}>WEBHOOK DE TRADINGVIEW</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>Pegá esta URL en el campo "Webhook URL" de tu alerta de TradingView:</Text>
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
          </>
        )}
      </View>

      <Text style={styles.sectionTitle}>ARMADOR DE ALERTAS</Text>
      <View style={styles.card}>
        <AlertBuilder />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
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

import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { EXAMPLE_ALERT } from "@dmcripto/core";
import { supabase } from "../supabaseClient";
import { fetchWebhookUrl } from "../tradesApi";
import { colors } from "../theme";

export default function SettingsScreen({ userId, email }: { userId: string; email?: string }) {
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.sectionTitle}>CUENTA</Text>
      <View style={styles.card}>
        {email && <Text style={styles.email}>{email}</Text>}
        <TouchableOpacity style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Cerrar sesión</Text>
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
        <Text style={styles.hint}>
          En el mensaje de la alerta usá el formato:{"\n"}
          <Text style={styles.code}>{EXAMPLE_ALERT}</Text>
        </Text>
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
  code: { color: colors.gold, fontSize: 11 },
  error: { color: colors.bear, fontSize: 12 },
});

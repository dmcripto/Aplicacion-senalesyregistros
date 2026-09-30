import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../supabaseClient";
import { colors } from "../theme";
import { t } from "@dmcripto/core";

export default function ResetPasswordScreen({ onDone }: { onDone: (notice: string) => void }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      await supabase.auth.signOut();
      onDone(t("Contraseña actualizada — ingresá con tu nueva contraseña."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo actualizar la contraseña."));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>{t("Nueva contraseña")}</Text>
        <Text style={styles.subtitle}>{t("ELEGÍ UNA CONTRASEÑA NUEVA")}</Text>

        <Text style={styles.label}>{t("Contraseña nueva")}</Text>
        <View style={styles.passwordRow}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.dim}
            secureTextEntry={!showPassword}
            style={[styles.input, styles.passwordInput]}
          />
          <TouchableOpacity
            style={styles.showBtn}
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.showBtnText}>{showPassword ? t("Ocultar") : t("Ver")}</Text>
          </TouchableOpacity>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.submit} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.submitText}>{t("Guardar contraseña")}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
  },
  title: { color: colors.snow, fontSize: 22, fontWeight: "800", textAlign: "center", letterSpacing: 1 },
  subtitle: {
    color: colors.fog,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 20,
  },
  label: { color: colors.fog, fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.snow,
    fontSize: 14,
  },
  passwordRow: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 56 },
  showBtn: { position: "absolute", right: 12 },
  showBtnText: { color: colors.gold, fontSize: 11.5, fontWeight: "700" },
  error: { color: colors.bear, fontSize: 12, marginTop: 12 },
  submit: {
    backgroundColor: colors.gold,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 20,
  },
  submitText: { color: colors.ink, fontWeight: "800", fontSize: 13, letterSpacing: 1 },
});

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

export default function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setNotice("Cuenta creada. Si tu proyecto pide confirmación por email, revisá tu bandeja de entrada.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>
          DMCRIPTO<Text style={{ color: colors.gold }}>.</Text>
        </Text>
        <Text style={styles.subtitle}>DIARIO DE TRADING · SMC / ICT</Text>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === "login" && styles.tabActive]}
            onPress={() => setMode("login")}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Ingresar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "signup" && styles.tabActive]}
            onPress={() => setMode("signup")}
          >
            <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>Crear cuenta</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="vos@ejemplo.com"
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={styles.input}
        />

        <Text style={styles.label}>Contraseña</Text>
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
            <Text style={styles.showBtnText}>{showPassword ? "Ocultar" : "Ver"}</Text>
          </TouchableOpacity>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}

        <TouchableOpacity style={styles.submit} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.submitText}>{mode === "login" ? "Ingresar" : "Crear cuenta"}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
  },
  title: { color: colors.snow, fontSize: 30, fontWeight: "800", textAlign: "center", letterSpacing: 1 },
  subtitle: {
    color: colors.fog,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 20,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.ink,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: colors.gold },
  tabText: { color: colors.fog, fontWeight: "700", fontSize: 12, letterSpacing: 1 },
  tabTextActive: { color: colors.ink },
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
  notice: { color: colors.cyan, fontSize: 12, marginTop: 12 },
  submit: {
    backgroundColor: colors.gold,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 20,
  },
  submitText: { color: colors.ink, fontWeight: "800", fontSize: 13, letterSpacing: 1 },
});

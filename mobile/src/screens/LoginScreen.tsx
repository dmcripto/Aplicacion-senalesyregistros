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
import { Logo } from "../ui";
import { disclaimer, LEGAL_LINKS, openLink } from "../legal";
import { colors } from "../theme";
import { LangSwitch } from "../lang";
import { t } from "@dmcripto/core";

export default function LoginScreen({ initialNotice }: { initialNotice?: string | null } = {}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        if (!accepted) throw new Error(t("Tenés que aceptar los términos de uso y la política de privacidad."));
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setNotice(t("Cuenta creada. Si tu proyecto pide confirmación por email, revisá tu bandeja de entrada."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo completar la operación."));
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError(t("Ingresá tu email arriba y volvé a tocar el link."));
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "https://veltrix-trading.vercel.app/",
      });
      if (err) throw err;
      setNotice(
        t("Te enviamos un email. Abrí el link desde el navegador (no desde Gmail directamente) para crear tu nueva contraseña en la web."),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo enviar el email."));
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!email.trim()) {
      setError(t("Ingresá tu email arriba y volvé a tocar el link."));
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resend({ type: "signup", email });
      if (err) throw err;
      setNotice(t("Te reenviamos el email de confirmación."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No se pudo reenviar el email."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ alignItems: "center", marginBottom: 12 }}>
        <LangSwitch />
      </View>
      <View style={styles.card}>
        <View style={{ alignItems: "center", marginBottom: 10 }}>
          <Logo size={96} />
        </View>
        <Text style={styles.title}>
          VELTRIX
        </Text>
        <Text style={styles.subtitle}>{t("DIARIO DE TRADING · EN VIVO")}</Text>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === "login" && styles.tabActive]}
            onPress={() => setMode("login")}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>{t("Ingresar")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "signup" && styles.tabActive]}
            onPress={() => setMode("signup")}
          >
            <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>{t("Crear cuenta")}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("vos@ejemplo.com")}
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={styles.input}
        />

        <Text style={styles.label}>{t("Contraseña")}</Text>
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

        <View style={styles.linksRow}>
          <TouchableOpacity onPress={forgotPassword} disabled={busy}>
            <Text style={styles.link}>{t("¿Olvidaste tu contraseña?")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={resendConfirmation} disabled={busy}>
            <Text style={styles.link}>{t("Reenviar confirmación")}</Text>
          </TouchableOpacity>
        </View>

        {mode === "signup" && (
          <TouchableOpacity style={styles.accept} onPress={() => setAccepted((v) => !v)} activeOpacity={0.8}>
            <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
              {accepted && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.acceptText}>
              {t("Acepto los")}{" "}
              <Text style={styles.acceptLink} onPress={() => openLink(LEGAL_LINKS.terms)}>
                {t("términos de uso")}
              </Text>{" "}
              {t("y la")}{" "}
              <Text style={styles.acceptLink} onPress={() => openLink(LEGAL_LINKS.privacy)}>
                {t("política de privacidad")}
              </Text>
              .
            </Text>
          </TouchableOpacity>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}

        <TouchableOpacity style={styles.submit} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.submitText}>{mode === "login" ? t("Ingresar") : t("Crear cuenta")}</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.disclaimer}>{disclaimer()}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: "rgba(16,23,32,0.92)",
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
  linksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 10,
  },
  link: { color: colors.fog, fontSize: 11, fontWeight: "600", textDecorationLine: "underline" },
  accept: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.line2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  checkMark: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  acceptText: { flex: 1, color: colors.fog, fontSize: 12, lineHeight: 18 },
  acceptLink: { color: colors.gold, fontWeight: "700", textDecorationLine: "underline" },
  disclaimer: { color: colors.dim, fontSize: 10, lineHeight: 15, marginTop: 16, textAlign: "center" },
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

import { useRef, useState } from "react";
import { Highlights, Steps, FEATURE_ICON } from "../LandingBits";
import { Icon, TONES } from "../icons";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { supabase } from "../supabaseClient";
import { Logo } from "../ui";
import { disclaimer, LEGAL_LINKS, openLink } from "../legal";
import { colors } from "../theme";
import { cleanInvite } from "@dmcripto/core";
import { LangSwitch } from "../lang";
import { getLang, t, welcomeContent } from "@dmcripto/core";
import LiveDemo from "../LiveDemo";

// Tarjetas reales de los avisos (las mismas que salen en Telegram), en cada idioma.
const CARDS = {
  es: [require("../../assets/welcome/signal-es.png"), require("../../assets/welcome/target-es.png"), require("../../assets/welcome/result-es.png")],
  en: [require("../../assets/welcome/signal-en.png"), require("../../assets/welcome/target-en.png"), require("../../assets/welcome/result-en.png")],
};
const CARD_CAPTIONS = ["1 · Llega la señal", "2 · Aviso de cada target", "3 · Resultado al cerrar"];

/**
 * Tarjeta de función que entra mientras se desplaza la pantalla: aparece desde un costado (alternando izquierda y derecha)
 * con un fundido, y su ícono «salta» al llegar. Va atada al dedo, así que también se revierte al subir.
 */
function FeatureCard({ f, i, scrollY, vh }: { f: { icon: string; title: string; text: string }; i: number; scrollY: Animated.Value; vh: number }) {
  const [y, setY] = useState<number | null>(null);
  const start = (y ?? 100000) - vh + 70; // empieza cuando la tarjeta asoma por abajo
  const range = [start, start + 170];
  const opacity = scrollY.interpolate({ inputRange: range, outputRange: [0, 1], extrapolate: "clamp" });
  const dx = scrollY.interpolate({ inputRange: range, outputRange: [i % 2 ? 70 : -70, 0], extrapolate: "clamp" });
  const iconScale = scrollY.interpolate({ inputRange: [start + 30, start + 210], outputRange: [0.3, 1], extrapolate: "clamp", easing: Easing.out(Easing.back(3)) });
  return (
    <Animated.View onLayout={(e) => setY(e.nativeEvent.layout.y)} style={[styles.feature, { opacity, transform: [{ translateX: dx }] }]}>
      <Animated.View style={[styles.featureIcon, { transform: [{ scale: iconScale }] }]}>
        <Icon name={(FEATURE_ICON[f.icon] ?? ["bolt", "cyan"])[0]} color={TONES[(FEATURE_ICON[f.icon] ?? ["bolt", "cyan"])[1]]} size={22} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{f.title}</Text>
        <Text style={styles.featureText}>{f.text}</Text>
      </View>
    </Animated.View>
  );
}

export default function LoginScreen({ initialNotice }: { initialNotice?: string | null } = {}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const welcome = welcomeContent();
  const scrollRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const { height: vh } = useWindowDimensions();
  const formY = useRef(0);
  const goForm = (m: "login" | "signup") => {
    setMode(m);
    scrollRef.current?.scrollTo({ y: Math.max(0, formY.current - 12), animated: true });
  };

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
        const invite = cleanInvite(inviteCode);
        const { error: err } = await supabase.auth.signUp({ email, password, options: invite ? { data: { invite_code: invite } } : undefined });
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
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
     <Animated.ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
     >
      <View style={{ alignItems: "center", marginBottom: 12 }}>
        <LangSwitch />
      </View>

      <View style={styles.hero}>
        <Logo size={64} />
        <Text style={styles.title}>VELTRIX</Text>
        <Text style={styles.headline}>{welcome.headline}</Text>
        <Text style={styles.lead}>{welcome.lead}</Text>
        <Highlights />
      </View>

      <LiveDemo />

      <View style={styles.ctaRow}>
        <TouchableOpacity style={[styles.cta, styles.ctaPrimary]} onPress={() => goForm("signup")} activeOpacity={0.85}>
          <Text style={styles.ctaPrimaryText}>{t("Crear cuenta")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cta, styles.ctaGhost]} onPress={() => goForm("login")} activeOpacity={0.85}>
          <Text style={styles.ctaGhostText}>{t("Ya tengo cuenta")}</Text>
        </TouchableOpacity>
      </View>

      <Steps />

      <Text style={styles.sectionTitle}>{t("Así te llegan los avisos")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={252} decelerationRate="fast" contentContainerStyle={{ gap: 12, paddingRight: 20 }}>
        {CARDS[getLang()].map((src, k) => (
          <View key={k} style={{ width: 240 }}>
            <Image source={src} style={styles.cardImg} resizeMode="cover" />
            <Text style={styles.cardCaption}>{t(CARD_CAPTIONS[k])}</Text>
          </View>
        ))}
      </ScrollView>

      <Text style={styles.sectionTitle}>{t("QUÉ PODÉS HACER CON VELTRIX")}</Text>
      {welcome.features.map((f, i) => (
        <FeatureCard key={f.title} f={f} i={i} scrollY={scrollY} vh={vh} />
      ))}

      <View style={styles.card} onLayout={(e) => { formY.current = e.nativeEvent.layout.y; }}>
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
          <>
            <Text style={styles.label}>{t("Código de invitación (opcional)")}</Text>
            <TextInput
              value={inviteCode}
              onChangeText={(v) => setInviteCode(v.toUpperCase())}
              placeholder="ABCD2345"
              placeholderTextColor={colors.dim}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              style={styles.input}
            />
          </>
        )}

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
      </View>

      <Text style={styles.disclaimer}>{disclaimer()}</Text>
     </Animated.ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: "center", padding: 20, paddingBottom: 28 },
  card: {
    backgroundColor: "rgba(16,23,32,0.92)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
  },
  hero: { alignItems: "center", marginBottom: 18 },
  title: { color: colors.snow, fontSize: 30, fontWeight: "800", textAlign: "center", letterSpacing: 1, marginTop: 6 },
  headline: { color: colors.gold, fontSize: 21, fontWeight: "800", textAlign: "center", marginTop: 10, lineHeight: 27 },
  lead: { color: colors.fog, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8, paddingHorizontal: 6 },
  ctaRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  cta: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  ctaPrimary: { backgroundColor: colors.gold },
  ctaPrimaryText: { color: colors.ink, fontWeight: "800", fontSize: 13, letterSpacing: 1 },
  ctaGhost: { borderWidth: 1, borderColor: "rgba(46,196,241,0.5)" },
  ctaGhostText: { color: colors.cyan, fontWeight: "800", fontSize: 13, letterSpacing: 0.5, textAlign: "center" },
  cardImg: { width: 240, height: 240, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  cardCaption: { color: colors.fog, fontSize: 11.5, fontWeight: "700", textAlign: "center", marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 14 },
  chip: { borderWidth: 1, borderColor: "rgba(46,196,241,0.35)", backgroundColor: "rgba(46,196,241,0.08)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: colors.cyan, fontSize: 12, fontWeight: "700" },
  sectionTitle: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 2, textAlign: "center", marginTop: 28, marginBottom: 14 },
  feature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "rgba(16,23,32,0.85)",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  featureIcon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(46,196,241,0.1)", borderWidth: 1, borderColor: "rgba(46,196,241,0.25)" },
  featureTitle: { color: colors.snow, fontSize: 15, fontWeight: "800" },
  featureText: { color: colors.fog, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
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
  disclaimer: { color: colors.dim, fontSize: 10, lineHeight: 15, marginTop: 18, textAlign: "center" },
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

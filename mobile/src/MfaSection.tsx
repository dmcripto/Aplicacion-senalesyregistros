import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Alert, Linking, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { cleanMfaCode, createMfa, isMfaCode, isMfaRequired, t } from "@dmcripto/core";
import type { MfaEnrollment, MfaStatus } from "@dmcripto/core";
import { supabase } from "./supabaseClient";
import { colors } from "./theme";

// Verificación en dos pasos OPCIONAL: no se pide para entrar, solo para autorizar cambios sensibles de la cuenta.

const mfa = createMfa(supabase.auth);

interface Ctx {
  status: MfaStatus;
  loaded: boolean;
  refresh: () => Promise<void>;
  /** true si se puede seguir: sin 2FA, con código reciente, o después de ingresarlo. false si cancela. */
  ask: (reason?: string) => Promise<boolean>;
}
const MfaContext = createContext<Ctx | null>(null);
export const useMfa = () => {
  const c = useContext(MfaContext);
  if (!c) throw new Error("useMfa fuera de MfaProvider");
  return c;
};

export const mfaErrorText = (e: unknown, fallback: string) =>
  isMfaRequired(e) ? t("Confirmá con el código de Google Authenticator para hacer este cambio.") : e instanceof Error ? e.message : fallback;

function CodeBox({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={(v) => onChange(cleanMfaCode(v))}
      onSubmitEditing={onSubmit}
      keyboardType="number-pad"
      maxLength={6}
      autoComplete="one-time-code"
      placeholder="000000"
      placeholderTextColor={colors.dim}
      accessibilityLabel={t("Código de 6 números")}
      style={s.code}
    />
  );
}

export function MfaProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MfaStatus>({ enabled: false, factorId: null });
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState<{ reason?: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    try {
      setStatus(await mfa.status());
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ask = useCallback(async (reason?: string) => {
    const st = await mfa.status();
    setStatus(st);
    if (!st.enabled || !st.factorId) return true;
    if (await mfa.isFresh()) return true;
    setCode("");
    setErr(null);
    setPrompt({ reason });
    return new Promise<boolean>((res) => {
      pending.current = res;
    });
  }, []);

  const close = (ok: boolean) => {
    setPrompt(null);
    pending.current?.(ok);
    pending.current = null;
  };

  const submit = async () => {
    const fid = statusRef.current.factorId;
    if (!fid || !isMfaCode(code) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await mfa.verify(fid, code);
      close(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo verificar."));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => ({ status, loaded, refresh, ask }), [status, loaded, refresh, ask]);

  return (
    <MfaContext.Provider value={value}>
      {children}
      <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={() => close(false)}>
        <View style={s.backdrop}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{"🔐 "}{t("Confirmá que sos vos")}</Text>
            <Text style={s.hint}>
              {prompt?.reason ?? t("Este cambio necesita tu autorización.")} {t("Abrí Google Authenticator y escribí el código de 6 números de VELTRIX.")}
            </Text>
            <CodeBox value={code} onChange={setCode} onSubmit={submit} />
            {err && <Text style={s.err}>{err}</Text>}
            <View style={s.row}>
              <TouchableOpacity style={s.outline} onPress={() => close(false)}>
                <Text style={s.outlineText}>{t("Cancelar")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, (!isMfaCode(code) || busy) && { opacity: 0.4 }]} disabled={!isMfaCode(code) || busy} onPress={submit}>
                <Text style={s.btnText}>{busy ? t("Verificando…") : t("Autorizar")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </MfaContext.Provider>
  );
}

/** Ajustes: activar o desactivar la verificación en dos pasos. */
export default function MfaSection({ titleStyle }: { titleStyle?: object }) {
  const { status, loaded, refresh, ask } = useMfa();
  const [enroll, setEnroll] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      setEnroll(await mfa.startEnroll());
      setCode("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo iniciar la activación."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!enroll || !isMfaCode(code)) return;
    setBusy(true);
    setErr(null);
    try {
      await mfa.confirmEnroll(enroll.factorId, code);
      setEnroll(null);
      await refresh();
      Alert.alert(t("Listo"), t("Listo: verificación en dos pasos activada."));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo verificar."));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const f = enroll;
    setEnroll(null);
    setErr(null);
    if (f) await supabase.auth.mfa.unenroll({ factorId: f.factorId }).catch(() => {});
  };

  const disable = async () => {
    if (!status.factorId) return;
    if (!(await ask(t("Para desactivar la verificación en dos pasos necesitamos confirmar que sos vos.")))) return;
    try {
      await mfa.disable(status.factorId);
      await refresh();
      Alert.alert(t("Listo"), t("Verificación en dos pasos desactivada."));
    } catch (e) {
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo desactivar."));
    }
  };

  return (
    <>
      <Text style={titleStyle ?? s.title}>{t("VERIFICACIÓN EN DOS PASOS")}</Text>
      <View style={s.card}>
        {!loaded ? (
          <ActivityIndicator color={colors.gold} />
        ) : status.enabled ? (
          <>
            <Text style={[s.hint, { color: colors.bull, fontWeight: "800" }]}>{"✅ "}{t("Activada")}</Text>
            <Text style={s.hint}>{t("Te vamos a pedir el código de Google Authenticator para: conectar o desconectar un exchange, regenerar la URL del webhook y eliminar tu cuenta. Para entrar y usar VELTRIX todo sigue igual.")}</Text>
            <Text style={s.hint}>{t("Si perdés el celular con el autenticador, pedí el reinicio al soporte de VELTRIX.")}</Text>
            <TouchableOpacity style={s.outline} onPress={disable}>
              <Text style={[s.outlineText, { color: colors.dim }]}>{t("Desactivar")}</Text>
            </TouchableOpacity>
          </>
        ) : enroll ? (
          <>
            <Text style={s.hint}>{t("1. Instalá Google Authenticator en este celular (si no lo tenés).")}</Text>
            <TouchableOpacity style={s.outline} onPress={() => Linking.openURL(enroll.uri).catch(() => Alert.alert(t("Error"), t("No se pudo abrir Google Authenticator. Usá la clave de abajo.")))}>
              <Text style={s.outlineText}>{t("2. Abrir Google Authenticator y agregar VELTRIX")}</Text>
            </TouchableOpacity>
            <Text style={s.hint}>{t("Si no se abre, en Google Authenticator tocá «+», «Ingresar una clave de configuración» y escribí esta clave:")}</Text>
            <TouchableOpacity onPress={() => Clipboard.setStringAsync(enroll.secret).then(() => Alert.alert(t("Listo"), t("Clave copiada."))).catch(() => {})}>
              <Text style={s.secret} selectable>{enroll.secret}</Text>
            </TouchableOpacity>
            <Text style={s.hint}>{t("3. Escribí acá el código de 6 números que te muestra.")}</Text>
            <CodeBox value={code} onChange={setCode} onSubmit={confirm} />
            {err && <Text style={s.err}>{err}</Text>}
            <View style={s.row}>
              <TouchableOpacity style={s.outline} onPress={cancel}>
                <Text style={s.outlineText}>{t("Cancelar")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, (!isMfaCode(code) || busy) && { opacity: 0.4 }]} disabled={!isMfaCode(code) || busy} onPress={confirm}>
                <Text style={s.btnText}>{busy ? t("Verificando…") : t("Activar")}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={s.hint}>{t("Es opcional y lo decidís vos. Si lo activás, para cambios importantes de tu cuenta (conectar o desconectar un exchange, regenerar la URL del webhook, eliminar tu cuenta) te pedimos un código de Google Authenticator. Para entrar no hace falta.")}</Text>
            {err && <Text style={s.err}>{err}</Text>}
            <TouchableOpacity style={[s.outline, busy && { opacity: 0.4 }]} disabled={busy} onPress={start}>
              <Text style={s.outlineText}>{"🔐 "}{t("Activar verificación en dos pasos")}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  title: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginTop: 6, marginBottom: 8 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  err: { color: colors.bear, fontSize: 12 },
  row: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
  outline: { flex: 1, borderWidth: 1, borderColor: colors.gold + "88", borderRadius: 8, paddingVertical: 11, paddingHorizontal: 8, alignItems: "center" },
  outlineText: { color: colors.gold, fontWeight: "800", fontSize: 12, textAlign: "center" },
  secret: { color: colors.snow, fontSize: 13, fontWeight: "700", backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, letterSpacing: 1 },
  code: { color: colors.snow, fontSize: 24, fontWeight: "800", textAlign: "center", letterSpacing: 8, backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(7,11,17,0.88)", justifyContent: "center", padding: 20 },
  modal: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.gold + "66", borderRadius: 12, padding: 18, gap: 12 },
  modalTitle: { color: colors.snow, fontSize: 18, fontWeight: "800" },
});

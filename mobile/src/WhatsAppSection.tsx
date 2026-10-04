import { useEffect, useState } from "react";
import { Alert, Switch, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { t } from "@dmcripto/core";
import type { WhatsAppState } from "@dmcripto/core";
import { fetchWhatsApp, startWhatsApp, toggleWhatsApp, unlinkWhatsApp, verifyWhatsApp } from "./tradesApi";
import { colors } from "./theme";

/**
 * Señales automáticas por WhatsApp (dentro de Ajustes). La persona escribe su número, recibe un código por WhatsApp y lo confirma.
 * Mientras el servidor no tenga la conexión con Meta, la sección no se muestra.
 */
export default function WhatsAppSection() {
  const [state, setState] = useState<WhatsAppState | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchWhatsApp().then(setState);
  }, []);

  if (!state?.configured) return null;
  const link = state.link;
  const fail = (msg?: string, fallback = t("No se pudo completar.")) => Alert.alert(t("Error"), msg ?? fallback);

  const send = async () => {
    setBusy(true);
    try {
      const r = await startWhatsApp(phone);
      if (!r.ok) return fail(r.error, t("No se pudo enviar el código."));
      setSent(true);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const r = await verifyWhatsApp(code);
      if (!r.ok || !r.link) return fail(r.error, t("No se pudo confirmar el código."));
      setState({ configured: true, link: r.link });
      setSent(false);
      setPhone("");
      setCode("");
      setAccept(false);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (next: boolean) => {
    if (!link) return;
    setState({ configured: true, link: { ...link, enabled: next } });
    const r = await toggleWhatsApp(next);
    if (!r.ok) {
      setState({ configured: true, link });
      fail(r.error, t("No se pudo guardar el cambio."));
    }
  };

  const unlink = () =>
    Alert.alert(t("Desconectar WhatsApp"), t("Vas a dejar de recibir las señales por WhatsApp."), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Desconectar"),
        style: "destructive",
        onPress: async () => {
          const r = await unlinkWhatsApp();
          if (r.ok) setState({ configured: true, link: null });
          else fail(r.error, t("No se pudo desconectar."));
        },
      },
    ]);

  return (
    <>
      <Text style={s.title}>{t("SEÑALES POR WHATSAPP")}</Text>
      <View style={s.card}>
        {link ? (
          <>
            <View style={s.row}>
              <Text style={s.phone}>{link.phone}</Text>
              <Text style={[s.status, { color: link.enabled ? colors.bull : colors.dim }]}>{link.enabled ? t("Conectado") : t("Pausado")}</Text>
            </View>
            <View style={s.row}>
              <Text style={[s.hint, { flex: 1 }]}>
                {t("Cada señal que llegue a tu cuenta y cada vez que se toque un TP o un SL. Para pausar desde WhatsApp, respondé BAJA.")}
              </Text>
              <Switch value={link.enabled} onValueChange={toggle} trackColor={{ false: colors.line2, true: colors.gold }} thumbColor={colors.snow} />
            </View>
            <TouchableOpacity style={s.outline} onPress={unlink}>
              <Text style={s.outlineText}>{t("Desconectar WhatsApp")}</Text>
            </TouchableOpacity>
          </>
        ) : !sent ? (
          <>
            <Text style={s.hint}>{t("Escribí tu número de WhatsApp con el código de país. Te mandamos un código para confirmar que es tuyo; después las señales te llegan solas.")}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+54 9 11 5555 5555"
              placeholderTextColor={colors.dim}
              style={s.input}
            />
            <TouchableOpacity style={s.accept} onPress={() => setAccept(!accept)} accessibilityRole="checkbox" accessibilityState={{ checked: accept }}>
              <View style={[s.box, accept && { backgroundColor: colors.gold, borderColor: colors.gold }]} />
              <Text style={[s.hint, { flex: 1 }]}>{t("Acepto recibir avisos de VELTRIX por WhatsApp en este número. Puedo pausarlos cuando quiera respondiendo BAJA.")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, (busy || !accept || phone.replace(/\D/g, "").length < 8) && { opacity: 0.4 }]} onPress={send} disabled={busy || !accept || phone.replace(/\D/g, "").length < 8}>
              <Text style={s.btnText}>{busy ? t("Un momento…") : t("Enviarme el código")}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.hint}>{t("Te mandamos un código de 6 números a tu WhatsApp. Escribilo acá (dura 10 minutos).")}</Text>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              placeholder="123456"
              placeholderTextColor={colors.dim}
              style={[s.input, { textAlign: "center", fontSize: 22, letterSpacing: 8 }]}
            />
            <TouchableOpacity style={[s.btn, (busy || code.length !== 6) && { opacity: 0.4 }]} onPress={verify} disabled={busy || code.length !== 6}>
              <Text style={s.btnText}>{busy ? t("Un momento…") : t("Confirmar")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.outline} onPress={() => { setSent(false); setCode(""); }}>
              <Text style={s.outlineText}>{t("Cambiar el número")}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  title: { color: colors.dim, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginTop: 4, marginBottom: 8 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  phone: { color: colors.snow, fontSize: 14, fontWeight: "800" },
  status: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  input: { backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, color: colors.snow, fontSize: 14 },
  accept: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  box: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.line2, marginTop: 1 },
  btn: { backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "800", fontSize: 12.5, letterSpacing: 0.5 },
  outline: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  outlineText: { color: colors.dim, fontWeight: "700", fontSize: 12 },
});

import { useEffect, useState } from "react";
import { Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { inviteLink, inviteMessage, t } from "@dmcripto/core";
import type { InviteInfo } from "@dmcripto/core";
import { supabase } from "./supabaseClient";
import { colors } from "./theme";

/** Programa de invitados: tu enlace personal y cuánta gente trajiste (solo números, nunca quiénes). */
export default function InviteSection() {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.rpc("my_invite");
      if (!alive) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.code) return setUnavailable(true); // la función todavía no está creada en el servidor: no se muestra nada
      setInfo({ code: String(row.code), invited: Number(row.invited) || 0, active: Number(row.active) || 0 });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (unavailable) return null;

  const copy = async () => {
    if (!info) return;
    await Clipboard.setStringAsync(inviteLink(info.code));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Text style={s.title}>{t("INVITÁ AMIGOS")}</Text>
      <View style={s.card}>
        <Text style={s.hint}>{t("Cuando un amigo cree su cuenta con tu enlace (o escriba tu código al registrarse), suma como invitado tuyo.")}</Text>
        {info ? (
          <>
            <Text style={s.link} selectable>
              {inviteLink(info.code)}
            </Text>
            <Text style={s.hint}>
              {t("Tu código")}: <Text style={s.code}>{info.code}</Text>
            </Text>
            <View style={s.row}>
              <TouchableOpacity style={s.outline} onPress={copy}>
                <Text style={s.outlineText}>{copied ? t("¡Copiado!") : t("Copiar enlace")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={() => Share.share({ message: inviteMessage(info.code) })}>
                <Text style={s.btnText}>{t("Compartir")}</Text>
              </TouchableOpacity>
            </View>
            <View style={s.row}>
              <View style={s.stat}>
                <Text style={s.statLabel}>{t("Invitados").toUpperCase()}</Text>
                <Text style={s.statValue}>{info.invited}</Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statLabel}>{t("Activos").toUpperCase()}</Text>
                <Text style={[s.statValue, { color: colors.bull }]}>{info.active}</Text>
              </View>
            </View>
            <Text style={s.hint}>{t("Un invitado activo es el que ya cargó al menos una operación. Vos ves cuántos son, no quiénes.")}</Text>
          </>
        ) : (
          <Text style={s.hint}>{t("Un momento…")}</Text>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  title: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginTop: 6, marginBottom: 8 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  link: { color: colors.cyan, fontSize: 13, fontWeight: "700", backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10 },
  code: { color: colors.snow, fontWeight: "800", letterSpacing: 2 },
  row: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
  outline: { flex: 1, borderWidth: 1, borderColor: colors.gold + "88", borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  outlineText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  stat: { flex: 1, backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10 },
  statLabel: { color: colors.dim, fontSize: 9.5, fontWeight: "700", letterSpacing: 1 },
  statValue: { color: colors.snow, fontSize: 20, fontWeight: "800", marginTop: 2 },
});

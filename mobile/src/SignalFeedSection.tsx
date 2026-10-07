import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { t } from "@dmcripto/core";
import type { SignalFeedState } from "@dmcripto/core";
import { supabase } from "./supabaseClient";
import { fetchSignalFeed, setFollowSignals } from "./tradesApi";
import { colors } from "./theme";

/** «Señales de VELTRIX»: recibir en el diario y por aviso las señales que publica el equipo. Solo en cuentas con la llave beta. */
export default function SignalFeedSection({ titleStyle }: { titleStyle?: StyleProp<TextStyle> }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<SignalFeedState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
  }, []);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetchSignalFeed(userId)
      .then((x) => alive && setState(x))
      .catch(() => {}); // sin la llave beta, o sin el SQL: no se muestra
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!state || !userId) return null;

  const toggle = async (follow: boolean) => {
    setBusy(true);
    try {
      await setFollowSignals(userId, follow);
      setState({ ...state, follow });
    } catch (e) {
      Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo guardar el cambio."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={titleStyle ?? s.title}>{t("SEÑALES DE VELTRIX")}</Text>
      <View style={s.card}>
        <Text style={s.hint}>{t("Si lo activás, cada señal que publica el equipo de VELTRIX se anota sola en tu diario (con la etiqueta «Señal VELTRIX») y te llega el aviso por la app y por tu Telegram, si lo vinculaste. Se cierra sola cuando toca el objetivo o el stop, como el resto de tus operaciones.")}</Text>
        <Text style={s.hint}>{t("Es información para tu propio análisis, no una recomendación ni una orden. VELTRIX no opera por vos: la decisión y la operación son tuyas. Podés dejar de recibirlas cuando quieras.")}</Text>
        <View style={s.row}>
          <Text style={s.rowText}>{t("Recibir las señales de VELTRIX")}</Text>
          <Switch value={state.follow} disabled={busy} onValueChange={toggle} trackColor={{ true: colors.gold, false: colors.line }} />
        </View>
        {state.provider && (
          <Text style={[s.hint, { color: colors.snow }]}>
            {"📡 "}{t("Tu cuenta publica señales: las alertas de TradingView que recibe tu webhook se reparten a quienes las activaron.")}{" "}
            {state.followers != null && <Text style={{ color: colors.gold, fontWeight: "800" }}>{t("Hoy las reciben {n} personas.", { n: state.followers })}</Text>}
          </Text>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  title: { color: colors.fog, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginTop: 6, marginBottom: 8 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowText: { color: colors.snow, fontSize: 13 },
});

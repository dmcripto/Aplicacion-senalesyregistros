import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fmtDateTime, t } from "@dmcripto/core";
import type { TelegramLink } from "@dmcripto/core";
import { fetchTelegramLink, startTelegramLink, unlinkTelegram } from "./tradesApi";
import type { TelegramStart } from "./tradesApi";
import { colors } from "./theme";

const POLL_MS = 3000;
const POLL_MAX_MS = 10 * 60_000; // el código dura 10 minutos

/** Vincula el chat de Telegram con la cuenta (dentro de Ajustes). */
export default function TelegramSection({ userId }: { userId: string }) {
  const [link, setLink] = useState<TelegramLink | null | undefined>(undefined);
  const [start, setStart] = useState<TelegramStart | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const reload = useCallback(async () => setLink(await fetchTelegramLink()), []);

  useEffect(() => {
    void reload();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void reload()); // al volver desde Telegram
    return () => {
      sub.remove();
      stopPolling();
    };
  }, [reload, stopPolling]);

  const waitForLink = () => {
    stopPolling();
    const startedAt = Date.now();
    timer.current = setInterval(async () => {
      const l = await fetchTelegramLink();
      if (l) {
        stopPolling();
        setLink(l);
        setStart(null);
      } else if (Date.now() - startedAt > POLL_MAX_MS) {
        stopPolling();
        setStart(null);
      }
    }, POLL_MS);
  };

  const connect = async () => {
    setBusy(true);
    try {
      const r = await startTelegramLink();
      if (!r.ok || !r.url) return Alert.alert("Error", r.error ?? t("No se pudo conectar."));
      setStart(r);
      Linking.openURL(r.url).catch(() => {});
      waitForLink();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () =>
    Alert.alert(t("Desconectar"), t("Vas a dejar de recibir avisos y de poder registrar señales desde Telegram."), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Desconectar"),
        style: "destructive",
        onPress: () => unlinkTelegram(userId).then(() => setLink(null)).catch((e) => Alert.alert("Error", e instanceof Error ? e.message : t("No se pudo desconectar."))),
      },
    ]);

  if (link === undefined) return <View style={s.card} />;

  return (
    <View style={s.card}>
      {link ? (
        <>
          <View style={s.row}>
            <Text style={s.name}>
              {link.username ? `@${link.username}` : t("Chat conectado")} <Text style={s.date}>{fmtDateTime(link.linkedAt)}</Text>
            </Text>
            <Text style={[s.status, { color: colors.bull }]}>{t("Conectado")}</Text>
          </View>
          <Text style={s.hint}>{t("• Pegá o reenviá una señal al bot y confirmá con un toque.")}</Text>
          <Text style={s.hint}>{t("• Te avisa cuando llega una alerta o se toca un TP/SL.")}</Text>
          <Text style={s.hint}>{t("• Comandos: /abiertas, /resumen, /idioma, /desvincular.")}</Text>
          <TouchableOpacity style={s.outline} onPress={disconnect}>
            <Text style={s.outlineText}>{t("Desconectar")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.hint}>
            {t("Conectá tu Telegram y podés pegar o reenviar señales al bot de VELTRIX para registrarlas, y recibir un aviso en el chat cuando llega una alerta o se toca un TP/SL.")}
          </Text>
          {start ? (
            <View style={s.notice}>
              <Text style={s.noticeText}>{t("Se abrió Telegram: tocá «Iniciar» en el chat del bot. Esto se completa solo.")}</Text>
              <TouchableOpacity onPress={() => start.url && Linking.openURL(start.url).catch(() => {})}>
                <Text style={s.link}>{t("Abrir Telegram de nuevo")}</Text>
              </TouchableOpacity>
              <Text style={s.hint}>
                {t("Si no se abre, buscá")} @{start.botUsername} {t("y enviale")} /start {start.code}
              </Text>
            </View>
          ) : (
            <TouchableOpacity style={[s.btn, busy && { opacity: 0.5 }]} onPress={connect} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={s.btnText}>{t("Conectar Telegram")}</Text>}
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, marginBottom: 20, gap: 10, minHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { color: colors.snow, fontSize: 13.5, fontWeight: "800", flex: 1 },
  date: { color: colors.dim, fontSize: 11, fontWeight: "400" },
  status: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  hint: { color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  notice: { borderWidth: 1, borderColor: colors.gold + "66", borderRadius: 8, padding: 10, gap: 6, backgroundColor: colors.golddeep + "44" },
  noticeText: { color: colors.gold, fontSize: 11.5, lineHeight: 17 },
  link: { color: colors.gold, fontSize: 12, fontWeight: "800", textDecorationLine: "underline" },
  btn: { backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  btnText: { color: colors.ink, fontWeight: "800", fontSize: 12.5, letterSpacing: 0.5 },
  outline: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  outlineText: { color: colors.dim, fontWeight: "700", fontSize: 12 },
});

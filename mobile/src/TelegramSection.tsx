import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fmtDateTime, t } from "@dmcripto/core";
import type { TelegramCommunity, TelegramLink } from "@dmcripto/core";
import { fetchCommunities, fetchTelegramLink, removeCommunity, startCommunityLink, startTelegramLink, unlinkTelegram } from "./tradesApi";
import type { CommunityStart, TelegramStart } from "./tradesApi";
import * as Clipboard from "expo-clipboard";
import { colors } from "./theme";

const POLL_MS = 3000;
const POLL_MAX_MS = 10 * 60_000; // el código dura 10 minutos

/** Vincula el chat de Telegram con la cuenta (dentro de Ajustes). */
export default function TelegramSection({ userId }: { userId: string }) {
  const [link, setLink] = useState<TelegramLink | null | undefined>(undefined);
  const [start, setStart] = useState<TelegramStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [communities, setCommunities] = useState<TelegramCommunity[]>([]);
  const [cStart, setCStart] = useState<CommunityStart | null>(null);
  const cTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const reload = useCallback(async () => {
    setLink(await fetchTelegramLink());
    setCommunities(await fetchCommunities());
  }, []);

  const connectCommunity = async () => {
    setBusy(true);
    try {
      const r = await startCommunityLink();
      if (!r.ok || !r.code) return Alert.alert(t("Error"), r.error ?? t("No se pudo conectar."));
      setCStart(r);
      if (cTimer.current) clearInterval(cTimer.current);
      const startedAt = Date.now();
      const before = communities.length;
      cTimer.current = setInterval(async () => {
        const list = await fetchCommunities();
        if (list.length > before) {
          if (cTimer.current) clearInterval(cTimer.current);
          setCommunities(list);
          setCStart(null);
        } else if (Date.now() - startedAt > POLL_MAX_MS) {
          if (cTimer.current) clearInterval(cTimer.current);
          setCStart(null);
        }
      }, POLL_MS);
    } finally {
      setBusy(false);
    }
  };

  const dropCommunity = (c: TelegramCommunity) =>
    removeCommunity(c.id)
      .then(() => setCommunities((l) => l.filter((x) => x.id !== c.id)))
      .catch((e) => Alert.alert(t("Error"), e instanceof Error ? e.message : t("No se pudo desconectar.")));

  useEffect(() => {
    void reload();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void reload()); // al volver desde Telegram
    return () => {
      sub.remove();
      stopPolling();
      if (cTimer.current) clearInterval(cTimer.current);
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
          <Text style={s.hint}>{t("• Comandos: /abiertas, /resumen, /whatsapp, /idioma, /desvincular.")}</Text>
          <View style={s.community}>
            <Text style={s.communityTitle}>{t("Tu comunidad")}</Text>
            {communities.length === 0 && !cStart && (
              <Text style={s.hint}>{t("Conectá un grupo o canal de Telegram y el bot publica ahí tus señales y cuando toquen TP o SL, sin mostrar tu dinero.")}</Text>
            )}
            {communities.map((c) => (
              <View key={c.id} style={s.row}>
                <Text style={s.name}>
                  {c.title ?? t("Comunidad")} <Text style={[s.status, { color: colors.bull }]}>{t("Publicando")}</Text>
                </Text>
                <TouchableOpacity onPress={() => dropCommunity(c)}>
                  <Text style={s.link}>{t("Desconectar")}</Text>
                </TouchableOpacity>
              </View>
            ))}
            {cStart ? (
              <View style={s.notice}>
                <Text style={s.hint}>{t("1. Agregá el bot a tu grupo o canal:")}</Text>
                <TouchableOpacity onPress={() => cStart.addToGroupUrl && Linking.openURL(cStart.addToGroupUrl).catch(() => {})}>
                  <Text style={s.link}>{t("Agregar a un grupo")}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => cStart.addToChannelUrl && Linking.openURL(cStart.addToChannelUrl).catch(() => {})}>
                  <Text style={s.link}>{t("Agregar a un canal")}</Text>
                </TouchableOpacity>
                <Text style={s.hint}>{t("2. Escribí este mensaje en ese grupo o canal (tenés que ser administrador):")}</Text>
                <TouchableOpacity onPress={() => cStart.command && Clipboard.setStringAsync(cStart.command)}>
                  <Text style={s.noticeText}>{cStart.command} · {t("Tocá para copiar")}</Text>
                </TouchableOpacity>
                <Text style={s.hint}>{t("Esto se completa solo en unos segundos. El código dura 10 minutos.")}</Text>
              </View>
            ) : (
              <TouchableOpacity style={s.outline} onPress={connectCommunity} disabled={busy}>
                <Text style={[s.outlineText, { color: colors.gold }]}>{communities.length ? t("Conectar otra comunidad") : t("Conectar comunidad")}</Text>
              </TouchableOpacity>
            )}
          </View>
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
  community: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, gap: 8 },
  communityTitle: { color: colors.dim, fontSize: 10, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  outline: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  outlineText: { color: colors.dim, fontWeight: "700", fontSize: 12 },
});

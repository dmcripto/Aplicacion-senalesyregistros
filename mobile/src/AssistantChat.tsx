import { useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ASSISTANT_MAX_CHARS, assistantProblem, assistantSuggestions, t } from "@dmcripto/core";
import type { AssistantMessage } from "@dmcripto/core";
import { askAssistant } from "./tradesApi";
import { colors } from "./theme";
import ChatText from "./ChatText";

/** Asistente con IA: botón flotante + chat que responde dudas de la plataforma y explica tus propios datos. */
export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const next: AssistantMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setProblem(null);
    setBusy(true);
    try {
      const r = await askAssistant(next);
      if (r.ok) setMessages([...next, { role: "assistant", content: r.text }]);
      else setProblem(assistantProblem(r));
    } catch {
      setProblem(assistantProblem({ ok: false, reason: "unavailable" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TouchableOpacity style={s.fab} onPress={() => setOpen(true)} accessibilityLabel={t("Asistente VELTRIX")}>
        <Image source={require("../assets/logo.png")} style={s.fabLogo} resizeMode="contain" />
        <Text style={s.fabText}>{t("Ayuda")}</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={s.sheet}>
            <View style={s.head}>
              <Image source={require("../assets/logo.png")} style={s.headLogo} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{t("Asistente VELTRIX")}</Text>
                <Text style={s.sub}>{t("Preguntame sobre la plataforma o tus resultados")}</Text>
              </View>
              {messages.length > 0 && (
                <TouchableOpacity onPress={() => { setMessages([]); setProblem(null); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={s.link}>{t("Nueva conversación")}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setOpen(false)} accessibilityLabel={t("Cerrar")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.close}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
              {messages.length === 0 && (
                <>
                  <Text style={s.intro}>{t("Hola, soy el asistente de VELTRIX. Puedo explicarte cómo funciona la plataforma y tus propios resultados. No doy señales ni consejos de inversión.")}</Text>
                  <View style={s.chips}>
                    {assistantSuggestions().map((q) => (
                      <TouchableOpacity key={q} style={s.chip} onPress={() => void send(q)}>
                        <Text style={s.chipText}>{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {messages.map((m, i) => (
                <View key={i} style={m.role === "user" ? s.rowUser : s.rowBot}>
                  {m.role === "assistant" && <Image source={require("../assets/logo.png")} style={s.avatar} resizeMode="contain" />}
                  {m.role === "assistant" ? (
                    <View style={[s.bubble, s.bubbleBot]}>
                      <ChatText text={m.content} />
                    </View>
                  ) : (
                    <Text style={[s.bubble, s.bubbleUser]}>{m.content}</Text>
                  )}
                </View>
              ))}
              {busy && <ActivityIndicator color={colors.gold} style={{ alignSelf: "flex-start" }} />}
              {problem && (
                <View style={s.notice}>
                  <Text style={s.noticeText}>{problem}</Text>
                </View>
              )}
            </ScrollView>

            <View style={s.form}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  style={s.input}
                  value={input}
                  onChangeText={setInput}
                  maxLength={ASSISTANT_MAX_CHARS}
                  placeholder={t("Escribí tu pregunta…")}
                  placeholderTextColor={colors.dim}
                  onSubmitEditing={() => void send(input)}
                  returnKeyType="send"
                />
                <TouchableOpacity style={[s.send, (busy || !input.trim()) && { opacity: 0.5 }]} onPress={() => void send(input)} disabled={busy || !input.trim()}>
                  <Text style={s.sendText}>{t("Enviar")}</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.legal}>{t("Respuestas generadas con IA: pueden tener errores y no son un consejo de inversión. Para contestar se envían tu pregunta y estadísticas calculadas de tu diario (nunca claves ni datos personales). No pegues claves API acá.")}</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  fab: { position: "absolute", right: 14, bottom: 84, backgroundColor: colors.ink + "F2", borderWidth: 1, borderColor: colors.gold + "88", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, elevation: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  fabLogo: { width: 22, height: 22 },
  headLogo: { width: 34, height: 34 },
  avatar: { width: 22, height: 22, marginTop: 4 },
  fabText: { color: colors.gold, fontWeight: "800", fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" },
  backdrop: { flex: 1, backgroundColor: "#000000AA", justifyContent: "flex-end" },
  sheet: { height: "82%", backgroundColor: colors.panel, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { color: colors.snow, fontSize: 15, fontWeight: "800" },
  sub: { color: colors.dim, fontSize: 11 },
  link: { color: colors.fog, fontSize: 11.5 },
  close: { color: colors.fog, fontSize: 18 },
  intro: { color: colors.fog, fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  chipText: { color: colors.snow, fontSize: 12 },
  rowUser: { alignItems: "flex-end" },
  rowBot: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  bubble: { fontSize: 13, lineHeight: 19, color: colors.snow, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, maxWidth: "85%", overflow: "hidden" },
  bubbleUser: { backgroundColor: colors.gold + "26" },
  bubbleBot: { backgroundColor: colors.ink + "88", borderWidth: 1, borderColor: colors.line },
  notice: { borderWidth: 1, borderColor: colors.gold + "66", borderRadius: 8, padding: 10, backgroundColor: colors.golddeep + "44" },
  noticeText: { color: colors.gold, fontSize: 12, lineHeight: 17 },
  form: { borderTopWidth: 1, borderTopColor: colors.line, padding: 12, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.ink + "99", color: colors.snow, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5 },
  send: { backgroundColor: colors.gold, borderRadius: 8, paddingHorizontal: 14, justifyContent: "center" },
  sendText: { color: colors.ink, fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },
  legal: { color: colors.dim, fontSize: 10, lineHeight: 14 },
});

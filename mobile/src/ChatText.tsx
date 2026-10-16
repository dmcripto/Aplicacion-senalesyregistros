import { StyleSheet, Text, View } from "react-native";
import { parseChatText } from "@dmcripto/core";
import type { ChatSpan } from "@dmcripto/core";
import { colors } from "./theme";

const spansOf = (spans: ChatSpan[]) =>
  spans.map((x, i) => (
    <Text key={i} style={x.bold ? { fontWeight: "800", color: colors.snow } : x.code ? { color: colors.gold, fontFamily: "monospace" } : undefined}>
      {x.text}
    </Text>
  ));

/** La respuesta de la IA con párrafos, listas y negritas (sin HTML). */
export default function ChatText({ text }: { text: string }) {
  return (
    <View style={{ gap: 8, flexShrink: 1 }}>
      {parseChatText(text).map((b, i) =>
        b.type === "p" ? (
          <Text key={i} style={s.msgText}>
            {spansOf(b.spans)}
          </Text>
        ) : (
          <View key={i} style={{ gap: 4 }}>
            {b.items.map((it, j) => (
              <View key={j} style={{ flexDirection: "row", gap: 8 }}>
                <Text style={[s.msgText, { color: colors.gold, fontWeight: "800", minWidth: 14 }]}>{b.type === "ul" ? "•" : `${j + 1}.`}</Text>
                <Text style={[s.msgText, { flex: 1 }]}>{spansOf(it)}</Text>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

const s = StyleSheet.create({
  msgText: { color: colors.snow, fontSize: 13, lineHeight: 19 },
});

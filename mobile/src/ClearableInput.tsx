import { StyleSheet, TextInput, TouchableOpacity, Text, View } from "react-native";
import type { TextInputProps } from "react-native";
import { colors } from "./theme";
import { t } from "@dmcripto/core";

/** Campo de texto con una «✕» a la derecha para borrar todo de un toque (útil al pegar claves). */
export default function ClearableInput({ value, onChangeText, style, ...rest }: TextInputProps & { value: string; onChangeText: (v: string) => void }) {
  return (
    <View>
      <TextInput value={value} onChangeText={onChangeText} style={[style, value ? { paddingRight: 40 } : null]} {...rest} />
      {value ? (
        <TouchableOpacity onPress={() => onChangeText("")} accessibilityLabel={t("Borrar")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={st.x}>
          <Text style={st.xText}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  x: { position: "absolute", right: 6, top: 0, bottom: 0, width: 30, alignItems: "center", justifyContent: "center" },
  xText: { color: colors.fog, fontSize: 15, fontWeight: "800" },
});

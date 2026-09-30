import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LANGS, detectLang, isLang, setLang } from "@dmcripto/core";
import type { Lang } from "@dmcripto/core";
import { colors } from "./theme";

const KEY = "veltrix_lang";

const deviceLang = (): Lang => {
  try {
    return detectLang(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return "es";
  }
};

interface LangCtx {
  lang: Lang;
  change: (l: Lang) => void;
}
const Ctx = createContext<LangCtx>({ lang: "es", change: () => {} });
export const useLang = () => useContext(Ctx);

/** Cambia el idioma de toda la app: al cambiar se vuelve a dibujar el árbol completo. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (isLang(v) ? v : deviceLang()))
      .catch(() => deviceLang())
      .then((l) => {
        setLang(l);
        setLangState(l);
      });
  }, []);

  const change = useCallback((l: Lang) => {
    setLang(l);
    AsyncStorage.setItem(KEY, l).catch(() => {});
    setLangState(l);
  }, []);

  const value = useMemo(() => ({ lang: lang ?? "es", change }), [lang, change]);
  if (lang === null) return <View style={{ flex: 1, backgroundColor: colors.ink }} />;
  return (
    <Ctx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </Ctx.Provider>
  );
}

/** Selector compacto ES | EN (o lista completa con `wide`). */
export function LangSwitch({ wide = false }: { wide?: boolean }) {
  const { lang, change } = useLang();
  return (
    <View style={[s.row, wide && { alignSelf: "stretch" }]}>
      {LANGS.map((l) => {
        const on = lang === l.code;
        return (
          <TouchableOpacity key={l.code} style={[s.btn, wide && { flex: 1, paddingVertical: 11 }, on && s.btnOn]} onPress={() => change(l.code)}>
            <Text style={[s.text, on && s.textOn]}>{wide ? l.label : l.short}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", borderWidth: 1, borderColor: colors.line2, borderRadius: 8, overflow: "hidden" },
  btn: { paddingHorizontal: 12, paddingVertical: 7, alignItems: "center" },
  btnOn: { backgroundColor: colors.gold },
  text: { color: colors.fog, fontSize: 11.5, fontWeight: "800", letterSpacing: 0.8 },
  textOn: { color: colors.ink },
});

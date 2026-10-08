import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fmtPrice, fmtR, t, todayOverview } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";
import { fetchAlerts, fetchTelegramLink } from "./tradesApi";
import { useBot } from "./botStore";
import { Icon, IconTile } from "./icons";
import type { IconName, Tone } from "./icons";
import { colors } from "./theme";

const COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"] as const;
interface Quote {
  price: number;
  change: number | null;
}

/** Precios de las monedas principales con su variación de 24 horas (datos públicos de Binance, cada 30 segundos). */
function useQuotes(): Record<string, Quote> {
  const [q, setQ] = useState<Record<string, Quote>>({});
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const out: Record<string, Quote> = {};
      await Promise.all(
        COINS.map(async (c) => {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 6000); // AbortSignal.timeout no existe en React Native
          try {
            const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${c}`, { signal: ctl.signal });
            if (!res.ok) return;
            const j = await res.json();
            const price = Number(j.lastPrice);
            const ch = Number(j.priceChangePercent);
            if (price > 0) out[c] = { price, change: Number.isFinite(ch) ? ch : null };
          } catch {
            /* sin precio: ese cuadro queda con guiones */
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      if (!stop && Object.keys(out).length) setQ(out);
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return q;
}

const greeting = (d: Date) => {
  const h = d.getHours();
  return h < 6 ? t("Buenas noches") : h < 13 ? t("Buen día") : h < 20 ? t("Buenas tardes") : t("Buenas noches");
};

/** Portada de Inicio: saludo con lo del día, tres botones de acción y los precios principales. */
export function HomeHero({ email, trades, go }: { email?: string; trades: Trade[]; go: (tab: "add" | "map") => void }) {
  const quotes = useQuotes();
  const now = new Date();
  const o = todayOverview(trades, now);
  const name = (email ?? "").split("@")[0];
  const line =
    o.open > 0 || o.closed > 0
      ? t("Hoy: {r} · {n} abiertas", { r: o.closed ? fmtR(o.r) : "0R", n: o.open })
      : t("Todo listo para registrar tu próxima operación.");
  return (
    <LinearGradient colors={["#0f2a35", "#101720", "#0d1d33"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
      <Text style={st.greet}>{greeting(now).toUpperCase()}</Text>
      <Text style={st.hello} numberOfLines={1}>
        {name ? `${t("Hola")}, ${name}` : t("Hola")}
      </Text>
      <Text style={st.line}>{line}</Text>
      <View style={st.actions}>
        <TouchableOpacity style={[st.btn, st.btnMain]} onPress={() => go("add")}>
          <Icon name="plus" color={colors.ink} size={16} />
          <Text style={[st.btnText, { color: colors.ink }]}>{t("Registrar operación")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.btn} onPress={() => go("map")}>
          <Icon name="candles" color={colors.snow} size={16} />
          <Text style={st.btnText}>{t("Ver gráfico")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.btn} onPress={() => go("map")}>
          <Icon name="bell" color={colors.snow} size={16} />
          <Text style={st.btnText}>{t("Crear alerta")}</Text>
        </TouchableOpacity>
      </View>
      <View style={st.grid}>
        {COINS.map((c) => {
          const x = quotes[c];
          const up = (x?.change ?? 0) >= 0;
          return (
            <TouchableOpacity key={c} style={st.quote} onPress={() => go("map")} activeOpacity={0.8}>
              <View style={st.quoteTop}>
                <Text style={st.coin}>{c.replace("USDT", "")}</Text>
                {x?.change != null && (
                  <Text style={[st.chg, { color: up ? colors.bull : colors.bear }]}>
                    {up ? "▲" : "▼"} {Math.abs(x.change).toFixed(2)}%
                  </Text>
                )}
              </View>
              <Text style={st.price}>{x ? fmtPrice(x.price) : "—"}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </LinearGradient>
  );
}

/** Franja de estado: bot, alertas y Telegram, cada uno con su estado y un toque para ir a configurarlo. */
export function HomeStatus({ userId, go }: { userId: string; go: (tab: "map" | "settings") => void }) {
  const bot = useBot();
  const [alerts, setAlerts] = useState<number | null>(null);
  const [tg, setTg] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetchAlerts(userId)
      .then((a) => alive && setAlerts(a.filter((x) => x.active).length))
      .catch(() => {});
    fetchTelegramLink()
      .then((l) => alive && setTg(!!l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);
  const chips: Array<{ icon: IconName; label: string; value: string; on: boolean; tab: "map" | "settings" }> = [
    ...(bot.status === "ready" ? [{ icon: "bot" as IconName, label: t("Bot automático"), value: bot.settings.enabled ? t("Encendido") : t("Apagado"), on: bot.settings.enabled, tab: "settings" as const }] : []),
    ...(alerts != null ? [{ icon: "bell" as IconName, label: t("Alertas"), value: t("{n} activas", { n: alerts }), on: alerts > 0, tab: "map" as const }] : []),
    ...(tg != null ? [{ icon: "send" as IconName, label: "Telegram", value: tg ? t("Conectado") : t("Sin conectar"), on: tg, tab: "settings" as const }] : []),
  ];
  if (!chips.length) return null;
  return (
    <View style={st.status}>
      {chips.map((c) => (
        <TouchableOpacity key={c.label} style={st.chip} onPress={() => go(c.tab)} activeOpacity={0.8}>
          <IconTile name={c.icon} tone={c.on ? "green" : "cyan"} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={st.chipLabel}>{c.label.toUpperCase()}</Text>
            <Text style={[st.chipValue, { color: c.on ? colors.bull : colors.fog }]}>{c.value}</Text>
          </View>
          <Icon name="arrow" color={colors.dim} size={16} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Encabezado de cada pantalla: ícono de color, título y una línea que explica para qué sirve. */
export function ScreenHead({ icon, tone = "cyan", title, sub }: { icon: IconName; tone?: Tone; title: string; sub?: string }) {
  return (
    <View style={st.head}>
      <IconTile name={icon} tone={tone} size={42} />
      <View style={{ flex: 1 }}>
        <Text style={st.headTitle}>{title}</Text>
        {!!sub && <Text style={st.headSub}>{sub}</Text>}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 16, borderWidth: 1, borderColor: colors.line2, padding: 18, marginBottom: 14, overflow: "hidden" },
  greet: { color: colors.gold, fontSize: 10.5, fontWeight: "800", letterSpacing: 2.4 },
  hello: { color: colors.snow, fontSize: 28, fontWeight: "900", marginTop: 2 },
  line: { color: colors.fog, fontSize: 13, lineHeight: 19, marginTop: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.line2, backgroundColor: "rgba(10,14,20,0.5)", borderRadius: 9, paddingVertical: 10, paddingHorizontal: 12 },
  btnMain: { backgroundColor: colors.gold, borderColor: colors.gold },
  btnText: { color: colors.snow, fontWeight: "800", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  quote: { width: "48.5%", borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(10,14,20,0.45)", borderRadius: 12, padding: 12 },
  quoteTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  coin: { color: colors.fog, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  chg: { fontSize: 11, fontWeight: "800" },
  price: { color: colors.snow, fontSize: 18, fontWeight: "800", marginTop: 4 },
  status: { gap: 8, marginBottom: 14 },
  chip: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  chipLabel: { color: colors.dim, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  chipValue: { fontSize: 14, fontWeight: "800", marginTop: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  headTitle: { color: colors.snow, fontSize: 22, fontWeight: "900" },
  headSub: { color: colors.dim, fontSize: 11.5, lineHeight: 16, marginTop: 1 },
});

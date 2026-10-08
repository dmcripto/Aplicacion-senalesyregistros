import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { econTitleEs, getLang, t } from "@dmcripto/core";
import { fetchEconomy } from "./tradesApi";
import type { EconomyEvent } from "./tradesApi";
import { colors } from "./theme";

const FLAG: Record<string, string> = { USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵", CNY: "🇨🇳", CAD: "🇨🇦", AUD: "🇦🇺", NZD: "🇳🇿", CHF: "🇨🇭" };
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function countdown(ms: number): string {
  if (ms <= 0) return t("ahora");
  const m = Math.round(ms / 60_000);
  if (m < 60) return t("en {n} min", { n: Math.max(1, m) });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? t("en {h} h {m} min", { h, m: rest }) : t("en {h} h", { h });
}

/** Agenda económica: los próximos datos que suelen mover el mercado, en tu hora local. */
export default function EconomySection() {
  const [events, setEvents] = useState<EconomyEvent[] | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchEconomy()
        .then((e) => alive && (setEvents(e), setNow(new Date())))
        .catch(() => {});
    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (events === null) return null;
  const en = getLang() === "en";
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const dayLabel = (d: Date) => (dayKey(d) === dayKey(now) ? t("Hoy") : dayKey(d) === dayKey(tomorrow) ? t("Mañana") : d.toLocaleDateString(en ? "en-US" : "es-AR", { weekday: "short", day: "numeric" }));
  const hour = (d: Date) => d.toLocaleTimeString(en ? "en-GB" : "es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const list = events.slice(0, 12);
  const next = list.find((e) => new Date(e.starts_at).getTime() > now.getTime());

  return (
    <View style={st.card}>
      <View style={st.head}>
        <Text style={st.title}>🗓 {t("AGENDA ECONÓMICA")}</Text>
        {next && (
          <Text style={st.next}>
            {t("Próximo dato")}: {countdown(new Date(next.starts_at).getTime() - now.getTime())}
          </Text>
        )}
      </View>
      {list.length === 0 ? (
        <Text style={st.dim}>{t("No hay datos de alto impacto en las próximas horas.")}</Text>
      ) : (
        list.map((e) => {
          const at = new Date(e.starts_at);
          const past = at.getTime() <= now.getTime();
          const figures = [e.forecast && `${t("Esperado")} ${e.forecast}`, e.previous && `${t("Anterior")} ${e.previous}`].filter(Boolean).join(" · ");
          return (
            <View key={e.id} style={[st.row, past && { opacity: 0.55 }]}>
              <View style={[st.dot, { backgroundColor: e.impact === "High" ? colors.bear : colors.gold }]} />
              <Text style={st.when}>
                {dayLabel(at)}
                {"\n"}
                <Text style={{ color: colors.snow, fontWeight: "800" }}>{hour(at)}</Text>
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>
                  {FLAG[e.country] ?? "🌐"} <Text style={{ color: colors.dim }}>{e.country}</Text> {en ? e.title : econTitleEs(e.title)}
                </Text>
                {!!figures && <Text style={st.dim}>{figures}</Text>}
              </View>
            </View>
          );
        })
      )}
      <Text style={st.dim}>🔴 {t("impacto alto")} · 🟠 {t("medio")} · {t("Horarios en tu hora local. Cerca de estos datos el mercado suele moverse fuerte.")}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, gap: 8, marginBottom: 16 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 },
  title: { color: colors.fog, fontSize: 10.5, fontWeight: "800", letterSpacing: 1.6 },
  next: { color: colors.gold, fontSize: 11.5, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  when: { color: colors.dim, fontSize: 11.5, width: 62, lineHeight: 16 },
  name: { color: colors.snow, fontSize: 12.5, lineHeight: 18 },
  dim: { color: colors.dim, fontSize: 10.5, lineHeight: 15 },
});

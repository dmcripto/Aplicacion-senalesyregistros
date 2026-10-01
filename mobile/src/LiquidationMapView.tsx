import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import { LIQ_COINS, fmtPrice, t } from "@dmcripto/core";
import type { LiquidationMap } from "@dmcripto/core";
import { fetchLiquidationMap } from "./tradesApi";
import { colors } from "./theme";

const ROW = 4;
const LEFT = 58;
const WIDTH = 340;
const BAR = WIDTH - LEFT - 6;
const SLUGS: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "xrp", BNB: "bnb", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", LINK: "chainlink", SUI: "sui" };

const axis = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : fmtPrice(n));
const sign = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%";

/** Mapa de liquidaciones estimado (datos públicos de Binance/Bybit calculados en el servidor). */
export default function LiquidationMapView() {
  const [coin, setCoin] = useState("BTC");
  const [map, setMap] = useState<LiquidationMap | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetchLiquidationMap(coin).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) {
        setMap(r.data);
        setStale(!!r.stale);
        setState("ok");
      } else {
        setError(r.error ?? t("No se pudo cargar el mapa."));
        setState("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [coin]);

  const rows = map ? [...map.buckets].reverse() : [];
  const height = rows.length * ROW;
  const priceRow = map ? rows.findIndex((b) => b.price <= map.price) : -1;
  const priceY = priceRow >= 0 ? priceRow * ROW : height / 2;

  return (
    <View>
      <Text style={s.title}>{t("MAPA DE LIQUIDACIONES")}</Text>
      <Text style={s.sub}>{t("Dónde se acumulan liquidaciones (estimado)")}</Text>

      <View style={s.coins}>
        {LIQ_COINS.map((c) => (
          <TouchableOpacity key={c} style={[s.chip, coin === c && s.chipOn]} onPress={() => setCoin(c)}>
            <Text style={[s.chipText, coin === c && { color: colors.ink }]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {state === "loading" && (
        <View style={{ paddingVertical: 60 }}>
          <ActivityIndicator color={colors.gold} />
          <Text style={[s.hint, { textAlign: "center", marginTop: 10 }]}>{t("Calculando…")}</Text>
        </View>
      )}
      {state === "error" && <Text style={s.error}>{error}</Text>}

      {state === "ok" && map && (
        <View style={s.card}>
          <View style={s.headRow}>
            <Text style={s.pair}>
              {map.coin}/USDT <Text style={{ color: colors.gold }}>{fmtPrice(map.price)}</Text>
            </Text>
            <Text style={s.hint}>
              {t("Datos de")} {map.source === "binance" ? "Binance" : "Bybit"}
            </Text>
          </View>
          <Svg width="100%" height={height * 0.98} viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="xMidYMid meet">
            {rows.map((b, i) => {
              const long = b.longs > 0;
              const v = long ? b.longs : b.shorts;
              const y = i * ROW;
              return (
                <G key={b.price}>
                  {v > 0 && <Rect x={LEFT} y={y + 0.5} width={Math.max(1, (v / 100) * BAR)} height={ROW - 1} rx={1} fill={long ? colors.bear : colors.bull} opacity={0.85} />}
                  {i % 12 === 6 && (
                    <SvgText x={LEFT - 5} y={y + 4} textAnchor="end" fontSize="8" fill={colors.dim}>
                      {axis(b.price)}
                    </SvgText>
                  )}
                </G>
              );
            })}
            <Line x1={LEFT} x2={WIDTH} y1={priceY} y2={priceY} stroke={colors.gold} strokeWidth={1.2} strokeDasharray="4 3" />
            <SvgText x={WIDTH - 3} y={priceY - 3} textAnchor="end" fontSize="8" fontWeight="bold" fill={colors.gold}>
              {t("precio actual")}
            </SvgText>
          </Svg>

          <View style={s.two}>
            <View style={[s.box, { borderColor: colors.bull + "55" }]}>
              <Text style={[s.boxTitle, { color: colors.bull }]}>{t("Cortos (arriba)")}</Text>
              <Text style={s.boxValue}>{map.topShort ? `${fmtPrice(map.topShort.price)} (${sign(map.topShort.pct)})` : "—"}</Text>
            </View>
            <View style={[s.box, { borderColor: colors.bear + "55" }]}>
              <Text style={[s.boxTitle, { color: colors.bear }]}>{t("Largos (abajo)")}</Text>
              <Text style={s.boxValue}>{map.topLong ? `${fmtPrice(map.topLong.price)} (${sign(map.topLong.pct)})` : "—"}</Text>
            </View>
          </View>
          {stale && <Text style={[s.hint, { color: colors.gold }]}>{t("El mercado no respondió: se muestra el último cálculo guardado.")}</Text>}
        </View>
      )}

      <Text style={[s.hint, { marginTop: 12 }]}>
        {t("Estimación propia de VELTRIX con datos públicos (precio e interés abierto). Muestra zonas donde probablemente haya liquidaciones pendientes, no cifras exactas: no es una señal de compra ni de venta.")}
      </Text>
      <TouchableOpacity onPress={() => Linking.openURL(`https://coinmarketcap.com/charts/liquidation-map/?type=exact&coin=${SLUGS[coin] ?? "bitcoin"}`).catch(() => {})}>
        <Text style={s.link}>{t("Comparar con CoinMarketCap")} ↗</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: colors.snow, fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  sub: { color: colors.fog, fontSize: 12.5, marginTop: 4, marginBottom: 14 },
  coins: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontWeight: "800", fontSize: 12 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, gap: 10 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pair: { color: colors.snow, fontSize: 12.5, fontWeight: "800" },
  hint: { color: colors.dim, fontSize: 11, lineHeight: 16 },
  two: { flexDirection: "row", gap: 8 },
  box: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 10, gap: 3 },
  boxTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  boxValue: { color: colors.snow, fontSize: 12, fontWeight: "700" },
  error: { color: colors.bear, fontSize: 12.5, lineHeight: 18 },
  link: { color: colors.cyan, fontSize: 12, fontWeight: "700", textDecorationLine: "underline", marginTop: 6 },
});

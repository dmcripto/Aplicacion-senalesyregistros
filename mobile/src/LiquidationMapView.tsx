import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, PanResponder, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { G, Line, Polygon, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { LEVERAGE_COLORS, LIQ_COINS, cumulativeLiquidations, fmtPrice, fmtUsdShort, rebinLiquidations, t } from "@dmcripto/core";
import type { LiquidationMap } from "@dmcripto/core";
import { fetchLiquidationMap } from "./tradesApi";
import { colors } from "./theme";

const W = 360;
const H = 260;
const ML = 42;
const MR = 42;
const MT = 18;
const MB = 22;
const COLS = 48;
const PW = W - ML - MR;
const PH = H - MT - MB;
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
  const [range, setRange] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [boxW, setBoxW] = useState(320);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setRange(null);
    setHover(null);
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

  const full = useMemo<[number, number]>(() => {
    if (!map?.buckets.length) return [0, 1];
    return [map.buckets[0].price - map.step / 2, map.buckets[map.buckets.length - 1].price + map.step / 2];
  }, [map]);
  const [lo, hi] = range ?? full;

  const view = useMemo(() => {
    if (!map) return null;
    const cols = rebinLiquidations(map, lo, hi, COLS);
    const maxBar = Math.max(1, ...cols.map((c) => c.longTotal + c.shortTotal));
    const cum = cumulativeLiquidations(map);
    const longs = cum.longs.filter((p) => p.price >= lo && p.price <= hi);
    const shorts = cum.shorts.filter((p) => p.price >= lo && p.price <= hi);
    const maxCum = Math.max(1, ...longs.map((p) => p.usd), ...shorts.map((p) => p.usd));
    return { cols, maxBar, longs, shorts, maxCum };
  }, [map, lo, hi]);

  const x = (price: number) => ML + ((price - lo) / (hi - lo)) * PW;
  const yBar = (v: number) => MT + PH - (v / (view?.maxBar ?? 1)) * PH;
  const yCum = (v: number) => MT + PH - (v / (view?.maxCum ?? 1)) * PH;
  const colW = PW / COLS;
  const colOf = (price: number) => Math.min(COLS - 1, Math.max(0, Math.floor(((price - lo) / (hi - lo)) * COLS)));

  // El gesto necesita los valores más recientes: se guardan en una referencia que se actualiza en cada dibujo.
  const live = useRef({ map, lo, hi, boxW, touchX: 0 });
  live.current = { map, lo, hi, boxW, touchX: live.current.touchX };
  const toChart = (px: number) => Math.min(W - MR, Math.max(ML, (px / live.current.boxW) * W));

  const pan = useRef(
    PanResponder.create({
      // Solo se queda con el gesto si el movimiento es horizontal: así la pantalla sigue pudiendo desplazarse hacia arriba y abajo.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const a = toChart(live.current.touchX);
        setDrag([a, a]);
      },
      onPanResponderMove: (_e, g) => {
        const a = toChart(live.current.touchX);
        setDrag([a, toChart(live.current.touchX + g.dx)]);
      },
      onPanResponderRelease: (_e, g) => {
        const { map: m, lo: l, hi: h } = live.current;
        const a = toChart(live.current.touchX);
        const b = toChart(live.current.touchX + g.dx);
        const pa = l + ((Math.min(a, b) - ML) / PW) * (h - l);
        const pb = l + ((Math.max(a, b) - ML) / PW) * (h - l);
        if (m && Math.abs(b - a) > 12 && pb - pa > m.price * 0.004) setRange([pa, pb]);
        setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    }),
  ).current;

  const cur = hover != null ? view?.cols[hover] : null;
  const hotspotsShown = (map?.hotspots ?? []).filter((h) => h.price >= lo && h.price <= hi);
  const topShorts = (map?.hotspots ?? []).filter((h) => h.side === "short");
  const topLongs = (map?.hotspots ?? []).filter((h) => h.side === "long");
  const ticks = [0, 0.25, 0.5, 0.75, 1];

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

      {state === "ok" && map && view && (
        <View style={s.card}>
          <View style={s.headRow}>
            <Text style={s.pair}>
              {map.coin}/USDT <Text style={{ color: colors.gold }}>{fmtPrice(map.price)}</Text>
            </Text>
            <Text style={s.hint}>
              {t("Datos de")} {map.source === "binance" ? "Binance" : "Bybit"}
            </Text>
          </View>
          <Text style={[s.hint, { color: colors.fog, minHeight: 16 }]}>
            {cur
              ? `${axis(cur.from)}–${axis(cur.to)} · ${t("largos")} ${fmtUsdShort(cur.longTotal)} · ${t("cortos")} ${fmtUsdShort(cur.shortTotal)}`
              : t("Deslizá sobre el gráfico para ampliar una zona")}
          </Text>

          <View
            onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
            onTouchStart={(e) => {
              live.current.touchX = e.nativeEvent.locationX;
              setHover(Math.min(COLS - 1, Math.max(0, Math.floor((toChart(e.nativeEvent.locationX) - ML) / colW))));
            }}
            {...pan.panHandlers}
          >
            <Svg width="100%" height={(boxW * H) / W} viewBox={`0 0 ${W} ${H}`}>
              {ticks.map((f) => (
                <G key={f}>
                  <Line x1={ML} x2={W - MR} y1={yBar(view.maxBar * f)} y2={yBar(view.maxBar * f)} stroke={colors.line} strokeWidth={0.6} />
                  <SvgText x={ML - 4} y={yBar(view.maxBar * f) + 3} textAnchor="end" fontSize="8" fill={colors.dim}>{fmtUsdShort(view.maxBar * f)}</SvgText>
                  {f > 0 && <SvgText x={W - MR + 4} y={yBar(view.maxBar * f) + 3} fontSize="8" fill={colors.dim}>{fmtUsdShort(view.maxCum * f)}</SvgText>}
                  <SvgText x={ML + f * PW} y={H - 7} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} fontSize="8" fill={colors.dim}>{axis(lo + f * (hi - lo))}</SvgText>
                </G>
              ))}

              {view.longs.length > 1 && (
                <>
                  <Polygon fill={colors.bear} opacity={0.12} points={`${x(view.longs[0].price)},${yCum(0)} ${view.longs.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} ${x(view.longs[view.longs.length - 1].price)},${yCum(0)}`} />
                  <Polyline fill="none" stroke={colors.bear} strokeWidth={1.5} points={view.longs.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} />
                </>
              )}
              {view.shorts.length > 1 && (
                <>
                  <Polygon fill={colors.bull} opacity={0.12} points={`${x(view.shorts[0].price)},${yCum(0)} ${view.shorts.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} ${x(view.shorts[view.shorts.length - 1].price)},${yCum(0)}`} />
                  <Polyline fill="none" stroke={colors.bull} strokeWidth={1.5} points={view.shorts.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} />
                </>
              )}

              {view.cols.map((c, i) => {
                let acc = 0;
                return (
                  <G key={i}>
                    {map.leverages.map((_, k) => {
                      const v = c.longs[k] + c.shorts[k];
                      const y1 = yBar(acc + v);
                      const y0 = yBar(acc);
                      acc += v;
                      return v > 0 ? (
                        <Rect key={k} x={ML + i * colW + 0.5} y={y1} width={Math.max(1, colW - 1)} height={Math.max(0, y0 - y1)} fill={LEVERAGE_COLORS[k]} opacity={hover === i ? 1 : 0.88} />
                      ) : null;
                    })}
                  </G>
                );
              })}

              {hotspotsShown.map((h, i) => {
                const c = view.cols[colOf(h.price)];
                return (
                  <SvgText key={i} x={x(h.price)} y={Math.max(MT + 8, yBar(c.longTotal + c.shortTotal) - 3)} textAnchor="middle" fontSize="9" fill={colors.gold}>▾</SvgText>
                );
              })}

              {map.price >= lo && map.price <= hi && (
                <G>
                  <Line x1={x(map.price)} x2={x(map.price)} y1={MT} y2={MT + PH} stroke={colors.fog} strokeWidth={1} strokeDasharray="4 3" />
                  <Rect x={x(map.price) - 40} y={0} width={80} height={13} rx={6.5} fill={colors.snow} />
                  <SvgText x={x(map.price)} y={9.5} textAnchor="middle" fontSize="8" fontWeight="bold" fill={colors.ink}>{`${map.coin} $${axis(map.price)}`}</SvgText>
                </G>
              )}

              {drag && <Rect x={Math.min(drag[0], drag[1])} y={MT} width={Math.abs(drag[1] - drag[0])} height={PH} fill={colors.gold} opacity={0.2} stroke={colors.gold} strokeWidth={0.8} />}
            </Svg>
            {range && (
              <TouchableOpacity style={s.reset} onPress={() => setRange(null)}>
                <Text style={s.resetText}>{t("Quitar zoom")}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={s.legend}>
            {map.leverages.map((lv, k) => (
              <View key={lv} style={s.legendItem}>
                <View style={[s.dot, { backgroundColor: LEVERAGE_COLORS[k] }]} />
                <Text style={s.legendText}>{lv}x</Text>
              </View>
            ))}
            <View style={s.legendItem}>
              <View style={[s.line, { backgroundColor: colors.bear }]} />
              <Text style={s.legendText}>{t("Largos acumulados")}</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.line, { backgroundColor: colors.bull }]} />
              <Text style={s.legendText}>{t("Cortos acumulados")}</Text>
            </View>
          </View>

          <View style={s.two}>
            <View style={[s.box, { borderColor: colors.bull + "55" }]}>
              <Text style={[s.boxTitle, { color: colors.bull }]}>{t("Puntos calientes de cortos (arriba)")}</Text>
              {topShorts.length ? topShorts.map((h) => (
                <Text key={h.price} style={s.boxValue}>{axis(h.price)} <Text style={s.hint}>({sign(h.pct)})</Text> · ≈{fmtUsdShort(h.usd)}</Text>
              )) : <Text style={s.boxValue}>—</Text>}
            </View>
            <View style={[s.box, { borderColor: colors.bear + "55" }]}>
              <Text style={[s.boxTitle, { color: colors.bear }]}>{t("Puntos calientes de largos (abajo)")}</Text>
              {topLongs.length ? topLongs.map((h) => (
                <Text key={h.price} style={s.boxValue}>{axis(h.price)} <Text style={s.hint}>({sign(h.pct)})</Text> · ≈{fmtUsdShort(h.usd)}</Text>
              )) : <Text style={s.boxValue}>—</Text>}
            </View>
          </View>
          {stale && <Text style={[s.hint, { color: colors.gold }]}>{t("El mercado no respondió: se muestra el último cálculo guardado.")}</Text>}
        </View>
      )}

      <Text style={[s.hint, { marginTop: 12 }]}>
        {t("Estimación propia de VELTRIX con datos públicos (precio e interés abierto). Muestra zonas donde probablemente haya liquidaciones pendientes, con montos aproximados: no son cifras exactas ni una señal de compra o venta.")}
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
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, gap: 8 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pair: { color: colors.snow, fontSize: 12.5, fontWeight: "800" },
  hint: { color: colors.dim, fontSize: 11, lineHeight: 16 },
  reset: { position: "absolute", top: 18, left: ML, backgroundColor: colors.gold, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  resetText: { color: colors.ink, fontWeight: "800", fontSize: 11 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { color: colors.fog, fontSize: 10.5 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  line: { width: 12, height: 2 },
  two: { gap: 8 },
  box: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 3 },
  boxTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  boxValue: { color: colors.snow, fontSize: 12, fontWeight: "700" },
  error: { color: colors.bear, fontSize: 12.5, lineHeight: 18 },
  link: { color: colors.cyan, fontSize: 12, fontWeight: "700", textDecorationLine: "underline", marginTop: 6 },
});

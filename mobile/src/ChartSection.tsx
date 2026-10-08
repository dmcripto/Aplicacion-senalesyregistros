import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { INDICATOR_DEFAULT_PERIOD, INDICATOR_KINDS, INDICATOR_NO_PERIOD, binanceSymbol, computeIndicator, fmtPrice, fmtUsdShort, t } from "@dmcripto/core";
import type { ChartCandle, IndicatorKind, IndicatorResult, LiquidationMap, Trade, UserAlert } from "@dmcripto/core";
import { fetchAlerts, fetchLiquidationMap } from "./tradesApi";
import AlertsPanel from "./AlertsPanel";
import { colors } from "./theme";

const TFS = ["5m", "15m", "1h", "4h", "1d"] as const;
type Tf = (typeof TFS)[number];
const KEY = "veltrix_chart_v1";
const LIMIT = 300;
const VISIBLE = 90;
const REFRESH_MS = 30_000;
const AXIS_W = 58;
const PRICE_H = 300;
const SUB_H = 90;
const BULL = "#26a69a"; // verde y rojo de TradingView
const BEAR = "#ef5350";
const BG = "#131722";
const GRID = "#1e222d";
const TXT = "#b2b5be";
const LIQ_LONG = "#ff9f43";
const LIQ_SHORT = "#7c8cff";

interface Slot {
  kind: IndicatorKind | "none" | "liq"; // «liq» = mapa de liquidaciones
  period: number;
}
interface Prefs {
  symbol: string;
  tf: Tf;
  slots: [Slot, Slot];
}
const DEFAULTS: Prefs = { symbol: "BTCUSDT", tf: "1h", slots: [{ kind: "ema", period: 50 }, { kind: "rsi", period: 14 }] };

const indName = (k: IndicatorKind | "none" | "liq") =>
  ({ none: t("Ninguno"), liq: t("🔥 Mapa de liquidaciones"), ema: t("EMA (media exponencial)"), sma: t("SMA (media simple)"), bb: t("Bandas de Bollinger"), rsi: t("RSI"), macd: t("MACD"), adx: t("ADX con DI+ / DI− (fuerza de tendencia)"), vol: t("Volumen con ballenas"), pdhl: t("Máx. / Mín. del día anterior"), fvg: t("Huecos FVG (zonas sin cubrir)"), sess: t("Sesiones: Asia, Londres y Nueva York") })[k];
const shortName = (k: IndicatorKind | "none" | "liq") => (k === "none" ? t("Ninguno") : k === "liq" ? `🔥 ${t("Liquidaciones")}` : k === "bb" ? "BB" : k === "pdhl" ? "PDH/L" : k === "fvg" ? "FVG" : k === "sess" ? t("Sesiones") : k === "vol" ? t("Volumen") : k.toUpperCase());

/** Velas de Binance (futuros; si el par no existe ahí, spot). */
async function fetchCandles(raw: string, tf: Tf): Promise<ChartCandle[]> {
  const b = binanceSymbol(raw);
  if (!b) throw new Error("symbol");
  for (const base of ["https://fapi.binance.com/fapi/v1", "https://api.binance.com/api/v3"]) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000); // AbortSignal.timeout no existe en React Native
    try {
      const res = await fetch(`${base}/klines?symbol=${b.symbol}&interval=${tf}&limit=${LIMIT}`, { signal: ctl.signal });
      if (!res.ok) continue;
      const rows = (await res.json()) as unknown[][];
      if (!Array.isArray(rows) || !rows.length) continue;
      return rows.map((r) => ({ time: Math.floor(Number(r[0]) / 1000), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) }));
    } catch {
      /* se prueba el siguiente */
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("candles");
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[st.chip, on && st.chipOn]}>
      <Text style={[st.chipText, on && { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Gráfico de análisis: velas, 2 indicadores, mapa de liquidaciones, tus señales abiertas y tus alertas. */
export default function ChartSection({ userId, trades }: { userId: string; trades: Trade[] }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState(DEFAULTS.symbol);
  const [candles, setCandles] = useState<ChartCandle[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [width, setWidth] = useState(340);
  const [alerts, setAlerts] = useState<UserAlert[] | null>(null);
  const [liq, setLiq] = useState<LiquidationMap | null>(null);
  const [liqState, setLiqState] = useState<"off" | "loading" | "ok" | "none">("off");

  // Preferencias guardadas.
  useEffect(() => {
    void AsyncStorage.getItem(KEY)
      .then((raw) => {
        const v = raw ? JSON.parse(raw) : null;
        if (v && binanceSymbol(v.symbol ?? "") && TFS.includes(v.tf)) {
          const slot = (s: any, d: Slot): Slot => ({ kind: s && (s.kind === "none" || s.kind === "liq" || INDICATOR_KINDS.includes(s.kind)) ? s.kind : d.kind, period: Number(s?.period) > 0 ? Math.min(500, Math.round(Number(s.period))) : d.period });
          const p: Prefs = { symbol: v.symbol, tf: v.tf, slots: [slot(v.slots?.[0], DEFAULTS.slots[0]), slot(v.slots?.[1], DEFAULTS.slots[1])] };
          setPrefs(p);
          setDraft(p.symbol);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  const change = (next: Partial<Prefs>) =>
    setPrefs((p) => {
      const n = { ...p, ...next };
      void AsyncStorage.setItem(KEY, JSON.stringify(n)).catch(() => {});
      return n;
    });
  const setSlot = (i: 0 | 1, s: Partial<Slot>) =>
    setPrefs((p) => {
      const slots: [Slot, Slot] = [{ ...p.slots[0] }, { ...p.slots[1] }];
      slots[i] = { ...slots[i], ...s };
      if (s.kind && s.kind !== "none" && s.kind !== "liq" && s.kind !== p.slots[i].kind) slots[i].period = INDICATOR_DEFAULT_PERIOD[s.kind] || slots[i].period;
      const n = { ...p, slots };
      void AsyncStorage.setItem(KEY, JSON.stringify(n)).catch(() => {});
      return n;
    });

  const symbolKey = binanceSymbol(prefs.symbol)?.symbol ?? prefs.symbol;
  const liqOn = prefs.slots.some((x) => x.kind === "liq");

  // Velas: al cambiar de activo o de temporalidad, y cada 30 segundos.
  useEffect(() => {
    if (!loaded) return;
    let dead = false;
    const load = async (first: boolean) => {
      if (first) setState("loading");
      try {
        const c = await fetchCandles(prefs.symbol, prefs.tf);
        if (dead) return;
        setCandles(c);
        setState("ok");
      } catch {
        if (!dead && first) {
          setCandles(null);
          setState("error");
        }
      }
    };
    void load(true);
    const id = setInterval(() => void load(false), REFRESH_MS);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [prefs.symbol, prefs.tf, loaded]);

  // Mis alertas (si todavía no se corrió el SQL de alertas, esa parte no se muestra).
  const reloadAlerts = useCallback(() => {
    fetchAlerts(userId)
      .then(setAlerts)
      .catch(() => setAlerts(null));
  }, [userId]);
  useEffect(() => {
    reloadAlerts();
    const id = setInterval(reloadAlerts, 30_000);
    return () => clearInterval(id);
  }, [reloadAlerts]);

  // Mapa de liquidaciones del activo (solo si está encendido).
  const coin = symbolKey.replace(/(USDT|USDC|BUSD|USD)$/, "");
  useEffect(() => {
    if (!liqOn) {
      setLiqState("off");
      setLiq(null);
      return;
    }
    let dead = false;
    setLiqState("loading");
    const load = () =>
      fetchLiquidationMap(coin)
        .then((r) => {
          if (dead) return;
          if (r.ok && r.data) {
            setLiq(r.data);
            setLiqState("ok");
          } else {
            setLiq(null);
            setLiqState("none");
          }
        })
        .catch(() => !dead && (setLiq(null), setLiqState("none")));
    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [liqOn, coin]);

  const levels = useMemo(() => trades.filter((x) => x.outcome === "ABIERTA" && binanceSymbol(x.symbol)?.symbol === symbolKey), [trades, symbolKey]);
  const alertLevels = useMemo(() => (alerts ?? []).filter((a) => a.active && a.kind === "price" && a.symbol === symbolKey && a.level != null).map((a) => a.level as number), [alerts, symbolKey]);

  // Indicadores: se calculan con todas las velas y se muestran las últimas.
  const results = useMemo(() => {
    if (!candles) return [] as Array<IndicatorResult | null>;
    return prefs.slots.map((s, i) => (s.kind === "none" || s.kind === "liq" ? null : computeIndicator(s.kind, s.period, candles, i as 0 | 1)));
  }, [candles, prefs.slots]);

  const last = candles?.[candles.length - 1];
  const submit = () => {
    const b = binanceSymbol(draft);
    if (!b) return;
    setDraft(b.symbol);
    change({ symbol: b.symbol });
  };
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.max(240, Math.round(e.nativeEvent.layout.width)));

  // ─── Dibujo ───
  const view = candles ? candles.slice(-VISIBLE) : [];
  const off = candles ? candles.length - view.length : 0;
  const plotW = width - AXIS_W;
  const step = view.length ? plotW / view.length : 1;
  const x = (i: number) => (i + 0.5) * step;
  const priceLines = results.flatMap((r) => (r && r.pane === "price" ? r.lines.filter((l) => l.kind === "line") : []));
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of view) {
    hi = Math.max(hi, c.high);
    lo = Math.min(lo, c.low);
  }
  for (const l of priceLines) for (let i = off; i < l.values.length; i++) {
    const v = l.values[i];
    if (v != null && v > 0) {
      hi = Math.max(hi, v);
      lo = Math.min(lo, v);
    }
  }
  const pad = (hi - lo || hi * 0.01) * 0.06;
  const max = hi + pad;
  const min = lo - pad;
  const y = (p: number) => ((max - p) / (max - min)) * PRICE_H;
  const gridPrices = useMemo(() => {
    if (!isFinite(max) || !isFinite(min) || max <= min) return [] as number[];
    const raw = (max - min) / 5;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const f = raw / pow;
    const stp = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
    const out: number[] = [];
    for (let p = Math.ceil(min / stp) * stp; p < max; p += stp) out.push(p);
    return out;
  }, [max, min]);

  const hline = (price: number, color: string, label: string, key: string, w = 1, dash?: string) => {
    if (!(price > min && price < max)) return null;
    return (
      <G key={key}>
        <Line x1={0} x2={plotW} y1={y(price)} y2={y(price)} stroke={color} strokeWidth={w} strokeDasharray={dash} />
        <SvgText x={4} y={y(price) - 3} fill={color} fontSize={9.5} fontWeight="bold">
          {label}
        </SvgText>
      </G>
    );
  };

  const subs = results.filter((r): r is IndicatorResult => !!r && r.pane === "sub");
  const maxLiq = Math.max(1, ...(liq?.hotspots ?? []).map((h) => h.usd));

  return (
    <View>
      <View style={st.card}>
        <View style={st.wrap}>
          <TextInput value={draft} onChangeText={(v) => setDraft(v.toUpperCase())} onSubmitEditing={submit} autoCapitalize="characters" autoCorrect={false} placeholder="BTCUSDT" placeholderTextColor={colors.dim} style={[st.input, { width: 120 }]} />
          <TouchableOpacity onPress={submit} style={st.go}>
            <Text style={st.goText}>{t("Ver")}</Text>
          </TouchableOpacity>
          {["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((s) => (
            <Chip key={s} on={s === symbolKey} label={s.replace("USDT", "")} onPress={() => (setDraft(s), change({ symbol: s }))} />
          ))}
        </View>
        <View style={st.wrap}>
          {TFS.map((x) => (
            <Chip key={x} on={x === prefs.tf} label={x} onPress={() => change({ tf: x })} />
          ))}
        </View>

        {([0, 1] as const).map((i) => {
          const s = prefs.slots[i];
          return (
            <View key={i} style={{ gap: 6 }}>
              <View style={st.wrap}>
                <View style={[st.dotc, { backgroundColor: i === 0 ? "#f5c518" : "#c084fc" }]} />
                <Text style={st.label}>{t("Indicador {n}", { n: i + 1 })}</Text>
                {s.kind !== "none" && s.kind !== "liq" && !INDICATOR_NO_PERIOD.includes(s.kind) && (
                  <TextInput value={String(s.period)} onChangeText={(v) => setSlot(i, { period: Number(v.replace(/\D/g, "")) || 0 })} keyboardType="number-pad" style={[st.input, { width: 56, paddingVertical: 4 }]} />
                )}
              </View>
              <View style={st.wrap}>
                {(["none", ...INDICATOR_KINDS, "liq"] as const).map((k) => (
                  <Chip key={k} on={s.kind === k} label={shortName(k)} onPress={() => setSlot(i, { kind: k })} />
                ))}
              </View>
              {s.kind !== "none" && <Text style={st.dim}>{indName(s.kind)}</Text>}
            </View>
          );
        })}

        {liqOn && (
          <View style={st.wrap}>
            {liqState === "loading" && <Text style={st.dim}>{t("Calculando…")}</Text>}
            {liqState === "none" && <Text style={st.dim}>{t("Este activo no tiene mapa de liquidaciones.")}</Text>}
            {liqState === "ok" && (
              <Text style={st.dim}>
                <Text style={{ color: LIQ_LONG }}>■</Text> {t("largos")} · <Text style={{ color: LIQ_SHORT }}>■</Text> {t("cortos")} · {t("más gruesa = más dinero")}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={st.priceRow}>
        <Text style={st.price}>{last ? fmtPrice(last.close) : "—"}</Text>
        {levels.length > 0 && <Text style={st.levels}>{t("Se muestran tus señales abiertas de este activo: entrada, TP y SL.")}</Text>}
      </View>

      <View style={st.chart} onLayout={onLayout}>
        {state === "ok" && view.length > 0 ? (
          <View>
            <Svg width={width} height={PRICE_H}>
              <Rect x={0} y={0} width={width} height={PRICE_H} fill={BG} />
              {gridPrices.map((p) => (
                <G key={p}>
                  <Line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke={GRID} strokeWidth={1} />
                  <SvgText x={plotW + 4} y={y(p) + 3} fill={TXT} fontSize={9.5}>
                    {fmtPrice(p)}
                  </SvgText>
                </G>
              ))}
              {view.map((c, i) => {
                const up = c.close >= c.open;
                const col = up ? BULL : BEAR;
                const top = y(Math.max(c.open, c.close));
                return (
                  <G key={c.time}>
                    <Line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1} />
                    <Rect x={x(i) - Math.max(1, step * 0.35)} y={top} width={Math.max(2, step * 0.7)} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} fill={col} />
                  </G>
                );
              })}
              {priceLines.map((l, li) => {
                const pts = l.values
                  .slice(off)
                  .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
                  .filter(Boolean)
                  .join(" ");
                return pts ? <Polyline key={li} points={pts} fill="none" stroke={l.color} strokeWidth={l.thin ? 1 : 1.6} strokeDasharray={l.thin ? "2 3" : undefined} /> : null;
              })}
              {levels.flatMap((tr, n) => [
                hline(tr.entry, "#2ec4f1", `${t("Entrada")} ${tr.direction}`, `e${n}`, 1, "5 4"),
                ...(tr.targets ?? []).map((v, i) => hline(v, BULL, `TP${i + 1}`, `t${n}-${i}`, 1, "2 3")),
                hline(tr.tp, BULL, "TP", `tp${n}`, 1, "5 4"),
                hline(tr.sl, BEAR, "SL", `sl${n}`, 1, "5 4"),
              ])}
              {alertLevels.map((lv, i) => hline(lv, "#f5c518", `🔔 ${fmtPrice(lv)}`, `a${i}`, 1, "2 3"))}
              {liqOn &&
                (liq?.hotspots ?? []).map((h, i) =>
                  hline(h.price, h.side === "long" ? LIQ_LONG : LIQ_SHORT, `${h.side === "long" ? t("Liq. largos") : t("Liq. cortos")} ${fmtUsdShort(h.usd)}`, `l${i}`, h.usd > maxLiq * 0.66 ? 3 : h.usd > maxLiq * 0.33 ? 2 : 1.2),
                )}
              {last && (
                <>
                  <Line x1={0} x2={plotW} y1={y(last.close)} y2={y(last.close)} stroke={last.close >= last.open ? BULL : BEAR} strokeWidth={0.8} strokeDasharray="3 3" />
                  <Rect x={plotW} y={y(last.close) - 8} width={AXIS_W} height={16} fill={last.close >= last.open ? BULL : BEAR} />
                  <SvgText x={plotW + 3} y={y(last.close) + 3.5} fill="#fff" fontSize={9.5} fontWeight="bold">
                    {fmtPrice(last.close)}
                  </SvgText>
                </>
              )}
            </Svg>
            {subs.map((r, si) => {
              const vals = r.lines.flatMap((l) => l.values.slice(off).filter((v): v is number => v != null));
              const isRsi = r.guides.length > 0 && r.guides.every((g) => g >= 0 && g <= 100);
              let smin = isRsi ? 0 : Math.min(...vals, 0);
              let smax = isRsi ? 100 : Math.max(...vals, 0);
              if (!isFinite(smin) || !isFinite(smax) || smax <= smin) {
                smin = 0;
                smax = 1;
              }
              const sy = (v: number) => 4 + ((smax - v) / (smax - smin)) * (SUB_H - 8);
              return (
                <Svg key={si} width={width} height={SUB_H} style={{ marginTop: 2 }}>
                  <Rect x={0} y={0} width={width} height={SUB_H} fill={BG} />
                  {r.guides.map((g) => (
                    <Line key={g} x1={0} x2={plotW} y1={sy(g)} y2={sy(g)} stroke="#363a45" strokeWidth={1} strokeDasharray="4 3" />
                  ))}
                  {r.lines.map((l, li) =>
                    l.kind === "hist" ? (
                      l.values.slice(off).map((v, i) =>
                        v == null ? null : <Rect key={`${li}-${i}`} x={x(i) - Math.max(1, step * 0.3)} y={Math.min(sy(v), sy(0))} width={Math.max(1.5, step * 0.6)} height={Math.max(1, Math.abs(sy(v) - sy(0)))} fill={l.colors?.[off + i] ?? (v >= 0 ? "rgba(22,217,138,0.55)" : "rgba(255,77,103,0.55)")} />,
                      )
                    ) : (
                      <Polyline
                        key={li}
                        points={l.values
                          .slice(off)
                          .map((v, i) => (v == null ? null : `${x(i)},${sy(v)}`))
                          .filter(Boolean)
                          .join(" ")}
                        fill="none"
                        stroke={l.color}
                        strokeWidth={l.thin ? 1 : 1.5}
                      />
                    ),
                  )}
                  <SvgText x={4} y={11} fill={TXT} fontSize={9.5} fontWeight="bold">
                    {r.lines.map((l) => l.name).join(" · ")}
                  </SvgText>
                </Svg>
              );
            })}
          </View>
        ) : (
          <View style={st.center}>{state === "loading" ? <ActivityIndicator color={colors.gold} /> : <Text style={st.dim}>{t("No se pudieron cargar las velas de este activo. Probá con otro (por ejemplo BTCUSDT).")}</Text>}</View>
        )}
      </View>

      {alerts && <AlertsPanel userId={userId} symbol={symbolKey} tf={prefs.tf} lastPrice={last?.close ?? null} alerts={alerts} reload={reloadAlerts} />}
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, gap: 10, marginBottom: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.fog, fontWeight: "800", fontSize: 11.5 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, color: colors.snow, paddingVertical: 7, paddingHorizontal: 10, fontSize: 13 },
  go: { borderWidth: 1, borderColor: colors.gold + "88", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  goText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  dotc: { width: 9, height: 9, borderRadius: 5 },
  label: { color: colors.fog, fontWeight: "800", fontSize: 11.5 },
  dim: { color: colors.dim, fontSize: 10.5, lineHeight: 15 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 },
  price: { color: colors.snow, fontSize: 17, fontWeight: "800" },
  levels: { color: colors.gold, fontSize: 11, flex: 1 },
  chart: { backgroundColor: BG, borderWidth: 1, borderColor: "#2a2e39", borderRadius: 4, overflow: "hidden", minHeight: 120 },
  center: { height: 140, alignItems: "center", justifyContent: "center", padding: 16 },
});

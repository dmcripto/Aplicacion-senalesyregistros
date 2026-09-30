import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, G, Line, LinearGradient as SvgGradient, Path, Polyline, Rect, Stop } from "react-native-svg";
import type { Trade } from "@dmcripto/core";
import { colors } from "./theme";
import { t } from "@dmcripto/core";

export function Logo({ size = 28 }: { size?: number }) {
  return <Image source={require("../assets/logo.png")} style={{ width: size, height: size }} resizeMode="contain" />;
}

const CANDLES: Array<[number, number, number, boolean]> = [
  [10, 40, 90, true], [50, 60, 120, false], [90, 30, 80, true], [130, 55, 110, true], [170, 20, 70, false],
  [210, 45, 100, true], [250, 25, 85, false], [290, 50, 115, true], [330, 15, 65, true], [370, 40, 95, false],
];

export function AppBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={["#070b11", "#0a111b", "#08130f"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={["rgba(22,217,138,0.14)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.45 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={["transparent", "rgba(46,196,241,0.10)"]} start={{ x: 0.3, y: 0.55 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 400 800" preserveAspectRatio="xMidYMax slice">
        {[100, 200, 300, 400, 500, 600, 700].map((y) => (
          <Line key={y} x1={0} y1={y} x2={400} y2={y} stroke="rgba(147,165,186,0.045)" strokeWidth={1} />
        ))}
        <G opacity={0.07} translateY={560}>
          {CANDLES.map(([x, top, bottom, up], i) => (
            <G key={i}>
              <Line x1={x + 8} y1={top - 12} x2={x + 8} y2={bottom + 14} stroke={up ? colors.bull : colors.bear} strokeWidth={2} />
              <Rect x={x} y={top} width={16} height={bottom - top} rx={2} fill={up ? colors.bull : colors.bear} />
            </G>
          ))}
        </G>
      </Svg>
    </View>
  );
}

export function LiveDot({ color = colors.bull }: { color?: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: color,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) }],
        }}
      />
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

export type TabIconName = "signals" | "journal" | "add" | "risk" | "settings";

export function TabIcon({ name, color, size = 22 }: { name: TabIconName; color: string; size?: number }) {
  const p = { stroke: color, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "signals" && <Polyline points="2.5,12 7,12 9.5,5 14,19.5 16.5,12 21.5,12" {...p} />}
      {name === "journal" && (
        <>
          <Path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z" {...p} />
          <Line x1={9} y1={9} x2={15} y2={9} {...p} />
          <Line x1={9} y1={13} x2={13} y2={13} {...p} />
        </>
      )}
      {name === "add" && (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Line x1={12} y1={8} x2={12} y2={16} {...p} />
          <Line x1={8} y1={12} x2={16} y2={12} {...p} />
        </>
      )}
      {name === "risk" && (
        <>
          <Path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z" {...p} />
          <Line x1={8} y1={8} x2={16} y2={8} {...p} />
          <Line x1={8} y1={12.5} x2={9} y2={12.5} {...p} />
          <Line x1={12} y1={12.5} x2={13} y2={12.5} {...p} />
          <Line x1={16} y1={12.5} x2={16.1} y2={12.5} {...p} />
          <Line x1={8} y1={16.5} x2={9} y2={16.5} {...p} />
          <Line x1={12} y1={16.5} x2={16} y2={16.5} {...p} />
        </>
      )}
      {name === "settings" && (
        <>
          <Line x1={4} y1={7} x2={20} y2={7} {...p} />
          <Line x1={4} y1={17} x2={20} y2={17} {...p} />
          <Circle cx={9} cy={7} r={2.4} fill={colors.ink} stroke={color} strokeWidth={1.9} />
          <Circle cx={15} cy={17} r={2.4} fill={colors.ink} stroke={color} strokeWidth={1.9} />
        </>
      )}
    </Svg>
  );
}

export function AreaChart({ values, height = 70, color = colors.bull }: { values: number[]; height?: number; color?: string }) {
  const [w, setW] = useState(0);
  const pts = values.length >= 2 ? values : [0, 0];
  const min = Math.min(0, ...pts);
  const max = Math.max(0, ...pts);
  const span = max - min || 1;
  const pad = 4;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <View style={{ height, width: "100%" }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={height}>
          <Defs>
            <SvgGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.35} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </SvgGradient>
          </Defs>
          <Line x1={0} y1={y(0)} x2={w} y2={y(0)} stroke="rgba(147,165,186,0.25)" strokeWidth={1} strokeDasharray="3,4" />
          <Path d={area} fill="url(#areaFill)" />
          <Path d={line} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={3.5} fill={color} />
        </Svg>
      )}
    </View>
  );
}

export function RangeBar({ trade, style }: { trade: Trade; style?: StyleProp<ViewStyle> }) {
  const long = trade.direction === "LONG";
  const lo = Math.min(trade.sl, trade.tp, trade.entry);
  const hi = Math.max(trade.sl, trade.tp, trade.entry);
  const left = Math.max(trade.entry - lo, (hi - lo) * 0.02);
  const right = Math.max(hi - trade.entry, (hi - lo) * 0.02);
  const leftColor = long ? colors.bear : colors.bull;
  const rightColor = long ? colors.bull : colors.bear;
  return (
    <View style={style}>
      <View style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden" }}>
        <View style={{ flex: left, backgroundColor: leftColor, opacity: 0.85 }} />
        <View style={{ width: 3, backgroundColor: colors.snow }} />
        <View style={{ flex: right, backgroundColor: rightColor, opacity: 0.85 }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={[rb.label, { color: leftColor }]}>{long ? "SL" : "TP"}</Text>
        <Text style={[rb.label, { color: colors.fog }]}>ENTRADA</Text>
        <Text style={[rb.label, { color: rightColor }]}>{long ? "TP" : "SL"}</Text>
      </View>
    </View>
  );
}

const rb = StyleSheet.create({ label: { fontSize: 8.5, fontWeight: "800", letterSpacing: 1 } });

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("ahora");
  if (s < 3600) return t("hace {n} min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("hace {n} h", { n: Math.floor(s / 3600) });
  return t("hace {n} d", { n: Math.floor(s / 86400) });
}

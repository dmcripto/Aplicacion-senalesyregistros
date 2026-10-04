import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { demoFrame, demoTexts } from "@dmcripto/core";
import { Logo } from "./ui";
import { colors } from "./theme";

const ROW = 40; // alto de cada fila
const GAP = 6;
const CONFETTI = ["#16d98a", "#2ec4f1", "#f5b942"];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Reloj de la animación (milisegundos). Con «reducir movimiento» se queda quieto en el momento del TP alcanzado. */
function useClock() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) return setMs(8800);
        const start = Date.now();
        id = setInterval(() => setMs(Date.now() - start), 50);
      });
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, []);
  return ms;
}

/** Una señal de ejemplo que avanza sola: llega la tarjeta, el precio sube, salta cada target y termina en TP. */
export default function LiveDemo() {
  const ms = useClock();
  const f = demoFrame(ms);
  const tx = demoTexts();
  // Los avisos se quedan con su último contenido mientras se desvanecen.
  const lastToast = useRef(f.toast);
  const lastWin = useRef(f.win);
  if (f.toast) lastToast.current = f.toast;
  if (f.win) lastWin.current = f.win;
  const toast = f.toast ?? lastToast.current;
  const win = f.win ?? lastWin.current;
  const burst = f.win ? f.win.burst : 1;
  const ease = 1 - (1 - burst) * (1 - burst);
  const loopMs = ((ms % 12000) + 12000) % 12000;
  const winOpacity = f.win ? clamp01((loopMs - 8000) / 250) : 0;

  return (
    <View style={[s.card, { opacity: 1 - f.fade * 0.9 }]} accessible accessibilityLabel={`${tx.pair} ${tx.side}`}>
      <View style={s.head}>
        <View style={s.brandRow}>
          <Logo size={26} />
          <Text style={s.brand}>VELTRIX</Text>
        </View>
        <View style={s.live}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>{tx.live}</Text>
        </View>
      </View>

      <View style={s.pairRow}>
        <View>
          <Text style={s.newSignal}>{tx.newSignal}</Text>
          <Text style={s.pair}>{tx.pair}</Text>
          <View style={s.side}>
            <Text style={s.sideText}>▲ {tx.side}</Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={s.price}>{Math.round(f.price).toLocaleString("en-US")}</Text>
          <Text style={[s.pct, { color: f.pct > 0 ? colors.bull : colors.fog }]}>
            {f.pct > 0 ? "+" : ""}
            {f.pct.toFixed(2)}%
          </Text>
        </View>
      </View>

      <View style={{ height: f.levels.length * (ROW + GAP) - GAP, marginTop: 12, paddingLeft: 20 }}>
        <View style={s.trackLine} />
        <View style={[s.dot, { top: f.track * (ROW + GAP) + ROW / 2 - 7 }]} />
        {f.levels.map((l, i) => {
          const col = l.kind === "stop" ? colors.bear : l.kind === "entry" ? colors.cyan : colors.bull;
          const appear = clamp01((loopMs - (180 + i * 200)) / 260);
          return (
            <View
              key={l.key}
              style={[
                s.row,
                {
                  top: i * (ROW + GAP),
                  opacity: appear,
                  transform: [{ translateX: (1 - appear) * -14 }],
                  borderColor: l.reached ? colors.bull : l.kind === "stop" ? "rgba(255,77,103,0.4)" : l.kind === "entry" ? "rgba(46,196,241,0.4)" : colors.line,
                  backgroundColor: l.reached ? "rgba(22,217,138,0.2)" : "rgba(255,255,255,0.04)",
                },
              ]}
            >
              <Text style={[s.rowLabel, { color: col }]}>
                {l.reached ? "✓ " : ""}
                {l.label}
              </Text>
              <Text style={s.rowValue}>{l.value.toLocaleString("en-US")}</Text>
              <Text style={[s.rowPct, { color: col }]}>{l.pct == null ? "" : `${l.pct > 0 ? "+" : "−"}${Math.abs(l.pct).toFixed(2)}%`}</Text>
            </View>
          );
        })}
      </View>

      {/* Aviso de target alcanzado (tiene su lugar propio, no tapa las filas) */}
      <View style={s.toastSlot}>
        <Text style={[s.following, { opacity: f.toast ? 0 : 1 }]}>{tx.following}</Text>
        {f.toast && toast && (
          <View style={s.toast}>
            <Text style={s.toastTitle}>🎯 {toast.title}</Text>
            <Text style={s.toastText}>{toast.text}</Text>
          </View>
        )}
      </View>

      {/* TP alcanzado, con destellos */}
      {winOpacity > 0 && (
        <View style={[s.winOverlay, { opacity: winOpacity }]} pointerEvents="none">
          {CONFETTI.flatMap((c, k) =>
            Array.from({ length: 6 }, (_, j) => ({ c, a: ((k * 6 + j) / 18) * Math.PI * 2 + 0.4, d: 70 + ((k * 6 + j) % 5) * 22 })),
          ).map((p, i) => (
            <View
              key={i}
              style={{
                position: "absolute",
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: p.c,
                opacity: 1 - ease * 0.85,
                transform: [
                  { translateX: Math.cos(p.a) * p.d * ease },
                  { translateY: Math.sin(p.a) * p.d * ease + ease * 14 },
                  { rotate: `${ease * 360}deg` },
                ],
              }}
            />
          ))}
          {win && (
            <>
              <View style={[s.winCircle, { transform: [{ scale: 0.6 + ease * 0.4 }] }]}>
                <Text style={s.winCheck}>✓</Text>
              </View>
              <Text style={s.winTitle}>{win.title}</Text>
              <Text style={s.winR}>{win.r}</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
    overflow: "hidden",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(46,196,241,0.3)",
    backgroundColor: "rgba(8,12,18,0.9)",
    padding: 16,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { color: colors.snow, fontSize: 15, fontWeight: "800", letterSpacing: 1.2 },
  live: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "rgba(22,217,138,0.4)", backgroundColor: "rgba(22,217,138,0.1)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.bull },
  liveText: { color: colors.bull, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  pairRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 12 },
  newSignal: { color: colors.fog, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  pair: { color: colors.snow, fontSize: 24, fontWeight: "800", marginTop: 2 },
  side: { alignSelf: "flex-start", marginTop: 4, borderWidth: 1, borderColor: "rgba(22,217,138,0.5)", backgroundColor: "rgba(22,217,138,0.1)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  sideText: { color: colors.bull, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  price: { color: colors.cyan, fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pct: { fontSize: 12, fontWeight: "800", marginTop: 4, fontVariant: ["tabular-nums"] },
  trackLine: { position: "absolute", left: 7, top: 0, bottom: 0, width: 1, backgroundColor: colors.line },
  dot: { position: "absolute", left: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.cyan, shadowColor: colors.cyan, shadowOpacity: 0.9, shadowRadius: 8, elevation: 6 },
  row: { position: "absolute", left: 20, right: 0, height: ROW, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLabel: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.3, flex: 1.3 },
  rowValue: { color: colors.snow, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"], flex: 1, textAlign: "center" },
  rowPct: { fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"], flex: 1, textAlign: "right" },
  toastSlot: { height: 58, marginTop: 12, justifyContent: "center" },
  following: { color: colors.dim, fontSize: 11, fontWeight: "600", textAlign: "center" },
  toast: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "rgba(22,217,138,0.6)", backgroundColor: "rgba(11,42,31,0.97)", paddingHorizontal: 14 },
  toastTitle: { color: colors.bull, fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  toastText: { color: colors.fog, fontSize: 11, lineHeight: 15, marginTop: 2 },
  winOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(4,20,13,0.9)" },
  winCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, borderColor: colors.bull, backgroundColor: "rgba(22,217,138,0.15)", alignItems: "center", justifyContent: "center" },
  winCheck: { color: colors.bull, fontSize: 34, fontWeight: "800" },
  winTitle: { color: colors.bull, fontSize: 24, fontWeight: "800", marginTop: 12 },
  winR: { color: colors.bull, fontSize: 48, fontWeight: "800", fontVariant: ["tabular-nums"] },
});

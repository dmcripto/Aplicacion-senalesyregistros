// Íconos de línea (mismo estilo que en la web) y su cuadrito de color.
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  journal: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM8 4v13M11 8h5M11 12h5",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  calc: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01",
  candles: "M7 3v3M7 15v3M5 6h4v9H5zM17 5v3M17 17v3M15 8h4v9h-4zM12 9v2M12 14v3M10.5 11h3v3h-3z",
  drop: "M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z",
  bot: "M12 3v3M8 6h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM9 12h.01M15 12h.01M9 18v3M15 18v3M3 11v2M21 11v2",
  radio: "M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0M12 12h.01M12 12v8",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 10 18.7l1-1",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  bell: "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0",
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  bolt: "M13 3L5 14h6l-1 7 8-11h-6l1-7z",
  check: "M5 13l4 4L19 7",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z",
  sliders: "M4 7h16M4 17h16M9 4.6v4.8M15 14.6v4.8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PATHS[name]} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export const TONES = { cyan: "#2ec4f1", green: "#16d98a", violet: "#c4b5fd", amber: "#f5c518" } as const;
export type Tone = keyof typeof TONES;

/** Ícono dentro de su cuadrito de color. */
export function IconTile({ name, tone = "cyan", size = 40 }: { name: IconName; tone?: Tone; size?: number }) {
  const c = TONES[tone];
  return (
    <View style={[st.tile, { width: size, height: size, borderRadius: size * 0.28, borderColor: c + "59", backgroundColor: c + "26" }]}>
      <Icon name={name} color={c} size={Math.round(size * 0.5)} />
    </View>
  );
}

const st = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
});

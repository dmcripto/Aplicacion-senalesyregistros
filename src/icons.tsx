// Iconos de línea (todos del mismo estilo) para el menú, las tarjetas y los títulos. Toman el color del texto (currentColor).

const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  journal: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM8 4v13M11 8h5M11 12h5",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  calc: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01",
  candles: "M7 3v3M7 15v3M5 6h4v9H5zM17 5v3M17 17v3M15 8h4v9h-4zM12 9v2M12 14v3M10.5 11h3v3h-3z",
  drop: "M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z",
  bot: "M12 3v3M8 6h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM9 12h.01M15 12h.01M9 18v3M15 18v3M3 11v2M21 11v2",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6v2M12 16v2",
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
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Colores de cada pantalla (dentro de la paleta de VELTRIX): el icono va dentro de un cuadrito con degradé suave de ese color. */
export const TONES = {
  cyan: "border-gold/35 bg-gradient-to-br from-gold/25 to-gold/5 text-gold",
  green: "border-bull/35 bg-gradient-to-br from-bull/25 to-bull/5 text-bull",
  violet: "border-[#a78bfa]/35 bg-gradient-to-br from-[#a78bfa]/25 to-[#a78bfa]/5 text-[#c4b5fd]",
  amber: "border-[#f5c518]/35 bg-gradient-to-br from-[#f5c518]/25 to-[#f5c518]/5 text-[#f5c518]",
} as const;
export type Tone = keyof typeof TONES;

/** Icono dentro de su cuadrito de color. */
export function IconTile({ name, tone = "cyan", size = "md" }: { name: IconName; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "h-8 w-8 rounded-lg" : size === "lg" ? "h-14 w-14 rounded-xl" : "h-11 w-11 rounded-lg";
  const ic = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <span className={`grid shrink-0 place-items-center border ${TONES[tone]} ${box}`}>
      <Icon name={name} className={ic} />
    </span>
  );
}

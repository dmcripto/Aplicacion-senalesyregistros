import { useEffect, useMemo } from "react";
import { t } from "../lib";

const COLORS = ["#16d98a", "#2ec4f1", "#e8eef6", "#3fc1f0", "#7cf0c2"];

/** Festejo corto cuando una señal toca el TP: una insignia y confeti que sube y se desvanece. */
export default function Celebration({ symbol, token, onDone }: { symbol: string; token: number; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 3200);
    return () => window.clearTimeout(id);
  }, [token, onDone]);

  const pieces = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        i,
        x: (Math.random() - 0.5) * 520,
        y: -(90 + Math.random() * 190),
        rot: Math.random() * 540 - 270,
        delay: Math.random() * 140,
        size: 5 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        round: i % 3 === 0,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-[90] flex justify-center" role="status" aria-live="polite">
      <div className="celebrate-badge relative">
        {pieces.map((p) => (
          <span
            key={`${token}-${p.i}`}
            className="confetti absolute left-1/2 top-1/2"
            style={
              {
                width: p.size,
                height: p.round ? p.size : p.size * 0.5,
                borderRadius: p.round ? "9999px" : "1px",
                background: p.color,
                "--dx": `${p.x}px`,
                "--dy": `${p.y}px`,
                "--rot": `${p.rot}deg`,
                animationDelay: `${p.delay}ms`,
              } as React.CSSProperties
            }
          />
        ))}
        <div className="relative rounded-full border border-bull/60 bg-bull/15 px-6 py-3 text-[15px] font-extrabold tracking-wide text-bull shadow-[0_0_40px_rgba(22,217,138,.35)] backdrop-blur-md">
          🎯 {t("¡TP alcanzado!")} · <span className="num">{symbol}</span>
        </div>
      </div>
    </div>
  );
}

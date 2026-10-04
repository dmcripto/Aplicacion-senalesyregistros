import { useEffect, useRef, useState } from "react";
import { cx, demoFrame, demoTexts } from "../lib";
import { ShieldLogo } from "../ui";

/** Reloj de la animación (milisegundos). Con «reducir movimiento» se queda quieto en el momento del TP alcanzado. */
function useClock() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMs(8800);
      return;
    }
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const loop = (now: number) => {
      if (now - last > 33) {
        last = now;
        setMs(now - start);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return ms;
}

const ROW = 40; // alto de cada fila
const GAP = 6;
const CONFETTI = ["#16d98a", "#2ec4f1", "#f5b942"];

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

  return (
    <div
      className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-cyan/30 bg-ink/85 p-4 shadow-[0_0_60px_rgba(46,196,241,.2)]"
      style={{ opacity: 1 - f.fade * 0.9 }}
      role="img"
      aria-label={`${tx.pair} ${tx.side}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldLogo className="h-7 w-7" />
          <span className="font-display text-[15px] font-extrabold tracking-[0.08em] text-snow">VELTRIX</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-bull/40 bg-bull/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-bull">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bull" />
          {tx.live}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-fog">{tx.newSignal}</div>
          <div className="font-display text-2xl font-extrabold text-snow">{tx.pair}</div>
          <div className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-bull/50 bg-bull/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-bull">▲ {tx.side}</div>
        </div>
        <div className="text-right">
          <div className="num text-[26px] font-extrabold leading-none text-cyan">{Math.round(f.price).toLocaleString("en-US")}</div>
          <div className={cx("num mt-1 text-[12px] font-bold", f.pct > 0 ? "text-bull" : "text-fog")}>{f.pct > 0 ? "+" : ""}{f.pct.toFixed(2)}%</div>
        </div>
      </div>

      <div className="relative mt-3 pl-5" style={{ height: f.levels.length * (ROW + GAP) - GAP }}>
        <div className="absolute bottom-0 left-[7px] top-0 w-px bg-line" />
        <div
          className="absolute left-[1px] h-3.5 w-3.5 rounded-full bg-cyan shadow-[0_0_14px_3px_rgba(46,196,241,.75)]"
          style={{ top: f.track * (ROW + GAP) + ROW / 2 - 7 }}
        />
        {f.levels.map((l, i) => (
          <div
            key={l.key}
            className={cx(
              "absolute left-5 right-0 flex items-center justify-between rounded-lg border px-3 transition-all duration-500",
              l.reached ? "border-bull bg-bull/20" : l.kind === "stop" ? "border-bear/40 bg-bear/5" : l.kind === "entry" ? "border-cyan/40 bg-cyan/5" : "border-line bg-white/[0.04]",
            )}
            style={{ top: i * (ROW + GAP), height: ROW, opacity: l.shown ? 1 : 0, transform: l.shown ? "none" : "translateX(-14px)" }}
          >
            <span className={cx("text-[10.5px] font-bold tracking-[0.14em]", l.kind === "stop" ? "text-bear" : l.kind === "entry" ? "text-cyan" : "text-bull")}>
              {l.reached ? "✓ " : ""}{l.label}
            </span>
            <span className="num text-[15px] font-bold text-snow">{l.value.toLocaleString("en-US")}</span>
            <span className={cx("num w-16 text-right text-[12px] font-bold", l.kind === "stop" ? "text-bear" : "text-bull")}>
              {l.pct == null ? "" : `${l.pct > 0 ? "+" : "−"}${Math.abs(l.pct).toFixed(2)}%`}
            </span>
          </div>
        ))}
      </div>

      {/* Aviso de target alcanzado (tiene su lugar propio, no tapa las filas) */}
      <div className="relative mt-3 h-[58px]">
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-dim transition-opacity duration-300" style={{ opacity: f.toast ? 0 : 1 }}>
          {tx.following}
        </div>
        <div
          className="absolute inset-0 flex flex-col justify-center rounded-xl border border-bull/60 bg-[#0b2a1f]/95 px-3.5 shadow-[0_8px_30px_rgba(22,217,138,.25)] transition-all duration-300"
          style={{ opacity: f.toast ? 1 : 0, transform: f.toast ? "translateY(0)" : "translateY(12px)" }}
        >
          {toast && (
            <>
              <div className="text-[12px] font-extrabold tracking-wide text-bull">🎯 {toast.title}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-fog">{toast.text}</div>
            </>
          )}
        </div>
      </div>

      {/* TP alcanzado, con destellos */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[#04140d]/80 backdrop-blur-[2px] transition-opacity duration-300"
        style={{ opacity: f.win ? 1 : 0 }}
      >
        {CONFETTI.flatMap((c, k) => Array.from({ length: 6 }, (_, j) => ({ c, a: ((k * 6 + j) / 18) * Math.PI * 2 + 0.4, d: 70 + ((k * 6 + j) % 5) * 22 }))).map((p, i) => (
          <span
            key={i}
            className="absolute left-1/2 top-1/2 h-2 w-2 rounded-sm"
            style={{ background: p.c, opacity: f.win ? 1 - ease * 0.85 : 0, transform: `translate(${Math.cos(p.a) * p.d * ease - 4}px, ${Math.sin(p.a) * p.d * ease - 4 + ease * 14}px) rotate(${ease * 360}deg)` }}
          />
        ))}
        {win && (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-bull bg-bull/15 text-4xl text-bull" style={{ transform: `scale(${0.6 + ease * 0.4})` }}>✓</div>
            <div className="mt-3 font-display text-2xl font-extrabold text-bull">{win.title}</div>
            <div className="num font-display text-5xl font-extrabold leading-tight text-bull">{win.r}</div>
          </>
        )}
      </div>
    </div>
  );
}

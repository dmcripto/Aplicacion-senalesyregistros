import { useMemo, useState } from "react";
import { equitySeries, fmtDateTime, fmtR } from "../lib";
import type { Trade } from "../lib";
import { useInView } from "../hooks";
import { IconCandles, TriDown, TriUp } from "../ui";

const W = 820;
const H = 252;
const PL = 48;
const PR = 16;
const PT = 18;
const PB = 30;

export default function EquityChart({ trades }: { trades: Trade[] }) {
  const series = useMemo(() => equitySeries(trades), [trades]);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>(0.25);

  const geom = useMemo(() => {
    if (!series.length) return null;
    const cums = [0, ...series.map((p) => p.cum)];
    let min = Math.min(...cums);
    let max = Math.max(...cums);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad;
    const n = series.length;
    const x = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, n - 1);
    const y = (v: number) => PT + ((max - v) / (max - min)) * (H - PT - PB);
    const pts = series.map((p, i) => ({ ...p, x: x(i), y: y(p.cum) }));
    const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${pts[n - 1].x.toFixed(1)},${y(Math.max(0, min + pad * 0)).toFixed(1)}`;
    return { pts, linePath, areaPath, x, y, min, max, n };
  }, [series]);

  if (!geom) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
        <IconCandles className="h-16 w-32 opacity-70" />
        <p className="max-w-sm text-sm leading-relaxed text-fog">
          Todavía no hay operaciones cerradas. Cuando marques un TP, un SL o un cierre manual,
          la <span className="font-semibold text-snow">curva de capital en R</span> se dibuja acá.
        </p>
      </div>
    );
  }

  const { pts, linePath, y, min, max } = geom;
  const final = pts[pts.length - 1].cum;
  const pos = final >= 0;
  const stroke = pos ? "var(--color-bull)" : "var(--color-bear)";
  const gradId = pos ? "eqGradPos" : "eqGradNeg";
  const baselineY = y(0);

  const gridVals = [0.25, 0.5, 0.75].map((f) => min + (max - min) * f);
  const firstDate = fmtDateTime(pts[0].trade.closedAt ?? pts[0].trade.date).split(" · ")[0];
  const lastDate = fmtDateTime(pts[pts.length - 1].trade.closedAt ?? pts[pts.length - 1].trade.date).split(" · ")[0];

  const hp = hover != null ? pts[hover] : null;

  return (
    <div ref={ref}>
      {/* cabecera */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-wide text-snow">CURVA DE CAPITAL</h2>
          <p className="text-[11px] uppercase tracking-[0.16em] text-dim">R acumulado por operación cerrada</p>
        </div>
        <div
          className={`num rounded-md px-3.5 py-1.5 text-lg font-bold ${pos ? "bg-bull/12 text-bull" : "bg-bear/12 text-bear"}`}
          style={{ boxShadow: `inset 0 0 0 1px ${pos ? "rgba(22,217,138,.35)" : "rgba(255,77,103,.35)"}` }}
        >
          {fmtR(final)}R
        </div>
      </div>

      <div className="relative px-2 pb-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const step = (W - PL - PR) / Math.max(1, pts.length - 1);
            const idx = Math.round((px - PL) / step);
            setHover(idx < 0 ? 0 : idx >= pts.length ? pts.length - 1 : idx);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="eqGradPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-bull)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-bull)" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="eqGradNeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-bear)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--color-bear)" stopOpacity="0.26" />
            </linearGradient>
          </defs>

          {/* rejilla horizontal */}
          {gridVals.map((v) => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={PL - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-dim)" className="num">
                {fmtR(v)}
              </text>
            </g>
          ))}

          {/* línea de break-even (0R) */}
          {min < 0 && max > 0 && (
            <line
              x1={PL}
              x2={W - PR}
              y1={baselineY}
              y2={baselineY}
              stroke="var(--color-line2)"
              strokeWidth="1"
              strokeDasharray="5 5"
            />
          )}

          {/* área */}
          <path
            d={`${linePath} L${pts[pts.length - 1].x},${baselineY} L${pts[0].x},${baselineY} Z`}
            fill={`url(#${gradId})`}
            className="fade-in"
          />

          {/* línea principal con animación de trazo */}
          <path
            d={linePath}
            fill="none"
            stroke={stroke}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={inView ? 0 : 1}
            style={{ transition: "stroke-dashoffset 1.3s cubic-bezier(.4,0,.2,1) .15s" }}
          />

          {/* puntos */}
          {pts.map((p, i) => (
            <circle
              key={p.trade.id}
              cx={p.x}
              cy={p.y}
              r={hover === i ? 5 : 2.6}
              fill={p.r >= 0 ? "var(--color-bull)" : "var(--color-bear)"}
              stroke="var(--color-ink)"
              strokeWidth="1.4"
              style={{ transition: "r .15s ease" }}
            />
          ))}

          {/* crosshair */}
          {hp && (
            <line x1={hp.x} x2={hp.x} y1={PT} y2={H - PB} stroke="var(--color-line2)" strokeWidth="1" strokeDasharray="3 4" />
          )}

          {/* eje X */}
          <text x={PL} y={H - 9} fontSize="10" fill="var(--color-dim)" className="num">
            {firstDate}
          </text>
          <text x={W - PR} y={H - 9} textAnchor="end" fontSize="10" fill="var(--color-dim)" className="num">
            {lastDate}
          </text>
          <text x={(PL + W - PR) / 2} y={H - 9} textAnchor="middle" fontSize="10" fill="var(--color-dim)" className="num">
            {pts.length} operaciones
          </text>
        </svg>

        {/* tooltip flotante */}
        {hp && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-line2 bg-raise/95 px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,.55)] backdrop-blur-sm"
            style={{
              left: `${(hp.x / W) * 100}%`,
              top: `${(hp.y / H) * 100}%`,
              transform: `translate(-50%, ${hp.y < 74 ? "14px" : "calc(-100% - 12px)"})`,
            }}
          >
            <div className="num flex items-center gap-1.5 text-[11px] font-semibold text-snow">
              {hp.trade.direction === "LONG" ? (
                <TriUp className="h-2 w-2 text-bull" />
              ) : (
                <TriDown className="h-2 w-2 text-bear" />
              )}
              {hp.trade.symbol} · {hp.trade.outcome === "MANUAL" ? "CIERRE" : hp.trade.outcome}
            </div>
            <div className="num mt-0.5 text-[10px] text-fog">
              {fmtDateTime(hp.trade.closedAt ?? hp.trade.date)}
            </div>
            <div className="num mt-1 text-sm font-bold">
              <span className={hp.r >= 0 ? "text-bull" : "text-bear"}>{fmtR(hp.r)}R</span>
              <span className="ml-1.5 text-fog">→ {fmtR(hp.cum)}R</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

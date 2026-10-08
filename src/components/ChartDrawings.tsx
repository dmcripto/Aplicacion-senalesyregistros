import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_DRAWINGS, cleanDrawings, cx, fibPrices, fmtPrice, logicalToTime, t, timeToLogical } from "../lib";
import type { ChartCandle, DrawKind, DrawPoint, Drawing } from "../lib";

const KEY = "veltrix_draw_v1";
const BLUE = "#2962ff";
const TOOLBAR_W = 40;

/** Lo que hace falta del gráfico para convertir entre pantalla y (hora, precio). */
export interface ChartHandle {
  chart: any;
  series: any;
}

const loadAll = (): Record<string, unknown> => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
const saveFor = (symbol: string, list: Drawing[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadAll(), [symbol]: list }));
  } catch {
    /* sin almacenamiento: los dibujos quedan solo hasta cerrar la página */
  }
};

type Tool = "cursor" | DrawKind;
const TOOLS: Array<{ id: Tool; icon: string; title: string }> = [
  { id: "cursor", icon: "✛", title: "Cursor" },
  { id: "hline", icon: "─", title: "Línea horizontal" },
  { id: "trend", icon: "⟋", title: "Línea de tendencia" },
  { id: "rect", icon: "▭", title: "Rectángulo" },
  { id: "fib", icon: "Fib", title: "Retroceso de Fibonacci" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

/** Barra de dibujo (a la izquierda) y capa transparente con los dibujos. Solo atrapa el mouse cuando hay una herramienta elegida o sobre un dibujo. */
export default function ChartDrawings({ api, ready, candles, tfSec, symbol }: { api: ChartHandle | null; ready: number; candles: ChartCandle[] | null; tfSec: number; symbol: string }) {
  const [list, setList] = useState<Drawing[]>(() => cleanDrawings(loadAll()[symbol]));
  const [tool, setTool] = useState<Tool>("cursor");
  const [pending, setPending] = useState<DrawPoint | null>(null);
  const [hover, setHover] = useState<DrawPoint | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [geom, setGeom] = useState("");
  const times = useMemo(() => (candles ?? []).map((c) => c.time), [candles]);
  const timesRef = useRef(times);
  timesRef.current = times;
  const svgRef = useRef<SVGSVGElement>(null);

  // Al cambiar de activo se cargan sus dibujos.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setList(cleanDrawings(loadAll()[symbol]));
    setSelected(null);
    setPending(null);
    setTool("cursor");
  }, [symbol]);

  const commit = (next: Drawing[]) => {
    const cut = next.slice(-MAX_DRAWINGS);
    setList(cut);
    saveFor(symbol, cut);
  };

  // Conversión pantalla ↔ (hora, precio).
  const toX = (time: number): number | null => {
    if (!api || !times.length) return null;
    const x = api.chart.timeScale().logicalToCoordinate(timeToLogical(times, tfSec, time));
    return x == null ? null : x;
  };
  const toY = (price: number): number | null => {
    if (!api) return null;
    const y = api.series.priceToCoordinate(price);
    return y == null ? null : y;
  };
  const fromEvent = (e: { clientX: number; clientY: number }): DrawPoint | null => {
    if (!api || !svgRef.current || !times.length) return null;
    const r = svgRef.current.getBoundingClientRect();
    const logical = api.chart.timeScale().coordinateToLogical(e.clientX - r.left);
    const price = api.series.coordinateToPrice(e.clientY - r.top);
    if (logical == null || price == null) return null;
    return { t: logicalToTime(times, tfSec, logical), p: price };
  };

  // Redibuja cuando el gráfico se mueve o cambia de escala (se compara una «huella» para no repintar de más).
  useEffect(() => {
    if (!api) return;
    let raf = 0;
    const loop = () => {
      const tm = timesRef.current;
      const parts: Array<number | null> = [api.chart.priceScale("right").width(), api.chart.panes()[0]?.getHeight?.() ?? 0, tm.length ? tm[tm.length - 1] : 0];
      for (const d of list) for (const pt of [d.a, d.b]) {
        if (!pt || !tm.length) continue;
        const x = api.chart.timeScale().logicalToCoordinate(timeToLogical(tm, tfSec, pt.t));
        const y = api.series.priceToCoordinate(pt.p);
        parts.push(x == null ? null : Math.round(x), y == null ? null : Math.round(y));
      }
      const key = parts.join(",");
      setGeom((g) => (g === key ? g : key));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [api, ready, list, tfSec]);

  // Teclado: Esc cancela lo que se está dibujando; Supr borra el dibujo elegido.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        setPending(null);
        setTool("cursor");
        setSelected(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        setList((l) => {
          const next = l.filter((d) => d.id !== selected);
          saveFor(symbol, next);
          return next;
        });
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, symbol]);

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "cursor" || e.button !== 0) return;
    const pt = fromEvent(e);
    if (!pt) return;
    e.preventDefault();
    if (tool === "hline") {
      const d: Drawing = { id: uid(), kind: "hline", a: pt };
      commit([...list, d]);
      setSelected(d.id);
      setTool("cursor");
    } else if (!pending) {
      setPending(pt);
    } else {
      const d: Drawing = { id: uid(), kind: tool, a: pending, b: pt };
      commit([...list, d]);
      setSelected(d.id);
      setPending(null);
      setTool("cursor");
    }
  };

  void geom; // el cambio de huella dispara el repintado
  const drawing = tool !== "cursor";
  const W = api ? (svgRef.current?.clientWidth ?? 0) - api.chart.priceScale("right").width() : 0;
  const H = api ? (api.chart.panes()[0]?.getHeight?.() ?? 0) : 0;

  const shapes = [...list, ...(pending && hover && tool !== "cursor" && tool !== "hline" ? [{ id: "__preview", kind: tool, a: pending, b: hover } as Drawing] : [])];

  const render = (d: Drawing) => {
    const sel = d.id === selected;
    const preview = d.id === "__preview";
    const col = BLUE;
    const pick = preview ? undefined : (ev: React.PointerEvent) => {
      if (tool !== "cursor") return;
      ev.stopPropagation();
      setSelected(d.id);
    };
    const common = { onPointerDown: pick, style: { pointerEvents: preview ? ("none" as const) : tool === "cursor" ? ("stroke" as const) : ("none" as const), cursor: "pointer" } };
    const ya = toY(d.a.p);
    if (d.kind === "hline") {
      if (ya == null) return null;
      return (
        <g key={d.id}>
          <line x1={0} x2={W} y1={ya} y2={ya} stroke={col} strokeWidth={sel ? 2 : 1} {...common} />
          <line x1={0} x2={W} y1={ya} y2={ya} stroke="transparent" strokeWidth={10} {...common} />
          <rect x={W - 62} y={ya - 9} width={62} height={18} fill={col} rx={2} style={{ pointerEvents: "none" }} />
          <text x={W - 31} y={ya + 4} textAnchor="middle" fontSize={11} fill="#fff" style={{ pointerEvents: "none" }}>
            {fmtPrice(d.a.p)}
          </text>
        </g>
      );
    }
    const xa = toX(d.a.t);
    const xb = d.b ? toX(d.b.t) : null;
    const yb = d.b ? toY(d.b.p) : null;
    if (xa == null || ya == null || xb == null || yb == null || !d.b) return null;
    const handles = sel ? [[xa, ya], [xb, yb]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4.5} fill="#131722" stroke={col} strokeWidth={2} style={{ pointerEvents: "none" }} />) : null;
    if (d.kind === "trend") {
      return (
        <g key={d.id} opacity={preview ? 0.7 : 1}>
          <line x1={xa} y1={ya} x2={xb} y2={yb} stroke={col} strokeWidth={sel ? 2.5 : 1.5} {...common} />
          <line x1={xa} y1={ya} x2={xb} y2={yb} stroke="transparent" strokeWidth={12} {...common} />
          {handles}
        </g>
      );
    }
    if (d.kind === "rect") {
      return (
        <g key={d.id} opacity={preview ? 0.7 : 1}>
          <rect x={Math.min(xa, xb)} y={Math.min(ya, yb)} width={Math.abs(xb - xa)} height={Math.abs(yb - ya)} fill="rgba(41,98,255,0.15)" stroke={col} strokeWidth={sel ? 2 : 1} {...common} style={{ ...common.style, pointerEvents: preview ? "none" : tool === "cursor" ? "all" : "none" }} />
          {handles}
        </g>
      );
    }
    // Fibonacci
    const lv = fibPrices(d.a, d.b);
    const left = Math.min(xa, xb);
    const right = Math.max(xa, xb);
    return (
      <g key={d.id} opacity={preview ? 0.7 : 1}>
        {lv.map((l, i) => {
          const y = toY(l.price);
          const yPrev = i > 0 ? toY(lv[i - 1].price) : null;
          if (y == null) return null;
          return (
            <g key={l.level}>
              {yPrev != null && <rect x={left} y={Math.min(y, yPrev)} width={right - left} height={Math.abs(y - yPrev)} fill={i % 2 ? "rgba(41,98,255,0.07)" : "rgba(41,98,255,0.13)"} style={{ pointerEvents: "none" }} />}
              <line x1={left} x2={right} y1={y} y2={y} stroke={col} strokeWidth={sel ? 2 : 1} {...common} />
              <text x={left + 4} y={y - 3} fontSize={10.5} fill="#b2b5be" style={{ pointerEvents: "none" }}>
                {l.level} ({fmtPrice(l.price)})
              </text>
            </g>
          );
        })}
        <line x1={xa} y1={ya} x2={xb} y2={yb} stroke="#787b86" strokeDasharray="4 3" strokeWidth={1} style={{ pointerEvents: "none" }} />
        {handles}
      </g>
    );
  };

  const btn = (active: boolean) => cx("grid h-9 w-full place-items-center text-[13px] font-semibold transition-colors", active ? "bg-[#2a2e39] text-[#2962ff]" : "text-[#b2b5be] hover:bg-[#1e222d] hover:text-white");

  return (
    <>
      <div className="absolute inset-y-0 left-0 z-10 flex flex-col border-r border-[#2a2e39] bg-[#131722]" style={{ width: TOOLBAR_W }}>
        {TOOLS.map((x) => (
          <button
            key={x.id}
            type="button"
            title={t(x.title)}
            aria-label={t(x.title)}
            aria-pressed={tool === x.id}
            onClick={() => {
              setTool(x.id);
              setPending(null);
              if (x.id !== "cursor") setSelected(null);
            }}
            className={btn(tool === x.id)}
          >
            {x.icon}
          </button>
        ))}
        <div className="mt-auto flex flex-col border-t border-[#2a2e39]">
          <button
            type="button"
            title={t("Borrar el dibujo elegido")}
            aria-label={t("Borrar el dibujo elegido")}
            disabled={!selected}
            onClick={() => {
              if (selected) commit(list.filter((d) => d.id !== selected));
              setSelected(null);
            }}
            className={cx(btn(false), "disabled:opacity-30")}
          >
            ⌫
          </button>
          <button
            type="button"
            title={t("Borrar todos los dibujos")}
            aria-label={t("Borrar todos los dibujos")}
            disabled={!list.length}
            onClick={() => {
              commit([]);
              setSelected(null);
              setPending(null);
            }}
            className={cx(btn(false), "disabled:opacity-30")}
          >
            🗑
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        data-draw-layer
        className="absolute top-0 z-[5]"
        style={{ left: TOOLBAR_W, right: 0, height: H || "100%", width: `calc(100% - ${TOOLBAR_W}px)`, pointerEvents: drawing ? "auto" : "none", cursor: drawing ? "crosshair" : "default", touchAction: drawing ? "none" : "auto" }}
        onPointerDown={onDown}
        onPointerMove={(e) => drawing && pending && setHover(fromEvent(e))}
      >
        <defs>
          <clipPath id="veltrix-draw-clip">
            <rect x={0} y={0} width={Math.max(0, W)} height={H || 9999} />
          </clipPath>
        </defs>
        <g clipPath="url(#veltrix-draw-clip)">{shapes.map(render)}</g>
      </svg>
      {drawing && (
        <div className="pointer-events-none absolute left-12 top-2 z-10 rounded bg-[#1e222d]/90 px-2 py-1 text-[11px] text-[#d1d4dc]">
          {tool === "hline" ? t("Tocá el gráfico para poner la línea.") : pending ? t("Tocá el segundo punto. Esc cancela.") : t("Tocá el primer punto.")}
        </div>
      )}
    </>
  );
}

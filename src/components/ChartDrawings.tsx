import { useEffect, useMemo, useRef, useState } from "react";
import { DRAW_COLORS, MAX_DRAWINGS, MAX_TEXT, ONE_POINT_KINDS, cleanDrawings, cx, fibPrices, fmtPrice, logicalToTime, measure, t, timeToLogical } from "../lib";
import type { AlertDraft, AlertTf } from "../lib";
import type { ChartCandle, DrawKind, DrawPoint, Drawing } from "../lib";

const KEY = "veltrix_draw_v1";
const MAGNET_KEY = "veltrix_magnet_v1";
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

type Tool = "cursor" | DrawKind | "alert";
const TOOLS: Array<{ id: Tool; icon: string; title: string }> = [
  { id: "cursor", icon: "✛", title: "Cursor" },
  { id: "hline", icon: "─", title: "Línea horizontal" },
  { id: "vline", icon: "│", title: "Línea vertical" },
  { id: "trend", icon: "⟋", title: "Línea de tendencia" },
  { id: "ray", icon: "⇗", title: "Rayo (la línea sigue hacia la derecha)" },
  { id: "rect", icon: "▭", title: "Rectángulo" },
  { id: "fib", icon: "Fib", title: "Retroceso de Fibonacci" },
  { id: "ruler", icon: "📏", title: "Medir (precio, porcentaje y velas)" },
  { id: "text", icon: "T", title: "Nota de texto" },
  { id: "alert", icon: "🔔", title: "Crear alerta de precio" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

/** Barra de dibujo (a la izquierda) y capa transparente con los dibujos. Solo atrapa el mouse cuando hay una herramienta elegida o sobre un dibujo. */
export interface AlertMaker {
  lastPrice: number | null;
  tf: AlertTf;
  create: (d: AlertDraft) => Promise<void>;
}

export default function ChartDrawings({ api, ready, candles, tfSec, symbol, alertMaker }: { api: ChartHandle | null; ready: number; candles: ChartCandle[] | null; tfSec: number; symbol: string; alertMaker?: AlertMaker }) {
  const [list, setList] = useState<Drawing[]>(() => cleanDrawings(loadAll()[symbol]));
  const [tool, setTool] = useState<Tool>("cursor");
  const [pending, setPending] = useState<DrawPoint | null>(null);
  const [hover, setHover] = useState<DrawPoint | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [alertHover, setAlertHover] = useState<number | null>(null); // precio bajo el mouse mientras se elige dónde poner la alerta
  const [alertAt, setAlertAt] = useState<number | null>(null); // precio elegido, a la espera de confirmar
  const [alertBusy, setAlertBusy] = useState(false);
  const [color, setColor] = useState<string>(DRAW_COLORS[0]);
  const [magnet, setMagnet] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MAGNET_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleMagnet = () =>
    setMagnet((m) => {
      try {
        localStorage.setItem(MAGNET_KEY, m ? "0" : "1");
      } catch {
        /* igual */
      }
      return !m;
    });
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
    setAlertAt(null);
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
    if (magnet && candles?.length) {
      // Imán: se pega al máximo, mínimo, apertura o cierre más cercano de la vela, si está cerca.
      const c = candles[Math.max(0, Math.min(candles.length - 1, Math.round(logical)))];
      const y = e.clientY - r.top;
      let best: { p: number; d: number } | null = null;
      for (const v of [c.open, c.high, c.low, c.close]) {
        const vy = api.series.priceToCoordinate(v);
        if (vy == null) continue;
        const d = Math.abs(vy - y);
        if (!best || d < best.d) best = { p: v, d };
      }
      if (best && best.d <= 28) return { t: c.time, p: best.p };
    }
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setList((l) => {
          const next = l.slice(0, -1);
          saveFor(symbol, next);
          return next;
        });
        setSelected(null);
      } else if (e.key === "Escape") {
        setAlertAt(null);
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

  const roundPrice = (p: number) => Number(p.toFixed(p < 10 ? 5 : 2));
  const alertDir = (level: number): "above" | "below" => (alertMaker?.lastPrice != null && level < alertMaker.lastPrice ? "below" : "above");
  const confirmAlert = async () => {
    if (alertAt == null || !alertMaker || alertBusy) return;
    setAlertBusy(true);
    try {
      await alertMaker.create({ symbol, kind: "price", tf: alertMaker.tf, dir: alertDir(alertAt), level: alertAt, period: null, once: true });
      setAlertAt(null);
    } finally {
      setAlertBusy(false);
    }
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "cursor" || e.button !== 0) return;
    const pt = fromEvent(e);
    if (!pt) return;
    e.preventDefault();
    if (tool === "alert") {
      setAlertAt(roundPrice(pt.p));
      setAlertHover(null);
      setTool("cursor");
      return;
    }
    if (ONE_POINT_KINDS.includes(tool as DrawKind)) {
      const d: Drawing = { id: uid(), kind: tool as DrawKind, a: pt, color };
      if (tool === "text") {
        const txt = (window.prompt(t("Texto de la nota"), "") ?? "").trim().slice(0, MAX_TEXT);
        if (!txt) {
          setTool("cursor");
          return;
        }
        d.text = txt;
      }
      commit([...list, d]);
      setSelected(d.id);
      setTool("cursor");
    } else if (!pending) {
      setPending(pt);
    } else {
      const d: Drawing = { id: uid(), kind: tool as DrawKind, a: pending, b: pt, color };
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

  const shapes = [...list, ...(pending && hover && tool !== "cursor" && tool !== "alert" && !ONE_POINT_KINDS.includes(tool as DrawKind) ? [{ id: "__preview", kind: tool as DrawKind, a: pending, b: hover, color } as Drawing] : [])];

  const render = (d: Drawing) => {
    const sel = d.id === selected;
    const preview = d.id === "__preview";
    const col = d.color ?? BLUE;
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
    if (d.kind === "vline" || d.kind === "text") {
      const xv = toX(d.a.t);
      if (xv == null) return null;
      if (d.kind === "vline") {
        return (
          <g key={d.id}>
            <line x1={xv} x2={xv} y1={0} y2={H} stroke={col} strokeWidth={sel ? 2 : 1} {...common} />
            <line x1={xv} x2={xv} y1={0} y2={H} stroke="transparent" strokeWidth={10} {...common} />
          </g>
        );
      }
      const label = d.text ?? "";
      const w = Math.max(24, label.length * 6.6 + 14);
      return (
        <g key={d.id} {...common}>
          <circle cx={xv} cy={ya ?? 0} r={3.5} fill={col} style={{ pointerEvents: "none" }} />
          <rect x={xv + 6} y={(ya ?? 0) - 11} width={w} height={22} rx={3} fill="#1e222d" stroke={col} strokeWidth={sel ? 2 : 1} />
          <text x={xv + 6 + w / 2} y={(ya ?? 0) + 4} textAnchor="middle" fontSize={11.5} fill="#d1d4dc" style={{ pointerEvents: "none" }}>
            {label}
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
    if (d.kind === "ray") {
      const dx = xb - xa;
      const dy = yb - ya;
      let x2 = xb;
      let y2 = yb;
      if (Math.abs(dx) > 0.5) {
        x2 = dx > 0 ? W : 0;
        y2 = ya + (dy / dx) * (x2 - xa);
      } else {
        x2 = xa;
        y2 = dy >= 0 ? H : 0;
      }
      return (
        <g key={d.id} opacity={preview ? 0.7 : 1}>
          <line x1={xa} y1={ya} x2={x2} y2={y2} stroke={col} strokeWidth={sel ? 2.5 : 1.5} {...common} />
          <line x1={xa} y1={ya} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} {...common} />
          {handles}
        </g>
      );
    }
    if (d.kind === "ruler") {
      const m = measure(d.a, d.b);
      const up = m.diff >= 0;
      const tone = up ? "#16d98a" : "#ff4d67";
      const bars = Math.round(m.seconds / tfSec);
      const label = `${up ? "+" : "−"}${fmtPrice(Math.abs(m.diff))} (${up ? "+" : "−"}${Math.abs(m.pct).toFixed(2)}%) · ${bars} ${t("velas")}`;
      const bw = label.length * 6.3 + 16;
      const cx0 = (xa + xb) / 2;
      const cy0 = Math.min(ya, yb) - 16;
      return (
        <g key={d.id} opacity={preview ? 0.75 : 1}>
          <rect x={Math.min(xa, xb)} y={Math.min(ya, yb)} width={Math.abs(xb - xa)} height={Math.abs(yb - ya)} fill={up ? "rgba(22,217,138,0.12)" : "rgba(255,77,103,0.12)"} stroke={tone} strokeWidth={sel ? 2 : 1} strokeDasharray="4 3" {...common} />
          <line x1={xa} y1={ya} x2={xb} y2={yb} stroke={tone} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
          <rect x={cx0 - bw / 2} y={cy0 - 11} width={bw} height={22} rx={3} fill="#1e222d" stroke={tone} style={{ pointerEvents: "none" }} />
          <text x={cx0} y={cy0 + 4} textAnchor="middle" fontSize={11.5} fill={tone} fontWeight={600} style={{ pointerEvents: "none" }}>
            {label}
          </text>
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
      <div className="absolute inset-y-0 left-0 z-10 flex flex-col overflow-y-auto border-r border-[#2a2e39] bg-[#131722]" style={{ width: TOOLBAR_W }}>
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
              setAlertAt(null);
              if (x.id !== "cursor") setSelected(null);
            }}
            className={btn(tool === x.id)}
          >
            {x.icon}
          </button>
        ))}
        <div className="mt-auto flex flex-col border-t border-[#2a2e39]">
          <div className="grid grid-cols-2 gap-1 p-1.5" role="group" aria-label={t("Color del dibujo")}>
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={t("Color del dibujo")}
                aria-label={`${t("Color del dibujo")} ${c}`}
                aria-pressed={color === c}
                onClick={() => {
                  setColor(c);
                  if (selected) commit(list.map((d) => (d.id === selected ? { ...d, color: c } : d)));
                }}
                className={cx("h-4 w-full rounded-sm border", color === c ? "border-white" : "border-transparent")}
                style={{ background: c }}
              />
            ))}
          </div>
          <button type="button" title={t("Imán: se pega al máximo, mínimo, apertura o cierre de la vela")} aria-label={t("Imán: se pega al máximo, mínimo, apertura o cierre de la vela")} aria-pressed={magnet} onClick={toggleMagnet} className={btn(magnet)}>
            🧲
          </button>
          <button type="button" title={t("Deshacer el último dibujo (Ctrl+Z)")} aria-label={t("Deshacer el último dibujo (Ctrl+Z)")} disabled={!list.length} onClick={() => commit(list.slice(0, -1))} className={cx(btn(false), "disabled:opacity-30")}>
            ↶
          </button>
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
        onPointerMove={(e) => {
          if (tool === "alert") {
            const pt = fromEvent(e);
            setAlertHover(pt ? roundPrice(pt.p) : null);
          } else if (drawing && pending) setHover(fromEvent(e));
        }}
      >
        <defs>
          <clipPath id="veltrix-draw-clip">
            <rect x={0} y={0} width={Math.max(0, W)} height={H || 9999} />
          </clipPath>
        </defs>
        <g clipPath="url(#veltrix-draw-clip)">
          {shapes.map(render)}
          {[tool === "alert" ? alertHover : null, alertAt].map((lv, i) => {
            const y = lv != null ? toY(lv) : null;
            if (lv == null || y == null) return null;
            const col = i === 1 ? "#f5b301" : "#787b86";
            return (
              <g key={i} style={{ pointerEvents: "none" }}>
                <line x1={0} x2={W} y1={y} y2={y} stroke={col} strokeWidth={1} strokeDasharray={i === 1 ? undefined : "5 4"} />
                <rect x={W - 62} y={y - 9} width={62} height={18} fill={col} rx={2} />
                <text x={W - 31} y={y + 4} textAnchor="middle" fontSize={11} fill="#131722" fontWeight={600}>
                  {fmtPrice(lv)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {drawing && (
        <div className="pointer-events-none absolute left-12 top-2 z-10 rounded bg-[#1e222d]/90 px-2 py-1 text-[11px] text-[#d1d4dc]">
          {tool === "alert" ? t("Tocá el gráfico en el precio donde querés la alerta. Esc cancela.") : ONE_POINT_KINDS.includes(tool as DrawKind) ? t("Tocá el gráfico para ponerlo. Esc cancela.") : pending ? t("Tocá el segundo punto. Esc cancela.") : t("Tocá el primer punto.")}
        </div>
      )}
      {alertAt != null && api && alertMaker && (
        <div
          className="absolute z-20 flex items-center gap-2 rounded border border-[#f5b301]/60 bg-[#1e222d] px-2.5 py-1.5 text-[11.5px] text-[#d1d4dc] shadow-lg"
          style={{ top: Math.max(4, Math.min((toY(alertAt) ?? 40) - 46, Math.max(4, H - 56))), right: api.chart.priceScale("right").width() + 8 }}
        >
          <span>
            {alertDir(alertAt) === "above" ? t("Avisarme si el precio cruza por encima de {n}", { n: fmtPrice(alertAt) }) : t("Avisarme si el precio cruza por debajo de {n}", { n: fmtPrice(alertAt) })}
          </span>
          <button type="button" disabled={alertBusy} onClick={confirmAlert} className="rounded bg-[#f5b301] px-2 py-0.5 font-semibold text-[#131722] disabled:opacity-50">
            {t("Crear alerta")}
          </button>
          <button type="button" onClick={() => setAlertAt(null)} className="rounded px-1.5 py-0.5 text-[#b2b5be] hover:text-white" aria-label={t("Cancelar")}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}

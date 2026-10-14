import { useEffect, useRef, useState } from "react";
import { binanceSymbol, locale } from "../lib";

const TV_INTERVAL: Record<string, string> = { "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };

/** Gráfico oficial de TradingView (widget gratuito): todas sus herramientas e indicadores. Solo se carga cuando la persona lo elige. */
export default function TradingViewEmbed({ symbol, tf, height }: { symbol: string; tf: string; height: { vh: number; min: number; max: number } | "full" }) {
  const box = useRef<HTMLDivElement>(null);
  // Alto en píxeles reales: el widget mide su caja al cargar y con alturas CSS relativas (vh/clamp) quedaba chico.
  const calc = () => (height === "full" ? window.innerHeight : Math.round(Math.min(height.max, Math.max(height.min, (window.innerHeight * height.vh) / 100))));
  const [px, setPx] = useState(calc);
  const [shown, setShown] = useState(px); // alto con el que se arma el widget (se actualiza cuando el tamaño deja de cambiar)
  useEffect(() => {
    const id = window.setTimeout(() => setShown(px), 400);
    return () => window.clearTimeout(id);
  }, [px]);
  useEffect(() => {
    const on = () => setPx(calc());
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height === "full" ? "full" : `${height.vh}-${height.min}-${height.max}`]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const b = binanceSymbol(symbol);
    const tvSymbol = b ? `BINANCE:${b.symbol}${b.perp ? ".P" : ""}` : `BINANCE:${symbol}`;
    el.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.minHeight = "300px";
    inner.style.width = "100%";
    el.appendChild(inner);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: false,
      width: "100%",
      height: shown,
      symbol: tvSymbol,
      interval: TV_INTERVAL[tf] ?? "60",
      theme: "dark",
      style: "1",
      locale: locale().startsWith("en") ? "en" : "es",
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      save_image: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
      backgroundColor: "#131722",
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol, tf, shown]);
  return <div ref={box} className="tradingview-widget-container w-full" style={{ height: shown, minHeight: 300 }} />;
}

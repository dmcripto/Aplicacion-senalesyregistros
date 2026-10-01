import { useEffect, useState } from "react";
import { LIQ_COINS, cx, fmtPrice, t } from "../lib";
import type { LiquidationMap as MapData } from "../lib";
import { fetchLiquidationMap } from "../tradesApi";

const ROW = 4; // alto de cada nivel de precio en el gráfico
const LEFT = 60; // espacio para los precios del eje
const WIDTH = 360;
const BAR = WIDTH - LEFT - 8;

const axis = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : fmtPrice(n));
const sign = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%";

export default function LiquidationMap() {
  const [coin, setCoin] = useState("BTC");
  const [map, setMap] = useState<MapData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setHover(null);
    fetchLiquidationMap(coin).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) {
        setMap(r.data);
        setStale(!!r.stale);
        setState("ok");
      } else {
        setError(r.error ?? t("No se pudo cargar el mapa."));
        setState("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [coin]);

  const rows = map ? [...map.buckets].reverse() : []; // el precio más alto arriba
  const height = rows.length * ROW;
  const priceRow = map ? rows.findIndex((b) => b.price <= map.price) : -1;
  const priceY = priceRow >= 0 ? priceRow * ROW : height / 2;
  const hovered = hover != null ? rows[hover] : null;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-display text-2xl font-bold tracking-wide text-snow">{t("MAPA DE LIQUIDACIONES")}</h2>
        <p className="text-[11px] uppercase tracking-[0.16em] text-dim">{t("Dónde se acumulan liquidaciones (estimado)")}</p>
      </header>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap gap-1.5">
          {LIQ_COINS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCoin(c)}
              className={cx(
                "num rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors",
                coin === c ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {state === "loading" && <p className="py-16 text-center text-[12px] text-fog">{t("Calculando…")}</p>}
        {state === "error" && <p className="rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2.5 text-[12px] text-bear">{error}</p>}

        {state === "ok" && map && (
          <>
            <div className="flex items-center justify-between text-[11px]">
              <span className="num font-bold text-snow">
                {map.coin}/USDT <span className="text-gold">{fmtPrice(map.price)}</span>
              </span>
              <span className="text-dim">
                {hovered
                  ? `${fmtPrice(hovered.price)} · ${hovered.longs > 0 ? t("largos") : hovered.shorts > 0 ? t("cortos") : "—"} ${Math.round(Math.max(hovered.longs, hovered.shorts))}/100`
                  : `${t("Datos de")} ${map.source === "binance" ? "Binance" : "Bybit"}`}
              </span>
            </div>

            <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label={t("Mapa de liquidaciones")} onMouseLeave={() => setHover(null)}>
              {rows.map((b, i) => {
                const long = b.longs > 0;
                const v = long ? b.longs : b.shorts;
                const y = i * ROW;
                return (
                  <g key={b.price} onMouseEnter={() => setHover(i)}>
                    <rect x={LEFT} y={y} width={BAR} height={ROW} fill="transparent" />
                    {v > 0 && <rect x={LEFT} y={y + 0.5} width={Math.max(1, (v / 100) * BAR)} height={ROW - 1} rx={1} fill={long ? "var(--color-bear)" : "var(--color-bull)"} opacity={hover === i ? 1 : 0.8} />}
                    {i % 12 === 6 && (
                      <text x={LEFT - 6} y={y + 4} textAnchor="end" fontSize="8" fill="var(--color-dim)" className="num">
                        {axis(b.price)}
                      </text>
                    )}
                  </g>
                );
              })}
              <line x1={LEFT} x2={WIDTH} y1={priceY} y2={priceY} stroke="var(--color-gold)" strokeWidth="1.2" strokeDasharray="4 3" />
              <text x={WIDTH - 4} y={priceY - 3} textAnchor="end" fontSize="8" fontWeight="700" fill="var(--color-gold)" className="num">
                {t("precio actual")}
              </text>
            </svg>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md border border-bull/30 bg-bulldeep/20 p-2.5">
                <p className="font-bold uppercase tracking-wider text-bull">{t("Cortos (arriba)")}</p>
                <p className="num mt-0.5 text-snow">{map.topShort ? `${fmtPrice(map.topShort.price)} (${sign(map.topShort.pct)})` : "—"}</p>
              </div>
              <div className="rounded-md border border-bear/30 bg-beardeep/20 p-2.5">
                <p className="font-bold uppercase tracking-wider text-bear">{t("Largos (abajo)")}</p>
                <p className="num mt-0.5 text-snow">{map.topLong ? `${fmtPrice(map.topLong.price)} (${sign(map.topLong.pct)})` : "—"}</p>
              </div>
            </div>
            {stale && <p className="text-[10.5px] text-gold">{t("El mercado no respondió: se muestra el último cálculo guardado.")}</p>}
          </>
        )}

        <p className="text-[10.5px] leading-relaxed text-dim">
          {t("Estimación propia de VELTRIX con datos públicos (precio e interés abierto). Muestra zonas donde probablemente haya liquidaciones pendientes, no cifras exactas: no es una señal de compra ni de venta.")}{" "}
          <a href={`https://coinmarketcap.com/charts/liquidation-map/?type=exact&coin=${coinSlug(coin)}`} target="_blank" rel="noopener noreferrer" className="text-cyan underline">
            {t("Comparar con CoinMarketCap")} ↗
          </a>
        </p>
      </div>
    </section>
  );
}

const SLUGS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "xrp", BNB: "bnb", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", LINK: "chainlink", SUI: "sui",
};
const coinSlug = (c: string) => SLUGS[c] ?? "bitcoin";

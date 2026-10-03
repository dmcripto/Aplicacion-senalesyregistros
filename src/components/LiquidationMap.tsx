import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { LEVERAGE_COLORS, LIQ_COINS, cumulativeLiquidations, cx, fmtPrice, fmtUsdShort, rebinLiquidations, t } from "../lib";
import type { LiquidationMap as MapData } from "../lib";
import { fetchLiquidationMap } from "../tradesApi";
import Panel from "./Panel";

const W = 720;
const H = 300;
const ML = 54; // espacio para el eje izquierdo (barras)
const MR = 54; // espacio para el eje derecho (acumulado)
const MT = 18;
const MB = 24;
const COLS = 70;
const PW = W - ML - MR;
const PH = H - MT - MB;

const SLUGS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "xrp", BNB: "bnb", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", LINK: "chainlink", SUI: "sui",
};
const axis = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : fmtPrice(n));
const sign = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%";

function LiquidationMapBody() {
  const [coin, setCoin] = useState("BTC");
  const [map, setMap] = useState<MapData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<[number, number] | null>(null); // zoom actual (null = todo el rango)
  const [drag, setDrag] = useState<[number, number] | null>(null); // selección en curso, en unidades del gráfico
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setRange(null);
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

  const full = useMemo<[number, number]>(() => {
    if (!map?.buckets.length) return [0, 1];
    return [map.buckets[0].price - map.step / 2, map.buckets[map.buckets.length - 1].price + map.step / 2];
  }, [map]);
  const [lo, hi] = range ?? full;

  const view = useMemo(() => {
    if (!map) return null;
    const cols = rebinLiquidations(map, lo, hi, COLS);
    const maxBar = Math.max(1, ...cols.map((c) => c.longTotal + c.shortTotal));
    const cum = cumulativeLiquidations(map);
    const longs = cum.longs.filter((p) => p.price >= lo && p.price <= hi);
    const shorts = cum.shorts.filter((p) => p.price >= lo && p.price <= hi);
    const maxCum = Math.max(1, ...longs.map((p) => p.usd), ...shorts.map((p) => p.usd));
    return { cols, maxBar, longs, shorts, maxCum };
  }, [map, lo, hi]);

  const x = (price: number) => ML + ((price - lo) / (hi - lo)) * PW;
  const priceAt = (px: number) => lo + ((px - ML) / PW) * (hi - lo);
  const yBar = (v: number) => MT + PH - (v / (view?.maxBar ?? 1)) * PH;
  const yCum = (v: number) => MT + PH - (v / (view?.maxCum ?? 1)) * PH;
  const colW = PW / COLS;
  const colOf = (price: number) => Math.min(COLS - 1, Math.max(0, Math.floor(((price - lo) / (hi - lo)) * COLS)));

  /** Posición del puntero en unidades del gráfico (el SVG se estira, por eso se convierte). */
  const local = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };
  const clampX = (px: number) => Math.min(W - MR, Math.max(ML, px));

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    const px = clampX(local(e));
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag([px, px]);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const px = clampX(local(e));
    if (drag) setDrag([drag[0], px]);
    else setHover(Math.min(COLS - 1, Math.max(0, Math.floor((px - ML) / colW))));
  };
  const onUp = () => {
    if (drag && Math.abs(drag[1] - drag[0]) > 12) {
      const a = priceAt(Math.min(drag[0], drag[1]));
      const b = priceAt(Math.max(drag[0], drag[1]));
      if (map && b - a > map.price * 0.004) setRange([a, b]); // no más cerca que 0,4 % del precio
    }
    setDrag(null);
  };

  const hotspotsShown = (map?.hotspots ?? []).filter((h) => h.price >= lo && h.price <= hi);
  const cur = hover != null ? view?.cols[hover] : null;
  const topShorts = (map?.hotspots ?? []).filter((h) => h.side === "short");
  const topLongs = (map?.hotspots ?? []).filter((h) => h.side === "long");
  const ticks = (max: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);

  return (
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

        {state === "loading" && <p className="py-20 text-center text-[12px] text-fog">{t("Calculando…")}</p>}
        {state === "error" && <p className="rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2.5 text-[12px] text-bear">{error}</p>}

        {state === "ok" && map && view && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="num font-bold text-snow">
                {map.coin}/USDT <span className="text-gold">{fmtPrice(map.price)}</span>
                <span className="ml-2 font-normal text-dim">
                  {t("Datos de")} {map.source === "binance" ? "Binance" : "Bybit"}
                </span>
              </span>
              <span className="num text-fog">
                {cur
                  ? `${axis(cur.from)}–${axis(cur.to)} · ${t("largos")} ${fmtUsdShort(cur.longTotal)} · ${t("cortos")} ${fmtUsdShort(cur.shortTotal)}`
                  : t("Arrastrá sobre el gráfico para ampliar una zona")}
              </span>
            </div>

            <div className="relative">
              {range && (
                <button type="button" onClick={() => setRange(null)} className="absolute left-14 top-1 z-10 rounded-md bg-gold px-3 py-1 text-[11px] font-bold text-ink shadow">
                  {t("Quitar zoom")}
                </button>
              )}
              <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                className="w-full cursor-crosshair select-none"
                style={{ touchAction: "pan-y" }}
                role="img"
                aria-label={t("Mapa de liquidaciones")}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={() => {
                  if (!drag) setHover(null);
                }}
              >
                {/* cuadrícula y ejes */}
                {ticks(view.maxBar).map((v, i) => (
                  <g key={i}>
                    <line x1={ML} x2={W - MR} y1={yBar(v)} y2={yBar(v)} stroke="var(--color-line)" strokeWidth="0.6" />
                    <text x={ML - 6} y={yBar(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-dim)" className="num">{fmtUsdShort(v)}</text>
                    {i > 0 && (
                      <text x={W - MR + 6} y={yBar(v) + 3} fontSize="9" fill="var(--color-dim)" className="num">{fmtUsdShort(view.maxCum * (v / view.maxBar))}</text>
                    )}
                  </g>
                ))}
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <text key={f} x={ML + f * PW} y={H - 8} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} fontSize="9" fill="var(--color-dim)" className="num">
                    {axis(lo + f * (hi - lo))}
                  </text>
                ))}

                {/* áreas y líneas acumuladas */}
                {view.longs.length > 1 && (
                  <>
                    <polygon fill="var(--color-bear)" opacity="0.10" points={`${x(view.longs[0].price)},${yCum(0)} ${view.longs.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} ${x(view.longs[view.longs.length - 1].price)},${yCum(0)}`} />
                    <polyline fill="none" stroke="var(--color-bear)" strokeWidth="1.6" points={view.longs.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} />
                  </>
                )}
                {view.shorts.length > 1 && (
                  <>
                    <polygon fill="var(--color-bull)" opacity="0.10" points={`${x(view.shorts[0].price)},${yCum(0)} ${view.shorts.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} ${x(view.shorts[view.shorts.length - 1].price)},${yCum(0)}`} />
                    <polyline fill="none" stroke="var(--color-bull)" strokeWidth="1.6" points={view.shorts.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} />
                  </>
                )}

                {/* barras apiladas por apalancamiento */}
                {view.cols.map((c, i) => {
                  let acc = 0;
                  return (
                    <g key={i}>
                      {map.leverages.map((_, k) => {
                        const v = c.longs[k] + c.shorts[k];
                        const y1 = yBar(acc + v);
                        const y0 = yBar(acc);
                        acc += v;
                        return v > 0 ? (
                          <rect key={k} x={ML + i * colW + 0.6} y={y1} width={Math.max(1, colW - 1.2)} height={Math.max(0, y0 - y1)} fill={LEVERAGE_COLORS[k]} opacity={hover === i ? 1 : 0.88} />
                        ) : null;
                      })}
                    </g>
                  );
                })}

                {/* puntos calientes */}
                {hotspotsShown.map((h, i) => {
                  const c = view.cols[colOf(h.price)];
                  return (
                    <text key={i} x={x(h.price)} y={Math.max(MT + 8, yBar(c.longTotal + c.shortTotal) - 3)} textAnchor="middle" fontSize="10" fill="var(--color-gold)">▾</text>
                  );
                })}

                {/* precio actual */}
                {map.price >= lo && map.price <= hi && (
                  <g>
                    <line x1={x(map.price)} x2={x(map.price)} y1={MT} y2={MT + PH} stroke="var(--color-fog)" strokeWidth="1" strokeDasharray="4 3" />
                    <rect x={x(map.price) - 44} y={0} width={88} height={14} rx={7} fill="var(--color-snow)" />
                    <text x={x(map.price)} y={10} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--color-ink)" className="num">{map.coin} ${axis(map.price)}</text>
                  </g>
                )}

                {/* selección para ampliar */}
                {drag && <rect x={Math.min(drag[0], drag[1])} y={MT} width={Math.abs(drag[1] - drag[0])} height={PH} fill="var(--color-gold)" opacity="0.18" stroke="var(--color-gold)" strokeWidth="0.8" />}
              </svg>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-fog">
              {map.leverages.map((lv, k) => (
                <span key={lv} className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: LEVERAGE_COLORS[k] }} /> {lv}x
                </span>
              ))}
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-bear" /> {t("Largos acumulados")}</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-bull" /> {t("Cortos acumulados")}</span>
            </div>

            <div className="grid gap-2 text-[11px] sm:grid-cols-2">
              <div className="rounded-md border border-bull/30 bg-bulldeep/20 p-2.5">
                <p className="font-bold uppercase tracking-wider text-bull">{t("Puntos calientes de cortos (arriba)")}</p>
                {topShorts.length ? (
                  topShorts.map((h) => (
                    <p key={h.price} className="num mt-0.5 text-snow">{axis(h.price)} <span className="text-dim">({sign(h.pct)})</span> · ≈{fmtUsdShort(h.usd)}</p>
                  ))
                ) : (
                  <p className="mt-0.5 text-dim">—</p>
                )}
              </div>
              <div className="rounded-md border border-bear/30 bg-beardeep/20 p-2.5">
                <p className="font-bold uppercase tracking-wider text-bear">{t("Puntos calientes de largos (abajo)")}</p>
                {topLongs.length ? (
                  topLongs.map((h) => (
                    <p key={h.price} className="num mt-0.5 text-snow">{axis(h.price)} <span className="text-dim">({sign(h.pct)})</span> · ≈{fmtUsdShort(h.usd)}</p>
                  ))
                ) : (
                  <p className="mt-0.5 text-dim">—</p>
                )}
              </div>
            </div>
            {stale && <p className="text-[10.5px] text-gold">{t("El mercado no respondió: se muestra el último cálculo guardado.")}</p>}
          </>
        )}

        <p className="text-[10.5px] leading-relaxed text-dim">
          {t("Estimación propia de VELTRIX con datos públicos (precio e interés abierto). Muestra zonas donde probablemente haya liquidaciones pendientes, con montos aproximados: no son cifras exactas ni una señal de compra o venta.")}{" "}
          <a href={`https://coinmarketcap.com/charts/liquidation-map/?type=exact&coin=${SLUGS[coin] ?? "bitcoin"}`} target="_blank" rel="noopener noreferrer" className="text-cyan underline">
            {t("Comparar con CoinMarketCap")} ↗
          </a>
        </p>
    </div>
  );
}

export default function LiquidationMap() {
  return (
    <Panel
      id="liqmap"
      title={t("MAPA DE LIQUIDACIONES")}
      subtitle={t("Dónde se acumulan liquidaciones (estimado)")}
      summary={t("BTC, ETH, SOL y más · tocá para ver las zonas")}
      defaultOpen={false}
    >
      <LiquidationMapBody />
    </Panel>
  );
}

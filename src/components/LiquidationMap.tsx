import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { LEVERAGE_COLORS, LIQ_COINS, cumulativeLiquidations, cx, fmtPrice, fmtUsdShort, liquidationSummary, rebinLiquidations, t } from "../lib";
import type { LiquidationHotspot, LiquidationMap as MapData } from "../lib";
import { fetchLiquidationCoins, fetchLiquidationMap } from "../tradesApi";
import Panel from "./Panel";

const COLS = 70;
const MT = 22;
const MB = 24;

const SLUGS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "xrp", BNB: "bnb", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", LINK: "chainlink", SUI: "sui",
};
const axis = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : fmtPrice(n));
const sign = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%";

/** Lo que se resalta al pasar el mouse (o tocar) la leyenda: un apalancamiento, o los largos o cortos acumulados. */
type Highlight = number | "longs" | "shorts" | null;

function LiquidationMapBody() {
  const [coin, setCoin] = useState("BTC");
  const [query, setQuery] = useState("");
  const [allCoins, setAllCoins] = useState<string[]>(LIQ_COINS);
  const [map, setMap] = useState<MapData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<[number, number] | null>(null); // zoom actual (null = todo el rango)
  const [drag, setDrag] = useState<[number, number] | null>(null); // selección en curso, en píxeles del gráfico
  const [hover, setHover] = useState<number | null>(null);
  const [hl, setHl] = useState<Highlight>(null);
  const [width, setWidth] = useState(720);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    void fetchLiquidationCoins().then(setAllCoins);
  }, []);

  // El gráfico toma el ancho disponible y un alto que entra en la pantalla (sin tener que bajar el zoom del navegador).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.min(1200, Math.round(el.clientWidth))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);
  const narrow = width < 520;
  const W = width;
  const ML = narrow ? 40 : 56; // espacio para el eje izquierdo (barras)
  const MR = narrow ? 40 : 56; // espacio para el eje derecho (acumulado)
  const maxH = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.56) : 420;
  const H = Math.round(Math.max(230, Math.min(width * (narrow ? 0.85 : 0.46), Math.max(250, maxH))));
  const PW = W - ML - MR;
  const PH = H - MT - MB;

  const q = query.trim().toUpperCase();
  const matches = useMemo(
    () => (q ? [...allCoins.filter((c) => c.startsWith(q)), ...allCoins.filter((c) => !c.startsWith(q) && c.includes(q))].slice(0, 8) : []),
    [q, allCoins],
  );
  const pick = (c: string) => {
    setCoin(c);
    setQuery("");
  };
  const chips = LIQ_COINS.includes(coin) ? LIQ_COINS : [coin, ...LIQ_COINS];

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setRange(null);
    setHover(null);
    setHl(null);
    fetchLiquidationMap(coin).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) {
        setMap(r.data);
        setStale(!!r.stale);
        setState("ok");
      } else {
        setError(r.error ? t(r.error) : t("No se pudo cargar el mapa."));
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
  const summary = useMemo(() => (map ? liquidationSummary(map) : null), [map]);

  const x = (price: number) => ML + ((price - lo) / (hi - lo)) * PW;
  const priceAt = (px: number) => lo + ((px - ML) / PW) * (hi - lo);
  const yBar = (v: number) => MT + PH - (v / (view?.maxBar ?? 1)) * PH;
  const yCum = (v: number) => MT + PH - (v / (view?.maxCum ?? 1)) * PH;
  const colW = PW / COLS;
  const colOf = (price: number) => Math.min(COLS - 1, Math.max(0, Math.floor(((price - lo) / (hi - lo)) * COLS)));

  /** Posición del puntero en píxeles del gráfico (el SVG mide lo mismo que su caja, pero por las dudas se convierte). */
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

  // Las 3 zonas más fuertes de cada lado, numeradas por tamaño: son las que importan.
  const rank = (side: "long" | "short") => (map?.hotspots ?? []).filter((h) => h.side === side).sort((a, b) => b.usd - a.usd).slice(0, 3);
  const topShorts = rank("short");
  const topLongs = rank("long");
  const zones = [...topShorts.map((h, i) => ({ h, n: i + 1 })), ...topLongs.map((h, i) => ({ h, n: i + 1 }))].filter((z) => z.h.price >= lo && z.h.price <= hi);
  const cur = hover != null ? view?.cols[hover] : null;
  const ticks = (max: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const dimLongs = hl === "shorts" || typeof hl === "number";
  const dimShorts = hl === "longs" || typeof hl === "number";

  const zoneCard = (label: string, h: LiquidationHotspot | null, tone: "bull" | "bear") => (
    <div className={cx("rounded-lg border p-3", tone === "bull" ? "border-bull/35 bg-bulldeep/25" : "border-bear/35 bg-beardeep/25")}>
      <p className={cx("text-[10px] font-bold uppercase tracking-[0.14em]", tone === "bull" ? "text-bull" : "text-bear")}>{label}</p>
      {h ? (
        <>
          <p className="num mt-1 text-[22px] font-bold leading-none text-snow">${axis(h.price)}</p>
          <p className="num mt-1 text-[12px] text-fog">
            <span className={tone === "bull" ? "text-bull" : "text-bear"}>{sign(h.pct)}</span> {t("del precio")} · ≈{fmtUsdShort(h.usd)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[12px] text-dim">—</p>
      )}
    </div>
  );

  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !q) return;
            if (matches.includes(q)) pick(q);
            else if (matches[0]) pick(matches[0]);
            else if (/^[A-Z0-9]{1,15}$/.test(q)) pick(q);
          }}
          placeholder={t("Buscar activo (ej: PEPE, LTC, ARB)")}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="field num text-[12px] uppercase"
          aria-label={t("Buscar activo")}
        />
        {matches.length > 0 && (
          <ul className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-md border border-line2 bg-panel2 shadow-xl">
            {matches.map((c) => (
              <li key={c}>
                <button type="button" onClick={() => pick(c)} className="num flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-bold text-snow hover:bg-raise">
                  {c}
                  <span className="text-[10px] font-normal text-dim">{c}/USDT</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCoin(c)}
            className={cx("num rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors", coin === c ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow")}
          >
            {c}
          </button>
        ))}
      </div>

      {state === "loading" && <p className="py-20 text-center text-[12px] text-fog">{t("Calculando…")}</p>}
      {state === "error" && <p className="rounded-md border border-bear/30 bg-beardeep/30 px-3 py-2.5 text-[12px] text-bear">{error}</p>}

      {state === "ok" && map && view && summary && (
        <>
          {/* Lo importante a simple vista: zona más fuerte de arriba, precio y balance, y zona más fuerte de abajo. */}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
            {zoneCard(t("Zona más fuerte ARRIBA"), summary.topAbove, "bull")}
            <div className="rounded-lg border border-line bg-ink/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-dim">
                {map.coin}/USDT · {t("Datos de")} {map.source === "binance" ? "Binance" : "Bybit"}
              </p>
              <p className="num mt-1 text-[22px] font-bold leading-none text-gold">${axis(map.price)}</p>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={t("Arriba vs abajo")}>
                <div className="bg-bull" style={{ width: `${summary.abovePct}%` }} />
                <div className="bg-bear" style={{ width: `${100 - summary.abovePct}%` }} />
              </div>
              <p className="num mt-1 flex justify-between text-[10.5px] text-fog">
                <span className="text-bull">{t("Arriba")} {fmtUsdShort(summary.aboveUsd)}</span>
                <span className="text-bear">{fmtUsdShort(summary.belowUsd)} {t("Abajo")}</span>
              </p>
            </div>
            {zoneCard(t("Zona más fuerte ABAJO"), summary.topBelow, "bear")}
          </div>
          <p className="rounded-md border border-line bg-ink/30 px-3 py-2 text-[12px] leading-snug text-fog">
            <b className="text-snow">{t("Lectura rápida")}:</b>{" "}
            {summary.heavier === "even"
              ? t("Las liquidaciones pendientes están parejas arriba ({a}) y abajo ({b}).", { a: fmtUsdShort(summary.aboveUsd), b: fmtUsdShort(summary.belowUsd) })
              : summary.heavier === "above"
                ? t("Hay más liquidaciones pendientes por encima del precio ({a}) que por debajo ({b}): las zonas de arriba concentran más dinero.", { a: fmtUsdShort(summary.aboveUsd), b: fmtUsdShort(summary.belowUsd) })
                : t("Hay más liquidaciones pendientes por debajo del precio ({b}) que por encima ({a}): las zonas de abajo concentran más dinero.", { a: fmtUsdShort(summary.aboveUsd), b: fmtUsdShort(summary.belowUsd) })}
            {summary.magnet && (
              <>
                {" "}
                {t("La zona más grande de todas está en ${p} ({d}).", { p: axis(summary.magnet.price), d: sign(summary.magnet.pct) })}
              </>
            )}
          </p>

          <div ref={wrapRef} className="relative">
            {range && (
              <button type="button" onClick={() => setRange(null)} className="absolute left-12 top-1 z-10 rounded-md bg-gold px-3 py-1 text-[11px] font-bold text-ink shadow">
                {t("Quitar zoom")}
              </button>
            )}
            <svg
              ref={svgRef}
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className="block w-full max-w-full cursor-crosshair select-none"
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
                  {i > 0 && <text x={W - MR + 6} y={yBar(v) + 3} fontSize="9" fill="var(--color-dim)" className="num">{fmtUsdShort(view.maxCum * (v / view.maxBar))}</text>}
                </g>
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <text key={f} x={ML + f * PW} y={H - 8} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} fontSize="9" fill="var(--color-dim)" className="num">
                  {axis(lo + f * (hi - lo))}
                </text>
              ))}

              {/* zonas más fuertes: franjas doradas numeradas (1 = la más grande de ese lado) */}
              {zones.map(({ h, n }) => (
                <g key={`${h.side}${n}`} opacity={hl === null ? 1 : 0.35}>
                  <rect x={x(h.price) - Math.max(colW, 6) / 2} y={MT} width={Math.max(colW, 6)} height={PH} fill="var(--color-gold)" opacity={n === 1 ? 0.2 : 0.1} />
                  {n === 1 && <line x1={x(h.price)} x2={x(h.price)} y1={MT} y2={MT + PH} stroke="var(--color-gold)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />}
                </g>
              ))}

              {/* áreas y líneas acumuladas */}
              {view.longs.length > 1 && (
                <g opacity={dimLongs ? 0.25 : 1}>
                  <polygon fill="var(--color-bear)" opacity={hl === "longs" ? 0.24 : 0.1} points={`${x(view.longs[0].price)},${yCum(0)} ${view.longs.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} ${x(view.longs[view.longs.length - 1].price)},${yCum(0)}`} />
                  <polyline fill="none" stroke="var(--color-bear)" strokeWidth={hl === "longs" ? 2.6 : 1.6} points={view.longs.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} />
                </g>
              )}
              {view.shorts.length > 1 && (
                <g opacity={dimShorts ? 0.25 : 1}>
                  <polygon fill="var(--color-bull)" opacity={hl === "shorts" ? 0.24 : 0.1} points={`${x(view.shorts[0].price)},${yCum(0)} ${view.shorts.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} ${x(view.shorts[view.shorts.length - 1].price)},${yCum(0)}`} />
                  <polyline fill="none" stroke="var(--color-bull)" strokeWidth={hl === "shorts" ? 2.6 : 1.6} points={view.shorts.map((p) => `${x(p.price)},${yCum(p.usd)}`).join(" ")} />
                </g>
              )}

              {/* barras apiladas por apalancamiento: al elegir un apalancamiento en la leyenda, los demás se atenúan */}
              {view.cols.map((c, i) => {
                let acc = 0;
                return (
                  <g key={i}>
                    {map.leverages.map((_, k) => {
                      const v = c.longs[k] + c.shorts[k];
                      const y1 = yBar(acc + v);
                      const y0 = yBar(acc);
                      acc += v;
                      const on = typeof hl === "number" ? hl === k : hl === "longs" || hl === "shorts" ? 0.35 : 1;
                      return v > 0 ? (
                        <rect key={k} x={ML + i * colW + 0.6} y={y1} width={Math.max(1, colW - 1.2)} height={Math.max(0, y0 - y1)} fill={LEVERAGE_COLORS[k]} opacity={typeof hl === "number" ? (on ? 1 : 0.08) : hover === i ? 1 : 0.88 * (typeof on === "number" ? on : 1)} />
                      ) : null;
                    })}
                  </g>
                );
              })}

              {/* números de las zonas y la etiqueta de la principal de cada lado */}
              {zones.map(({ h, n }) => {
                const c = view.cols[colOf(h.price)];
                const top = Math.max(MT + 10, yBar(c.longTotal + c.shortTotal) - 4);
                const label = `$${axis(h.price)} · ≈${fmtUsdShort(h.usd)}`;
                const w = label.length * 5.6 + 12;
                const lx = Math.min(W - MR - w / 2, Math.max(ML + w / 2, x(h.price)));
                return (
                  <g key={`l${h.side}${n}`} opacity={hl === null ? 1 : 0.35} style={{ pointerEvents: "none" }}>
                    <circle cx={x(h.price)} cy={top - 4} r={7} fill="var(--color-gold)" />
                    <text x={x(h.price)} y={top - 0.5} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="var(--color-ink)">{n}</text>
                    {n === 1 && !narrow && (
                      <>
                        <rect x={lx - w / 2} y={Math.max(MT - 2, top - 26)} width={w} height={15} rx={4} fill="var(--color-ink)" stroke="var(--color-gold)" strokeWidth="0.8" />
                        <text x={lx} y={Math.max(MT - 2, top - 26) + 10.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--color-gold)" className="num">{label}</text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* precio actual */}
              {map.price >= lo && map.price <= hi && (
                <g>
                  <line x1={x(map.price)} x2={x(map.price)} y1={MT} y2={MT + PH} stroke="var(--color-fog)" strokeWidth="1" strokeDasharray="4 3" />
                  <rect x={x(map.price) - 46} y={0} width={92} height={15} rx={7} fill="var(--color-snow)" />
                  <text x={x(map.price)} y={10.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--color-ink)" className="num">{map.coin} ${axis(map.price)}</text>
                </g>
              )}

              {/* selección para ampliar */}
              {drag && <rect x={Math.min(drag[0], drag[1])} y={MT} width={Math.abs(drag[1] - drag[0])} height={PH} fill="var(--color-gold)" opacity="0.18" stroke="var(--color-gold)" strokeWidth="0.8" />}
            </svg>

            {/* detalle de la columna bajo el mouse */}
            {cur && !drag && (
              <div
                className="pointer-events-none absolute z-10 w-[190px] rounded-lg border border-line2 bg-panel2/95 p-2.5 text-[11px] shadow-xl"
                style={{ left: Math.min(Math.max(x(cur.price) - 95, 4), W - 194), top: MT + 4 }}
              >
                <p className="num font-bold text-snow">${axis(cur.from)} – ${axis(cur.to)}</p>
                <p className="num mt-0.5 text-fog">
                  <span className="text-bear">{t("largos")} {fmtUsdShort(cur.longTotal)}</span> · <span className="text-bull">{t("cortos")} {fmtUsdShort(cur.shortTotal)}</span>
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {map.leverages.map((lv, k) => {
                    const v = cur.longs[k] + cur.shorts[k];
                    return v > 0 ? (
                      <p key={lv} className="num flex items-center justify-between text-[10.5px] text-fog">
                        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: LEVERAGE_COLORS[k] }} /> {lv}x</span>
                        <span className="text-snow">{fmtUsdShort(v)}</span>
                      </p>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>

          {/* leyenda interactiva: al pasar el mouse (o tocar) se resalta en el gráfico */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-fog" onPointerLeave={() => setHl(null)}>
            {map.leverages.map((lv, k) => (
              <button
                key={lv}
                type="button"
                onPointerEnter={() => setHl(k)}
                onFocus={() => setHl(k)}
                onBlur={() => setHl(null)}
                onClick={() => setHl((h) => (h === k ? null : k))}
                aria-pressed={hl === k}
                className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors", hl === k ? "border-gold bg-gold/10 text-snow" : "border-line hover:border-line2 hover:text-snow")}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LEVERAGE_COLORS[k] }} /> {lv}x
              </button>
            ))}
            {(["longs", "shorts"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onPointerEnter={() => setHl(side)}
                onFocus={() => setHl(side)}
                onBlur={() => setHl(null)}
                onClick={() => setHl((h) => (h === side ? null : side))}
                aria-pressed={hl === side}
                className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors", hl === side ? "border-gold bg-gold/10 text-snow" : "border-line hover:border-line2 hover:text-snow")}
              >
                <span className={cx("inline-block h-0.5 w-3", side === "longs" ? "bg-bear" : "bg-bull")} /> {side === "longs" ? t("Largos acumulados") : t("Cortos acumulados")}
              </button>
            ))}
            <span className="inline-flex items-center gap-1 px-1 text-dim">
              <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-gold text-[8px] font-extrabold text-ink">1</span> {t("zonas más fuertes")}
            </span>
          </div>
          <p className="text-[10.5px] text-dim">{t("Pasá el mouse (o tocá) un apalancamiento para resaltarlo en el gráfico. Arrastrá sobre el gráfico para ampliar una zona.")}</p>

          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            <div className="rounded-md border border-bull/30 bg-bulldeep/20 p-2.5">
              <p className="font-bold uppercase tracking-wider text-bull">{t("Puntos calientes de cortos (arriba)")}</p>
              {topShorts.length ? (
                topShorts.map((h, i) => (
                  <p key={h.price} className="num mt-0.5 text-snow">
                    <span className="mr-1 inline-grid h-3.5 w-3.5 place-items-center rounded-full bg-gold text-[8px] font-extrabold text-ink">{i + 1}</span>
                    {axis(h.price)} <span className="text-dim">({sign(h.pct)})</span> · ≈{fmtUsdShort(h.usd)}
                  </p>
                ))
              ) : (
                <p className="mt-0.5 text-dim">—</p>
              )}
            </div>
            <div className="rounded-md border border-bear/30 bg-beardeep/20 p-2.5">
              <p className="font-bold uppercase tracking-wider text-bear">{t("Puntos calientes de largos (abajo)")}</p>
              {topLongs.length ? (
                topLongs.map((h, i) => (
                  <p key={h.price} className="num mt-0.5 text-snow">
                    <span className="mr-1 inline-grid h-3.5 w-3.5 place-items-center rounded-full bg-gold text-[8px] font-extrabold text-ink">{i + 1}</span>
                    {axis(h.price)} <span className="text-dim">({sign(h.pct)})</span> · ≈{fmtUsdShort(h.usd)}
                  </p>
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
        <a href={`https://coinmarketcap.com/charts/liquidation-map/?type=exact&coin=${SLUGS[coin] ?? coin.toLowerCase()}`} target="_blank" rel="noopener noreferrer" className="text-cyan underline">
          {t("Comparar con CoinMarketCap")} ↗
        </a>
      </p>
    </div>
  );
}

export default function LiquidationMap() {
  return (
    <Panel id="liqmap" title={t("MAPA DE LIQUIDACIONES")} subtitle={t("Dónde se acumulan liquidaciones (estimado)")} summary={t("BTC, ETH, SOL y más · tocá para ver las zonas")} defaultOpen={false}>
      <LiquidationMapBody />
    </Panel>
  );
}

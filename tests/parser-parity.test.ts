import { describe, expect, it } from "vitest";
import { parseAlerts as web } from "../packages/core/src/trading";
import { parseAlerts as server } from "../supabase/functions/_shared/parseAlert";

// El intérprete de la app y el del servidor (webhook) son copias: si divergen, una misma señal se leería distinto.
const corpus = [
  "VELTRIX|BTCUSDT|COMPRA|65405.8|66694.4|65161.1",
  "BTCUSDT|VENTA|100|95|105",
  '{"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":66500,"sl":64500}',
  "symbol=ETHUSDT side=sell entry=3000 tp=2900 sl=3050",
  "#BTC/USDT LONG\nEntry: 65000\nTP: 66500\nSL: 64500",
  "BTCUSDT LONG Entry: 65,000.5 TP1: 66,500 SL: 64,500",
  "ETH SHORT Entrada: 3.020,5 Objetivo 1: 2.900 Stop: 3.100",
  "BTC LONG entry 65000 tp 64000 sl 66000",
  "hola",
  "$SOL.P long entry 150 tp 158 sl 146",
  "XRP/USDT SHORT\nEntry zone: 0.5200-0.5250\nTP: 0.50\nSL: 0.53",
  "symbol: XRPUSDT dirección: venta entrada 0.52 tp 0.50 sl 0.53",
  "BTCUSDT|COMPRA|100|110|95\nETHUSDT|VENTA|50|45|53",
  "Señal: SOL/USDT compra en 150, objetivo 158, stop loss 146",
  "VELTRIX|BTCUSDT|COMPRA|65000|66000/67000/68000|64500",
  '{"symbol":"BTCUSDT","side":"buy","entry":65000,"tp":[66000,67000,68000],"sl":64500}',
  "symbol=BTCUSDT side=buy entry=65000 tp1=66000 tp2=67000 tp3=68000 sl=64500",
  "HYPE/USDT LONG\nEntry: 40.5\nTP1: 41.5\nTP2: 42.5\nTP3: 44\nSL: 39.5",
  "BTCUSDT SHORT entrada 65000 targets: 64000, 63000, 62000 sl 66000",
];
const view = (r: { valid: any[] }) => r.valid.map((v) => [v.symbol, v.direction, v.entry, v.tp, v.sl, v.targets]);

describe("intérprete web = intérprete del servidor", () => {
  for (const c of corpus) {
    it(JSON.stringify(c).slice(0, 60), () => {
      const a = web(c), b = server(c);
      expect(view(b)).toEqual(view(a));
      expect(b.errors.length > 0).toBe(a.errors.length > 0);
    });
  }
});

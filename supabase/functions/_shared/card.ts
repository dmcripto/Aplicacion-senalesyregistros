// ─── VELTRIX · Imagen tarjeta de cada señal y de cada resultado ─────────────
// Se dibuja como SVG (sin datos personales ni dinero) y se convierte a PNG con resvg (WebAssembly) dentro de la
// misma función. Si algo falla (sin red para bajar la tipografía, memoria, etc.) devuelve null y el aviso sale como texto.

import { esc } from "./telegram.ts";
import type { Lang } from "./telegram.ts";
import { prettyPair } from "./community.ts";
import type { CommunityTrade } from "./community.ts";

const CARD_SITE = "https://veltrix-trading.vercel.app";
const CARD_W = 1080;
const CARD_H = 1080;

const CARD_C = {
  bg: "#0a0e14",
  panel: "#ffffff0a",
  line: "#ffffff17",
  text: "#e8eef6",
  muted: "#8fa3b8",
  cyan: "#2ec4f1",
  bull: "#16d98a",
  bear: "#ff4d67",
};

const cardPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
const cardR = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;
/** Tamaño de letra que entra en `width` px sin cortarse (promedio de ancho por letra en negrita ≈ 0,68 em). */
const cardFit = (text: string, max: number, width: number) => Math.max(40, Math.min(max, Math.floor(width / (Math.max(1, text.length) * 0.68))));

const CARD_T = {
  es: {
    brand: "SEÑAL DE TRADING",
    signal: "NUEVA SEÑAL",
    result: "RESULTADO",
    target: "TARGET",
    entry: "ENTRADA",
    stop: "STOP LOSS",
    rr: "RIESGO / BENEFICIO",
    long: "COMPRA · LONG",
    short: "VENTA · SHORT",
    tp: "TP ALCANZADO",
    sl: "SL ALCANZADO",
    disclaimer: "Información para registro personal · No es asesoramiento financiero",
    res: "Resultado",
  },
  en: {
    brand: "TRADING SIGNAL",
    signal: "NEW SIGNAL",
    result: "RESULT",
    target: "TARGET",
    entry: "ENTRY",
    stop: "STOP LOSS",
    rr: "RISK / REWARD",
    long: "BUY · LONG",
    short: "SELL · SHORT",
    tp: "TP HIT",
    sl: "SL HIT",
    disclaimer: "For personal record-keeping · Not financial advice",
    res: "Result",
  },
};

/** Fondo, luces, logo, encabezado y pie: lo que comparten las dos tarjetas. */
function cardFrame(lang: Lang, pill: string, logo: string | null, body: string): string {
  const t = CARD_T[lang];
  const pillW = pill.length * 15 + 56;
  const logoSvg = logo
    ? `<clipPath id="lc"><circle cx="112" cy="116" r="54"/></clipPath>
       <image xlink:href="${logo}" x="58" y="62" width="108" height="108" clip-path="url(#lc)"/>
       <circle cx="112" cy="116" r="54" fill="none" stroke="#ffffff30" stroke-width="2"/>`
    : `<circle cx="112" cy="116" r="54" fill="#0d3a52" stroke="${CARD_C.cyan}" stroke-width="3"/>
       <path d="M86 112l20 22 32-44" fill="none" stroke="${CARD_C.cyan}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="Inter">
  <defs>
    <radialGradient id="g1" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(120 60) scale(560)"><stop offset="0" stop-color="${CARD_C.bull}" stop-opacity="0.22"/><stop offset="1" stop-color="${CARD_C.bull}" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(980 40) scale(560)"><stop offset="0" stop-color="${CARD_C.cyan}" stop-opacity="0.24"/><stop offset="1" stop-color="${CARD_C.cyan}" stop-opacity="0"/></radialGradient>
    <radialGradient id="g3" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(540 1120) scale(620)"><stop offset="0" stop-color="#3b5bdb" stop-opacity="0.2"/><stop offset="1" stop-color="#3b5bdb" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M54 0H0V54" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/></pattern>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="${CARD_C.bg}"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#grid)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#g1)"/><rect width="${CARD_W}" height="${CARD_H}" fill="url(#g2)"/><rect width="${CARD_W}" height="${CARD_H}" fill="url(#g3)"/>
  ${logoSvg}
  <text x="190" y="118" font-size="46" font-weight="700" letter-spacing="7" fill="#ffffff">VELTRIX</text>
  <text x="192" y="152" font-size="19" font-weight="700" letter-spacing="4" fill="${CARD_C.cyan}">${esc(t.brand)}</text>
  <rect x="${CARD_W - 60 - pillW}" y="88" width="${pillW}" height="56" rx="28" fill="${CARD_C.cyan}" fill-opacity="0.12" stroke="${CARD_C.cyan}" stroke-opacity="0.7" stroke-width="2"/>
  <text x="${CARD_W - 60 - pillW / 2}" y="125" font-size="22" font-weight="700" letter-spacing="3" text-anchor="middle" fill="${CARD_C.cyan}">${esc(pill)}</text>
  ${body}
  <text x="${CARD_W / 2}" y="1030" font-size="20" text-anchor="middle" fill="${CARD_C.muted}">${esc(t.disclaimer)}</text>
  <text x="${CARD_W / 2}" y="1062" font-size="22" font-weight="700" letter-spacing="1" text-anchor="middle" fill="${CARD_C.cyan}">${esc(CARD_SITE.replace("https://", ""))}</text>
</svg>`;
}

/** Una fila de nivel: barra de color, nombre, precio y distancia en %. */
function cardLevel(y: number, color: string, label: string, value: string, right: string): string {
  return `<rect x="60" y="${y}" width="960" height="112" rx="22" fill="${CARD_C.panel}" stroke="${CARD_C.line}" stroke-width="2"/>
  <rect x="60" y="${y}" width="12" height="112" rx="6" fill="${color}"/>
  <text x="104" y="${y + 37}" font-size="21" font-weight="700" letter-spacing="4" fill="${color}">${esc(label)}</text>
  <text x="104" y="${y + 95}" font-size="${cardFit(value, 54, 560)}" font-weight="700" fill="#ffffff">${esc(value)}</text>
  <text x="990" y="${y + 80}" font-size="46" font-weight="700" text-anchor="end" fill="${color}">${esc(right)}</text>`;
}

export function signalCardSvg(t: CommunityTrade, lang: Lang, logo: string | null = null): string {
  const tx = CARD_T[lang];
  const long = t.direction === "LONG";
  const dir = long ? 1 : -1;
  const risk = Math.abs(t.entry - t.sl);
  const rr = risk > 0 ? Math.abs(t.tp - t.entry) / risk : 0;
  const tpPct = t.entry ? ((dir * (t.tp - t.entry)) / t.entry) * 100 : 0;
  const slPct = t.entry ? ((dir * (t.sl - t.entry)) / t.entry) * 100 : 0;
  const pair = prettyPair(t.symbol);
  const col = long ? CARD_C.bull : CARD_C.bear;
  const label = long ? tx.long : tx.short;
  const rows = [
    { y: 0, svg: (y: number) => cardLevel(y, CARD_C.bull, tx.target, String(t.tp), cardPct(tpPct)) },
    { y: 0, svg: (y: number) => cardLevel(y, CARD_C.cyan, tx.entry, String(t.entry), "") },
    { y: 0, svg: (y: number) => cardLevel(y, CARD_C.bear, tx.stop, String(t.sl), cardPct(slPct)) },
  ];
  // De arriba hacia abajo en orden de precio: en una compra el TP queda arriba; en una venta, el stop.
  const ordered = long ? rows : [rows[2], rows[1], rows[0]];
  const tops = [470, 604, 738];
  const body = `
  <text x="60" y="${290}" font-size="${cardFit(pair, 128, 960)}" font-weight="700" fill="#ffffff">${esc(pair)}</text>
  <rect x="60" y="318" width="${label.length * 20 + 110}" height="74" rx="37" fill="${col}" fill-opacity="0.14" stroke="${col}" stroke-width="3"/>
  <path d="${long ? "M96 372 L114 340 L132 372 Z" : "M96 340 L114 372 L132 340 Z"}" fill="${col}"/>
  <text x="152" y="368" font-size="30" font-weight="700" letter-spacing="2" fill="${col}">${esc(label)}</text>
  ${ordered.map((r, i) => r.svg(tops[i])).join("\n  ")}
  <rect x="60" y="886" width="960" height="104" rx="22" fill="${CARD_C.cyan}" fill-opacity="0.1" stroke="${CARD_C.cyan}" stroke-opacity="0.6" stroke-width="2"/>
  <text x="104" y="948" font-size="23" font-weight="700" letter-spacing="3" fill="${CARD_C.muted}">${esc(tx.rr)}</text>
  <text x="990" y="954" font-size="60" font-weight="700" text-anchor="end" fill="${CARD_C.cyan}">1 : ${rr.toFixed(1)}</text>`;
  return cardFrame(lang, tx.signal, logo, body);
}

export function resultCardSvg(symbol: string, outcome: "TP" | "SL", r: number, lang: Lang, opts: { label?: string } = {}, logo: string | null = null): string {
  const tx = CARD_T[lang];
  const ok = outcome === "TP";
  const col = ok ? CARD_C.bull : CARD_C.bear;
  const pair = prettyPair(symbol);
  const title = ok ? tx.tp : tx.sl;
  const rr = cardR(r);
  const body = `
  <circle cx="540" cy="360" r="118" fill="${col}" fill-opacity="0.14" stroke="${col}" stroke-width="5"/>
  <path d="${ok ? "M488 362 L526 400 L596 322" : "M498 318 L582 402 M582 318 L498 402"}" fill="none" stroke="${col}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="540" y="580" font-size="${cardFit(title, 96, 940)}" font-weight="700" text-anchor="middle" fill="${col}">${esc(title)}</text>
  <text x="540" y="672" font-size="${cardFit(pair, 70, 940)}" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(pair)}</text>
  <text x="540" y="900" font-size="${cardFit(rr, 250, 900)}" font-weight="700" text-anchor="middle" fill="${col}">${esc(rr)}</text>
  <text x="540" y="968" font-size="30" font-weight="700" letter-spacing="5" text-anchor="middle" fill="${CARD_C.muted}">${esc((opts.label ?? tx.res).toUpperCase())}</text>`;
  return cardFrame(lang, tx.result, logo, body);
}

// ─── De SVG a PNG ───────────────────────────────────────────────────────────

const CARD_RESVG = "2.6.2";
const CARD_FONT = "0.4.2";
const CARD_URLS = {
  wasm: [`https://unpkg.com/@resvg/resvg-wasm@${CARD_RESVG}/index_bg.wasm`, `https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@${CARD_RESVG}/index_bg.wasm`],
  bold: [
    `https://unpkg.com/@expo-google-fonts/inter@${CARD_FONT}/700Bold/Inter_700Bold.ttf`,
    `https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter@${CARD_FONT}/700Bold/Inter_700Bold.ttf`,
  ],
  regular: [
    `https://unpkg.com/@expo-google-fonts/inter@${CARD_FONT}/400Regular/Inter_400Regular.ttf`,
    `https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter@${CARD_FONT}/400Regular/Inter_400Regular.ttf`,
  ],
};

async function cardDownload(list: string[]): Promise<Uint8Array> {
  let last: unknown;
  for (const url of list) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      last = new Error(`${res.status} ${url}`);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("descarga");
}

let cardEngine: Promise<{ Resvg: any; fonts: Uint8Array[] }> | null = null;
/** Carga el motor, el WebAssembly y las tipografías una sola vez por instancia de la función. */
function cardLoadEngine() {
  if (!cardEngine) {
    cardEngine = (async () => {
      const mod = await import("npm:@resvg/resvg-wasm@2.6.2");
      const [wasm, bold, regular] = await Promise.all([cardDownload(CARD_URLS.wasm), cardDownload(CARD_URLS.bold), cardDownload(CARD_URLS.regular)]);
      await mod.initWasm(wasm);
      return { Resvg: mod.Resvg, fonts: [bold, regular] };
    })().catch((e) => {
      cardEngine = null; // la próxima vez se reintenta
      throw e;
    });
  }
  return cardEngine;
}

/** Olvida el motor y el logo ya cargados (para las pruebas). */
export function resetCardEngine() {
  cardEngine = null;
  cardLogoCache = null;
}

let cardLogoCache: Promise<string | null> | null = null;
/** El logo se baja de la web (una vez) y se incrusta en la imagen; si no se puede, se usa un emblema simple. */
function cardLoadLogo(): Promise<string | null> {
  if (!cardLogoCache) {
    cardLogoCache = (async () => {
      try {
        const bytes = await cardDownload([`${CARD_SITE}/logo.png`]);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:image/png;base64,${btoa(bin)}`;
      } catch {
        return null;
      }
    })();
  }
  return cardLogoCache;
}

/** Convierte el SVG en PNG. Devuelve null si algo falla (el aviso sale como texto). */
export async function svgToPng(svg: string): Promise<Uint8Array | null> {
  try {
    const { Resvg, fonts } = await cardLoadEngine();
    const r = new Resvg(svg, { fitTo: { mode: "width", value: CARD_W }, font: { fontBuffers: fonts, defaultFontFamily: "Inter", loadSystemFonts: false } });
    const png: Uint8Array = r.render().asPng();
    r.free?.();
    return png;
  } catch (e) {
    console.error("card:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface CardImage {
  png: Uint8Array;
  caption: string;
}

const CARD_NOTE = {
  es: "⚠️ Información para registro personal: no es asesoramiento financiero.",
  en: "⚠️ For personal record-keeping: not financial advice.",
};

/** Las imágenes se pueden apagar poniendo el secreto SIGNAL_IMAGES=off (hay que volver a desplegar la función). */
export const cardsEnabled = (): boolean => {
  try {
    return (globalThis as any).Deno?.env?.get("SIGNAL_IMAGES") !== "off";
  } catch {
    return true;
  }
};

export async function signalCardImage(t: CommunityTrade, lang: Lang): Promise<CardImage | null> {
  if (!cardsEnabled()) return null;
  const png = await svgToPng(signalCardSvg(t, lang, await cardLoadLogo()));
  if (!png) return null;
  const long = t.direction === "LONG";
  const caption = `<b>${esc(prettyPair(t.symbol))}</b> · ${long ? "LONG 🟢" : "SHORT 🔴"}\n⛩ <b>${t.entry}</b>  💠 <b>${t.tp}</b>  🛑 <b>${t.sl}</b>\n\n<i>${CARD_NOTE[lang]}</i>\n<a href="${CARD_SITE}">VELTRIX</a>`;
  return { png, caption };
}

export async function resultCardImage(symbol: string, outcome: "TP" | "SL", r: number, lang: Lang, opts: { label?: string } = {}): Promise<CardImage | null> {
  if (!cardsEnabled()) return null;
  const png = await svgToPng(resultCardSvg(symbol, outcome, r, lang, opts, await cardLoadLogo()));
  if (!png) return null;
  const ok = outcome === "TP";
  const caption = `${ok ? "✅" : "❌"} <b>${esc(prettyPair(symbol))}</b> · ${ok ? "TP" : "SL"} · <b>${cardR(r)}</b>\n<a href="${CARD_SITE}">VELTRIX</a>`;
  return { png, caption };
}

/**
 * Deja una tarea corriendo después de contestar (EdgeRuntime.waitUntil en Supabase), para no hacer esperar a quien llama
 * mientras se dibuja la imagen. Fuera de Supabase (por ejemplo en las pruebas) devuelve la promesa para esperarla.
 */
export function runInBackground(task: Promise<unknown>): Promise<unknown> | void {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(task.catch(() => {}));
    return;
  }
  return task;
}

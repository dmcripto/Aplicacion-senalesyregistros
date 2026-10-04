import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publishToCommunities } from "../supabase/functions/_shared/community";
import { db, resetDb } from "./helpers/fake-supabase";

type Card = typeof import("../supabase/functions/_shared/card");
let card: Card;

const file = (p: string) => new Uint8Array(readFileSync(new URL(`../${p}`, import.meta.url)));
const assets: Record<string, Uint8Array> = {
  "index_bg.wasm": file("node_modules/@resvg/resvg-wasm/index_bg.wasm"),
  "Inter_700Bold.ttf": file("node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"),
  "Inter_400Regular.ttf": file("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
  "logo.png": file("public/logo.png"),
};

const sig = { symbol: "BTCUSDT", direction: "LONG", entry: 65000, tp: 66500, sl: 64500 };

beforeAll(async () => {
  (globalThis as any).Deno = { env: { get: () => undefined } };
  card = await import("../supabase/functions/_shared/card");
});

describe("dibujo de la tarjeta (SVG)", () => {
  it("la señal lleva par, dirección, los tres niveles con su distancia en % y el R:R", () => {
    const svg = card.signalCardSvg(sig, "es");
    expect(svg).toContain("BTC/USDT");
    expect(svg).toContain("COMPRA · LONG");
    expect(svg).toContain(">66500<");
    expect(svg).toContain(">65000<");
    expect(svg).toContain(">64500<");
    expect(svg).toContain("+2.31%");
    expect(svg).toContain("−0.77%");
    expect(svg).toContain("1 : 3.0");
    expect(svg).toContain("No es asesoramiento financiero");
    expect(svg).not.toMatch(/\$|capital|balance/i); // sin dinero
  });

  it("en una venta el stop queda arriba y el target abajo; en una compra, al revés", () => {
    const at = (svg: string, label: string) => svg.indexOf(label);
    const long = card.signalCardSvg(sig, "es");
    expect(at(long, "TARGET")).toBeLessThan(at(long, "STOP LOSS"));
    const short = card.signalCardSvg({ symbol: "ETHUSDT", direction: "SHORT", entry: 3050, tp: 2950, sl: 3100 }, "es");
    expect(at(short, "STOP LOSS")).toBeLessThan(at(short, "TARGET"));
    expect(short).toContain("VENTA · SHORT");
  });

  it("con varios targets dibuja una fila por cada uno (el más lejano arriba en una compra) y el R:R del TP final", () => {
    const svg = card.signalCardSvg({ symbol: "HYPEUSDT", direction: "LONG", entry: 40.5, tp: 44, sl: 39.5, targets: [41.5, 42.5] }, "es");
    for (const l of ["TARGET 1", "TARGET 2", "TARGET 3"]) expect(svg).toContain(`>${l}<`);
    expect(svg.indexOf(">TARGET 3<")).toBeLessThan(svg.indexOf(">TARGET 1<"));
    expect(svg.indexOf(">TARGET 1<")).toBeLessThan(svg.indexOf(">ENTRADA<"));
    expect(svg).toContain("1 : 3.5");
    const short = card.signalCardSvg({ symbol: "ETHUSDT", direction: "SHORT", entry: 3050, tp: 2940, sl: 3100, targets: [3020, 3000, 2980, 2960] }, "es");
    expect(short.indexOf(">STOP LOSS<")).toBeLessThan(short.indexOf(">TARGET 1<"));
    expect(short.indexOf(">TARGET 1<")).toBeLessThan(short.indexOf(">TARGET 5<"));
  });

  it("el aviso de un target lleva su número y el resultado puede llevar una nota", () => {
    const p2 = card.partialCardSvg({ symbol: "HYPEUSDT", direction: "LONG", entry: 40.5, tp: 44, sl: 39.5 }, 42.5, 2, "es", null, 2);
    expect(p2).toContain("TARGET 2 ALCANZADO");
    expect(p2).toContain("Asegurar ganancias: mover el SL al Target 1");
    const r = card.resultCardSvg("HYPEUSDT", "SL", -1, "es", { note: "SL tocado antes del Target 1" });
    expect(r).toContain("SL tocado antes del Target 1");
    expect(card.resultCardSvg("HYPEUSDT", "SL", -1, "es")).not.toContain("antes del Target");
  });

  it("en inglés usa los textos en inglés y un símbolo raro no rompe el SVG", () => {
    const svg = card.signalCardSvg({ symbol: "A<B>&C", direction: "LONG", entry: 1, tp: 2, sl: 0.5 }, "en");
    expect(svg).toContain("NEW SIGNAL");
    expect(svg).toContain("A&lt;B&gt;&amp;C");
    expect(svg).not.toContain("A<B>");
  });

  it("el aviso de Target 1 muestra el profit, el R y la gestión sugerida (en español e inglés)", () => {
    const svg = card.partialCardSvg(sig, 65500, 1, "es");
    expect(svg).toContain("TARGET 1 ALCANZADO");
    expect(svg).toContain("BTC/USDT · LONG");
    expect(svg).toContain("+0.77%");
    expect(svg).toContain("+1.0R");
    expect(svg).toContain("Cerrar 50% y mover el SL a break-even");
    const en = card.partialCardSvg({ symbol: "ETHUSDT", direction: "SHORT", entry: 3050, tp: 2750, sl: 3100 }, 3000, 1, "en");
    expect(en).toContain("TARGET 1 HIT");
    expect(en).toContain("ETH/USDT · SHORT");
    expect(en).toContain("+1.64%"); // en una venta la ganancia es que baje
    expect(en).toContain("Close 50% and move the SL to break-even");
  });

  it("el resultado muestra TP o SL con su R", () => {
    expect(card.resultCardSvg("BTCUSDT", "TP", 3, "es", { label: "Cierre automático" })).toContain("+3.0R");
    const sl = card.resultCardSvg("ETHUSDT", "SL", -1, "en");
    expect(sl).toContain("SL HIT");
    expect(sl).toContain("−1.0R");
  });
});

describe("imagen PNG", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: any) => {
      const name = String(url).split("/").pop()!;
      return assets[name] ? new Response(assets[name]) : new Response("no", { status: 404 });
    });
  });

  it("se dibuja un PNG de 1080 × 1080 con su texto de pie", async () => {
    const img = await card.signalCardImage(sig, "es");
    expect(img).not.toBeNull();
    const png = img!.png;
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // firma PNG
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(16)).toBe(1080);
    expect(dv.getUint32(20)).toBe(1080);
    expect(png.length).toBeGreaterThan(20_000); // tiene contenido (texto, logo), no una imagen vacía
    // La imagen ya dice todo: el pie solo lleva el aviso legal y el enlace, sin repetir los números.
    expect(img!.caption).toContain("asesoramiento");
    expect(img!.caption).toContain("veltrix-trading.vercel.app");
    expect(img!.caption).not.toMatch(/65000|66500|64500|BTC/);
  });

  it("también el aviso de Target 1", async () => {
    const img = await card.partialCardImage(sig, 65500, 1, "es");
    expect(img?.png.length).toBeGreaterThan(20_000);
    expect(img?.caption).toContain("asesoramiento");
  });

  it("también la tarjeta de resultado", async () => {
    const img = await card.resultCardImage("BTCUSDT", "TP", 3, "es");
    expect(img?.png.length).toBeGreaterThan(20_000);
    expect(img?.caption).toContain("VELTRIX");
    expect(img?.caption).not.toContain("3.0R");
  });

  it("si no se puede bajar la tipografía devuelve null (el aviso sale como texto)", async () => {
    card.resetCardEngine();
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await card.signalCardImage(sig, "es")).toBeNull();
    card.resetCardEngine(); // el siguiente uso vuelve a cargar todo
  });

  it("se puede apagar con el secreto SIGNAL_IMAGES=off", async () => {
    (globalThis as any).Deno = { env: { get: (k: string) => (k === "SIGNAL_IMAGES" ? "off" : undefined) } };
    expect(await card.signalCardImage(sig, "es")).toBeNull();
    (globalThis as any).Deno = { env: { get: () => undefined } };
  });
});

describe("publicar la imagen en la comunidad", () => {
  let calls: Array<{ method: string; body: any }> = [];
  let photoError: number | null = null;
  const photo = async () => ({ png: new Uint8Array([1, 2, 3]), caption: "<b>BTC/USDT</b>" });

  beforeEach(() => {
    resetDb({ profiles: [{ id: "u1", lang: "es" }], telegram_communities: [{ id: "c1", user_id: "u1", chat_id: -100, thread_id: 777 }] });
    calls = [];
    photoError = null;
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      const method = String(url).split("/").pop()!;
      calls.push({ method, body: init.body });
      if (method === "sendPhoto" && photoError) return new Response(JSON.stringify({ ok: false, error_code: photoError }));
      return new Response(JSON.stringify({ ok: true }));
    });
  });

  const run = async (builder?: typeof photo | (() => Promise<null>)) => {
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    return publishToCommunities(createClient("x", "y"), "TOKEN", "u1", () => "texto", builder as any);
  };

  it("manda la imagen al tema donde se conectó, con su texto, y no manda el texto aparte", async () => {
    expect(await run(photo)).toBe(1);
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto"]);
    const form = calls[0].body as FormData;
    expect(form.get("chat_id")).toBe("-100");
    expect(form.get("message_thread_id")).toBe("777");
    expect(form.get("caption")).toBe("<b>BTC/USDT</b>");
    expect(form.get("parse_mode")).toBe("HTML");
    expect(form.get("photo")).toBeInstanceOf(Blob);
  });

  it("si no hay imagen (null o error al dibujar) manda el texto de siempre", async () => {
    expect(await run(async () => null)).toBe(1);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    calls = [];
    expect(await run(async () => { throw new Error("boom"); })).toBe(1);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });

  it("si Telegram rechaza la imagen, manda el texto y no borra la conexión", async () => {
    photoError = 400;
    expect(await run(photo)).toBe(1);
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage"]);
    expect(db.tables.telegram_communities).toHaveLength(1);
  });

  it("si el bot ya no está en el grupo (403), borra la conexión sin insistir con el texto", async () => {
    photoError = 403;
    expect(await run(photo)).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto"]);
    expect(db.tables.telegram_communities).toHaveLength(0);
  });

  it("sin constructor de imagen se comporta como antes (solo texto)", async () => {
    expect(await run()).toBe(1);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });
});

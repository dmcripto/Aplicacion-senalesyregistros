import { describe, expect, it } from "vitest";
import { cleanInvite, cleanRef, inviteLink, inviteMessage, resultShareText, summarize } from "../packages/core/src/trading";
import type { Trade } from "../packages/core/src/trading";

describe("etiquetas de origen (?ref=)", () => {
  it("acepta minúsculas, números, guion y guion bajo, y pasa a minúsculas", () => {
    expect(cleanRef("x03")).toBe("x03");
    expect(cleanRef(" X-Post_12 ")).toBe("x-post_12");
    expect(cleanRef("a".repeat(40))).toBe("a".repeat(40));
  });
  it("rechaza vacías, largas, con símbolos o que no son texto", () => {
    expect(cleanRef("")).toBeNull();
    expect(cleanRef("a".repeat(41))).toBeNull();
    expect(cleanRef("x 03")).toBeNull();
    expect(cleanRef("x';drop table")).toBeNull();
    expect(cleanRef("<script>")).toBeNull();
    expect(cleanRef(null)).toBeNull();
    expect(cleanRef(42)).toBeNull();
  });
});

describe("programa de invitados", () => {
  it("el código de invitación se limpia y se pasa a mayúsculas", () => {
    expect(cleanInvite("xpuc9u6q")).toBe("XPUC9U6Q");
    expect(cleanInvite("  abcd2345 ")).toBe("ABCD2345");
    expect(cleanInvite("ABC12")).toBeNull(); // muy corto
    expect(cleanInvite("A".repeat(13))).toBeNull(); // muy largo
    expect(cleanInvite("ABCD-234")).toBeNull();
    expect(cleanInvite("';--drop")).toBeNull();
    expect(cleanInvite(undefined)).toBeNull();
  });
  it("el enlace y el mensaje llevan el código", () => {
    expect(inviteLink("XPUC9U6Q")).toBe("https://www.veltrix-trading.com.ar/?inv=XPUC9U6Q");
    expect(inviteMessage("XPUC9U6Q")).toContain("https://www.veltrix-trading.com.ar/?inv=XPUC9U6Q");
  });
});

describe("tarjeta de la semana para compartir", () => {
  const day = 86_400_000;
  const now = new Date("2026-10-05T12:00:00Z");
  const mk = (id: string, outcome: Trade["outcome"], daysAgo: number, tp = 110): Trade => ({
    id, symbol: "BTCUSDT", direction: "LONG", entry: 100, tp, sl: 95, date: new Date(now.getTime() - (daysAgo + 1) * day).toISOString(),
    outcome, closedAt: new Date(now.getTime() - daysAgo * day).toISOString(),
  });
  it("la semana se llama «Mi semana en R» y solo cuenta los últimos 7 días", () => {
    const s = summarize([mk("a", "TP", 1), mk("b", "SL", 2), mk("c", "TP", 20)], "week", now);
    expect(s.label).toBe("Mi semana en R");
    expect(s.closed).toBe(2); // la de hace 20 días queda afuera
  });
  it("el texto del post lleva el resultado y el enlace de invitado", () => {
    const s = summarize([mk("a", "TP", 1), mk("b", "TP", 2)], "week", now);
    const txt = resultShareText(s, "https://www.veltrix-trading.com.ar/?inv=ABCD2345");
    expect(txt).toContain("Mi semana en R");
    expect(txt).toContain("2 operaciones");
    expect(txt).toContain("?inv=ABCD2345");
    expect(txt.length).toBeLessThan(250); // entra en un post de X (el enlace cuenta 23)
  });
  it("sin operaciones, el texto es la invitación simple", () => {
    const txt = resultShareText(summarize([], "week", now), "https://x.test/?inv=ABCD2345");
    expect(txt).toContain("diario de trading");
    expect(txt).not.toContain("operaciones con");
  });
});

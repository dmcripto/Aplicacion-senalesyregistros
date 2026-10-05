import { describe, expect, it } from "vitest";
import { cleanInvite, cleanRef, inviteLink, inviteMessage } from "../packages/core/src/trading";

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
    expect(inviteLink("XPUC9U6Q")).toBe("https://veltrix-trading.vercel.app/?inv=XPUC9U6Q");
    expect(inviteMessage("XPUC9U6Q")).toContain("https://veltrix-trading.vercel.app/?inv=XPUC9U6Q");
  });
});

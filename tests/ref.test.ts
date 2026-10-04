import { describe, expect, it } from "vitest";
import { cleanRef } from "../packages/core/src/trading";

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

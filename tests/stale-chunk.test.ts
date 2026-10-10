import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "../src/staleChunk";

describe("versión vieja después de publicar", () => {
  it("reconoce los errores de archivos que ya no existen", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/ChartCard-abc.js"))).toBe(true);
    expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(new Error("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError("Unable to preload CSS for /assets/x.css")).toBe(true);
  });
  it("no confunde un error común con uno de versión vieja", () => {
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

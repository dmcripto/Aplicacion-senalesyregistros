import { describe, expect, it } from "vitest";
import { econTitleEs } from "../packages/core/src/economy";
import { titleEs } from "../supabase/functions/_shared/economy";

const titles = ["CPI m/m", "Core CPI m/m", "ADP Non-Farm Employment Change", "Non-Farm Employment Change", "Employment Change", "Unemployment Rate", "FOMC Member Waller Speaks", "BOE Gov Bailey Speaks", "ECB President Lagarde Speaks", "Fed Chair Powell Speaks", "FOMC Meeting Minutes", "Federal Funds Rate", "Main Refinancing Rate", "Average Hourly Earnings m/m", "Natural Gas Storage", "Algo Raro"];

describe("nombres de la agenda en español", () => {
  it("la web y el servidor traducen igual", () => {
    for (const t of titles) expect(econTitleEs(t)).toBe(titleEs(t));
  });
  it("traduce los nombres y los discursos", () => {
    expect(econTitleEs("Employment Change")).toBe("Cambio en el empleo");
    expect(econTitleEs("Core CPI m/m")).toBe("Inflación subyacente (Core CPI) m/m");
    expect(econTitleEs("FOMC Member Waller Speaks")).toBe("Fed (FOMC) miembro Waller habla");
    expect(econTitleEs("BOE Gov Bailey Speaks")).toBe("BOE gobernador Bailey habla");
    expect(econTitleEs("Algo Raro")).toBe("Algo Raro");
  });
});

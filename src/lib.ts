// ─── VELTRIX · Lógica del diario (capa web) ────────────────────────────────
// La lógica pura (tipos, cálculos, parser de alertas, formateo) vive en
// @dmcripto/core para poder compartirse con la app móvil. Acá sólo queda lo
// que depende del navegador: exportar el CSV a un archivo descargable.

export * from "@dmcripto/core";
import { tradesToCsv } from "@dmcripto/core";
import type { Trade } from "@dmcripto/core";

export function downloadCsv(trades: Trade[]) {
  const blob = new Blob([tradesToCsv(trades)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "diario-veltrix.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

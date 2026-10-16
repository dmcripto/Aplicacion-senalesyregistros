import { describe, expect, it } from "vitest";
import { chatSpans, parseChatText } from "../packages/core/src/trading";

describe("texto del chat", () => {
  it("convierte negritas y código en tramos, sin dejar asteriscos", () => {
    expect(chatSpans("clave **solo lectura** y `5x`")).toEqual([{ text: "clave " }, { text: "solo lectura", bold: true }, { text: " y " }, { text: "5x", code: true }]);
  });
  it("separa párrafos, listas con guiones y listas numeradas", () => {
    const b = parseChatText("Se hace desde **Conexiones**:\n\n- Elegí tu exchange\n- Creá una clave\n\n1. Pegala\n2. Guardá\n\nSi falla:\n- Espacio de más");
    expect(b.map((x) => x.type)).toEqual(["p", "ul", "ol", "p", "ul"]);
    expect((b[1] as { items: unknown[] }).items).toHaveLength(2);
    expect((b[2] as { items: unknown[] }).items).toHaveLength(2);
    expect(JSON.stringify(b)).not.toContain("**");
  });
  it("los títulos con # quedan como línea en negrita y el HTML no se interpreta", () => {
    const b = parseChatText("## Pasos\n<script>alert(1)</script>");
    expect(b[0]).toEqual({ type: "p", spans: [{ text: "Pasos", bold: true }] });
    expect((b[1] as { spans: { text: string }[] }).spans[0].text).toBe("<script>alert(1)</script>"); // se muestra como texto, nunca como HTML
  });
  it("texto vacío o raro no rompe", () => {
    expect(parseChatText("")).toEqual([]);
    expect(parseChatText("   \n\n  ")).toEqual([]);
  });
});

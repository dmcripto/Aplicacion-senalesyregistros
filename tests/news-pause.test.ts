import { describe, expect, it } from "vitest";
import { DEFAULT_PAUSE, activeNewsPause, pauseCfgOf, pauseLabel } from "../supabase/functions/_shared/newsPause";
import type { NewsEvent } from "../supabase/functions/_shared/newsPause";

const AT = Date.parse("2026-10-07T12:30:00Z");
const ev = (over: Partial<NewsEvent> = {}): NewsEvent => ({ starts_at: new Date(AT).toISOString(), title: "CPI m/m", title_es: "Inflación (CPI) m/m", country: "USD", ...over });
const min = (m: number) => AT + m * 60_000;

describe("pausa por datos económicos", () => {
  it("de fábrica: 30 minutos antes y 30 después, activada", () => {
    expect(DEFAULT_PAUSE).toEqual({ enabled: true, before: 30, after: 30 });
    expect(pauseCfgOf(null)).toEqual(DEFAULT_PAUSE);
    expect(pauseCfgOf({})).toEqual(DEFAULT_PAUSE);
  });
  it("hay pausa desde 30 min antes hasta 30 min después (bordes incluidos), y no fuera de esa ventana", () => {
    expect(activeNewsPause([ev()], DEFAULT_PAUSE, min(-31))).toBeNull();
    expect(activeNewsPause([ev()], DEFAULT_PAUSE, min(-30))?.until).toBe(min(30));
    expect(activeNewsPause([ev()], DEFAULT_PAUSE, min(0))?.event.title).toBe("CPI m/m");
    expect(activeNewsPause([ev()], DEFAULT_PAUSE, min(30))).not.toBeNull();
    expect(activeNewsPause([ev()], DEFAULT_PAUSE, min(31))).toBeNull();
  });
  it("apagada no pausa nunca; los minutos se pueden cambiar y se acotan a 0–180", () => {
    expect(activeNewsPause([ev()], { ...DEFAULT_PAUSE, enabled: false }, min(0))).toBeNull();
    expect(pauseCfgOf({ enabled: false })).toMatchObject({ enabled: false });
    const cfg = pauseCfgOf({ enabled: true, before_min: 10, after_min: 0 });
    expect(activeNewsPause([ev()], cfg, min(-11))).toBeNull();
    expect(activeNewsPause([ev()], cfg, min(-10))).not.toBeNull();
    expect(activeNewsPause([ev()], cfg, min(1))).toBeNull(); // 0 minutos después: termina con el dato
    expect(pauseCfgOf({ before_min: 9999, after_min: -5 })).toEqual({ enabled: true, before: 180, after: 0 });
    expect(pauseCfgOf({ before_min: "x" })).toMatchObject({ before: 30 });
  });
  it("con varios datos seguidos, la pausa dura hasta el último", () => {
    const second = ev({ starts_at: new Date(min(20)).toISOString(), title: "Core CPI m/m", title_es: "Inflación subyacente (Core CPI) m/m" });
    const p = activeNewsPause([ev(), second], DEFAULT_PAUSE, min(10))!;
    expect(p.until).toBe(min(50));
    expect(p.event.title).toBe("Core CPI m/m");
  });
  it("fechas rotas no rompen nada, y el nombre sale en el idioma pedido", () => {
    expect(activeNewsPause([ev({ starts_at: "basura" })], DEFAULT_PAUSE, min(0))).toBeNull();
    expect(pauseLabel(ev(), "es")).toBe("USD Inflación (CPI) m/m");
    expect(pauseLabel(ev(), "en")).toBe("USD CPI m/m");
    expect(pauseLabel(ev({ title_es: null }), "es")).toBe("USD CPI m/m");
  });
});

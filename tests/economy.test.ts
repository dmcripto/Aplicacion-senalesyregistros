import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "./helpers/fake-supabase";
import { createClient } from "./helpers/fake-supabase";
import { digestMessage, isRelevant, parseFeed, postEconomyNews, refreshEvents, reminderMessage, titleEs } from "../supabase/functions/_shared/economy";
import type { EconEvent } from "../supabase/functions/_shared/economy";

const feed = [
  { title: "CPI m/m", country: "USD", date: "2026-10-07T08:30:00-04:00", impact: "High", forecast: "0.3%", previous: "0.4%" },
  { title: "Retail Sales m/m", country: "USD", date: "2026-10-07T08:30:00-04:00", impact: "Medium", forecast: "", previous: "0.1%" },
  { title: "Retail Sales m/m", country: "EUR", date: "2026-10-07T05:00:00-04:00", impact: "Medium", forecast: "", previous: "" }, // medio y no USD: no sirve
  { title: "Bank Holiday", country: "JPY", date: "2026-10-07T00:00:00-04:00", impact: "Holiday" },
  { title: "Algo", country: "USD", date: "no es fecha", impact: "High" },
  { title: "Unemployment Rate", country: "USD", date: "2026-10-09T08:30:00-04:00", impact: "High", forecast: "4.1%", previous: "4.2%" },
];

describe("calendario público", () => {
  it("se queda con alto impacto y con el impacto medio de EE. UU.; descarta feriados y datos rotos", () => {
    const ev = parseFeed(feed);
    expect(ev.map((e) => `${e.country} ${e.title}`)).toEqual(["USD CPI m/m", "USD Retail Sales m/m", "USD Unemployment Rate"]);
    expect(ev[0]).toMatchObject({ starts_at: "2026-10-07T12:30:00.000Z", impact: "High", forecast: "0.3%", previous: "0.4%" });
    expect(ev[1].forecast).toBeNull();
    expect(parseFeed({ error: "limit" })).toEqual([]);
  });

  it("relevancia", () => {
    expect(isRelevant("High", "JPY")).toBe(true);
    expect(isRelevant("Medium", "USD")).toBe(true);
    expect(isRelevant("Medium", "EUR")).toBe(false);
    expect(isRelevant("Low", "USD")).toBe(false);
  });

  it("nombres en español de los datos conocidos", () => {
    expect(titleEs("CPI m/m")).toBe("Inflación (CPI) m/m");
    expect(titleEs("Core CPI m/m")).toBe("Inflación subyacente (Core CPI) m/m");
    expect(titleEs("ADP Non-Farm Employment Change")).toBe("Empleo privado ADP");
    expect(titleEs("Non-Farm Employment Change")).toBe("Empleo no agrícola (NFP)");
    expect(titleEs("Algo Raro")).toBe("Algo Raro");
  });
});

const NOW = Date.parse("2026-10-07T11:00:00Z"); // 08:00 en Buenos Aires
const ev = (over: Partial<EconEvent> = {}): EconEvent => ({
  id: "USD|CPI m/m|2026-10-07T12:30:00.000Z",
  starts_at: "2026-10-07T12:30:00.000Z",
  country: "USD",
  title: "CPI m/m",
  title_es: "Inflación (CPI) m/m",
  impact: "High",
  forecast: "0.3%",
  previous: "0.4%",
  ...over,
});

describe("mensajes", () => {
  it("el resumen del día lista los datos de hoy con los horarios en UTC", () => {
    const html = digestMessage([ev(), ev({ id: "x", starts_at: "2026-10-09T12:30:00.000Z" })], NOW, "America/Argentina/Buenos_Aires", "es")!;
    expect(html).toContain("AGENDA ECONÓMICA");
    expect(html).toContain("<b>12:30</b>"); // 09:30 de Buenos Aires = 12:30 UTC
    expect(html).toContain("Inflación (CPI) m/m");
    expect(html).toContain("Esperado: <b>0.3%</b> · Anterior: <b>0.4%</b>");
    expect(html).toContain("Horarios en UTC");
    expect(html).not.toContain("America/Argentina");
    expect(html.match(/🇺🇸/g)).toHaveLength(1); // el de otro día no entra
  });
  it("en inglés usa el nombre original", () => {
    const html = digestMessage([ev()], NOW, "America/Argentina/Buenos_Aires", "en")!;
    expect(html).toContain("ECONOMIC CALENDAR");
    expect(html).toContain("CPI m/m");
    expect(html).toContain("Forecast");
  });
  it("sin datos hoy o sin zona horaria no hay resumen", () => {
    expect(digestMessage([ev({ starts_at: "2026-10-09T12:30:00.000Z" })], NOW, "America/Argentina/Buenos_Aires", "es")).toBeNull();
    expect(digestMessage([ev()], NOW, null, "es")).toBeNull();
  });
  it("el aviso previo dice cuántos minutos faltan y escapa el HTML", () => {
    const html = reminderMessage(ev({ title_es: "A <b>&</b>" }), Date.parse("2026-10-07T12:00:00Z"), "es");
    expect(html).toContain("EN 30 MIN");
    expect(html).toContain("A &lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("refreshEvents", () => {
  beforeEach(() => resetDb({ economy_state: [], economic_events: [] }));
  const supabase = createClient();
  const okFetch = (n: { count: number }) =>
    (async () => {
      n.count++;
      return new Response(JSON.stringify(feed));
    }) as unknown as typeof fetch;

  it("guarda los eventos y no vuelve a pedir el calendario antes de 3 horas", async () => {
    const n = { count: 0 };
    expect(await refreshEvents(supabase, NOW, okFetch(n))).toBe(6); // 3 por calendario (esta semana y la próxima)
    expect(db.tables.economic_events).toHaveLength(3); // el mismo evento no se duplica
    expect(n.count).toBe(2);
    expect(await refreshEvents(supabase, NOW + 60 * 60_000, okFetch(n))).toBe(0);
    expect(n.count).toBe(2);
    expect(await refreshEvents(supabase, NOW + 3.1 * 3_600_000, okFetch(n))).toBe(6);
  });

  it("si el servicio falla, guarda el intento y reintenta a los 30 minutos", async () => {
    const bad = (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch;
    expect(await refreshEvents(supabase, NOW, bad)).toBe(0);
    expect(db.tables.economy_state[0].ok).toBe(false);
    const n = { count: 0 };
    expect(await refreshEvents(supabase, NOW + 10 * 60_000, okFetch(n))).toBe(0); // todavía no
    expect(n.count).toBe(0);
    expect(await refreshEvents(supabase, NOW + 31 * 60_000, okFetch(n))).toBe(6);
  });

  it("borra lo viejo", async () => {
    db.tables.economic_events = [{ id: "old", starts_at: new Date(NOW - 5 * 86_400_000).toISOString() }];
    await refreshEvents(supabase, NOW, okFetch({ count: 0 }));
    expect(db.tables.economic_events.find((e) => e.id === "old")).toBeUndefined();
  });

  it("sin el SQL (tabla de estado inexistente) no hace nada", async () => {
    db.missingSelect = ["fetched_at"];
    const n = { count: 0 };
    expect(await refreshEvents(supabase, NOW, okFetch(n))).toBe(0);
    expect(n.count).toBe(0);
  });
});

describe("postEconomyNews", () => {
  const supabase = createClient();
  type Call = { chat: number; html: string; thread: number | null };
  let calls: Call[];
  let reply: { ok?: boolean; error_code?: number };
  const send = async (chat: number, html: string, thread: number | null) => {
    calls.push({ chat, html, thread });
    return reply;
  };

  beforeEach(() => {
    calls = [];
    reply = { ok: true };
    resetDb({
      profiles: [{ id: "u1", lang: "es", timezone: "America/Argentina/Buenos_Aires" }],
      telegram_communities: [
        { id: "c1", user_id: "u1", chat_id: -100, thread_id: 5, news_enabled: true, news_thread_id: 12 },
        { id: "c2", user_id: "u1", chat_id: -200, thread_id: null, news_enabled: false, news_thread_id: null },
      ],
      economic_events: [{ ...ev() }],
      economic_posts: [],
    });
  });

  it("a las 8:00 de la cuenta publica el resumen del día, solo en el tema de noticias y solo en las comunidades que lo activaron", async () => {
    expect(await postEconomyNews({ supabase, send }, NOW)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ chat: -100, thread: 12 });
    expect(calls[0].html).toContain("AGENDA ECONÓMICA");
  });

  it("no repite el resumen en las vueltas siguientes del mismo día", async () => {
    await postEconomyNews({ supabase, send }, NOW);
    await postEconomyNews({ supabase, send }, NOW + 5 * 60_000);
    expect(calls).toHaveLength(1);
  });

  it("antes de las 8:00 o pasado el mediodía no hay resumen", async () => {
    expect(await postEconomyNews({ supabase, send }, Date.parse("2026-10-07T10:00:00Z"))).toBe(0); // 07:00
    expect(await postEconomyNews({ supabase, send }, Date.parse("2026-10-07T16:00:00Z"))).toBe(0); // 13:00, ya pasó la ventana
  });

  it("avisa 30 minutos antes de un dato de alto impacto, una sola vez", async () => {
    db.tables.economic_posts = [{ key: "digest:2026-10-07", chat_id: -100 }]; // el resumen de la mañana ya salió
    const t = Date.parse("2026-10-07T12:10:00Z"); // 09:10: faltan 20 min
    expect(await postEconomyNews({ supabase, send }, t)).toBe(1);
    expect(calls[0].html).toContain("EN 20 MIN");
    expect(await postEconomyNews({ supabase, send }, t + 5 * 60_000)).toBe(0);
  });

  it("los de impacto medio no tienen aviso previo, ni los que ya salieron", async () => {
    db.tables.economic_posts = [{ key: "digest:2026-10-07", chat_id: -100 }];
    db.tables.economic_events = [ev({ impact: "Medium" })];
    expect(await postEconomyNews({ supabase, send }, Date.parse("2026-10-07T12:10:00Z"))).toBe(0);
    db.tables.economic_events = [ev()];
    expect(await postEconomyNews({ supabase, send }, Date.parse("2026-10-07T12:40:00Z"))).toBe(0);
  });

  it("si Telegram falla se reintenta en la próxima vuelta; si el bot ya no está, se borra la comunidad; si el tema no existe, se apagan las noticias", async () => {
    reply = { ok: false, error_code: 500 };
    expect(await postEconomyNews({ supabase, send }, NOW)).toBe(0);
    expect(db.tables.economic_posts).toHaveLength(0);
    reply = { ok: true };
    expect(await postEconomyNews({ supabase, send }, NOW + 5 * 60_000)).toBe(1);

    db.tables.economic_posts = [];
    reply = { ok: false, error_code: 400 };
    await postEconomyNews({ supabase, send }, NOW);
    expect(db.tables.telegram_communities.find((c) => c.id === "c1")!.news_enabled).toBe(false);

    db.tables.telegram_communities.find((c) => c.id === "c1")!.news_enabled = true;
    reply = { ok: false, error_code: 403 };
    await postEconomyNews({ supabase, send }, NOW);
    expect(db.tables.telegram_communities.find((c) => c.id === "c1")).toBeUndefined();
  });

  it("sin comunidades con noticias o sin eventos, no hace nada", async () => {
    db.tables.economic_events = [];
    expect(await postEconomyNews({ supabase, send }, NOW)).toBe(0);
    db.tables.economic_events = [ev()];
    db.tables.telegram_communities = [];
    expect(await postEconomyNews({ supabase, send }, NOW)).toBe(0);
  });
});

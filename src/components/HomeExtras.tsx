import { useEffect, useState } from "react";
import { cx, fmtPrice, fmtR, resultR, t, todayOverview } from "../lib";
import type { Trade } from "../lib";
import { fetchAlerts, fetchTelegramLink } from "../tradesApi";
import { Icon, IconTile } from "../icons";
import type { IconName } from "../icons";
import type { View } from "../nav";

const COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"] as const;

export interface Quote {
  price: number;
  change: number | null; // % en 24 h
}

/** Precios de las monedas principales con su variación de 24 horas (datos públicos de Binance, se actualizan solos). */
export function useQuotes(coins: readonly string[] = COINS): Record<string, Quote> {
  const [q, setQ] = useState<Record<string, Quote>>({});
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      const out: Record<string, Quote> = {};
      await Promise.all(
        coins.map(async (c) => {
          try {
            const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${c}`, { signal: AbortSignal.timeout(6000) });
            if (!res.ok) return;
            const j = await res.json();
            const price = Number(j.lastPrice ?? j.price);
            const ch = Number(j.priceChangePercent);
            if (price > 0) out[c] = { price, change: Number.isFinite(ch) ? ch : null };
          } catch {
            /* sin precio: la tarjeta de esa moneda no se muestra */
          }
        }),
      );
      if (!stop && Object.keys(out).length) setQ(out);
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins.join(",")]);
  return q;
}

const greeting = (d: Date) => {
  const h = d.getHours();
  return h < 6 ? t("Buenas noches") : h < 13 ? t("Buen día") : h < 20 ? t("Buenas tardes") : t("Buenas noches");
};

/** Portada de Inicio: saludo con lo del día, tres botones de acción y los precios de las monedas principales. */
export function HomeHero({ email, trades, now, go }: { email?: string; trades: Trade[]; now: Date; go: (v: View, panel?: string) => void }) {
  const quotes = useQuotes();
  const o = todayOverview(trades, now);
  const name = (email ?? "").split("@")[0];
  const line =
    o.open > 0 || o.closed > 0
      ? t("Hoy: {r} · {n} abiertas", { r: o.closed ? fmtR(o.r) : "0R", n: o.open })
      : t("Todo listo para registrar tu próxima operación.");
  const btn = "flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-bold transition-all hover:-translate-y-px active:scale-[0.98]";
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line2 bg-gradient-to-br from-[#0f2a35] via-panel to-[#0d1d33] p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-bull/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold">{greeting(now)}</p>
          <h1 className="font-display mt-1 truncate text-4xl font-extrabold tracking-wide text-snow sm:text-5xl">{name ? `${t("Hola")}, ${name}` : t("Hola")}</h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-fog">{line}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => go("journal")} className={cx(btn, "bg-gold text-ink hover:brightness-110")}>
            <Icon name="plus" className="h-4 w-4" /> {t("Registrar operación")}
          </button>
          <button type="button" onClick={() => go("chart")} className={cx(btn, "border border-line2 bg-ink/50 text-snow hover:border-gold/50")}>
            <Icon name="candles" className="h-4 w-4" /> {t("Ver gráfico")}
          </button>
          <button type="button" onClick={() => go("chart")} className={cx(btn, "border border-line2 bg-ink/50 text-snow hover:border-gold/50")}>
            <Icon name="bell" className="h-4 w-4" /> {t("Crear alerta")}
          </button>
        </div>
      </div>
      <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {COINS.map((c) => {
          const x = quotes[c];
          const up = (x?.change ?? 0) >= 0;
          return (
            <button key={c} type="button" onClick={() => go("chart")} className="rounded-xl border border-line/80 bg-ink/45 px-4 py-3 text-left backdrop-blur transition-colors hover:border-gold/40">
              <span className="flex items-center justify-between">
                <span className="text-[12px] font-bold tracking-wider text-fog">{c.replace("USDT", "")}</span>
                {x?.change != null && (
                  <span className={cx("num text-[11.5px] font-bold", up ? "text-bull" : "text-bear")}>
                    {up ? "▲" : "▼"} {Math.abs(x.change).toFixed(2)}%
                  </span>
                )}
              </span>
              <span className="num mt-1 block text-[19px] font-bold text-snow">{x ? fmtPrice(x.price) : "—"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Franja de estado: bot, alertas y Telegram, cada uno con su estado y un toque para ir a configurarlo. */
export function HomeStatus({ botReady, botOn, userId, go }: { botReady: boolean; botOn: boolean; userId: string; go: (v: View, panel?: string) => void }) {
  const [alerts, setAlerts] = useState<number | null>(null);
  const [tg, setTg] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetchAlerts(userId)
      .then((a) => alive && setAlerts(a.filter((x) => x.active).length))
      .catch(() => {});
    fetchTelegramLink()
      .then((l) => alive && setTg(!!l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);
  const chips: Array<{ icon: IconName; label: string; value: string; on: boolean; view: View; panel?: string }> = [
    ...(botReady ? [{ icon: "bot" as IconName, label: t("Bot automático"), value: botOn ? t("Encendido") : t("Apagado"), on: botOn, view: "bot" as View, panel: "bot" }] : []),
    ...(alerts != null ? [{ icon: "bell" as IconName, label: t("Alertas"), value: t("{n} activas", { n: alerts }), on: alerts > 0, view: "chart" as View }] : []),
    ...(tg != null ? [{ icon: "send" as IconName, label: "Telegram", value: tg ? t("Conectado") : t("Sin conectar"), on: tg, view: "connections" as View }] : []),
  ];
  if (!chips.length) return null;
  return (
    <section aria-label={t("Estado")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {chips.map((c) => (
        <button key={c.label} type="button" onClick={() => go(c.view, c.panel)} className="glass flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:border-gold/40">
          <IconTile name={c.icon} tone={c.on ? "green" : "cyan"} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-dim">{c.label}</span>
            <span className={cx("block text-[14px] font-bold", c.on ? "text-bull" : "text-fog")}>{c.value}</span>
          </span>
          <Icon name="arrow" className="h-4 w-4 text-dim" />
        </button>
      ))}
    </section>
  );
}

/** Las últimas operaciones, con su resultado en R. */
export function RecentTrades({ trades, go }: { trades: Trade[]; go: (v: View) => void }) {
  const last = [...trades].sort((a, b) => new Date(b.closedAt ?? b.date).getTime() - new Date(a.closedAt ?? a.date).getTime()).slice(0, 6);
  if (!last.length) return null;
  return (
    <section className="glass rounded-xl p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-wide text-snow">{t("ÚLTIMAS OPERACIONES")}</h2>
        <button type="button" onClick={() => go("journal")} className="text-[12px] font-semibold text-gold hover:text-snow">
          {t("Ver diario")} →
        </button>
      </div>
      <ul className="divide-y divide-line/60">
        {last.map((tr) => {
          const open = tr.outcome === "ABIERTA";
          const r = open ? null : resultR(tr);
          return (
            <li key={tr.id} className="flex items-center gap-3 py-2.5">
              <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-bold", tr.direction === "LONG" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear")}>{tr.direction === "LONG" ? "▲" : "▼"}</span>
              <span className="num min-w-0 flex-1 truncate text-[13px] font-semibold text-snow">{tr.symbol}</span>
              <span className="text-[11px] uppercase tracking-wider text-dim">{open ? t("abierta") : tr.outcome}</span>
              <span className={cx("num w-14 text-right text-[13px] font-bold", r == null ? "text-gold" : r > 0 ? "text-bull" : r < 0 ? "text-bear" : "text-fog")}>{r == null ? "…" : fmtR(r)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Descarga de la app para Android (lleva a la página con los pasos de instalación). */
export function HomeApp() {
  return (
    <section aria-label={t("App para Android")} className="glass flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
      <div className="min-w-0">
        <h2 className="font-display text-xl font-bold tracking-wide text-snow">{t("📱 Descargá la app para Android")}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fog">{t("Señales, diario y bot en tu celular, con avisos de cada target. Se instala encima de la anterior sin perder nada.")}</p>
      </div>
      <a href="/app" className="shrink-0 rounded-md bg-gold px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110">
        {t("Descargar")}
      </a>
    </section>
  );
}

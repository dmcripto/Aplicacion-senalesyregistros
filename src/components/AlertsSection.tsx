import { useState } from "react";
import { ALERT_TFS, MAX_ACTIVE_ALERTS, checkAlertDraft, cx, fmtPrice, t } from "../lib";
import type { AlertKind, AlertSide, AlertTf, UserAlert } from "../lib";
import { createAlert, deleteAlert, setAlertActive } from "../tradesApi";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

export function describeAlert(a: Pick<UserAlert, "kind" | "tf" | "dir" | "level" | "period">): string {
  const up = a.dir === "above";
  if (a.kind === "price") return up ? t("El precio cruza por encima de {n}", { n: fmtPrice(a.level ?? 0) }) : t("El precio cruza por debajo de {n}", { n: fmtPrice(a.level ?? 0) });
  if (a.kind === "rsi") return up ? t("El RSI {p} ({tf}) cruza por encima de {n}", { p: a.period ?? 0, tf: a.tf, n: a.level ?? 0 }) : t("El RSI {p} ({tf}) cruza por debajo de {n}", { p: a.period ?? 0, tf: a.tf, n: a.level ?? 0 });
  return up ? t("El precio cierra por encima de la EMA {p} ({tf})", { p: a.period ?? 0, tf: a.tf }) : t("El precio cierra por debajo de la EMA {p} ({tf})", { p: a.period ?? 0, tf: a.tf });
}

const kindName = (k: AlertKind) => ({ price: t("Precio"), rsi: t("RSI"), ema: t("Cierre vs EMA") })[k];
const field = "rounded-md border border-line bg-ink px-2.5 py-1.5 text-[12.5px] text-snow outline-none focus:border-gold";

/** Alertas propias: «avisame cuando el precio / el RSI / la EMA cruce tal nivel». El servidor las revisa cada minuto y avisa por la app y por Telegram. */
export default function AlertsSection({
  userId,
  symbol,
  tf: chartTf,
  lastPrice,
  alerts,
  reload,
  notify,
}: {
  userId: string;
  symbol: string;
  tf: AlertTf;
  lastPrice: number | null;
  alerts: UserAlert[];
  reload: () => void;
  notify: Notify;
}) {
  const [kind, setKind] = useState<AlertKind>("price");
  const [dir, setDir] = useState<AlertSide>("above");
  const [level, setLevel] = useState("");
  const [period, setPeriod] = useState("14");
  const [tf, setTf] = useState<AlertTf>(chartTf);
  const [once, setOnce] = useState(true);
  const [busy, setBusy] = useState(false);
  const active = alerts.filter((a) => a.active).length;

  const num = (v: string) => Number(v.trim().replace(",", "."));
  const draft = { symbol, kind, tf, dir, level: kind === "ema" ? null : num(level), period: kind === "price" ? null : num(period), once };
  const check = checkAlertDraft(draft);

  const create = async () => {
    if (!check.ok) return notify(check.error === "level" ? (kind === "rsi" ? t("El nivel del RSI tiene que estar entre 1 y 99.") : t("Poné un precio mayor a 0.")) : t("Revisá el período."), "err");
    setBusy(true);
    try {
      await createAlert(userId, draft);
      notify(t("Alerta creada: te aviso por la app y por Telegram."), "ok");
      setLevel("");
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("No se pudo crear la alerta."), "err");
    } finally {
      setBusy(false);
    }
  };
  const run = async (f: () => Promise<void>) => {
    try {
      await f();
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("No se pudo guardar el cambio."), "err");
    }
  };

  const lvlPlaceholder = kind === "price" ? (lastPrice ? fmtPrice(lastPrice) : "100000") : kind === "rsi" ? "30" : "";

  return (
    <div className="space-y-3 rounded-lg border border-line bg-ink/30 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-fog">🔔 {t("Mis alertas")}</h3>
        <span className="num text-[11px] text-dim">
          {active}/{MAX_ACTIVE_ALERTS} {t("activas")}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[auto_auto_auto_auto_1fr] sm:items-center">
        <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} className={field} aria-label={t("Tipo de alerta")}>
          {(["price", "rsi", "ema"] as const).map((k) => (
            <option key={k} value={k}>
              {kindName(k)}
            </option>
          ))}
        </select>
        <select value={dir} onChange={(e) => setDir(e.target.value as AlertSide)} className={field} aria-label={t("Dirección")}>
          <option value="above">{kind === "ema" ? t("Cierra por encima") : t("Cruza por encima")}</option>
          <option value="below">{kind === "ema" ? t("Cierra por debajo") : t("Cruza por debajo")}</option>
        </select>
        {kind !== "ema" ? (
          <input value={level} onChange={(e) => setLevel(e.target.value)} inputMode="decimal" placeholder={lvlPlaceholder} className={cx(field, "num w-full sm:w-28")} aria-label={kind === "price" ? t("Precio") : t("Nivel del RSI")} />
        ) : (
          <span className="hidden sm:block" />
        )}
        {kind !== "price" ? (
          <div className="flex items-center gap-2">
            <input type="number" min={2} max={kind === "rsi" ? 100 : 200} value={period} onChange={(e) => setPeriod(e.target.value)} className={cx(field, "num w-20")} aria-label={t("Período")} />
            <select value={tf} onChange={(e) => setTf(e.target.value as AlertTf)} className={field} aria-label={t("Temporalidad")}>
              {ALERT_TFS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="hidden sm:block" />
        )}
        <button
          type="button"
          disabled={busy || !check.ok}
          onClick={create}
          className="rounded-md border border-gold/50 bg-gold/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40 sm:justify-self-start"
        >
          {t("Crear alerta")}
        </button>
      </div>
      <label className="flex items-center gap-2 text-[11.5px] text-dim">
        <input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />
        {t("Avisarme una sola vez")} <span className="text-dim/70">· {symbol}</span>
      </label>

      {alerts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-3 text-[12px] leading-relaxed text-dim">
          {t("Todavía no tenés alertas. Creá una y te aviso por la app y por Telegram cuando se cumpla, aunque tengas VELTRIX cerrado.")}
        </p>
      ) : (
        <ul className="divide-y divide-line/60">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className={cx("h-2 w-2 shrink-0 rounded-full", a.active ? "bg-bull" : a.triggerCount > 0 ? "bg-gold" : "bg-dim")} aria-hidden />
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-snow">
                <b className="num">{a.symbol}</b> · {describeAlert(a)}
                <span className="num block text-[10.5px] text-dim">
                  {a.active ? (a.once ? t("Activa · una sola vez") : t("Activa · cada vez que cruce")) : a.triggerCount > 0 ? t("Ya avisó") : t("En pausa")}
                  {a.triggerCount > 0 && a.triggeredAt ? ` · ${new Date(a.triggeredAt).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                </span>
              </span>
              <span className="flex gap-1.5">
                <button type="button" onClick={() => run(() => setAlertActive(a.id, !a.active))} className="rounded-md border border-line px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-fog hover:border-line2 hover:text-snow">
                  {a.active ? t("Pausar") : t("Activar")}
                </button>
                <button type="button" onClick={() => run(() => deleteAlert(a.id))} className="rounded-md border border-line px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-dim hover:border-bear/50 hover:text-bear">
                  {t("Borrar")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10.5px] leading-relaxed text-dim">{t("Una alerta salta cuando el valor cruza el nivel, no mientras se queda de un lado. El RSI y la EMA se miden con la vela ya cerrada. Se revisan cada minuto.")}</p>
    </div>
  );
}

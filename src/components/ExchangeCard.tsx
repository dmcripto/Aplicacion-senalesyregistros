import { useCallback, useEffect, useState } from "react";
import { EXCHANGE_LIST, cx, exchangeName, exchangeSteps, fmtDateTime, rValueMoney, t } from "../lib";
import type { ExchangeConnection, ExchangeId, MoneySettings } from "../lib";
import { connectExchange, disconnectExchange, fetchConnections, syncExchanges } from "../tradesApi";
import Panel from "./Panel";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

const STALE_MS = 5 * 60_000; // se sincroniza sola al abrir si pasaron más de 5 minutos

const label = "mb-1 block text-[9.5px] font-bold uppercase tracking-[0.14em] text-fog";

function Guide({ exchange }: { exchange: ExchangeId }) {
  const steps = exchangeSteps(exchange);
  return (
    <ol className="list-decimal space-y-1 pl-5 text-[11.5px] leading-relaxed text-fog">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

export default function ExchangeCard({ money, notify }: { money: MoneySettings; notify: Notify }) {
  const [conns, setConns] = useState<ExchangeConnection[] | null>(null);
  const [exchange, setExchange] = useState<ExchangeId>("binance");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  const unit = rValueMoney(money);

  const reload = useCallback(async () => {
    try {
      setConns(await fetchConnections());
    } catch {
      setConns([]); // la tabla puede no existir todavía: la tarjeta queda lista para conectar
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Sincronización automática al abrir la app.
  useEffect(() => {
    if (!conns?.length || unit == null) return;
    const stale = conns.some((c) => !c.lastSyncAt || Date.now() - new Date(c.lastSyncAt).getTime() > STALE_MS);
    if (stale) syncExchanges().then(reload).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conns === null, unit == null]);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);

  const connect = async () => {
    setBusy(true);
    try {
      const r = await connectExchange(exchange, apiKey.trim(), apiSecret.trim());
      if (!r.ok) {
        notify(r.error ?? t("No se pudo conectar."), "err");
        return;
      }
      setApiKey("");
      setApiSecret("");
      notify(t("{name} conectado. Operaciones importadas: {n}.", { name: exchangeName(exchange), n: r.imported ?? 0 }));
      if (r.warning) notify(r.warning, "info");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await syncExchanges();
      if (!r.ok) return notify(r.error ?? t("No se pudo sincronizar."), "err");
      const total = (r.results ?? []).reduce((a, x) => a + x.imported, 0);
      const failed = (r.results ?? []).find((x) => x.error);
      if (failed?.error) notify(failed.error, "err");
      else notify(total ? t("Sincronizado: {n} operaciones nuevas.", { n: total }) : t("Todo al día: no hay operaciones nuevas."), "info");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (c: ExchangeConnection) => {
    setArmed(null);
    try {
      await disconnectExchange(c.id);
      notify(t("{name} desconectado. Se borró la clave guardada.", { name: exchangeName(c.exchange) }), "info");
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudo desconectar."), "err");
    }
  };

  const canConnect = unit != null && apiKey.trim().length >= 8 && apiSecret.trim().length >= 8 && !busy;

  return (
    <Panel
      id="exchange"
      title={t("CONECTAR EXCHANGE")}
      subtitle={t("Tu diario se llena solo desde tu exchange · solo lectura")}
      summary={conns?.length ? `${conns.map((c) => exchangeName(c.exchange)).join(", ")} · ${t("Conectado")}` : t("Sin conectar")}
      defaultOpen={false}
    >

      <div className="space-y-3 p-5">
        {conns?.length ? (
          <ul className="space-y-2">
            {conns.map((c) => (
              <li key={c.id} className="rounded-md border border-line bg-ink/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-snow">
                    {exchangeName(c.exchange)} <span className="num text-[11px] font-normal text-dim">••••{c.keyHint}</span>
                  </span>
                  <span className={cx("text-[10px] font-bold uppercase tracking-wider", c.status === "active" ? "text-bull" : "text-bear")}>
                    {c.status === "active" ? t("Conectado") : t("Con error")}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-fog">
                  {c.lastSyncAt
                    ? t("Última sincronización: {when} · {n} nuevas", { when: fmtDateTime(c.lastSyncAt), n: c.lastImportCount })
                    : t("Todavía sin sincronizar")}
                </p>
                {c.status === "active" && <p className="mt-0.5 text-[11px] text-dim">{t("Se actualiza sola cada ~10 minutos, aunque no abras la app.")}</p>}
                {c.status === "error" && c.lastError && <p className="mt-1 text-[11px] text-bear">{c.lastError}</p>}
                <div className="mt-2 flex justify-end">
                  {armed === c.id ? (
                    <button onClick={() => disconnect(c)} className="rounded border border-bear bg-bear/15 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-bear">
                      {t("Confirmar: borrar la clave")}
                    </button>
                  ) : (
                    <button onClick={() => setArmed(c.id)} className="rounded border border-line px-2.5 py-1 text-[10.5px] font-semibold text-dim hover:border-bear/50 hover:text-bear">
                      {t("Desconectar")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] leading-relaxed text-fog">
            {t("Conectá tu exchange (Binance, Bybit, Bitunix o MEXC) con una clave de solo lectura y VELTRIX trae tus operaciones cerradas al diario, sin copiarlas a mano.")}
          </p>
        )}

        {!!conns?.length && (
          <button
            onClick={syncNow}
            disabled={busy || unit == null}
            className="w-full rounded-md border border-gold/45 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10 disabled:opacity-40"
          >
            {busy ? t("Un momento…") : t("Sincronizar ahora")}
          </button>
        )}

        <>
          <div className="space-y-3 border-t border-line pt-4">
            {unit == null && (
              <p className="rounded-md border border-gold/40 bg-golddeep/30 px-3 py-2 text-[11.5px] leading-relaxed text-gold">
                {t("Antes cargá tu capital y el % de riesgo en \"Capital y dinero\": se usan para convertir tus resultados a R.")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {EXCHANGE_LIST.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setExchange(e.id)}
                  className={cx(
                    "min-w-[72px] flex-1 rounded-md border px-3 py-2 text-[12px] font-bold transition-colors",
                    exchange === e.id ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow",
                  )}
                >
                  {e.name}
                </button>
              ))}
            </div>

            <details className="rounded-md border border-line bg-ink/40 text-[11.5px]">
              <summary className="cursor-pointer select-none px-3 py-2.5 font-bold uppercase tracking-[0.12em] text-gold">
                {t("Cómo crear la clave (solo lectura)")}
              </summary>
              <div className="border-t border-line px-3 py-3">
                <Guide exchange={exchange} />
              </div>
            </details>

            <label className="block">
              <span className={label}>API Key</span>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} className="field num" />
            </label>
            <label className="block">
              <span className={label}>{t("Clave secreta (Secret)")}</span>
              <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="new-password" spellCheck={false} className="field num" />
            </label>
            <button
              onClick={connect}
              disabled={!canConnect}
              className="w-full rounded-md bg-gold px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 disabled:opacity-40"
            >
              {busy ? t("Verificando…") : t("Conectar {name}", { name: exchangeName(exchange) })}
            </button>
            <p className="text-[10.5px] leading-relaxed text-dim">
              {t("Tu clave secreta se guarda cifrada en el servidor y no se vuelve a mostrar. VELTRIX solo lee: rechaza claves que permitan operar o retirar. Las operaciones se importan con tu 1R (capital × riesgo %) y quedan marcadas con el exchange de origen.")}
            </p>
          </div>
        </>
      </div>
    </Panel>
  );
}

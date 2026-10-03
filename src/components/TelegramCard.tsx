import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDateTime, t } from "../lib";
import type { TelegramCommunity, TelegramLink } from "../lib";
import Panel from "./Panel";
import { fetchCommunities, fetchDailySummary, fetchTelegramLink, fetchWhatsappButton, removeCommunity, setDailySummary, setWhatsappButton, startCommunityLink, startTelegramLink, unlinkTelegram } from "../tradesApi";
import type { CommunityStart, TelegramStart } from "../tradesApi";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

const POLL_MS = 3000;
const POLL_MAX_MS = 10 * 60_000; // el código dura 10 minutos

export default function TelegramCard({ userId, notify }: { userId: string; notify: Notify }) {
  const [link, setLink] = useState<TelegramLink | null | undefined>(undefined);
  const [start, setStart] = useState<TelegramStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [daily, setDaily] = useState(true);
  const [wa, setWa] = useState(false);
  const [communities, setCommunities] = useState<TelegramCommunity[]>([]);
  const [cStart, setCStart] = useState<CommunityStart | null>(null);
  const [cBusy, setCBusy] = useState(false);
  const cTimer = useRef<number | null>(null);

  const stopCommunityPolling = useCallback(() => {
    if (cTimer.current != null) window.clearInterval(cTimer.current);
    cTimer.current = null;
  }, []);
  const timer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  const reload = useCallback(async () => setLink(await fetchTelegramLink()), []);

  useEffect(() => {
    void reload();
    fetchDailySummary(userId).then(setDaily).catch(() => {});
    fetchWhatsappButton(userId).then(setWa).catch(() => {});
    void fetchCommunities().then(setCommunities);
    return () => {
      stopPolling();
      stopCommunityPolling();
    };
  }, [reload, stopPolling, stopCommunityPolling, userId]);

  const connectCommunity = async () => {
    setCBusy(true);
    try {
      const r = await startCommunityLink();
      if (!r.ok || !r.code) return notify(r.error ?? t("No se pudo conectar."), "err");
      setCStart(r);
      stopCommunityPolling();
      const startedAt = Date.now();
      const before = communities.length;
      cTimer.current = window.setInterval(async () => {
        const list = await fetchCommunities();
        if (list.length > before) {
          stopCommunityPolling();
          setCommunities(list);
          setCStart(null);
          notify(t("Comunidad conectada."));
        } else if (Date.now() - startedAt > POLL_MAX_MS) {
          stopCommunityPolling();
          setCStart(null);
        }
      }, POLL_MS);
    } finally {
      setCBusy(false);
    }
  };

  const dropCommunity = async (id: string) => {
    try {
      await removeCommunity(id);
      setCommunities((l) => l.filter((c) => c.id !== id));
      notify(t("Comunidad desconectada."), "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudo desconectar."), "err");
    }
  };

  const copyCommand = async () => {
    if (!cStart?.command) return;
    try {
      await navigator.clipboard.writeText(cStart.command);
      notify(t("Comando copiado."));
    } catch {
      notify(t("No se pudo copiar automáticamente — seleccioná el texto a mano."), "err");
    }
  };

  const toggleDaily = async () => {
    const next = !daily;
    setDaily(next);
    try {
      await setDailySummary(userId, next);
      notify(next ? t("Resumen diario activado.") : t("Resumen diario desactivado."));
    } catch (err) {
      setDaily(!next);
      notify(err instanceof Error ? err.message : t("No se pudo guardar el cambio."), "err");
    }
  };

  const toggleWa = async () => {
    const next = !wa;
    setWa(next);
    try {
      await setWhatsappButton(userId, next);
      notify(next ? t("Botón de WhatsApp activado.") : t("Botón de WhatsApp desactivado."));
    } catch (err) {
      setWa(!next);
      notify(err instanceof Error ? err.message : t("No se pudo guardar el cambio."), "err");
    }
  };

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);

  // Espera a que el usuario toque «Iniciar» en Telegram.
  const waitForLink = () => {
    stopPolling();
    const startedAt = Date.now();
    timer.current = window.setInterval(async () => {
      const l = await fetchTelegramLink();
      if (l) {
        stopPolling();
        setLink(l);
        setStart(null);
        notify(t("Telegram conectado."));
      } else if (Date.now() - startedAt > POLL_MAX_MS) {
        stopPolling();
        setStart(null);
      }
    }, POLL_MS);
  };

  const connect = async () => {
    setBusy(true);
    try {
      const r = await startTelegramLink();
      if (!r.ok || !r.url) return notify(r.error ?? t("No se pudo conectar."), "err");
      setStart(r);
      window.open(r.url, "_blank", "noopener");
      waitForLink();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setArmed(false);
    try {
      await unlinkTelegram(userId);
      setLink(null);
      notify(t("Telegram desconectado."), "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : t("No se pudo desconectar."), "err");
    }
  };

  return (
    <Panel
      id="telegram"
      title={t("BOT DE TELEGRAM")}
      subtitle={t("Registrá señales y recibí avisos sin abrir la app")}
      summary={link ? `${link.username ? `@${link.username}` : t("Chat conectado")} · ${t("Conectado")}` : t("Sin conectar")}
      defaultOpen={false}
    >
      <div className="space-y-3 p-5">
        {link === undefined ? null : link ? (
          <>
            <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-ink/40 p-3">
              <span className="text-[13px] font-bold text-snow">
                {link.username ? `@${link.username}` : t("Chat conectado")}
                <span className="ml-2 text-[11px] font-normal text-dim">{fmtDateTime(link.linkedAt)}</span>
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-bull">{t("Conectado")}</span>
            </div>
            <ul className="space-y-1 text-[11.5px] leading-relaxed text-fog">
              <li>{t("• Pegá o reenviá una señal al bot y confirmá con un toque.")}</li>
              <li>{t("• Te avisa cuando llega una alerta o se toca un TP/SL.")}</li>
              <li>{t("• Comandos: /abiertas, /resumen, /whatsapp, /idioma, /desvincular.")}</li>
            </ul>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-ink/40 p-3 text-[12px] leading-snug text-fog">
              <input type="checkbox" checked={daily} onChange={toggleDaily} className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" />
              <span>
                <b className="text-snow">{t("Resumen diario:")}</b>{" "}
                {t("cada noche a las 21:00 te mandamos cómo te fue en el día, con tus rachas. Si no operaste, no te molestamos.")}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-ink/40 p-3 text-[12px] leading-snug text-fog">
              <input type="checkbox" checked={wa} onChange={toggleWa} className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" />
              <span>
                <b className="text-snow">{t("Botón de WhatsApp:")}</b>{" "}
                {t("cada aviso del bot trae un botón «Enviar a WhatsApp». Lo tocás y se abre WhatsApp con el mensaje armado para elegir a quién mandarlo.")}
              </span>
            </label>
            <div className="space-y-2 rounded-md border border-line bg-ink/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-dim">{t("Tu comunidad")}</p>
              {communities.length === 0 && !cStart && (
                <p className="text-[11.5px] leading-relaxed text-fog">
                  {t("Conectá un grupo o canal de Telegram y el bot publica ahí tus señales y cuando toquen TP o SL, sin mostrar tu dinero.")}
                </p>
              )}
              {communities.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate font-bold text-snow">
                    {c.title ?? t("Comunidad")} <span className="text-[10px] font-semibold uppercase tracking-wider text-bull">{t("Publicando")}</span>
                  </span>
                  <button onClick={() => dropCommunity(c.id)} className="shrink-0 rounded border border-line px-2 py-1 text-[10.5px] font-semibold text-dim hover:border-bear/50 hover:text-bear">
                    {t("Desconectar")}
                  </button>
                </div>
              ))}
              {cStart ? (
                <ol className="list-decimal space-y-2 pl-4 text-[11.5px] leading-relaxed text-fog">
                  <li>
                    {t("Agregá el bot a tu")}{" "}
                    <a href={cStart.addToGroupUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-cyan underline">{t("grupo")}</a> {t("o")}{" "}
                    <a href={cStart.addToChannelUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-cyan underline">{t("canal")}</a>.
                  </li>
                  <li>
                    {t("Escribí este mensaje en ese grupo o canal (tenés que ser administrador):")}
                    <button onClick={copyCommand} className="mt-1 block w-full rounded border border-gold/40 bg-golddeep/30 px-2 py-1.5 text-left font-mono text-[12px] font-bold text-gold">
                      {cStart.command} <span className="float-right text-[10px] font-semibold uppercase">{t("Copiar")}</span>
                    </button>
                  </li>
                  <li>{t("Esto se completa solo en unos segundos. El código dura 10 minutos.")}</li>
                </ol>
              ) : (
                <button
                  onClick={connectCommunity}
                  disabled={cBusy}
                  className="w-full rounded-md border border-gold/45 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
                >
                  {cBusy ? t("Un momento…") : communities.length ? t("Conectar otra comunidad") : t("Conectar comunidad")}
                </button>
              )}
            </div>
            {armed ? (
              <button onClick={disconnect} className="w-full rounded-md border border-bear bg-bear/15 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-bear">
                {t("Confirmar: desconectar Telegram")}
              </button>
            ) : (
              <button onClick={() => setArmed(true)} className="w-full rounded-md border border-line px-3 py-2 text-[11px] font-semibold text-dim hover:border-line2 hover:text-fog">
                {t("Desconectar")}
              </button>
            )}
          </>
        ) : (
          <>
            <p className="text-[12px] leading-relaxed text-fog">
              {t("Conectá tu Telegram y podés pegar o reenviar señales al bot de VELTRIX para registrarlas, y recibir un aviso en el chat cuando llega una alerta o se toca un TP/SL.")}
            </p>
            {start ? (
              <div className="space-y-2 rounded-md border border-gold/40 bg-golddeep/30 p-3 text-[11.5px] leading-relaxed text-gold">
                <p>{t("Se abrió Telegram: tocá «Iniciar» en el chat del bot. Esto se completa solo.")}</p>
                <a href={start.url} target="_blank" rel="noopener noreferrer" className="block font-bold underline">
                  {t("Abrir Telegram de nuevo")}
                </a>
                <p className="text-fog">
                  {t("Si no se abre, buscá")} <b className="text-snow">@{start.botUsername}</b> {t("y enviale")} <b className="num text-snow">/start {start.code}</b>
                </p>
              </div>
            ) : (
              <button
                onClick={connect}
                disabled={busy}
                className="w-full rounded-md bg-gold px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 disabled:opacity-50"
              >
                {busy ? t("Un momento…") : t("Conectar Telegram")}
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

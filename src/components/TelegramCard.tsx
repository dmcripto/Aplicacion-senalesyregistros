import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDateTime, t } from "../lib";
import type { TelegramLink } from "../lib";
import Panel from "./Panel";
import { fetchTelegramLink, startTelegramLink, unlinkTelegram } from "../tradesApi";
import type { TelegramStart } from "../tradesApi";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

const POLL_MS = 3000;
const POLL_MAX_MS = 10 * 60_000; // el código dura 10 minutos

export default function TelegramCard({ userId, notify }: { userId: string; notify: Notify }) {
  const [link, setLink] = useState<TelegramLink | null | undefined>(undefined);
  const [start, setStart] = useState<TelegramStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  const reload = useCallback(async () => setLink(await fetchTelegramLink()), []);

  useEffect(() => {
    void reload();
    return stopPolling;
  }, [reload, stopPolling]);

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
              <li>{t("• Comandos: /abiertas, /resumen, /idioma, /desvincular.")}</li>
            </ul>
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

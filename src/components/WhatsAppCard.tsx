import { useEffect, useState } from "react";
import { t } from "../lib";
import type { WhatsAppState } from "../lib";
import Panel from "./Panel";
import { Reveal } from "../ui";
import {
  fetchWhatsApp,
  startWhatsApp,
  toggleWhatsApp,
  unlinkWhatsApp,
  verifyWhatsApp,
} from "../tradesApi";

type Notify = (msg: string, kind?: "ok" | "err" | "info") => void;

/**
 * Señales automáticas por WhatsApp. La persona escribe su número, recibe un código por WhatsApp y lo confirma.
 * Mientras el servidor no tenga la conexión con Meta, la tarjeta no se muestra.
 */
export default function WhatsAppCard({ notify }: { notify: Notify }) {
  const [state, setState] = useState<WhatsAppState | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    fetchWhatsApp().then(setState);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!state?.configured) return null;
  const link = state.link;

  const send = async () => {
    setBusy(true);
    try {
      const r = await startWhatsApp(phone);
      if (!r.ok)
        return notify(r.error ?? t("No se pudo enviar el código."), "err");
      setSent(true);
      setCode("");
      notify(t("Te mandamos un código por WhatsApp."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const r = await verifyWhatsApp(code);
      if (!r.ok || !r.link)
        return notify(r.error ?? t("No se pudo confirmar el código."), "err");
      setState({ configured: true, link: r.link });
      setSent(false);
      setPhone("");
      setCode("");
      setAccept(false);
      notify(t("WhatsApp conectado. Las señales te van a llegar solas."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!link) return;
    const next = !link.enabled;
    setState({ configured: true, link: { ...link, enabled: next } });
    const r = await toggleWhatsApp(next);
    if (!r.ok) {
      setState({ configured: true, link });
      return notify(r.error ?? t("No se pudo guardar el cambio."), "err");
    }
    notify(
      next
        ? t("Avisos por WhatsApp activados.")
        : t("Avisos por WhatsApp pausados."),
    );
  };

  const unlink = async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    const r = await unlinkWhatsApp();
    if (!r.ok) return notify(r.error ?? t("No se pudo desconectar."), "err");
    setState({ configured: true, link: null });
    notify(t("WhatsApp desconectado."), "info");
  };

  return (
    <Reveal delay={156}>
      <Panel
        id="whatsapp"
        title={t("SEÑALES POR WHATSAPP")}
        subtitle={t("Recibí cada señal y cada TP o SL en tu WhatsApp, solo")}
        summary={
          link
            ? `${link.phone} · ${link.enabled ? t("Activo") : t("Pausado")}`
            : t("Sin conectar")
        }
        defaultOpen={false}
      >
        <div className="space-y-3 p-5">
          {link ? (
            <>
              <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-ink/60 px-3 py-2.5">
                <span className="num text-[13px] font-bold text-snow">
                  {link.phone}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${link.enabled ? "text-bull" : "text-dim"}`}
                >
                  {link.enabled ? t("Conectado") : t("Pausado")}
                </span>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-ink/40 p-3 text-[12px] leading-snug text-fog">
                <input
                  type="checkbox"
                  checked={link.enabled}
                  onChange={toggle}
                  className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
                />
                <span>
                  <b className="text-snow">
                    {t("Recibir avisos por WhatsApp:")}
                  </b>{" "}
                  {t(
                    "cada señal que llegue a tu cuenta y cada vez que se toque un TP o un SL. Para pausar desde WhatsApp, respondé BAJA.",
                  )}
                </span>
              </label>
              <button
                onClick={unlink}
                className={`w-full rounded-md border px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  armed
                    ? "border-bear bg-bear/15 text-bear hover:bg-bear/30"
                    : "border-line text-dim hover:border-line2 hover:text-fog"
                }`}
              >
                {armed
                  ? t("Confirmar: desconectar este número")
                  : t("Desconectar WhatsApp")}
              </button>
            </>
          ) : !sent ? (
            <>
              <p className="text-[12px] leading-relaxed text-fog">
                {t(
                  "Escribí tu número de WhatsApp con el código de país. Te mandamos un código para confirmar que es tuyo; después las señales te llegan solas.",
                )}
              </p>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+54 9 11 5555 5555"
                className="field num text-[13px]"
              />
              <label className="flex cursor-pointer items-start gap-2.5 text-[11.5px] leading-snug text-fog">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(e) => setAccept(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-gold)]"
                />
                <span>
                  {t(
                    "Acepto recibir avisos de VELTRIX por WhatsApp en este número. Puedo pausarlos cuando quiera respondiendo BAJA.",
                  )}
                </span>
              </label>
              <button
                onClick={send}
                disabled={
                  busy || !accept || phone.replace(/\D/g, "").length < 8
                }
                className="w-full rounded-md border border-gold/45 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? t("Un momento…") : t("Enviarme el código")}
              </button>
            </>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-fog">
                {t(
                  "Te mandamos un código de 6 números a tu WhatsApp. Escribilo acá (dura 10 minutos).",
                )}
              </p>
              <input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="field num text-center text-xl tracking-[0.4em]"
              />
              <button
                onClick={verify}
                disabled={busy || code.length !== 6}
                className="w-full rounded-md bg-gold px-3 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? t("Un momento…") : t("Confirmar")}
              </button>
              <button
                onClick={() => {
                  setSent(false);
                  setCode("");
                }}
                className="w-full rounded-md border border-line px-3 py-2 text-[11px] font-semibold text-dim transition-colors hover:border-line2 hover:text-fog"
              >
                {t("Cambiar el número")}
              </button>
            </>
          )}
        </div>
      </Panel>
    </Reveal>
  );
}

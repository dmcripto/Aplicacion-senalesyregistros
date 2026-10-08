import { useEffect, useState } from "react";
import { IconTile } from "../icons";
import type { IconName, Tone } from "../icons";
import { Reveal } from "../ui";
import { t } from "../lib";

/** Cómo funciona, en tres pasos. */
export function HowItWorks() {
  const steps: Array<[IconName, Tone, string, string]> = [
    ["link", "cyan", t("Conectá"), t("Copiá tu enlace personal en la alerta de TradingView, o pegá cualquier señal de Telegram, WhatsApp o Discord.")],
    ["bell", "green", t("Recibí"), t("Cada señal y cada target te llega a la app y a Telegram, con una tarjeta lista para compartir.")],
    ["trend", "violet", t("Mejorá"), t("Tu diario calcula R, acierto y racha solo, y el análisis te muestra qué corregir.")],
  ];
  return (
    <section id="como" className="scroll-mt-6 border-t border-line/60 pt-10 lg:pt-14">
      <h2 className="mb-6 text-center text-[11px] font-bold uppercase tracking-[0.22em] text-fog">{t("Cómo funciona")}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map(([icon, tone, title, text], i) => (
          <Reveal key={title} delay={i * 90}>
            <div className="lift relative h-full rounded-xl border border-line bg-panel/80 p-5">
              <span className="num absolute right-4 top-3 text-[44px] font-extrabold leading-none text-line2/50">{i + 1}</span>
              <IconTile name={icon} tone={tone} size="lg" />
              <h3 className="mt-3 font-display text-[18px] font-bold text-snow">{title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-fog">{text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/** Tres datos que dan confianza, en una fila. */
export function TrustRow() {
  const items: Array<[IconName, Tone, string]> = [
    ["shield", "green", t("Claves de exchange solo de lectura")],
    ["radio", "cyan", t("Avisos en la app y en Telegram")],
    ["candles", "amber", t("Web y Android con la misma cuenta")],
  ];
  return (
    <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-3 lg:justify-start">
      {items.map(([icon, tone, label]) => (
        <li key={label} className="flex items-center gap-2 text-[12.5px] font-semibold text-fog">
          <IconTile name={icon} tone={tone} size="sm" />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Preguntas que frenan a quien recién llega. */
export function Faq() {
  const qa: Array<[string, string]> = [
    [t("¿Necesito TradingView?"), t("No es obligatorio. Podés conectar tus alertas de TradingView, pegar señales de Telegram, WhatsApp o Discord, e importar desde tu exchange.")],
    [t("¿VELTRIX opera con mi dinero?"), t("No. Para importar tu historial usás claves de solo lectura, sin permiso de retiro.")],
    [t("¿Es asesoramiento financiero?"), t("No. Es una herramienta para registrar y analizar tus operaciones. Operar implica riesgo de pérdida.")],
    [t("¿Dónde la uso?"), t("En la web y en la app de Android con la misma cuenta. Los avisos también llegan por Telegram.")],
  ];
  return (
    <section className="border-t border-line/60 pt-10 lg:pt-14">
      <h2 className="mb-6 text-center text-[11px] font-bold uppercase tracking-[0.22em] text-fog">{t("Preguntas frecuentes")}</h2>
      <div className="mx-auto grid max-w-4xl gap-3 md:grid-cols-2">
        {qa.map(([q, a]) => (
          <details key={q} className="group rounded-lg border border-line bg-panel/80 px-4 py-3 open:border-cyan/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13.5px] font-bold text-snow">
              {q}
              <span className="text-gold transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-2 text-[12.5px] leading-relaxed text-fog">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const shareText = () => t("Mirá VELTRIX: recibí las señales de TradingView en el celular, con avisos por cada target, diario automático y estadísticas.");

/** Botones para compartir VELTRIX. El enlace lleva una etiqueta para contar cuántas visitas llegan por acá. */
export function ShareBand() {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/?ref=compartir&v=2`;
  const enc = encodeURIComponent;
  const text = shareText();
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt(t("Copiá el enlace:"), link);
    }
  };
  const btn = "flex items-center justify-center gap-2 rounded-md border border-line bg-ink/60 px-4 py-2.5 text-[12.5px] font-bold text-snow transition-colors hover:border-gold/60 hover:text-gold";
  return (
    <section className="rounded-2xl border border-cyan/25 bg-gradient-to-br from-[#0f2a35] via-panel to-[#0d1d33] p-6 text-center sm:p-8">
      <h2 className="font-display text-2xl font-bold text-snow">{t("¿Conocés a alguien que opera?")}</h2>
      <p className="mx-auto mt-2 max-w-xl text-[13.5px] leading-relaxed text-fog">{t("Compartile VELTRIX: más gente en la comunidad, más señales y más análisis para todos.")}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        <a className={btn} href={`https://wa.me/?text=${enc(`${text} ${link}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a className={btn} href={`https://t.me/share/url?url=${enc(link)}&text=${enc(text)}`} target="_blank" rel="noopener noreferrer">Telegram</a>
        <a className={btn} href={`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(link)}`} target="_blank" rel="noopener noreferrer">X</a>
        <button type="button" onClick={copy} className={btn}>{copied ? t("¡Enlace copiado!") : t("Copiar enlace")}</button>
        {canShare && (
          <button type="button" onClick={() => void navigator.share({ title: "VELTRIX", text, url: link }).catch(() => {})} className={btn}>
            {t("Compartir…")}
          </button>
        )}
      </div>
    </section>
  );
}

/** Cierre con el botón principal, por si la persona llegó hasta abajo convencida. */
export function FinalCta({ onSignup }: { onSignup: () => void }) {
  return (
    <section className="rounded-2xl border border-gold/30 bg-gradient-to-r from-golddeep/50 via-panel to-bulldeep/40 px-6 py-10 text-center">
      <h2 className="font-display text-3xl font-extrabold text-snow">{t("Empezá a seguir tus operaciones con datos reales")}</h2>
      <p className="mx-auto mt-2 max-w-lg text-[14px] text-fog">{t("Creá tu cuenta y conectá tu primera alerta en minutos.")}</p>
      <button type="button" onClick={onSignup} className="btn-shine mt-6 rounded-md bg-gold px-8 py-3 text-[14px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.98]">
        {t("Crear mi cuenta")}
      </button>
    </section>
  );
}

/** Barra fija abajo en el celular: aparece cuando el formulario quedó arriba, fuera de la pantalla. */
export function StickyCta({ onSignup }: { onSignup: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = document.getElementById("acceso");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur lg:hidden">
      <button type="button" onClick={onSignup} className="btn-shine w-full rounded-md bg-gold px-4 py-3 text-[13px] font-bold uppercase tracking-wider text-ink active:scale-[0.98]">
        {t("Crear mi cuenta")}
      </button>
    </div>
  );
}

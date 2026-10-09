import { t } from "../lib";

const APK = "https://github.com/dmcripto/Aplicacion-senalesyregistros/releases/download/android-v1.4.0-7/VELTRIX.apk";

/** Pantalla «Descargar la app»: botón de descarga para Android y los pasos para instalarla. */
export default function DownloadApp() {
  const steps = [
    t("Tocá el botón desde tu celular Android: la descarga empieza sola. Si Chrome avisa que el archivo puede ser dañino, tocá «Descargar de todos modos» (es el aviso de siempre con las apps que se instalan por fuera de Google Play)."),
    t("Abrí el archivo descargado y tocá «Instalar». Si Android lo pide, permití instalar apps de esta fuente."),
    t("Abrí VELTRIX e ingresá con el mismo email y contraseña que usás acá: tu diario es el mismo."),
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="glass glow-card rounded-xl p-6">
        <h2 className="font-display text-2xl font-bold tracking-wide text-snow">{t("VELTRIX para Android")}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fog">{t("Recibí las señales en tu celular, seguí cada operación al instante y mejorá con datos reales. Si ya tenés la app, instalala encima: no perdés nada.")}</p>
        <a href={APK} className="btn-shine mt-5 inline-block rounded-md bg-gold px-7 py-3 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110">
          {t("Descargar para Android")}
        </a>
        <p className="mt-3 text-[11.5px] leading-relaxed text-dim">{t("¿Tenés iPhone o preferís la computadora? Usá esta versión web: en el celular podés agregarla a la pantalla de inicio.")}</p>
      </section>
      <section className="glass rounded-xl p-6">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-fog">{t("Cómo instalarla")}</h2>
        <ol className="mt-3 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-fog">
              <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan/40 bg-cyan/10 text-[12px] font-bold text-cyan">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[11.5px] leading-relaxed text-dim">{t("Es el análisis automático de Android: no es una aprobación de Google Play ni una garantía absoluta. Por eso la app se instala por fuera de la tienda y Chrome puede avisar.")}</p>
      </section>
      <p className="text-[11.5px] leading-relaxed text-dim lg:col-span-2">{t("Esto no constituye un consejo de inversión ni asesoramiento financiero. Cada persona decide y opera bajo su propia responsabilidad, y puede perder todo lo que arriesga.")}</p>
    </div>
  );
}

import { t } from "../lib";

/** Video explicativo del bot automático y del modo real. Siempre visible arriba de la pantalla del bot; el archivo se baja recién al darle play. */
export default function BotVideo() {
  return (
    <section className="glass rounded-xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-lg font-bold tracking-wide text-snow">{t("🎬 Mirá cómo funciona el bot (video)")}</h2>
        <span className="text-[11px] text-dim">{t("1 min 50 s")}</span>
      </div>
      <video className="mx-auto w-full max-w-3xl rounded-md border border-line bg-black" controls preload="none" poster="/bot-automatico.jpg" playsInline>
        <source src="/bot-automatico.mp4" type="video/mp4" />
      </video>
      <p className="mt-2 text-[11px] leading-relaxed text-dim">{t("Por defecto el bot opera en modo simulado, sin dinero real; el modo real es opcional y arriesga plata de verdad. Contenido educativo, no asesoramiento financiero.")}</p>
    </section>
  );
}

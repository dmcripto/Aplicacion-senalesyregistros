import { IconTile } from "../icons";
import type { IconName, Tone } from "../icons";
import { COMMUNITY_URL, t } from "../lib";
import { legalUrl } from "../lang";
import Panel from "./Panel";

/** Reglas de oro de riesgo, en cinco líneas: acompaña a la calculadora. */
export function RiskTips() {
  const tips: Array<[IconName, Tone, string, string]> = [
    ["shield", "green", t("Arriesgá poco por operación"), t("Entre 0,5 % y 1 % del capital: así una mala racha no te saca del juego.")],
    ["check", "cyan", t("Poné siempre el stop loss"), t("Definilo antes de entrar y no lo muevas en contra.")],
    ["trend", "violet", t("Buscá al menos 1:2"), t("Que lo que podés ganar sea el doble de lo que arriesgás.")],
    ["bell", "amber", t("Frená tras 3 pérdidas seguidas"), t("Cerrá el día: seguir con la cabeza caliente suele costar más.")],
    ["bot", "green", t("Probá en demo primero"), t("Una estrategia nueva se prueba unas 20 operaciones antes de usar dinero real.")],
  ];
  return (
    <Panel id="tips" title={t("REGLAS DE ORO")} subtitle={t("Lo que más cuida tu capital")}>
      <ul className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-5">
        {tips.map(([icon, tone, title, text]) => (
          <li key={title} className="lift rounded-lg border border-line bg-ink/40 p-3.5">
            <IconTile name={icon} tone={tone} size="sm" />
            <p className="mt-2.5 text-[13px] font-bold text-snow">{title}</p>
            <p className="mt-1 text-[12px] leading-snug text-fog">{text}</p>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-4 text-[10.5px] leading-relaxed text-dim sm:px-5">{t("Son pautas generales de gestión de riesgo, no asesoramiento financiero.")}</p>
    </Panel>
  );
}

/** Tu sesión y accesos útiles: salir, la guía de inicio, la comunidad y los textos legales. */
export function SessionCard({ email, onSignOut, onGuide }: { email?: string; onSignOut: () => void; onGuide: () => void }) {
  const link = "flex items-center justify-between rounded-md border border-line bg-ink/40 px-3.5 py-2.5 text-[12.5px] font-semibold text-fog transition-colors hover:border-gold/50 hover:text-snow";
  return (
    <Panel id="session" title={t("TU SESIÓN")} subtitle={email ?? t("Accesos útiles")}>
      <div className="space-y-2.5 px-4 py-4 sm:px-5">
        {email && (
          <p className="text-[12.5px] text-fog">
            {t("Sesión de")} <span className="num font-bold text-snow">{email}</span>
          </p>
        )}
        <button type="button" onClick={onGuide} className={link + " w-full text-left"}>
          {t("Ver guía de inicio")} <span aria-hidden>→</span>
        </button>
        <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer" className={link}>
          {t("Comunidad en Telegram")} <span aria-hidden>↗</span>
        </a>
        <div className="grid grid-cols-2 gap-2.5">
          <a href={legalUrl("terms")} target="_blank" rel="noopener" className={link}>
            {t("Términos")}
          </a>
          <a href={legalUrl("privacy")} target="_blank" rel="noopener" className={link}>
            {t("Privacidad")}
          </a>
        </div>
        <button type="button" onClick={onSignOut} className="w-full rounded-md border border-bear/40 px-3.5 py-2.5 text-[12px] font-bold uppercase tracking-wider text-bear transition-colors hover:bg-bear/10">
          {t("Cerrar sesión")}
        </button>
      </div>
    </Panel>
  );
}

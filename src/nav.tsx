import { useEffect, useRef, useState } from "react";
import { cx, t } from "./lib";
import { LangSwitch } from "./lang";
import { IconTelegram, ShieldLogo } from "./ui";

/** Pantallas de la web. Cada una es una «página»: la barra de arriba lleva de una a otra y el navegador recuerda cuál (atrás/adelante funcionan). */
export type View = "home" | "journal" | "analysis" | "tools" | "chart" | "liq" | "bot" | "connections" | "account";

export const VIEWS: View[] = ["home", "journal", "analysis", "tools", "chart", "liq", "bot", "connections", "account"];

export interface NavItem {
  view: View;
  icon: string;
  title: string;
  desc: string;
}

/** Todas las pantallas con su nombre y una línea que explica para qué sirven (se usa en los menús y en las tarjetas de Inicio). */
export const NAV_ITEMS: Record<View, NavItem> = {
  home: { view: "home", icon: "🏠", title: "Inicio", desc: "Lo más importante de tu día, de un vistazo." },
  journal: { view: "journal", icon: "📓", title: "Registrar y diario", desc: "Cargá tus operaciones y mirá tu historial y tu curva." },
  analysis: { view: "analysis", icon: "🧠", title: "Análisis y estrategia", desc: "Qué te funciona y qué no, con reglas armadas desde tus operaciones." },
  tools: { view: "tools", icon: "🧮", title: "Calculadora y límites", desc: "Tamaño de la posición y topes de pérdida por día." },
  chart: { view: "chart", icon: "📈", title: "Gráfico", desc: "Velas con indicadores, dibujos y alertas propias." },
  liq: { view: "liq", icon: "💧", title: "Mapa de liquidaciones", desc: "Dónde se acumulan liquidaciones (estimado)." },
  bot: { view: "bot", icon: "🤖", title: "Bot", desc: "Automático, con dinero real y señales de VELTRIX." },
  connections: { view: "connections", icon: "🔗", title: "Conexiones", desc: "Tu fuente de señales, Telegram, WhatsApp y exchanges." },
  account: { view: "account", icon: "👤", title: "Cuenta", desc: "Capital, invitados y seguridad." },
};

interface Group {
  key: string;
  label: string;
  /** Si tiene más de una pantalla, se muestra como menú desplegable. */
  items: View[];
}

const groups = (botReady: boolean): Group[] => [
  { key: "home", label: "Inicio", items: ["home"] },
  { key: "diary", label: "Diario", items: ["journal", "analysis", "tools"] },
  { key: "market", label: "Mercado", items: ["chart", "liq"] },
  ...(botReady ? [{ key: "bot", label: "Bot", items: ["bot"] as View[] }] : []),
  { key: "conn", label: "Conexiones", items: ["connections"] },
  { key: "acct", label: "Cuenta", items: ["account"] },
];

const hashOf = (v: View) => `#/${v}`;
export const viewFromHash = (): View => {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#\/?/, "") as View;
  return VIEWS.includes(h) ? h : "home";
};

/** Pantalla actual según la dirección (#/gráfico…), con cambio que no recarga la página. */
export function useView(): [View, (v: View) => void] {
  const [view, setViewState] = useState<View>(viewFromHash);
  useEffect(() => {
    const on = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const setView = (v: View) => {
    if (v === view) return window.scrollTo({ top: 0, behavior: "smooth" });
    location.hash = hashOf(v);
    setViewState(v);
    window.scrollTo({ top: 0 });
  };
  return [view, setView];
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 10 6" className={cx("h-2.5 w-2.5 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M1 1l4 4 4-4" />
  </svg>
);

/** Barra de arriba: logo, menús (con descripciones) y a la derecha comunidad, idioma y salir. En el celular se vuelve un menú de hamburguesa. */
export function NavBar({
  view,
  setView,
  botReady,
  email,
  now,
  communityUrl,
  onSignOut,
}: {
  view: View;
  setView: (v: View) => void;
  botReady: boolean;
  email?: string;
  now: Date;
  communityUrl: string;
  onSignOut: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const list = groups(botReady);
  const groupOf = (v: View) => list.find((g) => g.items.includes(v))?.key;

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenKey(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setOpenKey(null), setMobile(false));
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  const go = (v: View) => {
    setOpenKey(null);
    setMobile(false);
    setView(v);
  };

  return (
    <nav ref={barRef} aria-label={t("Menú principal")} className="sticky top-0 z-40 border-b border-line/70 bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-2.5 lg:gap-6 lg:px-8">
        <button type="button" onClick={() => go("home")} className="flex shrink-0 items-center gap-2.5" aria-label="VELTRIX">
          <span className="brand-logo"><ShieldLogo className="h-9 w-9" /></span>
          <span className="font-display text-[22px] font-extrabold leading-none tracking-[0.05em] text-snow"><span className="brand-word">VELTRIX</span></span>
        </button>

        {/* Menús (pantalla grande) */}
        <ul className="ml-2 hidden items-center gap-1 lg:flex">
          {list.map((g) => {
            const active = groupOf(view) === g.key;
            const multi = g.items.length > 1;
            const open = openKey === g.key;
            return (
              <li key={g.key} className="relative" onMouseEnter={() => multi && setOpenKey(g.key)} onMouseLeave={() => multi && setOpenKey((k) => (k === g.key ? null : k))}>
                <button
                  type="button"
                  aria-haspopup={multi ? "menu" : undefined}
                  aria-expanded={multi ? open : undefined}
                  onClick={() => (multi ? setOpenKey(open ? null : g.key) : go(g.items[0]))}
                  className={cx(
                    "flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors",
                    active ? "bg-gold/10 text-gold" : "text-fog hover:bg-line/40 hover:text-snow",
                  )}
                >
                  {t(g.label)}
                  {multi && <Chevron open={open} />}
                </button>
                {multi && open && (
                  <div role="menu" className="absolute left-0 top-full z-50 w-[min(460px,90vw)] pt-2">
                    <div className="rounded-xl border border-line2 bg-panel p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]">
                      {g.items.map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="menuitem"
                          onClick={() => go(v)}
                          className={cx("flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-line/50", view === v && "bg-gold/10")}
                        >
                          <span className="mt-0.5 text-lg leading-none" aria-hidden>{NAV_ITEMS[v].icon}</span>
                          <span>
                            <span className="block text-[13px] font-bold text-snow">{t(NAV_ITEMS[v].title)}</span>
                            <span className="block text-[12px] leading-snug text-dim">{t(NAV_ITEMS[v].desc)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <span className="num hidden text-[12px] text-dim xl:inline">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <a
            href={communityUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t("Comunidad")}
            aria-label={t("Comunidad")}
            className="flex items-center gap-2 rounded-md border border-cyan/45 bg-cyan/10 px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-cyan transition-colors hover:bg-cyan/20"
          >
            <IconTelegram className="h-4 w-4" /> <span className="hidden md:inline">{t("Comunidad")}</span>
          </a>
          <LangSwitch className="hidden sm:inline-flex" />
          {email && (
            <span className="hidden max-w-[170px] truncate text-[11px] text-dim 2xl:inline" title={email}>
              {email}
            </span>
          )}
          <button type="button" onClick={onSignOut} className="hidden rounded-md border border-line px-3 py-2 text-[12px] font-semibold text-dim transition-colors hover:border-line2 hover:text-snow sm:block">
            {t("Salir")}
          </button>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-md border border-line text-snow lg:hidden"
            aria-label={t("Menú")}
            aria-expanded={mobile}
            onClick={() => setMobile((m) => !m)}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              {mobile ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Menú del celular */}
      {mobile && (
        <div className="max-h-[80vh] overflow-y-auto border-t border-line/70 bg-panel px-4 pb-4 lg:hidden">
          {list.map((g) => (
            <div key={g.key} className="pt-3">
              {g.items.length > 1 && <p className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-[0.2em] text-dim">{t(g.label)}</p>}
              {g.items.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => go(v)}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left", view === v ? "bg-gold/10 text-gold" : "text-snow hover:bg-line/40")}
                >
                  <span className="text-lg leading-none" aria-hidden>{NAV_ITEMS[v].icon}</span>
                  <span>
                    <span className="block text-[14px] font-bold">{t(NAV_ITEMS[v].title)}</span>
                    <span className="block text-[11.5px] leading-snug text-dim">{t(NAV_ITEMS[v].desc)}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-4">
            <LangSwitch />
            <button type="button" onClick={onSignOut} className="rounded-md border border-line px-4 py-2 text-[12px] font-semibold text-dim">
              {t("Salir")}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

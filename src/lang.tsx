import { Fragment, createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { LANGS, detectLang, getLang, isLang, setLang } from "./lib";
import type { Lang } from "./lib";

const KEY = "veltrix_lang";

/** Páginas legales estáticas: /privacy.html (ES) · /privacy-en.html (EN). */
export const legalUrl = (page: "privacy" | "terms" | "delete-account") =>
  getLang() === "en" ? `/${page}-en.html` : `/${page}.html`;

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* sin storage */
  }
  return detectLang(typeof navigator !== "undefined" ? navigator.language : null);
}

function applyDocLang(l: Lang) {
  document.documentElement.lang = l;
  document.title = l === "en" ? "VELTRIX · Trading Journal" : "VELTRIX · Diario de Trading";
}

interface LangCtx {
  lang: Lang;
  change: (l: Lang) => void;
}
const Ctx = createContext<LangCtx>({ lang: "es", change: () => {} });
export const useLang = () => useContext(Ctx);

/** Cambia el idioma de toda la app: al cambiar se vuelve a dibujar el árbol completo. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initial();
    setLang(l);
    if (typeof document !== "undefined") applyDocLang(l);
    return l;
  });
  const change = useCallback((l: Lang) => {
    setLang(l);
    applyDocLang(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* sin storage */
    }
    setLangState(l);
  }, []);
  const value = useMemo(() => ({ lang, change }), [lang, change]);
  return (
    <Ctx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </Ctx.Provider>
  );
}

/** Selector compacto ES | EN. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, change } = useLang();
  return (
    <div className={`inline-flex overflow-hidden rounded border border-line2 ${className}`} role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => change(l.code)}
          title={l.label}
          aria-pressed={lang === l.code}
          className={`num px-2.5 py-1.5 text-[11px] font-bold tracking-wider transition ${
            lang === l.code ? "bg-gold text-ink" : "text-fog hover:text-snow"
          }`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}

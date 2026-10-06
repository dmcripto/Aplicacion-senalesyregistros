import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../lib";

// Sección desplegable. Recuerda en este navegador si quedó abierta o cerrada; cerrada muestra una línea de resumen.
const KEY = "veltrix_panels_v1";
export const PANEL_EVENT = "veltrix:panels";

const load = (): Record<string, boolean> => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
const save = (id: string, open: boolean) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), [id]: open }));
  } catch {
    /* sin almacenamiento: queda solo para esta visita */
  }
};
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

/** Abre o cierra todas las secciones, o abre una puntual (para los atajos del menú). */
export const openAllPanels = (open: boolean) => window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: { all: open } }));
export const jumpToPanel = (id: string) => {
  window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: { id } }));
  window.setTimeout(() => document.getElementById(`panel-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
};

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  /** Línea que se muestra en lugar del subtítulo cuando la sección está cerrada. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Valor inicial en el celular (si no se indica, el mismo que en pantalla grande). */
  phoneOpen?: boolean;
  /** Controles a la derecha del título (por ejemplo, un selector). */
  right?: ReactNode;
  children: ReactNode;
}

export default function Panel({ id, title, subtitle, summary, defaultOpen = true, phoneOpen, right, children }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    const saved = load()[id];
    if (typeof saved === "boolean") return saved;
    return isPhone() && phoneOpen !== undefined ? phoneOpen : defaultOpen;
  });

  useEffect(() => {
    const onCmd = (e: Event) => {
      const d = (e as CustomEvent<{ all?: boolean; id?: string }>).detail ?? {};
      if (typeof d.all === "boolean") {
        setOpen(d.all);
        save(id, d.all);
      } else if (d.id === id) {
        setOpen(true);
        save(id, true);
      }
    };
    window.addEventListener(PANEL_EVENT, onCmd);
    return () => window.removeEventListener(PANEL_EVENT, onCmd);
  }, [id]);

  const toggle = () => {
    setOpen((o) => {
      save(id, !o);
      return !o;
    });
  };

  const line = open ? subtitle : (summary ?? subtitle);

  return (
    <section id={`panel-${id}`} className="glass glow-card scroll-mt-16 overflow-hidden rounded-xl">
      <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5 sm:py-4", open && "border-b border-line")}>
        <h2 className="min-w-[11rem] flex-1">
          <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl font-bold tracking-wide text-snow sm:text-2xl">{title}</span>
              {line ? (
                <span className={cx("block truncate text-[10px] tracking-[0.12em] text-dim sm:text-[11px] sm:tracking-[0.16em]", open && "uppercase", !open && !!summary && "num text-fog")}>{line}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-lg text-gold" aria-hidden>
              {open ? "▾" : "▸"}
            </span>
          </button>
        </h2>
        {open && right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {open ? <div className="panel-body">{children}</div> : null}
    </section>
  );
}

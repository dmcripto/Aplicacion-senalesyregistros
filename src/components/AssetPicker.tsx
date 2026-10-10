import { useEffect, useMemo, useRef, useState } from "react";
import { BOT_MAX_SYMBOLS, botAssetGroups, botAssetName, cx, t } from "../lib";

/** Lista desplegable para elegir los activos del bot (cripto, oro, plata, petróleo, acciones…), con buscador. */
export default function AssetPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return botAssetGroups()
      .map((g) => ({ ...g, items: g.items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.sym.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length);
  }, [q, open]);

  const full = selected.length >= BOT_MAX_SYMBOLS;
  const toggle = (sym: string) => {
    if (selected.includes(sym)) {
      if (selected.length > 1) onChange(selected.filter((x) => x !== sym));
    } else if (!full) onChange([...selected, sym]);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((sym) => (
          <span key={sym} className="inline-flex items-center gap-1 rounded-md border border-gold bg-gold px-2.5 py-1 text-[12px] font-bold text-ink">
            {botAssetName(sym)}
            {selected.length > 1 && (
              <button type="button" onClick={() => toggle(sym)} aria-label={t("Quitar")} className="text-ink/70 hover:text-ink">
                ✕
              </button>
            )}
          </span>
        ))}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-md border border-cyan/50 px-3 py-1 text-[12px] font-bold text-cyan transition-colors hover:bg-cyan/10">
          ＋ {t("Agregar activos")} ▾
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
        {t("{n} de {max} elegidos. Si el exchange no tiene el activo, el bot lo omite.", { n: selected.length, max: BOT_MAX_SYMBOLS })}
      </p>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 max-h-[22rem] overflow-y-auto rounded-lg border border-line2 bg-panel p-3 shadow-[0_18px_50px_rgba(0,0,0,.55)]">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar: oro, petróleo, MSTR, ENA…")} className="num mb-3 w-full rounded-md border border-line bg-ink px-3 py-2 text-[13px] text-snow outline-none focus:border-gold" />
          {full && <p className="mb-2 text-[11px] font-semibold text-gold">{t("Llegaste al máximo: sacá uno para agregar otro.")}</p>}
          {groups.length === 0 && <p className="py-3 text-center text-[12px] text-dim">{t("No hay resultados.")}</p>}
          {groups.map((g) => (
            <div key={g.id} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-fog">{g.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((i) => {
                  const on = selected.includes(i.sym);
                  return (
                    <button
                      key={i.sym}
                      type="button"
                      onClick={() => toggle(i.sym)}
                      disabled={!on && full}
                      className={cx("rounded-md border px-2.5 py-1 text-[12px] font-bold transition-colors disabled:opacity-35", on ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow")}
                    >
                      {on && "✓ "}
                      {i.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

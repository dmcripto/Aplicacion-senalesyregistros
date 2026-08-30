import { useEffect, useMemo, useState } from "react";
import { cx, fmtDateTime, fmtPrice, resultR, rrOf } from "../lib";
import type { Trade } from "../lib";
import {
  DirBadge,
  IconCandles,
  IconSearch,
  IconTarget,
  IconTrash,
  IconUndo,
  IconX,
  OutcomeBadge,
} from "../ui";

type SortMode = "recientes" | "antiguas" | "mejorR" | "peorR";
type EstadoF = "all" | "abierta" | "ganada" | "perdida" | "be";

interface Props {
  trades: Trade[];
  flashId: string | null;
  onMark: (id: string, outcome: "TP" | "SL") => void;
  onManual: (t: Trade) => void;
  onDelete: (id: string) => void;
  onReopen: (id: string) => void;
  onLoadSample: () => void;
}

export default function TradeTable({ trades, flashId, onMark, onManual, onDelete, onReopen, onLoadSample }: Props) {
  const [q, setQ] = useState("");
  const [dirF, setDirF] = useState<"all" | "LONG" | "SHORT">("all");
  const [estado, setEstado] = useState<EstadoF>("all");
  const [mes, setMes] = useState("all");
  const [sort, setSort] = useState<SortMode>("recientes");
  const [armedId, setArmedId] = useState<string | null>(null);

  useEffect(() => {
    if (!armedId) return;
    const id = window.setTimeout(() => setArmedId(null), 2600);
    return () => window.clearTimeout(id);
  }, [armedId]);

  const months = useMemo(() => {
    const set = new Map<string, string>();
    for (const t of trades) {
      const key = t.date.slice(0, 7);
      if (!set.has(key)) {
        const d = new Date(key + "-01T12:00:00");
        set.set(key, d.toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
      }
    }
    return [...set.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [trades]);

  const filtered = useMemo(() => {
    let list = trades;
    if (q.trim()) list = list.filter((t) => t.symbol.toLowerCase().includes(q.trim().toLowerCase()));
    if (dirF !== "all") list = list.filter((t) => t.direction === dirF);
    if (mes !== "all") list = list.filter((t) => t.date.startsWith(mes));
    if (estado !== "all") {
      list = list.filter((t) => {
        if (estado === "abierta") return t.outcome === "ABIERTA";
        const r = resultR(t) ?? 0;
        if (estado === "ganada") return t.outcome !== "ABIERTA" && r > 0;
        if (estado === "perdida") return t.outcome !== "ABIERTA" && r < 0;
        return t.outcome !== "ABIERTA" && r === 0;
      });
    }
    const byDate = (a: Trade, b: Trade) => new Date(b.date).getTime() - new Date(a.date).getTime();
    switch (sort) {
      case "antiguas":
        return [...list].sort((a, b) => byDate(b, a));
      case "mejorR":
        return [...list].sort((a, b) => (resultR(b) ?? -999) - (resultR(a) ?? -999));
      case "peorR":
        return [...list].sort((a, b) => (resultR(a) ?? 999) - (resultR(b) ?? 999));
      default:
        return [...list].sort(byDate);
    }
  }, [trades, q, dirF, estado, mes, sort]);

  const hasFilters = q.trim() !== "" || dirF !== "all" || estado !== "all" || mes !== "all";

  if (trades.length === 0) {
    return (
      <section className="rounded-lg border border-line bg-panel">
        <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <IconCandles className="h-20 w-40" />
          <div>
            <h3 className="font-display text-3xl font-bold tracking-wide text-snow">EL DIARIO ESTÁ VACÍO</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fog">
              Pegá una alerta del indicador <span className="num text-gold">DMCRIPTO</span> en el panel de registro,
              cargá tu primera operación manual, o explorá la app con datos de ejemplo.
            </p>
          </div>
          <button
            onClick={onLoadSample}
            className="rounded-md bg-gold px-5 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.97]"
          >
            Cargar operaciones de ejemplo
          </button>
        </div>
      </section>
    );
  }

  const iconBtn =
    "flex h-7 items-center justify-center gap-1 rounded border border-line px-2 text-[10px] font-bold uppercase tracking-wide text-fog transition-all hover:-translate-y-px";

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-wide text-snow">LIBRO DE OPERACIONES</h2>
          <p className="num text-[11px] uppercase tracking-[0.16em] text-dim">
            {filtered.length} de {trades.length} en pantalla
          </p>
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="field num w-auto cursor-pointer py-1.5 text-[12px]">
          <option value="recientes">Más recientes</option>
          <option value="antiguas">Más antiguas</option>
          <option value="mejorR">Mejor R primero</option>
          <option value="peorR">Peor R primero</option>
        </select>
      </header>

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ink/50 px-5 py-3">
        <div className="relative min-w-[150px] flex-1 sm:max-w-[210px]">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar activo…" className="field num pl-8 text-[12px]" />
        </div>
        <select value={dirF} onChange={(e) => setDirF(e.target.value as "all" | "LONG" | "SHORT")} className="field w-auto cursor-pointer py-1.5 text-[12px]">
          <option value="all">LONG y SHORT</option>
          <option value="LONG">Solo LONG</option>
          <option value="SHORT">Solo SHORT</option>
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoF)} className="field w-auto cursor-pointer py-1.5 text-[12px]">
          <option value="all">Todos los estados</option>
          <option value="abierta">Abiertas</option>
          <option value="ganada">Ganadas</option>
          <option value="perdida">Perdidas</option>
          <option value="be">En Break Even</option>
        </select>
        <select value={mes} onChange={(e) => setMes(e.target.value)} className="field w-auto cursor-pointer py-1.5 text-[12px] capitalize">
          <option value="all">Todos los meses</option>
          {months.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setQ("");
              setDirF("all");
              setEstado("all");
              setMes("all");
            }}
            className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[11px] font-semibold text-fog transition-colors hover:border-bear/50 hover:text-bear"
          >
            <IconX className="h-3 w-3" /> Limpiar
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-fog">Ninguna operación coincide con los filtros.</p>
          <button
            onClick={() => {
              setQ("");
              setDirF("all");
              setEstado("all");
              setMes("all");
            }}
            className="mt-3 rounded-md border border-line px-4 py-2 text-[12px] font-semibold text-gold transition-colors hover:border-gold/50"
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.16em] text-dim">
                <th className="px-5 py-2.5 font-semibold">Fecha</th>
                <th className="px-3 py-2.5 font-semibold">Activo</th>
                <th className="px-3 py-2.5 font-semibold">Dir</th>
                <th className="px-3 py-2.5 text-right font-semibold">Entrada</th>
                <th className="px-3 py-2.5 text-right font-semibold">TP</th>
                <th className="px-3 py-2.5 text-right font-semibold">SL</th>
                <th className="px-3 py-2.5 text-right font-semibold">R:R</th>
                <th className="px-3 py-2.5 font-semibold">Resultado</th>
                <th className="px-5 py-2.5 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const rr = rrOf(t);
                const abierta = t.outcome === "ABIERTA";
                return (
                  <tr
                    key={t.id}
                    className={cx(
                      "group border-b border-line/60 transition-colors last:border-b-0 hover:bg-panel2/70",
                      flashId === t.id && "row-flash",
                    )}
                  >
                    <td className="num whitespace-nowrap px-5 py-3 text-[11px] text-fog">{fmtDateTime(t.date)}</td>
                    <td className="px-3 py-3">
                      <span className="num font-bold tracking-wide text-snow">{t.symbol}</span>
                      {t.notes && <p className="mt-0.5 max-w-[220px] truncate text-[10.5px] italic text-dim" title={t.notes}>{t.notes}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <DirBadge dir={t.direction} />
                    </td>
                    <td className="num px-3 py-3 text-right font-semibold text-snow">{fmtPrice(t.entry)}</td>
                    <td className="num px-3 py-3 text-right text-bull/90">{fmtPrice(t.tp)}</td>
                    <td className="num px-3 py-3 text-right text-bear/90">{fmtPrice(t.sl)}</td>
                    <td className="num px-3 py-3 text-right text-fog">1:{rr.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <OutcomeBadge trade={t} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {abierta ? (
                          <>
                            <button
                              onClick={() => onMark(t.id, "TP")}
                              title="Marcar Take Profit"
                              className={cx(iconBtn, "border-bull/40 bg-bull/10 text-bull hover:bg-bull/20")}
                            >
                              TP
                            </button>
                            <button
                              onClick={() => onMark(t.id, "SL")}
                              title="Marcar Stop Loss"
                              className={cx(iconBtn, "border-bear/40 bg-bear/10 text-bear hover:bg-bear/20")}
                            >
                              SL
                            </button>
                            <button
                              onClick={() => onManual(t)}
                              title="Cierre manual (parcial / break even)"
                              className={cx(iconBtn, "hover:border-cyan/50 hover:bg-cyan/10 hover:text-cyan")}
                            >
                              <IconTarget className="h-3.5 w-3.5" /> Cerrar
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => onReopen(t.id)}
                            title="Reabrir operación"
                            className={cx(iconBtn, "hover:border-gold/50 hover:bg-gold/10 hover:text-gold")}
                          >
                            <IconUndo className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {armedId === t.id ? (
                          <button
                            onClick={() => {
                              setArmedId(null);
                              onDelete(t.id);
                            }}
                            className="num flex h-7 items-center rounded border border-bear bg-bear/20 px-2 text-[10px] font-bold text-bear transition-colors hover:bg-bear/35"
                          >
                            ¿Borrar?
                          </button>
                        ) : (
                          <button
                            onClick={() => setArmedId(t.id)}
                            title="Eliminar"
                            className={cx(iconBtn, "hover:border-bear/50 hover:bg-bear/10 hover:text-bear")}
                          >
                            <IconTrash className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

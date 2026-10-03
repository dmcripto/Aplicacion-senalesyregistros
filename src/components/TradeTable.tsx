import { useEffect, useMemo, useState } from "react";
import { cx, exchangeName, fmtDateTime, fmtPrice, locale, resultR, rrOf, signalShareMessage, whatsappShareUrl } from "../lib";
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
import { t } from "../lib";
import Panel from "./Panel";

type SortMode = "recientes" | "antiguas" | "mejorR" | "peorR";
type EstadoF = "all" | "abierta" | "ganada" | "perdida" | "be";

interface Props {
  trades: Trade[];
  flashId: string | null;
  onMark: (id: string, outcome: "TP" | "SL") => void;
  onManual: (t: Trade) => void;
  onDelete: (id: string) => void;
  onReopen: (id: string) => void;
  onNotes: (t: Trade) => void;
  onLoadSample: () => void;
}

export default function TradeTable({ trades, flashId, onMark, onManual, onDelete, onReopen, onNotes, onLoadSample }: Props) {
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
    for (const x of trades) {
      const key = x.date.slice(0, 7);
      if (!set.has(key)) {
        const d = new Date(key + "-01T12:00:00");
        set.set(key, d.toLocaleDateString(locale(), { month: "long", year: "numeric" }));
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
            <h3 className="font-display text-3xl font-bold tracking-wide text-snow">{t("EL DIARIO ESTÁ VACÍO")}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fog">
              {t("Pegá una alerta del indicador")} <span className="num text-gold">VELTRIX</span> {t("en el panel de registro, cargá tu primera operación manual, o explorá la app con datos de ejemplo.")}
            </p>
          </div>
          <button
            onClick={onLoadSample}
            className="rounded-md bg-gold px-5 py-2.5 text-[13px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110 active:scale-[0.97]"
          >
            {t("Cargar operaciones de ejemplo")}
          </button>
        </div>
      </section>
    );
  }

  const iconBtn =
    "flex h-7 items-center justify-center gap-1 rounded border border-line px-2 text-[10px] font-bold uppercase tracking-wide text-fog transition-all hover:-translate-y-px";

  return (
    <Panel
      id="journal"
      title={t("LIBRO DE OPERACIONES")}
      subtitle={`${filtered.length} ${t("de")} ${trades.length} ${t("en pantalla")}`}
      summary={`${trades.length} ${t("operaciones")}`}
      right={
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="field num w-auto cursor-pointer py-1.5 text-[12px]">
          <option value="recientes">{t("Más recientes")}</option>
          <option value="antiguas">{t("Más antiguas")}</option>
          <option value="mejorR">{t("Mejor R primero")}</option>
          <option value="peorR">{t("Peor R primero")}</option>
        </select>
      }
    >

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ink/50 px-5 py-3">
        <div className="relative min-w-[150px] flex-1 sm:max-w-[210px]">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar activo…")} className="field num pl-8 text-[12px]" />
        </div>
        <select value={dirF} onChange={(e) => setDirF(e.target.value as "all" | "LONG" | "SHORT")} className="field w-auto cursor-pointer py-1.5 text-[12px]">
          <option value="all">{t("LONG y SHORT")}</option>
          <option value="LONG">{t("Solo LONG")}</option>
          <option value="SHORT">{t("Solo SHORT")}</option>
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoF)} className="field w-auto cursor-pointer py-1.5 text-[12px]">
          <option value="all">{t("Todos los estados")}</option>
          <option value="abierta">{t("Abiertas")}</option>
          <option value="ganada">{t("Ganadas")}</option>
          <option value="perdida">{t("Perdidas")}</option>
          <option value="be">{t("En Break Even")}</option>
        </select>
        <select value={mes} onChange={(e) => setMes(e.target.value)} className="field w-auto cursor-pointer py-1.5 text-[12px] capitalize">
          <option value="all">{t("Todos los meses")}</option>
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
            <IconX className="h-3 w-3" /> {t("Limpiar")}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-fog">{t("Ninguna operación coincide con los filtros.")}</p>
          <button
            onClick={() => {
              setQ("");
              setDirF("all");
              setEstado("all");
              setMes("all");
            }}
            className="mt-3 rounded-md border border-line px-4 py-2 text-[12px] font-semibold text-gold transition-colors hover:border-gold/50"
          >
            {t("Limpiar filtros")}
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.16em] text-dim">
                <th className="px-5 py-2.5 font-semibold">{t("Fecha")}</th>
                <th className="px-3 py-2.5 font-semibold">{t("Activo")}</th>
                <th className="px-3 py-2.5 font-semibold">{t("Dir")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{t("Entrada")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">TP</th>
                <th className="px-3 py-2.5 text-right font-semibold">SL</th>
                <th className="px-3 py-2.5 text-right font-semibold">R:R</th>
                <th className="px-3 py-2.5 font-semibold">{t("Resultado")}</th>
                <th className="px-5 py-2.5 text-right font-semibold">{t("Acciones")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tr) => {
                const rr = rrOf(tr);
                const abierta = tr.outcome === "ABIERTA";
                return (
                  <tr
                    key={tr.id}
                    className={cx(
                      "group border-b border-line/60 transition-colors last:border-b-0 hover:bg-panel2/70",
                      flashId === tr.id && "row-flash",
                    )}
                  >
                    <td className="num whitespace-nowrap px-5 py-3 text-[11px] text-fog">{fmtDateTime(tr.date)}</td>
                    <td className="px-3 py-3">
                      <span className="num font-bold tracking-wide text-snow">{tr.symbol}</span>
                      {tr.source && (
                        <span className="num ml-2 rounded border border-line px-1.5 py-px text-[9.5px] font-semibold text-dim" title={t("Importada de {name}", { name: exchangeName(tr.source) })}>
                          ⇄ {exchangeName(tr.source)}
                        </span>
                      )}
                      {tr.notes && <p className="mt-0.5 max-w-[220px] truncate text-[10.5px] italic text-dim" title={tr.notes}>{tr.notes}</p>}
                      {!!tr.tags?.length && (
                        <div className="mt-1 flex max-w-[240px] flex-wrap gap-1">
                          {tr.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-gold/40 bg-gold/10 px-2 py-px text-[9.5px] font-semibold text-gold">
                              {t(tag)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <DirBadge dir={tr.direction} />
                    </td>
                    <td className="num px-3 py-3 text-right font-semibold text-snow">{fmtPrice(tr.entry)}</td>
                    <td className="num px-3 py-3 text-right text-bull/90">{fmtPrice(tr.tp)}</td>
                    <td className="num px-3 py-3 text-right text-bear/90">{fmtPrice(tr.sl)}</td>
                    <td className="num px-3 py-3 text-right text-fog">1:{rr.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <OutcomeBadge trade={tr} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <a
                          href={whatsappShareUrl(signalShareMessage(tr))}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t("Enviar esta señal por WhatsApp")}
                          aria-label={t("Enviar esta señal por WhatsApp")}
                          className={cx(iconBtn, "hover:border-bull/50 hover:bg-bull/10 hover:text-bull")}
                        >
                          WhatsApp
                        </a>
                        <button
                          onClick={() => onNotes(tr)}
                          title={t("Notas y etiquetas")}
                          className={cx(iconBtn, "hover:border-gold/50 hover:bg-gold/10 hover:text-gold")}
                        >
                          {"✎ "}{t("Notas")}
                        </button>
                        {abierta ? (
                          <>
                            <button
                              onClick={() => onMark(tr.id, "TP")}
                              title={t("Marcar Take Profit")}
                              className={cx(iconBtn, "border-bull/40 bg-bull/10 text-bull hover:bg-bull/20")}
                            >
                              TP
                            </button>
                            <button
                              onClick={() => onMark(tr.id, "SL")}
                              title={t("Marcar Stop Loss")}
                              className={cx(iconBtn, "border-bear/40 bg-bear/10 text-bear hover:bg-bear/20")}
                            >
                              SL
                            </button>
                            <button
                              onClick={() => onManual(tr)}
                              title={t("Cierre manual (parcial / break even)")}
                              className={cx(iconBtn, "hover:border-cyan/50 hover:bg-cyan/10 hover:text-cyan")}
                            >
                              <IconTarget className="h-3.5 w-3.5" /> {t("Cerrar")}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => onReopen(tr.id)}
                            title={t("Reabrir operación")}
                            className={cx(iconBtn, "hover:border-gold/50 hover:bg-gold/10 hover:text-gold")}
                          >
                            <IconUndo className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {armedId === tr.id ? (
                          <button
                            onClick={() => {
                              setArmedId(null);
                              onDelete(tr.id);
                            }}
                            className="num flex h-7 items-center rounded border border-bear bg-bear/20 px-2 text-[10px] font-bold text-bear transition-colors hover:bg-bear/35"
                          >
                            {t("¿Borrar?")}
                          </button>
                        ) : (
                          <button
                            onClick={() => setArmedId(tr.id)}
                            title={t("Eliminar")}
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
    </Panel>
  );
}

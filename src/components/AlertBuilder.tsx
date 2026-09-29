import { useMemo, useState } from "react";
import { buildAlertMessage, cx } from "../lib";
import type { AlertFormat, Direction } from "../lib";

const inputCls =
  "num w-full rounded-md border border-line bg-ink px-2.5 py-2 text-[11.5px] text-snow outline-none transition-colors placeholder:text-dim focus:border-gold/60";
const labelCls = "mb-1 block text-[9.5px] font-bold uppercase tracking-[0.16em] text-dim";

export default function AlertBuilder({ notify }: { notify: (msg: string, kind?: "ok" | "err" | "info") => void }) {
  const [format, setFormat] = useState<AlertFormat>("pipe");
  const [direction, setDirection] = useState<Direction>("LONG");
  const [entry, setEntry] = useState("{{close}}");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");

  const message = useMemo(() => buildAlertMessage({ format, direction, entry, tp, sl }), [format, direction, entry, tp, sl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      notify("Mensaje de alerta copiado.");
    } catch {
      notify("No se pudo copiar automáticamente — seleccioná el texto a mano.", "err");
    }
  };

  const chip = (on: boolean) =>
    cx(
      "flex-1 rounded-md border px-2.5 py-1.5 text-[11px] font-bold transition-colors",
      on ? "border-gold bg-gold text-ink" : "border-line text-fog hover:border-line2 hover:text-snow",
    );

  return (
    <div className="space-y-3 rounded-md border border-line bg-ink/40 p-3.5">
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">Armador de alertas</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-dim">
          Funciona con cualquier indicador. Elegí la dirección y escribí en TP y SL lo que tu indicador entrega
          (un {"{{plot(\"nombre\")}}"} de TradingView o un número fijo). Después copiá el mensaje en el campo "Mensaje" de la alerta.
        </p>
      </div>

      <div className="flex gap-2">
        <button className={chip(direction === "LONG")} onClick={() => setDirection("LONG")}>COMPRA</button>
        <button className={chip(direction === "SHORT")} onClick={() => setDirection("SHORT")}>VENTA</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label>
          <span className={labelCls}>Entrada</span>
          <input className={inputCls} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="{{close}}" />
        </label>
        <label>
          <span className={labelCls}>Take profit</span>
          <input className={inputCls} value={tp} onChange={(e) => setTp(e.target.value)} placeholder='{{plot("TP")}}' />
        </label>
        <label>
          <span className={labelCls}>Stop loss</span>
          <input className={inputCls} value={sl} onChange={(e) => setSl(e.target.value)} placeholder='{{plot("SL")}}' />
        </label>
      </div>

      <div className="flex gap-2">
        <button className={chip(format === "pipe")} onClick={() => setFormat("pipe")}>Formato simple</button>
        <button className={chip(format === "json")} onClick={() => setFormat("json")}>Formato JSON</button>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-line bg-ink px-3 py-2.5">
        <code className="num min-w-0 flex-1 break-all text-[11px] text-gold">{message}</code>
        <button
          onClick={copy}
          className="shrink-0 rounded border border-line px-2.5 py-1.5 text-[11px] font-semibold text-fog transition-colors hover:border-line2 hover:text-snow"
        >
          Copiar
        </button>
      </div>
      <p className="text-[10.5px] leading-relaxed text-dim">
        Sin TP/SL de un indicador, escribí números fijos. Si tu indicador no expone TP/SL, hará falta una alerta de
        Pine (<span className="num">alert()</span>) que los incluya.
      </p>
    </div>
  );
}

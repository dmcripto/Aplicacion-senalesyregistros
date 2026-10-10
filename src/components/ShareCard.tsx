import { useEffect, useMemo, useRef, useState } from "react";
import { SITE_URL, cx, fmtR, inviteLink, resultShareText, summarize } from "../lib";
import { supabase } from "../supabaseClient";
import type { ResultSummary, SharePeriod, Trade } from "../lib";
import { t } from "../lib";

const W = 1080;
const H = 1350;
const PERIODS: Array<[SharePeriod, string]> = [
  ["week", "7 días"],
  ["month", "Este mes"],
  ["all", "Todo"],
];

const rr = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};

function draw(canvas: HTMLCanvasElement, s: ResultSummary, logo: HTMLImageElement | null, code: string | null) {
  const c = canvas.getContext("2d");
  if (!c) return;
  canvas.width = W;
  canvas.height = H;
  const font = (w: number, px: number) => `${w} ${px}px "Space Grotesk", system-ui, sans-serif`;
  const good = s.netR >= 0;
  const accent = s.closed === 0 ? "#93a5ba" : good ? "#16d98a" : "#ff4d67";

  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#070b11");
  bg.addColorStop(1, "#0a1a2a");
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  const glow1 = c.createRadialGradient(140, 120, 0, 140, 120, 620);
  glow1.addColorStop(0, "rgba(46,196,241,0.28)");
  glow1.addColorStop(1, "rgba(46,196,241,0)");
  c.fillStyle = glow1;
  c.fillRect(0, 0, W, H);
  const glow2 = c.createRadialGradient(W - 100, H - 200, 0, W - 100, H - 200, 640);
  glow2.addColorStop(0, good ? "rgba(22,217,138,0.22)" : "rgba(255,77,103,0.20)");
  glow2.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = glow2;
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(147,165,186,0.06)";
  c.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) (c.beginPath(), c.moveTo(x, 0), c.lineTo(x, H), c.stroke());
  for (let y = 0; y <= H; y += 54) (c.beginPath(), c.moveTo(0, y), c.lineTo(W, y), c.stroke());

  // Encabezado
  if (logo) c.drawImage(logo, 60, 56, 120, 120);
  c.fillStyle = "#e8eef6";
  c.font = font(700, 64);
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  c.fillText("VELTRIX", 200, 130);
  c.fillStyle = "#2ec4f1";
  c.font = font(600, 26);
  c.fillText(t("Diario de trading"), 202, 168);
  c.textAlign = "right";
  c.fillStyle = "#e8eef6";
  c.font = font(700, 34);
  c.fillText(s.label, W - 60, 118);
  c.fillStyle = "#93a5ba";
  c.font = font(500, 26);
  c.fillText(`${s.closed} ${s.closed === 1 ? t("operación cerrada") : t("operaciones cerradas")}`, W - 60, 160);

  // Resultado
  c.textAlign = "center";
  c.fillStyle = "#93a5ba";
  c.font = font(700, 30);
  c.fillText(t("RESULTADO NETO"), W / 2, 300);
  c.save();
  c.shadowColor = accent;
  c.shadowBlur = 50;
  c.fillStyle = accent;
  c.font = font(700, 230);
  c.fillText(s.closed === 0 ? "0R" : `${fmtR(s.netR)}R`, W / 2, 500);
  c.restore();

  // Curva
  const px = 60, py = 560, pw = W - 120, ph = 330;
  c.fillStyle = "rgba(16,23,32,0.85)";
  rr(c, px, py, pw, ph, 28);
  c.fill();
  c.strokeStyle = "rgba(34,48,66,1)";
  c.lineWidth = 2;
  c.stroke();
  const pts = s.curve.length >= 2 ? s.curve : [0, 0];
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), span = hi - lo || 1;
  const ix = px + 30, iw = pw - 60, iy = py + 30, ih = ph - 60;
  const X = (i: number) => ix + (i / (pts.length - 1)) * iw;
  const Y = (v: number) => iy + (1 - (v - lo) / span) * ih;
  c.setLineDash([10, 12]);
  c.strokeStyle = "rgba(147,165,186,0.35)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(ix, Y(0));
  c.lineTo(ix + iw, Y(0));
  c.stroke();
  c.setLineDash([]);
  const area = c.createLinearGradient(0, iy, 0, iy + ih);
  area.addColorStop(0, good ? "rgba(22,217,138,0.40)" : "rgba(255,77,103,0.40)");
  area.addColorStop(1, "rgba(0,0,0,0)");
  c.beginPath();
  pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
  c.lineTo(X(pts.length - 1), iy + ih);
  c.lineTo(X(0), iy + ih);
  c.closePath();
  c.fillStyle = area;
  c.fill();
  c.beginPath();
  pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
  c.strokeStyle = accent;
  c.lineWidth = 7;
  c.lineJoin = "round";
  c.lineCap = "round";
  c.stroke();
  c.beginPath();
  c.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 12, 0, Math.PI * 2);
  c.fillStyle = accent;
  c.fill();

  // Estadísticas
  const boxes: Array<[string, string]> = [
    [t("ACIERTO"), s.closed ? `${Math.round(s.winRate)}%` : "—"],
    [t("PROFIT FACTOR"), s.closed ? (s.pf == null ? "∞" : s.pf.toFixed(2)) : "—"],
    [t("MEJOR OPERACIÓN"), s.closed ? `${fmtR(s.bestR)}R` : "—"],
  ];
  const bw = (pw - 40) / 3;
  boxes.forEach(([label, value], i) => {
    const bx = px + i * (bw + 20), by = 930;
    c.fillStyle = "rgba(16,23,32,0.85)";
    rr(c, bx, by, bw, 170, 24);
    c.fill();
    c.strokeStyle = "rgba(34,48,66,1)";
    c.lineWidth = 2;
    c.stroke();
    c.textAlign = "center";
    c.fillStyle = "#93a5ba";
    c.font = font(700, 22);
    c.fillText(label, bx + bw / 2, by + 56);
    c.fillStyle = "#e8eef6";
    c.font = font(700, 64);
    c.fillText(value, bx + bw / 2, by + 132);
  });

  // Pie
  c.fillStyle = "#e8eef6";
  c.font = font(700, 34);
  c.fillText(t("Llevá tu diario de trading con VELTRIX"), W / 2, 1146);
  c.fillStyle = "#2ec4f1";
  c.font = font(700, 28);
  c.fillText(code ? `www.veltrix-trading.com.ar  ·  ${t("Código")} ${code}` : "www.veltrix-trading.com.ar", W / 2, 1190);
  playBadge(c, W / 2, 1208);
  c.textAlign = "center";
  c.fillStyle = "#5f7389";
  c.font = font(500, 20);
  c.fillText(t("Resultados pasados no garantizan resultados futuros. No es asesoramiento financiero."), W / 2, 1310);
}

/** Insignia "Próximamente en Google Play" (mientras no exista el link a la ficha de la tienda). */
function playBadge(c: CanvasRenderingContext2D, cx: number, top: number) {
  const w = 440, h = 88, x = cx - w / 2;
  c.fillStyle = "#000";
  rr(c, x, top, w, h, 18);
  c.fill();
  c.strokeStyle = "#a6a6a6";
  c.lineWidth = 2;
  c.stroke();

  // Triángulo de Google Play en sus cuatro colores.
  const ix = x + 30, iy = top + 20, iw = 42, ih = 48;
  const P = (u: number, v: number): [number, number] => [ix + u * iw, iy + v * ih];
  const poly = (color: string, pts: Array<[number, number]>) => {
    c.beginPath();
    pts.forEach(([u, v], i) => (i ? c.lineTo(...P(u, v)) : c.moveTo(...P(u, v))));
    c.closePath();
    c.fillStyle = color;
    c.fill();
  };
  poly("#00a0ff", [[0, 0], [0.55, 0.5], [0, 1]]);
  poly("#00e676", [[0, 0], [0.74, 0.37], [0.55, 0.5]]);
  poly("#ffd500", [[0.74, 0.37], [1, 0.5], [0.74, 0.63], [0.55, 0.5]]);
  poly("#ff3d57", [[0, 1], [0.55, 0.5], [0.74, 0.63]]);

  c.textAlign = "left";
  c.fillStyle = "#fff";
  c.font = `700 15px "Space Grotesk", system-ui, sans-serif`;
  c.fillText(t("PRÓXIMAMENTE EN"), x + 96, top + 30);
  c.font = `700 40px "Space Grotesk", system-ui, sans-serif`;
  c.fillText("Google Play", x + 94, top + 70);
}

export default function ShareCard({
  trades,
  onClose,
  notify,
}: {
  trades: Trade[];
  onClose: () => void;
  notify: (msg: string, kind?: "ok" | "err" | "info") => void;
}) {
  const [period, setPeriod] = useState<SharePeriod>("week");
  const [code, setCode] = useState<string | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const summary = useMemo(() => summarize(trades, period), [trades, period]);

  // Código de invitación de la persona (si la función todavía no existe en el servidor, la tarjeta sale sin código).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.rpc("my_invite");
      const row = Array.isArray(data) ? data[0] : data;
      if (alive && !error && row?.code) setCode(String(row.code));
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogo(img);
    img.src = "/logo.png";
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await Promise.all([document.fonts.load('700 64px "Space Grotesk"'), document.fonts.load('500 26px "Space Grotesk"')]);
      } catch {
        /* se usa la fuente del sistema */
      }
      if (!cancelled && ref.current) draw(ref.current, summary, logo, code);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [summary, logo, code]);

  // toBlob no devuelve nada (avisa con la función que recibe), así que no se puede encadenar con «??»: eso resolvía siempre con null.
  const blob = () =>
    new Promise<Blob | null>((resolve) => {
      const canvas = ref.current;
      if (!canvas) return resolve(null);
      try {
        canvas.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });

  /** Guarda la imagen como archivo. El enlace tiene que estar en la página y la dirección temporal no se puede borrar enseguida, o el celular cancela la descarga. */
  const saveFile = (b: Blob): boolean => {
    try {
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = "veltrix-resultado.png";
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    } catch {
      return false;
    }
  };

  const download = async () => {
    const b = await blob();
    if (!b) return notify(t("No se pudo preparar la imagen. Probá de nuevo."), "err");
    if (saveFile(b)) notify(t("Imagen descargada."));
    else notify(t("No se pudo descargar. Probá con «Abrir la imagen»."), "err");
  };

  /** Plan B: abre la imagen en otra pestaña; ahí se puede mantener apretada y elegir «Descargar imagen». */
  const openImage = async () => {
    const b = await blob();
    if (!b) return notify(t("No se pudo preparar la imagen. Probá de nuevo."), "err");
    const url = URL.createObjectURL(b);
    if (!window.open(url, "_blank")) notify(t("El navegador bloqueó la ventana nueva. Permitila e intentá de nuevo."), "err");
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  };

  const link = code ? inviteLink(code) : `${SITE_URL}/?ref=tarjeta`;
  const postText = resultShareText(summary, link);

  /** Abre X con el post escrito y baja la imagen para adjuntarla (X no deja adjuntar imágenes desde un enlace). */
  const postOnX = async () => {
    const win = window.open(`https://x.com/intent/post?text=${encodeURIComponent(postText)}`, "_blank", "noopener");
    if (!win) notify(t("El navegador bloqueó la ventana nueva. Permitila e intentá de nuevo."), "err");
    const b = await blob();
    if (b && saveFile(b)) notify(t("Imagen descargada: adjuntala a tu post en X."), "info");
  };

  const share = async () => {
    const b = await blob();
    if (!b) return;
    const file = new File([b], "veltrix-resultado.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: t("Mi resultado en VELTRIX"), text: postText });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return; // el usuario canceló
        // El navegador no dejó abrir el menú de compartir: se descarga la imagen para que se pueda mandar igual.
        await download();
        notify(t("No se pudo abrir el menú de compartir; se descargó la imagen."), "info");
      }
    } else {
      await download();
      notify(t("Este navegador no permite compartir imágenes directo; se descargó para que la mandes desde tu galería."), "info");
    }
  };

  return (
    <div
      className="fade-in fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pop-in my-4 w-full max-w-md rounded-lg border border-line bg-panel shadow-[0_24px_70px_rgba(0,0,0,.6)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-xl font-bold tracking-wide text-snow">{t("Compartir mi resultado")}</h3>
          <button onClick={onClose} className="rounded p-1.5 text-fog hover:bg-raise hover:text-snow" aria-label={t("Cerrar")}>
            ✕
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex gap-1 rounded-lg border border-line bg-ink p-1">
            {PERIODS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={cx(
                  "flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors",
                  period === key ? "bg-gold text-ink" : "text-fog hover:text-snow",
                )}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <canvas ref={ref} className="w-full rounded-lg border border-line" style={{ aspectRatio: `${W} / ${H}` }} />
          <div className="flex gap-2">
            <button
              onClick={download}
              className="flex-1 rounded-md border border-line px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-fog transition-colors hover:border-line2 hover:text-snow"
            >
              {t("Descargar")}
            </button>
            <button
              onClick={share}
              className="flex-1 rounded-md bg-gold px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink transition-all hover:brightness-110"
            >
              {t("Compartir")}
            </button>
          </div>
          <button
            onClick={postOnX}
            className="w-full rounded-md border border-cyan/50 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-cyan transition-colors hover:bg-cyan/10"
          >
            {t("Publicar en X")}
          </button>
          <button onClick={openImage} className="w-full text-center text-[11px] font-semibold text-dim underline hover:text-fog">
            {t("¿No se descargó? Abrir la imagen")}
          </button>
          <p className="text-[10.5px] leading-relaxed text-dim">
            {t("La imagen muestra solo resultados en R: no incluye montos de dinero ni datos de tu cuenta.")}
          </p>
        </div>
      </div>
    </div>
  );
}

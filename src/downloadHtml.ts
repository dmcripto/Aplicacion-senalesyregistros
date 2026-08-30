// ─── DMCRIPTO · Exportación a HTML de un solo archivo ───────────────────────
// Arma un único archivo .html con el CSS y el JS incrustados (como la PWA
// original de un solo archivo). Requiere el build de producción, donde los
// assets son archivos estáticos que se pueden leer e incrustar.

export const STANDALONE_FILENAME = "dmcripto-diario.html";

const ICON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 2 28 7v9c0 8-5.4 12.6-12 14C9.4 28.6 4 24 4 16V7z' fill='%230d131b' stroke='%23f3b71e' stroke-width='2'/%3E%3Crect x='10' y='12' width='3' height='9' fill='%2316d98a'/%3E%3Crect x='11.2' y='9' width='.9' height='15' fill='%2316d98a'/%3E%3Crect x='19' y='9' width='3' height='9' fill='%23ff4d67'/%3E%3Crect x='20.2' y='7' width='.9' height='14' fill='%23ff4d67'/%3E%3C/svg%3E";

export async function buildStandaloneHtml(): Promise<string> {
  const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  if (!env?.PROD) throw new Error("DEV_MODE");

  const base = document.baseURI;
  const res = await fetch(new URL("index.html", base).href, { cache: "no-cache" });
  if (!res.ok) throw new Error("NO_INDEX");
  const raw = await res.text();
  const doc = new DOMParser().parseFromString(raw, "text/html");

  // 1) Hojas de estilo → <style> incrustado
  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("data:")) continue;
    const r = await fetch(new URL(href, base).href);
    if (r.ok) {
      const style = doc.createElement("style");
      style.textContent = await r.text();
      link.replaceWith(style);
    }
  }

  // 2) Scripts → <script type="module"> incrustado (el bundle no tiene imports)
  for (const s of Array.from(doc.querySelectorAll("script[src]"))) {
    const src = s.getAttribute("src");
    if (!src) continue;
    const r = await fetch(new URL(src, base).href);
    if (r.ok) {
      const script = doc.createElement("script");
      script.type = "module";
      script.textContent = await r.text();
      s.replaceWith(script);
    }
  }

  // 3) Limpieza: referencias que no existirían junto al archivo suelto
  doc
    .querySelectorAll('link[rel="modulepreload"], link[rel="manifest"]')
    .forEach((n) => n.remove());

  // 4) Ícono como data URI para que el archivo sea 100 % autónomo
  const icon = doc.querySelector('link[rel="icon"]');
  if (icon) icon.setAttribute("href", ICON_DATA_URI);

  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

export function downloadStandaloneHtml(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = STANDALONE_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

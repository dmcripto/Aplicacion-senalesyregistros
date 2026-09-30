// ─── VELTRIX · Idiomas ──────────────────────────────────────────────────────
// El texto en español es la clave: t("Hola {name}", { name }) devuelve el texto
// tal cual en español y su traducción (EN) cuando el idioma activo es inglés.
// Si a una frase le falta traducción, se muestra en español (nunca se rompe).

import { EN } from "./en";

export type Lang = "es" | "en";
export const LANGS: Array<{ code: Lang; label: string; short: string }> = [
  { code: "es", label: "Español", short: "ES" },
  { code: "en", label: "English", short: "EN" },
];

let current: Lang = "es";

export const getLang = (): Lang => current;
export const setLang = (l: Lang) => {
  current = l;
};

/** "es-AR" → "es" · "en-US" / cualquier otro → "en". Sin dato, español. */
export const detectLang = (locale?: string | null): Lang => {
  if (!locale) return "es";
  return locale.toLowerCase().startsWith("es") ? "es" : "en";
};

export const isLang = (v: unknown): v is Lang => v === "es" || v === "en";

/** Locale para fechas y números según el idioma activo. */
export const locale = () => (current === "en" ? "en-US" : "es-ES");

export function t(text: string, params?: Record<string, string | number>): string {
  let out = current === "en" ? (EN[text] ?? text) : text;
  if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return out;
}

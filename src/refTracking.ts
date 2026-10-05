import { cleanInvite, cleanRef } from "./lib";
import { supabase } from "./supabaseClient";

const REF_KEY = "veltrix_ref";
const VID_KEY = "veltrix_vid";
const INV_KEY = "veltrix_inv";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento: se sigue sin recordar */
  }
};

/** Identificador aleatorio del navegador, solo para contar visitantes distintos. No identifica a la persona. */
function visitorId(): string {
  let id = read(VID_KEY);
  if (!id) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    write(VID_KEY, id);
  }
  return id;
}

function send(ref: string, kind: "visit" | "signup") {
  void Promise.resolve(supabase.rpc("track_ref", { p_ref: ref, p_kind: kind, p_visitor: visitorId() })).catch(() => {});
}

/** Código de invitación con el que llegó la persona (si usó el enlace de un amigo). */
export const pendingInvite = () => cleanInvite(read(INV_KEY));

/**
 * Si el enlace trae ?ref=etiqueta, la recuerda (la primera que llegó) y cuenta una visita.
 * Si trae ?inv=CÓDIGO (enlace de un amigo), recuerda el código para usarlo al crear la cuenta.
 */
export function captureRef() {
  try {
    const url = new URL(window.location.href);
    const inv = cleanInvite(url.searchParams.get("inv"));
    let ref = cleanRef(url.searchParams.get("ref"));
    if (inv) {
      write(INV_KEY, inv);
      ref = ref ?? "invitacion"; // las visitas por invitaciones se cuentan juntas
    }
    if (!ref) return;
    if (!read(REF_KEY)) write(REF_KEY, ref);
    if (!sessionStorage.getItem(`veltrix_ref_seen_${ref}`)) {
      sessionStorage.setItem(`veltrix_ref_seen_${ref}`, "1");
      send(ref, "visit");
    }
    url.searchParams.delete("ref");
    url.searchParams.delete("inv"); // deja la dirección limpia
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  } catch {
    /* el seguimiento nunca debe romper la app */
  }
}

/** Al crear la cuenta: cuenta un registro para la etiqueta con la que llegó la persona. */
export function trackSignup() {
  const ref = cleanRef(read(REF_KEY));
  if (ref) send(ref, "signup");
}

// Resplandor e inclinación 3D que siguen al cursor en las tarjetas con la clase glow-card (se usa en la web y en el ingreso).

/** Empieza a seguir el cursor; devuelve la función para dejar de hacerlo. */
export function trackGlow(): () => void {
  const move = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".glow-card");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // Cuanto más grande el panel, menos se inclina (si no, los extremos se moverían demasiado). «soft» se inclina menos todavía.
    const max = Math.max(0.7, Math.min(3, 900 / Math.max(r.width, r.height))) * (el.dataset.tilt === "soft" ? 0.5 : 1);
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    el.style.setProperty("--tx", `${(-(y / r.height - 0.5) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--ty", `${((x / r.width - 0.5) * 2 * max).toFixed(2)}deg`);
  };
  window.addEventListener("pointermove", move, { passive: true });
  return () => window.removeEventListener("pointermove", move);
}

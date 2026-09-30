import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { t } from "../lib";
import { reportError } from "../errorReport";

/** Si algo falla al dibujar la pantalla, muestra un mensaje amable en vez de dejarla en blanco. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportError(error, (info.componentStack ?? "").slice(0, 280));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-4">
          <h1 className="font-display text-3xl font-bold text-snow">{t("Algo salió mal")}</h1>
          <p className="text-sm leading-relaxed text-fog">
            {t("Ya avisamos del problema para poder corregirlo. Recargá la página para seguir.")}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-gold px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider text-ink"
          >
            {t("Recargar")}
          </button>
        </div>
      </div>
    );
  }
}

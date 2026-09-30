import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { t } from "@dmcripto/core";
import { reportError } from "./errorReport";
import { colors } from "./theme";

/** Si algo falla al dibujar la pantalla, muestra un mensaje amable en vez de cerrar la app. */
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 }}>
        <Text style={{ color: colors.snow, fontSize: 22, fontWeight: "800", textAlign: "center" }}>{t("Algo salió mal")}</Text>
        <Text style={{ color: colors.fog, fontSize: 13.5, lineHeight: 20, textAlign: "center" }}>
          {t("Ya avisamos del problema para poder corregirlo. Tocá para seguir.")}
        </Text>
        <TouchableOpacity
          onPress={() => this.setState({ failed: false })}
          style={{ backgroundColor: colors.gold, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 22 }}
        >
          <Text style={{ color: colors.ink, fontWeight: "800", fontSize: 12.5 }}>{t("Reintentar")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

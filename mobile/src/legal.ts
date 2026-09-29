import { Linking } from "react-native";

const WEB = "https://aplicacion-senalesyregistros.vercel.app";
export const LEGAL_LINKS = {
  terms: `${WEB}/terms.html`,
  privacy: `${WEB}/privacy.html`,
  deleteData: `${WEB}/delete-account.html`,
} as const;

export const DISCLAIMER =
  "VELTRIX es una herramienta de registro y no constituye asesoramiento financiero ni recomendación de inversión. Operar implica riesgo de pérdida y los resultados pasados no garantizan resultados futuros. No está afiliado a TradingView.";

export const openLink = (url: string) => Linking.openURL(url).catch(() => {});

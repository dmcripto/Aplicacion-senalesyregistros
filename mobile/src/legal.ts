import { Linking } from "react-native";
import { getLang, t } from "@dmcripto/core";

const WEB = "https://aplicacion-senalesyregistros.vercel.app";
const page = (name: string) => `${WEB}/${name}${getLang() === "en" ? "-en" : ""}.html`;
/** Páginas legales en el idioma activo (getters: se leen al tocar, no al importar). */
export const LEGAL_LINKS = {
  get terms() {
    return page("terms");
  },
  get privacy() {
    return page("privacy");
  },
  get deleteData() {
    return page("delete-account");
  },
};

export const disclaimer = () =>
  t("VELTRIX es una herramienta de registro y no constituye asesoramiento financiero ni recomendación de inversión. Operar implica riesgo de pérdida y los resultados pasados no garantizan resultados futuros. No está afiliado a TradingView.");

export const openLink = (url: string) => Linking.openURL(url).catch(() => {});

export const COMMUNITY_URL = "https://t.me/DMCRIPTOCOMU";

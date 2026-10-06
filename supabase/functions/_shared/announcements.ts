// Avisos oficiales de VELTRIX que el dueño de la cuenta puede publicar en sus comunidades de Telegram
// (con /anunciar en el chat privado con el bot). El texto es fijo: así nunca sale algo escrito a las apuradas.

export interface Announcement {
  es: string;
  en: string;
}

const APP_URL = "veltrix-trading.vercel.app/app";

export const ANNOUNCEMENTS: Record<string, Announcement> = {
  bot: {
    es: [
      "📢 <b>Nueva versión de VELTRIX: llega el BOT AUTOMÁTICO (modo simulado)</b>",
      "",
      "Actualizamos la web y la app. Lo más importante:",
      "",
      "🤖 <b>Bot automático, en modo simulado</b>",
      "Un bot que mira el mercado por vos y anota las operaciones en tu diario con la etiqueta «Bot simulado». Se enciende y se apaga con un interruptor.",
      "",
      "⚠️ Es <b>SIMULADO</b>: no usa dinero real, no toca tu exchange y no opera por vos. Sirve para medir si una estrategia funciona antes de pensar en nada más. No es asesoramiento financiero y los resultados pasados no garantizan nada.",
      "",
      "Qué podés hacer:",
      "• Elegir tu perfil: Conservador, Equilibrado, Dinámico o Lento (velas de 4 horas).",
      "• Elegir qué mira: tus activos, o además los 20 o 40 futuros cripto más operados.",
      "• Aplicar al bot las reglas de tu «Estrategia sugerida» (armada con tus propias operaciones).",
      "• Probarlo con el historial («Probar con los últimos 4 meses» y el laboratorio de variantes de 1 año). Te muestra los resultados tal cual, ganen o pierdan.",
      "• Recibir un aviso en la app y en tu Telegram cada vez que el bot abre o cierra una operación (se puede apagar).",
      "",
      "🧭 <b>Más fácil de usar</b>",
      "• Arriba de la web y de Ajustes en la app hay botones fijos para ir directo a Exchanges, Bot, Telegram, Capital y Límites.",
      "• Estrategia sugerida, ahora por cada exchange que conectaste, con un desplegable.",
      "• Exchanges compatibles (solo lectura): Binance, Bybit, MEXC, Bitunix, Gate, Bitget, OKX, KuCoin y BingX.",
      "",
      "📲 <b>Cómo actualizar la app (Android)</b>",
      `1️⃣ Entrá a ${APP_URL} y tocá Descargar.`,
      "2️⃣ Instalala encima de la versión que tenés. No perdés nada: tus operaciones están en tu cuenta.",
      "3️⃣ Si Android avisa que es un archivo de fuera de la tienda, es normal: la app no está en Google Play, se descarga directo.",
      "",
      "La web se actualiza sola: solo recargá la página.",
      "",
      "🔒 Recordatorio de seguridad: conectá tu exchange siempre con una clave de SOLO LECTURA y nunca compartas tu clave secreta con nadie.",
      "",
      "Si algo no te funciona, escribinos y lo vemos. 🙌",
    ].join("\n"),
    en: [
      "📢 <b>New VELTRIX version: the AUTOMATIC BOT arrives (simulated mode)</b>",
      "",
      "We updated the web and the app. The highlights:",
      "",
      "🤖 <b>Automatic bot, in simulated mode</b>",
      "A bot that watches the market for you and logs trades in your journal tagged “Simulated bot”. You turn it on and off with a switch.",
      "",
      "⚠️ It is <b>SIMULATED</b>: no real money, it doesn't touch your exchange and it doesn't trade for you. It's there to measure whether a strategy works before thinking about anything else. Not financial advice, and past results guarantee nothing.",
      "",
      "What you can do:",
      "• Pick your profile: Conservative, Balanced, Dynamic or Slow (4-hour candles).",
      "• Pick what it watches: your assets, or also the 20 or 40 most traded crypto futures.",
      "• Apply the rules from your “Suggested strategy” (built from your own trades) to the bot.",
      "• Test it on history (“Test with the last 4 months” and the 1-year variant lab). It shows the results as they are, win or lose.",
      "• Get an alert in the app and on your Telegram each time the bot opens or closes a trade (can be turned off).",
      "",
      "🧭 <b>Easier to use</b>",
      "• Fixed shortcut buttons at the top of the web and of Settings in the app take you straight to Exchanges, Bot, Telegram, Capital and Limits.",
      "• Suggested strategy, now per connected exchange, with a dropdown.",
      "• Supported exchanges (read-only): Binance, Bybit, MEXC, Bitunix, Gate, Bitget, OKX, KuCoin and BingX.",
      "",
      "📲 <b>How to update the app (Android)</b>",
      `1️⃣ Go to ${APP_URL} and tap Download.`,
      "2️⃣ Install it over the version you have. You lose nothing: your trades live in your account.",
      "3️⃣ If Android warns that it's a file from outside the store, that's normal: the app isn't on Google Play, it's downloaded directly.",
      "",
      "The web updates by itself: just reload the page.",
      "",
      "🔒 Security reminder: always connect your exchange with a READ-ONLY key and never share your secret key with anyone.",
      "",
      "If something doesn't work, write to us and we'll look into it. 🙌",
    ].join("\n"),
  },
};

export const announcementIds = () => Object.keys(ANNOUNCEMENTS);

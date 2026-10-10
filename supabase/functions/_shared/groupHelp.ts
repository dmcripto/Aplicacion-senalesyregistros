// VELTRIX · /ayuda en el grupo: qué puede pedirle cualquiera al bot y qué queda para los administradores.

export function groupHelpMessage(lang: "es" | "en"): string {
  return lang === "es"
    ? [
        "🤖 <b>Qué puedo hacer en este grupo</b>",
        "",
        "<b>Para todos</b>",
        "💹 <code>/precio</code> — precio y variación de 24 h (ej: <code>/precio BTC ETH</code>)",
        "📈 <code>/grafico BTC 4h</code> — gráfico con velas (agregá <code>ema</code>, <code>rsi</code> o <code>liq</code>)",
        "📍 <code>/niveles BTC</code> — precio, RSI, tendencia y señales abiertas",
        "🧮 <code>/calc 65000 64500 1000 1</code> — tamaño de la posición (entrada, stop, capital, riesgo %)",
        "🏆 <code>/semana</code> — ranking de la semana",
        "❓ <code>/ayuda</code> — este mensaje",
        "",
        "<b>Solo administradores</b>",
        "👋 <code>/bienvenida</code> — mensaje de bienvenida · 📰 <code>/noticias</code> — agenda económica · 📣 <code>/anunciar</code>",
        "",
        "Las señales y los avisos de VELTRIX llegan solos a este grupo.",
      ].join("\n")
    : [
        "🤖 <b>What I can do in this group</b>",
        "",
        "<b>For everyone</b>",
        "💹 <code>/price</code> — price and 24 h change (e.g. <code>/price BTC ETH</code>)",
        "📈 <code>/chart BTC 4h</code> — candlestick chart (add <code>ema</code>, <code>rsi</code> or <code>liq</code>)",
        "📍 <code>/levels BTC</code> — price, RSI, trend and open signals",
        "🧮 <code>/calc 65000 64500 1000 1</code> — position size (entry, stop, capital, risk %)",
        "🏆 <code>/week</code> — this week's ranking",
        "❓ <code>/help</code> — this message",
        "",
        "<b>Admins only</b>",
        "👋 <code>/welcome</code> — welcome message · 📰 <code>/news</code> — economic calendar · 📣 <code>/announce</code>",
        "",
        "VELTRIX signals and alerts arrive in this group on their own.",
      ].join("\n");
}

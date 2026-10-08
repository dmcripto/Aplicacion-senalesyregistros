// VELTRIX · /ayuda en el grupo: qué puede pedirle cualquiera al bot y qué queda para los administradores.

export function groupHelpMessage(lang: "es" | "en"): string {
  return lang === "es"
    ? [
        "🤖 <b>Qué puedo hacer en este grupo</b>",
        "",
        "<b>Para todos</b>",
        "💹 <code>/precio</code> — precio y variación de 24 h (ej: <code>/precio BTC ETH</code>)",
        "📈 <code>/grafico BTC 4h</code> — gráfico con velas (agregá <code>ema</code>, <code>rsi</code> o <code>liq</code>)",
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
        "❓ <code>/help</code> — this message",
        "",
        "<b>Admins only</b>",
        "👋 <code>/welcome</code> — welcome message · 📰 <code>/news</code> — economic calendar · 📣 <code>/announce</code>",
        "",
        "VELTRIX signals and alerts arrive in this group on their own.",
      ].join("\n");
}

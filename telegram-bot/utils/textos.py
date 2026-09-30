"""Todo el texto del bot en español. Edita aquí reglas y FAQ."""

AVISO = "⚠️ No es asesoría financiera."

REGLAS = (
    "📜 <b>Reglas de DMCRIPTO</b>\n\n"
    "1. Respeta a todos los miembros.\n"
    "2. Prohibido el spam y la publicidad no autorizada.\n"
    "3. No se permiten enlaces de usuarios nuevos.\n"
    "4. Nada de estafas, esquemas de \"duplica tu dinero\" ni promesas de ganancias.\n"
    "5. Nunca compartas tus claves privadas ni frases semilla.\n"
    "6. Cada quien es responsable de sus propias decisiones de inversión."
)

FAQ = (
    "❓ <b>Preguntas frecuentes</b>\n\n"
    "<b>¿Qué es DMCRIPTO?</b>\nUna comunidad para aprender y compartir sobre trading de cripto.\n\n"
    "<b>¿Dan señales garantizadas?</b>\nNo. Todo el contenido es educativo y el mercado tiene riesgo.\n\n"
    "<b>¿Por qué borraron mi enlace?</b>\nLos usuarios nuevos no pueden enviar enlaces durante sus primeras horas.\n\n"
    "<b>¿Cómo reporto un problema?</b>\nEscribe a un administrador del grupo."
)

AYUDA = (
    "🤖 <b>Comandos disponibles</b>\n\n"
    "/reglas - Ver las reglas del grupo\n"
    "/faq - Preguntas frecuentes\n"
    "/ayuda - Mostrar este mensaje"
)

BIENVENIDA = (
    "👋 ¡Bienvenido/a a <b>DMCRIPTO</b>, {mencion}!\n\n"
    "Por favor lee las reglas:\n\n{reglas}"
)


def con_aviso(texto: str) -> str:
    return f"{texto}\n\n{AVISO}"

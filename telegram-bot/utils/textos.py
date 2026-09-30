"""Todo el texto del bot en español. Edita aquí reglas y FAQ."""

AVISO = "⚠️ No es asesoría financiera."

REGLAS = (
    "📜 <b>Reglas de DMCRIPTO</b>\n\n"
    "1️⃣ <b>Respeto ante todo.</b> Nada de insultos, acoso, discriminación ni ataques personales. "
    "Se debate con ideas, no con agresiones.\n\n"
    "2️⃣ <b>Cero spam y publicidad.</b> No se permite promocionar canales, grupos, servicios, "
    "cursos ni proyectos sin autorización de un administrador. Repetir mensajes se borra.\n\n"
    "3️⃣ <b>Enlaces.</b> Los miembros nuevos no pueden enviar enlaces durante sus primeras 24 horas.\n\n"
    "4️⃣ <b>Sin estafas ni promesas.</b> Prohibido ofrecer \"ganancias garantizadas\", duplicar dinero, "
    "esquemas piramidales, airdrops sospechosos o pedir depósitos.\n\n"
    "5️⃣ <b>Protege tu seguridad.</b> Nunca compartas tu frase semilla, claves privadas ni códigos de "
    "verificación. Ningún administrador te los pedirá jamás. Desconfía de los mensajes privados "
    "de \"soporte\".\n\n"
    "6️⃣ <b>Comparte análisis con criterio.</b> Si publicas una idea de trading, explica tu razonamiento "
    "(activo, entrada, stop, plazo). Las ideas son opiniones, no órdenes.\n\n"
    "7️⃣ <b>Ordena el chat.</b> Sin mayúsculas excesivas ni cadenas de mensajes. "
    "Consulta el /faq antes de preguntar lo básico.\n\n"
    "8️⃣ <b>Decisiones propias.</b> Cada persona es responsable de su dinero y de sus operaciones.\n\n"
    "Incumplir las reglas puede llevar a que se borren tus mensajes, a una advertencia o a la expulsión."
)

FAQ = (
    "❓ <b>Preguntas frecuentes</b>\n\n"
    "<b>¿Qué es DMCRIPTO?</b>\n"
    "Una comunidad para aprender, compartir análisis y conversar sobre trading de criptomonedas.\n\n"
    "<b>¿Dan señales o resultados garantizados?</b>\n"
    "No. Todo el contenido es educativo e informativo. El trading de cripto es muy volátil y "
    "puedes perder parte o todo tu capital.\n\n"
    "<b>¿Cuánto dinero necesito para empezar?</b>\n"
    "Nunca inviertas dinero que no puedas permitirte perder. Empieza con montos pequeños "
    "y aprende primero.\n\n"
    "<b>Soy nuevo, ¿por dónde empiezo?</b>\n"
    "Lee las /reglas, cuéntanos tu nivel de experiencia y aprende lo básico: gestión del riesgo, "
    "stop loss, tamaño de posición y la diferencia entre spot y futuros.\n\n"
    "<b>¿Por qué borraron mi mensaje o enlace?</b>\n"
    "Los miembros nuevos no pueden enviar enlaces durante las primeras 24 horas, y los mensajes "
    "repetidos se eliminan automáticamente. Es una medida contra el spam.\n\n"
    "<b>¿Me pueden pedir mi frase semilla o mis claves?</b>\n"
    "Jamás. Nadie de DMCRIPTO te las pedirá. Si alguien lo hace es una estafa: no respondas "
    "y avisa a un administrador.\n\n"
    "<b>Me escribieron por privado ofreciendo inversiones.</b>\n"
    "Ignóralo y repórtalo. Los administradores no ofrecen inversiones por mensaje directo.\n\n"
    "<b>¿Puedo promocionar mi canal o proyecto?</b>\n"
    "Solo con permiso previo de un administrador.\n\n"
    "<b>¿Cómo reporto un problema o a un usuario?</b>\n"
    "Escribe a un administrador del grupo."
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

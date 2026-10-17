# VELTRIX · cómo proteger el proyecto

Última actualización: 17/10/2026. Esto es una guía técnica, no asesoramiento legal: para marca y derecho de autor conviene consultar a un abogado o a un gestor de propiedad intelectual.

## Estado hoy (revisado el 17/10/2026)

- **El repositorio de GitHub es PÚBLICO** (`dmcripto/Aplicacion-senalesyregistros`, forks permitidos). Cualquiera puede leer, clonar o forkear todo el código: la web, la app, las funciones del servidor, las estrategias del bot, los SQL y las carpetas `entrega-*`. Es el mayor punto débil.
- Había una licencia MIT en `mobile/LICENSE` (copiada de la plantilla de Expo): en un repo público, eso podía interpretarse como que el código de la app se puede copiar libremente. **Ya se reemplazó** por una licencia propietaria.
- No se encontraron claves secretas en el historial del repositorio (se revisó: claves de Anthropic, de Supabase y tokens de Telegram). Los secretos viven solo en los *Secrets* de Supabase. Bien.
- Forks: 0. No se vio ninguna copia en GitHub al 17/10, pero lo que ya se publicó pudo haberse clonado sin dejar rastro.
- El código del servidor (funciones de Supabase) y los datos NO se ven desde afuera: eso está bien protegido.

## Hecho en el código (17/10/2026)

- `LICENSE` propietaria en la raíz y en `mobile/` («todos los derechos reservados», ES/EN). `"license": "UNLICENSED"` en los `package.json`.
- Términos de uso (ES/EN): nueva sección «Propiedad intelectual» (no copiar, no revender señales, no hacer scraping, no descompilar, no usar el nombre/logo).
- Aviso de derechos reservados en el pie de la web.

## Lo que tenés que hacer vos (en este orden)

1. **Pasar el repositorio a privado** — pero NO antes de resolver las descargas del APK (ver punto 2), porque el link de descarga está en GitHub Releases y dejaría de funcionar.
   GitHub → el repo → Settings → General → *Danger Zone* → *Change repository visibility* → Make private.
   Después, Settings → General → desmarcar *Allow forking*. Vercel y las compilaciones de Android siguen funcionando con repo privado (las compilaciones usan los minutos gratis de GitHub Actions).
2. **Repositorio aparte solo para las descargas** (público, vacío, sin código): por ejemplo `veltrix-descargas`. Las versiones del APK se publican ahí y los links de descarga apuntan ahí. Hay que crear un token de GitHub (fine-grained, solo ese repo, permiso *Contents: write*) y guardarlo como secreto `RELEASES_TOKEN` del repo principal. Cuando lo tengas, avisame y cambio el workflow de compilación y los links.
3. **Seguridad de las cuentas**: activá verificación en dos pasos en GitHub, Supabase, Vercel, Expo, Telegram (BotFather no tiene 2FA: protegé el teléfono), tu correo y tu cuenta de Anthropic. Si te roban una de esas cuentas, te roban el proyecto.
4. **GitHub → Settings → Branches**: proteger `main` (exigir que pasen las pruebas). En *Code security*: activar *Secret scanning* y *Push protection*.
5. **Registro de la marca VELTRIX en el INPI (Argentina)**: clases relacionadas con software (9 y 42) y servicios financieros/información (36). Es lo que permite actuar si alguien usa tu nombre o logo.
6. **Registro del software ante la Dirección Nacional del Derecho de Autor**: se hace con un depósito del código (puede ser una parte y/o un hash). Da una prueba oficial de autoría y fecha.
7. **Evidencia de autoría**: el historial de git ya muestra fechas y autoría; guardá una copia del repositorio completo y del ZIP de la entrega fuera de GitHub.

## Lo que NO se puede impedir (y cómo se mitiga)

- **La web y la app se pueden inspeccionar.** Cualquier persona puede bajar el JavaScript de la web o abrir el APK. Se puede dificultar (minificar, ofuscar), no impedir. Por eso la regla es: **lo valioso vive en el servidor** (funciones de Supabase), nunca en la web ni en la app.
  - Hoy ya está así: el bot, las señales, el filtro de desbloqueos y los datos corren en el servidor. En la web/app solo están las pantallas y los números de los perfiles que ya se muestran a los usuarios.
  - Regla para lo nuevo: las ideas que se prueben (filtros de liquidez, Smart Money, etc.) se implementan **solo en el servidor**.
- **Una copia de la web sin tu servidor no funciona**: no tiene tus funciones, tus datos ni tus claves. Lo que protege la base de datos es la seguridad por filas (RLS) y el inicio de sesión.
- **Alguien puede copiar las ideas** que ve funcionando (p. ej. un perfil publicado). Las ideas no se patentan; lo que se protege es el código, la marca, los datos y la comunidad.

## Pendientes técnicos que puedo hacer cuando quieras

- Mover las descargas del APK a un repositorio público aparte y actualizar los links (necesita el paso 2).
- Activar la reducción y ofuscación del código de la app (R8/ProGuard) en el APK; hay que probar una compilación.
- Sacar del repositorio las carpetas `entrega-*` (contienen las funciones completas) y guardarlas solo en tu PC.
- Limitar la frecuencia de pedidos (rate limit) y agregar avisos de uso anormal en las funciones públicas.
- Marcas de agua en las señales publicadas (un identificador discreto por canal) para detectar quién las filtra.

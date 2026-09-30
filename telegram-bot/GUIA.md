# Guía paso a paso: bot de DMCRIPTO

Esta guía te lleva desde cero hasta tener el bot moderando tu grupo 24/7.
Hazla en orden. Si un paso falla, ve a **"Si algo sale mal"** al final.

---

## Parte 1: Antes de empezar

Necesitas:
- El **token** del bot (te lo dio @BotFather al crearlo).
- **Python 3.10 o superior**. Compruébalo con `python3 --version` (en Windows: `python --version`). Si no lo tienes, descárgalo de https://www.python.org/downloads/ (en Windows marca **"Add Python to PATH"** al instalar).
- **Git** instalado (https://git-scm.com/downloads).

> 🔒 **Regla de oro:** el token es como la contraseña del bot. Nunca lo pegues en chats, capturas, grupos ni en GitHub. Si se filtra: @BotFather → `/revoke`.

---

## Parte 2: Configurar el bot en Telegram (@BotFather)

Abre @BotFather y envía estos comandos. Elige tu bot cuando te lo pida:

1. `/setprivacy` → **Disable**
   Sin esto, el bot no puede leer los mensajes del grupo y no podrá moderar.
2. `/setjoingroups` → **Enable** (para poder añadirlo a grupos).
3. (Opcional) `/setcommands` y pega esto para que aparezca el menú de comandos:
   ```
   reglas - Ver las reglas del grupo
   faq - Preguntas frecuentes
   ayuda - Lista de comandos
   ```

---

## Parte 3: Instalar el bot en tu computador

### 3.1 Descargar el código
```bash
git clone https://github.com/dmcripto/aplicacion-senalesyregistros.git
cd aplicacion-senalesyregistros
git checkout ccr-be1ae783-n4nrn9
cd telegram-bot
```

### 3.2 Crear el entorno e instalar dependencias

**Mac / Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Windows (PowerShell):**
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
Si PowerShell bloquea el script, ejecuta una vez:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 3.3 Poner el token
```bash
cp .env.example .env        # Windows: copy .env.example .env
```
Abre `.env` con un editor de texto y deja **exactamente** esto (sin comillas ni espacios):
```
TELEGRAM_BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
El archivo `.env` está en el `.gitignore`, así que no se sube a GitHub.

---

## Parte 4: Añadir el bot al grupo

1. Abre tu grupo → **Añadir miembro** → busca el usuario de tu bot.
2. Entra a la configuración del grupo → **Administradores** → añade el bot.
3. Actívale al menos el permiso **"Eliminar mensajes"**. Los demás pueden quedar apagados.

> Sin ser administrador el bot **no puede borrar** nada. Solo lo verás en el log como `error_al_borrar`.

---

## Parte 5: Encender y probar

```bash
python bot.py
```
Debe aparecer: `Bot DMCRIPTO iniciado.` (déjalo abierto).

**Lista de pruebas** (usa una segunda cuenta de Telegram):

| Prueba | Resultado esperado |
|---|---|
| Escribe `/reglas` en el grupo | Reglas + "No es asesoría financiera" |
| Escribe `/faq` y `/ayuda` | Respuestas en español con el aviso |
| Entra a la cuenta de prueba al grupo | Bienvenida mencionándola, con reglas |
| Con esa cuenta, envía un enlace | Se borra el mensaje |
| Con esa cuenta, envía el mismo texto 3 veces seguidas | Se borra a partir de la 3.ª vez |
| Envía un enlace desde tu cuenta de admin | **No** se borra (los admins están exentos) |

Revisa `moderacion.log`: cada borrado debe aparecer con fecha, usuario y motivo.

Para apagar el bot: `Ctrl + C`.

---

## Parte 6: Personalizarlo

| Qué quieres cambiar | Dónde |
|---|---|
| Reglas, FAQ, mensaje de bienvenida, aviso legal | `utils/textos.py` |
| Horas que un usuario es "nuevo" (24 h) | `config.py` → `HORAS_USUARIO_NUEVO` |
| Cuántas repeticiones se toleran (3 en 60 s) | `config.py` → `REPETIDOS_MAX` y `REPETIDOS_VENTANA_SEG` |
| Usuarios de confianza | `trusted_users.json` |

**Usuarios de confianza:** pon sus IDs numéricos (no el @usuario). Para saber un ID, la persona escribe a @userinfobot.
```json
{ "usuarios_confianza": [123456789, 987654321] }
```
Los administradores del grupo ya están exentos automáticamente.

Después de cambiar algo, reinicia el bot.

---

## Parte 7: Dejarlo activo 24/7

Mientras tu computador esté apagado o cerrado, el bot no funciona. Para tenerlo siempre activo necesitas un **VPS** (servidor en la nube) o un equipo que nunca se apague.

### 7.1 Contratar un VPS
Cualquier proveedor sirve (Hetzner, DigitalOcean, Contabo, Vultr, etc.). Con **1 GB de RAM y Ubuntu 22.04/24.04** sobra; cuesta unos 4–6 USD al mes.

### 7.2 Conectarte y preparar
```bash
ssh root@IP_DE_TU_SERVIDOR
adduser bot                       # crea un usuario normal (pon una contraseña)
apt update && apt install -y python3 python3-venv git
su - bot
```

### 7.3 Instalar el bot en el servidor
Repite la **Parte 3** dentro del servidor (clonar, venv, `pip install`, crear `.env` con el token).
Para editar `.env` en el servidor: `nano .env` → pega → `Ctrl+O`, Enter, `Ctrl+X`.

Prueba una vez con `python bot.py`; si funciona, ciérralo con `Ctrl+C`.

### 7.4 Crear el servicio (se reinicia solo)
Vuelve a root (`exit`) y crea el archivo:
```bash
nano /etc/systemd/system/dmcripto-bot.service
```
Pega esto (ajusta la ruta si es distinta):
```ini
[Unit]
Description=Bot DMCRIPTO
After=network-online.target
Wants=network-online.target

[Service]
User=bot
WorkingDirectory=/home/bot/aplicacion-senalesyregistros/telegram-bot
ExecStart=/home/bot/aplicacion-senalesyregistros/telegram-bot/.venv/bin/python bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Actívalo:
```bash
systemctl daemon-reload
systemctl enable --now dmcripto-bot
systemctl status dmcripto-bot     # debe decir "active (running)"
```

### 7.5 Comandos del día a día
```bash
systemctl restart dmcripto-bot          # reiniciar tras cambiar algo
systemctl stop dmcripto-bot             # apagar
journalctl -u dmcripto-bot -n 50        # ver los últimos mensajes del bot
tail -f /home/bot/aplicacion-senalesyregistros/telegram-bot/moderacion.log   # log de moderación
```
El servicio arranca solo si el servidor se reinicia o si el bot se cae.

### 7.6 Actualizar el bot
```bash
su - bot
cd aplicacion-senalesyregistros && git pull
exit
systemctl restart dmcripto-bot
```

---

## Parte 8: Seguridad (repaso)

- ✅ El token vive solo en `.env` (fuera de GitHub).
- ✅ El bot no imprime ni registra el token.
- ❌ Nunca compartas el token ni el archivo `.env`.
- 🔁 Si sospechas que se filtró: @BotFather → `/revoke`, y pega el nuevo en `.env`.
- 👤 No corras el bot como `root`; usa el usuario `bot` como en esta guía.
- 🔐 En el VPS, entra con llaves SSH y desactiva la contraseña cuando puedas.

---

## Si algo sale mal

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Falta TELEGRAM_BOT_TOKEN` | `.env` no existe o está vacío | Revisa la Parte 3.3 |
| `InvalidToken` / `Unauthorized` | Token mal copiado o revocado | Copia de nuevo desde @BotFather, sin espacios |
| No responde a los comandos | Bot apagado, o no está en el grupo | Revisa que `python bot.py` esté corriendo |
| Responde a comandos pero no borra | No es administrador o sin permiso de eliminar | Parte 4 |
| No modera mensajes normales | Privacidad activada | `/setprivacy` → Disable, y **saca y vuelve a meter el bot** al grupo |
| No da la bienvenida | Mismo caso, o el bot no es admin | Igual que arriba |
| `Conflict: terminated by other getUpdates request` | Hay **dos copias** del bot corriendo con el mismo token | Apaga la otra (tu PC o el servidor) |
| `ModuleNotFoundError` | Entorno virtual no activado | `source .venv/bin/activate` y `pip install -r requirements.txt` |
| Borra enlaces a usuarios que ya no son nuevos | Es normal tras reiniciar: el bot solo recuerda a quienes vio entrar | Ver "Límites" |

## Límites de esta versión

- Solo considera "nuevo" a quien vio entrar mientras estaba encendido; si se reinicia, olvida esa lista.
- Solo detecta enlaces que Telegram marca como enlace (`http://`, `www.`, texto con hipervínculo).
- Es un antispam básico. Si necesitas más (silenciar, expulsar, captcha), se agrega como un módulo nuevo en `handlers/`.

## Mapa del proyecto

```
bot.py               arranque
config.py            token y límites
handlers/            bienvenida.py · antispam.py · comandos.py
utils/               textos.py · confianza.py · logger_mod.py
trusted_users.json   usuarios de confianza
moderacion.log       registro de moderación (se crea solo)
```

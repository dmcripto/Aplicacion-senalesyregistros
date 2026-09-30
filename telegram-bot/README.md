# Bot de Telegram DMCRIPTO

## Instalar
```bash
cd telegram-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # pega tu token de @BotFather en TELEGRAM_BOT_TOKEN
```

## Correr
```bash
python bot.py
```
En @BotFather desactiva la privacidad (`/setprivacy` → Disable), añade el bot al grupo y hazlo **administrador** con permiso para borrar mensajes.

## Configurar
- Textos (reglas, FAQ, aviso): `utils/textos.py`
- Límites del antispam: `config.py`
- Usuarios de confianza: IDs en `trusted_users.json` (los admins ya están exentos)
- Registro de moderación: `moderacion.log`

## Dejarlo activo 24/7 (VPS + systemd)
Crea `/etc/systemd/system/dmcripto-bot.service`:
```ini
[Unit]
Description=Bot DMCRIPTO
After=network-online.target

[Service]
WorkingDirectory=/ruta/a/telegram-bot
ExecStart=/ruta/a/telegram-bot/.venv/bin/python bot.py
Restart=always
RestartSec=5
User=TU_USUARIO

[Install]
WantedBy=multi-user.target
```
Luego: `sudo systemctl enable --now dmcripto-bot` (ver estado: `systemctl status dmcripto-bot`).

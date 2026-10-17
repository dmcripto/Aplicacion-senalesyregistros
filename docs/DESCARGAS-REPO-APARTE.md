# Descargas del APK en un repositorio aparte (para poder pasar el principal a privado)

Objetivo: que el código viva en un repositorio **privado** y que el APK se descargue desde un repositorio **público y vacío de código** (`veltrix-descargas`).

## Paso a paso (lo hacés vos en GitHub)

1. **Crear el repositorio de descargas**
   GitHub → botón «New» → Owner `dmcripto` → nombre **`veltrix-descargas`** → **Public** → marcá «Add a README file» → Create.
   (Tiene que llamarse así, porque el nombre está fijado en el workflow y en la validación de la app.)
2. **Crear un token solo para ese repositorio**
   GitHub → tu foto → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Name: `veltrix-releases` · Expiration: 1 año (anotá la fecha para renovarlo).
   - Repository access: **Only select repositories** → `veltrix-descargas`.
   - Permissions → Repository permissions → **Contents: Read and write**.
   - Generate token y **copiá el texto** (empieza con `github_pat_`; no se vuelve a mostrar). No lo pegues en el chat.
3. **Guardarlo como secreto del repositorio principal**
   `Aplicacion-senalesyregistros` → Settings → Secrets and variables → Actions → **New repository secret** → Name: `RELEASES_TOKEN` → pegá el token → Add secret.
4. **Avisarme.** Entonces lanzo la compilación de la app 1.6.1 con «publicar»: el APK queda en `veltrix-descargas` y actualizo los links de la web y `version.json`.
5. **Probar la descarga** desde la web (en el celular) y, si anda, recién ahí **pasar el repositorio principal a privado** (Settings → General → Danger Zone → Change visibility → Make private; después desmarcá «Allow forking»).

## Cosas a saber

- Las apps ya instaladas (1.5.1 y 1.6.0) solo aceptan avisos de actualización de la dirección vieja; **no van a mostrar el aviso de la versión 1.6.1**. Quienes las tengan deben bajar el APK nuevo desde la web una vez. La 1.6.1 en adelante ya acepta el repositorio de descargas.
- Los links viejos de GitHub Releases del repositorio principal dejan de funcionar al pasarlo a privado.
- El token vence: anotá la fecha. Si vence, la compilación con «publicar» falla al subir el APK (la compilación en sí no se pierde: queda como archivo de la ejecución durante 30 días).
- Vercel (la web) y las compilaciones de Android siguen funcionando con el repositorio privado.

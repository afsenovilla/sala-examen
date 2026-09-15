# Sala de examen

Web estática para practicar exámenes de certificación. Sin backend, sin build: son archivos que se sirven tal cual.

```
index.html                 página única (router por #hash)
assets/style.css
assets/app.js              motor: práctica, simulacro, resultados, listado
data/exams.json            catálogo de exámenes
data/mc-next-consultant.json   banco de 116 preguntas
manifest.webmanifest, sw.js, assets/icon*   PWA + caché offline
CNAME                      sfmc.asuntosimportant.es (dominio de GitHub Pages)
```

Importante: **tiene que servirse por HTTP(S)**. Si abres `index.html` con doble clic (`file://`) el navegador bloquea la lectura de los JSON y verás un aviso. Para probar en local:

```bash
cd sala-examen && python3 -m http.server 8000   # http://localhost:8000
```

---

## Opción A — GitHub Pages (gratis, repo público)

1. Crea el repo y sube el contenido de esta carpeta a la raíz de `main`.
2. Settings → Pages → Source: *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. Settings → Pages → Custom domain: escribe `sfmc.asuntosimportant.es`. Eso crea/actualiza el archivo `CNAME`, que ya viene con `sfmc.asuntosimportant.es`.
4. En tu DNS, añade un registro **CNAME**: `sfmc` → `afsenovilla.github.io.` (con el punto final si tu panel lo pide). Nada de registro A.
5. Espera a la validación del dominio y marca **Enforce HTTPS**.

Tarda unos minutos en propagar. Si cambias archivos, el despliegue es automático con cada push.

### Sobre hacerlo privado
No se puede como quieres:

- **Repo privado + Pages** requiere plan de pago (GitHub Pro, Team o Enterprise). Con el plan Free, Pages solo funciona desde repos públicos.
- Y aunque pagues, **el sitio publicado sigue siendo público en internet**: la documentación lo dice explícitamente. El control de acceso a un sitio de Pages solo existe en Enterprise Cloud.

O sea: en GitHub, repo privado ≠ web privada. Si lo que te preocupa es que nadie vea el código del banco de preguntas, el propio HTML/JSON se descarga en el navegador de quien entre, así que con Pages siempre será legible. Si necesitas control de acceso real, vete a la opción B.

## Opción B — Tu servidor

Cualquier hosting estático sirve (Apache, nginx, Caddy, Netlify, Cloudflare Pages, un VPS...):

1. Copia la carpeta al directorio del vhost, por ejemplo `/var/www/sfmc`.
2. Apunta el subdominio `sfmc.asuntosimportant.es` a la IP del servidor con un registro **A** (o un CNAME al host que te dé el proveedor).
3. Certificado con Let's Encrypt (`certbot --nginx -d sfmc.asuntosimportant.es`).
4. Si quieres restringir el acceso, ahí sí puedes: `.htpasswd` en Apache, `auth_basic` en nginx, o Cloudflare Access delante.

Ejemplo mínimo de nginx:

```nginx
server {
  server_name sfmc.asuntosimportant.es;
  root /var/www/sfmc;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
  # opcional: acceso restringido
  # auth_basic "Privado"; auth_basic_user_file /etc/nginx/.htpasswd;
}
```

El `CNAME` de la carpeta solo lo usa GitHub Pages; en tu servidor puedes borrarlo.

---

## Añadir más exámenes

1. Crea `data/<id>.json` con esta forma:

```jsonc
{
  "id": "mi-examen",
  "code": "XX-000",
  "name": "Nombre del examen",
  "vendor": "Salesforce",
  "release": "Summer '26",
  "format": { "scored": 60, "unscored": 5, "minutes": 105, "pass": 72, "choices": 3 },
  "sections": [ { "id": "data", "name": "Área", "weight": 25 } ],   // los pesos suman 100
  "notes": "Nota corta que se ve al pie de la ficha del examen",
  "questions": [
    {
      "id": 1,                    // único dentro del examen
      "q": "Enunciado",
      "o": ["Opción A", "Opción B", "Opción C"],
      "a": 0,                     // índice de la correcta (0 = A)
      "e": "Explicación breve",
      "t": "Tema fino, para el desglose",
      "sec": "data",              // id de una sección de arriba
      "src": "Set A", "n": 1,     // origen y número en el documento original (opcional)
      "note": "Aviso opcional"
    }
  ]
}
```

2. Añade la fila correspondiente en `data/exams.json`.
3. Sube `CACHE` a `sala-examen-v2` en `sw.js` para que los navegadores con la versión cacheada se enteren.

El simulacro reparte las preguntas según el peso de cada sección (método del resto mayor) y el aprobado sale de `format.pass`.

---

## Progreso del usuario

Se guarda en `localStorage` bajo la clave `examtrainer.v2`, por dominio y navegador. Persiste entre sesiones y días; no se sube a ningún sitio.

Dos cosas a tener en cuenta:

- **Safari en iOS borra el almacenamiento de webs que no visitas en 7 días.** Por eso la web es instalable: desde Safari, *Compartir → Añadir a pantalla de inicio*. Instalada queda exenta de esa limpieza, funciona offline y se abre a pantalla completa. En Android/Chrome sale el aviso de instalar solo.
- Además se pide `navigator.storage.persist()` al cargar, que en Chrome y Firefox marca el almacenamiento como persistente.
- Para cambiar de dispositivo: **Exportar** en el pie da un texto (o un archivo `.json`) que se pega en **Importar** en el otro. Al importar se suman los intentos, no se pisan.
- **Borrar** (en el mismo pie) vacía el progreso de todos los exámenes *y* las cachés del service worker, además de desregistrarlo, y recarga. Sirve también para forzar que un dispositivo se traiga la versión más reciente de la web.

## Datos del examen MC-Con-201

60 preguntas puntuadas (más hasta 5 sin puntuar), 105 minutos, **72 % para aprobar** (43 aciertos de 60), 3 opciones por pregunta. Pesos por sección: Campaign Design & Content 30 %, Data Modeling & Segmentation 25 %, Platform Setup & Governance 13 %, Consent 13 %, Agentforce & AI 11 %, Analytics 8 %.

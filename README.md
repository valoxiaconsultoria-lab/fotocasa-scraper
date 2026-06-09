# Fotocasa Scraper — Beniroig

Scraper de propietarios particulares en Fotocasa Valencia.
Desplegado en Railway con Puppeteer + Chromium.

## Endpoints

### GET /
Health check

### GET /scrape
Scraping de listado de anuncios

**Parámetros:**
- `api_key` — tu clave API (por defecto: beniroig2025)
- `url` — URL de búsqueda de Fotocasa (opcional)
- `maxPages` — número máximo de páginas a scrapear (default: 5)

**Ejemplo:**
```
GET https://TU-DOMINIO.railway.app/scrape?api_key=beniroig2025&maxPages=10
```

### GET /detail
Extrae email y teléfono de un anuncio concreto

**Parámetros:**
- `api_key` — tu clave API
- `url` — URL del anuncio de Fotocasa

**Ejemplo:**
```
GET https://TU-DOMINIO.railway.app/detail?api_key=beniroig2025&url=https://www.fotocasa.es/inmueble/...
```

## Variables de entorno en Railway

| Variable | Valor |
|---|---|
| `API_KEY` | tu clave secreta (cambia beniroig2025) |
| `PORT` | se configura automático en Railway |

## Despliegue en Railway

1. Sube este código a GitHub
2. En Railway → New Project → Deploy from GitHub
3. Selecciona el repositorio
4. Añade la variable de entorno `API_KEY`
5. Railway despliega automáticamente

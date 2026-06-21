# PHP Server Manager ⚡

Una aplicación nativa para macOS que te permite gestionar servidores PHP y bases de datos locales desde una interfaz gráfica, similar a Laragon pero liviana y propia.

Olvidate de andar escribiendo `php -S localhost:8000` en la terminal cada vez que querés trabajar en un proyecto. Con esta app seleccionás la carpeta, elegís el proyecto, y lo servís al instante.

## Captura

![PHP Server Manager](assets/icon.png)

## ¿Para qué sirve?

- **Servir proyectos PHP localmente** con el servidor incorporado de PHP (`php -S`)
- **Tener varios proyectos a la vez**, cada uno en su propio puerto
- **Iniciar/detener MySQL, MariaDB o PostgreSQL** desde la misma interfaz
- **Desarrollar desde cualquier carpeta** — apuntás la app a donde tengas tus proyectos y listo

## Cómo se usa (macOS)

1. **Instalá PHP** (si no lo tenés):
   ```bash
   brew install php
   ```

2. **Descargá la app** desde [Releases](https://github.com/tmpos/php-server-manager/releases) (archivo `.dmg`)

3. **Abrí el DMG** y arrastrá la app a la carpeta de Aplicaciones

4. **Abrí la app** (si macOS te advierte, hacé Ctrl+click → Abrir)

5. **Elegí tu carpeta de proyectos**:
   - Hacé click en **Change Dir** (sidebar)
   - Seleccioná la carpeta raíz donde tenés tus proyectos PHP
   - Ejemplo: `~/Sites/`, `~/Desktop/proyectos/`, etc.

6. **Iniciá un proyecto**:
   - Hacé click en el nombre del proyecto en la lista
   - Apretá **Start Server**
   - Abrí `http://localhost:8000` en tu navegador

7. **Para bases de datos**: si tenés MySQL o PostgreSQL instalado, la app lo detecta y podés iniciarlo desde la sección **Database** en el sidebar

## Requisitos

- **macOS** (Intel o Apple Silicon)
- **PHP** instalado (via `brew install php` o descarga manual)
- Opcional: **MySQL** / **MariaDB** / **PostgreSQL** para gestión de bases de datos

## Development

```bash
git clone https://github.com/tmpos/php-server-manager.git
cd php-server-manager
npm install
npm run dev
```

## Build

```bash
npm run build       # Genera el .dmg en dist/
```

## Licencia

MIT

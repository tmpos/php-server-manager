# PHP Server Manager ⚡

Una aplicación de escritorio hecha con Electron para gestionar servidores PHP y bases de datos localmente, al estilo Laragon.

## Características

- **Gestión de sitios PHP**: Agrega carpetas con proyectos PHP, inicia/detiene servidores con un clic
- **PHP Built-in Server**: Cada sitio se sirve con `php -S` en un puerto único (8000-9000)
- **Directorio configurable**: Apuntá a cualquier carpeta de tu sistema donde tengas proyectos
- **Gestión de bases de datos**: Detecta MySQL/MariaDB/PostgreSQL instalados y permite iniciarlos/detenerlos
- **System tray**: Acceso rápido desde la barra de menú
- **Multiplataforma**: Compatible con macOS, Windows y Linux

## Requisitos

- [PHP](https://www.php.net/downloads) instalado y accesible desde PATH
- Opcional: [MySQL](https://dev.mysql.com/downloads/) / [MariaDB](https://mariadb.org/download/) / [PostgreSQL](https://www.postgresql.org/download/) para gestión de bases de datos

## Instalación

### macOS (DMG)
Descargar el último `.dmg` de [Releases](https://github.com/tomataveras/php-server-manager/releases) y arrastrar a Aplicaciones.

### Desde código
```bash
git clone https://github.com/tomataveras/php-server-manager.git
cd php-server-manager
npm install
npm start
```

## Uso

1. Abrí la app
2. Hacé click en **Change Dir** para elegir la carpeta con tus proyectos PHP
3. Seleccioná un proyecto de la lista
4. Apretá **Start Server**
5. Accedé desde el navegador en `http://localhost:PUERTO`

## Build

```bash
npm run build          # Solo macOS
npm run build:all      # macOS + Windows + Linux
```

## Licencia

MIT

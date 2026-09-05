# antigravity-mcp-installer 🚀

> CLI interactiva para buscar servidores MCP en el registro de npm y configurarlos automáticamente en **Antigravity CLI** (`~/.gemini/config/mcp_config.json`).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

---

## ✨ Características

- 🔍 **Búsqueda en tiempo real**: Consulta paquetes de servidores MCP directamente en el registro oficial de npm.
- 🎯 **Selección interactiva**: Explora y selecciona con flechas en la terminal gracias a `inquirer`.
- ⚡ **Ejecución flexible**: Elige entre ejecución ligera bajo demanda con `npx -y` o instalación global persistente con `npm install -g`.
- 🛠️ **Configuración sin fricción**: Lee, inicializa y actualiza `~/.gemini/config/mcp_config.json` de forma segura, respetando la estructura existente y previniendo conflictos.
- 🎨 **Diseño moderno**: Spinners dinámicos con `ora` y paleta de colores limpia con `picocolors`.

---

## 📦 Instalación

### Opción 1: Clonar y enlazar localmente (Desarrollo)

```bash
git clone https://github.com/hrnntz/antigravity-mcp-installer.git
cd antigravity-mcp-installer
npm install
npm link
```

### Opción 2: Ejecutar directamente con npx (una vez publicado en npm)

```bash
npx antigravity-mcp-installer
```

---

## 🚀 Uso

### 1. Búsqueda interactiva
Simplemente ejecuta el comando y la CLI te solicitará el término de búsqueda:
```bash
antigravity-mcp-installer
```

### 2. Búsqueda directa por argumento
Puedes pasar el término que buscas directamente:
```bash
antigravity-mcp-installer sqlite
antigravity-mcp-installer filesystem
antigravity-mcp-installer postgres
```

### 3. Especificar una ruta de configuración personalizada
Si utilizas un archivo de configuración distinto al estándar:
```bash
antigravity-mcp-installer git -c /ruta/personalizada/mcp_config.json
```

---

## 📋 Formato de Configuración Generado

La herramienta registra los servidores dentro del bloque `mcpServers` en `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-mcp"
      ]
    }
  }
}
```

---

## 🛠️ Tecnologías

- [Node.js](https://nodejs.org/) (ES Modules)
- [Commander.js](https://github.com/tj/commander.js)
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js)
- [Ora](https://github.com/sindresorhus/ora)
- [Picocolors](https://github.com/alexeyraspopov/picocolors)

---

## 📄 Licencia

MIT © [Hernán](https://github.com/hrnntz)

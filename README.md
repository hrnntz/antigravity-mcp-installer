# antigravity-mcp-installer 🚀

> CLI interactiva para buscar servidores MCP en el registro de npm y configurarlos automáticamente en **Antigravity CLI** (`~/.gemini/config/mcp_config.json`).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-blue.svg)](https://github.com/hrnntz/antigravity-mcp-installer)

Incluye dos comandos listos para usar en tu terminal:
- **`agy-mcp`** *(alias corto y rápido)*
- **`antigravity-mcp-installer`** *(nombre completo)*

---

## ⚡ Instalación en 1 Línea

### En Linux y macOS (Terminal)
Ejecuta el instalador automático:
```bash
curl -fsSL https://raw.githubusercontent.com/hrnntz/antigravity-mcp-installer/main/install.sh | bash
```

### En Windows (PowerShell)
Abre PowerShell y ejecuta:
```powershell
irm https://raw.githubusercontent.com/hrnntz/antigravity-mcp-installer/main/install.ps1 | iex
```

### Vía npm (Global)
```bash
npm install -g antigravity-mcp-installer
```

---

## 🚀 Uso Rápido

### 1. Búsqueda Interactiva
Abre el explorador interactivo:
```bash
agy-mcp
```
*(o también: `antigravity-mcp-installer`)*

### 2. Buscar directamente un término
```bash
agy-mcp sqlite
agy-mcp filesystem
agy-mcp postgres
agy-mcp git
```

### 3. Especificar archivo de configuración alternativo
```bash
agy-mcp brave-search -c /ruta/a/mi_config.json
```

---

## ✨ Características

- 🔍 **Búsqueda instantánea**: Consulta servidores MCP directamente en el registro oficial de npm.
- 🎯 **Selección con teclado**: Explora los resultados con flechas y selecciona con `Enter`.
- ⚡ **Modo de ejecución flexible**:
  - `npx -y`: Ejecución liviana bajo demanda (recomendado, sin ensuciar tu sistema).
  - `npm install -g`: Instalación global permanente.
- 🛡️ **Edición segura**: Lee, valida y actualiza `mcp_config.json` manejando posibles errores de sintaxis JSON y confirmando si deseas sobrescribir entradas existentes.
- 🌐 **Multiplataforma**: Funciona idénticamente en Linux, macOS y Windows.

---

## 📋 Configuración Generada

La herramienta registra los servidores dentro de `mcpServers` en `~/.gemini/config/mcp_config.json`:

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

## 📄 Licencia

MIT © [Hernán Arteaga](https://github.com/hrnntz)

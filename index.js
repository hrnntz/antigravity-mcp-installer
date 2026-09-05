#!/usr/bin/env node

/**
 * antigravity-mcp-installer
 * CLI interactiva para buscar y registrar servidores MCP en Antigravity CLI.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import pc from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Ruta estándar para Antigravity CLI
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');

/**
 * Imprime el banner visual
 */
function printBanner() {
  console.log();
  console.log(pc.bold(pc.cyan('╔═════════════════════════════════════════════════════════════╗')));
  console.log(pc.bold(pc.cyan('║               ANTIGRAVITY MCP INSTALLER                     ║')));
  console.log(pc.dim('║    Búsqueda y configuración automática de servidores MCP    ║'));
  console.log(pc.bold(pc.cyan('╚═════════════════════════════════════════════════════════════╝')));
  console.log();
}

/**
 * Consulta la API de npm buscando servidores MCP
 */
async function searchNpmMcpServers(searchTerm) {
  const spinner = ora({
    text: `Consultando el registro de npm para "${searchTerm}"...`,
    color: 'cyan'
  }).start();

  try {
    // 1. Intento primario: término + tag mcp-server
    let query = `${searchTerm.trim()} mcp-server`;
    let url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=30`;

    let response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'antigravity-mcp-installer/1.0.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Error en el registro npm: ${response.status} ${response.statusText}`);
    }

    let data = await response.json();

    // 2. Intento de respaldo si no hay resultados: búsqueda más amplia con 'mcp'
    if (!data.objects || data.objects.length === 0) {
      spinner.text = `Ampliando búsqueda en el registro...`;
      query = `${searchTerm.trim()} mcp`;
      url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=30`;
      response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'antigravity-mcp-installer/1.0.0'
        }
      });
      if (response.ok) {
        data = await response.json();
      }
    }

    spinner.succeed('Búsqueda completada.');

    if (!data.objects || data.objects.length === 0) {
      return [];
    }

    return data.objects.map(item => ({
      name: item.package.name,
      version: item.package.version,
      description: item.package.description || 'Sin descripción disponible',
      homepage: item.package.links?.npm || ''
    }));
  } catch (error) {
    spinner.fail(pc.red('Fallo al conectar con el registro de npm.'));
    throw error;
  }
}

/**
 * Lee o crea el archivo mcp_config.json de forma segura
 */
async function loadOrCreateConfig(configPath) {
  const dirPath = path.dirname(configPath);

  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code === 'EACCES') {
      throw new Error(`Permiso denegado al intentar crear el directorio: ${dirPath}`);
    }
    throw err;
  }

  try {
    const rawData = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(rawData);

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Estructura raíz de JSON no válida (debe ser un objeto).');
    }

    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      parsed.mcpServers = {};
    }

    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      const initialConfig = { mcpServers: {} };
      await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2) + '\n', 'utf-8');
      return initialConfig;
    }

    if (err instanceof SyntaxError) {
      throw new Error(`El archivo de configuración ${configPath} contiene JSON inválido o corrupto.`);
    }

    if (err.code === 'EACCES') {
      throw new Error(`Permiso denegado para leer el archivo: ${configPath}`);
    }

    throw err;
  }
}

/**
 * Guarda la configuración con indentación y formato limpio
 */
async function saveConfig(configPath, configData) {
  try {
    const formatted = JSON.stringify(configData, null, 2) + '\n';
    await fs.writeFile(configPath, formatted, 'utf-8');
  } catch (err) {
    if (err.code === 'EACCES') {
      throw new Error(`Permiso denegado para escribir en: ${configPath}`);
    }
    throw err;
  }
}

/**
 * Sugerencia de nombre para el identificador en mcpServers
 */
function sanitizeServerKey(pkgName) {
  return pkgName
    .replace(/^@[^/]+\//, '')
    .replace(/^server-/, '')
    .replace(/-server$/, '');
}

/**
 * Función principal
 */
async function main() {
  const program = new Command();

  program
    .name('antigravity-mcp-installer')
    .description('Buscador e instalador interactivo de servidores MCP para Antigravity CLI')
    .version('1.0.0')
    .argument('[query]', 'Término de búsqueda inicial')
    .option('-c, --config <path>', 'Ruta personalizada a mcp_config.json', DEFAULT_CONFIG_PATH)
    .parse(process.argv);

  const options = program.opts();
  const configPath = path.resolve(options.config);
  let initialQuery = program.args[0];

  printBanner();

  // 1. Solicitar término si no se pasó por argumento
  if (!initialQuery) {
    const queryAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'query',
        message: '¿Qué servidor MCP deseas buscar? (ej. sqlite, git, filesystem, postgres):',
        validate: input => input.trim().length > 0 ? true : 'Por favor ingresa al menos una palabra.'
      }
    ]);
    initialQuery = queryAnswer.query;
  }

  // 2. Buscar en el registro
  let packages = [];
  try {
    packages = await searchNpmMcpServers(initialQuery);
  } catch (err) {
    console.error(pc.red(`\n✖ ${err.message}`));
    process.exit(1);
  }

  if (packages.length === 0) {
    console.log(pc.yellow(`\n⚠ No se encontraron servidores MCP para "${initialQuery}".\n`));
    process.exit(0);
  }

  // 3. Selección interactiva
  const choices = packages.map(pkg => ({
    name: `${pc.bold(pc.green(pkg.name))} ${pc.dim(`(v${pkg.version})`)}\n  ${pc.dim(pkg.description)}`,
    value: pkg
  }));

  const { selectedPkg } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedPkg',
      message: 'Selecciona el servidor MCP que deseas configurar:',
      choices,
      pageSize: 10
    }
  ]);

  console.log(pc.cyan(`\nHas seleccionado: ${pc.bold(selectedPkg.name)}`));

  // 4. Modo de ejecución
  const { executionMethod } = await inquirer.prompt([
    {
      type: 'list',
      name: 'executionMethod',
      message: '¿Cómo deseas ejecutar este servidor MCP?',
      choices: [
        {
          name: `${pc.bold('npx')} ${pc.dim('(Recomendado: se ejecuta bajo demanda sin instalación permanente)')}`,
          value: 'npx'
        },
        {
          name: `${pc.bold('npm install -g')} ${pc.dim('(Instalación global en tu sistema)')}`,
          value: 'global'
        }
      ]
    }
  ]);

  if (executionMethod === 'global') {
    const installSpinner = ora(`Instalando ${selectedPkg.name} globalmente con npm...`).start();
    try {
      await execAsync(`npm install -g ${selectedPkg.name}`);
      installSpinner.succeed(`Paquete ${pc.bold(selectedPkg.name)} instalado globalmente.`);
    } catch (err) {
      installSpinner.fail(pc.red('Error al ejecutar npm install -g.'));
      console.error(pc.dim(err.stderr || err.message));
      const { continueAnyway } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: 'La instalación global falló. ¿Deseas continuar configurándolo de todas formas?',
          default: false
        }
      ]);
      if (!continueAnyway) {
        process.exit(1);
      }
    }
  }

  // 5. Clave de configuración
  const defaultKey = sanitizeServerKey(selectedPkg.name);
  const { serverKey } = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverKey',
      message: 'Identificador del servidor en Antigravity:',
      default: defaultKey,
      validate: input => /^[a-zA-Z0-9_-]+$/.test(input.trim())
        ? true
        : 'El identificador solo debe contener letras, números, guiones y guiones bajos.'
    }
  ]);

  // 6. Actualizar mcp_config.json
  const configSpinner = ora(`Actualizando configuración en ${pc.dim(configPath)}...`).start();
  try {
    const configData = await loadOrCreateConfig(configPath);

    if (configData.mcpServers[serverKey]) {
      configSpinner.stop();
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `El servidor "${serverKey}" ya existe en mcp_config.json. ¿Deseas sobrescribirlo?`,
          default: true
        }
      ]);
      if (!overwrite) {
        console.log(pc.yellow('\nOperación cancelada.'));
        process.exit(0);
      }
      configSpinner.start();
    }

    if (executionMethod === 'npx') {
      configData.mcpServers[serverKey] = {
        command: 'npx',
        args: ['-y', selectedPkg.name]
      };
    } else {
      configData.mcpServers[serverKey] = {
        command: selectedPkg.name,
        args: []
      };
    }

    await saveConfig(configPath, configData);
    configSpinner.succeed(pc.green(`Configuración guardada en ${configPath}`));

    console.log();
    console.log(pc.bold(pc.cyan('🎉 Servidor MCP registrado exitosamente:')));
    console.log(pc.white(JSON.stringify({ [serverKey]: configData.mcpServers[serverKey] }, null, 2)));
    console.log(pc.dim('\nAntigravity CLI cargará este servidor en su siguiente sesión.\n'));
  } catch (err) {
    configSpinner.fail(pc.red('Fallo al actualizar mcp_config.json.'));
    console.error(pc.red(`\nDetalle: ${err.message}`));
    process.exit(1);
  }
}

main().catch(err => {
  if (err.name === 'ExitPromptError') {
    console.log(pc.yellow('\n\nOperación cancelada por el usuario.'));
    process.exit(0);
  }
  console.error(pc.red(`\nError: ${err.message}`));
  process.exit(1);
});

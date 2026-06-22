const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile, execSync, execFileSync } = require('child_process');
const { Transform } = require('stream');
const os = require('os');

const PLATFORM = os.platform();
const IS_DEV = process.argv.includes('--dev');
const DEFAULT_SITES_DIR = path.join(__dirname, 'sites');
const PORT_RANGE = { start: 8000, end: 9000 };
const PREFS_PATH = path.join(app.getPath('userData'), 'preferences.json');

let mainWindow = null;
let trayIcon = null;
let runningServers = {};
let phpPath = null;
let preferences = {};
let portAllocations = {};

function getSitesDir() {
  return (preferences.sitesDir && fs.existsSync(preferences.sitesDir))
    ? preferences.sitesDir
    : DEFAULT_SITES_DIR;
}

function setSitesDir(newDir) {
  preferences.sitesDir = newDir;
  savePreferences(preferences);
}

function getPreferences() {
  try {
    if (fs.existsSync(PREFS_PATH)) {
      return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { phpPath: null, autoStart: null, theme: 'dark' };
}

function savePreferences(prefs) {
  try {
    const dir = path.dirname(PREFS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  } catch (e) { /* ignore */ }
}

function validatePhpPath(p) {
  if (!p || !fs.existsSync(p)) return false;
  try {
    execFileSync(p, ['-v'], { encoding: 'utf8', timeout: 3000 });
    return true;
  } catch (e) {
    return false;
  }
}

function detectPhp() {
  const commonPaths = [];

  if (PLATFORM === 'win32') {
    for (const drive of ['C:', 'D:']) {
      commonPaths.push(
        `${drive}\\php\\php.exe`,
        `${drive}\\xampp\\php\\php.exe`,
        `${drive}\\wamp64\\bin\\php\\php8.2.0\\php.exe`,
        `${drive}\\tools\\php\\php.exe`
      );
    }
  } else {
    commonPaths.push('/usr/local/bin/php', '/usr/bin/php', '/opt/homebrew/bin/php');
  }

  if (preferences.phpPath && validatePhpPath(preferences.phpPath)) {
    return preferences.phpPath;
  }

  for (const p of commonPaths) {
    if (validatePhpPath(p)) return p;
  }

  try {
    const which = PLATFORM === 'win32' ? 'where php' : 'which php';
    const result = execSync(which, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0];
    if (validatePhpPath(result)) return result;
  } catch (e) { /* not in path */ }

  try {
    const result = execFileSync('php', ['-v'], { encoding: 'utf8', timeout: 3000 });
    const match = result.match(/PHP\s+([\d.]+)/);
    if (match) return 'php';
  } catch (e) { /* not in path */ }

  return null;
}

function getPhpVersion(phpPath) {
  if (!phpPath) return null;
  try {
    const result = execFileSync(phpPath, ['-v'], { encoding: 'utf8', timeout: 3000 });
    const match = result.match(/PHP\s+([\d.]+)/);
    return match ? match[1] : 'Unknown';
  } catch (e) {
    console.error('getPhpVersion error:', e.message);
    return 'Unknown';
  }
}

function getSites() {
  try {
    if (!fs.existsSync(getSitesDir())) {
      fs.mkdirSync(getSitesDir(), { recursive: true });
      return [];
    }
    return fs.readdirSync(getSitesDir(), { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort();
  } catch (e) {
    return [];
  }
}

function getAvailablePort() {
  for (let port = PORT_RANGE.start; port <= PORT_RANGE.end; port++) {
    if (!Object.values(portAllocations).includes(port)) return port;
  }
  return null;
}

function startServer(siteName) {
  return new Promise((resolve, reject) => {
    if (runningServers[siteName]) {
      resolve({ success: false, error: 'Server already running' });
      return;
    }

    if (!phpPath) {
      reject({ success: false, error: 'PHP not found' });
      return;
    }

    const sitePath = path.join(getSitesDir(), siteName);
    if (!fs.existsSync(sitePath)) {
      reject({ success: false, error: 'Site directory not found' });
      return;
    }

    const port = getAvailablePort();
    if (!port) {
      reject({ success: false, error: 'No available ports' });
      return;
    }

    const host = '127.0.0.1';
    const phpProcess = spawn(phpPath, ['-S', `${host}:${port}`, '-t', sitePath], {
      cwd: sitePath,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const checkInterval = setInterval(() => {
      if (phpProcess.killed) {
        clearInterval(checkInterval);
        reject({ success: false, error: 'PHP process died' });
        return;
      }
    }, 100);

    phpProcess.on('error', (err) => {
      clearInterval(checkInterval);
      reject({ success: false, error: err.message });
    });

    phpProcess.on('exit', (code) => {
      clearInterval(checkInterval);
      if (code !== null && code !== 0) {
        runningServers[siteName] = null;
        delete portAllocations[siteName];
      }
    });

    phpProcess.stdout.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('server-log', { site: siteName, data: data.toString() });
      }
    });

    phpProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (mainWindow) {
        mainWindow.webContents.send('server-log', { site: siteName, data: msg });
      }
    });

    setTimeout(() => {
      clearInterval(checkInterval);
      portAllocations[siteName] = port;
      runningServers[siteName] = phpProcess;

      if (mainWindow) {
        mainWindow.webContents.send('server-started', { site: siteName, port, url: `http://localhost:${port}` });
      }

      if (trayIcon) {
        updateTrayMenu();
      }

      resolve({ success: true, port, url: `http://localhost:${port}` });
    }, 500);
  });
}

function stopServer(siteName) {
  return new Promise((resolve) => {
    const proc = runningServers[siteName];
    if (!proc) {
      resolve({ success: false, error: 'Server not running' });
      return;
    }

    if (PLATFORM === 'win32') {
      spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (runningServers[siteName]) {
          proc.kill('SIGKILL');
        }
      }, 3000);
    }

    setTimeout(() => {
      delete portAllocations[siteName];
      delete runningServers[siteName];

      if (mainWindow) {
        mainWindow.webContents.send('server-stopped', { site: siteName });
      }

      if (trayIcon) {
        updateTrayMenu();
      }

      resolve({ success: true });
    }, 200);
  });
}

function stopAllServers() {
  const names = Object.keys(runningServers);
  return Promise.all(names.map(name => stopServer(name)));
}

// --- Database Management ---

let runningDatabases = {};
let detectedDatabases = [];

function detectDatabases() {
  const dbs = [];

  const checks = [
    { type: 'mysql', name: 'MySQL', clientBin: 'mysql', serverBin: 'mysqld', port: 3306, dataDir: null },
    { type: 'mariadb', name: 'MariaDB', clientBin: 'mariadb', serverBin: 'mariadbd', port: 3306, dataDir: null },
    { type: 'postgresql', name: 'PostgreSQL', clientBin: 'postgres', serverBin: 'postgres', port: 5432, dataDir: null },
  ];

  const searchPaths = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];

  for (const db of checks) {
    let foundPath = null;
    for (const dir of searchPaths) {
      const p = path.join(dir, db.clientBin);
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      try {
        const result = execSync(`which ${db.clientBin}`, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0];
        if (result && fs.existsSync(result)) foundPath = result;
      } catch (e) { /* not found */ }
    }

    if (foundPath) {
      let serverPath = null;
      for (const dir of searchPaths) {
        const p = path.join(dir, db.serverBin);
        if (fs.existsSync(p)) {
          serverPath = p;
          break;
        }
      }
      if (!serverPath) {
        try {
          const result = execSync(`which ${db.serverBin}`, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0];
          if (result && fs.existsSync(result)) serverPath = result;
        } catch (e) { /* not found */ }
      }

      let version = null;
      try {
        const v = execFileSync(foundPath, ['--version'], { encoding: 'utf8', timeout: 3000 });
        const m = v.match(/Ver\s+([\d.]+)/i) || v.match(/([\d.]+)/);
        version = m ? m[1] : '?';
      } catch (e) { /* ignore */ }

      let dataDir = null;
      const possibleDataDirs = [
        path.join(path.dirname(path.dirname(foundPath)), 'var', 'mysql'),
        path.join(path.dirname(path.dirname(foundPath)), 'var', 'postgres'),
        '/usr/local/var/mysql',
        '/opt/homebrew/var/mysql',
        '/usr/local/var/postgres',
        '/opt/homebrew/var/postgres',
      ];
      for (const d of possibleDataDirs) {
        if (fs.existsSync(d)) { dataDir = d; break; }
      }
      if (!dataDir && db.type === 'postgresql') {
        try {
          const r = execSync('echo $PGDATA', { encoding: 'utf8', timeout: 3000 }).trim();
          if (r && fs.existsSync(r)) dataDir = r;
        } catch (e) { /* ignore */ }
      }

      dbs.push({
        type: db.type,
        name: db.name,
        clientPath: foundPath,
        serverPath: serverPath || foundPath,
        port: db.port,
        version,
        dataDir,
        status: 'stopped'
      });
    }
  }

  return dbs;
}

function startDatabase(dbType) {
  return new Promise((resolve, reject) => {
    const db = detectedDatabases.find(d => d.type === dbType);
    if (!db) return reject({ success: false, error: 'Database not found' });
    if (runningDatabases[dbType]) return resolve({ success: false, error: 'Already running' });

    let proc = null;
    try {
      if (dbType === 'postgresql') {
        const pgData = db.dataDir || path.join(os.homedir(), 'pgdata');
        if (!fs.existsSync(pgData)) {
          fs.mkdirSync(pgData, { recursive: true });
          execFileSync('initdb', ['-D', pgData], { encoding: 'utf8', timeout: 10000 });
        }
        proc = spawn(db.serverPath, ['-D', pgData, '-p', db.port.toString(), '-k', '/tmp'], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } else {
        const myCnf = path.join(os.homedir(), '.my.cnf');
        const args = [];
        if (db.dataDir && fs.existsSync(db.dataDir)) {
          args.push(`--datadir=${db.dataDir}`);
        }
        args.push('--port=' + db.port);
        args.push('--socket=/tmp/mysql.sock');
        args.push('--skip-grant-tables');
        proc = spawn(db.serverPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      }
    } catch (e) {
      return reject({ success: false, error: e.message });
    }

    if (!proc) return reject({ success: false, error: 'Failed to spawn process' });

    proc.on('error', (err) => reject({ success: false, error: err.message }));

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (mainWindow) mainWindow.webContents.send('db-log', { db: dbType, data: msg });
    });

    setTimeout(() => {
      runningDatabases[dbType] = proc;
      db.status = 'running';
      if (mainWindow) mainWindow.webContents.send('db-started', { db: dbType, port: db.port });
      if (trayIcon) updateTrayMenu();
      resolve({ success: true, port: db.port });
    }, 1500);
  });
}

function stopDatabase(dbType) {
  return new Promise((resolve) => {
    const proc = runningDatabases[dbType];
    const db = detectedDatabases.find(d => d.type === dbType);
    if (!proc) {
      if (db) db.status = 'stopped';
      resolve({ success: false, error: 'Not running' });
      return;
    }

    if (PLATFORM === 'win32') {
      spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (runningDatabases[dbType]) proc.kill('SIGKILL');
      }, 3000);
    }

    setTimeout(() => {
      delete runningDatabases[dbType];
      if (db) db.status = 'stopped';
      if (mainWindow) mainWindow.webContents.send('db-stopped', { db: dbType });
      if (trayIcon) updateTrayMenu();
      resolve({ success: true });
    }, 500);
  });
}

function stopAllDatabases() {
  return Promise.all(Object.keys(runningDatabases).map(d => stopDatabase(d)));
}

// --- MySQL Query Execution ---

function getMysqlClient() {
  return detectedDatabases.find(d => (d.type === 'mysql' || d.type === 'mariadb') && d.status === 'running');
}

function getMysqlConnectionArgs() {
  const db = getMysqlClient();
  if (!db) return null;
  const socket = '/tmp/mysql.sock';
  const args = ['-u', 'root', `--socket=${socket}`];
  if (PLATFORM === 'win32') {
    return ['-u', 'root', '--host=127.0.0.1', `--port=${db.port}`];
  }
  return args;
}

function mysqlQuery(query) {
  return new Promise((resolve, reject) => {
    const db = getMysqlClient();
    if (!db) return reject({ error: 'MySQL/MariaDB is not running' });

    const args = getMysqlConnectionArgs();
    if (!args) return reject({ error: 'Could not determine MySQL connection' });

    const fullArgs = [...args, '-e', query, '--batch'];
    execFile(db.clientPath, fullArgs, { encoding: 'utf8', timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr ? stderr.trim() : err.message;
        return reject({ error: msg || 'Query execution failed' });
      }

      const upper = query.trim().toUpperCase();
      const isDataQuery = upper.startsWith('SELECT') || upper.startsWith('SHOW') ||
                          upper.startsWith('DESCRIBE') || upper.startsWith('EXPLAIN') ||
                          upper.startsWith('WITH');

      if (!stdout || stdout.trim() === '') {
        return resolve({ type: 'ok', affectedRows: 0, raw: '' });
      }

      const trimmed = stdout.trimEnd();
      if (isDataQuery) {
        const lines = trimmed.split('\n');
        if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
          return resolve({ type: 'empty', headers: [], rows: [] });
        }
        const headers = lines[0].split('\t');
        const rows = lines.slice(1).map(line => {
          if (line.trim() === '') return null;
          const values = line.split('\t');
          const row = {};
          headers.forEach((h, i) => {
            row[h] = i < values.length ? (values[i] === 'NULL' ? null : values[i]) : null;
          });
          return row;
        }).filter(r => r !== null);

        return resolve({ type: 'select', headers, rows });
      }

      return resolve({ type: 'ok', affectedRows: 0, raw: trimmed });
    });
  });
}

function mysqlListDatabases() {
  return mysqlQuery('SHOW DATABASES');
}

function mysqlCreateDatabase(name) {
  return mysqlQuery(`CREATE DATABASE \`${name}\``);
}

function mysqlDeleteDatabase(name) {
  return mysqlQuery(`DROP DATABASE IF EXISTS \`${name}\``);
}

function mysqlListTables(database) {
  return mysqlQuery(`SHOW TABLES FROM \`${database}\``);
}

function mysqlDescribeTable(database, table) {
  return mysqlQuery(`DESCRIBE \`${database}\`.\`${table}\``);
}

function mysqlGetTableData(database, table, limit = 100) {
  return mysqlQuery(`SELECT * FROM \`${database}\`.\`${table}\` LIMIT ${limit}`);
}

function openInBrowser(url) {
  shell.openExternal(url).catch(() => {});
}

function openInFileManager(siteName) {
  shell.openPath(path.join(getSitesDir(), siteName)).catch(() => {});
}

function openSitesDirectory() {
  shell.openPath(getSitesDir()).catch(() => {});
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function createTray() {
  const iconSize = PLATFORM === 'darwin' ? 16 : 32;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');

  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: iconSize, height: iconSize });
  } else {
    icon = nativeImage.createEmpty();
  }

  trayIcon = new Tray(icon);
  trayIcon.setToolTip('PHP Server Manager');
  updateTrayMenu();

  trayIcon.on('double-click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  if (!trayIcon) return;

  const running = Object.keys(runningServers);
  const contextMenu = [];

  const phpVer = phpPath ? getPhpVersion(phpPath) : null;
  contextMenu.push({
    label: `PHP: ${phpVer !== 'Unknown' ? phpVer : phpPath || 'Not found'}`,
    enabled: false
  });

  contextMenu.push({ type: 'separator' });

  const allSites = getSites();
  for (const site of allSites) {
    const isRunning = running.includes(site);
    contextMenu.push({
      label: `${isRunning ? '▶' : '○'} ${site}`,
      submenu: [
        {
          label: isRunning ? 'Stop' : 'Start',
          click: () => {
            if (isRunning) {
              stopServer(site);
            } else {
              startServer(site);
            }
          }
        },
        {
          label: 'Open in Browser',
          enabled: isRunning,
          click: async () => {
            if (runningServers[site]) {
              await shell.openExternal(`http://localhost:${portAllocations[site]}`).catch(() => {});
            }
          }
        },
        {
          label: 'Open Folder',
          click: () => openInFileManager(site)
        }
      ]
    });
  }

  contextMenu.push({ type: 'separator' });
  contextMenu.push({
    label: 'Open Sites Folder',
    click: () => openSitesDirectory()
  });
  contextMenu.push({
    label: mainWindow && mainWindow.isVisible() ? 'Hide Window' : 'Show Window',
    click: () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  contextMenu.push({ type: 'separator' });
  contextMenu.push({
    label: 'Quit',
    click: async () => {
      await stopAllServers();
      app.quit();
    }
  });

  trayIcon.setContextMenu(Menu.buildFromTemplate(contextMenu));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    title: 'PHP Server Manager',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendStateToRenderer();
  });

  mainWindow.on('close', (event) => {
    if (!IS_DEV) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (IS_DEV) {
    mainWindow.webContents.openDevTools();
  }
}

function sendStateToRenderer() {
  if (!mainWindow) return;

  const sites = getSites();
  const running = Object.keys(runningServers);
  const sitesWithStatus = sites.map(name => ({
    name,
    running: running.includes(name),
    port: portAllocations[name] || null,
    url: runningServers[name] ? `http://localhost:${portAllocations[name]}` : null
  }));

  mainWindow.webContents.send('app-state', {
    sites: sitesWithStatus,
    phpPath,
    phpVersion: phpPath ? getPhpVersion(phpPath) : null,
    sitesPath: getSitesDir(),
    databases: detectedDatabases.map(d => ({ ...d })),
    preferences
  });
}

// --- Database IPC Handlers ---

ipcMain.handle('start-database', async (event, dbType) => {
  try {
    const result = await startDatabase(dbType);
    sendStateToRenderer();
    updateTrayMenu();
    if (result.success) showNotification('Database', `${dbType} started on port ${result.port}`);
    return result;
  } catch (err) {
    const msg = err && (err.error || err.message || JSON.stringify(err));
    return { success: false, error: msg || 'Failed to start database' };
  }
});

ipcMain.handle('stop-database', async (event, dbType) => {
  const result = await stopDatabase(dbType);
  sendStateToRenderer();
  updateTrayMenu();
  return result;
});

ipcMain.handle('install-database', async (event, dbType) => {
  try {
    const hasBrew = execSync('which brew', { encoding: 'utf8', timeout: 3000 }).trim();
    if (!hasBrew) return { success: false, error: 'Homebrew not found' };
  } catch (e) {
    return { success: false, error: 'Homebrew not found. Install it first: https://brew.sh' };
  }

  const pkg = dbType === 'postgresql' ? 'postgresql' : 'mysql';
  try {
    execSync(`brew install ${pkg}`, { encoding: 'utf8', timeout: 300000 });
    detectedDatabases = detectDatabases();
    sendStateToRenderer();
    return { success: true };
  } catch (e) {
    return { success: false, error: `Installation failed: ${e.message}` };
  }
});

ipcMain.handle('db-execute-query', async (event, query) => {
  try {
    const result = await mysqlQuery(query);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Query failed' };
  }
});

ipcMain.handle('db-list-databases', async () => {
  try {
    const result = await mysqlListDatabases();
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to list databases' };
  }
});

ipcMain.handle('db-create-database', async (event, name) => {
  try {
    const result = await mysqlCreateDatabase(name);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to create database' };
  }
});

ipcMain.handle('db-delete-database', async (event, name) => {
  try {
    const result = await mysqlDeleteDatabase(name);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to delete database' };
  }
});

ipcMain.handle('db-list-tables', async (event, database) => {
  try {
    const result = await mysqlListTables(database);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to list tables' };
  }
});

ipcMain.handle('db-describe-table', async (event, database, table) => {
  try {
    const result = await mysqlDescribeTable(database, table);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to describe table' };
  }
});

ipcMain.handle('db-get-table-data', async (event, database, table, limit) => {
  try {
    const result = await mysqlGetTableData(database, table, limit || 100);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to get table data' };
  }
});

ipcMain.handle('db-create-table', async (event, database, tableName, columns) => {
  try {
    const db = getMysqlClient();
    if (!db) return { success: false, error: 'MySQL/MariaDB is not running' };

    if (!columns || columns.length === 0) {
      return { success: false, error: 'At least one column is required' };
    }

    const colDefs = columns.map(col => {
      const parts = [`\`${col.name}\``, col.type];

      if (col.length && ['varchar','char','int','tinyint','smallint','mediumint','bigint','decimal','float','double','enum','set'].includes(col.type.toLowerCase())) {
        parts[1] = `${col.type}(${col.length})`;
      }

      if (col.unsigned) parts.push('UNSIGNED');
      if (col.notNull) parts.push('NOT NULL');
      if (col.autoIncrement) parts.push('AUTO_INCREMENT');
      if (col.defaultValue !== undefined && col.defaultValue !== '') {
        const dv = col.defaultValue.toUpperCase() === 'NULL' ? 'NULL' : `'${col.defaultValue.replace(/'/g, "\\'")}'`;
        parts.push(`DEFAULT ${dv}`);
      }

      return parts.join(' ');
    });

    const primaryKey = columns.filter(c => c.primaryKey).map(c => `\`${c.name}\``);
    if (primaryKey.length > 0) {
      colDefs.push(`PRIMARY KEY (${primaryKey.join(', ')})`);
    }

    const sql = `CREATE TABLE \`${database}\`.\`${tableName}\` (\n  ${colDefs.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to create table' };
  }
});

function buildColumnDef(col) {
  const parts = [`\`${col.name}\``, col.type];
  if (col.length && ['varchar','char','int','tinyint','smallint','mediumint','bigint','decimal','float','double','enum','set'].includes(col.type.toLowerCase())) {
    parts[1] = `${col.type}(${col.length})`;
  }
  if (col.unsigned) parts.push('UNSIGNED');
  if (col.notNull) parts.push('NOT NULL');
  if (col.autoIncrement) parts.push('AUTO_INCREMENT');
  if (col.defaultValue !== undefined && col.defaultValue !== '') {
    const dv = col.defaultValue.toUpperCase() === 'NULL' ? 'NULL' : `'${col.defaultValue.replace(/'/g, "\\'")}'`;
    parts.push(`DEFAULT ${dv}`);
  }
  return parts.join(' ');
}

ipcMain.handle('db-add-column', async (event, database, table, column) => {
  try {
    const def = buildColumnDef(column);
    const sql = `ALTER TABLE \`${database}\`.\`${table}\` ADD COLUMN ${def}`;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to add column' };
  }
});

ipcMain.handle('db-drop-column', async (event, database, table, columnName) => {
  try {
    const sql = `ALTER TABLE \`${database}\`.\`${table}\` DROP COLUMN \`${columnName}\``;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to drop column' };
  }
});

function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

ipcMain.handle('db-insert-row', async (event, database, table, data) => {
  try {
    const entries = Object.entries(data).filter(([, v]) => v !== '__omit__' && v !== '');
    if (entries.length === 0) return { success: false, error: 'No data to insert' };
    const cols = entries.map(([k]) => `\`${k}\``).join(', ');
    const vals = entries.map(([, v]) => escapeSql(v)).join(', ');
    const sql = `INSERT INTO \`${database}\`.\`${table}\` (${cols}) VALUES (${vals})`;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to insert row' };
  }
});

ipcMain.handle('db-update-row', async (event, database, table, data, where) => {
  try {
    const entries = Object.entries(data).filter(([, v]) => v !== '__omit__' && v !== '');
    if (entries.length === 0) return { success: false, error: 'No data to update' };
    if (Object.keys(where).length === 0) return { success: false, error: 'No WHERE condition' };
    const set = entries.map(([k, v]) => `\`${k}\`=${escapeSql(v)}`).join(', ');
    const cond = Object.entries(where).map(([k, v]) => `\`${k}\`=${escapeSql(v)}`).join(' AND ');
    const sql = `UPDATE \`${database}\`.\`${table}\` SET ${set} WHERE ${cond} LIMIT 1`;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to update row' };
  }
});

ipcMain.handle('db-delete-row', async (event, database, table, where) => {
  try {
    if (Object.keys(where).length === 0) return { success: false, error: 'No WHERE condition' };
    const cond = Object.entries(where).map(([k, v]) => `\`${k}\`=${escapeSql(v)}`).join(' AND ');
    const sql = `DELETE FROM \`${database}\`.\`${table}\` WHERE ${cond} LIMIT 1`;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to delete row' };
  }
});

ipcMain.handle('db-truncate-table', async (event, database, table) => {
  try {
    const sql = `TRUNCATE TABLE \`${database}\`.\`${table}\``;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to truncate table' };
  }
});

ipcMain.handle('db-reset-auto-increment', async (event, database, table) => {
  try {
    const sql = `ALTER TABLE \`${database}\`.\`${table}\` AUTO_INCREMENT = 1`;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to reset auto-increment' };
  }
});

ipcMain.handle('db-drop-table', async (event, database, table) => {
  try {
    const sql = `DROP TABLE IF EXISTS \`${database}\`.\`${table}\``;
    const result = await mysqlQuery(sql);
    return { success: true, ...result, sql };
  } catch (e) {
    return { success: false, error: e.error || e.message || 'Failed to drop table' };
  }
});

ipcMain.handle('db-import-sql', async (event, database, filePath) => {
  try {
    const db = getMysqlClient();
    if (!db) return { success: false, error: 'MySQL/MariaDB is not running' };

    const args = getMysqlConnectionArgs();
    if (!args) return { success: false, error: 'Could not determine MySQL connection' };

    const fullArgs = [...args, '--force', database || ''].filter(Boolean);

    return new Promise((resolve) => {
      const proc = spawn(db.clientPath, fullArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      const stream = fs.createReadStream(filePath);

      const filter = new Transform({
        transform(chunk, encoding, callback) {
          const lines = chunk.toString().split('\n');
          const filtered = lines.filter(line => !line.includes('GTID_PURGED')).join('\n');
          callback(null, filtered);
        }
      });

      stream.pipe(filter).pipe(proc.stdin);

      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.stderr.on('data', d => { output += d.toString(); });

      proc.on('close', (code) => {
        resolve({ success: true, output: output || 'Import completed' });
      });

      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  } catch (e) {
    return { success: false, error: e.message || 'Failed to import SQL file' };
  }
});

function getMysqldumpPath() {
  const db = getMysqlClient();
  if (!db) return null;

  const dir = path.dirname(db.clientPath);
  const candidates = [path.join(dir, 'mysqldump')];
  if (PLATFORM === 'win32') {
    candidates.push(path.join(dir, 'mysqldump.exe'));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const result = execSync('which mysqldump', { encoding: 'utf8', timeout: 3000 }).trim();
    if (result) return result;
  } catch (e) { /* not in PATH */ }

  return null;
}

ipcMain.handle('db-export-table', async (event, database, table) => {
  try {
    const db = getMysqlClient();
    if (!db) return { success: false, error: 'MySQL/MariaDB is not running' };

    const mysqldumpPath = getMysqldumpPath();
    if (!mysqldumpPath) return { success: false, error: 'mysqldump not found' };

    const connArgs = getMysqlConnectionArgs();
    if (!connArgs) return { success: false, error: 'Could not determine MySQL connection' };

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Table',
      defaultPath: `${table}.sql`,
      filters: [{ name: 'SQL', extensions: ['sql'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Export cancelled' };
    }

    const dumpArgs = [...connArgs, '--no-tablespaces', '--skip-comments', '--set-gtid-purged=OFF', '--databases', database, '--tables', table];

    return new Promise((resolve) => {
      const proc = spawn(mysqldumpPath, dumpArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      const outStream = fs.createWriteStream(result.filePath);
      proc.stdout.pipe(outStream);

      let errOutput = '';
      proc.stderr.on('data', d => { errOutput += d.toString(); });

      proc.on('close', (code) => {
        outStream.end();
        if (code === 0) resolve({ success: true, filePath: result.filePath });
        else resolve({ success: false, error: errOutput || `Export failed with code ${code}` });
      });

      proc.on('error', (err) => {
        outStream.end();
        resolve({ success: false, error: err.message });
      });
    });
  } catch (e) {
    return { success: false, error: e.message || 'Failed to export table' };
  }
});

// --- IPC Handlers ---

ipcMain.handle('get-state', () => {
  const sites = getSites();
  const running = Object.keys(runningServers);
  const sitesWithStatus = sites.map(name => ({
    name,
    running: running.includes(name),
    port: portAllocations[name] || null,
    url: runningServers[name] ? `http://localhost:${portAllocations[name]}` : null
  }));

  return {
    sites: sitesWithStatus,
    phpPath,
    phpVersion: phpPath ? getPhpVersion(phpPath) : null,
    sitesPath: getSitesDir(),
    databases: detectedDatabases.map(d => ({ ...d })),
    preferences
  };
});

ipcMain.handle('start-server', async (event, siteName) => {
  try {
    const result = await startServer(siteName);
    sendStateToRenderer();
    updateTrayMenu();
    showNotification('PHP Server', `${siteName} started on ${result.url}`);
    return result;
  } catch (err) {
    const msg = err && (err.error || err.message || JSON.stringify(err));
    return { success: false, error: msg || 'Failed to start server' };
  }
});

ipcMain.handle('stop-server', async (event, siteName) => {
  const result = await stopServer(siteName);
  sendStateToRenderer();
  updateTrayMenu();
  if (result.success) {
    showNotification('PHP Server', `${siteName} stopped`);
  }
  return result;
});

ipcMain.handle('stop-all-servers', async () => {
  const result = await stopAllServers();
  sendStateToRenderer();
  updateTrayMenu();
  return result;
});

ipcMain.handle('open-browser', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-folder', async (event, siteName) => {
  try {
    const sitePath = path.join(getSitesDir(), siteName);
    const result = await shell.openPath(sitePath);
    return { success: !result, error: result || null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-sites-folder', async () => {
  try {
    const result = await shell.openPath(getSitesDir());
    return { success: !result, error: result || null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-php-path', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PHP Executable',
    filters: [
      { name: 'PHP', extensions: PLATFORM === 'win32' ? ['exe', 'bat'] : ['*'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    phpPath = result.filePaths[0];
    preferences.phpPath = phpPath;
    savePreferences(preferences);
    sendStateToRenderer();
    updateTrayMenu();
    return { success: true, phpPath, phpVersion: getPhpVersion(phpPath) };
  }
  return { success: false };
});

ipcMain.handle('change-sites-dir', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Sites Directory',
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    await stopAllServers();
    setSitesDir(result.filePaths[0]);
    sendStateToRenderer();
    updateTrayMenu();
    return { success: true, sitesDir: result.filePaths[0] };
  }
  return { success: false };
});

ipcMain.handle('create-site', async (event, siteName) => {
  if (!siteName || siteName.trim() === '') {
    return { success: false, error: 'Name cannot be empty' };
  }

  const dir = path.join(getSitesDir(), siteName.trim());
  if (fs.existsSync(dir)) {
    return { success: false, error: 'Site already exists' };
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    const indexPath = path.join(dir, 'index.php');
    fs.writeFileSync(indexPath, `<?php\nphpinfo();\n`);
    sendStateToRenderer();
    updateTrayMenu();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-site', async (event, siteName) => {
  const dir = path.join(getSitesDir(), siteName);
  if (!fs.existsSync(dir)) {
    return { success: false, error: 'Site not found' };
  }

  if (runningServers[siteName]) {
    await stopServer(siteName);
  }

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    sendStateToRenderer();
    updateTrayMenu();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('debug-php-check', async () => {
  const result = {
    phpPath,
    phpVersion: phpPath ? getPhpVersion(phpPath) : null,
    preferences: { ...preferences, sitesDir: preferences.sitesDir || '(default)' },
    exists: phpPath ? fs.existsSync(phpPath) : false,
    which: null
  };
  try {
    const which = PLATFORM === 'win32' ? 'where php' : 'which php';
    result.which = execSync(which, { encoding: 'utf8', timeout: 3000 }).trim();
  } catch (e) {
    result.which = 'not found in PATH';
  }
  return result;
});

ipcMain.handle('toggle-auto-start', async (event, siteName) => {
  if (preferences.autoStart === siteName) {
    preferences.autoStart = null;
  } else {
    preferences.autoStart = siteName;
  }
  savePreferences(preferences);
  return { success: true, autoStart: preferences.autoStart };
});

// --- App Lifecycle ---

app.whenReady().then(async () => {
  preferences = getPreferences();
  phpPath = detectPhp();
  detectedDatabases = detectDatabases();

  if (!fs.existsSync(path.join(__dirname, 'assets'))) {
    fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
  }

  createTray();
  createWindow();

  if (preferences.autoStart && getSites().includes(preferences.autoStart)) {
    setTimeout(async () => {
      await startServer(preferences.autoStart);
      sendStateToRenderer();
      updateTrayMenu();
    }, 1000);
  }
});

app.on('window-all-closed', () => {
  if (PLATFORM !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', async (event) => {
  event.preventDefault();
  await stopAllServers();
  await stopAllDatabases();
  app.exit(0);
});

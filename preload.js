const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  startServer: (siteName) => ipcRenderer.invoke('start-server', siteName),
  stopServer: (siteName) => ipcRenderer.invoke('stop-server', siteName),
  stopAllServers: () => ipcRenderer.invoke('stop-all-servers'),
  openBrowser: (url) => ipcRenderer.invoke('open-browser', url),
  openFolder: (siteName) => ipcRenderer.invoke('open-folder', siteName),
  openSitesFolder: () => ipcRenderer.invoke('open-sites-folder'),
  setPhpPath: () => ipcRenderer.invoke('set-php-path'),
  changeSitesDir: () => ipcRenderer.invoke('change-sites-dir'),
  createSite: (siteName) => ipcRenderer.invoke('create-site', siteName),
  deleteSite: (siteName) => ipcRenderer.invoke('delete-site', siteName),
  toggleAutoStart: (siteName) => ipcRenderer.invoke('toggle-auto-start', siteName),
  debugPhpCheck: () => ipcRenderer.invoke('debug-php-check'),

  startDatabase: (dbType) => ipcRenderer.invoke('start-database', dbType),
  stopDatabase: (dbType) => ipcRenderer.invoke('stop-database', dbType),
  installDatabase: (dbType) => ipcRenderer.invoke('install-database', dbType),

  onAppState: (callback) => ipcRenderer.on('app-state', (_event, data) => callback(data)),
  onServerStarted: (callback) => ipcRenderer.on('server-started', (_event, data) => callback(data)),
  onServerStopped: (callback) => ipcRenderer.on('server-stopped', (_event, data) => callback(data)),
  onServerLog: (callback) => ipcRenderer.on('server-log', (_event, data) => callback(data)),
  onDbStarted: (callback) => ipcRenderer.on('db-started', (_event, data) => callback(data)),
  onDbStopped: (callback) => ipcRenderer.on('db-stopped', (_event, data) => callback(data)),
});

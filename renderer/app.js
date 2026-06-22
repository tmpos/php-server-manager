let state = {
  sites: [],
  selectedSite: null,
  phpVersion: null,
  sitesPath: '',
  preferences: {}
};

let currentLog = [];

let dbState = {
  databases: [],
  selectedDatabase: '',
  tables: [],
  selectedTable: '',
  results: null,
  structure: null,
  activeTab: 'data',
  currentRows: [],
  editingRow: null,
  queryHistory: []
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function renderSitesList() {
  const list = $('#sites-list');
  if (state.sites.length === 0) {
    list.innerHTML = '<div class="loading">No sites found. Create one!</div>';
    return;
  }

  list.innerHTML = state.sites.map(site => {
    const isActive = state.selectedSite && state.selectedSite.name === site.name;
    return `
      <div class="site-item ${isActive ? 'active' : ''}" data-site="${site.name}">
        <div class="site-item-info">
          <div class="site-item-name">${site.name}</div>
          ${site.running ? `<div class="site-item-url">${site.url}</div>` : ''}
        </div>
        <div class="site-item-status ${site.running ? 'running' : 'stopped'}"></div>
      </div>
    `;
  }).join('');

  $$('.site-item').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.site;
      selectSite(name);
    });
  });
}

function selectSite(name) {
  const site = state.sites.find(s => s.name === name);
  if (!site) return;

  state.selectedSite = site;
  renderSitesList();
  showSiteDetail(site);
}

function showSiteDetail(site) {
  $('#welcome-view').classList.add('hidden');
  $('#site-detail-view').classList.remove('hidden');

  $('#site-detail-name').textContent = site.name;
  $('#site-path').textContent = `${state.sitesPath}/${site.name}`;

  if (site.running) {
    $('#site-status-dot').className = 'status-dot running';
    $('#site-status-text').textContent = 'Running';
    $('#site-status-text').style.color = 'var(--success)';
    $('#site-url').textContent = site.url;
    $('#site-port').textContent = site.port;
    $('#start-btn').classList.add('hidden');
    $('#stop-btn').classList.remove('hidden');
    $('#open-browser-btn').classList.remove('hidden');
  } else {
    $('#site-status-dot').className = 'status-dot stopped';
    $('#site-status-text').textContent = 'Stopped';
    $('#site-status-text').style.color = 'var(--text-muted)';
    $('#site-url').textContent = '-';
    $('#site-port').textContent = '-';
    $('#start-btn').classList.remove('hidden');
    $('#stop-btn').classList.add('hidden');
    $('#open-browser-btn').classList.add('hidden');
  }
}

function showWelcome() {
  state.selectedSite = null;
  $('#site-detail-view').classList.add('hidden');
  $('#welcome-view').classList.remove('hidden');
  renderSitesList();
}

async function refreshState() {
  try {
    state = await window.electronAPI.getState();
    updatePhpStatus();
    renderSitesList();

    if (state.selectedSite) {
      const stillExists = state.sites.find(s => s.name === state.selectedSite.name);
      if (stillExists) {
        showSiteDetail(stillExists);
        state.selectedSite = stillExists;
      } else {
        showWelcome();
      }
    }

    renderDatabases();
    $('#sites-path').textContent = state.sitesPath;
  } catch (e) {
    console.error('Failed to get state:', e);
  }
}

function updatePhpStatus() {
  const badge = $('#php-status-badge');
  const version = $('#php-version');

  if (state.phpPath) {
    badge.textContent = '✓ PHP ' + (state.phpVersion || '');
    badge.className = 'status-badge ok';
    version.textContent = 'PHP ' + (state.phpVersion || '');
  } else {
    badge.textContent = '✗ Not found';
    badge.className = 'status-badge error';
    version.textContent = 'PHP not detected';
  }
}

function renderDatabases() {
  const list = $('#db-list');
  if (!state.databases || state.databases.length === 0) {
    list.innerHTML = `<div class="db-item">
      <div class="db-info">
        <div class="db-name">No database detected</div>
        <div class="db-detail">Install MySQL or PostgreSQL via Homebrew</div>
      </div>
      <button class="btn btn-tiny btn-primary db-install-btn" data-db="mysql">Install MySQL</button>
    </div>`;
    const installBtn = list.querySelector('.db-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        const result = await window.electronAPI.installDatabase('mysql');
        if (result.success) {
            alert('MySQL installed! Restart the app.');
            await refreshState();
        } else {
            alert('Error: ' + (result.error || 'Installation failed'));
        }
      });
    }
    return;
  }

  list.innerHTML = state.databases.map(db => {
    const running = db.status === 'running';
    const isMysql = db.type === 'mysql' || db.type === 'mariadb';
    return `<div class="db-item">
      <div class="db-status-dot ${running ? 'running' : 'stopped'}"></div>
      <div class="db-info">
        <div class="db-name">${db.name}</div>
        <div class="db-detail">${db.version ? 'v' + db.version : ''}${db.port ? ' · Port ' + db.port : ''}</div>
        <div class="db-detail">${running ? 'Running' : 'Stopped'}</div>
      </div>
      <div class="db-actions">
        ${running && isMysql ? `<button class="btn btn-tiny btn-primary db-manage-btn" data-db="${db.type}">Manage</button>` : ''}
        <button class="btn btn-tiny ${running ? 'btn-danger' : 'btn-primary'} db-toggle-btn" data-db="${db.type}">
          ${running ? 'Stop' : 'Start'}
        </button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.db-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dbType = btn.dataset.db;
      const db = state.databases.find(d => d.type === dbType);
      if (db.status === 'running') {
        await window.electronAPI.stopDatabase(dbType);
      } else {
        const result = await window.electronAPI.startDatabase(dbType);
        if (!result.success) {
          alert('Failed to start ' + dbType + ': ' + (result.error || 'Unknown error'));
        }
      }
      await refreshState();
    });
  });

  list.querySelectorAll('.db-manage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showDbManager();
    });
  });
}

function handleServerStartResult(result) {
  if (!result.success) {
    alert('Failed to start server: ' + (result.error || 'Unknown error'));
  }
  refreshState();
}

function handleServerStopResult(result) {
  if (!result.success) {
    alert('Failed to stop server: ' + (result.error || 'Unknown error'));
  }
  refreshState();
}

// Event Listeners

document.addEventListener('DOMContentLoaded', async () => {
  await refreshState();
  showWelcome();

  // Sidebar
  $('#change-php-btn').addEventListener('click', async () => {
    await window.electronAPI.setPhpPath();
    await refreshState();
  });

  $('#debug-php-btn').addEventListener('click', async () => {
    const info = await window.electronAPI.debugPhpCheck();
    alert(JSON.stringify(info, null, 2));
  });

  $('#open-sites-btn').addEventListener('click', async () => {
    const result = await window.electronAPI.openSitesFolder();
    if (!result.success) alert('Error opening folder: ' + (result.error || 'unknown'));
  });

  $('#change-dir-btn').addEventListener('click', async () => {
    const result = await window.electronAPI.changeSitesDir();
    if (result.success) {
      showWelcome();
      await refreshState();
      if (state.sites.length === 0) {
        alert(`No sites found in:\n${state.sitesPath}\n\nMake sure this folder contains subdirectories with PHP projects.`);
      }
    }
  });

  $('#sites-path').addEventListener('click', async () => {
    const result = await window.electronAPI.changeSitesDir();
    if (result.success) {
      showWelcome();
      await refreshState();
      if (state.sites.length === 0) {
        alert(`No sites found in:\n${state.sitesPath}\n\nMake sure this folder contains subdirectories with PHP projects.`);
      }
    }
  });

  $('#create-site-btn').addEventListener('click', () => {
    $('#create-modal').classList.remove('hidden');
    $('#new-site-name').value = '';
    $('#new-site-name').focus();
  });

  // Site detail
  $('#start-btn').addEventListener('click', async () => {
    if (state.selectedSite) {
      const result = await window.electronAPI.startServer(state.selectedSite.name);
      handleServerStartResult(result);
    }
  });

  $('#stop-btn').addEventListener('click', async () => {
    if (state.selectedSite) {
      const result = await window.electronAPI.stopServer(state.selectedSite.name);
      handleServerStopResult(result);
    }
  });

  $('#open-browser-btn').addEventListener('click', async () => {
    if (state.selectedSite && state.selectedSite.url) {
      const result = await window.electronAPI.openBrowser(state.selectedSite.url);
      if (!result.success) alert('Error opening browser: ' + (result.error || 'unknown'));
    }
  });

  $('#open-folder-btn').addEventListener('click', async () => {
    if (state.selectedSite) {
      const result = await window.electronAPI.openFolder(state.selectedSite.name);
      if (!result.success) alert('Error opening folder: ' + (result.error || 'unknown'));
    }
  });

  $('#delete-site-btn').addEventListener('click', async () => {
    if (!state.selectedSite) return;
    const name = state.selectedSite.name;
    if (confirm(`Delete "${name}" and all its files?`)) {
      await window.electronAPI.deleteSite(name);
      await refreshState();
      showWelcome();
    }
  });

  $('#back-btn').addEventListener('click', showWelcome);

  $('#stop-all-btn').addEventListener('click', async () => {
    const running = state.sites.filter(s => s.running).length;
    if (running === 0) {
      alert('No servers running.');
      return;
    }
    await window.electronAPI.stopAllServers();
    await refreshState();
    alert(`Stopped ${running} server(s).`);
  });

  // Modal
  $('#modal-cancel').addEventListener('click', () => {
    $('#create-modal').classList.add('hidden');
  });

  $('#modal-create').addEventListener('click', async () => {
    const name = $('#new-site-name').value.trim();
    if (!name) return;

    const result = await window.electronAPI.createSite(name);
    if (result.success) {
      $('#create-modal').classList.add('hidden');
      await refreshState();
      selectSite(name);
    } else {
      alert('Error: ' + (result.error || 'Could not create site'));
    }
  });

  $('#create-modal').addEventListener('click', (e) => {
    if (e.target === $('#create-modal')) {
      $('#create-modal').classList.add('hidden');
    }
  });

  $('#new-site-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#modal-create').click();
    if (e.key === 'Escape') $('#modal-cancel').click();
  });

  // Create Table
  function addColumnRow(data) {
    const list = $('#ct-columns-list');
    const index = list.children.length;
    const row = document.createElement('div');
    row.className = 'ct-column-row';
    row.dataset.index = index;
    row.innerHTML = `
      <div class="ct-col-fields">
        <input type="text" class="ct-col-name form-input-sm" placeholder="name" value="${data?.name || ''}" />
        <select class="ct-col-type form-select-sm">
          <option value="INT" ${data?.type === 'INT' ? 'selected' : ''}>INT</option>
          <option value="BIGINT" ${data?.type === 'BIGINT' ? 'selected' : ''}>BIGINT</option>
          <option value="TINYINT" ${data?.type === 'TINYINT' ? 'selected' : ''}>TINYINT</option>
          <option value="SMALLINT" ${data?.type === 'SMALLINT' ? 'selected' : ''}>SMALLINT</option>
          <option value="MEDIUMINT" ${data?.type === 'MEDIUMINT' ? 'selected' : ''}>MEDIUMINT</option>
          <option value="VARCHAR" ${!data?.type || data?.type === 'VARCHAR' ? 'selected' : ''}>VARCHAR</option>
          <option value="CHAR" ${data?.type === 'CHAR' ? 'selected' : ''}>CHAR</option>
          <option value="TEXT" ${data?.type === 'TEXT' ? 'selected' : ''}>TEXT</option>
          <option value="MEDIUMTEXT" ${data?.type === 'MEDIUMTEXT' ? 'selected' : ''}>MEDIUMTEXT</option>
          <option value="LONGTEXT" ${data?.type === 'LONGTEXT' ? 'selected' : ''}>LONGTEXT</option>
          <option value="FLOAT" ${data?.type === 'FLOAT' ? 'selected' : ''}>FLOAT</option>
          <option value="DOUBLE" ${data?.type === 'DOUBLE' ? 'selected' : ''}>DOUBLE</option>
          <option value="DECIMAL" ${data?.type === 'DECIMAL' ? 'selected' : ''}>DECIMAL</option>
          <option value="BOOLEAN" ${data?.type === 'BOOLEAN' ? 'selected' : ''}>BOOLEAN</option>
          <option value="DATE" ${data?.type === 'DATE' ? 'selected' : ''}>DATE</option>
          <option value="DATETIME" ${data?.type === 'DATETIME' ? 'selected' : ''}>DATETIME</option>
          <option value="TIMESTAMP" ${data?.type === 'TIMESTAMP' ? 'selected' : ''}>TIMESTAMP</option>
          <option value="BLOB" ${data?.type === 'BLOB' ? 'selected' : ''}>BLOB</option>
          <option value="JSON" ${data?.type === 'JSON' ? 'selected' : ''}>JSON</option>
          <option value="ENUM" ${data?.type === 'ENUM' ? 'selected' : ''}>ENUM</option>
        </select>
        <input type="text" class="ct-col-length form-input-sm" placeholder="Length" value="${data?.length || '255'}" />
      </div>
      <div class="ct-col-checks">
        <label class="ct-check-label"><input type="checkbox" class="ct-col-null" ${data?.notNull !== true ? 'checked' : ''} /> NULL</label>
        <label class="ct-check-label"><input type="checkbox" class="ct-col-pk" ${data?.primaryKey ? 'checked' : ''} /> PK</label>
        <label class="ct-check-label"><input type="checkbox" class="ct-col-ai" ${data?.autoIncrement ? 'checked' : ''} /> AI</label>
        <label class="ct-check-label"><input type="checkbox" class="ct-col-unsigned" ${data?.unsigned ? 'checked' : ''} /> UNSIGNED</label>
        <input type="text" class="ct-col-default form-input-sm" placeholder="Default" value="${data?.defaultValue || ''}" />
      </div>
      <button class="btn btn-tiny btn-danger-outline ct-col-remove" title="Remove column">✕</button>
    `;
    list.appendChild(row);
    row.querySelector('.ct-col-remove').addEventListener('click', () => row.remove());
    return row;
  }

  function collectColumns() {
    return Array.from(document.querySelectorAll('#ct-columns-list .ct-column-row')).map(row => {
      const nullCb = row.querySelector('.ct-col-null');
      return {
        name: row.querySelector('.ct-col-name').value.trim(),
        type: row.querySelector('.ct-col-type').value,
        length: row.querySelector('.ct-col-length').value.trim(),
        notNull: nullCb ? !nullCb.checked : true,
        primaryKey: row.querySelector('.ct-col-pk').checked,
        autoIncrement: row.querySelector('.ct-col-ai').checked,
        unsigned: row.querySelector('.ct-col-unsigned').checked,
        defaultValue: row.querySelector('.ct-col-default').value.trim()
      };
    }).filter(c => c.name !== '');
  }

  function resetCreateTableForm() {
    $('#ct-table-name').value = '';
    const list = $('#ct-columns-list');
    list.innerHTML = '';
    addColumnRow({ type: 'INT', length: '', notNull: true, primaryKey: true, autoIncrement: true, unsigned: true });
    addColumnRow({ type: 'VARCHAR', length: '255', notNull: true });
  }

  async function handleCreateTable() {
    const tableName = $('#ct-table-name').value.trim();
    if (!tableName) { alert('Enter a table name'); return; }
    const columns = collectColumns();
    if (columns.length === 0) { alert('Add at least one column'); return; }

    const result = await window.electronAPI.dbCreateTable(dbState.selectedDatabase, tableName, columns);
    if (result.success) {
      $('#create-table-modal').classList.add('hidden');
      $('#db-query-input').value = `SELECT * FROM \`${dbState.selectedDatabase}\`.\`${tableName}\` LIMIT 100`;
      await loadTables(dbState.selectedDatabase);
      runQuery();
    } else {
      alert('Error: ' + (result.error || 'Could not create table'));
    }
  }

  // DB Manager
  function setupDbManager() {
    $('#db-back-btn').addEventListener('click', hideDbManager);

    $('#db-select').addEventListener('change', async () => {
      const db = $('#db-select').value;
      if (db) {
        dbState.selectedDatabase = db;
        dbState.selectedTable = '';
        dbState.results = null;
        await loadTables(db);
        $('#db-query-input').value = `SELECT * FROM \`${db}\` `;
        $('#db-results-wrapper').innerHTML = '<div class="db-results-empty">Run a query to see results</div>';
        $('#db-results-info').textContent = '';
      } else {
        dbState.selectedDatabase = '';
        dbState.tables = [];
        dbState.selectedTable = '';
        $('#db-table-list').innerHTML = '<div class="db-empty">Select a database</div>';
      }
    });

    $('#db-create-btn').addEventListener('click', () => {
      $('#new-db-name').value = '';
      $('#create-db-modal').classList.remove('hidden');
      $('#new-db-name').focus();
    });

    $('#db-delete-btn').addEventListener('click', handleDeleteDatabase);

    $('#db-import-db-btn').addEventListener('click', handleImportSql);

    $('#db-refresh-btn').addEventListener('click', async () => {
      if (dbState.selectedDatabase) {
        await loadTables(dbState.selectedDatabase);
      }
      await loadDatabases();
    });

    $('#db-run-btn').addEventListener('click', runQuery);

    $('#db-clear-btn').addEventListener('click', () => {
      $('#db-query-input').value = '';
      $('#db-results-wrapper').innerHTML = '<div class="db-results-empty">Run a query to see results</div>';
      $('#db-results-info').textContent = '';
    });

    $('#db-query-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runQuery();
      }
    });

    // Create DB modal
    $('#db-modal-cancel').addEventListener('click', () => {
      $('#create-db-modal').classList.add('hidden');
    });
    $('#db-modal-create').addEventListener('click', handleCreateDatabase);
    $('#new-db-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCreateDatabase();
      if (e.key === 'Escape') $('#create-db-modal').classList.add('hidden');
    });
    $('#create-db-modal').addEventListener('click', (e) => {
      if (e.target === $('#create-db-modal')) {
        $('#create-db-modal').classList.add('hidden');
      }
    });

    // Confirm modal
    $('#confirm-modal').addEventListener('click', (e) => {
      if (e.target === $('#confirm-modal')) {
        $('#confirm-modal').classList.add('hidden');
      }
    });

    // Create Table
    $('#db-new-table-btn').addEventListener('click', () => {
      if (!dbState.selectedDatabase) { alert('Select a database first'); return; }
      resetCreateTableForm();
      $('#create-table-modal').classList.remove('hidden');
      $('#ct-table-name').focus();
    });

    $('#ct-add-col-btn').addEventListener('click', () => addColumnRow());

    $('#ct-cancel').addEventListener('click', () => {
      $('#create-table-modal').classList.add('hidden');
    });

    $('#ct-create').addEventListener('click', handleCreateTable);

    $('#ct-table-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCreateTable();
      if (e.key === 'Escape') $('#create-table-modal').classList.add('hidden');
    });

    $('#create-table-modal').addEventListener('click', (e) => {
      if (e.target === $('#create-table-modal')) {
        $('#create-table-modal').classList.add('hidden');
      }
    });

    // Tabs
    document.querySelectorAll('.db-results-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activateTab(tab.dataset.tab);
      });
    });

    // Add / Drop column
    $('#db-add-col-btn').addEventListener('click', openAddColumnModal);

    $('#ac-cancel').addEventListener('click', () => {
      $('#add-column-modal').classList.add('hidden');
    });

    $('#ac-create').addEventListener('click', handleAddColumn);

    $('#ac-col-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddColumn();
      if (e.key === 'Escape') $('#add-column-modal').classList.add('hidden');
    });

    $('#add-column-modal').addEventListener('click', (e) => {
      if (e.target === $('#add-column-modal')) {
        $('#add-column-modal').classList.add('hidden');
      }
    });

    // Data manipulation
    $('#db-insert-row-btn').addEventListener('click', openInsertForm);
    $('#db-export-btn').addEventListener('click', handleExportTable);
    $('#db-drop-table-btn').addEventListener('click', handleDropTable);
    $('#db-truncate-btn').addEventListener('click', handleTruncate);
    $('#db-reset-ai-btn').addEventListener('click', handleResetAI);
    $('#db-import-sql-btn').addEventListener('click', handleImportSql);

    $('#df-cancel').addEventListener('click', () => {
      $('#data-form-modal').classList.add('hidden');
    });

    $('#df-save').addEventListener('click', handleSaveRow);

    $('#data-form-modal').addEventListener('click', (e) => {
      if (e.target === $('#data-form-modal')) {
        $('#data-form-modal').classList.add('hidden');
      }
    });

    $('#import-file-input').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImportFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }
  setupDbManager();

  // Clear log
  $('#clear-log-btn').addEventListener('click', () => {
    currentLog = [];
    renderLog();
  });

  // IPC events
  window.electronAPI.onAppState(async (data) => {
    state.sites = data.sites;
    state.phpPath = data.phpPath;
    state.phpVersion = data.phpVersion;
    state.sitesPath = data.sitesPath;
    state.databases = data.databases;
    state.preferences = data.preferences;
    updatePhpStatus();
    renderSitesList();
    renderDatabases();
  });

  window.electronAPI.onServerStarted((data) => {
    const site = state.sites.find(s => s.name === data.site);
    if (site) {
      site.running = true;
      site.port = data.port;
      site.url = data.url;
      if (state.selectedSite && state.selectedSite.name === data.site) {
        showSiteDetail(site);
      }
    }
    renderSitesList();
  });

  window.electronAPI.onServerStopped((data) => {
    const site = state.sites.find(s => s.name === data.site);
    if (site) {
      site.running = false;
      site.port = null;
      site.url = null;
      if (state.selectedSite && state.selectedSite.name === data.site) {
        showSiteDetail(site);
      }
    }
    renderSitesList();
  });

  window.electronAPI.onServerLog((data) => {
    if (state.selectedSite && data.site === state.selectedSite.name) {
      currentLog.push(data.data);
      if (currentLog.length > 500) currentLog.shift();
      renderLog();
    }
  });
});

function renderLog() {
  const output = $('#log-output');
  if (currentLog.length === 0) {
    output.innerHTML = '<div class="log-empty">Server output will appear here...</div>';
    return;
  }

  output.innerHTML = currentLog.map(line => {
    const className = line.toLowerCase().includes('error') || line.toLowerCase().includes('warn')
      ? 'log-entry error'
      : 'log-entry';
    return `<div class="${className}">${escapeHtml(line)}</div>`;
  }).join('');

  output.scrollTop = output.scrollHeight;
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '<span class="null-value">NULL</span>';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// --- DB Manager ---

function showDbManager() {
  $('#welcome-view').classList.add('hidden');
  $('#site-detail-view').classList.add('hidden');
  $('#db-manager-view').classList.remove('hidden');

  const mysqlDb = (state.databases || []).find(d => (d.type === 'mysql' || d.type === 'mariadb') && d.status === 'running');
  if (mysqlDb) {
    $('#db-connection-info').textContent = `${mysqlDb.name} • localhost:${mysqlDb.port}`;
  } else {
    $('#db-connection-info').textContent = 'Not connected';
  }

  dbState.selectedDatabase = '';
  dbState.selectedTable = '';
  dbState.tables = [];
  dbState.results = null;
  loadDatabases();
}

function hideDbManager() {
  $('#db-manager-view').classList.add('hidden');
  $('#db-table-actions').classList.add('hidden');
  showWelcome();
}

async function loadDatabases() {
  const result = await window.electronAPI.dbListDatabases();
  if (!result.success) {
    $('#db-select').innerHTML = '<option value="">Error loading databases</option>';
    return;
  }
  dbState.databases = (result.rows || []).map(r => r.Database).filter(d => d && !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(d));
  renderDbSelect();
}

function renderDbSelect() {
  const select = $('#db-select');
  select.innerHTML = `<option value="">— Select database —</option>
    ${dbState.databases.map(d => `<option value="${escapeHtml(d)}" ${d === dbState.selectedDatabase ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}`;
  select.value = dbState.selectedDatabase || '';
  if (dbState.selectedDatabase) {
    loadTables(dbState.selectedDatabase);
  } else {
    $('#db-table-list').innerHTML = '<div class="db-empty">Select a database</div>';
  }
}

async function loadTables(database) {
  dbState.selectedDatabase = database;
  const result = await window.electronAPI.dbListTables(database);
  if (!result.success) {
    $('#db-table-list').innerHTML = `<div class="db-empty">Error: ${escapeHtml(result.error)}</div>`;
    return;
  }
  const rows = result.rows || [];
  const key = Object.keys((rows[0] || {}))[0] || `Tables_in_${database}`;
  dbState.tables = rows.map(r => r[key]).filter(Boolean);
  renderDbTables();
}

function renderDbTables() {
  const container = $('#db-table-list');
  const db = dbState.selectedDatabase;
  if (!db || dbState.tables.length === 0) {
    container.innerHTML = '<div class="db-empty">No tables</div>';
    return;
  }
  container.innerHTML = `<div class="db-explorer-subheader">${escapeHtml(db)} (${dbState.tables.length})</div>
    ${dbState.tables.map(t => `
      <div class="db-table-item ${t === dbState.selectedTable ? 'active' : ''}" data-table="${escapeHtml(t)}">
        <span class="table-icon">&#x25A2;</span> ${escapeHtml(t)}
      </div>
    `).join('')}`;

  container.querySelectorAll('.db-table-item').forEach(el => {
    el.addEventListener('click', async () => {
      const table = el.dataset.table;
      dbState.selectedTable = table;
      dbState.activeTab = 'data';
      dbState.results = null;
      $('#db-table-actions').classList.remove('hidden');
      $('#db-query-input').value = `SELECT * FROM \`${dbState.selectedDatabase}\`.\`${table}\` LIMIT 100`;
      try {
        await loadTableStructure(dbState.selectedDatabase, table);
        runQuery();
      } catch (e) {
        console.error(e);
      }
      renderDbTables();
    });
  });
}

async function runQuery() {
  const query = $('#db-query-input').value.trim();
  if (!query) return;

  const result = await window.electronAPI.dbExecuteQuery(query);
  dbState.results = result;
  dbState.activeTab = 'data';
  document.querySelectorAll('.db-results-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'data'));
  renderDbResults(result);
}

function renderDbResults(result) {
  const wrapper = $('#db-results-wrapper');
  const info = $('#db-results-info');

  if (!result || !result.success) {
    const err = result ? result.error : 'No result';
    wrapper.innerHTML = `<div class="db-results-error">${escapeHtml(err)}</div>`;
    info.textContent = 'Error';
    return;
  }

  if (result.type === 'ok' || result.type === 'empty') {
    wrapper.innerHTML = '<div class="db-results-empty">Query executed successfully.</div>';
    info.textContent = result.affectedRows ? `${result.affectedRows} rows affected` : 'OK';
    return;
  }

  if (result.type === 'select' && result.rows) {
    const { headers, rows } = result;
    dbState.currentRows = rows;
    if (rows.length === 0) {
      wrapper.innerHTML = '<div class="db-results-empty">Empty result set</div>';
      info.textContent = '0 rows';
      return;
    }
    const hasTable = !!dbState.selectedTable;
    info.textContent = `${rows.length} rows`;
    wrapper.innerHTML = `<table class="db-results-table">
      <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}${hasTable ? '<th class="col-action">Actions</th>' : ''}</tr></thead>
      <tbody>${rows.map((row, idx) => `<tr>
        ${headers.map(h => `<td>${escapeHtml(row[h])}</td>`).join('')}
        ${hasTable ? `<td class="col-action">
          <button class="btn btn-tiny btn-primary db-edit-row" data-idx="${idx}" title="Edit">✎</button>
          <button class="btn btn-tiny btn-danger-outline db-delete-row" data-idx="${idx}" title="Delete">✕</button>
        </td>` : ''}
      </tr>`).join('')}</tbody>
    </table>`;

    wrapper.querySelectorAll('.db-edit-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        openEditForm(idx);
      });
    });
    wrapper.querySelectorAll('.db-delete-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        handleDeleteRow(idx);
      });
    });
    return;
  }

  wrapper.innerHTML = `<div class="db-results-empty">${escapeHtml(JSON.stringify(result))}</div>`;
  info.textContent = '';
}

async function loadTableStructure(database, table) {
  const result = await window.electronAPI.dbDescribeTable(database, table);
  if (result.success) {
    dbState.structure = result;
  } else {
    dbState.structure = null;
  }
}

function activateTab(tab) {
  dbState.activeTab = tab;
  document.querySelectorAll('.db-results-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (tab === 'structure' && dbState.structure) {
    renderTableStructure();
  } else if (tab === 'data' && dbState.results) {
    renderDbResults(dbState.results);
  } else if (tab === 'data') {
    $('#db-results-wrapper').innerHTML = '<div class="db-results-empty">Run a query to see results</div>';
  }
}

function renderTableStructure() {
  const wrapper = $('#db-results-wrapper');
  const info = $('#db-results-info');
  const struct = dbState.structure;

  if (!struct || !struct.rows || struct.rows.length === 0) {
    wrapper.innerHTML = '<div class="db-results-empty">No structure information</div>';
    info.textContent = '';
    return;
  }

  const cols = ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'];
  info.textContent = `${struct.rows.length} columns`;
  wrapper.innerHTML = `<table class="db-results-table">
    <thead><tr>${cols.map(h => `<th>${h}</th>`).join('')}<th class="col-action">Action</th></tr></thead>
    <tbody>${struct.rows.map(row => {
      const field = row.Field;
      const isPk = row.Key === 'PRI';
      return `<tr>
        ${cols.map(h => `<td>${escapeHtml(row[h])}</td>`).join('')}
        <td class="col-action">
          <button class="btn btn-tiny btn-danger-outline struct-drop-col" data-field="${escapeHtml(field)}" title="Drop column">✕</button>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  wrapper.querySelectorAll('.struct-drop-col').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      $('#confirm-title').textContent = `Drop Column \`${field}\``;
      $('#confirm-message').textContent = `Are you sure you want to drop column "${field}" from table \`${dbState.selectedTable}\`? All data in this column will be lost.`;
      $('#confirm-ok').textContent = 'Drop Column';
      $('#confirm-ok').className = 'btn btn-danger';
      $('#confirm-ok').onclick = async () => {
        $('#confirm-modal').classList.add('hidden');
        const result = await window.electronAPI.dbDropColumn(dbState.selectedDatabase, dbState.selectedTable, field);
        if (result.success) {
          await loadTableStructure(dbState.selectedDatabase, dbState.selectedTable);
          renderTableStructure();
        } else {
          alert('Error: ' + (result.error || 'Failed to drop column'));
        }
      };
      $('#confirm-cancel').onclick = () => $('#confirm-modal').classList.add('hidden');
      $('#confirm-modal').classList.remove('hidden');
    });
  });
}

function openAddColumnModal() {
  if (!dbState.selectedTable) { alert('Select a table first'); return; }
  $('#ac-col-name').value = '';
  $('#ac-col-type').value = 'VARCHAR';
  $('#ac-col-length').value = '255';
  $('#ac-col-null').checked = true;
  $('#ac-col-unsigned').checked = false;
  $('#ac-col-ai').checked = false;
  $('#ac-col-default').value = '';

  const afterSelect = $('#ac-col-after');
  afterSelect.innerHTML = '<option value="">At end (default)</option>';
  if (dbState.structure && dbState.structure.rows) {
    dbState.structure.rows.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.Field;
      opt.textContent = `After \`${r.Field}\``;
      afterSelect.appendChild(opt);
    });
  }

  $('#add-column-modal').classList.remove('hidden');
  $('#ac-col-name').focus();
}

async function handleAddColumn() {
  const name = $('#ac-col-name').value.trim();
  if (!name) { alert('Enter a column name'); return; }

  const col = {
    name: name,
    type: $('#ac-col-type').value,
    length: $('#ac-col-length').value.trim(),
    notNull: !$('#ac-col-null').checked,
    unsigned: $('#ac-col-unsigned').checked,
    autoIncrement: $('#ac-col-ai').checked,
    defaultValue: $('#ac-col-default').value.trim(),
    after: $('#ac-col-after').value
  };

  const result = await window.electronAPI.dbAddColumn(dbState.selectedDatabase, dbState.selectedTable, col);
  if (result.success) {
    $('#add-column-modal').classList.add('hidden');
    alert(`Column "${name}" added successfully`);
    await loadTableStructure(dbState.selectedDatabase, dbState.selectedTable);
    renderTableStructure();
  } else {
    alert('Error: ' + (result.error || 'Failed to add column'));
  }
}

// --- Data manipulation ---

function getPkColumns() {
  if (!dbState.structure || !dbState.structure.rows) return [];
  return dbState.structure.rows.filter(r => r.Key === 'PRI').map(r => r.Field);
}

function buildWhereFromRow(row) {
  const pkCols = getPkColumns();
  const cols = pkCols.length > 0 ? pkCols : Object.keys(row);
  const where = {};
  cols.forEach(c => { where[c] = row[c]; });
  return where;
}

function buildDataForm(title, rowData) {
  const struct = dbState.structure;
  if (!struct || !struct.rows) return;

  $('#df-title').textContent = title;
  const form = $('#df-form');
  form.innerHTML = struct.rows.map(col => {
    const field = col.Field;
    const isAutoInc = col.Extra && col.Extra.toUpperCase().includes('AUTO_INCREMENT');
    const type = col.Type.toLowerCase();
    const isText = type.includes('text') || type.includes('blob') || type.includes('json');
    const currentVal = rowData ? rowData[field] : '';
    const displayVal = currentVal === null ? '' : currentVal;
    const isNull = rowData ? rowData[field] === null : false;

    return `<div class="df-field">
      <label class="df-label">${escapeHtml(field)} <span class="df-type">${escapeHtml(col.Type)}</span></label>
      <div class="df-input-row">
        ${isText
          ? `<textarea class="df-input df-textarea" data-field="${escapeHtml(field)}">${escapeHtml(displayVal)}</textarea>`
          : `<input type="text" class="df-input" data-field="${escapeHtml(field)}" value="${escapeHtml(displayVal)}" ${isAutoInc ? 'readonly' : ''} />`
        }
        ${col.Null === 'YES' && !isAutoInc
          ? `<label class="ct-check-label df-null-cb"><input type="checkbox" class="df-null-chk" data-field="${escapeHtml(field)}" ${isNull ? 'checked' : ''} /> NULL</label>`
          : ''
        }
      </div>
    </div>`;
  }).join('');

  form.querySelectorAll('.df-null-chk').forEach(cb => {
    cb.addEventListener('change', () => {
      const input = form.querySelector(`.df-input[data-field="${cb.dataset.field}"]`);
      if (input) input.disabled = cb.checked;
    });
    if (cb.checked) {
      const input = form.querySelector(`.df-input[data-field="${cb.dataset.field}"]`);
      if (input) input.disabled = true;
    }
  });
}

function collectFormData() {
  const data = {};
  document.querySelectorAll('#df-form .df-field').forEach(field => {
    const input = field.querySelector('.df-input');
    const nullCb = field.querySelector('.df-null-chk');
    const fieldName = input.dataset.field;
    if (nullCb && nullCb.checked) {
      data[fieldName] = null;
    } else if (input.readonly) {
      data[fieldName] = '__omit__';
    } else {
      data[fieldName] = input.value;
    }
  });
  return data;
}

function openInsertForm() {
  if (!dbState.selectedTable) { alert('Select a table first'); return; }
  dbState.editingRow = null;
  buildDataForm('Insert Row', null);
  $('#data-form-modal').classList.remove('hidden');
}

function openEditForm(idx) {
  const row = dbState.currentRows[idx];
  if (!row) return;
  dbState.editingRow = { idx, where: buildWhereFromRow(row) };
  buildDataForm('Edit Row', row);
  $('#data-form-modal').classList.remove('hidden');
}

async function handleSaveRow() {
  const data = collectFormData();
  const db = dbState.selectedDatabase;
  const table = dbState.selectedTable;

  let result;
  if (dbState.editingRow) {
    result = await window.electronAPI.dbUpdateRow(db, table, data, dbState.editingRow.where);
  } else {
    result = await window.electronAPI.dbInsertRow(db, table, data);
  }

  if (result.success) {
    $('#data-form-modal').classList.add('hidden');
    $('#db-query-input').value = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 100`;
    await loadTableStructure(db, table);
    runQuery();
  } else {
    alert('Error: ' + (result.error || 'Operation failed'));
  }
}

async function handleDeleteRow(idx) {
  const row = dbState.currentRows[idx];
  if (!row) return;
  const where = buildWhereFromRow(row);
  const db = dbState.selectedDatabase;
  const table = dbState.selectedTable;

  $('#confirm-title').textContent = 'Delete Row';
  $('#confirm-message').textContent = `Are you sure you want to delete this row from \`${table}\`?`;
  $('#confirm-ok').textContent = 'Delete';
  $('#confirm-ok').className = 'btn btn-danger';
  $('#confirm-ok').onclick = async () => {
    $('#confirm-modal').classList.add('hidden');
    const result = await window.electronAPI.dbDeleteRow(db, table, where);
    if (result.success) {
      $('#db-query-input').value = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 100`;
      runQuery();
    } else {
      alert('Error: ' + (result.error || 'Failed to delete row'));
    }
  };
  $('#confirm-cancel').onclick = () => $('#confirm-modal').classList.add('hidden');
  $('#confirm-modal').classList.remove('hidden');
}

async function handleTruncate() {
  const db = dbState.selectedDatabase;
  const table = dbState.selectedTable;
  if (!table) return;

  $('#confirm-title').textContent = 'Truncate Table';
  $('#confirm-message').textContent = `Are you sure you want to TRUNCATE \`${table}\`? All data will be permanently deleted and AUTO_INCREMENT will be reset.`;
  $('#confirm-ok').textContent = 'Truncate';
  $('#confirm-ok').className = 'btn btn-danger';
  $('#confirm-ok').onclick = async () => {
    $('#confirm-modal').classList.add('hidden');
    const result = await window.electronAPI.dbTruncateTable(db, table);
    if (result.success) {
      alert(`Table \`${table}\` truncated.`);
      $('#db-query-input').value = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 100`;
      runQuery();
    } else {
      alert('Error: ' + (result.error || 'Failed to truncate'));
    }
  };
  $('#confirm-cancel').onclick = () => $('#confirm-modal').classList.add('hidden');
  $('#confirm-modal').classList.remove('hidden');
}

async function handleResetAI() {
  const db = dbState.selectedDatabase;
  const table = dbState.selectedTable;
  if (!table) return;

  const result = await window.electronAPI.dbResetAutoIncrement(db, table);
  if (result.success) {
    alert(`AUTO_INCREMENT reset for \`${table}\`.`);
  } else {
    alert('Error: ' + (result.error || 'Failed to reset AI'));
  }
}

function handleImportSql() {
  if (!dbState.selectedDatabase) { alert('Select a database first'); return; }
  $('#import-file-input').click();
}

async function handleImportFile(file) {
  const db = dbState.selectedDatabase;
  const result = await window.electronAPI.dbImportSql(db, file.path);
  if (result.success) {
    alert('Import completed successfully.');
    $('#db-query-input').value = `SHOW TABLES FROM \`${db}\``;
    runQuery();
  } else {
    alert('Import error: ' + (result.error || 'Unknown error'));
  }
}

async function handleExportTable() {
  const db = dbState.selectedDatabase;
  const table = dbState.selectedTable;
  if (!table) return;
  const result = await window.electronAPI.dbExportTable(db, table);
  if (result.success) {
    alert(`Exported to:\n${result.filePath}`);
  } else if (result.error && result.error !== 'Export cancelled') {
    alert('Export error: ' + result.error);
  }
}

async function handleDropTable() {
  const db = dbState.selectedDatabase;
  const table = dbState.selectedTable;
  if (!table) return;

  $('#confirm-title').textContent = 'Drop Table';
  $('#confirm-message').textContent = `Are you sure you want to DROP TABLE \`${table}\`? The table and all its data will be permanently deleted.`;
  $('#confirm-ok').textContent = 'Drop Table';
  $('#confirm-ok').className = 'btn btn-danger';
  $('#confirm-ok').onclick = async () => {
    $('#confirm-modal').classList.add('hidden');
    const result = await window.electronAPI.dbDropTable(db, table);
    if (result.success) {
      dbState.selectedTable = '';
      dbState.structure = null;
      dbState.results = null;
      $('#db-table-actions').classList.add('hidden');
      await loadTables(db);
      $('#db-results-wrapper').innerHTML = '<div class="db-results-empty">Run a query to see results</div>';
      $('#db-results-info').textContent = '';
      $('#db-query-input').value = `SELECT * FROM \`${db}\` `;
    } else {
      alert('Error: ' + (result.error || 'Failed to drop table'));
    }
  };
  $('#confirm-cancel').onclick = () => $('#confirm-modal').classList.add('hidden');
  $('#confirm-modal').classList.remove('hidden');
}

async function handleCreateDatabase() {
  const name = $('#new-db-name').value.trim();
  if (!name) return;
  const result = await window.electronAPI.dbCreateDatabase(name);
  if (result.success) {
    $('#create-db-modal').classList.add('hidden');
    $('#new-db-name').value = '';
    dbState.selectedDatabase = name;
    await loadDatabases();
    $('#db-query-input').value = `SELECT * FROM \`${name}\` `;
  } else {
    alert('Error: ' + (result.error || 'Could not create database'));
  }
}

async function handleDeleteDatabase() {
  const name = dbState.selectedDatabase;
  if (!name) return;
  // Show confirm modal
  $('#confirm-title').textContent = 'Drop Database';
  $('#confirm-message').textContent = `Are you sure you want to drop "${name}"? This cannot be undone!`;
  $('#confirm-ok').textContent = 'Drop';
  $('#confirm-ok').className = 'btn btn-danger';
  $('#confirm-ok').onclick = async () => {
    $('#confirm-modal').classList.add('hidden');
    const result = await window.electronAPI.dbDeleteDatabase(name);
    if (result.success) {
      dbState.selectedDatabase = '';
      dbState.selectedTable = '';
      dbState.tables = [];
      dbState.results = null;
      await loadDatabases();
      $('#db-table-list').innerHTML = '<div class="db-empty">Select a database</div>';
      $('#db-results-wrapper').innerHTML = '<div class="db-results-empty">Run a query to see results</div>';
      $('#db-results-info').textContent = '';
    } else {
      alert('Error: ' + (result.error || 'Could not drop database'));
    }
  };
  $('#confirm-cancel').onclick = () => $('#confirm-modal').classList.add('hidden');
  $('#confirm-modal').classList.remove('hidden');
}

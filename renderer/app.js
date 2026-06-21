let state = {
  sites: [],
  selectedSite: null,
  phpVersion: null,
  sitesPath: '',
  preferences: {}
};

let currentLog = [];

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
    return `<div class="db-item">
      <div class="db-status-dot ${running ? 'running' : 'stopped'}"></div>
      <div class="db-info">
        <div class="db-name">${db.name}</div>
        <div class="db-detail">${db.version ? 'v' + db.version : ''}${db.port ? ' · Port ' + db.port : ''}</div>
        <div class="db-detail">${running ? 'Running' : 'Stopped'}</div>
      </div>
      <button class="btn btn-tiny ${running ? 'btn-danger' : 'btn-primary'} db-toggle-btn" data-db="${db.type}">
        ${running ? 'Stop' : 'Start'}
      </button>
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
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

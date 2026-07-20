(function () {
  'use strict';

  const state = {
    prereqs: null,
    pulledImages: [],
    projects: [],
    detailProject: null,
    statusPollTimer: null,
    pullTag: null,
  };

  const el = (id) => document.getElementById(id);

  // ---------- Onglets ----------

  function teardownDetailIfOpen() {
    if (!state.detailProject) return;
    window.api.closeProjectConsole(state.detailProject.id);
    if (state.statusPollTimer) {
      clearInterval(state.statusPollTimer);
      state.statusPollTimer = null;
    }
    state.detailProject = null;
  }

  function switchTab(tabName) {
    teardownDetailIfOpen();
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ---------- Prérequis (Docker Desktop / WSL2) ----------

  async function checkPrereqs() {
    el('prereq-banner').classList.remove('hidden');
    el('prereq-summary').textContent = 'Vérification des prérequis...';
    state.prereqs = await window.api.checkPrerequisites();
    renderPrereqBanner();
  }

  function renderPrereqBanner() {
    const { docker, wsl } = state.prereqs;
    const banner = el('prereq-banner');
    const ok = docker.cliFound && docker.running;

    banner.classList.toggle('status-ok', ok);
    banner.classList.toggle('status-warn', !ok);

    el('prereq-summary').textContent = ok
      ? `Docker est prêt (${docker.version || 'version inconnue'})`
      : 'Docker n\'est pas prêt — installez les prérequis pour utiliser NodeStart';

    const details = el('prereq-details');
    details.classList.toggle('hidden', ok);
    details.innerHTML = '';

    if (!wsl.installed) {
      details.appendChild(
        buildPrereqRow({
          title: 'WSL2',
          desc: 'Sous-système Windows pour Linux, requis par Docker Desktop.',
          installed: false,
          onInstall: async () => {
            const confirmed = await window.api.confirmInstall(
              'Installer WSL2 ? Une fenêtre Windows va demander une autorisation administrateur. Un redémarrage de Windows peut être nécessaire ensuite.'
            );
            if (!confirmed) return;
            await window.api.installWsl();
            alert('Installation de WSL2 lancée. Redémarrez Windows si demandé, puis cliquez sur "Revérifier".');
            checkPrereqs();
          },
        })
      );
    }

    if (!docker.cliFound) {
      details.appendChild(
        buildPrereqRow({
          title: 'Docker Desktop',
          desc: "Moteur Docker requis pour exécuter vos projets Node.js dans des conteneurs isolés.",
          installed: false,
          onInstall: async () => {
            const confirmed = await window.api.confirmInstall(
              "Installer Docker Desktop ? NodeStart va télécharger l'installeur officiel (~600 Mo) puis l'exécuter avec une autorisation administrateur."
            );
            if (!confirmed) return;
            await runDockerInstall();
          },
        })
      );
    } else if (!docker.running) {
      details.appendChild(
        buildPrereqRow({
          title: 'Docker Desktop',
          desc: "Docker est installé mais n'est pas démarré. Lancez Docker Desktop puis revérifiez.",
          installed: false,
          installLabel: 'Ouvrir Docker Desktop',
          onInstall: async () => {
            await window.api.openPath('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe');
          },
        })
      );
    } else {
      details.appendChild(
        buildPrereqRow({ title: 'Docker Desktop', desc: `Version ${docker.version}`, installed: true })
      );
    }
  }

  function buildPrereqRow({ title, desc, installed, onInstall, installLabel }) {
    const row = document.createElement('div');
    row.className = 'prereq-item';
    row.innerHTML = `
      <div class="prereq-label"><strong>${title}</strong><span>${desc}</span></div>
      ${installed ? '<span class="badge badge-ok">Installé</span>' : ''}
    `;
    if (!installed && onInstall) {
      const btn = document.createElement('button');
      btn.className = 'btn primary small';
      btn.textContent = installLabel || 'Installer';
      btn.addEventListener('click', onInstall);
      row.appendChild(btn);
    }
    return row;
  }

  async function runDockerInstall() {
    const pullModal = el('pull-modal');
    el('pull-title').textContent = 'Installation de Docker Desktop';
    el('pull-output').textContent = 'Téléchargement de l\'installeur officiel...\n';
    el('btn-close-pull').disabled = true;
    pullModal.classList.remove('hidden');

    const unsubscribe = window.api.onInstallProgress((progress) => {
      const output = el('pull-output');
      if (progress.phase === 'download') {
        output.textContent = `Téléchargement de l'installeur : ${Math.round((progress.ratio || 0) * 100)}%\n`;
      } else if (progress.phase === 'install') {
        output.textContent += "\nInstallation en cours (autorisation administrateur requise)...\n";
      } else if (progress.phase === 'done') {
        output.textContent += "\nInstallation terminée. Un redémarrage de Windows peut être nécessaire.\nLancez Docker Desktop puis cliquez sur \"Revérifier\" dans NodeStart.\n";
      }
      output.scrollTop = output.scrollHeight;
    });

    try {
      await window.api.installDocker();
    } catch (err) {
      el('pull-output').textContent += `\n[Erreur] ${err.message}\n`;
    } finally {
      unsubscribe();
      el('btn-close-pull').disabled = false;
      checkPrereqs();
    }
  }

  el('btn-prereq-refresh').addEventListener('click', checkPrereqs);
  el('prereq-summary').addEventListener('click', () => {
    const details = el('prereq-details');
    details.classList.toggle('hidden');
  });

  el('btn-close-pull').addEventListener('click', () => {
    el('pull-modal').classList.add('hidden');
  });

  // ---------- Images Docker (versions de Node.js) ----------

  async function refreshInstalledImages() {
    state.pulledImages = await window.api.listPulledImages();
    renderInstalledImages();
  }

  function renderInstalledImages() {
    const container = el('installed-list');
    container.innerHTML = '';
    if (state.pulledImages.length === 0) {
      container.innerHTML = '<p class="empty">Aucune image Node.js installée pour le moment.</p>';
      return;
    }
    state.pulledImages.forEach((tag) => {
      const row = document.createElement('div');
      row.className = 'version-row';
      row.innerHTML = `
        <span class="version-tag">node:${tag}</span>
        <button class="btn danger small">Supprimer</button>
      `;
      row.querySelector('button').addEventListener('click', async () => {
        const inUse = state.projects.filter((p) => p.nodeImage === tag);
        const confirmMsg = inUse.length
          ? `${inUse.length} projet(s) utilisent node:${tag}. La supprimer quand même ?`
          : `Supprimer l'image node:${tag} ?`;
        if (!confirm(confirmMsg)) return;
        state.pulledImages = await window.api.removeImage(tag);
        renderInstalledImages();
        renderAvailableImages(currentAvailableList);
      });
      container.appendChild(row);
    });
  }

  let currentAvailableList = [];
  let searchDebounce = null;

  async function loadAvailableImages(query) {
    const container = el('available-list');
    container.innerHTML = '<p class="empty">Chargement...</p>';
    try {
      currentAvailableList = await window.api.searchAvailableTags(query);
      renderAvailableImages(currentAvailableList);
      el('available-count').textContent = query
        ? `${currentAvailableList.length} résultat(s) pour "${query}"`
        : 'Versions courantes affichées par défaut — tapez pour chercher un tag précis';
    } catch (err) {
      container.innerHTML = `<p class="error-text">Impossible de charger la liste des versions : ${err.message}</p>`;
    }
  }

  function renderAvailableImages(list) {
    const container = el('available-list');
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<p class="empty">Aucun résultat.</p>';
      return;
    }
    list.forEach((entry) => {
      const installed = state.pulledImages.includes(entry.tag);
      const row = document.createElement('div');
      row.className = 'version-row';
      row.innerHTML = `
        <span class="version-tag">node:${entry.tag}</span>
        <button class="btn ${installed ? 'secondary' : 'primary'} small" ${installed ? 'disabled' : ''}>
          ${installed ? 'Déjà installée' : 'Installer'}
        </button>
      `;
      if (!installed) {
        row.querySelector('button').addEventListener('click', () => startPull(entry.tag));
      }
      container.appendChild(row);
    });
  }

  function startPull(tag) {
    state.pullTag = tag;
    const pullModal = el('pull-modal');
    el('pull-title').textContent = `Installation de node:${tag}`;
    el('pull-output').textContent = '';
    el('btn-close-pull').disabled = true;
    pullModal.classList.remove('hidden');

    const unsubLog = window.api.onPullLog((payload) => {
      if (payload.tag !== tag) return;
      const output = el('pull-output');
      output.textContent += payload.chunk;
      output.scrollTop = output.scrollHeight;
    });
    const unsubExit = window.api.onPullExit((payload) => {
      if (payload.tag !== tag) return;
      unsubLog();
      unsubExit();
      el('btn-close-pull').disabled = false;
    });

    window.api
      .pullImage(tag)
      .then((images) => {
        state.pulledImages = images;
        renderInstalledImages();
        renderAvailableImages(currentAvailableList);
      })
      .catch((err) => {
        el('pull-output').textContent += `\n[Erreur] ${err.message}\n`;
        el('btn-close-pull').disabled = false;
      });
  }

  el('btn-refresh-installed').addEventListener('click', refreshInstalledImages);
  el('available-search').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const query = e.target.value;
    searchDebounce = setTimeout(() => loadAvailableImages(query), 350);
  });

  // ---------- Projets ----------

  async function refreshProjects() {
    state.projects = await window.api.listProjects();
    renderProjects();
  }

  function statusBadgeParts(pkg) {
    if (!pkg.exists) return { cls: 'badge-error', label: 'package.json introuvable' };
    if (pkg.error) return { cls: 'badge-error', label: pkg.error };
    if (!pkg.hasStart) return { cls: 'badge-warning', label: 'script "start" manquant' };
    return { cls: 'badge-ok', label: 'npm run start prêt' };
  }

  function statusBadge(pkg) {
    const { cls, label } = statusBadgeParts(pkg);
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function statusPillParts(status) {
    const map = {
      running: ['status-running', 'En cours d’exécution'],
      exited: ['status-stopped', 'Arrêté'],
      created: ['status-created', 'Créé (jamais démarré)'],
      absent: ['status-absent', 'Non initialisé'],
    };
    const [cls, label] = map[status] || ['status-unknown', status || 'Statut inconnu'];
    return { cls, label };
  }

  function applyStatusPill(pillEl, status) {
    if (!pillEl) return;
    const { cls, label } = statusPillParts(status);
    pillEl.className = `status-pill ${cls}`;
    pillEl.textContent = label;
  }

  function renderProjects() {
    const container = el('project-list');
    container.innerHTML = '';
    if (state.projects.length === 0) {
      container.innerHTML = '<p class="empty">Aucun projet ajouté pour le moment.</p>';
      return;
    }

    state.projects.forEach((project) => {
      const card = document.createElement('div');
      card.className = 'project-card';
      card.innerHTML = `
        <div class="project-card-header">
          <div>
            <h3>${project.name}</h3>
            <p class="project-path" title="${project.path}">${project.path}</p>
          </div>
          ${statusBadge(project.packageJson)}
        </div>
        <div class="project-card-footer">
          <span class="version-tag">node:${project.nodeImage}</span>
          <span class="status-pill status-unknown" data-status-for="${project.id}">…</span>
        </div>
      `;
      card.addEventListener('click', () => openProjectDetail(project));
      container.appendChild(card);

      window.api.getProjectStatus(project.id).then((status) => {
        applyStatusPill(card.querySelector(`[data-status-for="${project.id}"]`), status);
      }).catch(() => {});
    });
  }

  el('btn-add-project').addEventListener('click', openAddProjectModal);

  function openAddProjectModal() {
    el('input-project-name').value = '';
    el('input-project-path').value = '';
    el('add-project-error').classList.add('hidden');
    const select = el('input-project-image');
    select.innerHTML = state.pulledImages.length
      ? state.pulledImages.map((v) => `<option value="${v}">node:${v}</option>`).join('')
      : '<option value="">Aucune image installée — installez-en une dans l’onglet Images Docker</option>';
    el('add-project-modal').classList.remove('hidden');
  }

  el('btn-cancel-add').addEventListener('click', () => {
    el('add-project-modal').classList.add('hidden');
  });

  el('btn-browse').addEventListener('click', async () => {
    const folder = await window.api.pickFolder();
    if (folder) el('input-project-path').value = folder;
  });

  el('btn-confirm-add').addEventListener('click', async () => {
    const name = el('input-project-name').value.trim();
    const projectPath = el('input-project-path').value.trim();
    const nodeImage = el('input-project-image').value;
    const errorEl = el('add-project-error');
    errorEl.classList.add('hidden');

    if (!projectPath) {
      errorEl.textContent = 'Indiquez le chemin du projet.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!nodeImage) {
      errorEl.textContent = 'Sélectionnez une image Node.js installée.';
      errorEl.classList.remove('hidden');
      return;
    }
    try {
      state.projects = await window.api.addProject({ name, projectPath, nodeImage });
      el('add-project-modal').classList.add('hidden');
      renderProjects();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  // ---------- Vue détail d'un projet ----------

  function openProjectDetail(project) {
    teardownDetailIfOpen();
    state.detailProject = project;

    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    el('tab-project-detail').classList.add('active');

    el('detail-name').textContent = project.name;
    el('detail-path').textContent = project.path;
    const { cls: badgeCls, label: badgeLabel } = statusBadgeParts(project.packageJson);
    el('detail-package-badge').className = `badge ${badgeCls}`;
    el('detail-package-badge').textContent = badgeLabel;
    el('detail-status').className = 'status-pill status-unknown';
    el('detail-status').textContent = '…';
    el('detail-console').textContent = '';

    const select = el('detail-image-select');
    let options = state.pulledImages.map((v) => `<option value="${v}" ${v === project.nodeImage ? 'selected' : ''}>node:${v}</option>`).join('');
    if (!state.pulledImages.includes(project.nodeImage)) {
      options = `<option value="${project.nodeImage}" selected disabled>node:${project.nodeImage} (introuvable — réinstallez-la)</option>${options}`;
    }
    select.innerHTML = options;

    refreshDetailStatus();
    state.statusPollTimer = setInterval(refreshDetailStatus, 2500);
    window.api.openProjectConsole(project.id);
  }

  async function refreshDetailStatus() {
    if (!state.detailProject) return;
    const status = await window.api.getProjectStatus(state.detailProject.id).catch(() => 'unknown');
    applyStatusPill(el('detail-status'), status);
  }

  el('btn-back-to-projects').addEventListener('click', () => {
    teardownDetailIfOpen();
    switchTab('projects');
    refreshProjects();
  });

  function withBusyButton(button, workingLabel, fn) {
    return async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = workingLabel;
      try {
        await fn();
      } catch (err) {
        alert(err.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
        refreshDetailStatus();
      }
    };
  }

  el('btn-detail-start').addEventListener(
    'click',
    withBusyButton(el('btn-detail-start'), 'Démarrage...', () => window.api.startProject(state.detailProject.id))
  );
  el('btn-detail-stop').addEventListener(
    'click',
    withBusyButton(el('btn-detail-stop'), 'Arrêt...', () => window.api.stopProject(state.detailProject.id))
  );
  el('btn-detail-restart').addEventListener(
    'click',
    withBusyButton(el('btn-detail-restart'), 'Redémarrage...', () => window.api.restartProject(state.detailProject.id))
  );
  el('btn-detail-sync').addEventListener(
    'click',
    withBusyButton(el('btn-detail-sync'), 'Synchronisation...', async () => {
      if (!confirm('Recréer le conteneur avec le dossier et l’image actuels ? (le conteneur en cours sera remplacé)')) return;
      await window.api.syncProject(state.detailProject.id);
    })
  );

  el('detail-image-select').addEventListener('change', async (e) => {
    await window.api.updateProjectImage(state.detailProject.id, e.target.value);
    state.detailProject.nodeImage = e.target.value;
  });

  el('btn-detail-open-folder').addEventListener('click', () => {
    window.api.openPath(state.detailProject.path);
  });

  el('btn-detail-remove').addEventListener('click', async () => {
    if (!confirm(`Retirer "${state.detailProject.name}" de NodeStart ? (le conteneur sera supprimé, les fichiers du projet resteront intacts)`)) return;
    const id = state.detailProject.id;
    teardownDetailIfOpen();
    state.projects = await window.api.removeProject(id);
    switchTab('projects');
    renderProjects();
  });

  window.api.onProjectLog((payload) => {
    if (!state.detailProject || payload.id !== state.detailProject.id) return;
    const output = el('detail-console');
    output.textContent += payload.chunk;
    output.scrollTop = output.scrollHeight;
  });

  // ---------- Initialisation ----------

  (async function init() {
    await checkPrereqs();
    await refreshInstalledImages();
    await loadAvailableImages('');
    await refreshProjects();
  })();
})();

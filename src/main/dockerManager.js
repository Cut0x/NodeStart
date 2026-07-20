'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

// ---------- Utilitaires bas niveau ----------

/** Exécute une commande et attend sa fin, en récupérant stdout/stderr (pour les commandes courtes). */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, ...options });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err.message, error: err });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout && child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr && child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr || err.message, error: err }));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Lance une commande en streaming (logs en direct) et retourne le child_process. */
function runStreaming(command, args, { onData, onExit, ...options } = {}) {
  let settled = false;
  const finish = (code) => {
    if (settled) return; // spawn() peut émettre 'error' puis 'exit' (ou l'inverse selon l'OS) : on ne conclut qu'une fois.
    settled = true;
    onExit && onExit(code);
  };

  let child;
  try {
    child = spawn(command, args, { windowsHide: true, ...options });
  } catch (err) {
    onData && onData(`\n[Erreur] ${err.message}\n`);
    finish(-1);
    return null;
  }
  child.stdout && child.stdout.on('data', (c) => onData && onData(c.toString()));
  child.stderr && child.stderr.on('data', (c) => onData && onData(c.toString()));
  child.on('error', (err) => {
    onData && onData(`\n[Erreur] ${err.message}\n`);
    finish(-1);
  });
  child.on('exit', (code) => finish(code));
  return child;
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'NodeStart' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(httpsGetJson(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} sur ${url}`));
          res.resume();
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl) => {
      https
        .get(currentUrl, { headers: { 'User-Agent': 'NodeStart' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} sur ${currentUrl}`));
            res.resume();
            return;
          }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          const fileStream = fs.createWriteStream(destPath);
          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (onProgress && total) onProgress(downloaded / total);
          });
          res.pipe(fileStream);
          fileStream.on('finish', () => fileStream.close(() => resolve()));
          fileStream.on('error', reject);
          res.on('error', reject);
        })
        .on('error', reject);
    };
    request(url);
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Élève directement l'exécutable ciblé (déclenche une invite UAC) et attend sa fin, sans
 * jamais afficher de fenêtre de console : la fenêtre visible qui restait ouverte sans retour
 * venait d'un PowerShell élevé lancé sans -WindowStyle Hidden.
 */
function runElevated(filePath, args = []) {
  const argumentList = args.length ? ` -ArgumentList ${args.map(psQuote).join(',')}` : '';
  const script =
    `$p = Start-Process -FilePath ${psQuote(filePath)}${argumentList} -Verb RunAs -WindowStyle Hidden -PassThru -Wait; ` +
    `Write-Output ("NODESTART_EXIT=" + $p.ExitCode)`;

  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).then((result) => {
    const match = /NODESTART_EXIT=(-?\d+)/.exec(result.stdout);
    return { code: match ? parseInt(match[1], 10) : result.code };
  });
}

/** Émet un signal de progression périodique pendant une opération élevée longue (aucun retour intermédiaire n'est possible sinon). */
function withHeartbeat(onProgress, phase, promise) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    onProgress && onProgress({ phase, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) });
  }, 4000);
  return promise.finally(() => clearInterval(timer));
}

// ---------- Prérequis (Docker Desktop / WSL2) ----------

async function checkDocker() {
  const version = await run('docker', ['--version']);
  if (version.code !== 0 || version.error) {
    return { cliFound: false, running: false, version: null };
  }
  const info = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  return {
    cliFound: true,
    running: info.code === 0,
    version: version.stdout.trim(),
  };
}

async function checkWsl() {
  const status = await run('wsl.exe', ['--status']);
  if (status.error) {
    return { installed: false };
  }
  const text = `${status.stdout}${status.stderr}`;
  const looksMissing = status.code !== 0 || /n'est pas install|not installed/i.test(text);
  return { installed: !looksMissing };
}

async function checkPrerequisites() {
  const [docker, wsl] = await Promise.all([checkDocker(), checkWsl()]);
  return { docker, wsl };
}

async function installWsl(onProgress) {
  onProgress && onProgress({ phase: 'install', elapsedSeconds: 0 });
  const result = await withHeartbeat(onProgress, 'install', runElevated('wsl.exe', ['--install', '--no-launch']));
  onProgress && onProgress({ phase: 'done', ratio: 1 });
  return { code: result.code };
}

async function installDockerDesktop(onProgress) {
  const installerUrl = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe';
  const installerPath = path.join(os.tmpdir(), 'NodeStart-DockerDesktopInstaller.exe');

  onProgress && onProgress({ phase: 'download', ratio: 0 });
  await downloadFile(installerUrl, installerPath, (ratio) => onProgress && onProgress({ phase: 'download', ratio }));

  onProgress && onProgress({ phase: 'install', elapsedSeconds: 0 });
  const result = await withHeartbeat(
    onProgress,
    'install',
    runElevated(installerPath, ['install', '--quiet', '--accept-license', '--backend=wsl-2'])
  );
  onProgress && onProgress({ phase: 'done', ratio: 1 });
  return { code: result.code };
}

// ---------- Images Docker (versions de Node.js) ----------

async function listPulledImages() {
  const result = await run('docker', ['images', '--filter', 'reference=node', '--format', '{{.Tag}}']);
  if (result.code !== 0) return [];
  return Array.from(
    new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((tag) => tag !== '<none>')
    )
  ).sort();
}

const CURATED_MAJORS = [26, 25, 24, 23, 22, 21, 20, 19, 18];
const CURATED_BASE_TAGS = ['latest', 'lts', 'current', 'alpine', 'slim'];

function curatedTags() {
  const tags = [...CURATED_BASE_TAGS];
  CURATED_MAJORS.forEach((major) => {
    tags.push(String(major), `${major}-alpine`, `${major}-slim`);
  });
  return tags.map((tag) => ({ tag, curated: true }));
}

async function searchAvailableTags(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    return curatedTags();
  }
  const url = `https://hub.docker.com/v2/repositories/library/node/tags?page_size=50&ordering=last_updated&name=${encodeURIComponent(
    trimmed
  )}`;
  const data = await httpsGetJson(url);
  return (data.results || []).map((entry) => ({
    tag: entry.name,
    curated: false,
    lastUpdated: entry.tag_last_pushed,
  }));
}

function pullImage(tag, callbacks) {
  return runStreaming('docker', ['pull', `node:${tag}`], callbacks);
}

async function removeImage(tag) {
  return run('docker', ['rmi', `node:${tag}`]);
}

async function imageExistsLocally(tag) {
  const result = await run('docker', ['image', 'inspect', `node:${tag}`]);
  return result.code === 0;
}

// ---------- Conteneurs (un conteneur = un projet) ----------

function containerName(project) {
  return `nodestart-${project.id}`;
}

async function containerStatus(project) {
  const name = containerName(project);
  const result = await run('docker', ['inspect', '--format', '{{.State.Status}}', name]);
  if (result.code !== 0) return 'absent';
  return result.stdout.trim() || 'absent';
}

async function removeContainer(project) {
  await run('docker', ['rm', '-f', containerName(project)]);
}

/** (Re)crée le conteneur du projet à partir de son chemin/dossier et de l'image Docker choisis. */
async function createContainer(project) {
  const name = containerName(project);
  const exists = await imageExistsLocally(project.nodeImage);
  if (!exists) {
    throw new Error(
      `L'image node:${project.nodeImage} n'est pas installée. Installez-la depuis l'onglet "Images Docker" avant de démarrer ce projet.`
    );
  }

  const result = await run('docker', [
    'create',
    '--name',
    name,
    '-v',
    `${project.path}:/app`,
    '-w',
    '/app',
    `node:${project.nodeImage}`,
    'sh',
    '-c',
    'npm install && npm run start',
  ]);
  if (result.code !== 0) {
    throw new Error(`Impossible de créer le conteneur : ${result.stderr || result.stdout}`);
  }
}

/** Recrée le conteneur avec la configuration actuelle du projet (nouveau dossier / nouvelle image). */
async function syncProject(project) {
  const previousStatus = await containerStatus(project);
  await removeContainer(project);
  await createContainer(project);
  if (previousStatus === 'running') {
    await run('docker', ['start', containerName(project)]);
  }
}

async function ensureContainer(project) {
  const status = await containerStatus(project);
  if (status === 'absent') {
    await createContainer(project);
  }
}

async function startProject(project) {
  await ensureContainer(project);
  const result = await run('docker', ['start', containerName(project)]);
  if (result.code !== 0) {
    throw new Error(`Impossible de démarrer le conteneur : ${result.stderr || result.stdout}`);
  }
}

async function stopProject(project) {
  const status = await containerStatus(project);
  if (status === 'absent') return;
  const result = await run('docker', ['stop', containerName(project)]);
  if (result.code !== 0) {
    throw new Error(`Impossible d'arrêter le conteneur : ${result.stderr || result.stdout}`);
  }
}

async function restartProject(project) {
  const status = await containerStatus(project);
  if (status === 'absent') {
    await startProject(project);
    return;
  }
  const result = await run('docker', ['restart', containerName(project)]);
  if (result.code !== 0) {
    throw new Error(`Impossible de redémarrer le conteneur : ${result.stderr || result.stdout}`);
  }
}

function tailLogs(project, callbacks) {
  return runStreaming('docker', ['logs', '-f', '--tail', '200', containerName(project)], callbacks);
}

module.exports = {
  checkPrerequisites,
  installWsl,
  installDockerDesktop,
  listPulledImages,
  searchAvailableTags,
  pullImage,
  removeImage,
  containerName,
  containerStatus,
  syncProject,
  startProject,
  stopProject,
  restartProject,
  removeContainer,
  tailLogs,
};

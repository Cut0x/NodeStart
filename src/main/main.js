'use strict';

require('dotenv').config();

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');

const dockerManager = require('./dockerManager');
const projectManager = require('./projectManager');

let mainWindow;

// Un seul processus de tail de logs actif par projet (fenêtre "console" ouverte).
const activeLogTails = new Map();

function stopLogTail(projectId) {
  const child = activeLogTails.get(projectId);
  if (child) {
    child.kill();
    activeLogTails.delete(projectId);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'logo-small.png');

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'NodeStart',
    icon: nativeImage.createFromPath(iconPath),
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  activeLogTails.forEach((child) => child.kill());
  activeLogTails.clear();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Prérequis (Docker Desktop / WSL2) ----------

ipcMain.handle('prereqs:check', () => dockerManager.checkPrerequisites());

ipcMain.handle('prereqs:installWsl', () => dockerManager.installWsl());

ipcMain.handle('prereqs:installDocker', async (event) => {
  return dockerManager.installDockerDesktop((progress) => {
    event.sender.send('prereqs:install-progress', progress);
  });
});

ipcMain.handle('prereqs:confirm', async (event, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Annuler', 'Installer'],
    defaultId: 1,
    cancelId: 0,
    title: 'Installer un composant requis',
    message,
  });
  return result.response === 1;
});

// ---------- Images Docker (versions de Node.js) ----------

ipcMain.handle('images:listPulled', () => dockerManager.listPulledImages());

ipcMain.handle('images:search', (event, query) => dockerManager.searchAvailableTags(query));

ipcMain.handle('images:pull', async (event, tag) => {
  const code = await new Promise((resolve) => {
    dockerManager.pullImage(tag, {
      onData: (chunk) => event.sender.send('images:pull-log', { tag, chunk }),
      onExit: (exitCode) => {
        event.sender.send('images:pull-exit', { tag, code: exitCode });
        resolve(exitCode);
      },
    });
  });
  if (code !== 0) {
    throw new Error(`Échec du téléchargement de l'image node:${tag} (code ${code}).`);
  }
  return dockerManager.listPulledImages();
});

ipcMain.handle('images:remove', async (event, tag) => {
  await dockerManager.removeImage(tag);
  return dockerManager.listPulledImages();
});

// ---------- Projets ----------

ipcMain.handle('projects:list', () => projectManager.listProjects());

ipcMain.handle('projects:add', async (event, payload) => {
  await projectManager.addProject(payload);
  return projectManager.listProjects();
});

ipcMain.handle('projects:remove', async (event, id) => {
  stopLogTail(id);
  const project = await projectManager.getProject(id).catch(() => null);
  if (project) await dockerManager.removeContainer(project);
  await projectManager.removeProject(id);
  return projectManager.listProjects();
});

ipcMain.handle('projects:updateImage', async (event, { id, nodeImage }) => {
  await projectManager.updateProjectImage(id, nodeImage);
  return projectManager.listProjects();
});

ipcMain.handle('projects:status', async (event, id) => {
  const project = await projectManager.getProject(id);
  return dockerManager.containerStatus(project);
});

ipcMain.handle('projects:start', async (event, id) => {
  const project = await projectManager.getProject(id);
  await dockerManager.startProject(project);
  return dockerManager.containerStatus(project);
});

ipcMain.handle('projects:stop', async (event, id) => {
  const project = await projectManager.getProject(id);
  await dockerManager.stopProject(project);
  return dockerManager.containerStatus(project);
});

ipcMain.handle('projects:restart', async (event, id) => {
  const project = await projectManager.getProject(id);
  await dockerManager.restartProject(project);
  return dockerManager.containerStatus(project);
});

ipcMain.handle('projects:sync', async (event, id) => {
  const project = await projectManager.getProject(id);
  await dockerManager.syncProject(project);
  return dockerManager.containerStatus(project);
});

ipcMain.handle('projects:openConsole', async (event, id) => {
  stopLogTail(id);
  const project = await projectManager.getProject(id);
  const child = dockerManager.tailLogs(project, {
    onData: (chunk) => event.sender.send('project:log', { id, chunk }),
    onExit: () => activeLogTails.delete(id),
  });
  if (child) activeLogTails.set(id, child);
});

ipcMain.handle('projects:closeConsole', (event, id) => {
  stopLogTail(id);
});

// ---------- Utilitaires ----------

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:openPath', (event, targetPath) => shell.openPath(targetPath));

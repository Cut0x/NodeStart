'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Prérequis
  checkPrerequisites: () => ipcRenderer.invoke('prereqs:check'),
  confirmInstall: (message) => ipcRenderer.invoke('prereqs:confirm', message),
  installWsl: () => ipcRenderer.invoke('prereqs:installWsl'),
  installDocker: () => ipcRenderer.invoke('prereqs:installDocker'),
  onInstallProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('prereqs:install-progress', listener);
    return () => ipcRenderer.removeListener('prereqs:install-progress', listener);
  },

  // Images Docker
  listPulledImages: () => ipcRenderer.invoke('images:listPulled'),
  searchAvailableTags: (query) => ipcRenderer.invoke('images:search', query),
  pullImage: (tag) => ipcRenderer.invoke('images:pull', tag),
  removeImage: (tag) => ipcRenderer.invoke('images:remove', tag),
  onPullLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('images:pull-log', listener);
    return () => ipcRenderer.removeListener('images:pull-log', listener);
  },
  onPullExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('images:pull-exit', listener);
    return () => ipcRenderer.removeListener('images:pull-exit', listener);
  },

  // Projets
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: (payload) => ipcRenderer.invoke('projects:add', payload),
  removeProject: (id) => ipcRenderer.invoke('projects:remove', id),
  updateProjectImage: (id, nodeImage) => ipcRenderer.invoke('projects:updateImage', { id, nodeImage }),
  getProjectStatus: (id) => ipcRenderer.invoke('projects:status', id),
  startProject: (id) => ipcRenderer.invoke('projects:start', id),
  stopProject: (id) => ipcRenderer.invoke('projects:stop', id),
  restartProject: (id) => ipcRenderer.invoke('projects:restart', id),
  syncProject: (id) => ipcRenderer.invoke('projects:sync', id),
  openProjectConsole: (id) => ipcRenderer.invoke('projects:openConsole', id),
  closeProjectConsole: (id) => ipcRenderer.invoke('projects:closeConsole', id),
  onProjectLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('project:log', listener);
    return () => ipcRenderer.removeListener('project:log', listener);
  },

  // Utilitaires
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
});

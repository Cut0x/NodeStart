'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { app } = require('electron');

function dbPath() {
  return process.env.PROJECTS_DB_PATH || path.join(app.getPath('userData'), 'projects.json');
}

async function readAll() {
  try {
    const raw = await fsp.readFile(dbPath(), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(projects) {
  const file = dbPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(projects, null, 2), 'utf-8');
}

/** Vérifie la présence de package.json et d'un script "start" (nécessaire pour `npm run start`). */
function checkStartScript(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { exists: false, hasStart: false, error: 'package.json introuvable' };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const hasStart = Boolean(pkg.scripts && pkg.scripts.start);
    return { exists: true, hasStart, error: null };
  } catch (err) {
    return { exists: true, hasStart: false, error: 'package.json invalide (JSON malformé)' };
  }
}

async function addProject({ name, projectPath, nodeImage }) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    throw new Error(`Le dossier "${projectPath}" n'existe pas.`);
  }
  if (!nodeImage) {
    throw new Error("Sélectionnez une image Docker Node.js installée.");
  }

  const projects = await readAll();
  if (projects.some((p) => path.resolve(p.path) === path.resolve(projectPath))) {
    throw new Error('Ce projet est déjà présent dans NodeStart.');
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const project = {
    id,
    name: (name || '').trim() || path.basename(projectPath),
    path: projectPath,
    nodeImage,
    createdAt: new Date().toISOString(),
  };
  projects.push(project);
  await writeAll(projects);
  return project;
}

async function listProjects() {
  const projects = await readAll();
  return projects.map((p) => ({ ...p, packageJson: checkStartScript(p.path) }));
}

async function removeProject(id) {
  const projects = await readAll();
  const project = projects.find((p) => p.id === id) || null;
  await writeAll(projects.filter((p) => p.id !== id));
  return project;
}

async function updateProjectImage(id, nodeImage) {
  const projects = await readAll();
  const project = projects.find((p) => p.id === id);
  if (!project) throw new Error('Projet introuvable.');
  project.nodeImage = nodeImage;
  await writeAll(projects);
  return project;
}

async function getProject(id) {
  const projects = await readAll();
  const project = projects.find((p) => p.id === id);
  if (!project) throw new Error('Projet introuvable.');
  return { ...project, packageJson: checkStartScript(project.path) };
}

module.exports = {
  addProject,
  listProjects,
  removeProject,
  updateProjectImage,
  getProject,
  checkStartScript,
};

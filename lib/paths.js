'use strict';

const os = require('os');
const path = require('path');

// The Claude desktop app's data folder. Tests point this elsewhere.
function appSupport() {
  return process.env.TTS_APP_SUPPORT || path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
}

// This tool's own folder: backups, lock file, watcher log.
function toolHome() {
  return process.env.TTS_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'tide-the-side');
}

function storeDir() {
  return path.join(appSupport(), 'Local Storage', 'leveldb');
}

function configFile() {
  return path.join(appSupport(), 'claude_desktop_config.json');
}

function sessionsDir() {
  return path.join(appSupport(), 'claude-code-sessions');
}

module.exports = { appSupport, toolHome, storeDir, configFile, sessionsDir };

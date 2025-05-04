// main.js - Hauptprozess für ChapSSH mit allen Features

const { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('ssh2');
const os = require('os');

let mainWindow;

// Passwort-Manager Schema für electron-store
const passwordManagerSchema = {
  masterPassword: {
    type: 'string'
  },
  credentials: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        username: { type: 'string' },
        password: { type: 'string' },
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        lastUsed: { type: 'number' }
      }
    }
  }
};

// Erstellen des Passwort-Manager Speichers
const passwordStore = new Store({
  name: 'chapssh-passwords',
  schema: passwordManagerSchema,
  encryptionKey: 'chapssh_secure_storage', // Wird nur als Fallback verwendet
  clearInvalidConfig: true
});

// AES-Verschlüsselungsfunktionen für Passwörter
function encryptPassword(text, masterPassword) {
  try {
    // Salt erzeugen
    const salt = crypto.randomBytes(16);
    // Schlüssel ableiten
    const key = crypto.scryptSync(masterPassword, salt, 32);
    // Initialisierungsvektor erzeugen
    const iv = crypto.randomBytes(16);
    // Cipher erstellen
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    // Verschlüsseln
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // AuthTag erhalten
    const authTag = cipher.getAuthTag();
    // Als JSON speichern
    return JSON.stringify({
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      encrypted,
      authTag: authTag.toString('hex')
    });
  } catch (error) {
    console.error('Fehler bei der Verschlüsselung:', error);
    return null;
  }
}

function decryptPassword(encryptedData, masterPassword) {
  try {
    // JSON parsen
    const data = JSON.parse(encryptedData);
    // Salt und Schlüssel
    const salt = Buffer.from(data.salt, 'hex');
    const key = crypto.scryptSync(masterPassword, salt, 32);
    // IV und AuthTag
    const iv = Buffer.from(data.iv, 'hex');
    const authTag = Buffer.from(data.authTag, 'hex');
    // Decipher erstellen
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    // Entschlüsseln
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Fehler bei der Entschlüsselung:', error);
    return null;
  }
}

// Globales Objekt für SFTP-Sitzungen
const sftpSessions = {};

// Store für alle Einstellungen und Favoriten
const store = new Store();

// Aktive SSH-Sitzungen für Server-Statistiken und SFTP
const activeSessions = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  mainWindow.loadFile('index.html');
  
  // Entwicklungswerkzeuge öffnen (auskommentiert für Produktion)
  // mainWindow.webContents.openDevTools();
  
  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Neue Verbindung',
          click: () => mainWindow.webContents.send('new-connection')
        },
        { type: 'separator' },
        {
          label: 'Einstellungen',
          click: () => mainWindow.webContents.send('open-settings')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { 
          label: 'Server-Statistiken',
          click: () => mainWindow.webContents.send('toggle-server-stats')
        },
        { 
          label: 'SFTP-Browser',
          click: () => mainWindow.webContents.send('toggle-sftp')
        },
        { type: 'separator' },
        {
          label: 'Split-View horizontal',
          click: () => mainWindow.webContents.send('activate-split-view', { direction: 'horizontal' })
        },
        {
          label: 'Split-View vertikal',
          click: () => mainWindow.webContents.send('activate-split-view', { direction: 'vertical' })
        },
        {
          label: 'Split-View beenden',
          click: () => mainWindow.webContents.send('deactivate-split-view')
        }
      ]
    },
    {
      label: 'Extras',
      submenu: [
        { 
          label: 'Passwort-Manager',
          click: () => mainWindow.webContents.send('open-password-manager')
        }
      ]
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Über ChapSSH',
          click: () => mainWindow.webContents.send('about')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Favoriten speichern und laden
ipcMain.on('save-favorite', (event, favorite) => {
  const favorites = store.get('favorites', []);
  favorites.push(favorite);
  store.set('favorites', favorites);
});

ipcMain.on('get-favorites', (event) => {
  const favorites = store.get('favorites', []);
  event.reply('favorites-loaded', favorites);
});

ipcMain.on('remove-favorite', (event, index) => {
  const favorites = store.get('favorites', []);
  favorites.splice(index, 1);
  store.set('favorites', favorites);
});

// SSH-Verbindungen
ipcMain.on('create-ssh-session', (event, connectionInfo) => {
  // SSH-Verbindung mit ssh2 erstellen
  const conn = new Client();

  conn.on('ready', () => {
    event.reply('ssh-connected', connectionInfo.host);
    
    conn.shell((err, stream) => {
      if (err) {
        event.reply('ssh-error', err.message);
        return;
      }
      
      // Stream-IDs für die Kommunikation zwischen Renderer und Main
      const streamId = Date.now().toString();
      
      // Verbindungsdaten für spätere Verwendung speichern (für Server-Statistiken und SFTP)
      activeSessions[streamId] = {
        connection: conn,
        host: connectionInfo.host,
        port: connectionInfo.port || 22,
        username: connectionInfo.username,
        password: connectionInfo.password,
        privateKey: connectionInfo.privateKey
      };
      
      stream.on('data', (data) => {
        event.reply('ssh-data', { id: streamId, data: data.toString() });
      });
      
      stream.on('close', () => {
        event.reply('ssh-closed', streamId);
        // Verbindungsdaten beim Schließen entfernen
        delete activeSessions[streamId];
      });
      
      // Befehle vom Renderer-Prozess an den SSH-Stream senden
      ipcMain.on(`ssh-command-${streamId}`, (e, command) => {
        stream.write(command);
      });
      
      event.reply('ssh-session-created', streamId);
    });
  });
  
  conn.on('error', (err) => {
    event.reply('ssh-error', err.message);
  });
  
  conn.connect({
    host: connectionInfo.host,
    port: connectionInfo.port || 22,
    username: connectionInfo.username,
    password: connectionInfo.password,
    privateKey: connectionInfo.privateKey
  });
});

// Server-Statistiken abrufen
ipcMain.on('get-server-stats', (event, { streamId }) => {
  // SSH-Befehle zur Abfrage der Systemstatistiken
  const commands = {
    cpu: "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'",
    memory: "free -m | grep 'Mem:' | awk '{print $3,$2}'",
    disk: "df -h / | awk 'NR==2 {print $3,$2,$5}'",
    network: "ifstat -i $(ip route | grep default | awk '{print $5}') 1 1 | awk 'NR==3 {print $1\" KB/s in, \"$2\" KB/s out\"}'",
    system: "uname -a",
    uptime: "uptime -p"
  };
  
  // Aktive Session abrufen
  const sessionInfo = getActiveSession(streamId);
  if (!sessionInfo) {
    event.reply('server-stats-error', 'Keine aktive SSH-Verbindung gefunden.');
    return;
  }
  
  // Ergebnisse sammeln
  const results = {};
  let pending = Object.keys(commands).length;
  const connections = {};
  
  // Für jeden einzelnen Befehl eine separate SSH-Session verwenden
  Object.entries(commands).forEach(([key, cmd]) => {
    // Neue SSH-Verbindung
    const conn = new Client();
    connections[key] = conn;
    
    conn.on('ready', () => {
      // Befehl ausführen
      conn.exec(cmd, (err, stream) => {
        if (err) {
          results[key] = 'Fehler: ' + err.message;
          checkComplete();
          return;
        }
        
        let data = '';
        
        stream.on('data', (chunk) => {
          data += chunk;
        });
        
        stream.on('end', () => {
          // Ergebnisse verarbeiten
          try {
            switch (key) {
              case 'cpu':
                results.cpu = parseFloat(data.trim()).toFixed(1);
                break;
              case 'memory':
                const memParts = data.trim().split(' ');
                if (memParts.length >= 2) {
                  const used = parseInt(memParts[0]);
                  const total = parseInt(memParts[1]);
                  const percent = ((used / total) * 100).toFixed(1);
                  results.memory = {
                    used: `${used} MB`,
                    total: `${total} MB`,
                    percent
                  };
                }
                break;
              case 'disk':
                const diskParts = data.trim().split(' ');
                if (diskParts.length >= 3) {
                  results.disk = {
                    used: diskParts[0],
                    total: diskParts[1],
                    percent: parseInt(diskParts[2].replace('%', ''))
                  };
                }
                break;
              case 'network':
                results.network = data.trim();
                break;
              case 'system':
                results.system = data.trim();
                break;
              case 'uptime':
                results.uptime = data.trim();
                break;
            }
          } catch (e) {
            results[key] = 'Fehler bei der Verarbeitung: ' + e.message;
          }
          
          checkComplete();
        });
        
        stream.stderr.on('data', (data) => {
          results[key] = 'Fehler: ' + data.toString();
          checkComplete();
        });
      });
    });
    
    conn.on('error', (err) => {
      results[key] = 'Verbindungsfehler: ' + err.message;
      checkComplete();
    });
    
    // Verbindungsdaten aus der bestehenden Verbindung wiederverwenden
    conn.connect({
      host: sessionInfo.host,
      port: sessionInfo.port || 22,
      username: sessionInfo.username,
      password: sessionInfo.password,
      privateKey: sessionInfo.privateKey
    });
  });
  
  // Prüfen, ob alle Befehle abgeschlossen sind
  function checkComplete() {
    pending--;
    if (pending === 0) {
      // Alle Befehle ausgeführt, Ergebnisse zurücksenden
      event.reply('server-stats-result', results);
      
      // Verbindungen schließen, falls noch offen
      Object.values(connections).forEach(conn => {
        if (conn && conn.end) conn.end();
      });
    }
  }
});

// Hilfsfunktion, um aktive SSH-Session-Informationen zu bekommen
function getActiveSession(streamId) {
  return activeSessions[streamId];
}

// IPC-Handler für Passwort-Manager Funktionen
ipcMain.on('init-password-manager', (event) => {
  const hasCredentials = passwordStore.has('credentials');
  const hasMasterPassword = passwordStore.has('masterPassword');
  event.reply('password-manager-status', { hasCredentials, hasMasterPassword });
});

ipcMain.on('set-master-password', (event, { password, oldPassword }) => {
  try {
    // Überprüfen, ob ein neues Master-Passwort gesetzt oder geändert wird
    if (passwordStore.has('masterPassword') && oldPassword) {
      // Altes Master-Passwort überprüfen
      const masterPasswordHash = passwordStore.get('masterPassword');
      const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
      
      if (masterPasswordHash !== oldHash) {
        event.reply('password-manager-error', 'Falsches Master-Passwort');
        return;
      }
      
      // Alle vorhandenen Passwörter neu verschlüsseln
      if (passwordStore.has('credentials')) {
        const credentials = passwordStore.get('credentials') || [];
        
        for (let cred of credentials) {
          if (cred.password) {
            // Passwort entschlüsseln
            const decrypted = decryptPassword(cred.password, oldPassword);
            if (decrypted) {
              // Mit dem neuen Master-Passwort verschlüsseln
              cred.password = encryptPassword(decrypted, password);
            }
          }
        }
        
        // Aktualisierte Anmeldedaten speichern
        passwordStore.set('credentials', credentials);
      }
    }
    
    // Neues Master-Passwort speichern (als Hash)
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    passwordStore.set('masterPassword', passwordHash);
    
    // Wenn noch keine Anmeldedaten vorhanden sind, leeres Array erstellen
    if (!passwordStore.has('credentials')) {
      passwordStore.set('credentials', []);
    }
    
    event.reply('password-manager-updated', { success: true });
  } catch (error) {
    console.error('Fehler beim Setzen des Master-Passworts:', error);
    event.reply('password-manager-error', error.message);
  }
});

ipcMain.on('check-master-password', (event, { password }) => {
  try {
    const masterPasswordHash = passwordStore.get('masterPassword');
    const inputHash = crypto.createHash('sha256').update(password).digest('hex');
    
    const isCorrect = masterPasswordHash === inputHash;
    event.reply('master-password-check', { isCorrect });
  } catch (error) {
    console.error('Fehler beim Überprüfen des Master-Passworts:', error);
    event.reply('password-manager-error', error.message);
  }
});

ipcMain.on('get-all-credentials', (event, { masterPassword }) => {
  try {
    // Master-Passwort überprüfen
    const masterPasswordHash = passwordStore.get('masterPassword');
    const inputHash = crypto.createHash('sha256').update(masterPassword).digest('hex');
    
    if (masterPasswordHash !== inputHash) {
      event.reply('password-manager-error', 'Falsches Master-Passwort');
      return;
    }
    
    // Anmeldedaten abrufen
    const encryptedCredentials = passwordStore.get('credentials') || [];
    
    // Passwörter für die Anzeige entschlüsseln (ohne tatsächliche Passwörter zu senden)
    const credentials = encryptedCredentials.map(cred => {
      const { password, ...rest } = cred;
      return {
        ...rest,
        hasPassword: !!password
      };
    });
    
    event.reply('all-credentials', { credentials });
  } catch (error) {
    console.error('Fehler beim Abrufen der Anmeldedaten:', error);
    event.reply('password-manager-error', error.message);
  }
});

ipcMain.on('get-credential', (event, { id, masterPassword }) => {
  try {
    // Master-Passwort überprüfen
    const masterPasswordHash = passwordStore.get('masterPassword');
    const inputHash = crypto.createHash('sha256').update(masterPassword).digest('hex');
    
    if (masterPasswordHash !== inputHash) {
      event.reply('password-manager-error', 'Falsches Master-Passwort');
      return;
    }
    
    // Anmeldedaten abrufen
    const credentials = passwordStore.get('credentials') || [];
    const credential = credentials.find(c => c.id === id);
    
    if (!credential) {
      event.reply('password-manager-error', 'Anmeldedaten nicht gefunden');
      return;
    }
    
    // Passwort entschlüsseln
    if (credential.password) {
      const decryptedPassword = decryptPassword(credential.password, masterPassword);
      if (!decryptedPassword) {
        event.reply('password-manager-error', 'Fehler beim Entschlüsseln des Passworts');
        return;
      }
      
      // Anmeldedaten mit entschlüsseltem Passwort zurückgeben
      event.reply('credential', {
        ...credential,
        password: decryptedPassword
      });
    } else {
      // Keine Passwortdaten vorhanden
      event.reply('credential', credential);
    }
  } catch (error) {
    console.error('Fehler beim Abrufen der Anmeldedaten:', error);
    event.reply('password-manager-error', error.message);
  }
});

ipcMain.on('save-credential', (event, { credential, masterPassword }) => {
  try {
    // Master-Passwort überprüfen
    const masterPasswordHash = passwordStore.get('masterPassword');
    const inputHash = crypto.createHash('sha256').update(masterPassword).digest('hex');
    
    if (masterPasswordHash !== inputHash) {
      event.reply('password-manager-error', 'Falsches Master-Passwort');
      return;
    }
    
    // Anmeldedaten abrufen und aktualisieren
    const credentials = passwordStore.get('credentials') || [];
    
    // Eindeutige ID generieren, falls nicht vorhanden
    if (!credential.id) {
      credential.id = crypto.randomUUID();
    }
    
    // Passwort verschlüsseln
    if (credential.password) {
      credential.password = encryptPassword(credential.password, masterPassword);
    }
    
    // Zeitstempel aktualisieren
    credential.lastUsed = Date.now();
    
    // Prüfen, ob die Anmeldedaten bereits existieren
    const existingIndex = credentials.findIndex(c => c.id === credential.id);
    
    if (existingIndex >= 0) {
      // Bestehende Anmeldedaten aktualisieren
      credentials[existingIndex] = credential;
    } else {
      // Neue Anmeldedaten hinzufügen
      credentials.push(credential);
    }
    
    // Aktualisierte Anmeldedaten speichern
    passwordStore.set('credentials', credentials);
    
    event.reply('credential-saved', { id: credential.id });
  } catch (error) {
    console.error('Fehler beim Speichern der Anmeldedaten:', error);
    event.reply('password-manager-error', error.message);
  }
});

ipcMain.on('delete-credential', (event, { id, masterPassword }) => {
  try {
    // Master-Passwort überprüfen
    const masterPasswordHash = passwordStore.get('masterPassword');
    const inputHash = crypto.createHash('sha256').update(masterPassword).digest('hex');
    
    if (masterPasswordHash !== inputHash) {
      event.reply('password-manager-error', 'Falsches Master-Passwort');
      return;
    }
    
    // Anmeldedaten abrufen und aktualisieren
    const credentials = passwordStore.get('credentials') || [];
    const updatedCredentials = credentials.filter(c => c.id !== id);
    
    // Aktualisierte Anmeldedaten speichern
    passwordStore.set('credentials', updatedCredentials);
    
    event.reply('credential-deleted', { success: true });
  } catch (error) {
    console.error('Fehler beim Löschen der Anmeldedaten:', error);
    event.reply('password-manager-error', error.message);
  }
});

ipcMain.on('search-credentials', (event, { query, masterPassword }) => {
  try {
    // Master-Passwort überprüfen
    const masterPasswordHash = passwordStore.get('masterPassword');
    const inputHash = crypto.createHash('sha256').update(masterPassword).digest('hex');
    
    if (masterPasswordHash !== inputHash) {
      event.reply('password-manager-error', 'Falsches Master-Passwort');
      return;
    }
    
    // Anmeldedaten abrufen
    const credentials = passwordStore.get('credentials') || [];
    
    // Suche nach dem Query
    const queryLower = query.toLowerCase();
    const filteredCredentials = credentials.filter(cred => {
      return (
        (cred.name && cred.name.toLowerCase().includes(queryLower)) ||
        (cred.host && cred.host.toLowerCase().includes(queryLower)) ||
        (cred.username && cred.username.toLowerCase().includes(queryLower)) ||
        (cred.tags && cred.tags.some(tag => tag.toLowerCase().includes(queryLower)))
      );
    });
    
    // Passwörter für die Anzeige ausblenden
    const results = filteredCredentials.map(cred => {
      const { password, ...rest } = cred;
      return {
        ...rest,
        hasPassword: !!password
      };
    });
    
    event.reply('search-credentials-results', { results });
  } catch (error) {
    console.error('Fehler bei der Suche nach Anmeldedaten:', error);
    event.reply('password-manager-error', error.message);
  }
});

// SFTP-Funktionen
ipcMain.on('start-sftp-session', (event, { streamId, connectionInfo }) => {
  // Neue SSH-Verbindung für SFTP erstellen (getrennt vom Terminal)
  const conn = new Client();
  
  conn.on('ready', () => {
    // SFTP-Subsystem anfordern
    conn.sftp((err, sftp) => {
      if (err) {
        event.reply('sftp-error', { streamId, error: err.message });
        return;
      }
      
      // SFTP-Sitzung speichern
      sftpSessions[streamId] = {
        sftp,
        connection: conn,
        currentPath: connectionInfo.initialPath || '/',
        lastError: null
      };
      
      // Aktuelles Verzeichnis auflisten
      sftp.readdir(sftpSessions[streamId].currentPath, (err, list) => {
        if (err) {
          sftpSessions[streamId].lastError = err.message;
          event.reply('sftp-error', { streamId, error: err.message });
          return;
        }
        
        // Verzeichnisinhalt formatieren
        const entries = list.map(item => ({
          name: item.filename,
          path: path.posix.join(sftpSessions[streamId].currentPath, item.filename),
          isDirectory: item.attrs.isDirectory(),
          isFile: item.attrs.isFile(),
          isSymlink: item.attrs.isSymbolicLink(),
          size: item.attrs.size,
          mode: item.attrs.mode,
          atime: item.attrs.atime,
          mtime: item.attrs.mtime
        }));
        
        // Erfolg an Renderer senden
        event.reply('sftp-session-started', { 
          streamId, 
          path: sftpSessions[streamId].currentPath,
          entries
        });
      });
    });
  });
  
  conn.on('error', (err) => {
    event.reply('sftp-error', { streamId, error: err.message });
  });
  
  // Verbindung herstellen
  conn.connect({
    host: connectionInfo.host,
    port: connectionInfo.port || 22,
    username: connectionInfo.username,
    password: connectionInfo.password,
    privateKey: connectionInfo.privateKey
  });
});

// Verzeichnis auflisten
ipcMain.on('sftp-list-directory', (event, { streamId, path }) => {
  const session = sftpSessions[streamId];
  if (!session) {
    event.reply('sftp-error', { streamId, error: 'Keine SFTP-Sitzung gefunden' });
    return;
  }
  
  // Verzeichnisinhalt auflisten
  session.sftp.readdir(path, (err, list) => {
    if (err) {
      session.lastError = err.message;
      event.reply('sftp-error', { streamId, error: err.message });
      return;
    }
    
    // Aktuellen Pfad aktualisieren
    session.currentPath = path;
    
    // Verzeichnisinhalt formatieren
    const entries = list.map(item => ({
      name: item.filename,
      path: path.posix.join(path, item.filename),
      isDirectory: item.attrs.isDirectory(),
      isFile: item.attrs.isFile(),
      isSymlink: item.attrs.isSymbolicLink(),
      size: item.attrs.size,
      mode: item.attrs.mode,
      atime: item.attrs.atime,
      mtime: item.attrs.mtime
    }));
    
    // Erfolg an Renderer senden
    event.reply('sftp-directory-listed', { 
      streamId, 
      path: path,
      entries
    });
  });
});

// Datei herunterladen
ipcMain.on('sftp-download-file', (event, { streamId, remotePath, localPath }) => {
  const session = sftpSessions[streamId];
  if (!session) {
    event.reply('sftp-error', { streamId, error: 'Keine SFTP-Sitzung gefunden' });
    return;
  }
  
  // Lokalen Pfad defaultmäßig zum Downloads-Ordner setzen, wenn nicht angegeben
  if (!localPath) {
    const fileName = path.posix.basename(remotePath);
    localPath = path.join(os.homedir(), 'Downloads', fileName);
  }
  
  // Datei herunterladen
  session.sftp.fastGet(remotePath, localPath, (err) => {
    if (err) {
      session.lastError = err.message;
      event.reply('sftp-error', { streamId, error: err.message });
      return;
    }
    
    // Erfolg an Renderer senden
    event.reply('sftp-file-downloaded', { 
      streamId, 
      remotePath,
      localPath
    });
  });
});

// Datei hochladen
ipcMain.on('sftp-upload-file', (event, { streamId, localPath, remotePath }) => {
  const session = sftpSessions[streamId];
  if (!session) {
    event.reply('sftp-error', { streamId, error: 'Keine SFTP-Sitzung gefunden' });
    return;
  }
  
  // Wenn kein Remote-Pfad angegeben ist, den Dateinamen im aktuellen Verzeichnis verwenden
  if (!remotePath) {
    const fileName = path.basename(localPath);
    remotePath = path.posix.join(session.currentPath, fileName);
  }
  
  // Datei hochladen
  session.sftp.fastPut(localPath, remotePath, (err) => {
    if (err) {
      session.lastError = err.message;
      event.reply('sftp-error', { streamId, error: err.message });
      return;
    }
    
    // Erfolg an Renderer senden
    event.reply('sftp-file-uploaded', { 
      streamId, 
      localPath,
      remotePath
    });
    
    // Aktuelles Verzeichnis aktualisieren
    session.sftp.readdir(session.currentPath, (err, list) => {
      if (err) return; // Fehler ignorieren
      
      // Verzeichnisinhalt formatieren
      const entries = list.map(item => ({
        name: item.filename,
        path: path.posix.join(session.currentPath, item.filename),
        isDirectory: item.attrs.isDirectory(),
        isFile: item.attrs.isFile(),
        isSymlink: item.attrs.isSymbolicLink(),
        size: item.attrs.size,
        mode: item.attrs.mode,
        atime: item.attrs.atime,
        mtime: item.attrs.mtime
      }));
      
      // Erfolg an Renderer senden
      event.reply('sftp-directory-listed', { 
        streamId, 
        path: session.currentPath,
        entries
      });
    });
  });
});

// Datei löschen
ipcMain.on('sftp-delete-file', (event, { streamId, path }) => {
  const session = sftpSessions[streamId];
  if (!session) {
    event.reply('sftp-error', { streamId, error: 'Keine SFTP-Sitzung gefunden' });
    return;
  }
  
  // Datei löschen
  session.sftp.unlink(path, (err) => {
    if (err) {
      session.lastError = err.message;
      event.reply('sftp-error', { streamId, error: err.message });
      return;
    }
    
    // Erfolg an Renderer senden
    event.reply('sftp-file-deleted', { 
      streamId, 
      path
    });
    
    // Aktuelles Verzeichnis aktualisieren
    session.sftp.readdir(session.currentPath, (err, list) => {
      if (err) return; // Fehler ignorieren
      
      // Verzeichnisinhalt formatieren
      const entries = list.map(item => ({
        name: item.filename,
        path: path.posix.join(session.currentPath, item.filename),
        isDirectory: item.attrs.isDirectory(),
        isFile: item.attrs.isFile(),
        isSymlink: item.attrs.isSymbolicLink(),
        size: item.attrs.size,
        mode: item.attrs.mode,
        atime: item.attrs.atime,
        mtime: item.attrs.mtime
      }));
      
      // Erfolg an Renderer senden
      event.reply('sftp-directory-listed', { 
        streamId, 
        path: session.currentPath,
        entries
      });
    });
  });
});

// Verzeichnis erstellen
ipcMain.on('sftp-create-directory', (event, { streamId, path }) => {
  const session = sftpSessions[streamId];
  if (!session) {
    event.reply('sftp-error', { streamId, error: 'Keine SFTP-Sitzung gefunden' });
    return;
  }
  
  // Verzeichnis erstellen
  session.sftp.mkdir(path, (err) => {
    if (err) {
      session.lastError = err.message;
      event.reply('sftp-error', { streamId, error: err.message });
      return;
    }
    
    // Erfolg an Renderer senden
    event.reply('sftp-directory-created', { 
      streamId, 
      path
    });
    
    // Aktuelles Verzeichnis aktualisieren
    session.sftp.readdir(session.currentPath, (err, list) => {
      if (err) return; // Fehler ignorieren
      
      // Verzeichnisinhalt formatieren
      const entries = list.map(item => ({
        name: item.filename,
        path: path.posix.join(session.currentPath, item.filename),
        isDirectory: item.attrs.isDirectory(),
        isFile: item.attrs.isFile(),
        isSymlink: item.attrs.isSymbolicLink(),
        size: item.attrs.size,
        mode: item.attrs.mode,
        atime: item.attrs.atime,
        mtime: item.attrs.mtime
      }));
      
      // Erfolg an Renderer senden
      event.reply('sftp-directory-listed', { 
        streamId, 
        path: session.currentPath,
        entries
      });
    });
  });
});

// Datei umbenennen
ipcMain.on('sftp-rename', (event, { streamId, oldPath, newPath }) => {
  const session = sftpSessions[streamId];
  if (!session) {
    event.reply('sftp-error', { streamId, error: 'Keine SFTP-Sitzung gefunden' });
    return;
  }
  
  // Datei umbenennen
  session.sftp.rename(oldPath, newPath, (err) => {
    if (err) {
      session.lastError = err.message;
      event.reply('sftp-error', { streamId, error: err.message });
      return;
    }
    
    // Erfolg an Renderer senden
    event.reply('sftp-renamed', { 
      streamId, 
      oldPath,
      newPath
    });
    
    // Aktuelles Verzeichnis aktualisieren
    session.sftp.readdir(session.currentPath, (err, list) => {
      if (err) return; // Fehler ignorieren
      
      // Verzeichnisinhalt formatieren
      const entries = list.map(item => ({
        name: item.filename,
        path: path.posix.join(session.currentPath, item.filename),
        isDirectory: item.attrs.isDirectory(),
        isFile: item.attrs.isFile(),
        isSymlink: item.attrs.isSymbolicLink(),
        size: item.attrs.size,
        mode: item.attrs.mode,
        atime: item.attrs.atime,
        mtime: item.attrs.mtime
      }));
      
      // Erfolg an Renderer senden
      event.reply('sftp-directory-listed', { 
        streamId, 
        path: session.currentPath,
        entries
      });
    });
  });
});

// SFTP-Sitzung beenden
ipcMain.on('sftp-close-session', (event, { streamId }) => {
  const session = sftpSessions[streamId];
  if (!session) {
    return;
  }
  
  // Verbindung schließen
  session.connection.end();
  
  // Sitzung entfernen
  delete sftpSessions[streamId];
  
  // Erfolg an Renderer senden
  event.reply('sftp-session-closed', { streamId });
});

// Datei-Dialog anzeigen
ipcMain.on('show-save-dialog', (event, { title, defaultPath }) => {
  dialog.showSaveDialog(mainWindow, {
    title: title || 'Datei speichern',
    defaultPath: defaultPath || '',
    properties: ['createDirectory']
  }).then(result => {
    event.reply('save-dialog-selected', { filePath: result.filePath });
  }).catch(err => {
    console.error('Fehler beim Anzeigen des Speichern-Dialogs:', err);
  });
});

// Vollbildmodus umschalten (für F11-Tastenkürzel)
ipcMain.on('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
// renderer.js - Vollständig aktualisiert für ChapSSH mit allen Features

const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const fs = require('fs');

// DOM-Elemente
const newConnectionBtn = document.getElementById('newConnectionBtn');
const connectionDialog = document.getElementById('connectionDialog');
const connectionForm = document.getElementById('connectionForm');
const cancelConnection = document.getElementById('cancelConnection');
const authTypeSelect = document.getElementById('authType');
const passwordGroup = document.getElementById('passwordGroup');
const keyGroup = document.getElementById('keyGroup');
const browseKey = document.getElementById('browseKey');
const favoritesList = document.getElementById('favoritesList');
const recentList = document.getElementById('recentList');
const tabsContainer = document.getElementById('tabs-container');
const terminalContainer = document.getElementById('terminal-container');
const statusBar = document.querySelector('.status-bar');

// Globale Zustandsvariablen
const terminals = {};
const fitAddons = {};
const recentConnections = [];
let activeTab = null;
let isSplitViewActive = false;
let splitDirection = null;
let sftpPanelActive = false;
let statsPanelActive = false;

// Password Manager Status
let passwordManagerInitialized = false;
let passwordManagerMasterPassword = null;

// Startup und Initialisierung
document.addEventListener('DOMContentLoaded', () => {
  // Animation für alle Elemente beim Start
  document.querySelectorAll('.sidebar > *').forEach((el, index) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, 100 + index * 100);
  });
  
  // Status-Bar initialisieren
  updateStatusBar('Bereit');
  
  // Favoriten laden
  ipcRenderer.send('get-favorites');
  
  // Passwort-Manager initialisieren
  ipcRenderer.send('init-password-manager');
  
  // Initiale Anzeige für leeres Terminal
  if (terminalContainer) {
    showWelcomeScreen();
  }
});

// Welcome Screen anzeigen
function showWelcomeScreen() {
  terminalContainer.innerHTML = `
    <div style="display: flex; height: 100%; justify-content: center; align-items: center; flex-direction: column; color: var(--gray-text); animation: fadeIn 0.5s ease;">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
      </svg>
      <p style="margin-top: 24px; font-size: 18px;">Willkommen bei ChapSSH</p>
      <p style="margin-top: 16px; font-size: 15px; max-width: 400px; text-align: center; line-height: 1.5;">
        Erstelle eine neue SSH-Verbindung, um loszulegen. Du kannst Verbindungen als Favoriten speichern für schnellen Zugriff.
      </p>
      <button id="welcomeNewConnection" class="btn primary" style="margin-top: 24px; display: inline-flex; align-items: center; gap: 8px;">
        <span>Neue Verbindung</span>
      </button>
    </div>
  `;
  
  // Event-Listener für den Button
  const welcomeBtn = document.getElementById('welcomeNewConnection');
  if (welcomeBtn) {
    welcomeBtn.addEventListener('click', () => {
      showDialog(connectionDialog);
    });
  }
}

// Benachrichtigungen anzeigen
function showNotification(message, type = 'info') {
  const notificationEl = document.createElement('div');
  notificationEl.className = `notification ${type}`;
  notificationEl.textContent = message;
  
  document.body.appendChild(notificationEl);
  
  // Animation starten
  setTimeout(() => {
    notificationEl.classList.add('show');
  }, 10);
  
  // Notification nach einer Weile ausblenden
  setTimeout(() => {
    notificationEl.classList.remove('show');
    setTimeout(() => {
      notificationEl.remove();
    }, 300);
  }, 3000);
}

// Status-Bar aktualisieren
function updateStatusBar(message) {
  if (statusBar) {
    statusBar.textContent = message;
  }
}

// Dialog mit Animation anzeigen
function showDialog(dialogEl) {
  dialogEl.style.display = 'flex';
  dialogEl.classList.add('open');
  
  // Focus auf das erste Input-Feld
  setTimeout(() => {
    const firstInput = dialogEl.querySelector('input');
    if (firstInput) {
      firstInput.focus();
    }
  }, 300);
}

// Dialog mit Animation schließen
function hideDialog(dialogEl) {
  dialogEl.classList.remove('open');
  setTimeout(() => {
    dialogEl.style.display = 'none';
  }, 300);
}

// =====================================================
// SSH-VERBINDUNGSVERWALTUNG
// =====================================================

// Verbindungsdialog anzeigen
newConnectionBtn.addEventListener('click', () => {
  showDialog(connectionDialog);
});

// Verbindungsdialog schließen
cancelConnection.addEventListener('click', () => {
  hideDialog(connectionDialog);
  connectionForm.reset();
});

// Authentifizierungstyp wechseln
authTypeSelect.addEventListener('change', () => {
  if (authTypeSelect.value === 'password') {
    passwordGroup.style.display = 'block';
    keyGroup.style.display = 'none';
  } else {
    passwordGroup.style.display = 'none';
    keyGroup.style.display = 'block';
  }
});

// Private Key durchsuchen
browseKey.addEventListener('click', () => {
  ipcRenderer.send('show-save-dialog', {
    title: 'Private Key auswählen',
    defaultPath: `${require('os').homedir()}/.ssh/id_rsa`
  });
});

ipcRenderer.on('save-dialog-selected', (event, { filePath }) => {
  if (filePath) {
    document.getElementById('keyPath').value = filePath;
  }
});

// Verbindungsformular absenden
connectionForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  // Loading-Indikator anzeigen
  const submitBtn = connectionForm.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = '<span class="loading"></span> Verbinden...';
  submitBtn.disabled = true;
  
  // Verbindungsdaten sammeln
  const connectionInfo = {
    host: document.getElementById('host').value,
    port: parseInt(document.getElementById('port').value),
    username: document.getElementById('username').value
  };
  
  if (authTypeSelect.value === 'password') {
    connectionInfo.password = document.getElementById('password').value;
  } else {
    const keyPath = document.getElementById('keyPath').value;
    try {
      connectionInfo.privateKey = fs.readFileSync(keyPath);
    } catch (err) {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
      showNotification(`Fehler beim Lesen des Private Keys: ${err.message}`, 'error');
      return;
    }
  }
  
  // Als Favorit speichern
  const saveName = document.getElementById('saveName').value;
  if (saveName) {
    const favorite = {
      ...connectionInfo,
      name: saveName
    };
    delete favorite.password; // Passwort nicht speichern
    ipcRenderer.send('save-favorite', favorite);
    
    // Bestätigung zeigen
    showNotification(`Favorit "${saveName}" gespeichert`, 'success');
    
    // Liste aktualisieren
    ipcRenderer.send('get-favorites');
  }
  
  // In Passwort-Manager speichern wenn aktiviert
  const saveToPasswordManager = document.getElementById('saveToPasswordManager').checked;
  if (saveToPasswordManager && authTypeSelect.value === 'password' && connectionInfo.password) {
    saveCredentialToPasswordManager({
      host: connectionInfo.host,
      port: connectionInfo.port,
      username: connectionInfo.username,
      password: connectionInfo.password,
      name: saveName || `${connectionInfo.username}@${connectionInfo.host}`
    });
  }
  
  // Verbindung herstellen
  connectToSSH(connectionInfo);
  
  // Dialog schließen
  hideDialog(connectionDialog);
  connectionForm.reset();
  
  // Button-Status zurücksetzen
  setTimeout(() => {
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
  }, 1000);
});

// Zu einem Favoriten verbinden
function connectToFavorite(favorite) {
  updateStatusBar(`Verbinde mit ${favorite.host}...`);
  
  // Prüfen, ob Anmeldedaten im Passwort-Manager gespeichert sind
  if (!favorite.privateKey && !favorite.password) {
    // Zuerst prüfen, ob die Anmeldedaten im Passwort-Manager sind
    if (passwordManagerInitialized && passwordManagerMasterPassword) {
      // Passwort-Manager nach Anmeldedaten durchsuchen
      ipcRenderer.send('search-credentials', {
        query: `${favorite.username}@${favorite.host}`,
        masterPassword: passwordManagerMasterPassword
      });
      
      // Einmaligen Event-Listener für die Antwort
      ipcRenderer.once('search-credentials-results', (event, { results }) => {
        if (results && results.length > 0) {
          // Anmeldedaten gefunden, jetzt Details holen
          ipcRenderer.send('get-credential', {
            id: results[0].id,
            masterPassword: passwordManagerMasterPassword
          });
          
          // Einmaligen Event-Listener für die Antwort
          ipcRenderer.once('credential', (event, credential) => {
            connectToSSH({
              ...favorite,
              password: credential.password
            });
          });
        } else {
          // Keine Anmeldedaten gefunden, nach Passwort fragen
          promptForPassword(favorite);
        }
      });
    } else {
      // Passwort-Manager nicht initialisiert, nach Passwort fragen
      promptForPassword(favorite);
    }
    return;
  }
  
  connectToSSH(favorite);
}

// Nach Passwort fragen
function promptForPassword(favorite) {
  const passwordPrompt = document.createElement('div');
  passwordPrompt.className = 'dialog';
  passwordPrompt.innerHTML = `
    <div class="dialog-content">
      <h2>Passwort eingeben</h2>
      <form id="passwordForm">
        <div class="form-group">
          <label for="promptPassword">Passwort für ${favorite.username}@${favorite.host}:</label>
          <input type="password" id="promptPassword" required>
        </div>
        <div class="form-group password-manager-option">
          <label class="checkbox-label">
            <input type="checkbox" id="savePasswordToManager" checked>
            Im Passwort-Manager speichern
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">Verbinden</button>
          <button type="button" class="btn" id="cancelPasswordPrompt">Abbrechen</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(passwordPrompt);
  
  const passwordForm = document.getElementById('passwordForm');
  const cancelPasswordPrompt = document.getElementById('cancelPasswordPrompt');
  
  // Dialog anzeigen
  showDialog(passwordPrompt);
  
  // Passwort-Formular absenden
  passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('promptPassword').value;
    const savePassword = document.getElementById('savePasswordToManager').checked;
    
    hideDialog(passwordPrompt);
    
    setTimeout(() => {
      passwordPrompt.remove();
      
      // Im Passwort-Manager speichern wenn gewünscht
      if (savePassword && passwordManagerInitialized) {
        saveCredentialToPasswordManager({
          host: favorite.host,
          port: favorite.port,
          username: favorite.username,
          password: password,
          name: favorite.name || `${favorite.username}@${favorite.host}`
        });
      }
      
      connectToSSH({
        ...favorite,
        password
      });
    }, 300);
  });
  
  // Dialog abbrechen
  cancelPasswordPrompt.addEventListener('click', () => {
    hideDialog(passwordPrompt);
    setTimeout(() => {
      passwordPrompt.remove();
      updateStatusBar('Bereit');
    }, 300);
  });
}

// SSH-Verbindung herstellen
function connectToSSH(connectionInfo) {
  updateStatusBar(`Verbinde mit ${connectionInfo.host}...`);
  
  // Verbindung herstellen
  ipcRenderer.send('create-ssh-session', connectionInfo);
  
  // Verbindung zu den letzten Verbindungen hinzufügen
  addToRecentConnections(connectionInfo);
}

// Letzte Verbindungen verwalten
function addToRecentConnections(connectionInfo) {
  // Passwort entfernen
  const connection = { ...connectionInfo };
  delete connection.password;
  delete connection.privateKey;
  
  // Bestehende Verbindung entfernen
  const index = recentConnections.findIndex(c => 
    c.host === connection.host && c.username === connection.username
  );
  
  if (index !== -1) {
    recentConnections.splice(index, 1);
  }
  
  // Neue Verbindung hinzufügen
  recentConnections.unshift(connection);
  
  // Liste auf maximal 5 Einträge begrenzen
  if (recentConnections.length > 5) {
    recentConnections.pop();
  }
  
  // Liste aktualisieren
  renderRecentConnections();
}

// =====================================================
// TERMINAL-MANAGEMENT
// =====================================================

// SSH-Sitzung erstellt
ipcRenderer.on('ssh-session-created', (event, streamId) => {
  createNewTab(streamId);
  showNotification(`Verbunden mit Terminal ${streamId.substr(-4)}`, 'success');
  updateStatusBar(`Verbunden`);
});

// Neuen Tab erstellen
function createNewTab(streamId) {
  // Terminal-Konfiguration mit optimierten Einstellungen für gleichmäßige Zeichenabstände
  const terminal = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#161b22',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selection: 'rgba(56, 139, 253, 0.4)',
      black: '#0d1117',
      red: '#f85149',
      green: '#56d364',
      yellow: '#e3b341',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ff7b72',
      brightGreen: '#3fb950',
      brightYellow: '#d29922',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc'
    },
    fontFamily: "'Consolas', monospace",
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 1,
    fontWeight: 400,
    allowTransparency: false,
    allowProposedApi: true,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    scrollback: 10000,
    fastScrollModifier: 'alt',
    fastScrollSensitivity: 5,
    screenReaderMode: false,
    rightClickSelectsWord: true,
    disableStdin: false,
    cursorStyle: 'block',
    cursorWidth: 1,
    bellStyle: 'sound',
    bellSound: null,
    convertEol: true,
    termName: 'xterm',
    wordSeparator: ' ()[]{}\',"`,;:.-',
    cols: 80,
    rows: 24,
    tabStopWidth: 8,
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 4.5,
    selectionStyle: 'line'
  });
  
  // Fit-Addon für automatische Größenanpassung
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  
  // Tab erstellen
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.setAttribute('data-id', streamId);
  
// Tab-Inhalt mit verbesserter Textdarstellung und Platz für UI-Elemente
const tabContent = document.createElement('span');
tabContent.className = 'tab-content';
tabContent.innerHTML = `<span class="status-indicator online"></span> Terminal ${streamId.substr(-4)}`;

tabEl.appendChild(tabContent);
tabEl.addEventListener('click', () => {
  activateTab(streamId);
});
  
  // SFTP-Button für Tab hinzufügen
  const sftpBtn = document.createElement('span');
  sftpBtn.className = 'tab-sftp';
  sftpBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2M12 2v20M17 7l-5-5-5 5M7 17l5 5 5-5"/></svg>';
  sftpBtn.title = "SFTP-Browser öffnen";
  sftpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSftpPanel(streamId);
  });
  
  // Server-Statistik-Button für Tab hinzufügen
  const statsBtn = document.createElement('span');
  statsBtn.className = 'tab-stats';
  statsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>';
  statsBtn.title = "Server-Statistiken anzeigen";
  statsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStatsPanel(streamId);
  });
  
  // Split-View-Button für Tab hinzufügen
  const splitBtn = document.createElement('span');
  splitBtn.className = 'split-btn';
  splitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 12h18"/></svg>';
  splitBtn.title = "Split-View aktivieren";
  splitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showSplitViewMenu(e, streamId);
  });
  
  // Tab-Close Button
  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = "Terminal schließen";
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(streamId);
  });
  
  // Buttons zum Tab hinzufügen
  tabEl.appendChild(sftpBtn);
  tabEl.appendChild(statsBtn);
  tabEl.appendChild(splitBtn);
  tabEl.appendChild(closeBtn);
  tabsContainer.appendChild(tabEl);
  
  // Tab mit Animation hinzufügen
  tabEl.style.opacity = '0';
  tabEl.style.transform = 'translateY(-10px)';
  setTimeout(() => {
    tabEl.style.opacity = '1';
    tabEl.style.transform = 'translateY(0)';
  }, 10);
  
  // Terminal und FitAddon speichern
  terminals[streamId] = terminal;
  fitAddons[streamId] = fitAddon;
  
  // Tab aktivieren
  activateTab(streamId);
  
  // Terminal-Eingabe an den SSH-Stream senden
  terminal.onData(data => {
    ipcRenderer.send(`ssh-command-${streamId}`, data);
  });
  
  // SSH-Daten im Terminal anzeigen
  ipcRenderer.on('ssh-data', (event, data) => {
    if (data.id === streamId && terminals[streamId]) {
      terminals[streamId].write(data.data);
    }
  });
  
  // SSH-Verbindung geschlossen
  ipcRenderer.on('ssh-closed', (event, id) => {
    if (id === streamId && terminals[streamId]) {
      terminals[streamId].write('\r\n\nVerbindung geschlossen.\r\n');
      
      // Status des Tabs ändern
      const tab = document.querySelector(`.tab[data-id="${id}"]`);
      if (tab) {
        const statusIndicator = tab.querySelector('.status-indicator');
        if (statusIndicator) {
          statusIndicator.classList.remove('online');
          statusIndicator.classList.add('offline');
        }
      }
      
      showNotification(`Verbindung zu Terminal ${id.substr(-4)} geschlossen`, 'warning');
    }
  });
}

// Split-View-Menü anzeigen
function showSplitViewMenu(event, streamId) {
  // Menü erstellen
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.position = 'absolute';
  menu.style.zIndex = '1000';
  menu.style.backgroundColor = 'var(--dark-bg)';
  menu.style.border = '1px solid var(--border-color)';
  menu.style.borderRadius = '4px';
  menu.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
  menu.style.padding = '4px 0';
  menu.style.minWidth = '180px';
  
  // Optionen hinzufügen
  const options = [
    { label: 'Horizontal teilen', value: 'horizontal' },
    { label: 'Vertikal teilen', value: 'vertical' },
    { label: 'Split-View beenden', value: 'none', disabled: !isSplitViewActive }
  ];
  
  options.forEach(option => {
    const item = document.createElement('div');
    item.style.padding = '8px 12px';
    item.style.cursor = option.disabled ? 'default' : 'pointer';
    item.style.color = option.disabled ? 'var(--gray-text)' : 'var(--light-text)';
    item.textContent = option.label;
    
    if (!option.disabled) {
      item.addEventListener('mouseover', () => {
        item.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      });
      
      item.addEventListener('mouseout', () => {
        item.style.backgroundColor = '';
      });
      
      item.addEventListener('click', () => {
        document.body.removeChild(menu);
        
        if (option.value === 'none') {
          deactivateSplitView(streamId);
        } else {
          activateSplitView(streamId, option.value);
        }
      });
    }
    
    menu.appendChild(item);
  });
  
  // Position berechnen
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  
  // Menü zur Seite hinzufügen
  document.body.appendChild(menu);
  
  // Klick außerhalb des Menüs schließt es
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      document.body.removeChild(menu);
      document.removeEventListener('click', closeMenu);
    }
  };
  
  // Verzögerung, um den aktuellen Klick zu ignorieren
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 10);
}

// Aktivieren der Split-View
function activateSplitView(streamId, direction) {
  if (!terminals[streamId]) return;
  
  isSplitViewActive = true;
  splitDirection = direction;
  
  // Tab markieren
  const tab = document.querySelector(`.tab[data-id="${streamId}"]`);
  if (tab) {
    tab.classList.add('split-view');
  }
  
  // Inhalte sichern
  const mainTerminal = terminals[streamId];
  
  // Container für die Split-View erstellen
  const splitContainer = document.createElement('div');
  splitContainer.className = `split-view-container ${direction}`;
  terminalContainer.innerHTML = '';
  terminalContainer.appendChild(splitContainer);
  
  // Panels erstellen
  const panel1 = document.createElement('div');
  panel1.className = 'split-panel';
  panel1.setAttribute('data-panel', '1');
  
  const panel2 = document.createElement('div');
  panel2.className = 'split-panel';
  panel2.setAttribute('data-panel', '2');
  
  // Splitter erstellen
  const splitter = document.createElement('div');
  splitter.className = `splitter ${direction}`;
  
  // Elemente zum Container hinzufügen
  splitContainer.appendChild(panel1);
  splitContainer.appendChild(splitter);
  splitContainer.appendChild(panel2);
  
  // Terminal im ersten Panel öffnen
  mainTerminal.open(panel1);
  const fitAddon = fitAddons[streamId];
  
  // Neues Terminal für Panel 2 erstellen
  const terminal2 = new Terminal({
    ...mainTerminal.options
  });
  
  const fitAddon2 = new FitAddon();
  terminal2.loadAddon(fitAddon2);
  terminal2.open(panel2);
  
  // Terminal-Spacing-Probleme beheben
  fixTerminalSpacing();
  
  // Größe anpassen
  setTimeout(() => {
    try {
      fitAddon.fit();
      fitAddon2.fit();
    } catch (e) {
      console.error('Fehler bei der Größenanpassung:', e);
    }
  });
  
  // Event-Listener für Terminal 2
  terminal2.onData(data => {
    // SSH-Befehle an denselben Stream senden
    ipcRenderer.send(`ssh-command-${streamId}`, data);
  });
}

// Split-View deaktivieren
function deactivateSplitView(streamId) {
  if (!isSplitViewActive || !terminals[streamId]) return;
  
  // Tab-Marker entfernen
  const tab = document.querySelector(`.tab[data-id="${streamId}"]`);
  if (tab) {
    tab.classList.remove('split-view');
  }
  
  // Terminal zurücksetzen
  const terminal = terminals[streamId];
  
  // Container leeren
  terminalContainer.innerHTML = '';
  
  // Terminal neu öffnen
  terminal.open(terminalContainer);
  
  // Terminal-Spacing-Probleme beheben
  fixTerminalSpacing();
  
  // Größe anpassen
  const fitAddon = fitAddons[streamId];
  if (fitAddon) {
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (e) {
        console.error('Fehler bei der Größenanpassung:', e);
      }
    }, 10);
  }
  
  isSplitViewActive = false;
  splitDirection = null;
}

// Tab aktivieren
function activateTab(streamId) {
  // Alle Tabs deaktivieren
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => tab.classList.remove('active'));
  
  // Ausgewählten Tab aktivieren
  const tab = document.querySelector(`.tab[data-id="${streamId}"]`);
  if (tab) {
    tab.classList.add('active');
    activeTab = streamId;
    
    // Ist Split-View aktiv?
    const isSplitTab = tab.classList.contains('split-view');
    
    // Container leeren
    terminalContainer.innerHTML = '';
    
    // Panels schließen
    deactivateSftpPanel();
    deactivateStatsPanel();
    
    // Terminal anzeigen
    const terminal = terminals[streamId];
    
    if (isSplitTab && splitDirection) {
      // Split-View wiederherstellen
      activateSplitView(streamId, splitDirection);
    } else {
      // Normal anzeigen
      terminal.open(terminalContainer);
      
      // Terminal-Spacing-Probleme beheben
      fixTerminalSpacing();
      
      // Größe anpassen
      const fitAddon = fitAddons[streamId];
      if (fitAddon) {
        // Kurze Verzögerung für korrekte Größenanpassung
        setTimeout(() => {
          try {
            fitAddon.fit();
          } catch (e) {
            console.error('Fehler bei der Größenanpassung:', e);
          }
        }, 10);
      }
    }
    
    terminal.focus();
    
    // Terminalgröße bei Fenstergröße anpassen
    window.addEventListener('resize', () => {
      if (activeTab === streamId) {
        const fitAddon = fitAddons[streamId];
        if (fitAddon) {
          try {
            fitAddon.fit();
          } catch (e) {
            console.error('Fehler bei der Größenanpassung:', e);
          }
        }
      }
    });
  }
}

// Tab schließen
function closeTab(streamId) {
  // Tab-Element mit Animation entfernen
  const tab = document.querySelector(`.tab[data-id="${streamId}"]`);
  if (tab) {
    tab.style.opacity = '0';
    tab.style.transform = 'translateY(-10px)';
    tab.style.maxWidth = '0';
    tab.style.overflow = 'hidden';
    
    // Nach Animation entfernen
    setTimeout(() => {
      // Terminal entfernen
      if (terminals[streamId]) {
        terminals[streamId].dispose();
        delete terminals[streamId];
        delete fitAddons[streamId];
      }
      
      tab.remove();
      
      // Wenn der aktive Tab geschlossen wurde, einen anderen aktivieren
      if (activeTab === streamId) {
        const remainingTabs = Object.keys(terminals);
        if (remainingTabs.length > 0) {
          activateTab(remainingTabs[0]);
        } else {
          activeTab = null;
          
          // Panels schließen
          deactivateSftpPanel();
          deactivateStatsPanel();
          
          // Welcome-Screen anzeigen
          showWelcomeScreen();
          updateStatusBar('Keine aktiven Verbindungen');
        }
      }
    }, 300);
  }
}

// Terminal-Spacing-Probleme beheben
function fixTerminalSpacing() {
  // Kurze Verzögerung, um sicherzustellen, dass das Terminal vollständig gerendert ist
  setTimeout(() => {
    // Alle span-Elemente mit style-Attributen finden
    const spans = document.querySelectorAll('.xterm-rows span[style*="letter-spacing"]');
    
    if (spans.length > 0) {
      console.log(`Fixing letter-spacing for ${spans.length} elements`);
      
      // Für jedes span das style-Attribut modifizieren
      spans.forEach(span => {
        // Aktuelles style-Attribut abrufen
        const style = span.getAttribute('style');
        
        // letter-spacing-Teil entfernen
        const newStyle = style.replace(/letter-spacing:[^;]+;?/g, 'letter-spacing: 0 !important;');
        
        // Neues style-Attribut setzen
        span.setAttribute('style', newStyle);
      });
    }
    
    // CSS-Regeln für das gesamte Terminal hinzufügen
    const styleId = 'terminal-spacing-fix';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .xterm-rows span[style*="letter-spacing"] {
          letter-spacing: 0 !important;
        }
        .xterm-rows span {
          font-family: Consolas, monospace !important;
          font-variant-ligatures: none !important;
          letter-spacing: 0 !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Manuelle Styling-Korrekturen nach dem Öffnen
    const xtermScreen = document.querySelector('.xterm-screen');
    if (xtermScreen) {
      xtermScreen.style.fontFeatureSettings = '"liga" 0';
      xtermScreen.style.fontVariantLigatures = 'none';
      xtermScreen.style.letterSpacing = '0';
      xtermScreen.style.wordSpacing = '0';
      xtermScreen.style.textRendering = 'optimizeSpeed';
    }
    
    // MutationObserver einrichten, um neue Elemente zu überwachen
    const observerId = 'terminal-spacing-observer';
    if (!window[observerId]) {
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === 1) { // Element-Knoten
                const spans = node.querySelectorAll ? 
                             node.querySelectorAll('span[style*="letter-spacing"]') : [];
                
                spans.forEach(span => {
                  const style = span.getAttribute('style');
                  const newStyle = style.replace(/letter-spacing:[^;]+;?/g, 'letter-spacing: 0 !important;');
                  span.setAttribute('style', newStyle);
                });
                
                // Prüfen, ob der Knoten selbst ein span mit letter-spacing ist
                if (node.tagName === 'SPAN' && 
                    node.getAttribute('style') && 
                    node.getAttribute('style').includes('letter-spacing')) {
                  const style = node.getAttribute('style');
                  const newStyle = style.replace(/letter-spacing:[^;]+;?/g, 'letter-spacing: 0 !important;');
                  node.setAttribute('style', newStyle);
                }
              }
            });
          }
        });
      });
      
      // Gesamten Terminalcontainer beobachten
      const termContainer = document.querySelector('#terminal-container');
      if (termContainer) {
        observer.observe(termContainer, { 
          childList: true, 
          subtree: true,
          attributes: true,
          attributeFilter: ['style']
        });
        console.log('Terminal observer started');
      }
      
      window[observerId] = observer;
    }
  }, 500);
}

// =====================================================
// PANELS UND ERWEITERUNGEN
// =====================================================

// SFTP-Panel aktivieren
function toggleSftpPanel(streamId) {
  if (sftpPanelActive) {
    deactivateSftpPanel();
    return;
  }
  
  // Stats-Panel deaktivieren, falls aktiv
  deactivateStatsPanel();
  
// Verbindungsinformationen aus den aktiven Verbindungen extrahieren
let connectionInfo = {};

if (recentConnections.length > 0) {
  // Neueste Verbindung verwenden
  const activeConnection = recentConnections.find(conn => 
    conn.username && conn.host && (conn.port || 22)
  ) || recentConnections[0];
  
  connectionInfo = {
    host: activeConnection.host,
    port: activeConnection.port || 22,
    username: activeConnection.username,
    initialPath: '/'
  };
} else {
  // Fallback, falls keine kürzliche Verbindung vorhanden ist
  showNotification('Keine Verbindungsdaten gefunden, bitte stellen Sie zuerst eine SSH-Verbindung her', 'error');
  deactivateSftpPanel();
  return;
}

// Bevor SFTP gestartet wird, nach Passwort fragen
const passwordPrompt = document.createElement('div');
passwordPrompt.className = 'dialog';
passwordPrompt.innerHTML = `
  <div class="dialog-content">
    <h2>SFTP-Verbindung</h2>
    <p>Bitte geben Sie das Passwort für ${connectionInfo.username}@${connectionInfo.host} ein:</p>
    <form id="sftp-password-form">
      <div class="form-group">
        <label for="sftp-password">Passwort:</label>
        <input type="password" id="sftp-password" required>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">Verbinden</button>
        <button type="button" class="btn" id="cancel-sftp-password">Abbrechen</button>
      </div>
    </form>
  </div>
`;
document.body.appendChild(passwordPrompt);

// Dialog anzeigen
showDialog(passwordPrompt);

// Formular absenden
document.getElementById('sftp-password-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const password = document.getElementById('sftp-password').value;
  
  // Dialog schließen
  hideDialog(passwordPrompt);
  setTimeout(() => {
    passwordPrompt.remove();
    
    // Verbindungsdaten mit Passwort ergänzen
    connectionInfo.password = password;
    
    // SFTP-Panel erstellen
    createSftpPanel(streamId, connectionInfo);
  }, 300);
});

// Abbrechen
document.getElementById('cancel-sftp-password').addEventListener('click', () => {
  hideDialog(passwordPrompt);
  setTimeout(() => {
    passwordPrompt.remove();
    deactivateSftpPanel();
  }, 300);
});

// Diese return-Anweisung verhindert, dass der restliche Code in toggleSftpPanel ausgeführt wird
return;  
  // SFTP-Panel erstellen
  const sftpPanel = document.createElement('div');
  sftpPanel.className = 'sftp-panel';
  sftpPanel.id = 'sftp-panel';
  document.querySelector('.main-content').appendChild(sftpPanel);
  
  // Panel-Header
  sftpPanel.innerHTML = `
    <div class="sftp-header">
      <h3>SFTP-Browser</h3>
      <div class="sftp-actions">
        <button class="sftp-button" id="close-sftp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
          Schließen
        </button>
      </div>
    </div>
    <div class="sftp-toolbar">
      <div class="sftp-path">
        <button class="sftp-button" id="parent-dir">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"></path>
          </svg>
        </button>
        <input type="text" class="sftp-path-input" id="sftp-path" value="/" readonly>
      </div>
      <div class="sftp-upload">
        <button class="sftp-button" id="upload-file">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"></path>
          </svg>
          Hochladen
        </button>
        <button class="sftp-button" id="new-folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M2 12h20"></path>
          </svg>
          Neu
        </button>
      </div>
    </div>
    <div class="sftp-content">
      <div class="loading-indicator">
        <div class="spinner"></div>
        <p>Verbinde zum Server...</p>
      </div>
    </div>
    <div class="sftp-status">Bereit</div>
  `;
  
  // Panel anzeigen
  setTimeout(() => {
    sftpPanel.classList.add('active');
    
    // Event-Listener für Panel-Aktionen
    document.getElementById('close-sftp').addEventListener('click', deactivateSftpPanel);
    
    // SFTP-Sitzung starten
    ipcRenderer.send('start-sftp-session', {
      streamId: streamId,
      connectionInfo: connectionInfo
    });
    
    sftpPanelActive = true;
  }, 10);
}

// SFTP-Panel deaktivieren
function deactivateSftpPanel() {
  const sftpPanel = document.getElementById('sftp-panel');
  if (sftpPanel) {
    sftpPanel.classList.remove('active');
    
    // Panel nach Animation entfernen
    setTimeout(() => {
      sftpPanel.remove();
      sftpPanelActive = false;
    }, 300);
  }
}

// SFTP-Panel erstellen und Verbindung herstellen
function createSftpPanel(streamId, connectionInfo) {
  // SFTP-Panel erstellen
  const sftpPanel = document.createElement('div');
  sftpPanel.className = 'sftp-panel';
  sftpPanel.id = 'sftp-panel';
  document.querySelector('.main-content').appendChild(sftpPanel);
  
  // Panel-Header
  sftpPanel.innerHTML = `
    <div class="sftp-header">
      <h3>SFTP-Browser</h3>
      <div class="sftp-actions">
        <button class="sftp-button" id="close-sftp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
          Schließen
        </button>
      </div>
    </div>
    <div class="sftp-toolbar">
      <div class="sftp-path">
        <button class="sftp-button" id="parent-dir">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"></path>
          </svg>
        </button>
        <input type="text" class="sftp-path-input" id="sftp-path" value="/" readonly>
      </div>
      <div class="sftp-upload">
        <button class="sftp-button" id="upload-file">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"></path>
          </svg>
          Hochladen
        </button>
        <button class="sftp-button" id="new-folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M2 12h20"></path>
          </svg>
          Neu
        </button>
      </div>
    </div>
    <div class="sftp-content">
      <div class="loading-indicator">
        <div class="spinner"></div>
        <p>Verbinde zum Server...</p>
      </div>
    </div>
    <div class="sftp-status">Bereit</div>
  `;
  
  // Panel anzeigen
  setTimeout(() => {
    sftpPanel.classList.add('active');
    
    // Event-Listener für Panel-Aktionen
    document.getElementById('close-sftp').addEventListener('click', deactivateSftpPanel);
    
    // SFTP-Sitzung starten
    ipcRenderer.send('start-sftp-session', {
      streamId: streamId,
      connectionInfo: connectionInfo
    });
    
    sftpPanelActive = true;
  }, 10);
}

// Server-Statistik-Panel aktivieren
function toggleStatsPanel(streamId) {
  if (statsPanelActive) {
    deactivateStatsPanel();
    return;
  }
  
  // SFTP-Panel deaktivieren, falls aktiv
  deactivateSftpPanel();
  
  // Statistik-Panel erstellen
  const statsPanel = document.createElement('div');
  statsPanel.className = 'stats-panel';
  statsPanel.id = 'stats-panel';
  document.querySelector('.main-content').appendChild(statsPanel);
  
  // Panel-Header
  statsPanel.innerHTML = `
    <div class="stats-header">
      <h3>Server-Statistiken</h3>
      <div class="stats-actions">
        <button class="stats-button" id="refresh-stats" title="Aktualisieren">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 9M1 15l4.64 4.36A9 9 0 0020.49 15"></path>
          </svg>
        </button>
        <button class="stats-button" id="close-stats" title="Schließen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
    </div>
    <div class="stats-body">
      <div class="stats-grid">
        <div class="stats-item">
          <div class="stats-label">CPU-Auslastung</div>
          <div class="stats-value" id="cpu-usage">--</div>
          <div class="stats-bar">
            <div class="stats-bar-fill" id="cpu-bar" style="width: 0%;"></div>
          </div>
        </div>
        <div class="stats-item">
          <div class="stats-label">Arbeitsspeicher</div>
          <div class="stats-value" id="memory-usage">--</div>
          <div class="stats-bar">
            <div class="stats-bar-fill" id="memory-bar" style="width: 0%;"></div>
          </div>
        </div>
        <div class="stats-item">
          <div class="stats-label">Datenträgerbelegung</div>
          <div class="stats-value" id="disk-usage">--</div>
          <div class="stats-bar">
            <div class="stats-bar-fill" id="disk-bar" style="width: 0%;"></div>
          </div>
        </div>
        <div class="stats-item">
          <div class="stats-label">Netzwerk</div>
          <div class="stats-value" id="network-usage">--</div>
          <div class="stats-bar">
            <div class="stats-bar-fill" id="network-bar" style="width: 0%;"></div>
          </div>
        </div>
        <div class="stats-item full-width">
          <div class="stats-label">System</div>
          <div class="stats-value" id="system-info">--</div>
        </div>
        <div class="stats-item full-width">
          <div class="stats-label">Uptime</div>
          <div class="stats-value" id="uptime">--</div>
        </div>
      </div>
      <button class="btn" id="show-full-stats" style="margin-top: 20px; width: 100%;">Detaillierte Statistiken anzeigen</button>
    </div>
  `;
  
  // Panel anzeigen
  setTimeout(() => {
    statsPanel.classList.add('active');
    
    // Event-Listener für Panel-Aktionen
    document.getElementById('close-stats').addEventListener('click', deactivateStatsPanel);
    document.getElementById('refresh-stats').addEventListener('click', refreshStats);
    document.getElementById('show-full-stats').addEventListener('click', showDetailedStats);
    
    // Statistiken laden (Beispiel)
    loadServerStats();
    
    statsPanelActive = true;
  }, 10);
}

// Stats-Panel deaktivieren
function deactivateStatsPanel() {
  const statsPanel = document.getElementById('stats-panel');
  if (statsPanel) {
    statsPanel.classList.remove('active');
    
    // Panel nach Animation entfernen
    setTimeout(() => {
      statsPanel.remove();
      statsPanelActive = false;
    }, 300);
  }
}

// Echte Server-Statistiken vom Server abrufen
function loadServerStats() {
  // Status der UI aktualisieren
  document.getElementById('cpu-usage').textContent = 'Wird geladen...';
  document.getElementById('memory-usage').textContent = 'Wird geladen...';
  document.getElementById('disk-usage').textContent = 'Wird geladen...';
  document.getElementById('network-usage').textContent = 'Wird geladen...';
  document.getElementById('system-info').textContent = 'Wird geladen...';
  document.getElementById('uptime').textContent = 'Wird geladen...';
  
  // Alle Fortschrittsbalken zurücksetzen
  document.getElementById('cpu-bar').style.width = '0%';
  document.getElementById('memory-bar').style.width = '0%';
  document.getElementById('disk-bar').style.width = '0%'; 
  document.getElementById('network-bar').style.width = '0%';
  
  // Server-Statistiken anfordern
  if (activeTab) {
    ipcRenderer.send('get-server-stats', { streamId: activeTab });
  }
}

// Statistiken aktualisieren
function refreshStats() {
  // Animation für den Button
  const refreshBtn = document.getElementById('refresh-stats');
  refreshBtn.style.transform = 'rotate(360deg)';
  setTimeout(() => {
    refreshBtn.style.transform = '';
  }, 800);
  
  // Stats zurücksetzen
  document.getElementById('cpu-usage').textContent = '--';
  document.getElementById('cpu-bar').style.width = '0%';
  document.getElementById('memory-usage').textContent = '--';
  document.getElementById('memory-bar').style.width = '0%';
  document.getElementById('disk-usage').textContent = '--';
  document.getElementById('disk-bar').style.width = '0%';
  document.getElementById('network-usage').textContent = '--';
  document.getElementById('network-bar').style.width = '0%';
  document.getElementById('system-info').textContent = '--';
  document.getElementById('uptime').textContent = '--';
  
  // Neue Daten laden
  loadServerStats();
}

// Detaillierte Statistiken anzeigen
function showDetailedStats() {
  // Dialog für detaillierte Statistiken
  const chartDialog = document.createElement('div');
  chartDialog.className = 'dialog chart-dialog';
  chartDialog.innerHTML = `
    <div class="dialog-content">
      <h2>Detaillierte Statistiken</h2>
      <div class="chart-content">
        <div class="chart-tabs">
          <button class="chart-tab active" data-target="cpu-chart">CPU</button>
          <button class="chart-tab" data-target="memory-chart">Speicher</button>
          <button class="chart-tab" data-target="disk-chart">Festplatte</button>
          <button class="chart-tab" data-target="network-chart">Netzwerk</button>
          <button class="chart-tab" data-target="process-list">Prozesse</button>
        </div>
        <div class="chart-container" id="chart-area">
          <p style="text-align: center; margin-top: 40px; color: var(--gray-text);">
            Diagramme werden in einer zukünftigen Version verfügbar sein.
          </p>
        </div>
        <div class="form-actions">
          <button class="btn primary" id="close-chart-dialog">Schließen</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(chartDialog);
  
  // Dialog anzeigen
  showDialog(chartDialog);
  
  // Tabs-Funktionalität
  const tabs = chartDialog.querySelectorAll('.chart-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Aktiven Tab markieren
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Hier würde die entsprechende Grafik geladen werden
    });
  });
  
  // Schließen-Button
  document.getElementById('close-chart-dialog').addEventListener('click', () => {
    hideDialog(chartDialog);
    setTimeout(() => {
      chartDialog.remove();
    }, 300);
  });
}

// =====================================================
// FAVORITEN UND LETZTE VERBINDUNGEN
// =====================================================

// Favoriten anzeigen
function renderFavorites(favorites) {
  favoritesList.innerHTML = '';
  
  if (favorites.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Keine Favoriten';
    li.style.color = 'var(--gray-text)';
    li.style.padding = '10px 12px';
    favoritesList.appendChild(li);
    return;
  }
  
  favorites.forEach((favorite, index) => {
    const li = document.createElement('li');
    
    const connectLink = document.createElement('a');
    connectLink.textContent = favorite.name || `${favorite.username}@${favorite.host}`;
    connectLink.href = '#';
    connectLink.className = 'favorite-link';
    connectLink.addEventListener('click', () => {
      connectToFavorite(favorite);
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '&times;';
    deleteBtn.className = 'delete-btn';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Animation beim Löschen
      li.style.overflow = 'hidden';
      li.style.transition = 'all 0.3s ease';
      li.style.height = li.offsetHeight + 'px';
      
      setTimeout(() => {
        li.style.height = '0';
        li.style.opacity = '0';
        li.style.marginBottom = '0';
        
        setTimeout(() => {
          ipcRenderer.send('remove-favorite', index);
          ipcRenderer.send('get-favorites');
        }, 300);
      }, 10);
    });
    
    li.appendChild(connectLink);
    li.appendChild(deleteBtn);
    favoritesList.appendChild(li);
    
    // Fade-In-Animation
    li.style.opacity = '0';
    li.style.transform = 'translateX(10px)';
    setTimeout(() => {
      li.style.opacity = '1';
      li.style.transform = 'translateX(0)';
    }, index * 50);
  });
}

// Letzte Verbindungen anzeigen
function renderRecentConnections() {
  recentList.innerHTML = '';
  
  if (recentConnections.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Keine letzten Verbindungen';
    li.style.color = 'var(--gray-text)';
    li.style.padding = '10px 12px';
    recentList.appendChild(li);
    return;
  }
  
  recentConnections.forEach((connection, index) => {
    const li = document.createElement('li');
    
    const connectLink = document.createElement('a');
    connectLink.textContent = `${connection.username}@${connection.host}`;
    connectLink.href = '#';
    connectLink.className = 'favorite-link';
    connectLink.style.fontFamily = "'Consolas', monospace";
    connectLink.addEventListener('click', () => {
      // Animation beim Klick
      connectLink.style.transition = 'all 0.2s ease';
      connectLink.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      setTimeout(() => {
        connectLink.style.backgroundColor = '';
      }, 200);
      
      connectToFavorite({
        ...connection,
        name: `${connection.username}@${connection.host}`
      });
    });
    
    li.appendChild(connectLink);
    recentList.appendChild(li);
    
    // Fade-In-Animation
    li.style.opacity = '0';
    li.style.transform = 'translateX(10px)';
    setTimeout(() => {
      li.style.opacity = '1';
      li.style.transform = 'translateX(0)';
    }, index * 50);
  });
}

// =====================================================
// PASSWORT-MANAGER
// =====================================================

// Passwort-Manager Status erhalten
ipcRenderer.on('password-manager-status', (event, { hasCredentials, hasMasterPassword }) => {
  passwordManagerInitialized = hasMasterPassword;
  
  if (!hasMasterPassword) {
    console.log('Passwort-Manager nicht initialisiert');
  }
});

// Anmeldedaten im Passwort-Manager speichern
function saveCredentialToPasswordManager(credential) {
  if (!passwordManagerInitialized) {
    // Passwort-Manager initialisieren
    promptForMasterPassword();
    return;
  }
  
  // Prüfen, ob Master-Passwort vorhanden ist
  if (!passwordManagerMasterPassword) {
    // Nach Master-Passwort fragen
    const masterPasswordPrompt = document.createElement('div');
    masterPasswordPrompt.className = 'dialog';
    masterPasswordPrompt.innerHTML = `
      <div class="dialog-content">
        <h2>Master-Passwort eingeben</h2>
        <p style="margin-bottom: 16px; color: var(--gray-text);">
          Bitte gib dein Master-Passwort ein, um auf den Passwort-Manager zuzugreifen.
        </p>
        <form id="masterPasswordForm">
          <div class="form-group">
            <label for="masterPassword">Master-Passwort:</label>
            <input type="password" id="masterPassword" required>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn primary">Bestätigen</button>
            <button type="button" class="btn" id="cancelMasterPassword">Abbrechen</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(masterPasswordPrompt);
    
    // Dialog anzeigen
    showDialog(masterPasswordPrompt);
    
    // Formular absenden
    document.getElementById('masterPasswordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const password = document.getElementById('masterPassword').value;
      
      // Master-Passwort prüfen
      ipcRenderer.send('check-master-password', { password });
      
      // Antwort abwarten
      ipcRenderer.once('master-password-check', (event, { isCorrect }) => {
        if (isCorrect) {
          hideDialog(masterPasswordPrompt);
          setTimeout(() => {
            masterPasswordPrompt.remove();
            
            // Master-Passwort speichern
            passwordManagerMasterPassword = password;
            
            // Anmeldedaten speichern
            saveCredentialToPasswordManager(credential);
          }, 300);
        } else {
          // Fehlermeldung anzeigen
          const errorMsg = document.createElement('p');
          errorMsg.style.color = 'var(--error)';
          errorMsg.style.fontSize = '14px';
          errorMsg.style.marginTop = '8px';
          errorMsg.textContent = 'Falsches Master-Passwort';
          
          const formGroup = document.querySelector('#masterPasswordForm .form-group');
          formGroup.appendChild(errorMsg);
          
          // Input-Feld markieren
          const input = document.getElementById('masterPassword');
          input.style.borderColor = 'var(--error)';
          input.focus();
        }
      });
    });
    
    // Abbrechen
    document.getElementById('cancelMasterPassword').addEventListener('click', () => {
      hideDialog(masterPasswordPrompt);
      setTimeout(() => {
        masterPasswordPrompt.remove();
      }, 300);
    });
    
    return;
  }
  
  // Anmeldedaten speichern
  ipcRenderer.send('save-credential', {
    credential: {
      ...credential,
      lastUsed: Date.now()
    },
    masterPassword: passwordManagerMasterPassword
  });
  
  // Bestätigung anzeigen
  showNotification('Anmeldedaten im Passwort-Manager gespeichert', 'success');
}

// Master-Passwort festlegen
function promptForMasterPassword() {
  const setupDialog = document.createElement('div');
  setupDialog.className = 'dialog';
  setupDialog.innerHTML = `
    <div class="dialog-content">
     <h2>Passwort-Manager einrichten</h2>
      <p style="margin-bottom: 16px; color: var(--gray-text);">
        Du musst ein Master-Passwort festlegen, um den Passwort-Manager zu verwenden.
        Dieses Passwort schützt alle deine gespeicherten Anmeldedaten.
      </p>
      <form id="setupMasterPasswordForm">
        <div class="form-group">
          <label for="newMasterPassword">Master-Passwort:</label>
          <input type="password" id="newMasterPassword" required>
        </div>
        <div class="form-group">
          <label for="confirmMasterPassword">Master-Passwort wiederholen:</label>
          <input type="password" id="confirmMasterPassword" required>
        </div>
        <div class="password-strength-meter">
          <div class="strength-bar" id="password-strength-bar"></div>
        </div>
        <p class="password-hint" id="password-strength-text">Passwort-Stärke: Nicht bewertet</p>
        <div class="form-actions">
          <button type="submit" class="btn primary">Einrichten</button>
          <button type="button" class="btn" id="cancelSetupMasterPassword">Abbrechen</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(setupDialog);
  
  // Dialog anzeigen
  showDialog(setupDialog);
  
  // Passwort-Stärke bewerten
  const newPasswordInput = document.getElementById('newMasterPassword');
  const strengthBar = document.getElementById('password-strength-bar');
  const strengthText = document.getElementById('password-strength-text');
  
  newPasswordInput.addEventListener('input', () => {
    const password = newPasswordInput.value;
    const strength = evaluatePasswordStrength(password);
    
    strengthBar.style.width = `${strength.score * 25}%`;
    strengthBar.style.backgroundColor = strength.color;
    strengthText.textContent = `Passwort-Stärke: ${strength.text}`;
  });
  
  // Formular absenden
  document.getElementById('setupMasterPasswordForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('newMasterPassword').value;
    const confirmPassword = document.getElementById('confirmMasterPassword').value;
    
    // Passwörter prüfen
    if (password !== confirmPassword) {
      // Fehlermeldung anzeigen
      const errorMsg = document.createElement('p');
      errorMsg.style.color = 'var(--error)';
      errorMsg.style.fontSize = '14px';
      errorMsg.style.marginTop = '8px';
      errorMsg.textContent = 'Die Passwörter stimmen nicht überein';
      
      const formGroup = document.querySelector('#setupMasterPasswordForm .form-group:nth-child(2)');
      
      // Vorhandene Fehlermeldung entfernen
      const existingError = formGroup.querySelector('p');
      if (existingError) {
        formGroup.removeChild(existingError);
      }
      
      formGroup.appendChild(errorMsg);
      
      // Input-Feld markieren
      const input = document.getElementById('confirmMasterPassword');
      input.style.borderColor = 'var(--error)';
      input.focus();
      return;
    }
    
    // Passwort-Stärke prüfen
    const strength = evaluatePasswordStrength(password);
    if (strength.score < 2) {
      // Fehlermeldung anzeigen
      const errorMsg = document.createElement('p');
      errorMsg.style.color = 'var(--warning)';
      errorMsg.style.fontSize = '14px';
      errorMsg.style.marginTop = '8px';
      errorMsg.textContent = 'Das Passwort ist zu schwach. Bitte wähle ein stärkeres Passwort.';
      
      const formGroup = document.querySelector('#setupMasterPasswordForm .form-group:nth-child(1)');
      
      // Vorhandene Fehlermeldung entfernen
      const existingError = formGroup.querySelector('p');
      if (existingError) {
        formGroup.removeChild(existingError);
      }
      
      formGroup.appendChild(errorMsg);
      
      // Input-Feld markieren
      const input = document.getElementById('newMasterPassword');
      input.style.borderColor = 'var(--warning)';
      input.focus();
      return;
    }
    
    // Master-Passwort setzen
    ipcRenderer.send('set-master-password', { password });
    
    // Antwort abwarten
    ipcRenderer.once('password-manager-updated', (event, { success }) => {
      if (success) {
        hideDialog(setupDialog);
        setTimeout(() => {
          setupDialog.remove();
          
          // Master-Passwort speichern
          passwordManagerInitialized = true;
          passwordManagerMasterPassword = password;
          
          showNotification('Passwort-Manager erfolgreich eingerichtet', 'success');
        }, 300);
      }
    });
  });
  
  // Abbrechen
  document.getElementById('cancelSetupMasterPassword').addEventListener('click', () => {
    hideDialog(setupDialog);
    setTimeout(() => {
      setupDialog.remove();
    }, 300);
  });
}

// Passwort-Stärke bewerten
function evaluatePasswordStrength(password) {
  // Einfache Bewertung, in einer vollen Implementierung sollte eine
  // bessere Heuristik verwendet werden
  const length = password.length;
  const hasLowerCase = /[a-z]/.test(password);
  const hasUpperCase = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecialChar = /[^a-zA-Z0-9]/.test(password);
  
  let score = 0;
  
  if (length >= 8) score++;
  if (length >= 12) score++;
  if (hasLowerCase && hasUpperCase) score++;
  if (hasDigit) score++;
  if (hasSpecialChar) score++;
  
  const colors = [
    'var(--error)',           // 0: Sehr schwach
    'var(--error)',           // 1: Schwach
    'var(--warning)',         // 2: Mittel
    'var(--success)',         // 3: Stark
    'var(--success)'          // 4: Sehr stark
  ];
  
  const texts = [
    'Sehr schwach',
    'Schwach',
    'Mittel',
    'Stark',
    'Sehr stark'
  ];
  
  return {
    score,
    color: colors[score],
    text: texts[score]
  };
}

// Passwort-Manager öffnen
ipcRenderer.on('open-password-manager', () => {
  if (!passwordManagerInitialized) {
    // Passwort-Manager initialisieren
    promptForMasterPassword();
    return;
  }
  
  // Prüfen, ob Master-Passwort vorhanden ist
  if (!passwordManagerMasterPassword) {
    // Nach Master-Passwort fragen
    const masterPasswordPrompt = document.createElement('div');
    masterPasswordPrompt.className = 'dialog';
    masterPasswordPrompt.innerHTML = `
      <div class="dialog-content">
        <h2>Master-Passwort eingeben</h2>
        <p style="margin-bottom: 16px; color: var(--gray-text);">
          Bitte gib dein Master-Passwort ein, um auf den Passwort-Manager zuzugreifen.
        </p>
        <form id="masterPasswordForm">
          <div class="form-group">
            <label for="masterPassword">Master-Passwort:</label>
            <input type="password" id="masterPassword" required>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn primary">Bestätigen</button>
            <button type="button" class="btn" id="cancelMasterPassword">Abbrechen</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(masterPasswordPrompt);
    
    // Dialog anzeigen
    showDialog(masterPasswordPrompt);
    
    // Formular absenden
    document.getElementById('masterPasswordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const password = document.getElementById('masterPassword').value;
      
      // Master-Passwort prüfen
      ipcRenderer.send('check-master-password', { password });
      
      // Antwort abwarten
      ipcRenderer.once('master-password-check', (event, { isCorrect }) => {
        if (isCorrect) {
          hideDialog(masterPasswordPrompt);
          setTimeout(() => {
            masterPasswordPrompt.remove();
            
            // Master-Passwort speichern
            passwordManagerMasterPassword = password;
            
            // Passwort-Manager öffnen
            openPasswordManager();
          }, 300);
        } else {
          // Fehlermeldung anzeigen
          const errorMsg = document.createElement('p');
          errorMsg.style.color = 'var(--error)';
          errorMsg.style.fontSize = '14px';
          errorMsg.style.marginTop = '8px';
          errorMsg.textContent = 'Falsches Master-Passwort';
          
          const formGroup = document.querySelector('#masterPasswordForm .form-group');
          
          // Vorhandene Fehlermeldung entfernen
          const existingError = formGroup.querySelector('p');
          if (existingError) {
            formGroup.removeChild(existingError);
          }
          
          formGroup.appendChild(errorMsg);
          
          // Input-Feld markieren
          const input = document.getElementById('masterPassword');
          input.style.borderColor = 'var(--error)';
          input.focus();
        }
      });
    });
    
    // Abbrechen
    document.getElementById('cancelMasterPassword').addEventListener('click', () => {
      hideDialog(masterPasswordPrompt);
      setTimeout(() => {
        masterPasswordPrompt.remove();
      }, 300);
    });
    
    return;
  }
  
  // Passwort-Manager öffnen
  openPasswordManager();
});

// Passwort-Manager Dialog öffnen
function openPasswordManager() {
  // Anmeldedaten abrufen
  ipcRenderer.send('get-all-credentials', {
    masterPassword: passwordManagerMasterPassword
  });
  
  // Antwort abwarten
  ipcRenderer.once('all-credentials', (event, { credentials }) => {
    // Passwort-Manager-Dialog erstellen
    const passwordManagerDialog = document.createElement('div');
    passwordManagerDialog.className = 'dialog password-manager-dialog';
    passwordManagerDialog.innerHTML = `
      <div class="dialog-content wide-dialog">
        <h2>Passwort-Manager</h2>
        <div class="password-manager-toolbar">
          <div class="search-bar">
            <input type="text" id="search-credentials" placeholder="Anmeldedaten suchen...">
          </div>
          <button class="btn primary" id="add-credential">Neu</button>
        </div>
        <div class="password-manager-content">
          <div class="credentials-list">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Host</th>
                  <th>Benutzername</th>
                  <th>Zuletzt verwendet</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody id="credentials-table-body">
                ${renderCredentialsTable(credentials)}
              </tbody>
            </table>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn primary" id="close-password-manager">Schließen</button>
        </div>
      </div>
    `;
    document.body.appendChild(passwordManagerDialog);
    
    // Dialog anzeigen
    showDialog(passwordManagerDialog);
    
    // Event-Listener für Dialog-Aktionen
    document.getElementById('close-password-manager').addEventListener('click', () => {
      hideDialog(passwordManagerDialog);
      setTimeout(() => {
        passwordManagerDialog.remove();
      }, 300);
    });
    
    // Neue Anmeldedaten hinzufügen
    document.getElementById('add-credential').addEventListener('click', () => {
      editCredential();
    });
    
    // Anmeldedaten suchen
    const searchInput = document.getElementById('search-credentials');
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      
      if (query.length === 0) {
        // Alle Anmeldedaten anzeigen
        ipcRenderer.send('get-all-credentials', {
          masterPassword: passwordManagerMasterPassword
        });
        
        ipcRenderer.once('all-credentials', (event, { credentials }) => {
          document.getElementById('credentials-table-body').innerHTML = renderCredentialsTable(credentials);
          setupCredentialActions();
        });
      } else {
        // Anmeldedaten suchen
        ipcRenderer.send('search-credentials', {
          query,
          masterPassword: passwordManagerMasterPassword
        });
        
        ipcRenderer.once('search-credentials-results', (event, { results }) => {
          document.getElementById('credentials-table-body').innerHTML = renderCredentialsTable(results);
          setupCredentialActions();
        });
      }
    });
    
    // Aktionen für Anmeldedaten einrichten
    setupCredentialActions();
  });
}

// Anmeldedaten-Tabelle rendern
function renderCredentialsTable(credentials) {
  if (!credentials || credentials.length === 0) {
    return `
      <tr>
        <td colspan="5" class="empty-message">Keine Anmeldedaten vorhanden</td>
      </tr>
    `;
  }
  
  return credentials.map(cred => `
    <tr data-id="${cred.id}">
      <td>${cred.name || '-'}</td>
      <td>${cred.host}:${cred.port || 22}</td>
      <td>${cred.username}</td>
      <td>${cred.lastUsed ? formatDate(cred.lastUsed) : '-'}</td>
      <td class="file-actions">
        <button class="action-btn use-btn" title="Verwenden">
          <span class="icon">▶</span>
        </button>
        <button class="action-btn edit-btn" title="Bearbeiten">
          <span class="icon">✎</span>
        </button>
        <button class="action-btn delete-btn" title="Löschen">
          <span class="icon">✕</span>
        </button>
      </td>
    </tr>
  `).join('');
}

// Formatieren eines Datums
function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Aktionen für Anmeldedaten einrichten
function setupCredentialActions() {
  // Anmeldedaten verwenden
  document.querySelectorAll('.use-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      
      // Anmeldedaten abrufen
      ipcRenderer.send('get-credential', {
        id,
        masterPassword: passwordManagerMasterPassword
      });
      
      ipcRenderer.once('credential', (event, credential) => {
        // Dialog ausblenden
        const dialog = document.querySelector('.password-manager-dialog');
        hideDialog(dialog);
        setTimeout(() => {
          dialog.remove();
        }, 300);
        
        // Mit Anmeldedaten verbinden
        connectToSSH({
          host: credential.host,
          port: credential.port || 22,
          username: credential.username,
          password: credential.password
        });
      });
    });
  });
  
  // Anmeldedaten bearbeiten
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      
      // Anmeldedaten abrufen
      ipcRenderer.send('get-credential', {
        id,
        masterPassword: passwordManagerMasterPassword
      });
      
      ipcRenderer.once('credential', (event, credential) => {
        editCredential(credential);
      });
    });
  });
  
  // Anmeldedaten löschen
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      const name = btn.closest('tr').children[0].textContent;
      
      // Bestätigungsdialog
      const confirmDialog = document.createElement('div');
      confirmDialog.className = 'dialog';
      confirmDialog.innerHTML = `
        <div class="dialog-content">
          <h2>Anmeldedaten löschen</h2>
          <p style="margin-bottom: 16px;">
            Möchtest du die Anmeldedaten "${name}" wirklich löschen?
          </p>
          <div class="form-actions">
            <button class="btn" id="cancel-delete">Abbrechen</button>
            <button class="btn primary" id="confirm-delete" style="background-color: var(--error);">Löschen</button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmDialog);
      
      // Dialog anzeigen
      showDialog(confirmDialog);
      
      // Abbrechen
      document.getElementById('cancel-delete').addEventListener('click', () => {
        hideDialog(confirmDialog);
        setTimeout(() => {
          confirmDialog.remove();
        }, 300);
      });
      
      // Bestätigen
      document.getElementById('confirm-delete').addEventListener('click', () => {
        // Anmeldedaten löschen
        ipcRenderer.send('delete-credential', {
          id,
          masterPassword: passwordManagerMasterPassword
        });
        
        ipcRenderer.once('credential-deleted', (event, { success }) => {
          if (success) {
            // Dialog ausblenden
            hideDialog(confirmDialog);
            setTimeout(() => {
              confirmDialog.remove();
              
              // Tabelle aktualisieren
              const row = document.querySelector(`tr[data-id="${id}"]`);
              if (row) {
                row.style.height = row.offsetHeight + 'px';
                row.style.transition = 'all 0.3s ease';
                
                setTimeout(() => {
                  row.style.height = '0';
                  row.style.opacity = '0';
                  
                  setTimeout(() => {
                    row.remove();
                    
                    // Leere Nachricht anzeigen, wenn keine Anmeldedaten mehr vorhanden sind
                    const tbody = document.getElementById('credentials-table-body');
                    if (tbody.children.length === 0) {
                      tbody.innerHTML = `
                        <tr>
                          <td colspan="5" class="empty-message">Keine Anmeldedaten vorhanden</td>
                        </tr>
                      `;
                    }
                  }, 300);
                }, 10);
              }
              
              showNotification('Anmeldedaten gelöscht', 'success');
            }, 300);
          }
        });
      });
    });
  });
}

// Anmeldedaten bearbeiten oder neu anlegen
function editCredential(credential = null) {
  const isEdit = !!credential;
  
  // Dialog erstellen
  const editDialog = document.createElement('div');
  editDialog.className = 'dialog';
  editDialog.innerHTML = `
    <div class="dialog-content">
      <h2>${isEdit ? 'Anmeldedaten bearbeiten' : 'Neue Anmeldedaten'}</h2>
      <form id="credential-form">
        <div class="form-group">
          <label for="cred-name">Name:</label>
          <input type="text" id="cred-name" placeholder="Optionaler Name" value="${isEdit && credential.name ? credential.name : ''}">
        </div>
        <div class="form-group">
          <label for="cred-host">Host:</label>
          <input type="text" id="cred-host" required value="${isEdit ? credential.host : ''}">
        </div>
        <div class="form-group">
          <label for="cred-port">Port:</label>
          <input type="number" id="cred-port" value="${isEdit ? (credential.port || 22) : 22}">
        </div>
        <div class="form-group">
          <label for="cred-username">Benutzername:</label>
          <input type="text" id="cred-username" required value="${isEdit ? credential.username : ''}">
        </div>
        <div class="form-group">
          <label for="cred-password">Passwort:</label>
          <div class="password-input-container">
            <input type="${isEdit ? 'password' : 'text'}" id="cred-password" ${isEdit ? 'placeholder="Passwort beibehalten"' : ''}>
            <button type="button" class="toggle-password-btn" id="toggle-password">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label for="cred-tags">Tags:</label>
          <input type="text" id="cred-tags" placeholder="Tag1, Tag2, ..." value="${isEdit && credential.tags ? credential.tags.join(', ') : ''}">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">Speichern</button>
          <button type="button" class="btn" id="cancel-edit">Abbrechen</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(editDialog);
  
  // Dialog anzeigen
  showDialog(editDialog);
  
  // Passwort anzeigen/verbergen
  document.getElementById('toggle-password').addEventListener('click', () => {
    const input = document.getElementById('cred-password');
    if (input.type === 'password') {
      input.type = 'text';
    } else {
      input.type = 'password';
    }
  });
  
  // Formular absenden
  document.getElementById('credential-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const formData = {
      id: isEdit ? credential.id : null,
      name: document.getElementById('cred-name').value,
      host: document.getElementById('cred-host').value,
      port: parseInt(document.getElementById('cred-port').value),
      username: document.getElementById('cred-username').value,
      password: document.getElementById('cred-password').value,
      tags: document.getElementById('cred-tags').value
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
    };
    
    // Bei Bearbeiten das Passwort nur aktualisieren, wenn es geändert wurde
    if (isEdit && !formData.password) {
      delete formData.password;
    }
    
    // Anmeldedaten speichern
    ipcRenderer.send('save-credential', {
      credential: formData,
      masterPassword: passwordManagerMasterPassword
    });
    
    ipcRenderer.once('credential-saved', (event, { id }) => {
      // Dialog schließen
      hideDialog(editDialog);
      setTimeout(() => {
        editDialog.remove();
        
        // Passwort-Manager aktualisieren
        if (document.querySelector('.password-manager-dialog')) {
          // Alle Anmeldedaten neu laden
          ipcRenderer.send('get-all-credentials', {
            masterPassword: passwordManagerMasterPassword
          });
          
          ipcRenderer.once('all-credentials', (event, { credentials }) => {
            document.getElementById('credentials-table-body').innerHTML = renderCredentialsTable(credentials);
            setupCredentialActions();
          });
        }
        
        showNotification(
          isEdit ? 'Anmeldedaten aktualisiert' : 'Anmeldedaten gespeichert',
          'success'
        );
      }, 300);
    });
  });
  
  // Abbrechen
  document.getElementById('cancel-edit').addEventListener('click', () => {
    hideDialog(editDialog);
    setTimeout(() => {
      editDialog.remove();
    }, 300);
  });
}

// =====================================================
// EVENT-HANDLER UND IPC-KOMMUNIKATION
// =====================================================

// SSH-Fehler
ipcRenderer.on('ssh-error', (event, error) => {
  showNotification(`Verbindungsfehler: ${error}`, 'error');
  updateStatusBar('Verbindungsfehler');
  
  // Animation für Fehlerzustand im Terminal
  if (terminalContainer) {
    terminalContainer.classList.add('connection-error');
    setTimeout(() => {
      terminalContainer.classList.remove('connection-error');
    }, 1500);
  }
});

// Passwort-Manager Fehler
ipcRenderer.on('password-manager-error', (event, error) => {
  showNotification(`Passwort-Manager: ${error}`, 'error');
});

// SFTP Ereignisse
ipcRenderer.on('sftp-session-started', (event, { streamId, path, entries }) => {
  const sftpContent = document.querySelector('.sftp-content');
  if (!sftpContent) return;
  
  // Pfad aktualisieren
  document.getElementById('sftp-path').value = path;
  
  // Dateiliste anzeigen
  sftpContent.innerHTML = `
    <div class="file-list-container">
      <table class="file-list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Größe</th>
            <th>Geändert</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody id="sftp-file-list">
          ${path !== '/' ? `
            <tr class="directory" data-path="${path}" data-parent="true">
              <td class="file-name">
                <span class="file-icon">📁</span> ..
              </td>
              <td class="file-size">-</td>
              <td class="file-date">-</td>
              <td class="file-actions">-</td>
            </tr>
          ` : ''}
          ${entries.map(entry => `
            <tr class="${entry.isDirectory ? 'directory' : 'file'}" data-path="${entry.path}">
              <td class="file-name">
                <span class="file-icon">${entry.isDirectory ? '📁' : '📄'}</span> ${entry.name}
              </td>
              <td class="file-size">${entry.isDirectory ? '-' : formatFileSize(entry.size)}</td>
              <td class="file-date">${formatDate(entry.mtime * 1000)}</td>
              <td class="file-actions">
                ${entry.isDirectory ? `
                  <button class="sftp-action-btn" title="Öffnen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M5 12h14M12 5l7 7-7 7"></path>
                    </svg>
                  </button>
                ` : `
                  <button class="sftp-action-btn" title="Herunterladen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
                    </svg>
                  </button>
                `}
                <button class="sftp-action-btn" title="Umbenennen">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                  </svg>
                </button>
                <button class="sftp-action-btn" title="Löschen">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                  </svg>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  // Event-Listener für Verzeichnisse
  document.querySelectorAll('.directory').forEach(row => {
    row.addEventListener('click', () => {
      // Übergeordnetes Verzeichnis
      let targetPath;
      if (row.dataset.parent) {
        // Ein Verzeichnis nach oben
        const parts = path.split('/').filter(p => p);
        parts.pop();
        targetPath = parts.length === 0 ? '/' : '/' + parts.join('/');
      } else {
        // Unterverzeichnis
        targetPath = row.dataset.path;
      }
      
      // Verzeichnis auflisten
      ipcRenderer.send('sftp-list-directory', {
        streamId,
        path: targetPath
      });
      
      // Loading-Animation anzeigen
      sftpContent.innerHTML = `
        <div class="loading-indicator">
          <div class="spinner"></div>
          <p>Lade Verzeichnis...</p>
        </div>
      `;
    });
  });
  
  // Event-Listener für Aktions-Buttons
  setupSftpActions(streamId);
  
  // Parent-Dir Button
  document.getElementById('parent-dir').addEventListener('click', () => {
    if (path === '/') return;
    
    // Ein Verzeichnis nach oben
    const parts = path.split('/').filter(p => p);
    parts.pop();
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    
    // Verzeichnis auflisten
    ipcRenderer.send('sftp-list-directory', {
      streamId,
      path: parentPath
    });
    
    // Loading-Animation anzeigen
    sftpContent.innerHTML = `
      <div class="loading-indicator">
        <div class="spinner"></div>
        <p>Lade Verzeichnis...</p>
      </div>
    `;
  });
  
  // Upload-Button
  document.getElementById('upload-file').addEventListener('click', () => {
    // File-Input erstellen
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.className = 'hidden-file-input';
    document.body.appendChild(fileInput);
    
    // Dialog öffnen
    fileInput.click();
    
    // Datei ausgewählt
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length === 0) {
        document.body.removeChild(fileInput);
        return;
      }
      
      // Jede Datei hochladen
      Array.from(fileInput.files).forEach(file => {
        // Hochladen
        ipcRenderer.send('sftp-upload-file', {
          streamId,
          localPath: file.path,
          remotePath: path + '/' + file.name
        });
        
        // Status anzeigen
        document.querySelector('.sftp-status').textContent = `Lade ${file.name} hoch...`;
        document.querySelector('.sftp-status').className = 'sftp-status';
      });
      
      // Input entfernen
      document.body.removeChild(fileInput);
    });
  });
  
  // Neu-Button
  document.getElementById('new-folder').addEventListener('click', () => {
    // Dialog erstellen
    const newDialog = document.createElement('div');
    newDialog.className = 'dialog';
    newDialog.innerHTML = `
      <div class="dialog-content">
        <h2>Neues Verzeichnis</h2>
        <form id="new-folder-form">
          <div class="form-group">
            <label for="folder-name">Name:</label>
            <input type="text" id="folder-name" required>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn primary">Erstellen</button>
            <button type="button" class="btn" id="cancel-new-folder">Abbrechen</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(newDialog);
    
    // Dialog anzeigen
    showDialog(newDialog);
    
    // Formular absenden
    document.getElementById('new-folder-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const folderName = document.getElementById('folder-name').value;
      
      // Verzeichnis erstellen
      ipcRenderer.send('sftp-create-directory', {
        streamId,
        path: path + '/' + folderName
      });
      
      // Dialog schließen
      hideDialog(newDialog);
      setTimeout(() => {
        newDialog.remove();
      }, 300);
    });
    
    // Abbrechen
    document.getElementById('cancel-new-folder').addEventListener('click', () => {
      hideDialog(newDialog);
      setTimeout(() => {
        newDialog.remove();
      }, 300);
    });
  });
});

// SFTP-Verzeichnis aktualisiert
ipcRenderer.on('sftp-directory-listed', (event, { streamId, path, entries }) => {
  const sftpContent = document.querySelector('.sftp-content');
  if (!sftpContent) return;
  
  // Pfad aktualisieren
  document.getElementById('sftp-path').value = path;
  
  // Dateiliste anzeigen
  sftpContent.innerHTML = `
    <div class="file-list-container">
      <table class="file-list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Größe</th>
            <th>Geändert</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody id="sftp-file-list">
          ${path !== '/' ? `
            <tr class="directory" data-path="${path}" data-parent="true">
              <td class="file-name">
                <span class="file-icon">📁</span> ..
              </td>
              <td class="file-size">-</td>
              <td class="file-date">-</td>
              <td class="file-actions">-</td>
            </tr>
          ` : ''}
          ${entries.map(entry => `
            <tr class="${entry.isDirectory ? 'directory' : 'file'}" data-path="${entry.path}">
              <td class="file-name">
                <span class="file-icon">${entry.isDirectory ? '📁' : '📄'}</span> ${entry.name}
              </td>
              <td class="file-size">${entry.isDirectory ? '-' : formatFileSize(entry.size)}</td>
              <td class="file-date">${formatDate(entry.mtime * 1000)}</td>
              <td class="file-actions">
                ${entry.isDirectory ? `
                  <button class="sftp-action-btn" title="Öffnen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M5 12h14M12 5l7 7-7 7"></path>
                    </svg>
                  </button>
                ` : `
                  <button class="sftp-action-btn" title="Herunterladen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
                    </svg>
                  </button>
                `}
                <button class="sftp-action-btn" title="Umbenennen">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                  </svg>
                </button>
                <button class="sftp-action-btn" title="Löschen">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                  </svg>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  // Event-Listener für Verzeichnisse
  document.querySelectorAll('.directory').forEach(row => {
    row.addEventListener('click', () => {
      // Übergeordnetes Verzeichnis
      let targetPath;
      if (row.dataset.parent) {
        // Ein Verzeichnis nach oben
        const parts = path.split('/').filter(p => p);
        parts.pop();
        targetPath = parts.length === 0 ? '/' : '/' + parts.join('/');
      } else {
        // Unterverzeichnis
        targetPath = row.dataset.path;
      }
      
      // Verzeichnis auflisten
      ipcRenderer.send('sftp-list-directory', {
        streamId,
        path: targetPath
      });
      
      // Loading-Animation anzeigen
      sftpContent.innerHTML = `
        <div class="loading-indicator">
          <div class="spinner"></div>
          <p>Lade Verzeichnis...</p>
        </div>
      `;
    });
  });
  
  // Event-Listener für Aktions-Buttons
  setupSftpActions(streamId);
});

// SFTP-Fehler
ipcRenderer.on('sftp-error', (event, { streamId, error }) => {
  showNotification(`SFTP-Fehler: ${error}`, 'error');
  
  // Status anzeigen
  const statusEl = document.querySelector('.sftp-status');
  if (statusEl) {
    statusEl.textContent = `Fehler: ${error}`;
    statusEl.className = 'sftp-status error';
  }
});

// SFTP-Aktionen einrichten
function setupSftpActions(streamId) {
  // Event-Listener für Herunterladen-Buttons
  document.querySelectorAll('.file .sftp-action-btn[title="Herunterladen"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const path = btn.closest('tr').dataset.path;
      
      // Dialog öffnen
      ipcRenderer.send('show-save-dialog', {
        title: 'Datei speichern',
        defaultPath: require('path').basename(path)
      });
      
      // Pfad ausgewählt
      ipcRenderer.once('save-dialog-selected', (event, { filePath }) => {
        if (!filePath) return;
        
        // Datei herunterladen
        ipcRenderer.send('sftp-download-file', {
          streamId,
          remotePath: path,
          localPath: filePath
        });
        
        // Status anzeigen
        document.querySelector('.sftp-status').textContent = `Lade ${require('path').basename(path)} herunter...`;
        document.querySelector('.sftp-status').className = 'sftp-status';
      });
    });
  });
  
  // Event-Listener für Umbenennen-Buttons
  document.querySelectorAll('.sftp-action-btn[title="Umbenennen"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('tr');
      const oldPath = row.dataset.path;
      const oldName = require('path').basename(oldPath);
      const isDirectory = row.classList.contains('directory');
      
      // Dialog erstellen
      const renameDialog = document.createElement('div');
      renameDialog.className = 'dialog';
      renameDialog.innerHTML = `
        <div class="dialog-content">
          <h2>${isDirectory ? 'Verzeichnis' : 'Datei'} umbenennen</h2>
          <form id="rename-form">
            <div class="form-group">
              <label for="new-name">Neuer Name:</label>
              <input type="text" id="new-name" value="${oldName}" required>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn primary">Umbenennen</button>
              <button type="button" class="btn" id="cancel-rename">Abbrechen</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(renameDialog);
      
      // Dialog anzeigen
      showDialog(renameDialog);
      
      // Formular absenden
      document.getElementById('rename-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const newName = document.getElementById('new-name').value;
        
        // Pfade erstellen
        const dirPath = require('path').dirname(oldPath);
        const newPath = dirPath + '/' + newName;
        
        // Umbenennen
        ipcRenderer.send('sftp-rename', {
          streamId,
          oldPath,
          newPath
        });
        
        // Dialog schließen
        hideDialog(renameDialog);
        setTimeout(() => {
          renameDialog.remove();
        }, 300);
      });
      
      // Abbrechen
      document.getElementById('cancel-rename').addEventListener('click', () => {
        hideDialog(renameDialog);
        setTimeout(() => {
          renameDialog.remove();
        }, 300);
      });
    });
  });
  
  // Event-Listener für Löschen-Buttons
  document.querySelectorAll('.sftp-action-btn[title="Löschen"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('tr');
      const path = row.dataset.path;
      const name = require('path').basename(path);
      const isDirectory = row.classList.contains('directory');
      
      // Dialog erstellen
      const deleteDialog = document.createElement('div');
      deleteDialog.className = 'dialog';
      deleteDialog.innerHTML = `
        <div class="dialog-content">
          <h2>${isDirectory ? 'Verzeichnis' : 'Datei'} löschen</h2>
          <p style="margin-bottom: 16px;">
            Möchtest du ${isDirectory ? 'das Verzeichnis' : 'die Datei'} "${name}" wirklich löschen?
            ${isDirectory ? '<br><strong>Achtung:</strong> Dies wird auch alle Unterverzeichnisse und Dateien löschen!' : ''}
          </p>
          <div class="form-actions">
            <button class="btn" id="cancel-delete">Abbrechen</button>
            <button class="btn primary" id="confirm-delete" style="background-color: var(--error);">Löschen</button>
          </div>
        </div>
      `;
      document.body.appendChild(deleteDialog);
      
      // Dialog anzeigen
      showDialog(deleteDialog);
      
      // Abbrechen
      document.getElementById('cancel-delete').addEventListener('click', () => {
        hideDialog(deleteDialog);
        setTimeout(() => {
          deleteDialog.remove();
        }, 300);
      });
      
      // Bestätigen
      document.getElementById('confirm-delete').addEventListener('click', () => {
        // Datei löschen
        ipcRenderer.send('sftp-delete-file', {
          streamId,
          path
        });
        
        // Dialog schließen
        hideDialog(deleteDialog);
        setTimeout(() => {
          deleteDialog.remove();
        }, 300);
      });
    });
  });
}

// Formatieren einer Dateigröße
function formatFileSize(size) {
  if (size < 1024) {
    return size + ' B';
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(1) + ' KB';
  } else if (size < 1024 * 1024 * 1024) {
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  } else {
    return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }
}

// =====================================================
// MENÜ-AKTIONEN UND EVENT-HANDLER
// =====================================================

// Ereignishandler für Hauptmenüaktionen
ipcRenderer.on('new-connection', () => {
  showDialog(connectionDialog);
});

ipcRenderer.on('open-settings', () => {
  // Einstellungsdialog mit Animation
  const settingsDialog = document.createElement('div');
  settingsDialog.className = 'dialog';
  settingsDialog.innerHTML = `
    <div class="dialog-content">
      <h2>Einstellungen</h2>
      
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="general">Allgemein</button>
        <button class="settings-tab" data-tab="terminal">Terminal</button>
        <button class="settings-tab" data-tab="appearance">Erscheinungsbild</button>
        <button class="settings-tab" data-tab="keyboard">Tastaturkürzel</button>
      </div>
      
      <div class="settings-content">
        <div class="settings-panel active" id="general-settings">
          <div class="form-group">
            <label for="default-port">Standard-Port:</label>
            <input type="number" id="default-port" value="22">
          </div>
          <div class="form-group">
            <label for="history-size">Anzahl der letzten Verbindungen:</label>
            <input type="number" id="history-size" value="5">
          </div>
          <div class="form-group password-manager-option">
            <label class="checkbox-label">
              <input type="checkbox" id="save-sessions" checked>
              Sitzungen automatisch speichern
            </label>
          </div>
        </div>
        
        <div class="settings-panel" id="terminal-settings">
          <div class="form-group">
            <label for="font-family">Schriftart:</label>
            <select id="font-family">
              <option value="Consolas">Consolas</option>
              <option value="Courier New">Courier New</option>
              <option value="monospace">Monospace</option>
            </select>
          </div>
          <div class="form-group">
            <label for="font-size">Schriftgröße:</label>
            <input type="number" id="font-size" value="14">
          </div>
          <div class="form-group">
            <label for="scrollback">Scrollback-Zeilen:</label>
            <input type="number" id="scrollback" value="10000">
          </div>
          <div class="form-group password-manager-option">
            <label class="checkbox-label">
              <input type="checkbox" id="cursor-blink" checked>
              Blinkender Cursor
            </label>
          </div>
        </div>
        
        <div class="settings-panel" id="appearance-settings">
          <p style="color: var(--gray-text); margin-bottom: 20px;">
            Erscheinungsbild-Einstellungen werden in einer zukünftigen Version verfügbar sein.
          </p>
        </div>
        
        <div class="settings-panel" id="keyboard-settings">
          <p style="color: var(--gray-text); margin-bottom: 20px;">
            Tastaturkürzel-Einstellungen werden in einer zukünftigen Version verfügbar sein.
          </p>
        </div>
      </div>
      
      <div class="form-actions">
        <button class="btn primary" id="save-settings">Speichern</button>
        <button class="btn" id="closeSettings">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(settingsDialog);
  
  // Dialog anzeigen
  showDialog(settingsDialog);
  
  // Tabs-Funktionalität
  const tabs = settingsDialog.querySelectorAll('.settings-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Aktiven Tab markieren
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Entsprechendes Panel anzeigen
      const tabId = tab.dataset.tab;
      const panels = settingsDialog.querySelectorAll('.settings-panel');
      panels.forEach(panel => panel.classList.remove('active'));
      settingsDialog.querySelector(`#${tabId}-settings`).classList.add('active');
    });
  });
  
  // Schließen-Button
  document.getElementById('closeSettings').addEventListener('click', () => {
    hideDialog(settingsDialog);
    setTimeout(() => {
      settingsDialog.remove();
    }, 300);
  });
  
  // Speichern-Button (funktional in zukünftiger Version)
  document.getElementById('save-settings').addEventListener('click', () => {
    hideDialog(settingsDialog);
    setTimeout(() => {
      settingsDialog.remove();
      showNotification('Einstellungen gespeichert', 'success');
    }, 300);
  });
});

ipcRenderer.on('about', () => {
  // Über-Dialog mit Animation
  const aboutDialog = document.createElement('div');
  aboutDialog.className = 'dialog';
  aboutDialog.innerHTML = `
    <div class="dialog-content">
      <h2 style="text-align: center; margin-bottom: 10px;">
        <span style="background: linear-gradient(90deg, var(--primary-color), var(--secondary-color)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">ChapSSH</span>
      </h2>
      <p style="text-align: center; color: var(--gray-text); margin-bottom: 20px;">Version 0.1.0</p>
      
      <div style="text-align: center; margin: 20px 0;">
        <p>Eine moderne PuTTY-Alternative</p>
        <p style="margin-top: 10px; font-size: 14px; color: var(--gray-text);">
          Entwickelt mit Electron und ❤️
        </p>
      </div>
      
      <div class="form-actions" style="justify-content: center;">
        <button class="btn primary" id="closeAbout">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(aboutDialog);
  
  // Dialog anzeigen
  showDialog(aboutDialog);
  
  // Schließen-Button
  document.getElementById('closeAbout').addEventListener('click', () => {
    hideDialog(aboutDialog);
    setTimeout(() => {
      aboutDialog.remove();
    }, 300);
  });
});

// Split-View aktivieren
ipcRenderer.on('activate-split-view', (event, { direction }) => {
  if (activeTab) {
    activateSplitView(activeTab, direction);
  }
});

// Split-View deaktivieren
ipcRenderer.on('deactivate-split-view', () => {
  if (activeTab) {
    deactivateSplitView(activeTab);
  }
});

// SFTP-Browser umschalten
ipcRenderer.on('toggle-sftp', () => {
  if (activeTab) {
    if (sftpPanelActive) {
      deactivateSftpPanel();
    } else {
      toggleSftpPanel(activeTab);
    }
  }
});

// Server-Statistiken umschalten
ipcRenderer.on('toggle-server-stats', () => {
  if (activeTab) {
    if (statsPanelActive) {
      deactivateStatsPanel();
    } else {
      toggleStatsPanel(activeTab);
    }
  }
});

// Favoriten laden
ipcRenderer.on('favorites-loaded', (event, favorites) => {
  renderFavorites(favorites);
});

// Tastenkombinationen
document.addEventListener('keydown', (e) => {
  // Strg+N für neue Verbindung
  if (e.ctrlKey && e.key === 'n') {
    e.preventDefault();
    showDialog(connectionDialog);
  }
  
  // Strg+W zum Schließen des aktuellen Tabs
  if (e.ctrlKey && e.key === 'w' && activeTab) {
    e.preventDefault();
    closeTab(activeTab);
  }
  
  // Strg+Tab zum Wechseln zwischen Tabs
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    
    const tabs = Object.keys(terminals);
    if (tabs.length > 1) {
      const currentIndex = tabs.indexOf(activeTab);
      const nextIndex = (currentIndex + 1) % tabs.length;
      activateTab(tabs[nextIndex]);
    }
  }
  
  // Strg+Umschalt+S für SFTP-Browser
  if (e.ctrlKey && e.shiftKey && e.key === 'S' && activeTab) {
    e.preventDefault();
    if (sftpPanelActive) {
      deactivateSftpPanel();
    } else {
      toggleSftpPanel(activeTab);
    }
  }
  
  // F11 für Vollbild
  if (e.key === 'F11') {
    e.preventDefault();
    ipcRenderer.send('toggle-fullscreen');
  }
});

// Server-Statistiken empfangen
ipcRenderer.on('server-stats-result', (event, stats) => {
  if (!stats) return;
  
  // CPU-Statistik
  if (stats.cpu) {
    document.getElementById('cpu-usage').textContent = `${stats.cpu}%`;
    document.getElementById('cpu-bar').style.width = `${stats.cpu}%`;
    
    // Farbe basierend auf Auslastung
    if (stats.cpu > 90) {
      document.getElementById('cpu-bar').style.backgroundColor = 'var(--error)';
    } else if (stats.cpu > 70) {
      document.getElementById('cpu-bar').style.backgroundColor = 'var(--warning)';
    } else {
      document.getElementById('cpu-bar').style.backgroundColor = 'var(--success)';
    }
  }
  
  // Speicher-Statistik
  if (stats.memory) {
    const { used, total, percent } = stats.memory;
    document.getElementById('memory-usage').textContent = `${used} / ${total}`;
    document.getElementById('memory-bar').style.width = `${percent}%`;
    
    // Farbe basierend auf Auslastung
    if (percent > 90) {
      document.getElementById('memory-bar').style.backgroundColor = 'var(--error)';
    } else if (percent > 70) {
      document.getElementById('memory-bar').style.backgroundColor = 'var(--warning)';
    } else {
      document.getElementById('memory-bar').style.backgroundColor = 'var(--success)';
    }
  }
  
  // Festplatten-Statistik
  if (stats.disk) {
    const { used, total, percent } = stats.disk;
    document.getElementById('disk-usage').textContent = `${used} / ${total}`;
    document.getElementById('disk-bar').style.width = `${percent}%`;
    
    // Farbe basierend auf Auslastung
    if (percent > 90) {
      document.getElementById('disk-bar').style.backgroundColor = 'var(--error)';
    } else if (percent > 70) {
      document.getElementById('disk-bar').style.backgroundColor = 'var(--warning)';
    } else {
      document.getElementById('disk-bar').style.backgroundColor = 'var(--success)';
    }
  }
  
  // Netzwerk-Statistik
  if (stats.network) {
    document.getElementById('network-usage').textContent = stats.network;
    document.getElementById('network-bar').style.width = '60%'; // Ein Beispielwert, da Netzwerkauslastung prozentual schwer zu bewerten ist
  }
  
  // System-Info
  if (stats.system) {
    document.getElementById('system-info').textContent = stats.system;
  }
  
  // Uptime
  if (stats.uptime) {
    document.getElementById('uptime').textContent = stats.uptime;
  }
});

// Server-Statistik-Fehler
ipcRenderer.on('server-stats-error', (event, error) => {
  showNotification(`Fehler beim Abrufen der Server-Statistiken: ${error}`, 'error');
});
# ChapSSH

**ChapSSH** ist ein moderner, plattformübergreifender SSH-Client mit grafischer Benutzeroberfläche, Passwortverwaltung und integriertem SFTP-Browser. Es wurde entwickelt, um eine elegante, sichere und funktional überlegene Alternative zu PuTTY zu bieten – speziell für Benutzer, die mehr als nur ein simples Terminal erwarten.

![ChapSSH Screenshot](screenshot.png)

---

## ✨ Features

- **Moderne Benutzeroberfläche**  
  Dunkles Theme, Sidebar mit Favoriten und letzten Verbindungen, Tabs für jede Sitzung, flüssige Animationen
- **SSH-Terminal (XTerm.js)**  
  Hochwertige Terminal-Emulation mit anpassbarer Schrift, Farben und vollständiger Shell-Funktionalität
- **Authentifizierung**  
  Passwort- und Private-Key-Login unterstützt, mit optionalem AES-256-GCM-verschlüsseltem Passwort-Manager
- **SFTP-Browser & Live-Statistiken**  
  Greife direkt auf Dateien zu, übertrage sie mit Drag & Drop – und erhalte Systemdaten wie CPU, RAM, Netzwerk und mehr
- **Split-View & Tabs**  
  Öffne parallele SSH-Sitzungen in einem Fenster – horizontal oder vertikal teilbar
- **Favoriten & Verlauf**  
  Speichere häufig genutzte Verbindungen oder greife auf die letzten 5 Verbindungen schnell zu
- **Statusanzeige & Schnellzugriff**  
  Jeder Tab zeigt Verbindungstatus, SFTP-Zugriff, Statistiken, Split-Ansicht und Schließen-Button

---

## 🚀 Installation

> **Voraussetzungen:**  
> Node.js (v18+) und npm müssen installiert sein.

```bash
git clone https://github.com/chaptiv/chapssh.git
cd chapssh
npm install
npm start
```

Optional kann die App zu einer ausführbaren Anwendung verpackt werden (z. B. mit electron-builder oder electron-forge).

## 🆚 ChapSSH vs. PuTTY

| Merkmal | ChapSSH | PuTTY |
|---------|---------|-------|
| Plattformen | ✅ Windows, macOS, Linux | ⚠️ Primär Windows (aber Ports für Linux/macOS verfügbar) |
| Tabs & Split-Terminal | ✅ Integriert | ❌ Nicht vorhanden (separate Fenster) |
| SFTP | ✅ Direkt integriert | ⚠️ Via PSFTP oder externe Tools wie WinSCP |
| Live-Statistiken | ✅ CPU, RAM, Netzwerk | ❌ Nicht vorhanden |
| Terminal-Funktionalität | ⚠️ XTerm.js (gute Kompatibilität, wenige Bugs) | ✅ Hervorragende Terminalemulation mit wenigen Randproblemen |
| Design | ✅ Modern, Dark Mode, Animationen | ⚠️ Funktional, aber veraltet |
| Anpassbarkeit | ⚠️ Begrenzt anpassbar | ✅ Hochgradig anpassbar (mit etwas Lernkurve) |
| Barrierefreiheit | ⚠️ Noch in Entwicklung | ✅ Gut etabliert |
| Verschlüsselung | ✅ Aktuelle Standards mit AES-256 | ✅ Bewährte Implementierung |
| Stabilität | ⚠️ Noch in Entwicklung, gelegentliche Bugs | ✅ Extrem stabil und erprobt |
| Passwort-Manager | ✅ AES-256-verschlüsselt | ❌ Begrenzte Speicherfunktion |
| Startgeschwindigkeit | ⚠️ Electron-basiert, etwas langsamer | ✅ Sehr schnell und leichtgewichtig |
| Ressourcenverbrauch | ⚠️ Höherer RAM-Bedarf | ✅ Minimaler Ressourcenbedarf |
| Portable Version | ❌ Noch nicht verfügbar | ✅ Verfügbar |
| Letzte Aktualisierung | ✅ Aktive Entwicklung (2025) | ⚠️ Langsame aber stetige Updates |
| Open Source | ✅ MIT Lizenz | ✅ MIT Lizenz |

### ➕ ChapSSH ist besser wenn:
- Du ein modernes UI mit Tabs und Split-View bevorzugst
- Du integrierten SFTP-Zugriff brauchst ohne zusätzliche Tools
- Du häufig zwischen mehreren Servern wechselst
- Du visuelle Feedback und Live-Statistiken schätzt
- Du auf macOS oder Linux primär arbeitest

### ➕ PuTTY ist besser wenn:
- Absolute Stabilität Priorität hat
- Du minimalen Ressourcenverbrauch benötigst
- Du mit der klassischen Oberfläche vertraut bist
- Du sehr spezifische Terminal-Anpassungen brauchst
- Du eine leichtgewichtige portable Lösung suchst

## 🐞 Bekannte Probleme

### 🖥️ Terminal nutzt nicht die volle Fläche
**Problem:** Nach dem Start oder beim Öffnen neuer Tabs wird das Terminal manchmal nicht vollständig skaliert. Das Terminal erscheint dann zu klein und nutzt nicht den verfügbaren Platz im Tab.

**Technische Ursache:** Die XTerm.js-Komponente benötigt ein explizites Neuberechnen der Größe nach dem DOM-Rendering. Der `fit()`-Befehl wird möglicherweise zu früh aufgerufen, bevor der Container vollständig gerendert wurde, oder der Event-Listener für Container-Größenänderungen reagiert nicht korrekt.

**Workaround:** 
- Ein manuelles Neuladen des Tabs (F5 oder über das Kontextmenü)
- Ändern der Fenstergröße triggert das Neuberechnen
- Wechsel zu einem anderen Tab und zurück kann ebenfalls helfen

**Geplanter Fix:** Wir implementieren derzeit einen verbesserten Rendering-Lifecycle mit MutationObserver und ResizeObserver, um sicherzustellen, dass XTerm.js nach vollständigem DOM-Rendering korrekt initialisiert wird.

### 📁 SFTP zeigt Ordner nicht oder unvollständig an
**Problem:** Bei der Navigation in bestimmten Verzeichnissen über den SFTP-Browser werden keine oder nur unvollständige Datei- und Ordnerlisten angezeigt. Dies tritt besonders häufig in System- oder Konfigurationsverzeichnissen auf.

**Technische Ursache:** Die SSH2-SFTP-Implementierung kann bei bestimmten Server-Konfigurationen Probleme mit der korrekten Interpretation von `readdir()`-Antworten haben. Dies betrifft vor allem:
- Verzeichnisse mit vielen versteckten Dateien (beginnend mit '.')
- Spezielle Dateisysteme wie procfs oder sysfs
- Server mit nicht-standardmäßigen SFTP-Subsystem-Implementierungen
- Ungültige UTF-8-Zeichen in Dateinamen

**Workaround:**
- Direkter Zugriff über das Terminal mit `ls -la` 
- Verwendung absoluter Pfade beim Navigieren
- Neuverbindung der SSH-Sitzung

**Geplante Verbesserungen:**
- Robusteres Error-Handling mit automatischen Wiederholungsversuchen
- Bessere Fehlermeldungen mit spezifischen Hinweisen
- Alternative Methoden zur Verzeichnisauflistung, wenn Standard-SFTP fehlschlägt
- Unterstützung für verschiedene Zeichenkodierungen bei Dateinamen

### 📉 Fortschrittsanzeigen in Programmen werden fehlerhaft dargestellt
**Problem:** Bei Programmen mit dynamischen Terminal-Ausgaben (wie apt-get, npm install, wget mit Fortschrittsbalken) wird die Ausgabe oft falsch positioniert oder springt im Terminal-Fenster. Fortschrittsbalken erscheinen im unteren Drittel statt an der richtigen Position.

**Technische Ursache:** 
- Fehlerhafte Interpretation von Terminal-Control-Sequences (insbesondere Cursor-Positioning und Line-Clearing)
- Verzögerungen beim Anwenden von Control-Sequences bei hoher Ausgabefrequenz
- Inkonsistente Zeilenhöhenberechnung bei unterschiedlichen Fonts
- Möglicherweise werden Terminfo-Einstellungen nicht korrekt aus der Umgebung übernommen

**Detaillierte Auswirkungen:**
- Programme mit \r-basierten Fortschrittsanzeigen (überschreiben die aktuelle Zeile) funktionieren nicht korrekt
- ANSI-Escape-Sequenzen zur Cursorpositionierung werden teilweise ignoriert
- Bei hoher Ausgabefrequenz kommt es zu Flackern oder Überlagerungen

**Aktuelle Entwicklung:**
- Wir haben eine vollständige Überarbeitung des Terminal-Renderingsystems begonnen
- Implementierung eines Puffers für schnelle Ausgaben
- Bessere Verarbeitung von ANSI-Escape-Sequenzen
- Optimierte Timing-Parameter für die Terminal-Aktualisierung

**Vorläufige Lösung:** Eine neue Version mit verbesserten Terminal-Rendering-Mechanismen ist für das nächste Release geplant. Dies sollte die Darstellung von dynamischen Ausgaben erheblich verbessern.

## 📜 Lizenz

Dieses Projekt steht unter der MIT License.

Siehe LICENSE.md für weitere Informationen.

## 🤝 Mitwirken

Feature-Ideen, Bug-Reports und Pull Requests sind herzlich willkommen!

Starte einen Issue oder sende direkt einen PR.

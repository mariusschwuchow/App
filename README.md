# Standort-Bewertung

Web-App (PWA) mit einer Karte, die deinen aktuellen Standort anzeigt. Über den Button
**„Standort bewerten“** öffnet sich ein Menü mit *Sehr gut*, *Gut*, *Mittel* und *Schlecht*.
Die Auswahl wird zusammen mit den Koordinaten und dem Zeitpunkt gespeichert und als farbiger
Punkt auf der Karte angezeigt. Ein Tipp auf einen Punkt zeigt Details und erlaubt das Löschen.

- Karte: [Leaflet](https://leafletjs.com/) mit OpenStreetMap-Kacheln
- Speicherung: lokal auf dem Gerät, doppelt in IndexedDB und `localStorage`
- Kein Build-Schritt nötig – reine HTML/CSS/JS-Dateien

## Datensicherheit

- Jede Bewertung wird sofort beim Auswählen gespeichert, und zwar doppelt: in IndexedDB
  und als Kopie in `localStorage`. Beim Start werden beide zusammengeführt. Wird einer der
  Speicher geleert, stellt der andere die Daten wieder her.
- Die App bittet den Browser um **dauerhaften Speicher** (`navigator.storage.persist()`),
  damit er die Daten nicht automatisch aufräumt.
- Über das Menü **☰ → „Sicherung herunterladen“** wird eine JSON-Datei mit allen
  Bewertungen gespeichert. Mit **„Sicherung wiederherstellen“** wird sie wieder eingelesen
  (nach dem Löschen der Browserdaten oder auf einem neuen Gerät). Doppelte Einträge werden
  dabei übersprungen.
- **iPhone:** Safari kann Website-Daten nach 7 Tagen ohne Nutzung löschen. Das gilt nicht,
  wenn die App über „Zum Home-Bildschirm“ installiert wurde. Darum: installieren und ab und
  zu eine Sicherung herunterladen.

## Starten

Die Standortabfrage funktioniert nur über **HTTPS** oder `localhost`.

Lokal:

```sh
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Auf dem Handy am einfachsten über GitHub Pages (Settings → Pages → Branch auswählen) oder
einen anderen HTTPS-Host. Im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen, um sie
wie eine App zu nutzen.

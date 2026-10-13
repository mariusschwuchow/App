# Standort-Bewertung

Web-App (PWA) mit einer Karte, die deinen aktuellen Standort anzeigt. Über den Button
**„Standort bewerten“** öffnet sich ein Menü mit *Sehr gut*, *Gut*, *Mittel* und *Schlecht*.
Die Auswahl wird zusammen mit den Koordinaten und dem Zeitpunkt gespeichert und als farbiger
Punkt auf der Karte angezeigt. Ein Tipp auf einen Punkt zeigt Details und erlaubt das Löschen.

- Karte: [Leaflet](https://leafletjs.com/) mit OpenStreetMap-Kacheln
- Speicherung: lokal im Browser (`localStorage`, Schlüssel `standort-bewertungen`)
- Kein Build-Schritt nötig – reine HTML/CSS/JS-Dateien

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

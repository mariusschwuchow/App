# Standort-Bewertung

Web-App (PWA) mit einer Karte, die deinen aktuellen Standort anzeigt. Über den Button
**„Standort bewerten“** öffnet sich ein Menü mit *Sehr gut*, *Gut*, *Mittel* und *Schlecht*.
Die Auswahl wird zusammen mit den Koordinaten und dem Zeitpunkt gespeichert und als farbiger
Punkt auf der Karte angezeigt. Ein Tipp auf einen Punkt zeigt Details und erlaubt das Löschen.

- Karte: [Leaflet](https://leafletjs.com/) mit OpenStreetMap-Kacheln
- Speicherung: lokal auf dem Gerät, doppelt in IndexedDB und `localStorage`
- Kein Build-Schritt nötig – reine HTML/CSS/JS-Dateien

## Orte manuell eintragen

Über **„Ort wählen“** lassen sich Orte markieren, an denen du früher schon warst. Dafür
die Karte verschieben (oder auf den Ort tippen), bis das rote Kreuz auf dem Ort liegt, dann
**„Hier markieren“** antippen. Danach Bewertung und optional das Besuchsdatum wählen.

Manuell eingetragene Orte haben auf der Karte einen dunklen Rand. Wurde ein Datum
angegeben, wird die Mondphase dieses Tages (Tagesmitte) gespeichert. Wetter und
Wasserstand werden für manuelle Orte nicht abgerufen, weil die aktuellen Werte nicht zum
damaligen Besuch passen würden.

## Wetter, Luftdruck und Wasserstand

Direkt nach dem Speichern einer Bewertung ruft die App zusätzlich ab und speichert mit:

- **Wetter** (Open-Meteo): Wetterlage, Temperatur, gefühlte Temperatur, Wind und Böen,
  Bewölkung, Luftfeuchte, Niederschlag
- **Luftdruck** (Open-Meteo, auf Meereshöhe reduziert): aktuell, vor 24 Stunden (Vortag)
  und in 24 Stunden (Folgetag, Vorhersage)
- **Wasserstand** (PEGELONLINE des Bundes): aktueller Wert, Tendenz und Einstufung am
  nächstgelegenen Pegel im Umkreis von 25 km, mit Pegelname, Gewässer und Entfernung.
  PEGELONLINE enthält nur die Pegel an Bundeswasserstraßen. An kleineren Flüssen und Seen
  gibt es oft keinen Wert.

Außerdem wird die **Mondphase** (Name und Beleuchtung in %) gespeichert. Sie wird direkt
in der App berechnet und funktioniert daher auch ohne Netz.

Die Bewertung selbst wird immer zuerst gespeichert. Klappt der Abruf nicht (z. B. ohne
Netz), kann er bis zu 3 Stunden später im Punkt auf der Karte wiederholt werden.

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

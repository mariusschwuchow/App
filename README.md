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
angegeben (optional mit Uhrzeit, sonst gilt 12 Uhr), werden für diesen Zeitpunkt
gespeichert:

- Mondphase
- Wetter und Luftdruck (Vortag, Zeitpunkt, Folgetag) – aus Open-Meteo, für ältere Daten
  aus dem Open-Meteo-Archiv
- Wasserstand am nächsten Pegel – nur wenn der Besuch höchstens 30 Tage zurückliegt,
  weil PEGELONLINE ältere Messwerte nicht bereitstellt

Ältere manuelle Einträge mit Datum lassen sich im Punkt über „Wetterdaten abrufen“
nachträglich ergänzen.

## Spots mit mehreren Besuchen

Ein Punkt auf der Karte ist ein **Spot**, der mehrere **Besuche** haben kann. Jeder Besuch
hat eigene Bewertung, Wetter- und Pegeldaten, Mondphase, Fischarten und Notizen.

- Im Spot über **„+ Besuch hinzufügen“** einen weiteren Besuch eintragen: ohne Datum gilt
  er für jetzt (aktuelle Daten), mit Datum für einen vergangenen Tag.
- Wird über „Standort bewerten“ oder „Ort wählen“ ein Ort im Umkreis von 50 m um einen
  vorhandenen Spot bewertet, fragt die App, ob der Besuch zu diesem Spot gehört.
- Die Besuche sind eingeklappt (neueste oben) und lassen sich einzeln aufklappen.
- Die **Gesamtbewertung** ist der gerundete Durchschnitt aller Besuche
  (Schlecht = 1, Mittel = 2, Gut = 3, Sehr gut = 4; genau in der Mitte wird aufgerundet).
  Beispiel: Schlecht + Mittel + Gut = Mittel. Die Farbe des Punkts zeigt die
  Gesamtbewertung, die Zahl darin die Anzahl der Besuche.

## Spot-Analyse („Wohin heute?“)

Im Menü **☰ → „Spot-Analyse: Wohin heute?“** zeigt die App für **heute, morgen und
übermorgen**, welche Spots sich laut Wettervorhersage lohnen.

So wird gerechnet:

1. Für jeden Spot wird die Vorhersage (Open-Meteo) geladen, und zwar für die **Uhrzeit**
   jedes früheren Besuchs (z. B. ein Besuch um 7 Uhr wird mit der Vorhersage für 7 Uhr
   verglichen).
2. Jeder Besuch mit gespeicherten Wetterdaten wird mit der Vorhersage verglichen:
   Druckverlauf über 24 h (Gewicht 2), Luftdruck und Temperatur (je 1,5), Wind,
   Bewölkung, Niederschlag, Mondphase (je 1) und Windrichtung (0,5). Pro Merkmal gibt es
   eine Toleranz (z. B. 10 hPa, 6 °C), innerhalb derer die Ähnlichkeit von 100 % auf 0 %
   fällt.
3. Die **Erwartung** ist der Durchschnitt der Bewertungen, wobei ähnliche Besuche viel
   stärker zählen. Die **Empfehlung** (0–100) ist diese Erwartung, abgeschwächt, wenn kein
   früherer Besuch wirklich ähnlich war.

Mit dem Fischfilter (Barsch, Zander, Hecht) werden nur Spots gezeigt, an denen diese Art
schon gut lief. Spots ohne Besuche mit Wetterdaten fehlen in der Analyse. Der Wasserstand
fließt nicht ein, weil es dafür keine Vorhersage gibt.

## Fischarten und Notizen

Bei jedem Besuch kann man ankreuzen, welche Fischart dort gut lief (**Barsch**,
**Zander**, **Hecht**, auch mehrere) und **Notizen** eintragen. Beides wird sofort
gespeichert und ist in der Sicherungsdatei enthalten.

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

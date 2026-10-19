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

## Raubfisch und Friedfisch

Im Menü (☰) oben lässt sich zwischen **🎣 Raubfisch** und **🐟 Friedfisch** umschalten;
die aktive Sparte steht oben links neben dem Menü. Beide sind strikt getrennt: Karte,
Spot-Analyse, Fangstatistik und Filter zeigen nur die gewählte Sparte, und ein neuer
Eintrag wird nie einem Spot der anderen Sparte zugeordnet. Jeder Eintrag speichert seine
Sparte (Feld `mode`); ältere Einträge zählen als Raubfisch. Die Sicherungsdatei enthält
beide Sparten.

| Sparte | Fischarten | Köder | Angelmethoden |
|---|---|---|---|
| Raubfisch | Barsch, Zander, Hecht | Gummifisch, Wobbler, Spinner, Blinker, Jerkbait, Spinnerbait, Köderfisch | Jiggen, Faulenzen, Dropshot, Texas-Rig, Carolina-Rig, Twitchen/Jerken, Vertikalangeln, Schleppen, Ansitz |
| Friedfisch | Karpfen, Brasse, Rotauge, Schleie, Barbe, Rotfeder | Mais, Boilie, Made, Wurm, Teig, Pellet, Brot | Feeder, Method-Feeder, Pose, Grundangeln, Haar-Montage, Stippen |

## Köder, Wassertemperatur, Sonnenzeiten

- **Köder** und **Angelmethode** sind getrennt: beide pro Besuch auswählbar (mehrere
  möglich), beim Köder zusätzlich Freitext für Farbe/Größe. Die Spot-Analyse zeigt einen
  **Tipp** mit Köder und Methode aus guten Besuchen mit ähnlichem Wetter. Ältere Einträge
  mit „Dropshot“ als Köder werden beim Start automatisch auf die Methode umgestellt.
- **Wassertemperatur** (Reihenfolge, die erste verfügbare zählt):
  1. **selbst gemessen** (Eingabefeld im Besuch, z. B. Wert vom Echolot),
  2. **Pegel**: nächster PEGELONLINE-Pegel mit Temperaturmessung im Umkreis von 50 km
     (aktuell oder bis 30 Tage zurück) – viele Pegel, z. B. am Rhein in NRW, messen sie nicht,
  3. **Schätzung** aus dem Mittel der Lufttemperatur der letzten 7 Tage
     (Faustformel für Fließgewässer: ≈ 5 + 0,75 × Lufttemperatur), klar als „geschätzt“
     gekennzeichnet.

  Ältere Besuche ohne Wert haben den Knopf „Wassertemperatur nachladen“. In der Analyse
  wird der aktuell gemessene Pegelwert verwendet, sonst die Schätzung für den jeweiligen
  Tag (mit Vorhersage-Temperaturen).
- **Sonne:** Aufgang, Untergang und bürgerliche Dämmerung werden in der App berechnet –
  für heute im Spot-Kopf, für den Besuchstag in jedem Besuch und für den gewählten Tag in
  der Analyse.

## Fangstatistik

Menü → **Fangstatistik**: Kennzahlen (Spots, Besuche, Besuche mit Fang, größter Fisch),
Fischarten mit größtem und durchschnittlichem Fisch sowie die durchschnittliche Bewertung
nach Monat, Tageszeit, Luftdruckverlauf, Mondphase, Wassertemperatur, Köder und
Gewässertyp. Mit Fischfilter.

## Kartenfilter, Umbenennen, Zusammenlegen

- **Filter** (oben links): nach Fischart, Gewässertyp und Mindest-Gesamtbewertung.
- **✎** neben dem Spot-Namen: eigenen Namen vergeben (leer = automatischer Ortsname).
- **„Mit anderem Spot zusammenlegen“** im Spot, dann den Ziel-Spot antippen: alle Besuche
  landen beim Ziel (Position und Name des Ziels, Gewässertypen werden vereinigt).

## Sicherungs-Erinnerung

Die App erinnert an eine Sicherung, wenn noch nie gesichert wurde (ab 3 Einträgen), seit
der letzten Sicherung 10 neue Einträge dazugekommen sind oder sie 14 Tage her ist (bei
neuen Einträgen). „Später“ pausiert die Erinnerung 3 Tage. Auf dem iPhone geht die
Sicherung über **„In Dateien / iCloud Drive sichern“** direkt ins Teilen-Menü; dort
„In Dateien sichern“ → iCloud Drive wählen.

## Spot-Analyse („Wohin heute?“)

Im Menü **☰ → „Spot-Analyse: Wohin heute?“** zeigt die App für **heute, morgen und
übermorgen**, welche Spots sich laut Wettervorhersage lohnen.

So wird gerechnet:

1. Für jeden Spot wird die Vorhersage (Open-Meteo) geladen, und zwar für die **Uhrzeit**
   jedes früheren Besuchs (z. B. ein Besuch um 7 Uhr wird mit der Vorhersage für 7 Uhr
   verglichen).
2. Jeder Besuch mit gespeicherten Wetterdaten wird mit der Vorhersage verglichen:
   Druckverlauf über 24 h (Gewicht 2), Luftdruck, Temperatur und Wassertemperatur
   (je 1,5), Wind,
   Bewölkung, Niederschlag, Mondphase (je 1) und Windrichtung (0,5). Pro Merkmal gibt es
   eine Toleranz (z. B. 10 hPa, 6 °C), innerhalb derer die Ähnlichkeit von 100 % auf 0 %
   fällt.
3. Die **Erwartung** ist der Durchschnitt der Bewertungen, wobei ähnliche Besuche viel
   stärker zählen. Die **Empfehlung** (0–100) ist diese Erwartung, abgeschwächt, wenn kein
   früherer Besuch wirklich ähnlich war.

Mit dem Fischfilter (Barsch, Zander, Hecht) werden nur Spots gezeigt, an denen diese Art
schon gut lief. Spots ohne Besuche mit Wetterdaten fehlen in der Analyse. Der Wasserstand
fließt nicht ein, weil es dafür keine Vorhersage gibt.

## In Apple Karten öffnen

Jeder Spot (und jede Karte in der Spot-Analyse) hat den Button **„In Apple Karten
öffnen“**. Auf dem iPhone öffnet sich die Karten-App mit einer Stecknadel am Spot, von dort
lässt sich direkt die Route starten.

## Spot-Namen

Jeder Spot bekommt automatisch den Namen des nächstgelegenen Orts bzw. Ortsteils, z. B.
„Holweide, Köln“. Der Name kommt von Nominatim (OpenStreetMap), wird einmalig abgefragt
und beim Spot gespeichert. Ohne Netz wird er beim nächsten Start nachgeholt.

## Fischarten und Notizen

Bei jedem Besuch kann man ankreuzen, welche Fischart dort gut lief (**Barsch**,
**Zander**, **Hecht**, auch mehrere), für jede Art die **Größe** (1–150 cm, Schieberegler
plus −/+ für zentimetergenaues Einstellen) angeben und **Notizen** eintragen. Alles wird
sofort gespeichert und ist in der Sicherungsdatei enthalten.

## Gewässertyp

Unter den Fischarten lässt sich der **Gewässertyp** wählen: Großgewässer, Meer, Polder,
Fluss, Kanal, See (auch mehrere, z. B. Fluss + Großgewässer). Er gilt für den ganzen Spot:
Eine Änderung in einem Besuch wird bei allen Besuchen des Spots übernommen, neue Besuche
erben ihn, und er steht oben im Spot. In der Spot-Analyse kann nach Gewässertyp gefiltert
werden.

## Fotos

Bei jedem Besuch lassen sich über **„+ Foto hinzufügen“** Bilder aus der Foto-App (oder
direkt von der Kamera) anheften, auch mehrere auf einmal. Sie werden auf max. 1600 px
verkleinert und in IndexedDB gespeichert. Antippen öffnet ein Foto groß, dort kann es auch
gelöscht werden. Die Sicherungsdatei enthält die Fotos; sie wird dadurch entsprechend
größer.

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

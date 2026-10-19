# Drittanbieter-Hinweise

## Software

### Leaflet 1.9.4
Kartenbibliothek, enthalten in `vendor/leaflet/`. Lizenz: BSD 2-Clause, vollständiger Text in
`vendor/leaflet/LICENSE`.
Copyright (c) 2010-2023, Volodymyr Agafonkin; Copyright (c) 2010-2011, CloudMade.

### SunCalc (Verfahren für Sonnen- und Mondberechnung)
Die Berechnungen in `moon.js` folgen dem Verfahren der Bibliothek SunCalc
(https://github.com/mourner/suncalc), die auf Formeln von Jean Meeus beruht.

BSD 2-Clause License

Copyright (c) 2014, Vladimir Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of
   conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of
   conditions and the following disclaimer in the documentation and/or other materials
   provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
OF THE POSSIBILITY OF SUCH DAMAGE.

## Daten und Dienste

| Dienst | Verwendung | Lizenz / Bedingungen |
|---|---|---|
| Open-Meteo (open-meteo.com) | Wetter, Luftdruck, Vorhersage, Archiv | Daten CC BY 4.0; kostenloser Zugang nur nicht-kommerziell |
| PEGELONLINE (WSV) | Wasserstand, Wassertemperatur | Quelle: Wasserstraßen- und Schifffahrtsverwaltung des Bundes; ungeprüfte Rohdaten, Lizenz vor kommerzieller Nutzung prüfen |
| OpenStreetMap | Straßenkarte | Daten © OpenStreetMap-Mitwirkende, ODbL; Kachel-Nutzungsrichtlinie der OSMF |
| Nominatim (OSM) | Ortsnamen, Ortssuche | Nominatim-Nutzungsrichtlinie der OSMF |
| Esri World Imagery | Luftbild | © Esri, Maxar, Earthstar Geographics; Esri-Nutzungsbedingungen |

Die Faustformel zur Schätzung der Wassertemperatur (≈ 5 + 0,75 × Lufttemperatur) ist eine
allgemeine Näherung nach Stefan & Preud'homme (1993) für Fließgewässer.

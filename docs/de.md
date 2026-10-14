# evcc

Diese Integration bringt [evcc](https://evcc.io) in Gladys. evcc steuert das Laden von
Elektrofahrzeugen mit Solarüberschuss, dynamischen Tarifen oder einem Ladeplan. Gladys folgt evcc
live (Solarproduktion, Haus, Netz, Batterie, Ladepunkte, Fahrzeuge), ändert Lademodus und Limits
und startet Szenen, wenn ein Fahrzeug angesteckt wird oder ein Ladevorgang endet.

Die Integration spricht mit evcc in deinem lokalen Netz, ohne Cloud. Entwickelt und getestet wurde
sie gegen den Demo-Modus von evcc (Versionen 0.210 und 0.317), **ohne echte Wallbox: Rückmeldungen
sind willkommen**.

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer.
- Ein evcc in deinem Netz (Raspberry Pi, Docker, Home Assistant…), empfohlen ab Version 0.200.
  Ältere Versionen werden so gut wie möglich gelesen.
- Die Adresse von evcc, wie du sie im Browser öffnest, zum Beispiel `http://192.168.1.20:7070`.
  Gladys muss sie erreichen können.

## Konfiguration

1. **Integrationen → evcc**, dann **Konfiguration**.
2. **Adresse von evcc**: die Adresse seiner Weboberfläche. Ohne Port wird 7070 verwendet. Hinter
   einem Reverse-Proxy ist ein Pfad erlaubt (`https://example.org/evcc`).
3. **Admin-Passwort**: optional. Neuere evcc-Versionen ändern Modus und Limits ohne Passwort. Wenn
   dein evcc (oder dein Proxy) mit „nicht autorisiert“ antwortet, gib es ein.
4. **Sprache der Funktionsnamen**: standardmäßig Französisch. Die Namen werden beim Hinzufügen des
   Geräts festgelegt.
5. Speichere und klicke auf **Verbindung testen**: die evcc-Version und die Anzahl der Ladepunkte
   und Fahrzeuge werden angezeigt.
6. Füge im Tab **Entdecken** die gewünschten Geräte hinzu.

Die Integration folgt evcc über seinen Websocket: die Werte kommen bei jedem evcc-Zyklus
(standardmäßig 30 s). Fällt der Websocket aus, liest sie den Zustand alle 30 s und verbindet sich
selbst neu.

## Die Geräte

### Standort

Ein Gerät mit dem Namen deines evcc-Standorts, mit dem, was evcc misst:

| Funktion        | Detail                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Solarproduktion | W, wenn evcc einen PV-Zähler hat                                       |
| Hausverbrauch   | W                                                                      |
| Netz            | W, positiv beim Bezug, negativ bei der Einspeisung                     |
| Hausbatterie    | Stand in %, Lade- und Entladeleistung in W, wenn es eine Batterie gibt |
| Netzpreis       | aktueller Preis einer kWh, wenn in evcc ein Tarif eingerichtet ist     |

### Ladepunkt

Ein Gerät pro evcc-Ladepunkt:

| Funktion                 | Detail                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Modus                    | **steuerbar**: Aus, PV, Min + PV, Schnell                                                                                |
| Ladezustand              | lädt, angesteckt, wartet (evcc wartet auf Sonne oder ein Zeitfenster), Pause (Fahrzeug voll), frei                       |
| Fahrzeug angesteckt      | ja oder nein                                                                                                             |
| Ladeleistung             | kW                                                                                                                       |
| Ladestrom                | A                                                                                                                        |
| Energie des Ladevorgangs | seit dem Anstecken geladene kWh                                                                                          |
| Restzeit                 | Minuten, Schätzung von evcc während des Ladens                                                                           |
| Ladelimit                | **steuerbar**: angestrebter Batteriestand für diesen Ladevorgang, in %                                                   |
| Fahrzeug                 | Name des von evcc erkannten Fahrzeugs                                                                                    |
| Günstiges Netzladen      | evcc lädt, weil das Netz günstig ist (dynamischer Tarif)                                                                 |
| Zähler der Wallbox       | Zählerstand in kWh, wenn die Wallbox einen Zähler hat: Gladys leitet daraus Verbrauch und Kosten im Energiemonitoring ab |

Seit evcc 0.317 heißt der Modus „PV“ in evcc **Smart**, und „Min + PV“ ist Smart mit der Option
**Immer laden**. Die Integration behält die vier bisherigen Modi, die jede evcc-Version versteht.

Ein integriertes Gerät (Wärmepumpe, von evcc geschaltete Steckdose) hat nur Modus, Zustand,
Leistung, Energie und Zähler.

### Fahrzeug

Ein Gerät pro in evcc eingerichtetem Fahrzeug:

| Funktion      | Detail                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| Batteriestand | %, bekannt, solange das Fahrzeug angesteckt ist (der letzte Wert bleibt) |
| Reichweite    | km, ebenso                                                               |
| Ladelimit     | **steuerbar**: maximaler Batteriestand des Fahrzeugs in evcc, in %       |
| Angesteckt    | das Fahrzeug ist an einem Ladepunkt angesteckt                           |
| Ladeplan      | der nächste Plan (Stand und Uhrzeit) oder „Kein Plan“                    |

## Dashboard-Widget

Das Widget **evcc** zeigt den Energiefluss (Solar, Haus, Netz in kW), die Hausbatterie, den
Netzpreis und eine Zeile pro Ladepunkt (Zustand, Leistung, Modus). Vier Tasten ändern den Modus
eines Ladepunkts: den in den Widget-Einstellungen gewählten, sonst den ersten. Der aktuelle Modus
trägt ein Häkchen. Antwortet evcc nicht mehr, zeigt das Widget die letzten bekannten Werte, ohne
Tasten.

## Szenen-Auslöser

| Auslöser            | Wann                                                                            | Variablen                                                                |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Fahrzeug angesteckt | ein Fahrzeug wird angesteckt, sobald evcc es erkennt (höchstens 2 Minuten)      | Ladepunkt, Fahrzeug                                                      |
| Fahrzeug abgesteckt | ein Fahrzeug wird abgesteckt                                                    | Ladepunkt, Fahrzeug, geladene Energie (kWh), angesteckt (Minuten)        |
| Laden gestartet     | ein Ladevorgang beginnt; eine kurze Pause (Wolken) ist kein neuer Ladevorgang   | Ladepunkt, Fahrzeug, Modus                                               |
| Laden beendet       | der Ladevorgang steht seit 10 Minuten still, oder das Fahrzeug wurde abgesteckt | Ladepunkt, Fahrzeug, Energie (kWh), Ladedauer (Minuten), Solaranteil (%) |
| Lademodus geändert  | der Modus eines Ladepunkts ändert sich, in evcc oder über Gladys                | Ladepunkt, neuer Modus, vorheriger Modus                                 |

In einer Nachricht schreibst du eine Variable als `{{triggerEvent.data.vehicle}}`,
`{{triggerEvent.data.energy_kwh}}`…

Jeder Auslöser lässt sich auf einen Ladepunkt und, außer der Modusänderung, auf ein Fahrzeug
beschränken. Die Modusänderung lässt sich auf einen Modus beschränken.

## Szenen-Aktionen

| Aktion               | Wirkung                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Lademodus einstellen | Aus, PV, Min + PV oder Schnell an einem Ladepunkt                                                            |
| Ladelimit einstellen | Batteriestand (%) eines Ladepunkts oder Fahrzeugs, oder Energie (kWh) eines Ladepunkts; 0 entfernt das Limit |

Eine abgelehnte Aktion (evcc nicht erreichbar, Wert außerhalb der Grenzen, ein Gerät, das kein
Ladepunkt ist) schlägt mit einer klaren Meldung fehl, und die Szene läuft weiter.

## Szenen-Beispiele

- **Abends schnell laden, wenn die Batterie leer ist**: um 21 Uhr, wenn der Batteriestand des
  Fahrzeugs unter 30 % liegt, den Modus des Ladepunkts auf Schnell stellen, dann das Limit auf 60 %.
- **Wissen, wann das Auto voll ist**: Auslöser „Laden beendet“ für dein Fahrzeug, Nachricht „Laden
  beendet: `{{triggerEvent.data.energy_kwh}}` kWh, `{{triggerEvent.data.solar_percent}}` % Solar“.
- **Beim Losfahren zurück auf PV**: Auslöser „Fahrzeug abgesteckt“, den Modus auf PV stellen, damit
  der nächste Ladevorgang wieder mit dem Überschuss beginnt.

## Fehlerbehebung

- **„evcc antwortet nicht unter der eingestellten Adresse“**: öffne die Adresse in einem Browser aus
  dem Netz von Gladys. Prüfe den Port (standardmäßig 7070) und dass keine Firewall Gladys blockiert.
- **„Die eingestellte Adresse antwortet nicht wie evcc“**: die Adresse zeigt auf einen anderen Dienst,
  oder ein Proxy liefert eine Fehlerseite.
- **„evcc verlangt sein Admin-Passwort“**: gib es in der Konfiguration ein.
- **Der Batteriestand eines Fahrzeugs ändert sich nicht**: evcc liest das Fahrzeug nur, solange es
  angesteckt ist (oder wenn es eine Hersteller-Integration hat). Der letzte Wert bleibt sichtbar.
- **„Fahrzeug angesteckt“ kommt ohne Fahrzeug**: evcc hat das Fahrzeug nicht innerhalb von 2 Minuten
  erkannt. Prüfe die Erkennung in evcc oder lege ein Standardfahrzeug für den Ladepunkt fest.
- **Ausführliche Protokolle**: füge dem Container die Variable `LOG_LEVEL=debug` hinzu.

## Einschränkungen

- Eine evcc-Instanz pro Installation der Integration.
- Ladepläne werden gelesen, aber nicht aus Gladys erstellt (nutze evcc).
- Wiederkehrende Pläne (jeden Wochentag) werden nicht angezeigt.
- Phasenanzahl, Mindest- und Maximalstrom, Hausbatterie und erweiterte Einstellungen bleiben in evcc.
- Ohne echte Wallbox entwickelt, gegen den Demo-Modus von evcc: Rückmeldungen im Gladys-Forum sind
  willkommen.
- Unabhängiges Projekt, nicht mit evcc verbunden.

---
layout: home

hero:
  name: werkbuch
  text: Projektmanagement zum Selbst-Hosten.
  tagline: Work Items mit eigenen Typen, Feldern und Workflows, ein Wiki pro Projekt und Views über alles hinweg. Gebaut für die Tastatur und offen für Skripte und KI-Agenten über eine REST-API, MCP und Webhooks.
  image:
    light:
      src: /screenshots/de/board.png
      width: 1440
      height: 900
    dark:
      src: /screenshots/de/board-dark.png
      width: 1440
      height: 900
    alt: Das Board eines Projekts, die Work Items in einer Spalte je Status
  actions:
    - theme: brand
      text: Einrichtung
      link: /de/setup
    - theme: alt
      text: GitHub
      link: https://github.com/baeroe/werkbuch

features:
  - title: Typen und Workflows
    details: Task, Bug, Kundenwunsch – du legst fest, welche Typen es gibt, welche Felder jeder hat und durch welche Status ein Item läuft. Wenn du willst, regelt eine Matrix, welche Wechsel erlaubt sind.
    link: /de/concepts/types-and-properties
    linkText: Typen und Properties
  - title: Views
    details: Filter über alle Projekte, gruppiert nach Status, Assignee oder Label, gespeichert fürs ganze Team. Als Liste, Board, Tabelle oder Timeline.
    link: /de/concepts/views
    linkText: Views
  - title: Wiki
    details: Jedes Projekt hat sein eigenes Wiki. Seiten im Baum, Versionen und Verweise auf Work Items und andere Seiten.
    link: /de/concepts/wiki
    linkText: Wiki
  - title: Vorlagen und Automatisierungen
    details: Wiederkehrende Arbeit kommt aus einer Vorlage mit Zeitplan. Automatisierungen erledigen den Kleinkram, etwa das Epic schließen, sobald sein letztes Kind fertig ist.
    link: /de/concepts/templates
    linkText: Vorlagen
  - title: Tastatur
    details: Fast alles hat ein Kürzel, und ⌘K findet den Rest – Items, Seiten, Projekte und jeden Befehl.
    link: /de/keyboard
    linkText: Tastatur
  - title: REST, MCP und Webhooks
    details: Alles, was die App kann, kann auch die REST-API. KI-Agenten arbeiten über MCP, und Webhooks sagen deinen anderen Tools, was passiert ist.
    link: /de/api
    linkText: REST-API
---

werkbuch ist Projektmanagement für Teams, die ihre Daten auf dem eigenen Server behalten wollen. Es läuft als Docker-Compose-Stack: ein Image, MariaDB und Meilisearch, ein Port. Die Oberfläche gibt es auf Deutsch und Englisch.

## Ein Blick hinein

Ein Work Item auf seiner eigenen Seite: Beschreibung, Felder, Relationen, die Wiki-Seiten, die es nennen, und die ganze History.

![Die Seite des Work Items WEB-47 mit Beschreibung, Feldern, Relationen und Aktivität](/screenshots/de/item.png)

⌘K sucht Work Items, Wiki-Seiten und Projekte auf einmal und führt jeden Befehl aus.

![Die Befehlspalette mit der Suche nach WEB: Work Items, Wiki-Seiten und das Projekt](/screenshots/de/palette.png)

Und dieselbe Seite im Dunkeln.

![Die Seite des Work Items WEB-47 im dunklen Thema](/screenshots/de/item-dark.png)

<SelfHost />

## Stand

v0.1.0 ist das erste Release: Das Image `baeroe/werkbuch` liegt auf Docker Hub für `linux/amd64` und `linux/arm64`, was sich geändert hat, steht unter [Releases](https://github.com/baeroe/werkbuch/releases). Wie werkbuch auf einem Server läuft, steht unter [Einrichtung](/de/setup), [Reverse Proxy](/de/reverse-proxy), [Betrieb](/de/operations), [Aktualisieren](/de/upgrading) und [Sicherung](/de/backup), die Arbeit am Code auf der [Entwicklungsseite](/de/development). Wie alles funktioniert, steht unter [Konzepte](/de/concepts/permissions).

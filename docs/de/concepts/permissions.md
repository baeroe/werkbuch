# Rollen und Rechte

werkbuch kennt zwei Arten von Rollen. Eine **Organisationsrolle** gilt überall, eine **Projektrolle** nur in einem Projekt. Die Rollen sind fest: Eigene Rollen gibt es nicht, und eine Gast-Rolle auch nicht. Wer von außen kommt, bekommt ein normales Konto.

## Organisationsrollen

| Recht | Admin | Member |
|---|---|---|
| Organisation, Personen, Bots und Webhooks verwalten | ✓ | – |
| Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten | ✓ | – |
| Alle Projekte sehen und verwalten, auch private | ✓ | – |
| Öffentliche Projekte sehen und beitreten | ✓ | ✓ |
| Projekte anlegen | ✓ | ✓ |
| Views anlegen | ✓ | ✓ |
| Fremde Views ändern und löschen | ✓ | – |
| Eigene Tokens | ✓ | ✓ |

## Projektrollen

| Recht | Admin | Member | Viewer |
|---|---|---|---|
| Items, Wiki und Vorlagen lesen | ✓ | ✓ | ✓ |
| Kommentieren, reagieren, beobachten | ✓ | ✓ | ✓ |
| Items anlegen, ändern und archivieren | ✓ | ✓ | – |
| Wiki bearbeiten, Vorlagen und Zeitpläne verwalten | ✓ | ✓ | – |
| Items löschen | ✓ | – | – |
| Projekteinstellungen, Mitglieder, Workflow, Typen, Automatisierungen | ✓ | – | – |
| Projekt archivieren und löschen | ✓ | – | – |

[Webhooks](/de/webhooks) lesen und verwalten nur Org-Admins, samt Zustellprotokoll und Test-Ping; ein Token des Standard-Bots darf es auch, denn der Standard-Bot ist Org-Admin. Ein Member bekommt `403`, nicht `404`: den Bereich der Einstellungen gibt es für jeden.

Im [Wiki](/de/concepts/wiki) lesen Viewer und Außenstehende eines öffentlichen Projekts die Seiten und ihre Versionen; Member und Admins legen Seiten an, bearbeiten, verschieben und löschen sie und stellen Versionen wieder her. In einem archivierten Projekt ist das Wiki für alle schreibgeschützt.

[Vorlagen](/de/concepts/templates) lesen alle, die das Projekt sehen, samt Protokoll; Member und Admins legen sie an, ändern, löschen und führen sie aus. [Automatisierungen](/de/concepts/automations) schalten nur Admins des Projekts; alle anderen, die das Projekt sehen, lesen sie.

## Org-Admins sind überall Admin

Ein Org-Admin hat in jedem Projekt die Rechte eines Projekt-Admins, ohne Mitglied zu sein. Das gilt auch für private und archivierte Projekte und für Projekte, denen sonst niemand beigetreten ist.

## Sichtbarkeit

- Ein **öffentliches** Projekt sehen alle in der Organisation.
- Ein **privates** Projekt sehen nur seine Mitglieder und Org-Admins.
- Ein Org-Member, der kein Mitglied eines öffentlichen Projekts ist, liest es mit den Rechten eines Viewers. Mit einem Klick auf **Beitreten** wird er Mitglied; er tritt immer als Member bei, nie als Admin.

Was jemand nicht sehen darf, gibt es für ihn nicht. Die Oberfläche antwortet auf ein verborgenes Projekt mit der Seite „nicht gefunden“, die REST-API mit `404`, nie mit `403`. Ein `404` kann also auch „für dich nicht sichtbar“ heißen. Nur ein Projekt, das du siehst, aber nicht ändern darfst, antwortet mit `403`.

## Project Lead

Jedes Projekt hat einen Lead. Der Lead ist eine aktive Person (kein Bot) und Mitglied des Projekts. Er bekommt alle Benachrichtigungen des Projekts und hat **keine zusätzlichen Rechte**: Was er darf, entscheidet seine Projektrolle, und die lässt sich wie jede andere ändern. Ein Lead lässt sich nicht aus dem Projekt entfernen; bestimme zuerst einen anderen Lead.

## Der letzte Admin

Der letzte aktive Org-Admin unter den Personen lässt sich weder herabstufen noch deaktivieren. Ohne ihn könnte niemand die Organisation mehr verwalten. Der Standard-Bot zählt dabei nicht: Er ist auch Admin, aber niemand meldet sich als Bot an. Hilft das nicht, weil du ausgesperrt bist, steht der Weg über die Kommandozeile unter [Passwort vergessen](/de/development#passwort-vergessen).

## Der Standard-Bot

Jede Organisation hat einen Standard-Bot, „Automation“. Automatisierungen und Zeitpläne von Vorlagen handeln in seinem Namen. Er ist Org-Admin, bleibt aktiv und behält die Admin-Rolle (das zu ändern wird abgelehnt). Umbenennen kannst du ihn. Siehe [Bots](/de/bots).

## Tokens

Ein Token handelt mit den Rechten seines Kontos, nie mit mehr. Dazu trägt es Fähigkeiten, die es weiter einschränken:

| Fähigkeit | Was sie erlaubt |
|---|---|
| `read` | `GET`- und `HEAD`-Anfragen und die Lesezugriffe, die ihre Frage im Body stellen: Items, Projekte und alles andere sehen; über MCP die lesenden Tools |
| `write` | alle anderen Anfragen: anlegen, ändern, kommentieren und löschen; über MCP die Tools `manage-…` und `get-upload-url` |
| `mcp` | den [MCP-Server](/de/mcp) aus einem MCP-Client nutzen; ohne `read` oder `write` sieht er kein Tool, nur die Referenzen. Eine Sitzung der Oberfläche erreicht den MCP-Server nie |

Ein Token ohne die Fähigkeit, die eine Anfrage braucht, bekommt `403`. Lege ein Token je Gerät oder Skript an und gib ihm nur, was es braucht.

## Nur aus der Oberfläche

Manches geht nur mit der Sitzung der angemeldeten Oberfläche, nicht mit einem Token, egal mit welchen Fähigkeiten:

- das eigene Passwort ändern sowie den zweiten Faktor einrichten und ausschalten (`/api/v1/me/…`),
- Tokens anlegen (`POST /api/v1/tokens`).

Ein Token, das es trotzdem versucht, bekommt `403` mit dem Grund `session_required`. Ein gestohlenes Token kann so weder das Konto übernehmen noch sich einen länger gültigen Nachfolger anlegen. Tokens auflisten und widerrufen geht mit einem Token.

Ähnlich ist es beim Einladungslink: Die Antwort auf `POST /api/v1/invitations` enthält ihn für die Oberfläche und für Tokens mit `write`; für ein Token, das nur lesen darf, ist er `null`, weil der Link ein neues Konto anlegt.

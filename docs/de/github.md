# GitHub

[Agenten](/de/concepts/agents) erreichen ihre Repos über GitHub-Apps, eine private App je GitHub-Konto: dein eigenes Konto, eine Organisation oder mehrere davon. Die App pusht und öffnet Pull Requests für die Agenten, nie eine Person; werkbuch schreibt mit ihr Reviews und Kommentare, liest die Checks und mergt, sobald CI grün ist und das Review keine Befunde hat. GitHub meldet werkbuch Pushes, Pull Requests und Checks über den Webhook der App.

Jede Instanz legt ihre eigenen Apps an: werkbuch ist selbst gehostet, eine gemeinsame App gibt es nicht. Nur GitHub.com; GitHub Enterprise Server, GitLab, Gitea, Forgejo und Bitbucket gehen nicht.

## Bevor du verbindest

- `APP_URL` muss für `POST /github/webhook` per HTTPS aus dem Internet erreichbar sein: Dorthin liefert GitHub seine Webhooks (siehe [den Webhook hinter dem Proxy](#der-webhook-hinter-dem-proxy)). Alles andere des Ablaufs läuft in deinem Browser.
- Du bist Owner der GitHub-Organisation, der die App gehören soll, oder sie gehört deinem eigenen Konto und du bist mit ihm bei GitHub angemeldet.
- Sichere `storage/app/.app-key` (siehe [Sicherung](/de/backup)): Er verschlüsselt die Private Keys und die Webhook-Secrets der Apps.

## Eine App je Konto

Eine private GitHub-App lässt sich nur auf dem Konto installieren, dem sie gehört. Darum hält werkbuch eine App je GitHub-Konto: Repos deines eigenen Kontos brauchen die App deines Kontos, Repos einer Organisation die App dieser Organisation. Jede App hat ihre eigenen Installationen, Tokens, ihr Webhook-Secret und ihr Bot-Konto (`<slug>[bot]`); ein Repo nutzt die App, deren Installation es erreicht. Ein Konto hat in einer Instanz höchstens eine App.

## Verbinden

1. **Einstellungen → GitHub → Mit GitHub verbinden** (Org-Admins), oder **Weitere App hinzufügen**, sobald die erste da ist. Wähle **Mein GitHub-Konto** oder **Eine GitHub-Organisation** und gib den Login ein. werkbuch schlägt den Login mit ` werkbuch` dahinter als Namen vor (Namen sind bei GitHub eindeutig; ändern kannst du ihn dort). Ein Konto, das seine App schon hat, wird abgelehnt.
2. GitHub zeigt die App mit Berechtigungen, Webhook-Adresse und Rückweg vorbelegt. Leg sie an. GitHub führt zurück zu werkbuch, das die App speichert (ID, Private Key und Webhook-Secret, verschlüsselt).
3. GitHub fragt, wo die App installiert wird: Wähl die Repos, an denen die Agenten arbeiten sollen. Es führt wieder zurück zu werkbuch.

Die Seite zeigt danach jede App mit ihren Installationen und ihren freigegebenen Repos, jeweils mit Projekt und ob ein Ruleset den Basis-Branch schützt. **Repos bei GitHub ändern** einer App nimmt ihre Repos bei GitHub dazu oder heraus; werkbuch hört es über den Webhook, und **Neu einlesen** holt die Listen aller Apps von Hand.

## Berechtigungen

| Berechtigung | Zugriff | Wofür |
|---|---|---|
| Contents | write | klonen, die Branches der Agenten pushen, mergen, gemergte Branches löschen |
| Pull requests | write | Pull Requests öffnen, Reviews und Kommentare schreiben, einen Entwurf bereit stellen |
| Checks | read | die Check-Runs eines Commits |
| Actions | read | Workflow-Läufe und das Log gescheiterter Checks |
| Commit statuses | read | Status, die eine CI ohne Check-Runs setzt |
| Metadata | read | verlangt GitHub immer |

Die App hört `pull_request`, `push`, `check_suite` und `check_run`, und GitHub schickt ihr immer die Ereignisse ihrer Installationen. Braucht eine neue Version von werkbuch eine Berechtigung, die eine bestehende App nicht hat, fügst du sie selbst hinzu: bei GitHub unter **Developer settings → GitHub Apps → \<App\> → Permissions & events**, dann nimmst du die neue Berechtigung auf jeder Installation der App an (GitHub fragt den Owner jeder Installation). Bis beides erledigt ist, lehnt GitHub jedes Token ab, das werkbuch mit der fehlenden Berechtigung anfragt: Lesen der CI und Merge scheitern.

## Tokens je Auftrag

werkbuch gibt den Private Key nie heraus. Jeder Auftrag bekommt ein Installations-Token für das eine Repo seines Projekts, eine Stunde gültig und vom Runner erneuert, solange der Auftrag läuft:

| Auftrag | Contents | Pull requests | Checks, Actions |
|---|---|---|---|
| Umsetzen, Korrektur, Konflikt | write | write | read |
| Review, Antwort | read | read | – |

Reviews und Antworten bekommen im Auftrag gar kein Token: Der Runner klont damit und gibt dem Agenten Diff und gescheiterte Checks als Dateien. Merges, Reviews, Kommentare an Pull Requests und das Lesen der Checks macht werkbuch selbst, mit eigenen Tokens.

## Ein Repo für ein Projekt

Jedes Projekt hat höchstens ein Repo, und ein Repo gehört höchstens einem Projekt. Projekt-Admins wählen es unter **Projekteinstellungen → Agenten** aus den Repos, auf denen die Apps installiert sind (nach App gruppiert):

- **Basis-Branch:** wohin Pull Requests gehen und worein werkbuch mergt; leer ist der Standard-Branch des Repos.
- **Merge-Methode:** Squash (Standard: ein Commit je Pull Request), Merge-Commit oder Rebase.
- **Kommentar am PR:** Bei einer neuen Verknüpfung schreibt die App einen Kommentar am Pull Request mit Links auf die Items und hält ihn aktuell (Standard an).
- **PRs von Personen reviewen:** siehe [Pull Requests von Personen](/de/concepts/agents#pull-requests-von-personen).

Ohne Repo arbeiten Agenten in einem eigenen Ordner und enden mit einer Zusammenfassung als Kommentar.

## Rulesets

Ein Ruleset auf dem Basis-Branch ist optional, und private Repos haben im kostenlosen Plan von GitHub keins. Wo du kannst, setz eins: Pull Request nötig, der CI-Check grün, ohne Bypass. werkbuch mergt über den Pull Request und braucht keinen Bypass. Verlange **keine** Freigabe: Die App kann ihren eigenen Pull Request nicht freigeben, und ihr Merge scheiterte. Die Seite der Instanz zeigt je Repo, ob ein Ruleset den Basis-Branch schützt, nur als Hinweis.

Mit oder ohne Ruleset beobachtet werkbuch den Basis-Branch, siehe [eigenmächtiger Merge](#eigenmachtiger-merge).

## Pull Requests verknüpfen

Ein Pull Request im Repo eines Projekts verknüpft sich mit den Items, die er nennt: in Titel, Beschreibung (nicht in Code) oder Branch-Namen. Es zählen nur Keys dieses Projekts, auch frühere Kennungen, groß oder klein:

| Im Pull Request | Wirkung |
|---|---|
| `fix`, `fixes`, `fixed`, `fixing`, `close`, `closes`, `closed`, `closing`, `resolve`, `resolves`, `resolved`, `resolving` vor Keys | verknüpft und schließt beim Merge |
| `ref`, `refs`, `references`, `part of`, `relates to`, `related to` vor Keys | verknüpft, schließt nie |
| ein Key ohne Wort, im Text oder im Branch-Namen | verknüpft, schließt nie |
| `skip` oder `ignore` vor Keys | nimmt die Verknüpfung zurück |

Ein Wort darf einen Doppelpunkt tragen, mehrere Keys trennen Komma oder `and`: `Fixes: WEB-12, WEB-13 and WEB-14`. Ein Key, der aus Titel, Beschreibung und Branch verschwindet, behält seine Verknüpfung; nur `skip` nimmt sie zurück. Pull Requests der Agenten tragen `Fixes <KEY>` und sind über ihren Strang ohnehin verknüpft.

Was eine Verknüpfung bewegt, legt der Workflow fest: [Schritte der Agenten](/de/concepts/workflows#schritte-der-agenten) und [Pull Requests](/de/concepts/workflows#pull-requests). Kurz: Ein Entwurf bewegt nichts; ein offener Pull Request bringt seine Items aus Backlog oder Unstarted auf **In Review**; in den Basis-Branch gemergt bringt er die Items, die er schließt, auf **Gemergt**, außer am Item ist noch ein anderer Pull Request offen. Der Abschnitt **Pull Requests** des Items zeigt jede Verknüpfung mit Zustand, den Checks des Head-Commits und dem Urteil des Reviews.

## Eigenmächtiger Merge

werkbuch kennt seine eigenen Merges. Pusht die App des Repos auf den Basis-Branch eines Projekts und erklärt das kein Merge von werkbuch (ein direkter Push oder ein Merge über die API mit dem Token eines Auftrags), dann

- pausiert werkbuch alle Stränge des Projekts und bricht ihre laufenden Aufträge ab,
- kommentiert an den Items, deren Aufträge gepusht haben, soweit es das erkennt,
- benachrichtigt die Org-Admins und zeigt ein Banner unter **Projekteinstellungen → Agenten**.

Ein Projekt-Admin prüft den Commit bei GitHub, nimmt ihn bei Bedarf zurück und wählt **Bestätigen und fortsetzen**; die Stränge gehen mit einer Korrektur weiter. Ein Ruleset (Pull Request nötig, ohne Bypass) hält solche Pushes vorher fern.

## Trennen

**Trennen** an einer App lässt werkbuch diese App vergessen: Die Projekte mit einem ihrer Repos verlieren es, ihre offenen Stränge pausieren, ihre laufenden und wartenden Aufträge werden abgebrochen; die anderen Apps und ihre Projekte bleiben, wie sie sind. Pull Requests und Branches bleiben bei GitHub, die App ebenso, bis du sie dort löschst (**Settings → Developer settings → GitHub Apps** des Kontos oder der Organisation). Um das Konto wieder zu verbinden, legst du eine neue App an. Hat ein Projekt sein Repo wieder, setzt **Weitermachen** an einem Item seinen Strang mit einer Korrektur fort.

## Der Webhook hinter dem Proxy

GitHub schickt jedes Ereignis als `POST APP_URL/github/webhook`:

- Er muss aus dem Internet erreichbar sein, auch wenn der Rest von werkbuch nur über ein VPN oder hinter einer Anmeldung des Proxys erreichbar ist. Lass diesen einen Pfad ohne zusätzliche Anmeldung durch. Er ist eine Adresse für alle Apps: werkbuch findet die App über `X-GitHub-Hook-Installation-Target-ID`, prüft die Signatur (`X-Hub-Signature-256`) mit dem Secret dieser App und antwortet `401` auf alles Unsignierte oder auf eine App, die es nicht kennt.
- Bodies reichen bis 25 MB. nginx im Image nimmt 32 MB; erlaube am Proxy mindestens so viel (`client_max_body_size 32m` bei nginx).
- Eine Adresse, die in einer Minute 60 unsignierte Anfragen schickt, bekommt `429`, bevor werkbuch den Body liest. GitHub selbst zählt nie mit.
- werkbuch antwortet sofort mit `202` und arbeitet die Zustellung in der Queue ab; eine Zustellung, die GitHub erneut schickt, zählt einmal.

GitHub hält die letzten Zustellungen der App mit ihren Antworten: **Settings → Developer settings → GitHub Apps → \<App\> → Advanced**. Dort schaust du zuerst, wenn nichts ankommt.

## Fehlersuche

- **„Das GitHub-Konto hat seine App schon“ nach dem Anlegen:** Du warst bei GitHub mit einem Konto angemeldet, das in werkbuch schon seine App hat (oder mit einem anderen als angegeben). GitHub hat die App trotzdem angelegt; werkbuch nennt ihren Slug. Lösche sie bei GitHub unter **Settings → Developer settings → GitHub Apps**, melde dich mit dem richtigen Konto an und verbinde erneut.
- **„GitHub hat beim Anlegen der App nicht geantwortet“:** Auf dem Rückweg von GitHub macht werkbuch aus dem Code, den GitHub schickt, die App und wartet darauf bis zu 30 Sekunden; GitHub beendet eine Anfrage selbst nach 10 Sekunden. Die Meldung kommt, wenn GitHub keine Antwort oder einen Serverfehler geschickt hat, meist, während GitHub Probleme hat (siehe [githubstatus.com](https://www.githubstatus.com)). Der Code gilt nur einmal: Verbinde GitHub gleich noch einmal. Hat GitHub die App trotzdem angelegt, nennt die Meldung sie (`<login> werkbuch` oder den Namen, den du bei GitHub vergeben hast) und verlinkt die Liste der Apps des Kontos, auch als Hinweis auf der GitHub-Seite; lösche sie dort vorher (warst du bei GitHub mit einem anderen Konto angemeldet, liegt die App unter diesem Konto). Hat GitHub die App angelegt, aber unvollständig geantwortet, sagt die Meldung das: Lösche sie bei GitHub und verbinde neu.
- **„Neu einlesen“ nennt ein Konto:** GitHub hat für die App dieses Kontos nicht geantwortet; die anderen Apps sind eingelesen. Prüf die App bei GitHub (ausgesetzt, gelöscht) und lies erneut ein.
- **Ein Repo fehlt in der Liste:** Unter **Repos bei GitHub ändern** hinzufügen, dann **Neu einlesen**.
- **Pull Requests verknüpfen sich nicht:** Der Key gehört zu einem anderen Projekt, steht nur in Code, oder die Zustellung kam nicht an (siehe die letzten Zustellungen).
- **CI wird nicht gesehen:** werkbuch liest Check-Runs, Workflow-Läufe von GitHub Actions und Commit-Status des Head-Commits. Eine CI, die keins der drei setzt, bleibt unsichtbar, und eine fehlende Berechtigung (siehe [Berechtigungen](#berechtigungen)) verbirgt, was sie abdeckt.
- **Der Merge scheitert:** Ein Ruleset verlangt eine Freigabe, oder der Basis-Branch ist weitergegangen und der Pull Request hat einen Konflikt (werkbuch startet dann einen Konflikt-Auftrag).

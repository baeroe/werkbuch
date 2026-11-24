## Ein Item umsetzen

1. Das Item über `werkbuch-run` lesen (Tool `work-items`, Aktion `get`, mit `lean: 0`), dazu seine Kommentare und die Wiki-Seiten, die es nennt. Nicht zurückfragen: was das Item offen lässt, in seinem Sinn entscheiden und in der Zusammenfassung sagen.
2. Im gegebenen Worktree auf seinem Branch arbeiten. `CLAUDE.md` bzw. `AGENTS.md` des Repos befolgen: Kommandos, Konventionen, Fallstricke.
3. Wo es passt, mit einem fehlschlagenden Test beginnen; die Änderung auf das beschränken, was das Item verlangt.
4. Die Tests und Prüfungen laufen lassen, die das Repo für die geänderten Teile nennt. Nichts Rotes pushen.
5. In kleinen Schritten mit klaren Nachrichten committen, den Branch pushen, den Pull Request in den Basis-Branch öffnen: Titel `<KEY>: <Titel des Items>`, im Body was sich geändert hat, wie es geprüft wurde und `Fixes <KEY>`.
6. Hat das Projekt die Property `resolution_proof`, sie am Item setzen (Tool `manage-work-items`, Aktion `update`, nur `values`): was vorher falsch war, was jetzt stimmt, wie es geprüft wurde, mindestens ein Bild über `get-upload-url`.

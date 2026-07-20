# TODO (Admin Import verbessern)

- [ ] Server: neuen Endpoint `/api/admin/tmdb-preview` implementieren (TMDB suchen + Trailer/Director extrahieren, aber **ohne** DB-Insert)
- [ ] Admin UI: separate Button „Preview“ + UI-Bereich für Treffer-Infos (Titel/Jahr/Director/Trailer-Flags)
- [ ] Admin UI: „Importieren“ Button nutzt die letzten Preview-Daten oder ruft Preview erneut ab, bevor importiert wird
- [ ] Admin UI: während Preview/Import Buttons deaktivieren + Fehlermeldungen anzeigen
- [ ] Optional: Vorschau zeigt „bereits vorhanden“ (title+year) damit Import abgelehnt/unterbrochen werden kann
- [ ] Test: mehrere Beispiele (mit year / ohne year / vorhandene Einträge)

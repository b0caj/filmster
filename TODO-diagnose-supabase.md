# TODO – Supabase „Limit“ Diagnose

- [ ] server.js: Supabase zusätzlich zur geladenen Liste eine Count/Range-Diagnose hinzufügen
  - [ ] exact count (falls möglich) und loggen
  - [ ] range(0,999) laden und loggen, ob es bei 1000 endet
  - [ ] range(1000,2000) laden und loggen, ob danach noch Zeilen existieren
- [ ] Server neu starten und Logs prüfen
- [ ] Ergebnis interpretieren:
  - [ ] count=1302 und range liefert trotzdem nur 1000 => es gibt serverseitige/response Limitierung
  - [ ] count=1000 => RLS/Rechte begrenzen Read
  - [ ] count=1302 aber range(1000,2000) leer => implizites Limit/Range-Problem


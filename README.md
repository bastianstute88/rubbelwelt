# 🌍 Rubbelwelt

Eine digitale Rubbel-Weltkarte: Die Welt ist grau. Halte ein Land ~1,5 Sekunden
gedrückt, um es freizuschalten – das Grau verschwindet und die Landesflagge leuchtet
durch die Grenzen. Warst du in der Hauptstadt, kommt ein Fahnenmast ins Land.

## Features
- 195 Länder, Flaggen leuchten durch die exakten Grenzen (Long-Press zum Freischalten)
- Hauptstädte als separates Sammel-Ziel (Fahnenmast im Land)
- „X % der Welt gesehen" (nur Länder) + Zähler für Länder & Hauptstädte
- Flaggen-Leiste unten (alle 195), Klick springt zum Land
- Detail-Panel mit Ortszeit und dynamischem „+/- Std zu deiner Zeit"
- Laptop: ganze Welt + Zoom/Pan · Handy: Start bei Deutschland
- Geräteübergreifender Sync über einen gemeinsamen Sync-Code (Supabase)

## Technik
- Reine statische Web-App (HTML/CSS/JS), keine Build-Kette nötig
- Karte: `d3-geo` + `topojson-client` (Natural-Earth-Projektion), Geometrie aus
  [world-atlas](https://github.com/topojson/world-atlas) (50m)
- Flaggen: [flagcdn.com](https://flagcdn.com)
- Länderdaten (deutsche Namen, Hauptstädte, Hauptstadt-Zeitzonen): via `build_data.py`
  aus [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database)
  + IANA-Zeitzonen → `data/countries.json`
- Sync: [Supabase](https://supabase.com) (Tabelle `boards`, adressiert über geheimen Sync-Code)

## Sync einrichten
1. Kostenloses Supabase-Projekt anlegen.
2. Im SQL-Editor `boards`-Tabelle + RLS-Policy anlegen (siehe unten).
3. `Project URL` und `anon public key` in `config.js` eintragen.
4. In der App auf ☁️ tippen und auf allen Geräten denselben Sync-Code eingeben.

```sql
create table if not exists boards (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table boards enable row level security;
create policy "anon_all" on boards for all to anon using (true) with check (true);
```

# 🌍 Rubbelwelt

Eine digitale Rubbel-Weltkarte für Reisende. Die Welt ist grau – halte ein Land
**~1,5 Sekunden gedrückt**, um es freizuschalten: Das Grau verschwindet und die
Landesflagge leuchtet durch die exakten Grenzen. Dazu sammelst du **Hauptstädte**,
**Extra-Gebiete** und **UNESCO-Welterbestätten**.

**Live:** https://bastianstute88.github.io/rubbelwelt/

## Features

- **195 Länder** freirubbeln (Long-Press) – die Flagge füllt das Land, pro Landmasse
  einzeln eingepasst (auch bei getrennten Teilen wie USA/Alaska oder Chile/Osterinsel).
- **Hauptstädte** als eigenes Sammel-Ziel: jede Hauptstadt ist als dezenter Punkt
  eingezeichnet und wird **golden**, sobald du dort warst.
- **✨ Extra-Gebiete** (27): bekannte Nicht-UN-Gebiete wie Taiwan, Kosovo, Grönland,
  Hongkong und die französischen Übersee-Départements – separat freirubbelbar und
  getrennt gezählt (nicht in den 195 %).
- **🏛️ UNESCO-Welterbe** (1121 Stätten): pro Land eine abhakbare Liste im Detail-Fenster
  (🏛️ Kultur / 🌿 Natur / 🏞️ gemischt) plus Karten-Marker, die beim Reinzoomen
  erscheinen (grau → golden bei Besuch).
- **Zähler oben:** „X % der Welt" (nur Länder) + separate Zähler für Hauptstädte,
  Extra-Gebiete und Welterbe.
- **Flaggen-Leiste** unten (alle Länder + Extra-Gebiete, alphabetisch), Suche & Filter,
  Klick springt zum Land.
- **Detail-Panel** mit Ortszeit und dynamischem „+/- Std zu deiner Zeit".
- **Kartenform-Umschalter** 🗺️/🌐: Globus-Look (Natural Earth) ↔ flache Karte
  (Equirectangular, volle Breite). Wahl pro Gerät gespeichert.
- **Geräteübergreifender Sync** über einen gemeinsamen Sync-Code (Supabase, Realtime).
- Laptop: ganze Welt + Zoom/Pan · Handy: Start bei Deutschland.

## Technik

Reine statische Web-App (HTML/CSS/JS), **keine Build-Kette** nötig – einfach über
GitHub Pages ausgeliefert.

- **Karte:** [`d3-geo`](https://github.com/d3/d3-geo) + [`topojson-client`](https://github.com/topojson/topojson-client),
  Geometrie aus [world-atlas](https://github.com/topojson/world-atlas) (50m).
- **Flaggen:** [flagcdn.com](https://flagcdn.com) (PNG für die Karten-Füllung – iOS-Safari
  rendert `<image>`+SVG mit „slice" nur teilweise).
- **Sync:** [Supabase](https://supabase.com), Tabelle `boards`, adressiert über einen
  geheimen Sync-Code.
- **Cache-Busting:** alle Assets sind mit `?v=N` versioniert (in `index.html` + `app.js`).
  Bei jeder Änderung `N` hochzählen, damit Browser die neue Version laden.

### Dateien

```
index.html · styles.css · app.js · sync.js · config.js   ← die App
data/countries.json        195 Länder (Name DE, Hauptstadt, HS-Zeitzone, HS-Koordinate)
data/territories.json      27 Extra-Gebiete
data/heritage.json         1121 UNESCO-Welterbestätten
data/countries-50m.json    Ländergeometrie (world-atlas 50m)
build_data.py              erzeugt data/countries.json
```

### Datenquellen / Aufbereitung

- **Länder** (`build_data.py` → `data/countries.json`): deutsche Namen aus
  [mledoze/countries](https://github.com/mledoze/countries), Zeitzonen/Region/Emoji aus
  [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database),
  Hauptstadt-Koordinaten aus [Natural Earth](https://github.com/nvkelso/natural-earth-vector)
  (`ne_110m_populated_places`). Mehrzonen-Länder bekommen explizit die Zeitzone ihrer
  Hauptstadt; veraltete Hauptstädte manuell korrigiert (Astana, Gitega, Dodoma …).
- **Welterbe** (`data/heritage.json`): offizielle UNESCO-Liste (1121 Stätten mit
  Kategorie, ISO-Code, Koordinaten). Quelle ist die offizielle UNESCO-XML, gespiegelt
  über [eprendergast/unesco-api](https://github.com/eprendergast/unesco-api)
  (`app/data/unesco.xml`), da UNESCO direkt hinter Cloudflare liegt.
- **Karten-Feinheiten** (in `app.js` zur Laufzeit): bei doppelten Natural-Earth-IDs
  gewinnt die größte Fläche (fixt fehlendes Australien); abtrünnige Gebiete werden ins
  Land verschmolzen (Somaliland→Somalia, Nordzypern→Zypern, Westsahara→Marokko,
  Siachen→Indien); französische Übersee-Départements werden aus dem Frankreich-Umriss
  herausgelöst.

## Sync einrichten

1. Kostenloses Supabase-Projekt anlegen.
2. Im SQL-Editor die `boards`-Tabelle + RLS-Policy anlegen (siehe unten).
3. `Project URL` und `publishable/anon key` in `config.js` eintragen.
4. In der App auf ☁️ tippen und auf allen Geräten **denselben Sync-Code** eingeben.

```sql
create table if not exists boards (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table boards enable row level security;
create policy "anon_all" on boards for all to anon using (true) with check (true);

-- Live-Aktualisierung zwischen Geräten (Realtime):
alter publication supabase_realtime add table boards;
```

Der Zustand (`{ visited, capitals, heritage }`) wird als ein JSON-Objekt pro Sync-Code
gespeichert; Sicherheit liegt im geheimen Code (der anon-Key ist öffentlich gedacht).

## Versionsverlauf

Die Karten-Assets sind mit `?v=N` versioniert; die Nummer entspricht den Einträgen hier.

| Version | Datum | Änderungen |
|--------:|-------|------------|
| **v17** | 2026-08-02 | Welterbe in der unteren Suche **durchsuchbar** (Treffer direkt abhakbar, mit Land) · 8 restliche englische Namen übersetzt (u. a. Freiheitsstatue). |
| **v16** | 2026-08-02 | Fix: **verwaiste Welterbe-Schlüssel** (vom alten ID-Schema) werden automatisch entfernt – Zähler stimmt wieder. |
| **v15** | 2026-08-02 | **Anklickbare Zähler-Chips**: Übersichts-Fenster pro Kategorie (Länder / Hauptstädte / Extra-Gebiete / Welterbe) mit Sprung zum Land · Fix: Flaggen-Filter „Besucht" scrollt jetzt. |
| **v14** | 2026-08-02 | Welterbe-Namen **komplett auf Deutsch** (966 aus Wikidata über die offizielle WHS-Nummer, 155 manuell) · Karte zeigt Welterbe nur noch **als gesehene goldene Trophäen** (kein grauer Punkte-Brei). |
| **v13** | 2026-08-02 | **UNESCO-Welterbe** (1121 Stätten): abhakbare Liste pro Land im Detail-Fenster, Karten-Marker, eigener Zähler, im Sync. |
| **v12** | 2026-08-02 | **Kartenform-Umschalter** 🗺️/🌐: Globus (Natural Earth) ↔ flache Karte (Equirectangular, volle Breite). Wahl pro Gerät gespeichert. |
| **v11** | 2026-08-02 | Hauptstadt-Punkte **dezenter** (kleiner, blasserer Rand); besuchte bleiben golden hervorgehoben. |
| **v10** | 2026-08-02 | Französische **Übersee-Départements** (Guayana, Guadeloupe, Martinique, Réunion, Mayotte) als eigene Extra-Gebiete abgetrennt · Extra-Gebiete **alphabetisch** sortiert · **Hauptstädte dauerhaft** als Punkt (dunkel → golden bei Besuch). |
| **v9** | 2026-08-02 | Hauptstadt-Punkte **konstant klein** beim Zoom (keine Riesenblasen mehr, z. B. Singapur) · Karten-Flaggen als **PNG** (behebt iOS-Safari-Halbfüllung). |
| **v8** | 2026-08-02 | Flagge **pro Landmasse** eingepasst → komplette, unverzerrte Flaggen auch bei getrennten Teilen (USA/Alaska, Chile/Osterinsel, Frankreich/Guayana). |
| **v7** | 2026-08-01 | Australien-Flagge: ferne Außeninseln nicht mehr einschmelzen (verzerrte Bounding-Box behoben). |
| **v6** | 2026-08-01 | **22 Extra-Gebiete** (Taiwan, Kosovo, Grönland, Hongkong …) freirubbelbar, separat gezählt · Detail-Flagge sauber gerahmt. |
| **v5** | 2026-08-01 | Territorien ins Land **verschmolzen** (Somaliland→Somalia, Nordzypern→Zypern, Westsahara→Marokko, Siachen→Indien) · dunkle „Nicht-Land"-Farbe abgeschwächt. |
| **v4** | 2026-08-01 | **Daten-Audit**: Hauptstädte korrigiert (Astana, Gitega, Dodoma, Ngerulmud, Porto-Novo, Bogotá, Andorra la Vella, Ulan-Bator) · Côte d'Ivoire → Elfenbeinküste. |
| **v3** | 2026-08-01 | **Cache-Busting** (`?v=N`) für alle Assets eingeführt – neue Versionen kommen sofort an. |
| _vor v3_ | 2026-08-01 | Australien-Geometrie-Fix (doppelte ID 036 → größte Fläche) · dezenter Hauptstadt-Punkt statt Fahnenmast · bessere deutsche Namen (Mexiko statt „Mexibr") · **Sync scharfgeschaltet** (Supabase-Zugang, supabase-js v2 / neue API-Keys) · README: Realtime ergänzt. |
| **v1** | 2026-08-01 | **Erstversion**: Rubbel-Weltkarte mit 195 Ländern, Long-Press-Freischalten, Flaggen durchleuchten, Hauptstädte, Zeitzonen, Flaggen-Leiste, %-Zähler, lokale Speicherung + Deploy auf GitHub Pages. |


#!/usr/bin/env python3
"""Baut die kompakte Laender-Datenbasis (data/countries.json).
Quellen:
  - mledoze.json         -> deutsche Laendernamen (translations.deu), UN-Mitgliedschaft
  - dr5hn.json           -> ISO/num, Zeitzonen, Region, Emoji, Laender-Centroid (Fallback)
  - ne_places.geojson    -> Hauptstadt-Name (EN) + exakte Koordinaten (Natural Earth)
  - zone1970.tab         -> (nur informativ)
"""
import json, re, os

dr = json.load(open('dr5hn.json'))
ml = json.load(open('mledoze.json'))
ne = json.load(open('ne_places.geojson'))

ml_by = {c['cca2']: c for c in ml}
un = {c['cca2'] for c in ml if c.get('unMember')} | {'VA', 'PS'}

# Natural-Earth-Hauptstaedte: ISO2 -> (name_en, lat, lng)
necaps = {}
for f in ne['features']:
    p = f['properties']
    if p.get('adm0cap') == 1:
        iso = (p.get('iso_a2') or '').upper()
        if iso and iso != '-99' and iso not in necaps:
            name = re.sub(r'\s+', ' ', p['name']).strip()
            necaps[iso] = (name, round(p['latitude'], 4), round(p['longitude'], 4))

# Hauptstaedte, die Natural Earth (110m) nicht hat
CAP_MANUAL = {
    'NR': ('Yaren', -0.5477, 166.9209),
    'PS': ('Ramallah', 31.9038, 35.2034),
    'SS': ('Juba', 4.8594, 31.5713),
}
# Erzwungene Hauptstadt (Name + Koordinaten) – korrigiert veraltete/falsche NE-Angaben
CAP_FORCE = {
    'ZA': ('Pretoria', -25.7069, 28.2294),        # statt Bloemfontein (Justiz-HS)
    'KZ': ('Astana', 51.1605, 71.4704),           # 2022 von Nur-Sultan zurueckbenannt
    'BI': ('Gitega', -3.4271, 29.9246),           # Hauptstadt seit 2019 (statt Bujumbura)
    'TZ': ('Dodoma', -6.1630, 35.7516),           # offizielle Hauptstadt (statt Dar es Salaam)
    'PW': ('Ngerulmud', 7.5006, 134.6242),        # Hauptstadt seit 2006 (statt Melekeok)
    'BJ': ('Porto-Novo', 6.4969, 2.6289),         # offizielle Hauptstadt (statt Cotonou)
    'AD': ('Andorra la Vella', 42.5063, 1.5218),  # voller Name
}

# Deutsche Hauptstadt-Namen (Exonyme), Schluessel = englischer NE-Name
CAP_DE = {
    'Rome': 'Rom', 'Lisbon': 'Lissabon', 'Prague': 'Prag', 'Moscow': 'Moskau', 'Beijing': 'Peking',
    'Athens': 'Athen', 'Warsaw': 'Warschau', 'Copenhagen': 'Kopenhagen', 'København': 'Kopenhagen',
    'Brussels': 'Brüssel', 'Vienna': 'Wien', 'Bucharest': 'Bukarest', 'Belgrade': 'Belgrad',
    'Cairo': 'Kairo', 'Damascus': 'Damaskus', 'Baghdad': 'Bagdad', 'Tehran': 'Teheran',
    'Riyadh': 'Riad', 'Algiers': 'Algier', 'Tripoli': 'Tripolis', 'Kyiv': 'Kiew', 'Kiev': 'Kiew',
    'Luxembourg': 'Luxemburg', 'Nicosia': 'Nikosia', 'Vatican City': 'Vatikanstadt', 'Havana': 'Havanna',
    'Mexico City': 'Mexiko-Stadt', 'Guatemala City': 'Guatemala-Stadt', 'Panama City': 'Panama-Stadt',
    'Washington, D.C.': 'Washington', 'Santiago': 'Santiago de Chile', 'New Delhi': 'Neu-Delhi',
    'Tokyo': 'Tokio', 'Pyongyang': 'Pjöngjang', 'Singapore': 'Singapur', 'Tashkent': 'Taschkent',
    'Bishkek': 'Bischkek', 'Dushanbe': 'Duschanbe', 'Ashgabat': 'Aschgabat', 'Yerevan': 'Eriwan',
    'Tbilisi': 'Tiflis', 'Muscat': 'Maskat', 'Kuwait City': 'Kuwait-Stadt', 'Addis Ababa': 'Addis Abeba',
    'Windhoek': 'Windhuk', 'Khartoum': 'Khartum', 'Djibouti': 'Dschibuti', 'Mogadishu': 'Mogadischu',
    'Bogota': 'Bogotá', 'Ulaanbaatar': 'Ulan-Bator',
}
# Deutsche Laendernamen-Praeferenzen (kuerzer/gebraeuchlicher als mledoze)
NAME_DE = {'US': 'USA', 'CD': 'DR Kongo', 'CG': 'Kongo', 'GB': 'Vereinigtes Königreich',
           'CI': 'Elfenbeinküste'}

# Hauptstadt-Zeitzone fuer Mehrzonen-Laender
TZ_OVERRIDE = {
    'AR': 'America/Argentina/Buenos_Aires', 'AU': 'Australia/Sydney', 'BR': 'America/Sao_Paulo',
    'CA': 'America/Toronto', 'CD': 'Africa/Kinshasa', 'CL': 'America/Santiago', 'CN': 'Asia/Shanghai',
    'CY': 'Asia/Nicosia', 'DE': 'Europe/Berlin', 'EC': 'America/Guayaquil', 'ES': 'Europe/Madrid',
    'FM': 'Pacific/Pohnpei', 'ID': 'Asia/Jakarta', 'KI': 'Pacific/Tarawa', 'KZ': 'Asia/Almaty',
    'MA': 'Africa/Casablanca', 'MH': 'Pacific/Majuro', 'MN': 'Asia/Ulaanbaatar', 'MX': 'America/Mexico_City',
    'MY': 'Asia/Kuala_Lumpur', 'NO': 'Europe/Oslo', 'NZ': 'Pacific/Auckland', 'PG': 'Pacific/Port_Moresby',
    'PS': 'Asia/Hebron', 'PT': 'Europe/Lisbon', 'RU': 'Europe/Moscow', 'UA': 'Europe/Kyiv',
    'US': 'America/New_York', 'UZ': 'Asia/Tashkent',
}

out = []
for c in dr:
    iso = c['iso2']
    if iso not in un:
        continue
    num = int(c['numeric_code']) if c.get('numeric_code') else None
    mlc = ml_by.get(iso, {})
    deu = (mlc.get('translations', {}) or {}).get('deu', {}).get('common')
    name = NAME_DE.get(iso) or deu or (c.get('translations', {}) or {}).get('de') or c['name']

    cap_info = CAP_FORCE.get(iso.upper()) or necaps.get(iso.upper()) or CAP_MANUAL.get(iso.upper())
    if cap_info:
        cap_en, clat, clng = cap_info
    else:
        cap_en, clat, clng = (c.get('capital') or ''), None, None
    capital = CAP_DE.get(cap_en, cap_en)

    tzs = c.get('timezones') or []
    tz = TZ_OVERRIDE.get(iso) or (tzs[0]['zoneName'] if tzs else 'UTC')
    try:
        lat = float(c['latitude']); lng = float(c['longitude'])
    except (TypeError, ValueError):
        lat = lng = None
    if clat is None:  # Hauptstadt-Koordinate fehlt -> Laender-Centroid
        clat, clng = lat, lng

    out.append({
        'num': num, 'iso2': iso.lower(), 'name': name, 'capital': capital,
        'tz': tz, 'lat': lat, 'lng': lng, 'clat': clat, 'clng': clng,
        'region': c.get('region') or '', 'emoji': c.get('emoji') or '',
    })

out.sort(key=lambda x: x['name'].lower())
os.makedirs('data', exist_ok=True)
json.dump(out, open('data/countries.json', 'w'), ensure_ascii=False, separators=(',', ':'))

print('Laender:', len(out), '| Bytes:', os.path.getsize('data/countries.json'))
print('ohne Hauptstadt-Koordinate:', [c['iso2'] for c in out if c['clat'] is None])
for iso in ['mx', 'my', 'us', 'de', 'gr', 'za', 'kr', 'gb', 'cd']:
    c = [x for x in out if x['iso2'] == iso][0]
    print(f"  {iso}: {c['name']:<22} HS {c['capital']:<16} @ {c['clat']},{c['clng']}")

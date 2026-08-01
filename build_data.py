#!/usr/bin/env python3
"""Baut die kompakte Laender-Datenbasis (data/countries.json) aus dr5hn + mledoze."""
import json, os

dr = json.load(open('dr5hn.json'))
ml = json.load(open('mledoze.json'))

# UN-Mitglieder + Beobachter (Vatikan, Palaestina) = die "offiziellen" Laender
un = {c['cca2'] for c in ml if c.get('unMember')}
official = un | {'VA', 'PS'}

# Deutsche Hauptstadt-Namen (Exonyme) fuer die wichtigsten Faelle
CAP_DE = {
    'Rome':'Rom','Lisbon':'Lissabon','Prague':'Prag','Moscow':'Moskau','Beijing':'Peking',
    'Athens':'Athen','Warsaw':'Warschau','Copenhagen':'Kopenhagen','Brussels':'Bruessel',
    'Vienna':'Wien','Bucharest':'Bukarest','Belgrade':'Belgrad','Cairo':'Kairo',
    'Damascus':'Damaskus','Baghdad':'Bagdad','Tehran':'Teheran','Riyadh':'Riad',
    'Algiers':'Algier','Tripoli':'Tripolis','Kyiv':'Kiew','Kiev':'Kiew','Luxembourg':'Luxemburg',
    'Reykjavik':'Reykjavik','Nicosia':'Nikosia','Vatican City':'Vatikanstadt','Havana':'Havanna',
    'Mexico City':'Mexiko-Stadt','Guatemala City':'Guatemala-Stadt','Panama City':'Panama-Stadt',
    'Bogota':'Bogota','Santiago':'Santiago de Chile','Brasilia':'Brasilia','Asuncion':'Asuncion',
    'New Delhi':'Neu-Delhi','Tokyo':'Tokio','Pyongyang':'Pjoengjang','Singapore':'Singapur',
    'Tashkent':'Taschkent','Bishkek':'Bischkek','Dushanbe':'Duschanbe','Ashgabat':'Aschgabat',
    'Yerevan':'Eriwan','Tbilisi':'Tiflis','Sanaa':"Sanaa",'Muscat':'Maskat','Kuwait City':'Kuwait-Stadt',
    'Addis Ababa':'Addis Abeba','Windhoek':'Windhuk','Yaounde':'Jaunde','Lome':'Lome',
    'Khartoum':'Khartum','Djibouti':'Dschibuti','Mogadishu':'Mogadischu','Sao Tome':'Sao Tome',
}
# Hauptstadt-Zeitzone fuer Mehrzonen-Laender (dr5hn[0] ist dort oft eine Nebenzone)
TZ_OVERRIDE = {
    'AR':'America/Argentina/Buenos_Aires','AU':'Australia/Sydney','BR':'America/Sao_Paulo',
    'CA':'America/Toronto','CD':'Africa/Kinshasa','CL':'America/Santiago','CN':'Asia/Shanghai',
    'CY':'Asia/Nicosia','DE':'Europe/Berlin','EC':'America/Guayaquil','ES':'Europe/Madrid',
    'FM':'Pacific/Pohnpei','ID':'Asia/Jakarta','KI':'Pacific/Tarawa','KZ':'Asia/Almaty',
    'MA':'Africa/Casablanca','MH':'Pacific/Majuro','MN':'Asia/Ulaanbaatar','MX':'America/Mexico_City',
    'MY':'Asia/Kuala_Lumpur','NO':'Europe/Oslo','NZ':'Pacific/Auckland','PG':'Pacific/Port_Moresby',
    'PS':'Asia/Hebron','PT':'Europe/Lisbon','RU':'Europe/Moscow','UA':'Europe/Kyiv',
    'US':'America/New_York','UZ':'Asia/Tashkent',
}
# Deutsche Laendernamen-Korrekturen (kuerzer/gebraeuchlicher)
NAME_DE = {
    'CZ':'Tschechien','US':'USA','GB':'Vereinigtes Koenigreich','AE':'Vereinigte Arabische Emirate',
    'KR':'Suedkorea','KP':'Nordkorea','CD':'DR Kongo','CG':'Kongo','VA':'Vatikan',
    'VE':'Venezuela','BO':'Bolivien','TZ':'Tansania','SY':'Syrien','MK':'Nordmazedonien',
}

by_num = {}
out = []
skipped = []
for c in dr:
    iso2 = c['iso2']
    if iso2 not in official:
        continue
    num = int(c['numeric_code']) if c.get('numeric_code') else None
    name_de = NAME_DE.get(iso2) or (c.get('translations',{}) or {}).get('de') or c['name']
    cap_en = c.get('capital') or ''
    cap = CAP_DE.get(cap_en, cap_en)
    tzs = c.get('timezones') or []
    tz = TZ_OVERRIDE.get(iso2) or (tzs[0]['zoneName'] if tzs else 'UTC')
    try:
        lat = float(c['latitude']); lng = float(c['longitude'])
    except (TypeError, ValueError):
        lat = lng = None
    out.append({
        'num': num,
        'iso2': iso2.lower(),
        'name': name_de,
        'capital': cap,
        'tz': tz,
        'lat': lat,
        'lng': lng,
        'region': c.get('region') or '',
        'emoji': c.get('emoji') or '',
    })

out.sort(key=lambda x: x['name'].lower())
os.makedirs('data', exist_ok=True)
json.dump(out, open('data/countries.json','w'), ensure_ascii=False, separators=(',',':'))

print('Laender geschrieben:', len(out))
# Kontrolle: welche offiziellen fehlen in dr5hn?
have = {c['iso2'].upper() for c in out}
missing = official - have
print('Fehlend (in official, nicht in dr5hn):', sorted(missing))
# Kontrolle: wie viele haben eine gueltige num (fuer Karten-Matching)?
print('mit num:', sum(1 for c in out if c['num']))
print('ohne latlng:', [c['iso2'] for c in out if c['lat'] is None])
# Beispiele
for iso in ['de','gr','pt','jp','us']:
    c=[x for x in out if x['iso2']==iso][0]
    print(c['name'],'|',c['capital'],'|',c['tz'],'|',c['num'])

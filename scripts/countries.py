"""Country lookup for driver flags: ISO 3166 alpha-2 from an alpha-3/IOC/FIFA code, a country name or a nationality.

Used by update_motorsports.py: Jolpica gives nationalities ("Dutch"), NASCAR gives country names ("United States"),
and Wikipedia's {{flagicon|…}} uses three-letter codes (IOC style, e.g. GER, NED, SUI) or names.
"""

import re

# alpha-2 | codes (alpha-3, IOC, FIFA) | names | nationalities
_TABLE = """
ae|ARE,UAE|United Arab Emirates,UAE|Emirati
ar|ARG|Argentina|Argentine,Argentinian
at|AUT|Austria|Austrian
au|AUS|Australia|Australian
be|BEL|Belgium|Belgian
bg|BGR,BUL|Bulgaria|Bulgarian
bh|BHR,BRN|Bahrain|Bahraini
br|BRA|Brazil|Brazilian
ca|CAN|Canada|Canadian
ch|CHE,SUI|Switzerland|Swiss
cl|CHL,CHI|Chile|Chilean
cn|CHN|China|Chinese
co|COL|Colombia|Colombian
cr|CRI,CRC|Costa Rica|Costa Rican
cz|CZE|Czech Republic,Czechia|Czech
de|DEU,GER,FRG,GDR|Germany,West Germany,East Germany|German,East German,West German
dk|DNK,DEN|Denmark|Danish
ec|ECU|Ecuador|Ecuadorian
ee|EST|Estonia|Estonian
es|ESP|Spain|Spanish
fi|FIN|Finland|Finnish
fr|FRA|France|French
gb|GBR,ENG,SCO,WAL,NIR,UK|United Kingdom,Great Britain,Britain,England,Scotland,Wales,Northern Ireland|British,English,Scottish,Welsh
gr|GRC,GRE|Greece|Greek
gt|GTM,GUA|Guatemala|Guatemalan
hk|HKG|Hong Kong|Hong Konger,Hongkonger
hr|HRV,CRO|Croatia|Croatian
hu|HUN|Hungary|Hungarian
id|IDN,INA|Indonesia|Indonesian
ie|IRL|Ireland,Republic of Ireland|Irish
il|ISR|Israel|Israeli
in|IND|India|Indian
it|ITA|Italy|Italian
jp|JPN|Japan|Japanese
kr|KOR|South Korea,Korea|South Korean,Korean
kw|KWT,KUW|Kuwait|Kuwaiti
li|LIE|Liechtenstein|Liechtensteiner
lt|LTU|Lithuania|Lithuanian
lu|LUX|Luxembourg|Luxembourgish,Luxembourger
lv|LVA,LAT|Latvia|Latvian
ma|MAR|Morocco|Moroccan
mc|MCO,MON|Monaco|Monegasque,Monacan
mo|MAC|Macau,Macao|Macanese
mx|MEX|Mexico|Mexican
my|MYS,MAS|Malaysia|Malaysian
nl|NLD,NED|Netherlands,Holland|Dutch
no|NOR|Norway|Norwegian
nz|NZL|New Zealand|New Zealander,New Zealand
om|OMN,OMA|Oman|Omani
pe|PER|Peru|Peruvian
ph|PHL,PHI|Philippines|Filipino
pl|POL|Poland|Polish
pt|PRT,POR|Portugal|Portuguese
py|PRY,PAR|Paraguay|Paraguayan
qa|QAT|Qatar|Qatari
ro|ROU,ROM|Romania|Romanian
rs|SRB|Serbia|Serbian
ru|RUS|Russia|Russian
sa|SAU,KSA|Saudi Arabia|Saudi,Saudi Arabian
se|SWE|Sweden|Swedish
sg|SGP,SIN|Singapore|Singaporean
si|SVN,SLO|Slovenia|Slovenian
sk|SVK|Slovakia|Slovak,Slovakian
th|THA|Thailand|Thai
tr|TUR|Turkey,Türkiye|Turkish
tw|TWN,TPE|Taiwan,Chinese Taipei|Taiwanese
ua|UKR|Ukraine|Ukrainian
us|USA,US|United States,United States of America,USA|American
uy|URY,URU|Uruguay|Uruguayan
ve|VEN|Venezuela|Venezuelan
za|ZAF,RSA|South Africa|South African
zw|ZWE,ZIM,RHO|Zimbabwe,Rhodesia|Zimbabwean,Rhodesian
"""

LOOKUP = {}
for _line in _TABLE.strip().splitlines():
    _code, _codes, _names, _people = _line.split("|")
    for _key in [_code, *_codes.split(","), *_names.split(","), *_people.split(",")]:
        LOOKUP[_key.strip().lower()] = _code


def country_code(value):
    """'Dutch', 'NED', 'Netherlands', 'nl' → 'nl'; '' when unknown."""
    text = re.sub(r"\s+", " ", str(value or "")).strip().lower()
    return LOOKUP.get(text, "")

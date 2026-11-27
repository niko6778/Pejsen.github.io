# Raid Roster

Din egen raid-planlægger: importér tilmeldinger fra Raid-Helper, sæt rosters, tjek buffs og følg fremmøde.

## Filer

| Fil | Indhold |
|---|---|
| `index.html` | Sidens skelet: topbar, faner og pladsen hvor indholdet tegnes |
| `style.css` | Udseendet: farver, lyst/mørkt tema, layout |
| `app.js` | Al logikken. Filen er delt i 7 nummererede afsnit med kommentarer |

Gode steder at starte, hvis du vil ændre noget:
- **Klasser og specs:** `CLASSES` øverst i `app.js`
- **Raid-størrelser, buffs og reset-dag:** `DEFAULT_SETTINGS` i `app.js`. De fleste af dem kan du også rette under *Indstillinger* på siden.
- **Auto-fyld:** funktionen `autofill()` i `app.js`
- **Farver:** variablerne øverst i `style.css`

## Brug den lokalt

Dobbeltklik på `index.html`, så åbner den i din browser. Der skal ikke installeres noget.

Dine data gemmes i browseren (localStorage). Under **Indstillinger → Download backup** kan du tage en backup og flytte data mellem computere.

## Import fra Raid-Helper

1. Klik **Importér fra Raid-Helper**.
2. Indsæt event-linket eller event-ID'et (i Discord: højreklik på eventet → *Kopiér ID*).
3. Hvis den ikke kan hente eventet direkte, får du et link. Åbn det, tryk Ctrl+A og Ctrl+C, og indsæt teksten i feltet.
4. Vælg om tilmeldingerne skal blive til et nyt raid eller opdatere et eksisterende raid. Ugen vælges automatisk ud fra eventets dato.

Importerer du det samme event igen senere, opdateres tilmeldingerne, og dit roster bliver liggende. Spillere der har meldt fra, bliver markeret med rødt.

## Læg den online gratis med GitHub Pages

1. Opret en gratis konto på https://github.com.
2. Klik **New repository**, kald det fx `raid-roster`, og vælg **Public**.
3. Klik **uploading an existing file**, træk de tre filer (`index.html`, `style.css`, `app.js`) ind, og klik **Commit changes**.
4. Gå til **Settings → Pages**, og vælg *Branch: main* og */ (root)*. Klik **Save**.
5. Efter et minut eller to ligger siden på `https://<dit-brugernavn>.github.io/raid-roster/`.

Når du har ændret i filerne, uploader du dem igen på samme måde. Siden opdateres af sig selv.

Bemærk: Data følger browseren og ikke adressen. Data fra den lokale fil kommer altså ikke automatisk med over på GitHub-siden. Brug backup/indlæs til at flytte dem.

## Programmér videre med Claude Code

Læg mappen et fast sted på din computer, og åbn den i **Code**-fanen i Claude-appen. Så kan du skrive fx *"tilføj en kolonne til loot-prio på Spillere-siden"*.

# Speluppgift

Ett litet webbspel för gymnasiets grafiska design: spelet är färdigprogrammerat,
eleverna ritar all grafik. Ingen bygg-kedja, inga beroenden — bara HTML, CSS och
vanlig JavaScript.

## Kom igång

```bash
node server.js          # eller: npm start
```

Öppna sedan <http://localhost:5173/home>.

Går det inte att köra Node? Vilken enkel statisk server som helst duger, t.ex.
`python3 -m http.server 5173`. Man kan också öppna `index.html` direkt från
disken — då byter appen automatiskt till adresser med `#`
(`index.html#/game`). Vissa webbläsare blockerar sparning i det läget, så en
lokal server är att föredra.

## De tre sidorna

| Sida | Innehåll |
| --- | --- |
| `/home` | Startsida med knappen **Öppna spelet** och projektbeskrivningen. |
| `/game` | Själva spelet. |
| `/editor` | Rita om spelets sprites. |

### `/home`

Projektbeskrivningen är ett dokument i stil med Google Docs. Den är låst för
läsning tills man klickar **Redigera** och anger lösenordet:

```
Jens123
```

Lösenordet ligger öppet i `js/page-home.js` — det är bara till för att eleverna
inte ska ändra texten av misstag. Byt det där om du vill.

I redigeringsläget finns en verktygsrad (rubrik, fet, kursiv, listor …) och allt
sparas automatiskt medan du skriver.

### `/game`

Flappy-bird-liknande: spelaren faller hela tiden och **mellanslag** (eller ett
klick/tapp i spelytan) ger en knuff uppåt.

* **Poäng** visas uppe till vänster, **liven** i rad direkt till höger om dem.
* Tre liv. Nuddar man **Aj** blinkar spelaren och ett liv försvinner. Samma sak
  om man slår i golvet — då studsar spelaren upp igen.
* Efter en träff är spelaren osårbar i 1,5 sekunder, så man inte tappar flera liv
  på samma hinder.
* När sista livet är slut slutar mellanslag att fungera, spelaren faller ur
  spelytan och **game over**-kortet dyker upp med **Starta om** och
  **Redigera sprites**.
* **Redigera sprites** (finns även som **Storlekar** i sidhuvudet) visar alla
  sprites och låter dig ändra bredd och höjd på var och en. Här skalas hela
  spriten — bilden följer med. Bakgrundens mått är låsta.
* `Esc` pausar. Byter man flik pausas spelet automatiskt.

Bakgrunden är alltid 3× så bred som spelytan (2700 × 540 px) och rullar från
höger till vänster i en oändlig loop.

### `/editor`

Till vänster ligger alla fem sprites som miniatyrer — **Spelare**, **Aj**,
**Poäng**, **Liv** och **Bakgrund**. Klicka på en för att öppna den.

Varje sprite byggs av en eller flera **bildrutor**:

* Dra en bildfil till rutan, eller klicka för att välja fil. Ctrl/⌘+V funkar
  också.
* **+** lägger till en ny bildruta. Huvudytan blir då sidledsrullande.
* Två eller fler bildrutor spelas upp som en animation i **3 bilder per sekund**
  — både i editorn och i spelet.
* **×** tömmer bildrutan. Klickar man på **×** i en redan tom ruta tas rutan bort
  helt (den sista rutan blir alltid kvar).
* Drar man in flera filer samtidigt hamnar den första i rutan och resten läggs
  till som nya bildrutor — snabbaste sättet att göra en animation.
* En **animerad GIF** spelas upp med sin egen hastighet, både i editorn och i
  spelet. Den kan kombineras med fler bildrutor.

Varje bildruta visar spriten som en **ruta** — exakt det som ritas i spelet,
och samma ruta som används för träffar:

* **Bilden** flyttas genom att man drar i den och ändrar storlek med hörnen
  (proportionerna behålls; håll **Shift** för fri form). Den fäster mot mitten
  och kanterna (håll **Alt** för att slippa). Det som hamnar utanför rutan
  syns blekt och klipps bort i spelet. Med tangentbordet: piltangenter flyttar,
  `+`/`−` ändrar storlek, `0` passar in.
* **Passa in** visar hela bilden centrerad (så hamnar nya bilder), **Fyll ut**
  låter bilden täcka hela rutan.
* **Rutan** ändras med de orange handtagen på sidorna — den behöver alltså inte
  vara kvadratisk. Det ändrar spritens bredd och höjd i spelet (8–320 px).
  Bilderna behåller sin storlek och sin plats i förhållande till mitten.
  Bakgrundens ruta är låst.

Standardgrafiken är enkla färgrutor med spritens namn på. **Återställ till
standard** tar tillbaka dem.

## Bildfiler

PNG med genomskinlig bakgrund fungerar bäst. JPG, GIF och SVG går också.

Bilderna skalas ned innan de sparas (längsta sidan 512 px, 1600 px för
bakgrunden) eftersom localStorage bara rymmer några megabyte. SVG sparas i
original om filen är liten, så den är skarp i alla storlekar.

Animerade GIF:ar sparas som GIF och fortsätter animera. Är filen större än
ca 650 kB (eller bilden större än gränsen ovan) packas den om: den skalas ned
tills den får plats, och bara om den då skulle bli väldigt liten tas varannan
bildruta bort. Spelets canvas kan bara rita en GIF:s första bild, så
`js/gif.js` avkodar GIF:en och spelet väljer rätt bild efter GIF:ens egen
tidtabell.

## Var sparas allt?

Allt — bilder, bildernas placering, storlekar, projektbeskrivning och rekord —
ligger i webbläsarens `localStorage` under nyckeln `speluppgift.v1`, och skrivs
direkt när något ändras. (Äldre sparad data, där bildrutorna bara var bilder,
läses in automatiskt.) Det betyder att varje dator (och varje webbläsare) har sin egen
uppsättning grafik. Har du editorn öppen i en flik och spelet i en annan
uppdateras spelet automatiskt.

Nollställa allt:

```js
localStorage.removeItem('speluppgift.v1')   // i webbläsarens konsol
```

## Publicera

Alla filer är statiska, så vilken webbhotell/GitHub Pages som helst fungerar.
`404.html` är en kopia av `index.html` så att `/game` och `/editor` fungerar även
som direktlänkar på GitHub Pages. Appen räknar själv ut sin bassökväg och
fungerar därför både på domänroten och i en undermapp.

## Filer

```
index.html          sidskal
404.html            kopia av index.html (SPA-fallback för GitHub Pages)
server.js           liten statisk server utan beroenden
css/style.css       hela formgivningen
js/store.js         all sparad data + standardgrafiken
js/gif.js           avkodar/kodar GIF:ar (för animation i spelet och ompackning)
js/sprites.js       bildcache, GIF-uppspelning, 3 fps-klockan, förhandsvisningar, filinläsning
js/ui.js            DOM-hjälpare, modaler, notiser
js/router.js        /home, /game, /editor
js/page-home.js     startsida + dokumentet
js/page-game.js     spelmotorn
js/page-editor.js   sprite-editorn
```

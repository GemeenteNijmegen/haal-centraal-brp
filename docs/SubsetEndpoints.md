# Subset Endpoints

## Waarom subset endpoints?

De reguliere Haal Centraal personen API werkt met POST verzoeken. Sommige applicaties kunnen echter geen POST berichten versturen, maar wel GET verzoeken doen met een BSN in de header. Voor deze applicaties zijn subset endpoints beschikbaar.

Daarnaast kunnen niet alle applicaties omgaan met de ruwe data uit Haal Centraal. De subset endpoints leveren verwerkte, geminimaliseerde data die direct bruikbaar is. Dit maakt aansluiting mogelijk voor applicaties met beperkte mogelijkheden voor dataverwerking.

Let op: ten alle tijden wordt aangeraden om de reguliere Personen API met de POST aan te roepen, tenzij het echt niet anders kan.

## Beschikbare endpoints

Er zijn drie subset endpoints beschikbaar:

### Leeftijd
Geeft de leeftijd van een persoon terug.

**Endpoint:** `https://{{baseUrl}}/personen/burgerservicenummer/leeftijd/`

**Response voorbeeld:**

```
{
  "leeftijd": 77
}
```

Als er geen geboortedatum beschikbaar is, wordt een leeg object teruggegeven: `{}`

### Nederlands
Controleert of een persoon de Nederlandse nationaliteit heeft.

**Endpoint:** `https://{{baseUrl}}/personen/burgerservicenummer/nederlands/`

**Response voorbeeld:**
```
{
  "nederlands": true
}
```


Let op: een `false` betekent niet dat iemand geen Nederlandse nationaliteit heeft, maar dat dit niet geverifieerd kon worden uit de BRP data. 

### Kinderen en partners
Controleert of een persoon kinderen en/of partners heeft.

**Endpoint:** `https://{{baseUrl}}/personen/burgerservicenummer/kinderen-partners/`

**Response voorbeeld:**
```
{
  "kinderen": true,
  "partners": false
}
```


## Gebruik van subset endpoints

### Request opzet
Alle subset endpoints gebruiken dezelfde authenticatie en headers:

**Method:** GET  
**Headers:**
- `X-API-KEY`: je API sleutel
- `x-bsn`: het burgerservicenummer

**Voorbeeld request:**
```
GET https://{{baseURL}}/personen/burgerservicenummer/leeftijd/ 
Headers:
  X-API-KEY: jouw-api-key
  x-bsn: 999999990
```

### Authenticatie en rechten
De subset endpoints gebruiken dezelfde authenticatie als de reguliere personen API:
- mTLS met publiek certificaat
- API sleutel in de header

Ook de rechten zijn gelijk aan de reguliere personen API. De velden die een applicatie mag opvragen worden bepaald via de fields configuratie in DynamoDB. Er is geen aparte configuratie nodig voor subset endpoints.

### Aansluiten applicatie
Het aansluiten van een applicatie voor subset endpoints werkt hetzelfde als voor de reguliere personen API. Volg de stappen in [Aansluiten nieuwe applicatie](./AansluitenApplicatie.md). Als je al aangesloten bent hoeft dit niet apart voor de subsets. De juiste rechten zijn wel benodigd. Doelbinding is hier dus ook van belang.

## Technische werking
De subset endpoints halen alleen de minimaal benodigde velden op uit Haal Centraal en verwerken deze tot een eenvoudig antwoord. Dit zorgt voor:
- Minimale dataverzameling (privacy)
- Directe bruikbaarheid voor applicaties die niet de logica kunnen implementeren

Voor developers kan in de development omgeving gebruik gemaakt worden van enkele aanroepen in Postman.
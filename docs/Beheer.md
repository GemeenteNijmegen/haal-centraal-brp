# Informatie over het beheer van Haal Centraal BRP

Stappen:
1. Genereren API sleutel
2. Inrichten velden
3. Inladen certificate (chain)

## Genereren API sleutel
Bij een aanvraag van een API sleutel door de applicatie is het de taak aan de beheerder om in de API gateway (van gn-haal-centraal-brp-prod, met naam 'api') een nieuwe sleutel te genereren. Als 'name' wordt de naam van de applicatie gebruikt.

Create API key:
- Name: naam van applicatie
- API key: Auto generate

De API sleutel wordt ook gebruikt als ID van de nieuwe applicatie in de velden opslag (dynamodb).

Koppel de API key vervolgens aan de usage plan.

## Inrichten velden
De velden die een applicatie mag uitvragen bij de BRP worden als een set opgeslagen in een dynamoDB tabel. In deze tabel staat het ID van de applicatie en een lijst met velden specifiek voor de desbetreffende applicatie.

De beheerder voegt een nieuw item toe aan de dynamoDb tabel (haalcentraalbrp-api-stack-appidstorage):

```
{
  "id": {
    "S": "API_SLEUTEL"
  },
  "fields": {
    "SS": [
      "adressering",
      "adresseringBinnenland",
      "ETC..."
    ]
  },
  "name": {
    "S": "NAAM_APPLICATIE"
  }
}
```

De set aan velden, die een applicatie toegewezen mag hebben, worden in overleg tussen de applicatie en de Gemeente Nijmegen bepaald.

## Inladen certificaat
De applicatie levert een publiek certificaat. Dit certificaat moet worden opgeslagen in de Certificate Storage. Deze storage is een S3 bucket (haalcentraalbrp-api-stack-certificatestorage) die bestaat uit objecten met daarin de certificate (chains) van de applicaties.

Beheerder upload certificaat, inclusief eventuele chain (in tekst formaat, achter elkaar geplakt) naar de S3 bucket.

Zodra een nieuw object (certificaat) naar de certificate storage wordt geupload zal de certificate lambda automatisch eenn nieuwe versie van de truststore klaarzetten, inclusief het nieuwe certificaat van de applicatie. Hier heeft de beheerder geen omkijken naar. De nieuwe truststore zal vrijwel direct klaar staan.


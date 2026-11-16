# Verwerkingenlog

Elke bevraging van persoonsgegevens via deze koppeling wordt vastgelegd in een DynamoDB-tabel (`haalcentraalbrp-api-stack-requestlog...`). Zo kan de gemeente (AVG) per persoon laten zien wie wanneer welke gegevens heeft opgevraagd en met welk doel.

Dit geldt voor alle persoon-endpoints: `/personen`, `/brp/personen`, `/partnerfilter/personen` en `/personen/burgerservicenummer/*`.

## Wat wordt vastgelegd
Per bevraging wordt één record per betrokken persoon geschreven. Betrokken zijn alle BSN's waarnaar gezocht is (in de body of de `x-bsn` header) en alle personen die in het antwoord terugkomen. Bij een zoekvraag op bijvoorbeeld postcode en huisnummer zijn dat dus de gevonden personen.

| Attribuut | Inhoud |
|---|---|
| `bsnHash` | HMAC-SHA256 van het BSN met de salt van de omgeving (partition key) |
| `requestedAt` | Tijdstip (ISO 8601) gevolgd door `#` en het request id (sort key) |
| `requestId` | API Gateway request id |
| `application` | Naam van de aangesloten applicatie (uit het profiel bij de API key) |
| `apiKeyId` | Id van de gebruikte API key (niet de key zelf) |
| `gebruiker` / `gebruikerHeader` | Waarde en naam van de gebruikersheader, `onbekend` als die ontbreekt |
| `doelbinding` / `doelbindingHeader` | Waarde en naam van de doelbindingheader, `onbekend` als die ontbreekt |
| `verwerking` | Waarde van `x-verwerking` of `x-processing`, als meegestuurd |
| `afnemerOin` | Waarde van `x-origin-oin` of `x-afnemer-oin`, als meegestuurd |
| `fscTransactionId` | Waarde van `Fsc-Transaction-Id`, als meegestuurd |
| `fields` | De velden die de applicatie heeft gevraagd |
| `endpoint` | Het aangeroepen endpoint |
| `requestType` | Type bevraging, bijvoorbeeld `RaadpleegMetBurgerservicenummer` of `subset:leeftijd` |
| `resultaat` | `gevonden`, `geen-resultaat` (gezocht BSN niet gevonden) of `fout` (Haal Centraal gaf een fout) |
| `statusCode` | Statuscode van het antwoord van Haal Centraal |

Er wordt nooit een BSN of API key opgeslagen.

Niet vastgelegd:
- Verzoeken die geweigerd worden voordat Haal Centraal bevraagd wordt (onbekende API key, velden die de applicatie niet mag opvragen). Er worden dan geen gegevens verstrekt.
- Een zoekvraag zonder BSN (bijvoorbeeld op postcode) die niemand vindt: er is dan geen persoon om aan te koppelen.

Welke headers meegestuurd moeten worden staat in [Bevragen API](./BevragenApi.md#headers-voor-het-verwerkingenlog).

## Altijd eerst loggen
Het record wordt geschreven voordat het antwoord naar de applicatie gaat. Lukt het schrijven niet, dan krijgt de applicatie een 500 en geen persoonsgegevens.

Om de gevonden personen te kunnen loggen vraagt de koppeling altijd `burgerservicenummer` op bij Haal Centraal. Heeft de applicatie dat veld niet gevraagd, dan wordt het uit het antwoord gehaald.

## Bewaartermijn
Records worden niet automatisch verwijderd. De tabel heeft point-in-time recovery en deletion protection en blijft bestaan als de stack verwijderd wordt.

## Salt
De salt staat in Secrets Manager (`/cdk/haal-centraal-brp/bsn-hash-salt`) en wordt per omgeving automatisch aangemaakt. Records zijn alleen terug te vinden met de salt waarmee ze geschreven zijn. Daarom:
- **Nooit roteren of verwijderen.** Het secret blijft ook bestaan als de stack verwijderd wordt.
- Deel de salt niet: met de salt kan iemand voor elk BSN de hash uitrekenen.

## Zoeken op BSN
Gebruik het script [`scripts/request-log/query-request-log.sh`](../scripts/request-log/query-request-log.sh) met AWS-credentials voor de juiste omgeving. Het script haalt de salt op, berekent de hash en toont alle records voor dat BSN, nieuwste eerst. Het script schrijft niets.

```bash
./scripts/request-log/query-request-log.sh 999971785
```

Zelf zoeken kan ook: bereken de hash met `printf '%s' <bsn> | openssl dgst -sha256 -hmac <salt>` en query de tabel op `bsnHash` met `--no-scan-index-forward`.

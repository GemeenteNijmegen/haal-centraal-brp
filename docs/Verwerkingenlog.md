# Verwerkingenlog

Elke bevraging van persoonsgegevens via deze koppeling wordt vastgelegd in een DynamoDB-tabel (`haalcentraalbrp-api-stack-auditlog...`). Zo kan de gemeente (AVG) per persoon laten zien wie wanneer welke gegevens heeft opgevraagd en met welk doel.

Dit geldt voor alle persoon-endpoints: `/personen`, `/brp/personen`, `/partnerfilter/personen` en `/personen/burgerservicenummer/*`.

## Wat wordt vastgelegd
Per bevraging die personen oplevert wordt één record per betrokken persoon geschreven. Welke personen dat zijn:
1. Staan er BSN's in het antwoord van Haal Centraal, dan de personen in het antwoord (`bron` is `antwoord`).
2. Anders de BSN's waarnaar gevraagd is, in de body (`RaadpleegMetBurgerservicenummer`) of de `x-bsn` header (`bron` is `verzoek`).
3. Anders wordt er niets vastgelegd en alleen een waarschuwing gelogd.

Het antwoord bevat alleen BSN's als de applicatie het veld `burgerservicenummer` opvraagt. Bij een zoekvraag op bijvoorbeeld postcode en huisnummer zonder dat veld wordt de bevraging dus niet vastgelegd.

Alleen geldige BSN's tellen mee: 9 cijfers die voldoen aan de elfproef. Andere waarden worden genegeerd.

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
| `bron` | `antwoord` (BSN uit het antwoord van Haal Centraal) of `verzoek` (BSN waarnaar gevraagd is) |

Er wordt nooit een BSN of API key opgeslagen.

Niet vastgelegd:
- Verzoeken die geweigerd worden voordat Haal Centraal bevraagd wordt (onbekende API key, velden die de applicatie niet mag opvragen). Er worden dan geen gegevens verstrekt.
- Verzoeken waarop Haal Centraal een fout geeft of geen personen teruggeeft. Er worden dan geen persoonsgegevens verstrekt.
- Een zoekvraag zonder BSN (bijvoorbeeld op postcode) zonder `burgerservicenummer` in de opgevraagde velden: er is dan geen BSN om aan te koppelen.
- Bij een vraag naar meerdere BSN's met `burgerservicenummer` in de velden: de BSN's die niet in het antwoord staan.

Welke headers meegestuurd moeten worden staat in [Bevragen API](./BevragenApi.md#headers-voor-het-verwerkingenlog).

## Altijd eerst loggen
Het record wordt geschreven voordat het antwoord naar de applicatie gaat. Lukt het schrijven niet, dan krijgt de applicatie een 500 en geen persoonsgegevens.

Het verzoek naar Haal Centraal en het antwoord naar de applicatie worden voor het verwerkingenlog niet aangepast.

## Bewaartermijn
Records worden niet automatisch verwijderd. De tabel heeft point-in-time recovery en deletion protection en blijft bestaan als de stack verwijderd wordt.

## Salt
De salt staat in Secrets Manager (`/cdk/haal-centraal-brp/bsn-hash-salt`) en wordt per omgeving automatisch aangemaakt. Records zijn alleen terug te vinden met de salt waarmee ze geschreven zijn. Daarom:
- **Nooit roteren of verwijderen.** Het secret blijft ook bestaan als de stack verwijderd wordt.
- Deel de salt niet: met de salt kan iemand voor elk BSN de hash uitrekenen.

## Zoeken op BSN
Gebruik het script [`scripts/audit-log/query-audit-log.sh`](../scripts/audit-log/query-audit-log.sh) met AWS-credentials voor de juiste omgeving. Het script haalt de salt op, berekent de hash en toont alle records voor dat BSN, nieuwste eerst. Het script schrijft niets.

```bash
./scripts/audit-log/query-audit-log.sh 999971785
```

Zelf zoeken kan ook: bereken de hash met `printf '%s' <bsn> | openssl dgst -sha256 -hmac <salt>` en query de tabel op `bsnHash` met `--no-scan-index-forward`.

# Haal Centraal BRP lokaal draaien op MiniStack

Een lokale opzet die de personen-, subset- en partnerfilter-lambda's met een
echte `cdk deploy` uitrolt in [MiniStack](https://github.com/ministackorg/ministack),
een gratis, open-source AWS-emulator. In plaats van de BRP API draait de
[personen-mock](https://github.com/BRP-API/Haal-Centraal-BRP-bevragen) van het
RvIG. Er is geen AWS-account nodig.

Alles staat in `test/local/`. Het hoort niet bij de productie-CDK-app
(`src/main.ts`) of de pipeline, en `npx projen` raakt het niet aan.

## Onderdelen

| Service | Poort | Rol |
|---|---|---|
| `ministack` | 4566 | CloudFormation, API Gateway (REST), Lambda, DynamoDB, Secrets Manager, SSM en CloudWatch. Lambda's draaien in echte `nodejs24.x`-containers (Docker executor), daarom heeft MiniStack `/var/run/docker.sock` nodig. |
| `personen-mock` | 5010 | De BRP API-mock van het RvIG, met de testpersonen van het RvIG. Past `fields` toe zoals de echte API. Direct aan te roepen op `http://localhost:5010/haalcentraal/api/brp/personen`. |
| `brp-mock-tls` | - | Caddy, neemt de rol van Layer7 over: https voor de personen-mock, als `haalcentraal.brp-mock`. |

`cdk/LocalHaalCentraalStack.ts` is een echte CDK-stack: de REST API met
API-keys en usage plan, de drie lambda's, de applicatie- en verwerkingenlogtabel
en de secrets en parameters die de lambda's lezen. Alle lokale waarden staan in
`cdk/localConfig.ts`.

## Vereisten

- Docker en Docker Compose
- `openssl`, voor het clientcertificaat
- Dependencies van de repo (`npm ci` in de root)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html),
  alleen voor `local.sh logs`
- Poorten 4566 en 5010 vrij. De lokale opzet van mijn-nijmegen gebruikt ook
  4566, draai ze niet tegelijk.

## Starten

```bash
test/local/scripts/local.sh start
```

`start` doet `down`, `up` (alle containers) en `deploy` (clientcertificaat
maken, `cdk bootstrap`, `cdk deploy` en de applicaties in de tabel zetten).
Elke stap is ook los te draaien, zie `test/local/scripts/local.sh help`.

De API draait daarna op
`http://localhost:4566/_aws/execute-api/haal-centraal/prod`, met dezelfde
endpoints als in productie (`/personen`, `/brp/personen`,
`/partnerfilter/personen` en `/personen/burgerservicenummer/<endpoint>`).

```bash
curl -X POST http://localhost:4566/_aws/execute-api/haal-centraal/prod/personen \
  -H 'Content-Type: application/json' \
  -H 'X-API-KEY: local-full-api-key-0123456789' \
  -H 'x-gebruiker: local-user' -H 'x-doelbinding: local-test' \
  -d '{"type":"RaadpleegMetBurgerservicenummer","burgerservicenummer":["999999333"],"fields":["naam"]}'
```

De Bruno-collectie heeft een omgeving `local` met deze URL, API-key en
testpersoon.

Lambda-code aangepast? Draai `test/local/scripts/local.sh deploy` opnieuw.

### Applicaties en API-keys

`scripts/seed.ts` zet deze applicaties in de applicatietabel:

| API-key | Applicatie | Velden |
|---|---|---|
| `local-full-api-key-0123456789` | Lokaal volledig | `burgerservicenummer`, `naam`, `geslacht`, `geboorte`, `geboorte.datum`, `leeftijd`, `nationaliteiten`, `partners`, `kinderen`, `ouders`, `adressering`, `verblijfplaats` |
| `local-limited-api-key-0123456789` | Lokaal beperkt | `naam` |

Met de beperkte key geeft een verzoek om meer dan `naam` een `403`.

### Testpersonen

De personen-mock bevat de testset van het RvIG. Bijvoorbeeld:

| BSN | Persoon | Adres |
|---|---|---|
| `999999333` | Nasier Boeddhoe, met een ontbonden partnerschap | 2593HW 71 |

De volledige set staat in de container: `docker compose -f test/local/docker-compose.yml exec personen-mock cat /app/Data/test-data.json`.

## Tests

```bash
test/local/scripts/local.sh test
```

Draait de tests in `tests/` (`*.local.ts`) tegen de draaiende stack. Ze vallen
buiten `npx projen test`, omdat ze de lokale stack nodig hebben.

## Logs

```bash
test/local/scripts/local.sh logs personen
```

Vraagt elke 2 seconden `/aws/lambda/local-personen` op. Gebruik `personen`,
`subset` of `partnerfilter`. De functienamen liggen vast in
`LocalHaalCentraalStack.ts` (`local-<naam>`). `aws logs tail --follow` werkt
niet tegen MiniStack: het verwacht een `eventId` dat MiniStack niet teruggeeft.

Gaat het mis voordat de handler draait, kijk dan naar de containers zelf,
bijvoorbeeld `docker compose -f test/local/docker-compose.yml logs -f ministack`.

## Verschillen met de echte stack

`LocalHaalCentraalStack` neemt het verzoekdeel van `ApiStack` over, maar laat weg:

- het custom domain met mTLS, de truststore, de certificaten- en
  certmetrics-lambda's, DNS en ACM;
- alarms, X-Ray en de log-instellingen per omgeving;
- `RETAIN`, point-in-time recovery en deletion protection op de tabellen.

Lokaal anders:

- **API-key in het event.** MiniStack controleert de `X-API-KEY`, maar zet
  `requestContext.identity.apiKey` en `apiKeyId` niet in het event. De lambda's
  zoeken de applicatie op met die waarde. Daarom wordt elke handler lokaal
  uitgerold via `lambda/<naam>.ts`, die de key uit de header overneemt
  (`lambda/withApiKeyIdentity.ts`) en dan de echte handler aanroept. De
  `apiKeyId` is de id uit `localConfig.ts` (`local-full`, `local-limited`).
- **Geen clientcertificaat bij de API.** Er is geen mTLS, dus de
  certificaatbindingscheck logt `missing-cert` en stuurt de metric
  `CertificateBindingMismatch`. Het verzoek gaat gewoon door, zoals in productie.
- **BRP-certificaat.** `local.sh deploy` maakt eenmalig een self-signed
  certificaat in `.certs/` (staat in `.gitignore`). De mock controleert het
  niet, maar de https-agent van de lambda's heeft geldige PEM nodig.
- **`DEV_MODE=true`**, zodat de lambda's het certificaat van Caddy's interne CA
  accepteren.
- **`REQUIRE_REQUEST_LOG_HEADERS=false`**: verzoeken zonder gebruiker of
  doelbinding worden gelogd als `onbekend`.
- De lambda's worden met esbuild gebundeld door `NodejsFunction`, niet door
  `npx projen bundle`.

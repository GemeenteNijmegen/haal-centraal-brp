# Bevragen van de haal centraal API.

## API Spec
We ondersteunen momenteel het personen endpoint volgens de haal centraal specificatie.
[Zie hier](https://brp-api.github.io/Haal-Centraal-BRP-bevragen/v2/redoc#tag/Personen/operation/Personen)

## Authenticatie 
- We maken gebruik van mTLS, elke applicatie levert het publieke deel van het certificaat dat zij voor mTLS gebruieken bij ons aan volgens [Aansluiten applicatie](./AansluitenApplicatie.md)
- De applicatie zal ook een API key geleverd krijgen door ons. Deze dient in elk request mee gestuurd te worden in de header: `X-API-KEY`.
- Endpoint voor de bevraging is: `https://api.haal-centraal-brp-accp.csp-nijmegen.nl/personen`

## Headers voor het verwerkingenlog
Elke bevraging wordt vastgelegd in het [verwerkingenlog](./Verwerkingenlog.md). Daarvoor stuurt de applicatie bij elk verzoek mee wie de gegevens opvraagt en met welk doel. Vraag bij een zoekvraag op andere gegevens dan BSN (bijvoorbeeld postcode en huisnummer) ook het veld `burgerservicenummer` op, anders kan de bevraging niet aan een persoon gekoppeld worden.

Per waarde worden meerdere headernamen geaccepteerd. Hoofdletters maken niet uit. Zijn er meerdere aanwezig, dan geldt de eerste uit de lijst.

| Waarde | Headers (in volgorde) | Verplicht |
|---|---|---|
| Gebruiker | `x-gebruiker`, `x-user`, `x-medewerker` | Ja |
| Doelbinding | `x-doelbinding`, `x-purpose`, `x-doel` | Ja |
| Verwerking | `x-verwerking`, `x-processing` | Nee |
| OIN van de afnemer | `x-origin-oin`, `x-afnemer-oin` | Nee |
| FSC transactie | `Fsc-Transaction-Id` | Nee |

Gebruiker en doelbinding worden verplicht. Tot dat moment worden verzoeken zonder deze headers nog verwerkt en gelogd met de waarde `onbekend`. Daarna krijgen ze een `400`.

`x-gebruiker`, `x-doelbinding` en `x-verwerking` zijn de namen die Open Formulieren en KISS gebruiken voor de BRP. Stel die bij voorkeur in; de andere namen zijn er voor applicaties die deze namen niet kunnen sturen.

### Instellen per applicatie
- **KISS**: de headernamen zijn configureerbaar ([KISS configuratie](https://github.com/Klantinteractie-Servicesysteem/KISS-frontend/blob/08c2e7bcddb99874ea8cb2f96c5fae29df1c9f0b/docs/installation/configuratie.md?plain=1#L183)). Bijvoorbeeld:
  ```bash
  HAAL_CENTRAAL_USER_HEADER_NAME=x-gebruiker
  HAAL_CENTRAAL_CUSTOM_HEADERS__x-doelbinding=BRPACT-ZoekenAlgemeen
  HAAL_CENTRAAL_CUSTOM_HEADERS__x-doelbinding__RaadpleegMetBurgerservicenummer=BRPACT-Totaal
  HAAL_CENTRAAL_CUSTOM_HEADERS__x-verwerking=Burgerzaken
  ```
- **Open Formulieren**: stuurt `x-gebruiker` automatisch mee (medewerker-id of `BurgerZelf`). Doelbinding, verwerking en de OIN-header stel je in bij de Haal Centraal configuratie ([Open Formulieren: Haal Centraal BRP bevragen](https://open-forms.readthedocs.io/en/stable/configuration/prefill/haal_centraal.html)).
- **FSC**: de [FSC Logging standaard](https://gitdocumentatie.logius.nl/publicatie/fsc/logging/1.1.0/) kent geen headers voor gebruiker of doelbinding. Wel geeft een FSC Outway/Inway de header `Fsc-Transaction-Id` mee. Die wordt vastgelegd, zodat een record te koppelen is aan het FSC transactielog.

## Testdata
De RVIG biedt testdata voor de testomgevingen.
Uitgebreid met versies: [https://www.rvig.nl/testsetpersoonslijstenproefomgevingBRPV](https://www.rvig.nl/testsetpersoonslijstenproefomgevingBRPV)
Summier: [https://www.rvig.nl/testdataset-persoonslijsten-proefomgevingen-bvbsn](https://www.rvig.nl/testdataset-persoonslijsten-proefomgevingen-bvbsn)

## Subset bevraging
Niet aangeraden, tenzij reguliere aanroepen echt niet kunnen.
[Subset Ednpoints Documentatie](./SubsetEndpoints.md)

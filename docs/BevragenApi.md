# Bevragen van de haal centraal API.

## API Spec
We ondersteunen momenteel het personen endpoint volgens de haal centraal specificatie.
[Zie hier](https://brp-api.github.io/Haal-Centraal-BRP-bevragen/v2/redoc#tag/Personen/operation/Personen)

## Authenticatie 
- We maken gebruik van mTLS, elke applicatie levert het publieke deel van het certificaat dat zij voor mTLS gebruieken bij ons aan volgens [Aansluiten applicatie](./AansluitenApplicatie.md)
- De applicatie zal ook een API key geleverd krijgen door ons. Deze dient in elk request mee gestuurd te worden in de header: `X-API-KEY`.
- Endpoint voor de bevraging is: `https://api.haal-centraal-brp-accp.csp-nijmegen.nl/personen`
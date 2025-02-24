# Haal Centraal BRP Koppeling (API)

Deze repository bevat de AWS Cloud Development Kit (CDK) code voor het opzetten van de koppeling naar [Haal Centraal BRP API](https://www.rvig.nl/brp-api) van het RvIG. 

De BRP API is een nieuw product voor het opzoeken en raadplegen van personen uit de BRP en de Registratie Niet-ingezetenen (RNI). De API geeft direct antwoord op deze informatievragen (informatieproduct) en levert alleen de gevraagde informatie die de gebruiker nodig heeft om zijn taak goed uit te kunnen voeren. Dit leidt tot een forse dataminimalisatie. Daarnaast is een groot voordeel dat gebruikers geen lokale kopiebestanden meer hoeven op te slaan omdat ze de informatie direct bij de bron opvragen.

Applicaties die samenwerken met de Gemeente Nijmegen zijn in staat om deze Haal Centraal BRP koppeling (API) te bevragen en daarmee informatie direct bij de bron op te vragen.

## Aansluiting vereisten voor applicaties
- Lijst met op te vragen velden uit de BRP
- Publiek certificaat (en bijbehorende certificate chain)


## Werking & Opzet Infrasctructuur
### API Gateway
De gateway bestaat uit 1 application programming interface (API), met het REST protocol. De API stelt maar 1 POST method beschikbaar voor de applicaties. In de body van de POST wordt bepaald welke informatie uit de BRP bevraagd moet en mag worden. De validatie gebeurd op een later moment, in de hieronder beschreven 'Lambda'.

De API is beveiligd op verschillende niveaus, het gebruik van onder andere een API-key en een certificaat (mTLS) is nodig om de API te mogen bevragen.

#### Custom domain
De gateway maakt geen gebruik van een default endpoint. Er wordt een endpoint opgezet met een custom domain waar applicaties naar toe kunnen bevragen.

Ook is een custom domain verplicht om mTLS te realiseren. Het certficiaat wordt aan een domein gehangen waarmee de validatie kan plaatsvinden.

#### Truststore
De publieke certricaten van de aangesloten applicaties worden toegevoegd aan de truststore. De gateway valideert de certificaten van de applicaties zodra er een verzoek binnenkomt.

### Lambda
Nadat het verzoek van een applicatie is gevalideerd door de gateway wordt het verzoek doorgestuurd naar de Personen Lambda. Deze lambda valideert vervolgens of de velden die meegestuurd zijn in het verzoek geldig zijn. Applicaties krijgen toegang tot een (sub)set van fields die uit te vragen zijn bij de BRP. Als de applicatie een veld vraagt die de applicatie niet mag opvragen wordt het verzoek geweigerd.

Als het een valide verzoek is wordt deze doorgestuurd naar de Haal Centraal BRP API van het RvIG. De response die vervolgens wordt ontvangen wordt weer doorgestuurd naar de applicatie.

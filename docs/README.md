## Werking & Opzet Infrasctructuur
### API Gateway
De gateway bestaat uit 1 application programming interface (API), met het REST protocol. De API stelt maar 1 POST method beschikbaar voor de applicaties. In de body van de POST wordt bepaald welke informatie uit de BRP bevraagd moet en mag worden. De validatie gebeurd op een later moment, in de hieronder beschreven 'Lambda'.

De API is beveiligd op verschillende niveaus, het gebruik van onder andere een API-key en een certificaat (mTLS) is nodig om de API te mogen bevragen.

#### Custom domain
De gateway maakt geen gebruik van een default endpoint. Er wordt een endpoint opgezet met een custom domain waar applicaties naar toe kunnen bevragen.

Ook is een custom domain verplicht om mTLS te realiseren. Het certficiaat wordt aan een domein gehangen waarmee de validatie kan plaatsvinden.

#### Truststore
De publieke certificaten van de aangesloten applicaties worden toegevoegd aan de truststore. De gateway valideert de certificaten van de applicaties zodra er een verzoek binnenkomt.

#### Certificate storage
De publieke certificaten van aangesloten applicaties worden opgeslagen in de certificate storage. Op basis van alle certificaten die in de certificate storage staan wordt het truststore bestand opgebouwd.

### Verwerking

#### Personen lambda
Nadat het verzoek van een applicatie is gevalideerd door de gateway wordt het verzoek doorgestuurd naar de Personen Lambda. Deze lambda valideert vervolgens of de velden die meegestuurd zijn in het verzoek geldig zijn. Applicaties krijgen toegang tot een (sub)set van fields die uit te vragen zijn bij de BRP. Als de applicatie een veld vraagt die de applicatie niet mag opvragen wordt het verzoek geweigerd.

Als het een valide verzoek is wordt deze doorgestuurd naar de Haal Centraal BRP API van het RvIG. De response die vervolgens wordt ontvangen wordt weer doorgestuurd naar de applicatie.

#### Certificaten lambda
Zodra een nieuwe applicatie wordt aangesloten en een certificaat wordt toegevoegd aan de certificate storage wordt de certificaten lambda afgetrapt. De lambda verzamelt alle certifcaten uit de certificate storage en bundeld deze tot een groot bestand. Dit bestand wordt vervolgens geupload naar de truststore als nieuwe versie. De custom domain wordt op de hoogte gesteld dat deze nieuwe versie nu in gebruik genomen moet worden.
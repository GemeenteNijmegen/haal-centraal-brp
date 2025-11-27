# Aansluiten nieuwe applicatie op Haal Centraal BRP
In dit document wordt beschreven hoe een nieuwe applicatie aangesloten kan worden op Haal Centraal BRP. Als het een nieuwe applicatie betreft, start dan bij (1). Als een bestaande applicatie bijgewerkt moet worden, start dan bij (3).

De *beheerder* van Haal Centraal is momenteel: devops@nijmegen.nl

## 1. Aanvragen API sleutel
Om verzoeken te mogen doen naar de Haal Centraal API moet een API sleutel aangevraagd worden door de applicatie. Deze sleutel kan aangevraagd worden door een mail te sturen naar de *beheerder*. Een nieuwe API sleutel zal aangemaakt worden en op een veilige manier worden gedeeld.

## 2. Uploaden van certificaat
Parallel aan het API sleutel aanvraagverzoek moet ook een certificaat (en bijbehorende chain) van de applicatie geleverd worden. Het publieke gedeelte van het certificaat (en de chain) dat de applicatie gebruikt om verzoeken te doen richting de Haal Centraal API moet worden gedeeld. Dit kan wederom door een mail te sturen naar de *beheerder* met daarin het publieke certificaat.

Het certificaat inclusief chain zal vervolgens toegevoegd worden aan de truststore. Dit zorgt ervoor dat de applicatie gevalideerd wordt bij elke verzoek richting de Haal Centraal API.

## 3. Bepalen van velden
Applicaties mogen niet zomaar alle velden uit de BRP opvragen. Elke applicatie heeft zijn eigen functie en daarmee ook recht tot een (sub)set van velden uit de BRP. Welke rechten dit zijn moet worden overlegd tussen de applicatie en de Gemeente Nijmegen.

Zodra de set aan velden opgesteld zijn wordt de informatie gedeeld met de *beheerder* van Haal Centraal. Ook als de rechten wijzigen moet dit worden doorgegeven en zal er een wijziging plaatsvinden aan de kant van Haal Centraal.

## 4. Bijwerken certificaat
Als het certificaat van een applicatie verloopt zal er een nieuw certificaat gegenereerd moeten worden. Dit kan betekenen dat er een nieuw publiek certificaat gedeeld moet worden met de Haal Centraal koppeling. Als dit het geval is kan het nieuwe publieke certificaat gemaild worden naar de *beheerder* en zal het nieuwe certificaat ingeladen worden. 

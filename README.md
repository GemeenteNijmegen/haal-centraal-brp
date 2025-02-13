# Haal Centraal BRP Koppeling (API)

Deze repository bevat de AWS Cloud Development Kit (CDK) code voor het opzetten van de koppeling naar [Haal Centraal BRP API](https://www.rvig.nl/brp-api) van het RvIG. 

De BRP API is een nieuw product voor het opzoeken en raadplegen van personen uit de BRP en de Registratie Niet-ingezetenen (RNI). De API geeft direct antwoord op deze informatievragen (informatieproduct) en levert alleen de gevraagde informatie die de gebruiker nodig heeft om zijn taak goed uit te kunnen voeren. Dit leidt tot een forse dataminimalisatie. Daarnaast is een groot voordeel dat gebruikers geen lokale kopiebestanden meer hoeven op te slaan omdat ze de informatie direct bij de bron opvragen.

Applicaties die samenwerken met de Gemeente Nijmegen zijn in staat om deze Haal Centraal BRP koppeling (API) te bevragen en daarmee informatie direct bij de bron op te vragen.

## Vereisten voor aansuiten applicaties
Ter voorbereiding op het aanvraagverzoek kunnen de volgende zaken alvast geregeld worden:

- Lijst met op te vragen velden uit de BRP
- Publiek certificaat (en bijbehorende certificate chain)

Voor het aanvraagproces zie [Aansluiten Applicatie](docs/AansluitenApplicatie.md)

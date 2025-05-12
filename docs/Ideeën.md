# Ideeën voor Haal Centraal BRP Koppeling

## API endpoint aanbieden voor profiel toewijzing of wijziging
Issue

https://github.com/GemeenteNijmegen/haal-centraal-brp/issues/104

### Probleem
Applicaties die aangesloten zijn op Haal Centraal moeten een set aan rechten toegewezen krijgen om een aanvraag te mogen doen. Deze set aan rechten staat als fields in een DynamDB tabel. Er moet een mogelijkheid komen om een nieuwe applicatie te registreren en fields toe te wijzen. Dit maakt het mogelijk voor een applicatiebeheerde om de wijzigingen zelf door te voeren en verminderd het beheer voor het DevOps team. Dit kan via een API.

### Mogelijke oplossing
API endpoint aanbieden die het mogelijk maakt om:

    Een applicatie te registreren
    Rechten (fields) toewijzen aan applicatie
    Rechten (fields) wijzigen per applicatie

Bestaande applicaties (in dynamodb) hebben momenteel een ID. Deze ID kan gebruikt worden in de API calls.

### Voorgestelde API inrichting

    POST /register BODY {'Name': 'example-application'}
    POST /fields BODY {'fields: [field1, field2]}
    PATCH /fields BODY {'fields: [field1, field2]}

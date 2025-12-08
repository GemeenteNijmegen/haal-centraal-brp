export abstract class SubsetHandler {
  protected abstract getAdditionalFields(): string[];

  getFields(): string[] {
    return [
      'burgerservicenummer',
      ...this.getAdditionalFields(),
    ];
  }

  abstract processResponse(personData: any): any;
}
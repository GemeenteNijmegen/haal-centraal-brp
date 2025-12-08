import { SUBSET_ENDPOINTS } from './subset-endpoint-handler-config';
import { SubsetHandler } from './subset-handler';
import { EndpointNotFoundError } from '../errors/subset-errors';

export class SubsetHandlerFactory {
  // Overleeft tussen lambda invocations, want static
  static handlers: Map<string, SubsetHandler> = new Map();

  static getHandler(endpoint: string): SubsetHandler {
    const cachedHandler = this.handlers.get(endpoint);
    if (cachedHandler) {
      return cachedHandler;
    }

    const config = SUBSET_ENDPOINTS.find(c => c.path === endpoint);

    if (!config) {
      throw new EndpointNotFoundError(endpoint);
    }

    try {
      const handler = new config.handlerClass();
      this.handlers.set(endpoint, handler);
      return handler;
    } catch (error) {
      throw new Error(`Failed to initialize handler for endpoint ${endpoint}: ${error}`);
    }
  }

  // TestDoeleinden omdat static handlers
  static clearCache(): void {
    this.handlers.clear();
  }
}
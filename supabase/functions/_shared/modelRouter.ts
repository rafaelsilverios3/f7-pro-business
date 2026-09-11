export type StructuredModelRequest = {
  operation: 'generateStructured' | 'classify' | 'extract' | 'reason' | 'summarize';
  input: Record<string, unknown>;
};

export interface ModelProvider {
  readonly name: string;
  generateStructured(input: Record<string, unknown>): Promise<unknown>;
  classify(input: Record<string, unknown>): Promise<unknown>;
  extract(input: Record<string, unknown>): Promise<unknown>;
  reason(input: Record<string, unknown>): Promise<unknown>;
  summarize(input: Record<string, unknown>): Promise<unknown>;
}
export class FunctionModelProvider implements ModelProvider {
  readonly name: string;
  private readonly handler: (input: Record<string, unknown>) => Promise<unknown>;

  constructor(name: string, handler: (input: Record<string, unknown>) => Promise<unknown>) {
    this.name = name;
    this.handler = handler;
  }

  generateStructured(input: Record<string, unknown>) { return this.handler(input); }
  classify(input: Record<string, unknown>) { return this.handler({ ...input, operation: 'classify' }); }
  extract(input: Record<string, unknown>) { return this.handler({ ...input, operation: 'extract' }); }
  reason(input: Record<string, unknown>) { return this.handler({ ...input, operation: 'reason' }); }
  summarize(input: Record<string, unknown>) { return this.handler({ ...input, operation: 'summarize' }); }
}

export class ModelRouter {
  private readonly providers: Map<string, ModelProvider>;
  constructor(providers: ModelProvider[]) { this.providers = new Map(providers.map((provider) => [provider.name, provider])); }

  private provider(name: string) {
    const provider = this.providers.get(name);
    if (!provider) throw Object.assign(new Error('MODEL_PROVIDER_NOT_CONFIGURED'), { code: 'MODEL_PROVIDER_NOT_CONFIGURED' });
    return provider;
  }

  run(providerName: string, request: StructuredModelRequest) {
    const provider = this.provider(providerName);
    return provider[request.operation](request.input);
  }

  generateStructured(providerName: string, input: Record<string, unknown>) {
    return this.run(providerName, { operation: 'generateStructured', input });
  }
}

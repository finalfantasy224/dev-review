/**
 * The `ctx.devReview` service: provider registry, selection, and the central
 * `ask()` entry point for evaluating state with typed questions.
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured provider id that is registered and `available()` → that provider.
 * - A configured id not registered → `TYPESAFE_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable → `TYPESAFE_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `TYPESAFE_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `TYPESAFE_PROVIDER_UNAVAILABLE`.
 * @module @deepseek-ai/dsh-dev-review
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TypeSafeProvider, TypeSafeRequest, TypeSafeResult } from './types.ts'
import { TypeSafeError } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    devReview: TypeSafeRuntime
  }
}

interface Selection {
  readonly configuredId?: string
  readonly providers: ReadonlyMap<string, TypeSafeProvider>
}

export interface TypeSafeRuntimeConfig {
  readonly provider?: string
}

/**
 * The TypeSafe evaluation service. Registered as `ctx.devReview`.
 */
export class TypeSafeRuntime extends Service {
  static Config: z<TypeSafeRuntimeConfig> = z.object({
    provider: z.string(),
  })

  private providers = new Map<string, TypeSafeProvider>()
  private readonly providerId: string | undefined

  constructor(ctx: Context, config: TypeSafeRuntimeConfig = {}) {
    super(ctx, 'devReview')
    this.providerId = config.provider
  }

  registerProvider(provider: TypeSafeProvider): () => void {
    const providers = this.providers
    if (providers.has(provider.id)) {
      throw new TypeSafeError(
        `a Jev provider with id "${provider.id}" is already registered`,
        'TYPESAFE_DUPLICATE_PROVIDER',
      )
    }
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'devReview.registerProvider()')
    return () => void dispose()
  }

  async ask(request: TypeSafeRequest, signal?: AbortSignal): Promise<TypeSafeResult> {
    const provider = resolveProvider({
      providers: this.providers,
      ...this.providerId !== undefined ? { configuredId: this.providerId } : {},
    })
    return provider.ask(request, signal)
  }
}

function resolveProvider(selection: Selection): TypeSafeProvider {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new TypeSafeError(
        `configured Jev provider "${configuredId}" is not registered`,
        'TYPESAFE_PROVIDER_CONFIGURED_MISSING',
      )
    }
    if (!provider.available()) {
      throw new TypeSafeError(
        `configured Jev provider "${configuredId}" is registered but unavailable`,
        'TYPESAFE_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return provider
  }
  const usable = [...providers.values()].filter(p => p.available())
  const [single] = usable
  if (single === undefined) {
    throw new TypeSafeError('no usable Jev provider is registered', 'TYPESAFE_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(p => p.id).join(', ')
    throw new TypeSafeError(
      `multiple usable Jev providers are registered (${ids}); configure one explicitly`,
      'TYPESAFE_PROVIDER_AMBIGUOUS',
    )
  }
  return single
}

export default TypeSafeRuntime
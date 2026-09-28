/**
 * Plugin entry for `@deepseek-ai/dsh-dev-review`. Mounts the `ctx.devReview`
 * service, registers the built-in Jev HTTP API provider, the model-facing
 * `dev_review` tool, and optional code quality hooks.
 *
 * Since Jev is the only practical TypeSafe System One provider today, this
 * single package combines the capability seam roles (Service Definition,
 * Provider, and Consumer tools/hooks) that separate packages would split
 * when more providers exist.
 *
 * Configuration:
 * ```yaml
 * - id: dev-review
 *   name: '@deepseek-ai/dsh-dev-review'
 *   config:
 *     apiKey: '...'                     # TYPESAFE_API_KEY env var fallback
 *     baseUrl: 'https://api.typesafe.ai'
 *     model: jev-latest
 *     tool: true                        # register dev_review tool
 *     codeQuality: false                # auto-score code blocks
 * ```
 * @module @deepseek-ai/dsh-dev-review
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from './types.ts'
import { TypeSafeRuntime } from './service.ts'
import { applyDevReviewTool } from './tool.ts'
import { applyCodeQualityHooks } from './hooks.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dev-review'

/** Services required by this plugin. */
export const inject = ['tools', 'systemPrompt', 'agents']

export interface Config {
  /** TypeSafe API key. Defaults to `TYPESAFE_API_KEY` env var. */
  apiKey?: string
  /** API base URL. Defaults to `https://api.typesafe.ai`. */
  baseUrl?: string
  /** Default model. Defaults to `jev-latest`. */
  model?: string
  /** Register the `dev_review` tool. Defaults to true. */
  tool?: boolean
  /** Tool timeout budget (ms). Defaults to 30000. */
  toolTimeoutMs?: number
  /** Auto-score code blocks in assistant messages. Defaults to false. */
  codeQuality?: boolean
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseUrl: z.string().default('https://api.typesafe.ai'),
  model: z.string().default('jev-latest'),
  tool: z.boolean().default(true),
  toolTimeoutMs: z.number().default(30_000),
  codeQuality: z.boolean().default(false),
})

/** Resolved config after schemastery applies defaults. */
type ResolvedConfig = Required<Config>

/**
 * Mount the dev-review plugin. Registers:
 * 1. The `ctx.devReview` service (always)
 * 2. The built-in Jev HTTP API provider (always)
 * 3. The model-facing `dev_review` tool (if `tool: true`)
 * 4. Code quality auto-scoring hook (if `codeQuality: true`)
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = config as ResolvedConfig

  // 1. Register the service directly in the current fiber.
  // Using `new TypeSafeRuntime(ctx)` instead of `ctx.plugin(TypeSafeRuntime)`
  // is critical: ctx.plugin() creates a child fiber, and the service would be
  // registered in the child's store, invisible to the parent fiber where
  // applyJevProvider / applyDevReviewTool / applyCodeQualityHooks run.
  new TypeSafeRuntime(ctx)

  // 2. Register the Jev HTTP API provider
  applyJevProvider(ctx, resolved)

  // 3. Optional: register the dev_review tool
  if (resolved.tool) {
    applyDevReviewTool(ctx, resolved.toolTimeoutMs)
  }

  // 4. Optional: auto-score code blocks
  if (resolved.codeQuality) {
    applyCodeQualityHooks(ctx)
  }
}

// ── Jev HTTP API provider ────────────────────────────────────────────────────

import { TypeSafeError } from './types.ts'
import type {
  TypeSafeProvider,
  TypeSafeRequest,
  TypeSafeResult,
} from './types.ts'

/** Register the built-in Jev HTTP provider on `ctx.devReview`. */
function applyJevProvider(ctx: Context, config: ResolvedConfig): void {
  function resolveApiKey(): string | undefined {
    if (config.apiKey !== undefined && config.apiKey.trim().length > 0) {
      return config.apiKey
    }
    const env = process.env.TYPESAFE_API_KEY
    if (env !== undefined && env.trim().length > 0) return env
    return undefined
  }

  const provider: TypeSafeProvider = {
    id: 'jev-api',
    available: () => resolveApiKey() !== undefined,
    ask: async (request: TypeSafeRequest, signal?: AbortSignal): Promise<TypeSafeResult> => {
      const apiKey = resolveApiKey()
      if (apiKey === undefined) {
        throw new TypeSafeError(
          'TypeSafe API key is not configured: set TYPESAFE_API_KEY or configure apiKey in dev-review config',
          'TYPESAFE_MISSING_CREDENTIAL',
        )
      }

      const apiQuestions: Record<string, unknown> = {}
      for (const [key, question] of Object.entries(request.questions)) {
        const q: Record<string, unknown> = {
          type: question.type,
          instructions: question.instructions,
        }
        if ('criteria' in question && question.criteria !== undefined) {
          q.criteria = question.criteria
        }
        apiQuestions[key] = q
      }

      const model = request.model ?? config.model
      const body = { state: request.state, model, questions: apiQuestions }

      const controller = new AbortController()
      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal

      let response: Response
      try {
        response = await fetch(`${config.baseUrl}/v1/systemone`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        })
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') {
          throw new TypeSafeError('request was cancelled', 'TYPESAFE_CANCELLED', { cause })
        }
        throw new TypeSafeError(
          `failed to contact TypeSafe API: ${cause instanceof Error ? cause.message : String(cause)}`,
          'TYPESAFE_NETWORK_ERROR',
          { cause },
        )
      }

      if (!response.ok) {
        const text = await response.text().catch(() => 'unknown error')
        throw new TypeSafeError(
          `TypeSafe API returned ${response.status}: ${text}`,
          'TYPESAFE_API_ERROR',
        )
      }

      const data = await response.json() as {
        model: string
        answers: Record<string, unknown>
        usage: { input_tokens: number; output_tokens: number }
      }

      const answers: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(data.answers)) {
        const answer = raw as { type: string; [key: string]: unknown }
        switch (answer.type) {
          case 'noul':
            answers[key] = { type: 'noul', noul: answer.noul as number }
            break
          case 'choice':
            answers[key] = {
              type: 'choice',
              choice: answer.choice as string,
              probabilities: answer.probabilities as Record<string, number>,
              confidence: answer.confidence as number,
            }
            break
          case 'score':
            answers[key] = {
              type: 'score',
              score: answer.score as number,
              legend: answer.legend as Record<string, string>,
              probabilities: answer.probabilities as Record<string, number>,
              confidence: answer.confidence as number,
            }
            break
          default:
            throw new TypeSafeError(
              `unknown answer type "${answer.type}" from TypeSafe API`,
              'TYPESAFE_UNKNOWN_ANSWER_TYPE',
            )
        }
      }

      return {
        model: data.model,
        answers: answers as TypeSafeResult['answers'],
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
      }
    },
  }

  ctx.devReview.registerProvider(provider)
}
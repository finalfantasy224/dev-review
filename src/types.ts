/**
 * Vocabulary for the TypeSafe AI / Jev capability seam (`ctx.typesafe`).
 * Three question types (Choice, Noul, Score) with typed answers, a pluggable
 * provider interface, and a typed error taxonomy.
 * @module @deepseek-ai/dsh-dev-review/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

// ── Shared types ────────────────────────────────────────────────────────────

/** A single TypeSafe question. */
export type TypeSafeQuestion =
  | NoulQuestion
  | ChoiceQuestion
  | ScoreQuestion

/** A map of named questions sent in one request. Keys are chosen by the caller. */
export type TypeSafeQuestions = Record<string, TypeSafeQuestion>

// ── Noul (yes/no) ────────────────────────────────────────────────────────────

export interface NoulQuestion {
  readonly type: 'noul'
  /** The yes/no question to evaluate. */
  readonly instructions: string
  /** Optional descriptions of what a yes and a no mean. */
  readonly criteria?: {
    readonly true?: string
    readonly false?: string
  }
}

export interface NoulAnswer {
  readonly type: 'noul'
  /** Probability that the answer is yes, 0 to 1. */
  readonly noul: number
}

// ── Choice (pick one from a set) ─────────────────────────────────────────────

export interface ChoiceQuestion {
  readonly type: 'choice'
  /** What the model should decide. */
  readonly instructions: string
  /** Map of option to rubric description (null = no extra detail). */
  readonly criteria: Record<string, string | null>
}

export interface ChoiceAnswer {
  readonly type: 'choice'
  /** The highest-probability option. */
  readonly choice: string
  /** Every option mapped to its probability (sums to 1). */
  readonly probabilities: Record<string, number>
  /** Certainty derived from the distribution, 0 to 1. */
  readonly confidence: number
}

// ── Score (rate along ordered levels) ────────────────────────────────────────

export interface ScoreQuestion {
  readonly type: 'score'
  /** What the model should rate. */
  readonly instructions: string
  /** Ordered array of level descriptions (2-10 entries). */
  readonly criteria: string[]
}

export interface ScoreAnswer {
  readonly type: 'score'
  /** Probability-weighted score; can land between levels. */
  readonly score: number
  /** Each level index mapped to its description. */
  readonly legend: Record<string, string>
  /** Each level mapped to its probability (sums to 1). */
  readonly probabilities: Record<string, number>
  /** Certainty derived from the distribution, 0 to 1. */
  readonly confidence: number
}

// ── Answer union ─────────────────────────────────────────────────────────────

export type TypeSafeAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer

// ── Request / Response ───────────────────────────────────────────────────────

export interface TypeSafeRequest {
  /** The content to evaluate: a string, object, or array. */
  readonly state: string | Record<string, unknown> | unknown[]
  /** Named questions to answer. */
  readonly questions: TypeSafeQuestions
  /** Optional model override (defaults to `jev-latest`). */
  readonly model?: string
}

export interface TypeSafeResult {
  /** The model that performed the evaluation. */
  readonly model: string
  /** One answer per question, keyed by the same ids used in the request. */
  readonly answers: Record<string, TypeSafeAnswer>
  /** Token usage for the request. */
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

// ── Provider interface ───────────────────────────────────────────────────────

/**
 * A TypeSafe-capable backend. The default provider calls the TypeSafe HTTP API;
 * custom providers can wrap local models, mock backends, or caching layers.
 */
export interface TypeSafeProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Answer typed questions about the given state; honor `signal` for cancellation. */
  ask(request: TypeSafeRequest, signal?: AbortSignal): Promise<TypeSafeResult>
}

// ── Error ────────────────────────────────────────────────────────────────────

/**
 * Typed TypeSafe error with a machine-routable, open-string `code`.
 * Shared codes cover unavailable providers, configured-but-missing providers,
 * ambiguous selection, API errors, and cancellation.
 */
export class TypeSafeError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'TypeSafeError'
  }
}
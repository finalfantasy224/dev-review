/**
 * Model-facing `dev_review` tool. Sends state and typed questions to Jev,
 * returns structured answers the model can act on.
 *
 * Owns schemas, validation, prompt guidance, and presentation.
 * @module @deepseek-ai/dsh-dev-review
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  TypeSafeResult,
  TypeSafeQuestion,
  NoulAnswer,
  ChoiceAnswer,
  ScoreAnswer,
} from './types.ts'
import type {} from './types.ts'

interface DevReviewArgs {
  state: string
  questions: string
}

function metaFromResult(result: TypeSafeResult): JsonValue {
  const answers: Record<string, JsonValue> = {}
  for (const [key, answer] of Object.entries(result.answers)) {
    switch (answer.type) {
      case 'noul':
        answers[key] = { type: 'noul', noul: (answer as NoulAnswer).noul } as JsonValue
        break
      case 'choice':
        answers[key] = { type: 'choice', choice: (answer as ChoiceAnswer).choice, probabilities: (answer as ChoiceAnswer).probabilities, confidence: (answer as ChoiceAnswer).confidence } as JsonValue
        break
      case 'score':
        answers[key] = { type: 'score', score: (answer as ScoreAnswer).score, legend: (answer as ScoreAnswer).legend, probabilities: (answer as ScoreAnswer).probabilities, confidence: (answer as ScoreAnswer).confidence } as JsonValue
        break
    }
  }
  return { model: result.model, answers, usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } } as JsonValue
}

function formatOutput(result: TypeSafeResult): string {
  const parts: string[] = []
  for (const [key, answer] of Object.entries(result.answers)) {
    switch (answer.type) {
      case 'noul':
        parts.push(`${key}: noul=${(answer as NoulAnswer).noul.toFixed(3)}`)
        break
      case 'choice':
        parts.push(`${key}: choice=${(answer as ChoiceAnswer).choice}, confidence=${(answer as ChoiceAnswer).confidence.toFixed(3)}`)
        break
      case 'score':
        parts.push(`${key}: score=${(answer as ScoreAnswer).score.toFixed(3)}, confidence=${(answer as ScoreAnswer).confidence.toFixed(3)}`)
        break
    }
  }
  parts.push(`(model: ${result.model}, in_tok: ${result.usage.inputTokens}, out_tok: ${result.usage.outputTokens})`)
  return parts.join('\n')
}

function presentCall(_args: DevReviewArgs): GenericCallView {
  return { card: 'generic', title: 'Jev evaluation', kind: 'search' }
}

function presentResult(_args: DevReviewArgs, result: ToolResult): GenericCallView | undefined {
  if (result.isError) return undefined
  const meta = result.meta
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const rawAnswers = (meta as Record<string, JsonValue>).answers
  if (typeof rawAnswers !== 'object' || rawAnswers === null) return undefined
  const answersObj = rawAnswers as Record<string, JsonValue>
  const lines: string[] = []
  for (const [key, value] of Object.entries(answersObj)) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    if (v.type === 'noul' && typeof v.noul === 'number') {
      lines.push(`${key}: ${(v.noul * 100).toFixed(0)}% yes`)
    } else if (v.type === 'choice' && typeof v.choice === 'string') {
      lines.push(`${key}: ${v.choice} (${typeof v.confidence === 'number' ? (v.confidence * 100).toFixed(0) : '?'}% confident)`)
    } else if (v.type === 'score' && typeof v.score === 'number') {
      lines.push(`${key}: ${v.score.toFixed(2)} (${typeof v.confidence === 'number' ? (v.confidence * 100).toFixed(0) : '?'}% confident)`)
    }
  }
  return { card: 'generic', title: 'Jev evaluation', content: [{ type: 'text', text: lines.join('\n') }] }
}

function parseQuestions(questionsJson: string): Record<string, TypeSafeQuestion> {
  let parsed: unknown
  try {
    parsed = JSON.parse(questionsJson)
  } catch {
    throw new Error('dev_review: questions must be valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('dev_review: questions must be a JSON object')
  }
  const raw = parsed as Record<string, unknown>
  if (Object.keys(raw).length === 0) {
    throw new Error('dev_review: questions must contain at least one question')
  }
  const result: Record<string, TypeSafeQuestion> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`dev_review: question "${key}" must be an object`)
    }
    const q = value as Record<string, unknown>
    if (typeof q.type !== 'string' || !['noul', 'choice', 'score'].includes(q.type)) {
      throw new Error(`dev_review: question "${key}" must have type "noul", "choice", or "score"`)
    }
    if (typeof q.instructions !== 'string' || q.instructions.trim().length === 0) {
      throw new Error(`dev_review: question "${key}" must have non-empty instructions`)
    }
    if (q.type === 'noul') {
      const criteria = q.criteria as { true?: string; false?: string } | undefined
      if (criteria !== undefined) {
        result[key] = { type: 'noul', instructions: q.instructions, criteria } as TypeSafeQuestion
      } else {
        result[key] = { type: 'noul', instructions: q.instructions } as TypeSafeQuestion
      }
    } else if (q.type === 'choice') {
      result[key] = { type: 'choice', instructions: q.instructions, criteria: q.criteria as Record<string, string | null> }
    } else {
      result[key] = { type: 'score', instructions: q.instructions, criteria: q.criteria as string[] }
    }
  }
  return result
}

/** Register the `dev_review` tool and its system-prompt guidance. */
export function applyDevReviewTool(ctx: Context, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:dev_review',
    order: 2050,
    text: `Use the dev_review tool to evaluate text or structured data using Jev, a System One model that returns typed judgments and probabilities. Pass the content as \`state\` (string or JSON) and one or more questions as a JSON object. Each question needs \`type\` ("noul" for yes/no, "choice" for one-of-many, "score" for rating on levels), \`instructions\` describing what to judge, and \`criteria\` defining the options or levels. Use this for fast structured decisions: classification, scoring, safety checks, quality evaluation, and routing.`,
  })

  ctx.tools.register(defineTool({
    name: 'dev_review',
    description: `Evaluate text or structured data using Jev (TypeSafe System One). Returns typed answers (noul/choice/score) with probabilities and confidence. Use for fast structured decisions such as classification, scoring, safety checks, and routing.`,
    parameters: {
      state: {
        type: 'string',
        required: true,
        description: 'The text or JSON content to evaluate.',
      },
      questions: {
        type: 'string',
        required: true,
        description: 'A JSON object mapping question ids to question definitions. Each definition requires: type ("noul", "choice", or "score"), instructions (string), and criteria (for choice: object of options, for score: array of level strings, for noul: optional true/false descriptions). Example: {"sentiment": {"type": "choice", "instructions": "What is the sentiment?", "criteria": {"positive": null, "negative": null, "neutral": null}}}',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', required: true },
          answers: { type: 'object', required: true, additionalProperties: true },
          usage: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              inputTokens: { type: 'number', required: true },
              outputTokens: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatOutput(value as unknown as TypeSafeResult) }],
      presentationMeta: (_args, value) => metaFromResult(value as unknown as TypeSafeResult),
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const questions = parseQuestions(args.questions)
      let state: string | Record<string, unknown> | unknown[] = args.state
      try {
        const parsed = JSON.parse(args.state)
        if (typeof parsed === 'object' && parsed !== null) {
          state = parsed
        }
      } catch { /* keep as plain string */ }
      const result = await ctx.devReview.ask({ state, questions }, exec.signal)
      return {
        model: result.model,
        answers: result.answers as unknown as Record<string, JsonValue>,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      }
    },
    presentCall: (args) => presentCall(args as unknown as DevReviewArgs),
    presentResult: (args, toolResult) => presentResult(args as unknown as DevReviewArgs, toolResult),
  }))
}
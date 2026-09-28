/**
 * Code quality hook: listens for `assistant/message` events, extracts code
 * blocks, evaluates them with Jev, and injects the assessment into the agent's
 * next request so the model can see its quality score.
 * @module @deepseek-ai/dsh-dev-review
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ScoreAnswer, NoulAnswer } from './types.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface CodeBlock {
  code: string
  language: string
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  const regex = /```(\w*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const lang = match[1] || 'unknown'
    const code = match[2]
    if (code !== undefined && code.trim().length > 0) {
      blocks.push({ code, language: lang })
    }
  }
  return blocks
}

function getAssistantText(event: SessionEvent<'assistant/message'>): string {
  const { message } = event.data
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
}

/** Register the `session/event` listener for auto code quality scoring. */
export function applyCodeQualityHooks(ctx: Context): void {
  ctx.on('session/event', (session, event): void => {
    if (event.type !== 'assistant/message') return

    const text = getAssistantText(event)
    const blocks = extractCodeBlocks(text)
    if (blocks.length === 0) return

    void Promise.all(blocks.map(async (block) => {
      try {
        const result = await ctx.devReview.ask({
          state: { code: block.code, language: block.language },
          questions: {
            quality: {
              type: 'score',
              instructions: `Evaluate the quality of this ${block.language} code. Consider correctness, readability, error handling, security, and best practices.`,
              criteria: [
                'Very poor — syntax errors, logic bugs, or security vulnerabilities',
                'Below average — works but poor style, missing error handling',
                'Average — functional with reasonable structure',
                'Good — clean code, proper error handling, follows conventions',
                'Excellent — best practices, secure, performant, maintainable',
              ],
            },
            has_issues: {
              type: 'noul',
              instructions: 'Does this code have significant issues (bugs, security risks, or correctness problems)?',
              criteria: {
                true: 'Contains bugs, security vulnerabilities, or logic errors',
                false: 'Code is correct and safe',
              },
            },
          },
        })

        const qualityRaw = result.answers.quality
        const issuesRaw = result.answers.has_issues
        if (qualityRaw === undefined || qualityRaw.type !== 'score') return
        const quality = qualityRaw as ScoreAnswer
        const levelIndex = Math.max(0, Math.min(4, Math.round(quality.score)))
        const labels = ['很差', '较差', '中等', '良好', '优秀']
        const label = labels[levelIndex] ?? `评分 ${quality.score.toFixed(1)}`
        const hasIssues = issuesRaw !== undefined && issuesRaw.type === 'noul'
          ? (issuesRaw as NoulAnswer).noul > 0.5 : undefined

        const lang = block.language ? ` (${block.language})` : ''
        let assessment = `[Jev 代码质量]${lang}: ${label} (置信度 ${(quality.confidence * 100).toFixed(0)}%)`
        if (hasIssues !== undefined) {
          assessment += hasIssues ? ' [⚠ 发现潜在问题]' : ' [✓ 无明显问题]'
        }
        ctx.logger?.info(assessment)

        const agent: Agent | undefined = ctx.agents.get(session.id)
        if (agent !== undefined) {
          agent.inject(createUserMessage({
            content: [{ type: 'text', text: assessment }],
            source: { kind: 'plugin', plugin: 'dev-review' },
          }))
        }
      } catch { /* advisory — swallow errors */ }
    }))
  })
}
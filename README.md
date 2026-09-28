# @deepseek-ai/dsh-dev-review

Jev AI development review plugin for DeepSeek Harness — structured code review, quality scoring, and semantic judgment via TypeSafe System One models.

## Overview

This plugin mounts a `ctx.devReview` service that powers a model-facing `dev_review` tool. It integrates with the TypeSafe API (via Jev HTTP provider) to send code state and typed questions, receiving structured answers (scores, choices, noul values) that the agent can act on.

## Features

- **Structured code review**: Send code snippets and context to Jev for analysis
- **Quality scoring**: Auto-score code blocks with numeric quality metrics
- **Semantic judgment**: Multi-dimensional evaluation via TypeSafe System One
- **Optional hooks**: Automatic code quality scoring on assistant messages

## Installation

```bash
pnpm add @deepseek-ai/dsh-dev-review
```

## Configuration

Add to your `cordis.yml`:

```yaml
- id: dev-review
  name: '@deepseek-ai/dsh-dev-review'
  config:
    apiKey: ${TYPESAFE_API_KEY}  # or set env var directly
    baseUrl: 'https://api.typesafe.ai'
    model: jev-latest
    tool: true                    # register dev_review tool (default)
    codeQuality: false            # auto-score code blocks (default: off)
```

Environment variable fallback:

```bash
export TYPESAFE_API_KEY=your-api-key-here
```

## Usage

### Tool Call

The `dev_review` tool accepts two arguments:

- **state**: Current code/project context (string)
- **questions**: JSON-encoded questions array

```json
{
  "state": "import React from 'react'\n\nexport function App() { return <div>Hello</div> }",
  "questions": [
    { "key": "readability", "type": "score", "instructions": "Rate code readability" },
    { "key": "bugs", "type": "choice", "instructions": "Are there obvious bugs?", "criteria": ["yes", "no"] }
  ]
}
```

### Hook Integration

Enable automatic code quality scoring:

```yaml
- id: dev-review
  config:
    codeQuality: true
```

When enabled, assistant messages containing code blocks are automatically scored.

## API Reference

### Config Schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | `string` | `TYPESAFE_API_KEY` env | TypeSafe API key |
| `baseUrl` | `string` | `https://api.typesafe.ai` | API endpoint |
| `model` | `string` | `jev-latest` | Model identifier |
| `tool` | `boolean` | `true` | Register `dev_review` tool |
| `toolTimeoutMs` | `number` | `30000` | Request timeout |
| `codeQuality` | `boolean` | `false` | Auto-score code blocks |

### Types

```typescript
interface Config {
  apiKey?: string
  baseUrl?: string
  model?: string
  tool?: boolean
  toolTimeoutMs?: number
  codeQuality?: boolean
}
```

## Dependencies

Peer dependencies required:

- `@deepseek-ai/cordis`
- `@deepseek-ai/dsh-agent`
- `@deepseek-ai/dsh-invariants`
- `@deepseek-ai/dsh-llm`
- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-system-prompt`
- `@deepseek-ai/dsh-tools`

Internal dependencies:

- `@deepseek-ai/dsh-util-values`
- `@deepseek-ai/schemastery`

## License

MIT

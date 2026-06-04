# Using RAWE Dog with Different LLMs

One of the strengths of this framework is that it works with almost any capable LLM.

## Recommended Models (as of 2026)

| Model / Platform       | Strengths                              | Notes                                      | Privacy Level    |
|------------------------|----------------------------------------|--------------------------------------------|------------------|
| Claude 3.5 / 4         | Excellent long context, structured output | Currently one of the best for this use case | Medium           |
| GPT-4o / o3            | Strong reasoning, widely available     | Good all-rounder                           | Medium           |
| Grok (xAI)             | Good at following complex instructions | Strong with structured data                | Medium           |
| Local models (Ollama)  | Maximum privacy                        | Quality varies — use 70B+ class models     | High             |
| Gemini                 | Large context window                   | Decent but can be more generic             | Medium           |

## How to Use

1. Open your LLM of choice.
2. Paste the contents of `prompts/system-prompt.md`.
3. Tell it to read your `master-profile.md` and the relevant files in `references/`.
4. Give it a job posting or request.

For very long contexts (full profile + multiple experience files + job posting), models with large context windows (Claude, Gemini, some local setups) perform best.

## Pro Tip

Create a custom GPT, Claude Project, or saved prompt that already includes the system instructions and points to your files. This makes repeated use much faster.

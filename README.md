# RAWE-DOG
**R**esume **A**nd **W**ork **E**xperience - **D**ocument **O**utput **G**enerator

**A Personal AI Hiring Manager**

RAWE-DOG is an open-source framework that turns your career history into high-quality, ATS-optimized resumes, cover letters, and career documents using **any AI or LLM** you want.

It works by giving the model a structured "Master Profile" + detailed experience files instead of hoping a generic prompt will remember who you are. The result is output that actually sounds like you and is grounded in your real achievements using a library of additional files to support the resume generation.

## Why This Exists

Most AI resume tools are either:
- Generic or
- Require you to paste your entire life story every time.

RAWE-DOG takes the opposite approach: **you build a high-quality knowledge base once**, then use it with whatever LLM you trust (Claude, GPT, Grok, local models, custom, sock puppets, IDC, etc.). The framework tells the model how to think about your experience in a contextual way.

## How It Works

The system has three layers:

1. **Master Profile** Your strategic source of truth. Contains alignment tables, tone rules, skill indexes, and guidance on which parts of your history to emphasize for different roles.
2. **System Instructions** A set of rules that turn any AI or LLM into a competent, consistent "hiring manager" who knows how to select and frame your experience.
3. **Experience Files** Rich, detailed write-ups of your actual work (projects, impact, S.T.A.R. stories). These are what stop the AI or LLM from hallucinating or being generic; locking in to applicable skills.

## Who This Is For

- People who want **much better** output than generic AI/LLM resume tools
- Technical professionals, career changers, and anyone tired of generic bullet points
- Power users who already work with AIs or LLMs and want structure + grounding
- People who value owning their data and not feeding it to random web apps

**Note:** This framework rewards effort. The better your Master Profile and experience files, the better the output. It's not zero-effort magic. It's your data, take as many or as few precautions as you feel necessary.

## Quick Start (framework for any AI or LLM)

1. Copy the templates:
   ```bash
   cp templates/master-profile.md .
   mkdir -p references
   cp templates/experience-file.md references/your-role-experience.md
   ```

2. Fill out `master-profile.md` with information as you see fit (detailed is better).

3. Create detailed experience files in the `references/` folder for your key roles.

4. Feed the whole thing to your LLM of choice along with the system prompt in `prompts/system-prompt.md`.

5. Start tailoring resumes for specific jobs.

See the [full example](./examples/full-example) to understand what good input looks like.

## Local App (xAI)

A local Next.js app lives in [`web/`](./web). Paste a job posting, upload your Master Profile / experience / templates (MD or PDF), and generate a full application kit via the xAI API with **immutable guardrails** and a **two-pass, accuracy-first** context pack.

```bash
cd web
npm install
npm run dev
```

| Doc | Audience |
| --- | --- |
| [web/README.md](./web/README.md) | Runbook: Settings, Library, Generate, export, privacy |
| [web/docs/FOR_AI_REVIEWERS.md](./web/docs/FOR_AI_REVIEWERS.md) | **AI / code review handoff** — architecture, pipeline, git safety, file index |
| [web/AGENTS.md](./web/AGENTS.md) | Short rules for coding agents working in `web/` |

Personal uploads and API keys live only under **gitignored** `web/data/` — never commit that directory.

## Repository Structure

```
rawe-dog/
├── README.md
├── LICENSE
├── DONATE.md
├── web/                         # Local Next.js app (xAI generate + export)
│   ├── app/                     # UI + API routes
│   ├── lib/                     # Generate, library, export, xAI
│   ├── docs/FOR_AI_REVIEWERS.md # Handoff for AI/code review
│   ├── public/starters/         # Generic templates (no personal PII)
│   └── data/                    # GITIGNORED: keys + personal uploads
├── templates/
│   ├── master-profile.md
│   └── experience-file.md
├── prompts/
│   ├── system-prompt.md
│   └── tailoring-workflow.md
├── guides/
│   ├── how-to-build-your-profile.md
│   ├── writing-good-experience-files.md
│   ├── using-with-different-llms.md
│   └── privacy-and-security.md
├── examples/
│   ├── minimal-example/
│   └── full-example/
└── advanced/
    └── notion-integration.md
```

## Privacy & Safety

Your career history is sensitive data. This framework is designed to be used **locally or in private contexts**.

- Never commit your real `master-profile.md` or `references/` folder to a public repo.
- Consider using local LLMs (Ollama, LM Studio, etc.) for maximum privacy.
- The `.gitignore` is set up to help protect you.

Read `guides/privacy-and-security.md` before putting real information in here.

## Contributing

Improvements to the framework, templates, prompts, and guides are very welcome. The goal is to make high-quality, grounded career document generation more accessible without forcing people to hand their data to third parties. Own your data.

## License

MIT License — see [LICENSE](LICENSE) file.

## Credits

Originally inspired by a personalized internal system. Released publicly because good tools shouldn't stay locked in one person's workflow and I can't be bothered to try to make a product that would require so much detailed personal information to be profitable - it was more than a wee bit scummy :P

Use it and hit'em with that RAWE Dog, or don't; you do you.

**— [@ThatOtherZach](https://x.com/ThatOtherZach)**

If this saves you time or helps you get interviews, you're welcome to send some crypto via the address in [DONATE.md](DONATE.md).

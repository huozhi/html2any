# html2any AI Context Benchmark

Goal: prove whether `html2any` reduces context size while preserving task-relevant documentation information for agents.

## Inputs

Start with real docs pages:

- `https://nextjs.org/docs`
- `https://nextjs.org/docs/app/api-reference/config/next-config-js`
- `https://nextjs.org/docs/app/getting-started/installation`
- `https://swc.rs/`
- `https://swc.rs/docs/configuration/compilation`
- `https://swc.rs/docs/usage/core`

Run the benchmark with:

```bash
bun run benchmark
```

The script fetches missing pages, stores captured HTML under `benchmark/fixtures/raw/`, generates variants under `benchmark/outputs/`, and writes:

- `benchmark/outputs/report.json`
- `benchmark/outputs/pages.csv`
- `benchmark/outputs/tasks.csv`

Keep captured fixtures immutable for a benchmark run so raw HTML and Markdown variants compare the same source. For offline or CI runs that should not fetch, use:

```bash
bun run benchmark -- --no-fetch
```

## Compare Any URL

Use `benchmark:url` for an ad hoc compression report against any page:

```bash
bun run benchmark:url -- https://vercel.com/docs/vercel-sandbox/sdk-reference
```

Multiple URLs are supported:

```bash
bun run benchmark:url -- \
  https://vercel.com/docs/vercel-sandbox/sdk-reference \
  https://workflow-sdk.dev/docs/getting-started/next
```

The script writes Markdown outputs and `report.json` to `benchmark/outputs/compare/` by default. Use `--no-files` to print only the report, or `--out <dir>` to choose another output directory.

## Variants

The script generates two context variants per page:

```bash
bun run benchmark -- --page nextjs-docs
```

- Raw HTML baseline: `benchmark/outputs/<page>.raw.html`
- Compact Markdown: `benchmark/outputs/<page>.md`

## Tasks

Use the same questions across all variants:

- Answer docs questions with cited source sections.
- Generate code from documented API usage.
- Find correct configuration keys and valid values.
- Create migration or setup steps.
- Extract workflows.
- Identify examples relevant to a feature request.

## Metrics

Track per task and variant:

- input token count
- output token count
- latency
- model cost
- answer correctness
- citation/source accuracy
- task completion rate

Current script coverage:

- Captures pages.
- Generates raw and Markdown variants.
- Estimates context token counts with a deterministic tokenizer.
- Estimates full task prompt token counts.
- Reports compression versus raw HTML.

Future LLM-eval coverage:

- Run each task against each variant.
- Record model latency, output tokens, and cost.
- Score correctness and citation accuracy with a separate judge or manual rubric.

## Expected Claims

Primary claim:

```text
html2any reduces context size while preserving task-relevant information.
```

Stronger claim if supported:

```text
html2any improves agent task success per token.
```

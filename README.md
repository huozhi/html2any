# html2any

[![npm version](https://img.shields.io/npm/v/html2any?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/html2any)

> Compile messy HTML into compact context for AI agents.

## Library

While building websites, people may need to render rich text into different formats.
For example, I've got an `<video>` tag, but I wanna render it with my own React video component.
But I also want to render the whole html easily rather than parse it manually.

`html2any` helps you render an HTML string. It parses HTML and gives you the ability to transform it from the source format into your target format.

### API

html2any provides the following APIs:

- `AST(Object) parse(String source)`
- `void transform(AST ast, function rule)`
- `void html2any(html, function rule)`

- parse
> Build an AST from HTML/XML source.

- transform
> Convert the AST to a final form with a custom rule.

- html2any
> Convert the html/xml to the final form directly.

### Usage

```
npm i -S html2any
```

```js
import html2any, { parse, transform } from 'html2any'

const html = escapeHTMLEntity(`<div>123</div>`)

const ast = parse(html)[0]

function rule(node, children) {
  if (typeof node === 'string') {
    return node
  } else {
    return <div>{node}</div>
  }
}

const vdom = transform(ast, rule)
// JSX vdom form of html
// { type: 'div', props: {...}, children: '...' }

```

Or you can just call html2any directly

```js
const vdom = html2any(html, rule)
```

### CLI

Convert a local file, URL, or stdin into compact Markdown:

```bash
html2any md <file|url|->

# Short alias
html2 md <file|url|->
```

Examples:

```bash
html2 md page.html > page.context.md
cat page.html | html2 md - --url https://example.com/page
```

The Markdown output keeps docs-friendly structure: title, description, headings, paragraphs, lists, tables, code blocks, and links.

The extractor is deterministic and token-size friendly. It drops scripts, styles, hidden content, and layout chrome while preserving semantically useful docs content.

### Native binary

Tagged [GitHub releases](https://github.com/huozhi/html2any/releases) include standalone binaries compiled with [`scriptc`](https://scriptc.dev/), plus a `SHA256SUMS` file. They do not require Node, Bun, `node_modules`, or an embedded JavaScript engine at runtime.

| Archive | Platform |
| --- | --- |
| `html2any-linux-x64.tar.gz` | Linux x64 |
| `html2any-darwin-arm64.tar.gz` | macOS arm64 |

Download the archive for the latest release with the GitHub CLI:

```bash
gh release download --repo huozhi/html2any --pattern 'html2any-darwin-arm64.tar.gz'
tar -xzf html2any-darwin-arm64.tar.gz
./html2any md page.html
```

To build locally:

```bash
bun install
bun run scriptc:coverage
bunx scriptc build src/bin/html2any.ts -o html2any --no-keep-c
```

With `scriptc` 0.0.26, both the CLI and library report 100% static coverage. The macOS arm64 executable is **1.51 MiB** uncompressed.

### Native CLI benchmark

Startup and conversion were measured by spawning each CLI 25 times after 3 warmups. All three outputs were checked for byte equality. The large input is the cached 1,004,743-byte Next.js installation fixture.

| Scenario | Runtime | Median | p95 |
| --- | --- | ---: | ---: |
| Small HTML | Native | 2.19 ms | 2.34 ms |
| Small HTML | Node | 25.47 ms | 28.10 ms |
| Small HTML | Bun | 17.21 ms | 18.22 ms |
| 1.00 MB docs page | Native | 446.34 ms | 453.60 ms |
| 1.00 MB docs page | Node | 118.40 ms | 155.03 ms |
| 1.00 MB docs page | Bun | 157.56 ms | 163.88 ms |

Measured on an Apple M4 Pro with macOS arm64, Node 24.18.0, Bun 1.3.14, and `scriptc` 0.0.26. The native binary has much lower startup latency in this test, while Node and Bun currently process the 1 MB fixture faster. Results vary by machine; reproduce them with:

```bash
bun run benchmark:native
```

### How It Works

Use `html2any` to construct an AST from an HTML string, then convert each node recursively with the `rule` passed to the transform function.

For example, translate a `<p>` tag into a React Native component like `<Text style={styles.paragraph}>` with prepared styles, then decode the paragraph content to avoid HTML entity issues.

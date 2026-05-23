import { expect, it } from 'bun:test'
import { extractContext, htmlToMarkdown } from '../src/context'

const docsHtml = `
<!doctype html>
<html>
  <head>
    <title>Example Docs</title>
    <meta name="description" content="API docs for agents">
    <style>.hidden { display: none; }</style>
  </head>
  <body>
    <nav><a href="/docs">Docs</a><a href="/blog">Blog</a></nav>
    <main>
      <h1>Example Docs</h1>
      <p>Install with <code>npm install example</code>.</p>
      <h2>Config</h2>
      <p>Read the <a href="/docs/config">config guide</a>.</p>
      <p>Don&rsquo;t keep docs &mdash; examples encoded.</p>
      <ul><li>Set <code>mode</code></li><li>Run build</li></ul>
      <pre><code class="language-js">export default { mode: 'strict' }</code></pre>
      <table><tr><th>Option</th><th>Meaning</th></tr><tr><td>mode</td><td>Compiler mode</td></tr></table>
      <form><input name="q" placeholder="Search" required><button>Search</button></form>
    </main>
    <footer><a href="/login" role="button">Login</a></footer>
    <script>window.noise = true</script>
  </body>
</html>
`

it('extracts compact agent context from docs html', () => {
  expect(extractContext(docsHtml, { url: 'https://example.test/docs' })).toEqual({
    page: {
      title: 'Example Docs',
      description: 'API docs for agents',
      url: 'https://example.test/docs',
    },
    sections: [
      {
        heading: 'Example Docs',
        level: 1,
        summary: 'Install with `npm install example`.',
        content: [
          'Install with `npm install example`.',
        ],
        code_examples: [],
        links: [],
      },
      {
        heading: 'Config',
        level: 2,
        summary: 'Read the [config guide](/docs/config).',
        content: [
          'Read the [config guide](/docs/config).',
          "Don't keep docs -- examples encoded.",
          '- Set `mode`\n- Run build',
          '| Option | Meaning |\n| --- | --- |\n| mode | Compiler mode |',
        ],
        code_examples: [
          {
            language: 'js',
            code: "export default { mode: 'strict' }",
            section: 'Config',
          },
        ],
        links: [
          {
            label: 'config guide',
            href: '/docs/config',
          },
        ],
      },
    ],
    actions: [
      {
        label: 'Search',
        role: 'button',
        href: '',
        selector: 'button',
      },
      {
        label: 'Login',
        role: 'button',
        href: '/login',
        selector: 'a[href="/login"]',
      },
    ],
    forms: [
      {
        fields: [
          {
            name: 'q',
            label: 'Search',
            type: 'input',
            required: true,
          },
        ],
        submit: {
          label: 'Search',
          role: 'submit',
        },
      },
    ],
    navigation: [
      {
        label: 'Docs',
        href: '/docs',
      },
      {
        label: 'Blog',
        href: '/blog',
      },
      {
        label: 'Login',
        href: '/login',
      },
    ],
    code_examples: [
      {
        language: 'js',
        code: "export default { mode: 'strict' }",
        section: 'Config',
      },
    ],
  })
})

it('renders markdown for token-friendly docs context', () => {
  expect(htmlToMarkdown(docsHtml, { url: 'https://example.test/docs' })).toMatchSnapshot()
})

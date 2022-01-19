# html2any

[![npm version](https://badge.fury.io/js/html2any.svg)](https://badge.fury.io/js/html2any)

> A non-dependecy package for coverting html/xml string to your customized format/structures.

While building websites, people may met issues for rendering rich text into different formats.
For example, I've got an `<video>` tag, but I wanna render it with my own React video component.
But I also want to render the whole html easily rather than parse it manually.

Now `html2any` help you to render html string. It not only parses your html but also gives you ability to transform it from origin to the dest.

### API

html2any provide following APIs

- `AST(Object) parse(String source)`
- `void transform(AST ast, function rule)`
- `void html2any(html, function rule)`

- parse
> Build the AST from source to AST from source html/xml code

- transform
> Convert the AST to the final form with the specific rule.

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

### How It Works

Use `html2any` to construct an AST of html string, then convert each node recursively with `rule` passed to transform function.

For example, we translate `<p>` tag into React Native component `<Text style={styles.paragraph}>` with the prepared styles. Then decode the p tag' s content to avoid html entities mess up.


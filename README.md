# html2any

[![npm version](https://badge.fury.io/js/html2any.svg)](https://badge.fury.io/js/html2any)

> A non-dependecy package for coverting html string to your customized format/components.

While building websites, people may met issues for rendering rich text into different formats.
For example, I've got an `<video>` tag, but I wanna render it with my own React video component.
But I also want to render the whole html easily rather than parse it manually.

Now `html2any` help you to render html string. It not only parses your html but also gives you ability to transform it from origin to the dest.


### Theory

Use `html2any` to construct an AST of html string, then convert each node recursively with `rule` passed to transform function.

For example, we translate `<p>` tag into React Native component `<Text style={styles.paragraph}>` with the prepared styles. Then decode the p tag' s content to avoid html entities mess up.

### Demo

- [Web React Online Demo](https://huozhi.github.io/html2any-web-demo/)
- React Native demo: https://github.com/huozhi/html2any-rn-demo

### Documentation

html2any provide 3 APIs below:

- API
  - `Array[String] tokenize(String html)`
  - `AST(Object) parse(Array[String] tokens)`
  - `transform(AST ast, function rule)`

- tokenize
> Give you ability to parse raw html string to tokens

- parse
> Build the AST from tokens that tokenize generated

- transform
> Convert the AST to the final form with the specific rule.

If it's not easy to reach the point, you could look at the [demo code](https://huozhi.github.io/html2any-web-demo/).

#### Example

```js
import {tokenize, parse, transform} from 'html2any'

const html = `
  <div>123</div>
`

const ast = parse(tokenize(html))[0]
function rule(node, children) {
  if (node.name === 'div') {
    return <div>{children}</div>
  } else {
    return node // string node
  }
}

const Dumb = transform(ast, rule)
// React form of Dumb
// { type: 'div', props: {...}, children: '...' }
```

### Issue

Any suggestions or beautifier API you expect, just post issue [here](https://github.com/huozhi/html2any/issues).
Reporting bugs is welcomed. : )

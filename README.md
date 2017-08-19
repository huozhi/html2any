# html2any
> aim to covert html string to your customized format/components.

While building websites, people may met issues for rendering rich text into different formats.
For example, I've got an `<video>` tag, but I wanna render it with my own React video component.
But I also want to render the whole html easily rather than parse it manually.

Now `html2any` help you to render html string. It not only parses your html but also gives you ability to transform it from origin to the dest.


### Theory

Use `html2any` to construct an AST of html string, then convert each node recursively with `rule` passed to transform function.

For example, we translate `<p>` tag into React Native component `<Text style={styles.paragraph}>` with the prepared styles. Then decode the p tag' s content to avoid html entities mess up.

### Demo

- React Native demo: https://github.com/huozhi/html2any-rn-demo
- [Web React Online Demo](https://huozhi.github.io/html2any-web-demo/)


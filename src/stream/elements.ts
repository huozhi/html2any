export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

/** Elements whose body is raw text: no tags, no entities. */
export const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp'])

/** Raw text elements whose body still decodes character references (RCDATA). */
export const RCDATA_ELEMENTS = new Set(['textarea', 'title'])

/** Inline / phrasing content. */
export const PHRASING_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn',
  'em', 'font', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'mark', 'q', 's',
  'samp', 'select', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'svg',
  'textarea', 'time', 'tt', 'u', 'var', 'wbr', 'button', 'output', 'meter',
  'progress', 'picture', 'math',
])

/** Start tags that implicitly close an open <p>. */
export const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog',
  'dir', 'div', 'dl', 'dd', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
  'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
])

export const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** Elements that belong in <head> when a fragment is wrapped into a document. */
export const HEAD_ELEMENTS = new Set(['base', 'link', 'meta', 'style', 'title'])

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

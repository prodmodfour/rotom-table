import { vi } from 'vitest'

class FakeClassList {
  constructor(private readonly owner: FakeHTMLElement) {}

  private values(): Set<string> {
    return new Set(this.owner.className.split(/\s+/).filter(Boolean))
  }

  private write(values: Set<string>) {
    this.owner.className = Array.from(values).join(' ')
  }

  contains(value: string): boolean {
    return this.values().has(value)
  }

  toggle(value: string, force?: boolean): boolean {
    const values = this.values()
    const next = force ?? !values.has(value)

    if (next) values.add(value)
    else values.delete(value)

    this.write(values)
    return next
  }

  add(...tokens: string[]) {
    const values = this.values()
    for (const token of tokens) values.add(token)
    this.write(values)
  }

  remove(...tokens: string[]) {
    const values = this.values()
    for (const token of tokens) values.delete(token)
    this.write(values)
  }
}

export class FakeHTMLElement {
  readonly tagName: string
  readonly style: Record<string, string | boolean> = {}
  readonly dataset: Record<string, string> = {}
  readonly children: FakeHTMLElement[] = []
  readonly classList = new FakeClassList(this)
  className = ''
  hidden = false
  title = ''
  ownerDocument: { defaultView: { Element: typeof FakeHTMLElement } } | null = null
  parentElement: FakeHTMLElement | null = null
  private attributes = new Map<string, string>()
  private ownTextContent = ''

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
  }

  get parentNode(): FakeHTMLElement | null {
    return this.parentElement
  }

  get textContent(): string {
    return `${this.ownTextContent}${this.children.map((child) => child.textContent).join('')}`
  }

  set textContent(value: string | null) {
    this.ownTextContent = value ?? ''
  }

  set innerHTML(value: string) {
    this.ownTextContent = value
  }

  get innerHTML(): string {
    return this.ownTextContent
  }

  setAttribute(name: string, value: string) {
    if (name === 'class') this.className = value
    else if (name === 'title') this.title = value
    this.attributes.set(name, value)
  }

  removeAttribute(name: string) {
    if (name === 'title') this.title = ''
    this.attributes.delete(name)
  }

  append(...nodes: FakeHTMLElement[]) {
    for (const node of nodes) this.appendChild(node)
  }

  appendChild<TNode extends FakeHTMLElement>(node: TNode): TNode {
    node.parentElement = this
    this.children.push(node)
    return node
  }

  replaceChildren(...nodes: FakeHTMLElement[]) {
    for (const child of this.children) child.parentElement = null
    this.children.splice(0, this.children.length)
    this.append(...nodes)
  }

  querySelector<TElement extends HTMLElement = HTMLElement>(selector: string): TElement | null {
    if (!selector.startsWith('.')) return null

    const className = selector.slice(1)
    const queue = [...this.children]
    while (queue.length) {
      const next = queue.shift()!
      if (next.className.split(/\s+/).includes(className)) return next as unknown as TElement
      queue.push(...next.children)
    }

    return null
  }

  remove() {
    if (!this.parentElement) return
    const index = this.parentElement.children.indexOf(this)
    if (index >= 0) this.parentElement.children.splice(index, 1)
    this.parentElement = null
  }
}

export class FakeHTMLImageElement extends FakeHTMLElement {
  src = ''
  alt = ''
  loading = ''
  decoding = ''

  constructor() {
    super('img')
  }
}

export const installFakeDom = () => {
  const fakeDocument = {
    defaultView: {
      Element: FakeHTMLElement,
    },
    createElement: (tagName: string) => {
      const element = tagName.toLowerCase() === 'img'
        ? new FakeHTMLImageElement()
        : new FakeHTMLElement(tagName)
      element.ownerDocument = fakeDocument
      return element
    },
  }

  vi.stubGlobal('HTMLElement', FakeHTMLElement)
  vi.stubGlobal('HTMLImageElement', FakeHTMLImageElement)
  vi.stubGlobal('document', fakeDocument)
}

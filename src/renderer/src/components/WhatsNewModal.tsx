import { type ReactNode } from 'react'
import { useApp } from '../state/AppState'

/**
 * "What's new in v…" popup. Shown when the app starts on a version it has
 * never run before (i.e. right after an update), and when the user dismisses
 * an available-update popup without installing it. The body is the GitHub
 * release notes (markdown), rendered with a small subset renderer: headings,
 * bullet lists, paragraphs, bold/italic, inline code and links.
 *
 * Links open only via the main process, which allowlists https://github.com/
 * URLs — release notes are editable text and must not become a launcher for
 * arbitrary sites.
 */

interface InlineToken {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  href?: string
}

const INLINE_RE =
  /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`/g

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let last = 0
  for (const match of text.matchAll(INLINE_RE)) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index) })
    const [, imgAlt, imgHref, linkText, linkHref, bold, italic, code] = match
    if (imgHref !== undefined) tokens.push({ text: imgAlt || imgHref, href: imgHref })
    else if (linkHref !== undefined) tokens.push({ text: linkText, href: linkHref })
    else if (bold !== undefined) tokens.push({ text: bold, bold: true })
    else if (italic !== undefined) tokens.push({ text: italic, italic: true })
    else if (code !== undefined) tokens.push({ text: code, code: true })
    last = match.index + match[0].length
  }
  if (last < text.length) tokens.push({ text: text.slice(last) })
  return tokens
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`
    if (token.href !== undefined) {
      return (
        <Link text={token.text} href={token.href} key={key} />
      )
    }
    if (token.code) return <code key={key}>{token.text}</code>
    if (token.bold) return <strong key={key}>{token.text}</strong>
    if (token.italic) return <em key={key}>{token.text}</em>
    return token.text
  })
}

function Link({ text, href }: { text: string; href: string }): JSX.Element {
  const { pushToast } = useApp()
  const open = async (): Promise<void> => {
    try {
      const opened = await window.api.openUrl(href)
      if (!opened) pushToast('info', 'Only links to github.com can be opened from the app.')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        void open()
      }}
    >
      {text}
    </a>
  )
}

/** Pure markdown→React-blocks renderer, exported for tests. */
export function renderBlocks(markdown: string): ReactNode[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let list: string[] = []
  let key = 0

  const flushList = (): void => {
    if (list.length === 0) return
    const items = list
    list = []
    blocks.push(
      <ul className="whatsnew__list" key={`ul-${key++}`}>
        {items.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>
    )
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''))
      continue
    }
    flushList()
    if (line === '') continue
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <h3 className="whatsnew__heading" key={`h-${key++}`}>
          {renderInline(heading[2], `h-${key}`)}
        </h3>
      )
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push(<hr className="whatsnew__hr" key={`hr-${key++}`} />)
      continue
    }
    blocks.push(
      <p className="whatsnew__p" key={`p-${key++}`}>
        {renderInline(line, `p-${key}`)}
      </p>
    )
  }
  flushList()
  return blocks
}

export function WhatsNewModal(): JSX.Element {
  const { whatsNew, dismissWhatsNew } = useApp()
  if (!whatsNew) return <></>
  return (
    <div className="modal-overlay">
      <div className="modal whatsnew" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title">
        <h2 id="whatsnew-title" className="modal__title">
          What&rsquo;s new in v{whatsNew.version}
        </h2>
        <div className="whatsnew__body">
          {whatsNew.notes
            ? renderBlocks(whatsNew.notes)
            : <p className="whatsnew__p">The release notes could not be loaded. Check the GitHub releases page for the full changelog.</p>}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={dismissWhatsNew}>
            Continue
          </button>
        </div>
        <div className="modal__license">ServerController © 2026. All rights reserved.</div>
      </div>
    </div>
  )
}

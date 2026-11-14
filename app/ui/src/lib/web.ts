// AI Studio's web tools: search (through OpenRouter's web search or the Tavily API) and fetching
// a page as readable text. Requests go through the Rust backend, which allows public hosts only.
import { backend } from './backend'

/** Good places to look, given to the model as a starting point. All of these served readable
 *  text to an automated fetch when checked (2026-11). Reddit, Equipboard, Reverb, Sweetwater and
 *  Fender block automated reads; their pages can still show up in search results. */
export const REFERENCES = [
  ['https://articles.boss.info/', 'BOSS Articles: "Patch Work" song recreations with exact BOSS/Katana settings, amp and effect guides'],
  ['https://articles.boss.info/patch-work-where-the-streets-have-no-name-by-u2/', 'Example Patch Work article (U2, dotted-eighth delay)'],
  ['https://www.boss.info/global/products/katana-50_gen_3/', 'Katana Gen 3 product page: amp types, effects, features'],
  ['https://www.boss.info/global/support/by_product/katana-50_gen_3/owners_manuals/', 'Katana Gen 3 owner\'s manual and parameter guide (PDF links)'],
  ['https://creepingnet.neocities.org/geartech/geartech/digital/katana', 'Long-form Katana user guide with patch recipes'],
  ['https://prosoundhq.com/boss-amp-settings-and-controls-how-to-use-a-boss-amplifier/', 'BOSS amp settings by genre'],
  ['https://www.guitarchalk.com/', 'Amp settings for specific songs (search "<song> amp settings site:guitarchalk.com")'],
  ['https://www.gearnews.com/', 'Tone breakdowns of famous songs (e.g. the Master of Puppets tone)'],
  ['https://www.guitarworld.com/gear', 'Guitar World: artist rigs, how-to-get-the-tone features'],
  ['https://www.musicradar.com/guitars', 'MusicRadar: tone guides, artist rig features'],
  ['https://www.guitarplayer.com/', 'Guitar Player: artist interviews, gear and tone'],
  ['https://www.ultimate-guitar.com/news/', 'Ultimate Guitar: artist gear interviews; tabs often name the tone used'],
] as const

export interface SearchKeys {
  engine: 'auto' | 'openrouter' | 'tavily' | 'off'
  openrouterKey: string
  tavilyKey: string
}

export interface SearchHit { title: string; url: string; snippet: string }

/** Which search service will be used, or why none can be. */
export function searchEngine(k: SearchKeys): { engine: 'openrouter' | 'tavily' } | { error: string } {
  if (k.engine === 'off') return { error: 'Web search is turned off in AI settings.' }
  if (k.engine === 'tavily' || (k.engine === 'auto' && k.tavilyKey)) {
    return k.tavilyKey ? { engine: 'tavily' } : { error: 'Web search is set to Tavily but there is no Tavily key in AI settings.' }
  }
  if (k.openrouterKey) return { engine: 'openrouter' }
  return { error: 'Web search needs an OpenRouter or Tavily key in AI settings.' }
}

export async function webSearch(query: string, k: SearchKeys, max = 6): Promise<SearchHit[]> {
  const e = searchEngine(k)
  if ('error' in e) throw new Error(e.error)
  return e.engine === 'tavily' ? tavily(query, k.tavilyKey, max) : openrouterSearch(query, k.openrouterKey, max)
}

async function tavily(query: string, key: string, max: number): Promise<SearchHit[]> {
  const res = await backend.httpRequest({
    url: 'https://api.tavily.com/search', method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: max, search_depth: 'basic' }),
  })
  if (res.status !== 200) throw new Error(`Tavily answered ${res.status}: ${res.body.slice(0, 200)}`)
  const data = JSON.parse(res.body) as { results?: { title?: string; url: string; content?: string }[] }
  return (data.results ?? []).map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: (r.content ?? '').slice(0, 700) }))
}

/** OpenRouter has no search-only endpoint: run a tiny completion with its web search (Exa)
 *  and read the results from the url_citation annotations. Costs about $0.007 per search. */
async function openrouterSearch(query: string, key: string, max: number): Promise<SearchHit[]> {
  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'X-Title': 'Katana Studio' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4.1-flash-1017',
        messages: [{ role: 'user', content: `Search the web for: ${query}\nReply with just "ok".` }],
        plugins: [{ id: 'web', engine: 'exa', max_results: max }],
        max_tokens: 16,
      }),
    })
  } catch {
    throw new Error("Couldn't reach openrouter.ai for web search.")
  }
  if (!res.ok) throw new Error(`OpenRouter web search answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  type Ann = { type: string; url_citation?: { url: string; title?: string; content?: string } }
  const data = await res.json()
  const anns = (data.choices?.[0]?.message?.annotations ?? []) as Ann[]
  const seen = new Set<string>()
  return anns.flatMap((a) => {
    const c = a.url_citation
    if (a.type !== 'url_citation' || !c || seen.has(c.url)) return []
    seen.add(c.url)
    return [{ title: c.title ?? c.url, url: c.url, snippet: (c.content ?? '').replace(/\s+/g, ' ').slice(0, 700) }]
  })
}

const DROP = 'script, style, noscript, svg, iframe, form, nav, footer, header, aside, button, figure, [aria-hidden="true"], [role="navigation"], [role="complementary"]'
/** Class/id words of page furniture: share bars, menus, related links, comments, ads. */
const JUNK = /(^|[-_ ])(share|sharing|social|menu|nav|navbar|breadcrumbs?|related|recommended|comments?|sidebar|subscribe|newsletter|cookie|consent|advert|ads?|promo|popup|modal|footer|header|byline|tags|author-box)([-_ ]|$)/i

/** Remove menus and link lists: blocks that are mostly link text. */
function prune(root: Element) {
  const squash = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim()
  const linkShare = (e: Element, len: number) => [...e.querySelectorAll('a')].reduce((n, a) => n + squash(a.textContent).length, 0) / Math.max(1, len)
  // Furniture by class name, but only when it is small or mostly links: some sites put words
  // like "share" on the class of the main content wrapper.
  root.querySelectorAll('*').forEach((e) => {
    if (e === root || !e.isConnected || !JUNK.test(`${e.className} ${e.id}`)) return
    const len = squash(e.textContent).length
    if (len < 1500 || linkShare(e, len) > 0.4) e.remove()
  })
  root.querySelectorAll('ul, ol, div, section, table, p').forEach((e) => {
    if (!e.isConnected) return
    const len = squash(e.textContent).length
    if (!len) return void e.remove()
    if (len < 3000 && linkShare(e, len) > 0.6) e.remove()
  })
}
const BLOCK = 'p, div, li, h1, h2, h3, h4, h5, h6, tr, br, section, article, blockquote, pre, table, ul, ol, dd, dt'

/** A web page as plain text for the model: main content only, capped at `limit` characters. */
export async function webFetch(url: string, limit = 12000): Promise<{ url: string; title: string; text: string }> {
  const res = await backend.httpRequest({ url })
  if (res.status >= 400) throw new Error(`${res.url} answered ${res.status}${res.status === 403 ? ' (the site blocks automated reading; try another source)' : ''}`)
  const type = res.contentType.toLowerCase()
  if (type.includes('pdf')) throw new Error('That is a PDF, which cannot be read here; look for an HTML page instead.')
  let title = ''
  let text: string
  if (type.includes('html') || /^\s*<(!doctype|html)/i.test(res.body)) {
    const doc = new DOMParser().parseFromString(res.body, 'text/html')
    title = doc.title.trim()
    doc.querySelectorAll(DROP).forEach((e) => e.remove())
    const root = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body
    if (root) prune(root)
    // textContent ignores layout, so mark block boundaries as line breaks first.
    root?.querySelectorAll(BLOCK).forEach((e) => e.append(doc.createTextNode('\n')))
    root?.querySelectorAll('h1, h2, h3, h4').forEach((e) => e.prepend(doc.createTextNode('\n## ')))
    text = root?.textContent ?? ''
  } else text = res.body
  text = text.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new Error('The page had no readable text (it may need JavaScript); try another source.')
  if (text.length > limit) text = text.slice(0, limit) + `\n[... cut at ${limit} characters]`
  return { url: res.url, title, text }
}

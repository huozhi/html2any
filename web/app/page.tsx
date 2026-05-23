import Browser from './browser'
import Usage from './usage'

export default function Page() {
  return (
    <main>
      <header className="page-header">
        <h1 className="title">html2any</h1>
        <p className="intro">Parse HTML/XML, then shape it into anything.</p>
      </header>
      <Browser />
      <Usage />
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-[3px] border-[var(--ink)] pt-4 text-sm font-black uppercase">
        <a className="underline decoration-2 underline-offset-4" href="https://github.com/huozhi/html2any" target="_blank" rel="noreferrer">
          github
        </a>
        <a className="underline decoration-2 underline-offset-4" href="https://x.com/huozhi" target="_blank" rel="noreferrer">
          huozhi
        </a>
      </footer>
    </main>
  )
}

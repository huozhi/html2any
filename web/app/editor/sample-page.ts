export const SAMPLE_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lumen Notes — a quiet place for your thoughts</title>
  <style>
    :root {
      --ink: #1d1b16;
      --muted: #6b665b;
      --paper: #faf8f3;
      --card: #ffffff;
      --line: #e8e3d8;
      --accent: #2f5d50;
      --accent-soft: #e4efe9;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--ink);
      background: var(--paper);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
    .nav { display: flex; align-items: center; justify-content: space-between; padding: 22px 0; }
    .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.01em; }
    .logo-mark { width: 28px; height: 28px; border-radius: 8px; background: var(--accent); display: grid; place-items: center; color: #fff; font-size: 15px; }
    .links { display: flex; gap: 28px; font-size: 15px; color: var(--muted); }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 999px; font-weight: 600; font-size: 15px; border: 1px solid transparent; }
    .btn-primary { background: var(--ink); color: #fff; }
    .btn-ghost { border-color: var(--line); background: var(--card); }
    .hero { padding: 72px 0 56px; text-align: center; }
    .eyebrow { display: inline-block; padding: 6px 14px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
    .hero h1 { margin: 22px auto 18px; max-width: 760px; font-size: clamp(40px, 6vw, 68px); line-height: 1.04; letter-spacing: -0.035em; font-weight: 750; }
    .hero p { margin: 0 auto 32px; max-width: 560px; font-size: 19px; color: var(--muted); }
    .actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
    .preview { margin: 56px auto 0; max-width: 880px; border-radius: 20px; border: 1px solid var(--line); background: var(--card); box-shadow: 0 30px 60px -30px rgba(29, 27, 22, 0.25); overflow: hidden; text-align: left; }
    .preview-bar { display: flex; gap: 6px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .preview-bar span { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
    .preview-body { display: grid; grid-template-columns: 200px 1fr; min-height: 260px; }
    .preview-side { padding: 18px; border-right: 1px solid var(--line); font-size: 14px; color: var(--muted); display: grid; gap: 10px; align-content: start; }
    .preview-side b { color: var(--ink); font-weight: 600; }
    .preview-main { padding: 28px 32px; }
    .preview-main h3 { margin: 0 0 10px; font-size: 22px; letter-spacing: -0.01em; }
    .preview-main p { margin: 0 0 12px; color: var(--muted); }
    section { padding: 72px 0; }
    .section-title { text-align: center; margin: 0 0 12px; font-size: 36px; letter-spacing: -0.025em; }
    .section-lead { text-align: center; margin: 0 auto 44px; max-width: 520px; color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .card { padding: 26px; border-radius: 18px; border: 1px solid var(--line); background: var(--card); }
    .card .icon { width: 40px; height: 40px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-size: 20px; }
    .card h3 { margin: 18px 0 8px; font-size: 19px; letter-spacing: -0.01em; }
    .card p { margin: 0; color: var(--muted); font-size: 15px; }
    .quote { text-align: center; padding: 56px 0; }
    .quote blockquote { margin: 0 auto; max-width: 720px; font-size: 26px; line-height: 1.4; letter-spacing: -0.015em; }
    .quote cite { display: block; margin-top: 18px; font-style: normal; color: var(--muted); font-size: 15px; }
    .tier { padding: 30px; border-radius: 20px; border: 1px solid var(--line); background: var(--card); display: flex; flex-direction: column; gap: 14px; }
    .tier.featured { background: var(--ink); color: #fff; border-color: var(--ink); }
    .tier.featured .tier-note, .tier.featured li { color: rgba(255, 255, 255, 0.72); }
    .tier h3 { margin: 0; font-size: 17px; }
    .price { font-size: 40px; font-weight: 700; letter-spacing: -0.03em; }
    .price small { font-size: 15px; font-weight: 500; opacity: 0.6; }
    .tier-note { margin: 0; color: var(--muted); font-size: 14px; }
    .tier ul { margin: 6px 0 10px; padding: 0; list-style: none; display: grid; gap: 8px; font-size: 15px; color: var(--muted); }
    .tier li::before { content: "✓"; margin-right: 10px; color: var(--accent); font-weight: 700; }
    .tier.featured li::before { color: #9fd8c3; }
    .tier .btn { justify-content: center; margin-top: auto; }
    .tier.featured .btn { background: #fff; color: var(--ink); }
    .faq { max-width: 720px; margin: 0 auto; display: grid; gap: 12px; }
    details { padding: 18px 22px; border-radius: 14px; border: 1px solid var(--line); background: var(--card); }
    summary { cursor: pointer; font-weight: 600; }
    details p { margin: 10px 0 0; color: var(--muted); }
    .cta { margin: 24px 0 72px; padding: 56px 32px; border-radius: 28px; background: var(--accent); color: #fff; text-align: center; }
    .cta h2 { margin: 0 0 10px; font-size: 34px; letter-spacing: -0.025em; }
    .cta p { margin: 0 0 26px; opacity: 0.8; }
    .cta .btn { background: #fff; color: var(--ink); }
    footer { border-top: 1px solid var(--line); padding: 28px 0 40px; color: var(--muted); font-size: 14px; }
    footer .wrap { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    @media (max-width: 760px) {
      .links { display: none; }
      .grid { grid-template-columns: 1fr; }
      .preview-body { grid-template-columns: 1fr; }
      .preview-side { display: none; }
    }
  </style>
</head>
<body>
  <header class="wrap nav">
    <a class="logo" href="#"><span class="logo-mark">L</span>Lumen Notes</a>
    <nav class="links">
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
    </nav>
    <a class="btn btn-ghost" href="#pricing">Sign in</a>
  </header>

  <main>
    <div class="wrap hero">
      <span class="eyebrow">New &middot; Daily review</span>
      <h1>A quiet place for your thoughts.</h1>
      <p>Lumen keeps your notes calm, searchable and private. Write freely, find anything in a second, and let the clutter fade away.</p>
      <div class="actions">
        <a class="btn btn-primary" href="#pricing">Start writing &rarr;</a>
        <a class="btn btn-ghost" href="#features">See how it works</a>
      </div>
      <div class="preview">
        <div class="preview-bar"><span></span><span></span><span></span></div>
        <div class="preview-body">
          <div class="preview-side">
            <b>Today</b>
            <span>Reading list</span>
            <span>Garden plans</span>
            <span>Weekend trip</span>
          </div>
          <div class="preview-main">
            <h3>Garden plans</h3>
            <p>Tomatoes along the south fence, basil in the pots by the door. Ask Mia about the old rain barrel.</p>
            <p>Order seeds before <strong>March 12</strong>.</p>
          </div>
        </div>
      </div>
    </div>

    <section id="features">
      <div class="wrap">
        <h2 class="section-title">Everything stays in its place</h2>
        <p class="section-lead">Three simple ideas that make writing feel light again.</p>
        <div class="grid">
          <div class="card">
            <div class="icon">✎</div>
            <h3>Write without friction</h3>
            <p>Open the app and start typing. No folders to choose, no formatting to fight.</p>
          </div>
          <div class="card">
            <div class="icon">⌕</div>
            <h3>Find anything instantly</h3>
            <p>Search every note by word, date or feeling. Results appear as you type.</p>
          </div>
          <div class="card">
            <div class="icon">◐</div>
            <h3>Private by default</h3>
            <p>Your notes are encrypted on your device. Nobody else can read them, not even us.</p>
          </div>
        </div>
      </div>
    </section>

    <div class="wrap quote">
      <blockquote>&ldquo;It feels like a clean desk on a Sunday morning. I finally write things down again.&rdquo;</blockquote>
      <cite>Hana Okafor, teacher</cite>
    </div>

    <section id="pricing">
      <div class="wrap">
        <h2 class="section-title">Simple pricing</h2>
        <p class="section-lead">Start for free. Upgrade when Lumen becomes part of your day.</p>
        <div class="grid">
          <div class="tier">
            <h3>Free</h3>
            <div class="price">$0 <small>/ month</small></div>
            <p class="tier-note">For trying things out.</p>
            <ul><li>Unlimited notes</li><li>Search</li><li>One device</li></ul>
            <a class="btn btn-ghost" href="#">Get started</a>
          </div>
          <div class="tier featured">
            <h3>Personal</h3>
            <div class="price">$4 <small>/ month</small></div>
            <p class="tier-note">For everyday writing.</p>
            <ul><li>Everything in Free</li><li>All your devices</li><li>Daily review</li></ul>
            <a class="btn" href="#">Choose Personal</a>
          </div>
          <div class="tier">
            <h3>Family</h3>
            <div class="price">$9 <small>/ month</small></div>
            <p class="tier-note">For up to five people.</p>
            <ul><li>Everything in Personal</li><li>Shared notebooks</li><li>Priority help</li></ul>
            <a class="btn btn-ghost" href="#">Choose Family</a>
          </div>
        </div>
      </div>
    </section>

    <section id="faq">
      <div class="wrap">
        <h2 class="section-title">Questions</h2>
        <div class="faq">
          <details open><summary>Can I import my old notes?</summary><p>Yes. Drop in plain text, Markdown or HTML files and Lumen keeps their dates.</p></details>
          <details><summary>Does it work offline?</summary><p>Everything works offline. Changes sync quietly when you are back online.</p></details>
          <details><summary>What happens if I cancel?</summary><p>Your notes stay yours. Export everything in one click, any time.</p></details>
        </div>
      </div>
    </section>

    <div class="wrap">
      <div class="cta">
        <h2>Give your thoughts some room.</h2>
        <p>Free forever for one device. No card required.</p>
        <a class="btn" href="#pricing">Start writing</a>
      </div>
    </div>
  </main>

  <footer>
    <div class="wrap">
      <span>&copy; 2026 Lumen Notes</span>
      <span>Made with care, slowly.</span>
    </div>
  </footer>
</body>
</html>
`

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = '/api';
const FIELDS = [
  ['objective', 'Objective'], ['method', 'Methods'], ['dataset', 'Datasets'],
  ['setup', 'Setup & metrics'], ['results', 'Results'], ['limitations', 'Limitations']
];
const NAV = [
  ['overview', 'Overview', 'overview'], ['library', 'Paper library', 'library'],
  ['compare', 'Compare papers', 'compare'], ['themes', 'Themes & gaps', 'themes'],
  ['questions', 'Ask your papers', 'questions']
];
const SUGGESTIONS = ['Which datasets appear in these papers?', 'What limitations recur?', 'Which methods are compared?'];
const escText = (value) => value || 'Not found';

function Icon({ name, size = 18 }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    library: <><path d="M5 3h11l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h8"/></>,
    compare: <><path d="M4 7h14M14 3l4 4-4 4M20 17H6m4-4-4 4 4 4"/></>,
    themes: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5"/></>,
    questions: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    file: <><path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 13h8M8 17h8"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function App() {
  const [papers, setPapers] = useState([]);
  const [page, setPage] = useState('overview');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState([]);
  const [comparison, setComparison] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [topics, setTopics] = useState([]);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  const refresh = async (clearNotice = true) => {
    try {
      const res = await fetch(`${API}/papers`);
      if (!res.ok) throw new Error(`API_STATUS_${res.status}`);
      setPapers(await res.json());
      if (clearNotice) setNotice('');
      return true;
    } catch (error) {
      if (error.message.startsWith('API_STATUS_')) {
        const status = error.message.replace('API_STATUS_', '');
        let apiState = 'The API health check also failed.';
        try {
          const health = await fetch(`${API}/health`);
          if (health.ok) {
            const data = await health.json();
            apiState = data.ok ? 'Health check succeeded, so React and the Vite proxy are connected to Python. The error is specific to /api/papers.' : 'The health endpoint responded, but reported an unhealthy API.';
          } else apiState = `The health endpoint returned HTTP ${health.status}. Check the Vite proxy and Python server terminal.`;
        } catch { apiState = 'The health endpoint could not be reached through the Vite proxy. Check that Python is running on port 8000.'; }
        setNotice(`/api/papers returned HTTP ${status}. ${apiState} Check the relevant terminal output for the traceback.`);
      } else {
        setNotice(`Could not connect to the Paper API from ${window.location.origin}. Open this app at http://127.0.0.1:8000 and keep the Python server process running. ${error.message}`);
      }
      return false;
    }
  };
  useEffect(() => { refresh(); }, []);

  const evidenceCount = papers.reduce((sum, paper) => sum + Object.values(paper.claims || {}).flat().length, 0);
  const entities = [...new Set(papers.flatMap(paper => Object.values(paper.entities || {}).flat()))];
  const filtered = useMemo(() => papers.filter(paper => {
    const query = search.toLowerCase().trim();
    const searchable = `${paper.title} ${paper.filename} ${JSON.stringify(paper.entities || {})}`.toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (filter === 'evidence') return Object.values(paper.claims || {}).flat().length > 0;
    const groups = paper.entities || {};
    if (filter === 'method') return (groups['Methods & models'] || []).length > 0;
    if (filter === 'dataset') return (groups.Datasets || []).length > 0;
    if (filter === 'metric') return (groups.Metrics || []).length > 0;
    if (filter === 'topic') return (groups['Tasks & domains'] || []).length > 0;
    return true;
  }), [papers, search, filter]);

  async function uploadFiles(files) {
    if (!files?.length) return;
    setBusy(true);
    setNotice('');
    let completed = 0;
    const failures = [];
    for (const file of files) {
      setNotice(`Reading ${file.name}…`);
      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('Could not read this file from the browser.'));
          reader.readAsDataURL(file);
        });
        const response = await fetch(`${API}/upload`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, data })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
        completed++;
        setNotice(`Added ${file.name}. Extracted ${result.chars.toLocaleString()} characters${result.pages ? ` from ${result.pages} pages` : ''}.`);
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }
    const refreshed = await refresh(false);
    setBusy(false);
    if (completed) setPage('library');
    if (!refreshed) return;
    if (failures.length) setNotice(`${completed} paper${completed === 1 ? '' : 's'} added. ${failures.join(' | ')}`);
    else if (completed) setNotice(`${completed} paper${completed === 1 ? '' : 's'} added and ready in your library.`);
  }

  async function removePaper(paper) {
    if (!window.confirm(`Delete “${paper.title}” and its extracted data from this device?`)) return;
    try {
      const res = await fetch(`${API}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: paper.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete this paper.');
      setSelected(current => current.filter(id => id !== paper.id));
      await refresh();
    } catch (error) { setNotice(error.message); }
  }

  function navigate(next) {
    setPage(next);
    setNotice('');
    setComparison(false);
    if (next === 'themes') {
      fetch(`${API}/topics`).then(res => res.ok ? res.json() : []).then(setTopics).catch(() => setTopics([]));
    }
    window.history.replaceState(null, '', `#${next}`);
  }

  async function ask(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setAnswer({ loading: true });
    try {
      const res = await fetch(`${API}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not search the papers.');
      setAnswer(data);
    } catch (error) { setAnswer({ error: error.message }); }
  }

  const stats = [
    { label: 'Papers analyzed', value: papers.length, note: 'In this local library' },
    { label: 'Evidence passages', value: evidenceCount, note: 'Linked to uploaded sources' },
    { label: 'Detected entities', value: entities.length, note: 'Methods, datasets, metrics' },
    { label: 'Sections identified', value: papers.reduce((sum, p) => sum + (p.sections || []).length, 0), note: 'Headings found in source text' },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={e => { e.preventDefault(); navigate('overview'); }}>
        <span className="brand-mark">P</span><span className="brand-copy">Papertrail<small>RESEARCH WORKSPACE</small></span>
      </a>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="primary-nav" aria-label="Main navigation">
        {NAV.map(([id, label, icon]) => <button key={id} className={`nav-link ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}>
          <Icon name={icon} size={17}/><span>{label}</span>{id === 'library' && <b>{papers.length}</b>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><span className="storage-indicator"/><div><strong>Private workspace</strong><small>Files stay on this device</small></div></div>
        <div className="sidebar-legal"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumbs"><span>Research workspace</span><Icon name="chevron" size={13}/><strong>{NAV.find(([id]) => id === page)?.[1]}</strong></div>
        <div className="topbar-actions"><span className="local-indicator"><i/>Local mode</span><button className="btn btn-primary btn-small" onClick={() => inputRef.current?.click()}><Icon name="plus" size={15}/>Add papers</button></div>
      </header>
      <input ref={inputRef} className="sr-only" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" multiple onChange={e => { uploadFiles([...e.target.files]); e.target.value = ''; }}/>

      <div className="main-content">
        {notice && <div className={`notice-banner ${busy ? 'busy' : ''}`} role="status"><span>{busy && <span className="spinner"/>}{notice}{(notice.includes('Could not connect') || notice.includes('HTTP 5')) && <a className="api-check" href="/api/health" target="_blank" rel="noreferrer">Check API ↗</a>}</span><button aria-label="Dismiss" onClick={() => setNotice('')}><Icon name="close" size={15}/></button></div>}

        {page === 'overview' && <>
          <PageHeading eyebrow="YOUR RESEARCH, ORGANIZED" title="Research overview" description="A clear view of the evidence across your paper collection."/>
          <div className="stats-row">{stats.map(item => <div className="stat-card" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}</div>
          <div className="overview-grid">
            <section className="surface upload-surface">
              <div className="section-heading"><div><span className="eyebrow">BUILD YOUR LIBRARY</span><h2>Add research papers</h2><p>Upload papers to extract evidence and compare findings.</p></div><span className="section-mark"><Icon name="upload" size={19}/></span></div>
              <DropArea refObj={dropRef} disabled={busy} onFiles={uploadFiles}/>
              <div className="supported-formats">PDF · TXT · Markdown <span>PDFs need selectable text. Scans require OCR before import.</span></div>
            </section>
            <section className="surface recent-surface">
              <div className="section-heading section-heading-row"><div><span className="eyebrow">YOUR COLLECTION</span><h2>Recently added</h2></div><button className="btn btn-quiet" onClick={() => navigate('library')}>View library <Icon name="arrow" size={14}/></button></div>
              <RecentPapers papers={papers.slice(0, 4)} onOpen={() => navigate('library')}/>
            </section>
          </div>
          <div className="principle-note"><span className="note-mark">i</span><div><strong>Evidence first, interpretation second</strong><p>Extracted claims stay tied to passages in the source papers. Themes and gap suggestions describe this collection only, so treat them as leads for further review.</p></div></div>
        </>}

        {page === 'library' && <>
          <PageHeading eyebrow="YOUR COLLECTION" title="Paper library" description="Inspect source passages, detected entities, and structured findings." action={<button className="btn btn-primary" onClick={() => inputRef.current?.click()}><Icon name="plus" size={16}/>Add papers</button>}/>
          <div className="filter-toolbar"><label className="search-field"><Icon name="search" size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search papers, methods, datasets…"/></label><select className="filter-select" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter papers"><option value="all">All papers</option><option value="evidence">Has evidence</option><option value="method">Methods & models</option><option value="dataset">Datasets</option><option value="metric">Metrics</option><option value="topic">Tasks & domains</option></select><span className="result-count">{filtered.length} {filtered.length === 1 ? 'paper' : 'papers'}</span></div>
          {filtered.length ? <div className="paper-list">{filtered.map(paper => <PaperCard key={paper.id} paper={paper} onDelete={() => removePaper(paper)}/>)}</div> : <EmptyState title={papers.length ? 'No matching papers' : 'Your library is empty'} text={papers.length ? 'Try another search term or filter.' : 'Add your first paper to extract evidence and start comparing.'} action={!papers.length && <button className="btn btn-primary" onClick={() => inputRef.current?.click()}><Icon name="plus" size={15}/>Add a paper</button>}/>}
        </>}

        {page === 'compare' && <>
          <PageHeading eyebrow="SIDE BY SIDE" title="Compare papers" description="Compare objectives, methods, datasets, findings, and limitations from source evidence."/>
          <section className="surface compare-select"><div className="section-heading section-heading-row"><div><h2>Select papers</h2><p>Choose two to four papers from your library.</p></div><span className="selection-count">{selected.length} selected</span></div>
            {papers.length ? <div className="choice-grid">{papers.map(p => <label className={`paper-choice ${selected.includes(p.id) ? 'checked' : ''}`} key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(current => e.target.checked ? (current.length >= 4 ? current : [...current, p.id]) : current.filter(x => x !== p.id))}/><span className="choice-check"><Icon name="check" size={13}/></span><span className="choice-title">{p.title}</span></label>)}</div> : <div className="inline-empty">Add at least two papers to compare their evidence.</div>}
            <button className="btn btn-primary" disabled={selected.length < 2} onClick={() => setComparison(true)}>Compare selected <Icon name="arrow" size={15}/></button>
          </section>
          {comparison && <CompareTable papers={papers.filter(p => selected.includes(p.id))}/>}
        </>}

        {page === 'themes' && <>
          <PageHeading eyebrow="PATTERNS IN YOUR LIBRARY" title="Themes & potential gaps" description="Review recurring entities, corpus topics, and limitations found in your papers."/>
          <div className="caution-note"><strong>Interpret with care</strong><span>These observations cover only the papers in your library. They are possible directions to investigate, not claims of novelty or field-wide coverage.</span></div>
          {papers.length ? <ThemeView papers={papers} topics={topics}/> : <EmptyState title="No library patterns yet" text="Add papers to find recurring themes and evidence-backed questions." action={<button className="btn btn-primary" onClick={() => inputRef.current?.click()}><Icon name="plus" size={15}/>Add papers</button>}/>}
        </>}

        {page === 'questions' && <>
          <PageHeading eyebrow="GROUNDED IN YOUR DOCUMENTS" title="Ask your papers" description="Find relevant passages in your library and review the source evidence."/>
          <section className="surface question-surface">
            <div className="question-label"><span className="question-icon"><Icon name="search" size={17}/></span><div><strong>Search your paper collection</strong><small>Results come from uploaded documents only.</small></div></div>
            <div className="suggested-questions">{SUGGESTIONS.map(s => <button key={s} onClick={() => setQuestion(s)}>{s}</button>)}</div>
            <form onSubmit={ask}><textarea value={question} onChange={e => setQuestion(e.target.value)} rows="3" placeholder="For example: Which datasets are used most often?"/><div className="question-submit"><span>Source passages are shown with paper and page.</span><button className="btn btn-primary" disabled={!question.trim() || answer?.loading}>Find evidence <Icon name="arrow" size={15}/></button></div></form>
            {answer && <AnswerView answer={answer}/>}
          </section>
        </>}
      </div>
      <footer className="app-footer"><span>Papertrail Research <i/> Local document analysis</span><span>Claims linked to source passages</span></footer>
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className={`page-heading ${action ? 'with-action' : ''}`}><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-heading-action">{action}</div>}</div>;
}

function DropArea({ refObj, disabled, onFiles }) {
  const [dragging, setDragging] = useState(false);
  return <div ref={refObj} className={`drop-area ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`} onDragOver={e => {e.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={e => {e.preventDefault();setDragging(false);onFiles([...e.dataTransfer.files]);}}>
    <span className="drop-icon"><Icon name="upload" size={20}/></span><strong>{disabled ? 'Processing papers…' : 'Drop papers here'}</strong><span>or <button type="button" onClick={() => document.querySelector('input[type=file]')?.click()}>browse files</button></span>
  </div>;
}

function RecentPapers({ papers, onOpen }) {
  if (!papers.length) return <div className="recent-empty"><span className="empty-file"><Icon name="file" size={20}/></span><strong>No papers added yet</strong><p>Your uploaded papers will appear here.</p></div>;
  return <div className="recent-list">{papers.map(p => <button className="recent-item" key={p.id} onClick={onOpen}><span className="file-badge">PDF</span><span className="recent-title"><strong>{p.title}</strong><small>{(p.claims ? Object.values(p.claims).flat().length : 0)} evidence passages</small></span><Icon name="chevron" size={15}/></button>)}</div>;
}

function PaperCard({ paper, onDelete }) {
  const [open, setOpen] = useState(false);
  const groups = Object.entries(paper.entities || {}).flatMap(([category, values]) => values.map(value => ({ category, value })));
  const sections = paper.sections || [];
  return <article className="paper-card">
    <button className="paper-card-head" onClick={() => setOpen(x => !x)} aria-expanded={open}>
      <span className="file-badge">PDF</span><span className="paper-title-block"><strong>{paper.title}</strong><small>{paper.filename} <i/> {paper.chars.toLocaleString()} characters <i/> {sections.length} sections detected</small></span><span className="paper-evidence-count">{Object.values(paper.claims || {}).flat().length}<small>passages</small></span><span className={`expand-chevron ${open ? 'opened' : ''}`}><Icon name="chevron" size={17}/></span>
    </button>
    {open && <div className="paper-details">
      {!!sections.length && <div className="source-sections"><div className="detail-label">DETECTED SECTIONS</div><div className="section-chips">{sections.map((section, i) => <span key={`${section.heading}-${i}`}>{section.heading}<small>{section.passages}</small></span>)}</div></div>}
      <div className="claim-grid">{FIELDS.map(([key, label]) => <Claim key={key} label={label} claims={paper.claims?.[key] || []}/>)}</div>
      {!!groups.length && <div className="entity-area"><div className="detail-label">DETECTED ENTITIES</div><div className="entity-list">{groups.map(({ category, value }) => <span className="entity-chip" title={category} key={`${category}-${value}`}>{value}<small>{category}</small></span>)}</div></div>}
      <div className="paper-card-foot"><span>Passage-level extraction can miss paraphrases or specialized terms.</span><button className="delete-action" onClick={onDelete}><Icon name="trash" size={14}/>Delete paper</button></div>
    </div>}
  </article>;
}

function Claim({ label, claims }) {
  return <section className="claim-block"><h3>{label}</h3>{claims.length ? claims.slice(0, 3).map((claim, i) => <blockquote key={i}><p>“{claim.text}”</p><small>{claim.page ? `Page ${claim.page} · ` : ''}Source passage <span/> {Math.round((claim.confidence || 0) * 100)}% heuristic confidence</small></blockquote>) : <p className="not-found">Not found in extracted text.</p>}</section>;
}

function CompareTable({ papers }) {
  const commonTerms = (texts) => {
    const stop = new Set('this that with from were have using based results method study paper data their these which into'.split(' '));
    const sets = texts.map(text => new Set((text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter(word => !stop.has(word))));
    return sets.length > 1 ? [...sets[0]].filter(word => sets.every(set => set.has(word))).slice(0, 5) : [];
  };
  return <section className="comparison-results"><div className="section-heading"><div><span className="eyebrow">SOURCE-BACKED COMPARISON</span><h2>Evidence by research dimension</h2><p>Shared terms show wording in common, not scientific equivalence.</p></div></div><div className="comparison-scroll"><table className="comparison-table"><thead><tr><th>Dimension</th>{papers.map(p => <th key={p.id}>{p.title}</th>)}</tr></thead><tbody>{FIELDS.map(([key, label]) => {
    const claims = papers.map(p => (p.claims?.[key] || []).slice(0, 2));
    const words = commonTerms(claims.flat().map(c => c.text));
    return <tr key={key}><th scope="row">{label}{claims.every(group => group.length) && <span className="compare-hint">{words.length ? `Shared terms: ${words.join(', ')}` : 'Different source wording'}</span>}</th>{papers.map((paper, idx) => <td key={paper.id}>{claims[idx].length ? claims[idx].map((claim, i) => <div className="compare-claim" key={i}><p>{claim.text}</p><small>{claim.page ? `Page ${claim.page} · ` : ''}Source passage</small></div>) : <em>Not found</em>}</td>)}</tr>;
  })}</tbody></table></div></section>;
}

function ThemeView({ papers, topics }) {
  const groups = {};
  papers.forEach(p => Object.entries(p.entities || {}).forEach(([category, values]) => values.forEach(value => {
    groups[category] ||= {};
    groups[category][value] ||= new Set();
    groups[category][value].add(p.id);
  })));
  const limitations = papers.flatMap(p => (p.claims?.limitations || []).map(claim => ({ paper: p, claim })));
  const recurring = limitations.map(item => ({ ...item, related: limitations.filter(other => other.paper.id !== item.paper.id && overlap(item.claim.text, other.claim.text) > .14) })).filter(item => item.related.length);
  const datasets = groups.Datasets || {};
  return <div className="theme-layout">
    <section className="surface topic-surface"><div className="section-heading"><div><span className="eyebrow">TOPIC MODEL</span><h2>Corpus topics</h2><p>LDA terms estimated from the current paper set.</p></div></div>
      {topics.length ? <div className="topic-list">{topics.map((topic, i) => <div className="topic-row" key={i}><span className="topic-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{topic.name}</strong><p>{topic.terms?.join(' · ')}</p></div><small>{topic.documents} papers</small></div>)}</div> : <InlineEmpty text="Add at least three substantial papers to estimate corpus topics."/>}
    </section>
    <section className="surface"><div className="section-heading"><div><span className="eyebrow">RECURRING TERMS</span><h2>Recognized entities</h2><p>Counted from detected terms in your uploaded papers.</p></div></div>
      {Object.keys(groups).length ? <div className="entity-groups">{Object.entries(groups).map(([category, values]) => <div className="entity-group" key={category}><h3>{category}</h3>{Object.entries(values).sort((a,b) => b[1].size - a[1].size).slice(0, 10).map(([name, ids]) => <div className="frequency-row" key={name}><span>{name}</span><div className="frequency-track"><i style={{ width: `${Math.max(7, ids.size / papers.length * 100)}%` }}/></div><b>{ids.size}/{papers.length}</b></div>)}</div>)}</div> : <InlineEmpty text="No recognized entities found in this collection."/>}
    </section>
    <section className="surface gap-surface"><div className="section-heading"><div><span className="eyebrow">POTENTIAL RESEARCH DIRECTIONS</span><h2>Evidence to investigate</h2><p>Patterns in this library only; verify against each paper.</p></div></div>
      {recurring.length ? recurring.slice(0, 8).map((item, i) => <div className="gap-record" key={`${item.paper.id}-${i}`}><strong>{item.paper.title}{item.claim.page ? ` · p. ${item.claim.page}` : ''}</strong><blockquote>{item.claim.text}</blockquote><p>Lexically related limitations also appear in {new Set(item.related.map(x => x.paper.id)).size} other paper(s). Potential direction: investigate whether broader evaluation could address this constraint.</p></div>) : <InlineEmpty text="No recurring limitation passages are supported by this library yet."/>}
      <div className="rare-dataset-box"><strong>Dataset coverage in this collection</strong>{Object.entries(datasets).filter(([, ids]) => ids.size < papers.length).length ? Object.entries(datasets).filter(([, ids]) => ids.size < papers.length).map(([name, ids]) => <p key={name}><b>{name}</b> occurs in {ids.size} of {papers.length} papers. Check whether this collection's coverage suggests a direction worth investigating.</p>) : <p>No less-frequent dataset entries were detected, or the library has no recognized datasets.</p>}</div>
    </section>
  </div>;
}

function overlap(a, b) {
  const ignore = new Set('study paper future work limitation results however with from this that were have been into using'.split(' '));
  const left = new Set((a.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !ignore.has(w)));
  const right = new Set((b.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !ignore.has(w)));
  return [...left].filter(word => right.has(word)).length / Math.max(1, new Set([...left, ...right]).size);
}

function AnswerView({ answer }) {
  if (answer.loading) return <div className="answer-loading"><span className="spinner"/>Searching passages in your library…</div>;
  if (answer.error) return <div className="answer-error">{answer.error}</div>;
  return <div className="answer-results"><p className="answer-intro">{answer.answer}</p>{answer.citations?.length ? answer.citations.map((citation, i) => <article className="citation-card" key={i}><div className="citation-meta"><strong>{citation.title}</strong><span>{citation.page ? `Page ${citation.page}` : 'Page not available'} <i/> Match {Math.round(citation.score * 100)}%</span></div><blockquote>“{citation.text}”</blockquote></article>) : <div className="no-evidence">No supporting passages were found in the uploaded paper set.</div>}</div>;
}

function EmptyState({ title, text, action }) {
  return <div className="surface empty-state"><span className="empty-file"><Icon name="file" size={21}/></span><strong>{title}</strong><p>{text}</p>{action}</div>;
}
function InlineEmpty({ text }) { return <div className="inline-empty">{text}</div>; }

createRoot(document.getElementById('root')).render(<App/>);

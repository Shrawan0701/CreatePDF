import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, Check, FileText, Search, ShieldCheck, Star, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { VISIBLE_TOOLS as TOOLS, TOOL_CATEGORIES, searchTools } from '../data/tools';
import { RecentFilesPanel } from '../components/Layout';
import SavedDocumentsPanel from '../components/SavedDocumentsPanel';
import { HomeGuide } from '../seo/GuideContent';

const POPULAR = ['pdf-translator', 'images-to-pdf', 'chat-with-pdf', 'pdf-to-word'];
const FILTERS = ['All tools', 'Favorites', ...Object.values(TOOL_CATEGORIES)];
const ORDERED_TOOLS = Object.values(TOOL_CATEGORIES).flatMap(category => TOOLS.filter(tool => tool.category === category));

export default function Dashboard() {
  const { starredTools, toggleStarTool } = useApp();
  const [category, setCategory] = useState('All tools');
  const [query, setQuery] = useState('');
  const matches = query.trim() ? new Set(searchTools(query).map(tool => tool.id)) : null;
  const results = ORDERED_TOOLS.filter(tool => !matches || matches.has(tool.id)).filter(tool =>
    category === 'All tools' || (category === 'Favorites' ? starredTools.has(tool.id) : tool.category === category));

  return (
    <div className="workspace-home">
      <section className="workspace-intro">
        <div className="intro-copy">
          <div className="eyebrow"><span className="status-dot" /> YOUR EVERYDAY DOCUMENT WORKSPACE</div>
          <h1>Less PDF friction.<br /><span>More getting it done.</span></h1>
          <p>Make the edit. Merge the files. Send it off.<br className="desktop-break" /> Simple tools for everything between open and done.</p>
          <div className="intro-actions"><a href="#tools" className="btn btn-primary">Find your tool <ArrowDown size={16} /></a><Link to="/create-pdf" className="text-link">Start a blank PDF <ArrowUpRight size={15} /></Link></div>
          <div className="intro-proof"><span><Check size={14} /> Free to use</span><span><Check size={14} /> No account</span><span><Check size={14} /> No watermarks</span></div>
        </div>
        <div className="document-scene" aria-hidden="true">
          <div className="scene-orbit" />
          <div className="paper paper-back"><div className="paper-mini-logo" /><div className="paper-line" /><div className="paper-line short" /></div>
          <div className="paper paper-front"><div className="paper-top"><span className="paper-mini-logo" /><span>DOCUMENT / 001</span></div><div className="paper-heading">Good things.<br />All together.</div><div className="paper-line" /><div className="paper-line" /><div className="paper-line short" /><div className="paper-chart"><i /><i /><i /><i /><i /><i /></div><div className="paper-bottom"><span>Made with CreatePDF</span><Check size={12} /></div></div>
          <div className="scene-label"><span><Check size={14} /></span> Ready for what’s next.</div>
          <div className="scene-file"><FileText size={17} /><span>your-next-big-thing.pdf</span></div>
        </div>
      </section>
      <section className="popular-section" aria-labelledby="popular-title">
        <div className="section-heading"><h2 id="popular-title">A good place to start</h2><span>The everyday essentials</span></div>
        <div className="essential-grid">{POPULAR.map((id, i) => {
          const tool = TOOLS.find(t => t.id === id); const Icon = tool.icon;
          return <Link key={id} to={tool.route} className="essential-card"><div className="essential-top"><span className={`essential-icon tone-${i}`}><Icon size={22} strokeWidth={1.6} /></span><ArrowUpRight className="essential-arrow" size={18} /></div><h3>{tool.name}</h3><p>{tool.description}</p></Link>;
        })}</div>
      </section>
      <div className="local-promise"><div className="promise-icon"><ShieldCheck size={21} /></div><div><strong>Your files. Your device. Your business.</strong><p>Core PDF tools run on your device. AI tools send extracted text to AI when you use them.</p></div><span className="local-label"><span className="status-dot" /> LOCAL BY DEFAULT</span></div>
      <section id="tools" className="tool-library" aria-labelledby="library-title">
        <div className="library-heading"><div><div className="eyebrow">THE TOOLKIT</div><h2 id="library-title">Small tools. Big possibilities.</h2><p>Everything you need, without the extra steps.</p></div><label className="library-search"><Search size={17} /><input aria-label="Filter tools" placeholder="What do you need to do?" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label></div>
        <div className="library-filters" role="group" aria-label="Tool categories">{FILTERS.map(filter => <button key={filter} aria-pressed={category === filter} className={category === filter ? 'selected' : ''} onClick={() => setCategory(filter)}>{filter === 'Favorites' && <Star size={13} />}{filter}{filter === 'All tools' && <span>{TOOLS.length}</span>}</button>)}</div>
        <div className="library-result-count" aria-live="polite">{results.length} {results.length === 1 ? 'tool' : 'tools'}{category !== 'All tools' ? ` · ${category}` : ' at your fingertips'}</div>
        <div className="directory-grid">{results.map(tool => {
          const Icon = tool.icon; const starred = starredTools.has(tool.id);
          return <article className="directory-item" key={tool.id}><Link to={tool.route}><span className="directory-icon"><Icon size={20} strokeWidth={1.6} /></span><div><h3>{tool.name}</h3><p>{tool.description}</p></div></Link><button className={`directory-star ${starred ? 'is-starred' : ''}`} aria-label={`${starred ? 'Remove' : 'Add'} ${tool.name} ${starred ? 'from' : 'to'} favorites`} aria-pressed={starred} onClick={() => toggleStarTool(tool.id)}><Star size={15} fill={starred ? 'currentColor' : 'none'} /></button></article>;
        })}</div>
        {!results.length && <div className="library-empty"><Search size={26} /><h3>{category === 'Favorites' && !query ? 'Keep your go-to tools close.' : 'No matching tools'}</h3><p>{category === 'Favorites' && !query ? 'Select the star beside any tool to save it here.' : 'Try another search or choose a different category.'}</p><button className="btn btn-secondary" onClick={() => { setQuery(''); setCategory('All tools'); }}>View all tools</button></div>}
      </section>
      <HomeGuide LinkComponent={Link} />
      <section id="documents" className="documents-section"><div className="eyebrow">PICK UP WHERE YOU LEFT OFF</div><SavedDocumentsPanel /><RecentFilesPanel /></section>
      <footer className="workspace-footer"><Link to="/" className="footer-wordmark">createpdf<span>.si</span></Link><p>A little less busywork. A little more possibility.</p><Link to="/settings">Preferences <ArrowUpRight size={13} /></Link></footer>
    </div>
  );
}

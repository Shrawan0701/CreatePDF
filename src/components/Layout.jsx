import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, Star, Sun, Moon, Download, Settings, Clock, Trash2, X, ArrowUpRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TOOLS, searchTools } from '../data/tools';
import { clearRecentFiles } from '../services/storage';
import createPdfLogo from '../assets/createpdf.png';

export function Topbar({ breadcrumbs = [] }) {
  const { toggleTheme, theme, isOnline, setSearchOpen, installPwa, deferredInstallPrompt } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenuOpen(false); }, [location]);
  useEffect(() => {
    const close = e => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  return <>
    <header className="workspace-header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="CreatePDF home"><img className="brand-symbol" src={createPdfLogo} width="35" height="35" alt="" /><span>createpdf<span className="brand-domain">.si</span></span></Link>
        <nav className={`workspace-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          <Link to="/" className={location.pathname === '/' && !location.hash ? 'active' : ''}>Overview</Link>
          <Link to="/#tools" className={location.hash === '#tools' ? 'active' : ''}>All tools <span className="nav-count">{TOOLS.length}</span></Link>
          <Link to="/#documents" className={location.hash === '#documents' ? 'active' : ''}>My files</Link>
          <Link to="/pdf-workflow" className={location.pathname === '/pdf-workflow' ? 'active' : ''}>Workflows <ArrowUpRight size={12} /></Link>
        </nav>
        <div className="header-actions">
          <button className="header-search" onClick={() => setSearchOpen(true)} aria-label="Search tools"><Search size={16} /><span>Quick find</span><kbd>Ctrl K</kbd></button>
          {deferredInstallPrompt && <button className="header-install" onClick={installPwa} title="Install CreatePDF"><Download size={15} /><span>Install app</span></button>}
          <span className={`connection-dot ${isOnline ? '' : 'is-offline'}`} title={isOnline ? 'Online' : 'Offline'} aria-label={isOnline ? 'Online' : 'Offline'} />
          <button className="icon-btn theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link to="/settings" className="icon-btn settings-link" aria-label="Settings"><Settings size={18} /></Link>
          <button className="icon-btn mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
    </header>
    {breadcrumbs.length > 0 && <div className="workspace-breadcrumb"><Link to="/">Workspace</Link>{breadcrumbs.map(crumb => <span key={crumb}><span className="breadcrumb-slash">/</span>{crumb}</span>)}</div>}
  </>;
}

export function SearchModal() {
  const { searchOpen, setSearchOpen, starredTools, toggleStarTool } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);

  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  const results = query.trim() ? searchTools(query) : TOOLS.slice(0, 10);

  useEffect(() => {
    const handler = (e) => {
      if (!searchOpen) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && results[selected]) {
        navigate(results[selected].route);
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, results, selected, navigate, setSearchOpen]);

  if (!searchOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Search tools" className="modal search-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrapper">
          <Search size={18} color="var(--primary)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Search all tools…"
          />
          <button className="icon-btn" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={16} /></button>
        </div>
        <div className="search-results">
          {results.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              No tools found for "{query}"
            </div>
          ) : (
            results.map((tool, i) => {
              const Icon = tool.icon;
              return (
                <Link
                  key={tool.id}
                  to={tool.route}
                  className={`search-result-item ${i === selected ? 'selected' : ''}`}
                  onClick={() => setSearchOpen(false)}
                >
                  <div className={`search-result-icon cat-${tool.catKey}`}>
                    {Icon && <Icon size={18} />}
                  </div>
                  <div className="search-result-info">
                    <div className="search-result-name">{tool.name}</div>
                    <div className="search-result-cat">{tool.category}</div>
                  </div>
                  <button
                    className="icon-btn"
                    style={{ opacity: starredTools.has(tool.id) ? 1 : 0 }}
                    onClick={(e) => { e.preventDefault(); toggleStarTool(tool.id); }}
                  >
                    <Star size={14} fill={starredTools.has(tool.id) ? 'var(--warning)' : 'none'} color={starredTools.has(tool.id) ? 'var(--warning)' : 'currentColor'} />
                  </button>
                </Link>
              );
            })
          )}
        </div>
        {results.length > 0 && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>Esc close</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================
// Recent Files Panel
// ===========================
export function RecentFilesPanel() {
  const { recentFiles } = useApp();
  const [cleared, setCleared] = useState(false);

  const handleClear = async () => {
    await clearRecentFiles();
    setCleared(true);
  };

  const files = cleared ? [] : recentFiles.slice(0, 6);

  if (files.length === 0) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="section-header">
        <div>
          <h2 className="section-title" style={{ fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="var(--primary)" /> Recent Files
          </h2>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={handleClear}>
          <Trash2 size={13} /> Clear
        </button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        {files.map((f) => (
          <div key={f.id} style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--border-radius-sm)',
            padding: '8px 14px',
            fontSize: 'var(--font-size-xs)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-secondary)',
            maxWidth: 220,
          }}>
            <span style={{ fontSize: 18 }}>📄</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu, Search, Star, ChevronRight, Sun, Moon, Wifi, WifiOff,
  Download, Settings, Home, Trash2, Clock, X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TOOLS, TOOL_CATEGORIES, searchTools } from '../data/tools';
import { clearRecentFiles } from '../services/storage';

// ===========================
// Sidebar
// ===========================
const CATEGORY_ORDER = [
  { key: TOOL_CATEGORIES.SCAN_WORKFLOW, label: 'Scan & Workflow', catKey: 'scan' },
  { key: TOOL_CATEGORIES.PAGE_MANAGEMENT, label: 'Page Management', catKey: 'page' },
  { key: TOOL_CATEGORIES.EDIT_ANNOTATE, label: 'Edit & Annotate', catKey: 'edit' },
  { key: TOOL_CATEGORIES.CREATE_PDF, label: 'Create to PDF', catKey: 'create' },
  { key: TOOL_CATEGORIES.CONVERT_FROM, label: 'Convert to Other', catKey: 'convert' },
  { key: TOOL_CATEGORIES.SECURITY, label: 'Security & Privacy', catKey: 'security' },
  { key: TOOL_CATEGORIES.BUSINESS, label: 'Business', catKey: 'business' },
  { key: TOOL_CATEGORIES.COLLABORATE, label: 'Collaborate & Share', catKey: 'collab' },
];

export function Sidebar() {
  const { sidebarCollapsed, starredTools, toggleStarTool,
          mobileSidebarOpen, setMobileSidebarOpen, setSearchOpen } = useApp();
  const location = useLocation();
  const [openCats, setOpenCats] = useState(new Set(['Scan & Workflow', 'Page Management']));
  const [query, setQuery] = useState('');
  const searchResults = query.trim() ? searchTools(query) : [];

  const toggleCat = (label) => {
    setOpenCats((prev) => {
      const s = new Set(prev);
      if (s.has(label)) s.delete(label);
      else s.add(label);
      return s;
    });
  };

  const isActive = (route) => location.pathname === route;

  return (
    <>
      {/* Mobile backdrop */}
      {mobileSidebarOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">P</div>
          <div className="sidebar-logo-text">
            <h1>CreatePDF</h1>
            <span>.si</span>
          </div>
        </div>

        {/* Search */}
        <div className="sidebar-search">
          <div className="sidebar-search-wrapper">
            <Search size={14} className="sidebar-search-icon" />
            <input
              className="sidebar-search-input"
              placeholder="Search tools… Ctrl+K"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (!query) setSearchOpen(true); }}
            />
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {/* Dashboard */}
          <Link
            to="/"
            className={`sidebar-item ${isActive('/') ? 'active' : ''}`}
            onClick={() => setMobileSidebarOpen(false)}
          >
            <Home size={16} className="item-icon" />
            <span className="item-label">Dashboard</span>
          </Link>

          {/* Search results */}
          {searchResults.length > 0 && (
            <>
              <div className="sidebar-section-label">Results</div>
              {searchResults.slice(0, 8).map((tool) => (
                <SidebarItem
                  key={tool.id}
                  tool={tool}
                  active={isActive(tool.route)}
                  starred={starredTools.has(tool.id)}
                  onStar={() => toggleStarTool(tool.id)}
                  onClick={() => setMobileSidebarOpen(false)}
                />
              ))}
            </>
          )}

          {/* Starred */}
          {!query && starredTools.size > 0 && (
            <>
              <div className="sidebar-section-label">Starred</div>
              {TOOLS.filter((t) => starredTools.has(t.id)).map((tool) => (
                <SidebarItem
                  key={tool.id}
                  tool={tool}
                  active={isActive(tool.route)}
                  starred={true}
                  onStar={() => toggleStarTool(tool.id)}
                  onClick={() => setMobileSidebarOpen(false)}
                />
              ))}
            </>
          )}

          {/* Categories */}
          {!query && CATEGORY_ORDER.map((cat) => {
            const tools = TOOLS.filter((t) => t.category === cat.key);
            const open = openCats.has(cat.label);
            return (
              <div key={cat.key}>
                <div
                  className={`sidebar-category-toggle ${open ? 'open' : ''}`}
                  onClick={() => toggleCat(cat.label)}
                >
                  <span className="item-label" style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: 'var(--text-muted)' }}>
                    {cat.label}
                  </span>
                  <ChevronRight size={13} className="category-arrow" style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                </div>
                {open && (
                  <div className="sidebar-category-children">
                    {tools.map((tool) => (
                      <SidebarItem
                        key={tool.id}
                        tool={tool}
                        active={isActive(tool.route)}
                        starred={starredTools.has(tool.id)}
                        onStar={() => toggleStarTool(tool.id)}
                        onClick={() => setMobileSidebarOpen(false)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <Link
            to="/settings"
            className={`sidebar-item ${isActive('/settings') ? 'active' : ''}`}
          >
            <Settings size={16} className="item-icon" />
            <span className="item-label">Settings</span>
          </Link>
        </div>
      </aside>
    </>
  );
}

function SidebarItem({ tool, active, starred, onStar, onClick }) {
  const Icon = tool.icon;
  return (
    <Link
      to={tool.route}
      className={`sidebar-item ${active ? 'active' : ''} ${starred ? 'starred' : ''}`}
      onClick={onClick}
    >
      {Icon && <Icon size={15} className="item-icon" />}
      <span className="item-label">{tool.name}</span>
      <button
        className="star-btn"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStar(); }}
        title={starred ? 'Unstar' : 'Star'}
      >
        <Star size={12} fill={starred ? 'currentColor' : 'none'} />
      </button>
    </Link>
  );
}

// ===========================
// Topbar
// ===========================
export function Topbar({ breadcrumbs = [] }) {
  const { toggleSidebar, toggleTheme, theme, isOnline, setMobileSidebarOpen,
          setSearchOpen, installPwa, deferredInstallPrompt } = useApp();

  return (
    <header className="topbar">
      <button className="topbar-toggle" aria-label="Open navigation" onClick={() => {
        const isMobile = window.innerWidth < 769;
        if (isMobile) setMobileSidebarOpen((v) => !v);
        else toggleSidebar();
      }}>
        <Menu size={18} />
      </button>

      {breadcrumbs.length > 0 && (
        <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
          <Link to="/" className="crumb" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="breadcrumb-segment">
              <span className="sep">/</span>
              <span className="crumb">{crumb}</span>
            </span>
          ))}
        </nav>
      )}

      <div className="topbar-actions">
        <button
          className="topbar-search"
          onClick={() => setSearchOpen(true)}
          title="Search tools (Ctrl+K)"
        >
          <Search size={14} />
          <span>Search tools…</span>
          <span style={{ fontSize: 11, background: 'var(--bg-surface-2)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>Ctrl K</span>
        </button>

        {deferredInstallPrompt && (
          <button className="pwa-install-btn" onClick={installPwa} title="Install app">
            <Download size={14} />
            <span>Install App</span>
          </button>
        )}

        <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <div className="icon-btn" title={isOnline ? 'Online' : 'Offline'}>
          {isOnline
            ? <Wifi size={16} style={{ color: 'var(--success)' }} />
            : <WifiOff size={16} style={{ color: 'var(--danger)' }} />}
        </div>
      </div>
    </header>
  );
}

// ===========================
// Search Modal
// ===========================
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
      <div className="modal search-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrapper">
          <Search size={18} color="var(--primary)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Search all tools…"
          />
          <button className="icon-btn" onClick={() => setSearchOpen(false)}><X size={16} /></button>
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

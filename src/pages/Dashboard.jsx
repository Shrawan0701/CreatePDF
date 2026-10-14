import { Link } from 'react-router-dom';
import {
  Zap, Shield, Download, Star, Search, Receipt, Share2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TOOLS, TOOL_CATEGORIES } from '../data/tools';
import { RecentFilesPanel } from '../components/Layout';

const QUICK_TOOLS = [
  'edit-pdf', 'sign-pdf', 'merge-pdf', 'compress-pdf',
  'split-pdf', 'pdf-to-word', 'images-to-pdf', 'scan-document',
];

const CATEGORY_ORDER = [
  { key: TOOL_CATEGORIES.PAGE_MANAGEMENT, label: 'Page Management' },
  { key: TOOL_CATEGORIES.EDIT_ANNOTATE, label: 'Edit & Annotate' },
  { key: TOOL_CATEGORIES.CREATE_PDF, label: 'Create & Convert to PDF' },
  { key: TOOL_CATEGORIES.CONVERT_FROM, label: 'Convert to Other' },
  { key: TOOL_CATEGORIES.SECURITY, label: 'Security & Privacy' },
];

export default function Dashboard() {
  const { starredTools, toggleStarTool, setSearchOpen } = useApp();
  const quickTools = QUICK_TOOLS.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean);
  const starredList = TOOLS.filter((t) => starredTools.has(t.id));

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Hero */}
      <div className="dashboard-hero animate-fade">
        <h2>
          Free Online PDF Tools<br />
          <span>Without Watermarks</span>
        </h2>
        <p>
          Process documents locally in your browser. No uploads to servers,
          no watermarks, no signup. 100% free, private and offline-capable.
        </p>
        <div className="dashboard-hero-search" onClick={() => setSearchOpen(true)} role="button" tabIndex={0}>
          <Search size={18} color="rgba(255,255,255,0.7)" />
          <span>Search PDF tools…</span>
          <span className="kbd">Ctrl K</span>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        {[
          { icon: Zap, label: '60+ PDF Tools' },
          { icon: Shield, label: 'Privacy First' },
          { icon: Download, label: 'No Signup' },
          { icon: Star, label: '100% Free' },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="stat-badge">
            <Icon size={15} className="stat-icon" />
            {label}
          </div>
        ))}
      </div>

      {/* Recent Files */}
      <RecentFilesPanel />

      {/* Starred Tools */}
      {starredList.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div className="section-header">
            <h2 className="section-title" style={{ fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Star size={18} color="var(--warning)" /> Starred Tools
            </h2>
          </div>
          <div className="tools-grid" style={{ marginTop: 12 }}>
            {starredList.map((tool) => (
              <ToolCard key={tool.id} tool={tool} starred onStar={() => toggleStarTool(tool.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Quick Access */}
      <div style={{ marginBottom: 32 }}>
        <div className="section-header">
          <h2 className="section-title" style={{ fontSize: 'var(--font-size-lg)' }}>
            Quick Access
          </h2>
        </div>
        <div className="tools-grid-lg" style={{ marginTop: 12 }}>
          {quickTools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              starred={starredTools.has(tool.id)}
              onStar={() => toggleStarTool(tool.id)}
            />
          ))}
        </div>
      </div>

      {/* Business Tools */}
      <div style={{ marginBottom: 32 }}>
        <div className="section-header">
          <h2 className="section-title" style={{ fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Receipt size={18} color="var(--accent)" /> Business Tools
          </h2>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>India GST compliant</span>
        </div>
        <div className="tools-grid-lg" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {TOOLS.filter((t) => t.category === TOOL_CATEGORIES.BUSINESS).map((tool) => (
            <BusinessToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </div>

      {/* Tool Directory */}
      {CATEGORY_ORDER.map(({ key, label }) => {
        const tools = TOOLS.filter((t) => t.category === key);
        return (
          <div key={key} style={{ marginBottom: 32 }}>
            <div className="section-header">
              <h2 className="section-title" style={{ fontSize: 'var(--font-size-lg)' }}>{label}</h2>
            </div>
            <div className="tools-grid" style={{ marginTop: 12 }}>
              {tools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  starred={starredTools.has(tool.id)}
                  onStar={() => toggleStarTool(tool.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Collaborate */}
      <div style={{ marginBottom: 32 }}>
        <div className="section-header">
          <h2 className="section-title" style={{ fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Share2 size={18} color="#14b8a6" /> Collaborate & Share
          </h2>
        </div>
        <div className="tools-grid" style={{ marginTop: 12 }}>
          {TOOLS.filter((t) => t.category === TOOL_CATEGORIES.COLLABORATE).map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              starred={starredTools.has(tool.id)}
              onStar={() => toggleStarTool(tool.id)}
            />
          ))}
        </div>
      </div>

      {/* Scan & Workflow */}
      <div style={{ marginBottom: 48 }}>
        <div className="section-header">
          <h2 className="section-title" style={{ fontSize: 'var(--font-size-lg)' }}>Scan & Workflow</h2>
        </div>
        <div className="tools-grid" style={{ marginTop: 12 }}>
          {TOOLS.filter((t) => t.category === TOOL_CATEGORIES.SCAN_WORKFLOW).map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              starred={starredTools.has(tool.id)}
              onStar={() => toggleStarTool(tool.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ tool, starred, onStar }) {
  const Icon = tool.icon;
  return (
    <Link to={tool.route} className={`tool-card ${starred ? 'starred' : ''}`}>
      <div className={`tool-card-icon cat-${tool.catKey}`}>
        {Icon && <Icon size={22} />}
      </div>
      <div className="tool-card-name">{tool.name}</div>
      <div className="tool-card-desc">{tool.description}</div>
      <button
        className="tool-card-star"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStar(); }}
        title={starred ? 'Remove from starred' : 'Star this tool'}
      >
        <Star size={14} fill={starred ? 'currentColor' : 'none'} />
      </button>
    </Link>
  );
}

function BusinessToolCard({ tool }) {
  const Icon = tool.icon;
  return (
    <Link to={tool.route} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-surface) 0%, rgba(236,72,153,0.05) 100%)',
        border: '1px solid rgba(236,72,153,0.2)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        transition: 'all var(--transition)',
        cursor: 'pointer',
      }}
        className="tool-card"
      >
        <div style={{
          width: 52, height: 52, borderRadius: 'var(--border-radius)',
          background: 'rgba(236,72,153,0.12)', color: '#ec4899',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
          {Icon && <Icon size={26} />}
        </div>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{tool.name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{tool.description}</div>
        </div>
      </div>
    </Link>
  );
}

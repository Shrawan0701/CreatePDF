import { cloneElement, isValidElement, useState, useRef, useCallback, useId } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

// ===========================
// Toast Component
// ===========================
export function ToastContainer({ toasts, onDismiss }) {
  const icons = {
    success: <CheckCircle size={16} color="var(--success)" />,
    error: <XCircle size={16} color="var(--danger)" />,
    info: <Info size={16} color="var(--primary)" />,
    warning: <AlertTriangle size={16} color="var(--warning)" />,
  };

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{icons[t.type]}</span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" onClick={() => onDismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ===========================
// DropZone Component
// ===========================
export function DropZone({ onFiles, accept = [], multiple = false, capture, children, className = '' }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (!multiple && files.length > 1) return onFiles(files.slice(0, 1));
    onFiles(files);
  }, [onFiles, multiple]);

  return (
    <div
      className={`drop-zone ${dragging ? 'drag-over' : ''} ${className}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        accept={accept.join(',')}
        multiple={multiple}
        capture={capture}
        onChange={(e) => {
          const files = Array.from(e.target.files);
          onFiles(files);
          e.target.value = '';
        }}
      />
      {children}
    </div>
  );
}

// ===========================
// FileItem Component
// ===========================
export function FileItem({ file, onRemove, meta }) {
  const icon = file.type === 'application/pdf'
    ? '📄'
    : file.type.startsWith('image/')
    ? '🖼️'
    : '📎';

  const size = file.size < 1024 * 1024
    ? `${(file.size / 1024).toFixed(1)} KB`
    : `${(file.size / 1024 / 1024).toFixed(2)} MB`;

  return (
    <div className="file-item">
      <span className="file-item-icon" style={{ fontSize: 20 }}>{icon}</span>
      <div className="file-item-info">
        <div className="file-item-name">{file.name}</div>
        <div className="file-item-meta">{size}{meta ? ` · ${meta}` : ''}</div>
      </div>
      {onRemove && (
        <div className="file-item-actions">
          <button className="icon-btn" onClick={onRemove} title="Remove">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

// ===========================
// Progress Bar
// ===========================
export function ProgressBar({ value, label }) {
  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          <span>{label}</span>
          <span>{Math.round(value)}%</span>
        </div>
      )}
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ===========================
// Spinner
// ===========================
export function Spinner({ size = 20 }) {
  return (
    <div
      className="spinner"
      style={{ width: size, height: size }}
    />
  );
}

// ===========================
// Empty State
// ===========================
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {Icon && <Icon size={28} />}
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

// ===========================
// Modal
// ===========================
export function Modal({ open, onClose, title, children, footer, maxWidth = 560 }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth }}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ===========================
// Tabs
// ===========================
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`tab ${active === tab.key ? 'active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ===========================
// FormGroup
// ===========================
export function FormGroup({ label, children, hint }) {
  const generatedId = useId();
  const isField = isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type);
  const fieldId = isField ? children.props.id || generatedId : undefined;
  return (
    <div className="form-group">
      {label && <label className="form-label" htmlFor={fieldId}>{label}</label>}
      {isField ? cloneElement(children, { id: fieldId }) : children}
      {hint && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

// ===========================
// Section Header
// ===========================
export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="section-header">
      <div>
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="section-subtitle">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// ===========================
// Download Helper
// ===========================
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

import { Link } from 'react-router-dom';

export default function NotFound() {
  return <div className="tool-page"><h1 className="tool-page-title">Page not found</h1><p className="tool-page-desc">This page may have moved, or the address may be incorrect.</p><p style={{ marginTop: 24 }}><Link to="/" className="btn btn-primary">Browse PDF tools</Link></p></div>;
}

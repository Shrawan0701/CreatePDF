// Generic Tool Page wrapper
import { useState, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TOOL_MAP } from '../data/tools';

export function ToolPage({ toolId, children }) {
  const tool = TOOL_MAP[toolId];
  const Icon = tool?.icon || FileText;

  return (
    <div className="tool-page animate-fade">
      <div className="tool-page-header">
        <div className="tool-page-icon">
          <Icon size={28} />
        </div>
        <h1 className="tool-page-title">{tool?.name || toolId}</h1>
        <p className="tool-page-desc">{tool?.description}</p>
      </div>
      {children}
    </div>
  );
}

export function useToolState() {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const { showToast } = useApp();

  const addFiles = useCallback((newFiles) => {
    setFiles((prev) => [...prev, ...newFiles]);
    setError(null);
    setDone(false);
  }, []);

  const removeFile = useCallback((idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setProcessing(false);
    setProgress(0);
    setError(null);
    setDone(false);
  }, []);

  const run = useCallback(async (fn) => {
    setProcessing(true);
    setError(null);
    setProgress(0);
    try {
      const result = await fn(setProgress);
      setDone(true);
      setProgress(100);
      return result;
    } catch (e) {
      setError(e.message || 'An error occurred');
      showToast(e.message || 'Processing failed', 'error');
      return null;
    } finally {
      setProcessing(false);
    }
  }, [showToast]);

  return { files, addFiles, removeFile, reset, processing, progress, error, done, run };
}

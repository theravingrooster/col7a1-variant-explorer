import React, { useEffect, useRef, useState } from "react";

export default function ShareViewButton({ url, label = "Copy view link" }) {
  const [status, setStatus] = useState("");
  const [fallback, setFallback] = useState(false);
  const input = useRef(null);
  const currentUrl = useRef(url);
  currentUrl.current = url;
  useEffect(() => { setStatus(""); setFallback(false); }, [url]);
  useEffect(() => { if (fallback) { input.current?.focus(); input.current?.select(); } }, [fallback]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      if (currentUrl.current !== url) return;
      setFallback(false);
      setStatus("View link copied");
    } catch {
      if (currentUrl.current !== url) return;
      setFallback(true);
      setStatus("Select and copy the view link below.");
    }
  }
  return <div className="share-view-control">
    <button className="button" onClick={copy}>{label}</button>
    <span className="share-status" role="status">{status}</span>
    {fallback && <label className="share-fallback">View link<input ref={input} type="text" readOnly value={url} /></label>}
  </div>;
}

import React from "react";
import { evidenceSummary } from "./evidence.mjs";
import "./evidence.css";

/** Review status and source submitter counts are separate evidence attributes. */
export default function ReviewSummary({ variant, full = false }) {
  const evidence = evidenceSummary(variant);
  return (
    <div className={`review-summary${full ? " review-summary-full" : ""}`}>
      <span className={`review-badge review-${evidence.tone}`} title={evidence.fullLabel}
        aria-label={`Review status: ${evidence.fullLabel}`}>
        {evidence.shortLabel}
      </span>
      <span className="submitter-count">{evidence.submittersLabel}</span>
      {full && <p className="review-source-label"><span>ClinVar review status:</span> {evidence.fullLabel}</p>}
    </div>
  );
}

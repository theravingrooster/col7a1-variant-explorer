import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clearColumnFilter, isColumnFilterActive, normalizeColumnFilters } from "./column-filters.mjs";
import { TABLE_SORT_FIELDS } from "./variant-sort.mjs";
import "./column-filters.css";

const categoricalFields = new Set(["significance", "review", "domain", "conditions"]);
const fieldsFor = field => field === "position" ? ["position", "mapping"] : [field];
const cloneValue = value => Array.isArray(value) ? [...value] : value && typeof value === "object" ? { ...value } : value;
const selectedCount = (columns, field) => fieldsFor(field).reduce((count, key) => count + (Array.isArray(columns[key]) ? columns[key].length : columns[key] ? 1 : 0), 0);

function validateDraft(field, draft, proteinLength) {
  if (field === "id" && draft.id?.trim()) {
    const ids = draft.id.trim().split(/[\s,]+/);
    if (ids.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1))
      return "Enter positive ClinVar Variation IDs, separated by commas or spaces.";
  }
  if (field !== "position" && field !== "submitters") return "";
  const keys = field === "position" ? ["start", "end"] : ["min", "max"];
  const values = keys.map(key => String(draft[field]?.[key] ?? "").trim());
  const minimum = field === "position" ? 1 : 0;
  if (values.some(value => value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)))
    return field === "position" ? "Enter whole-number residue positions starting at 1." : "Enter whole-number submitter counts starting at 0.";
  if (field === "position" && proteinLength && values.some(value => value && Number(value) > proteinLength))
    return `Residue positions must not exceed ${proteinLength.toLocaleString("en-US")}.`;
  if (values.every(Boolean) && Number(values[0]) > Number(values[1]))
    return field === "position" ? "The first residue must be no greater than the last residue." : "The minimum must be no greater than the maximum.";
  return "";
}

function ChoiceList({ field, label, values, selected, onChange, search = "" }) {
  const visible = values.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(search.trim().toLowerCase()));
  function toggle(value) {
    onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  }
  return <fieldset className="column-filter-choice-group">
    <legend>{label}</legend>
    <div className="column-filter-options" role="group" aria-label={`${label} choices`}>
      {visible.map(option => <label className="column-filter-option" key={option.value}>
        <input type="checkbox" name={`column-${field}`} value={option.value} checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
        <span>{option.label}</span><small aria-label={`${option.count} variants in the full dataset`}>{option.count.toLocaleString("en-US")}</small>
      </label>)}
      {!visible.length && <p className="column-filter-empty">No matching choices. Try a shorter search.</p>}
    </div>
  </fieldset>;
}

function FilterDialog({ field, label, columns, options, sort, onSort, onChange, onClose, anchor }) {
  const dialogRef = useRef(null);
  const titleId = useId(), hintId = useId(), errorId = useId();
  const [draft, setDraft] = useState(() => Object.fromEntries(fieldsFor(field).map(key => [key, cloneValue(columns[key])])));
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const metadata = TABLE_SORT_FIELDS.find(item => item.key === field);
  const selected = Array.isArray(draft[field]) ? draft[field] : [];
  const isCategorical = categoricalFields.has(field);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    function place() {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const box = dialog.getBoundingClientRect();
      const gap = 10, padding = 12;
      const left = Math.max(padding, Math.min(rect.left, window.innerWidth - box.width - padding));
      const below = rect.bottom + gap;
      const above = rect.top - gap - box.height;
      const top = below + box.height <= window.innerHeight - padding ? below
        : above >= padding ? above : Math.max(padding, (window.innerHeight - box.height) / 2);
      dialog.style.left = `${left}px`;
      dialog.style.top = `${top}px`;
    }
    place();
    dialog.querySelector("[data-filter-autofocus]")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(dialog);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      anchor.current?.focus({ preventScroll: true });
    };
  }, [anchor]);

  function setValue(key, value) { setDraft(current => ({ ...current, [key]: value })); setError(""); }
  function setBound(key, value) { setValue(field, { ...draft[field], [key]: value }); }
  function apply(event) {
    event.preventDefault();
    const validation = validateDraft(field, draft, options.proteinLength);
    if (validation) { setError(validation); return; }
    const next = clearColumnFilter(columns, field);
    for (const key of fieldsFor(field)) {
      const raw = draft[key];
      const value = raw && !Array.isArray(raw) && typeof raw === "object"
        ? Object.fromEntries(Object.entries(raw).map(([bound, entry]) => [bound, String(entry ?? "").trim()]))
        : typeof raw === "string" ? raw.trim() : raw;
      if (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.values(value).some(item => String(item).trim()) : String(value ?? "").trim())
        next[key] = cloneValue(value);
    }
    const normalized = normalizeColumnFilters(next);
    if (Object.keys(next).length && !Object.keys(normalized).length) {
      setError("This filter exceeds the supported size. Choose fewer values or shorten the text, then try again.");
      return;
    }
    onChange(normalized);
    onClose();
  }
  function clear() { onChange(clearColumnFilter(columns, field)); onClose(); }
  function order(value) { onSort(value); onClose(); }
  function outside(event) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }

  return <dialog ref={dialogRef} className="column-filter-dialog" aria-labelledby={titleId} aria-describedby={hintId}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={outside}>
    <form onSubmit={apply} noValidate>
      <div className="column-filter-title"><h3 id={titleId}>Filter {label}</h3><button type="button" className="column-filter-close" onClick={onClose} aria-label={`Close ${label} filter`}>×</button></div>
      <div className="column-filter-body">
        <p className="column-filter-hint" id={hintId}>{isCategorical ? "Choose any matching values. No selection includes all values." : "Narrow this column while keeping the other filters active."}</p>
        {isCategorical && <>
          <label className="column-filter-input-label"><span>Find {label.toLowerCase()} choices</span><input data-filter-autofocus type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search choices…" /></label>
          <div className="column-filter-choice-tools"><span>{selected.length ? `${selected.length} selected` : "All values"}</span><button type="button" onClick={() => setValue(field, [])} disabled={!selected.length}>Clear selections</button></div>
          <ChoiceList field={field} label={label} values={options[field] || []} selected={selected} search={search} onChange={value => setValue(field, value)} />
          <p className="column-filter-note">Counts show the full dataset. Selected values match with OR; different columns combine with AND.</p>
        </>}
        {field === "hgvs" && <label className="column-filter-input-label"><span>HGVS contains</span><input data-filter-autofocus type="text" value={draft.hgvs || ""} maxLength={500} onChange={event => setValue("hgvs", event.target.value)} placeholder="e.g. p.Gly or c.2471" /><small>Search the reported coding and protein HGVS in this column.</small></label>}
        {field === "id" && <label className="column-filter-input-label"><span>ClinVar Variation IDs</span><textarea data-filter-autofocus value={draft.id || ""} rows={3} maxLength={2000} onChange={event => setValue("id", event.target.value)} placeholder="e.g. 17423, 17425" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} /><small>Enter one or more exact IDs separated by commas or spaces.</small></label>}
        {field === "submitters" && <>
          <div className="column-filter-bounds">
            <label className="column-filter-input-label"><span>Minimum submitters</span><input data-filter-autofocus type="text" inputMode="numeric" value={draft.submitters?.min || ""} onChange={event => setBound("min", event.target.value)} placeholder="Any" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} /></label>
            <label className="column-filter-input-label"><span>Maximum submitters</span><input type="text" inputMode="numeric" value={draft.submitters?.max || ""} onChange={event => setBound("max", event.target.value)} placeholder="Any" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} /></label>
          </div>
          <p className="column-filter-note">Uses the highest reported source count, without adding submitters across submissions. A numeric limit excludes records with no reported count.</p>
        </>}
        {field === "position" && <>
          <div className="column-filter-bounds">
            <label className="column-filter-input-label"><span>First residue</span><input data-filter-autofocus type="text" inputMode="numeric" value={draft.position?.start || ""} onChange={event => setBound("start", event.target.value)} placeholder="1" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} /></label>
            <label className="column-filter-input-label"><span>Last residue</span><input type="text" inputMode="numeric" value={draft.position?.end || ""} onChange={event => setBound("end", event.target.value)} placeholder={String(options.proteinLength || "Any")} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} /></label>
          </div>
          <p className="column-filter-note">Includes variants overlapping this inclusive residue range. A range excludes variants without a mapped protein position.</p>
          <ChoiceList field="mapping" label="Protein mapping" values={options.mapping || []} selected={draft.mapping || []} onChange={value => setValue("mapping", value)} />
          <p className="column-filter-note">No mapping selection includes both. To see only unmapped variants, leave the residue range blank.</p>
        </>}
        {error && <p id={errorId} className="column-filter-error" role="alert">{error}</p>}
        <fieldset className="column-filter-order"><legend>Sort this column</legend><div>
          <button type="button" aria-pressed={sort === field} onClick={() => order(field)}>{metadata?.ascendingLabel || "Ascending"}</button>
          <button type="button" aria-pressed={sort === `${field}-desc`} onClick={() => order(`${field}-desc`)}>{metadata?.descendingLabel || "Descending"}</button>
        </div></fieldset>
      </div>
      <div className="column-filter-actions"><button type="button" className="text-button" onClick={clear}>Clear column filter</button><button type="submit" className="button column-filter-apply">Apply filter</button></div>
    </form>
  </dialog>;
}

export default function ColumnFilterMenu({ field, label, columns = {}, options = {}, sort, onSort, onChange }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const active = isColumnFilterActive(columns, field);
  const count = selectedCount(columns, field);
  const sorted = sort?.replace(/-desc$/, "") === field;
  return <>
    <button ref={anchor} className={`column-filter-trigger${active ? " is-filtered" : ""}`} type="button" data-column-filter={field}
      aria-label={`Filter and sort ${label}${active ? ", filter active" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span>{label}</span><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 3h12L9.5 8.2v4.3l-3 1V8.2Z" /></svg>
      {active && <span className="column-filter-badge" aria-hidden="true">{count || "•"}</span>}
      {sorted && <span className="column-filter-sort-mark" aria-hidden="true">{sort.endsWith("-desc") ? "↓" : "↑"}</span>}
    </button>
    {open && createPortal(<FilterDialog field={field} label={label} columns={columns} options={options} sort={sort} onSort={onSort} onChange={onChange} onClose={() => setOpen(false)} anchor={anchor} />, document.body)}
  </>;
}

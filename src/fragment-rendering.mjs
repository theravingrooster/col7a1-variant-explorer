export const CONFIDENCE_COLORS = [
  { min: 90, color: "#0053d6", label: "Very high · ≥90" },
  { min: 70, color: "#65cbf3", label: "Confident · 70–90" },
  { min: 50, color: "#ffdb13", label: "Low · 50–70" },
  { min: 0, color: "#ff7d45", label: "Very low · <50" },
];
export const CHAIN_COLORS = ["#427aca", "#26a69a", "#9b71cc"];
export const SELECTED_RESIDUE_COLOR = "#d69b29";

export function confidenceColor(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) return "#9a9a9a";
  return CONFIDENCE_COLORS.find(level => value >= level.min)?.color ?? "#9a9a9a";
}

export function fragmentSelection(fragment, range) {
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger) || range[0] < 1 || range[0] > range[1]) return null;
  const start = Math.max(fragment.start, range[0]);
  const end = Math.min(fragment.end, range[1]);
  if (start > end) return null;
  return { resi: `${start - fragment.start + 1}-${end - fragment.start + 1}` };
}

export function fragmentAtomDetails(fragment, atom) {
  if (!fragment || !atom || !Number.isSafeInteger(atom.resi) || atom.resi < 1 || atom.resi > fragment.length || !fragment.chains.includes(atom.chain)) return null;
  const residue = fragment.residues?.[atom.resi - 1];
  return {
    position: fragment.start + atom.resi - 1,
    modelPosition: atom.resi,
    residueName: atom.resn,
    aminoAcid: residue?.aminoAcid ?? fragment.sequence?.[atom.resi - 1],
    chain: atom.chain,
    // Report the C-alpha score consistently with the sequence/manifest panel.
    plddt: residue?.plddt?.[atom.chain] ?? atom.b,
  };
}

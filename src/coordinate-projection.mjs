import { multiplyProteinOrientations, normalizeProteinOrientation, rotateProteinVector } from "./protein-view.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const axisRotation = (axis, angle) => [...axis.map(value => value * Math.sin(angle / 2)), Math.cos(angle / 2)];
const xyz = atom => [atom.x, atom.y, atom.z];
const validAtoms = atoms => atoms.length > 0 && atoms.every(atom => xyz(atom).every(Number.isFinite));

/** Camera transforms only: the original atom coordinates are never changed. */
export function createCoordinateView(atoms) {
  if (!validAtoms(atoms)) throw new Error("The fragment has invalid atomic coordinates.");
  const minima = [0, 1, 2].map(axis => Math.min(...atoms.map(atom => xyz(atom)[axis])));
  const maxima = [0, 1, 2].map(axis => Math.max(...atoms.map(atom => xyz(atom)[axis])));
  const spans = maxima.map((value, axis) => value - minima[axis]);
  let orientation = [0, 0, 0, 1];
  if (spans[1] > spans[0] * 1.5 && spans[1] >= spans[2]) orientation = axisRotation([0, 0, 1], Math.PI / 2);
  else if (spans[2] > spans[0] * 1.5 && spans[2] > spans[1]) orientation = axisRotation([0, 1, 0], Math.PI / 2);
  const center = maxima.map((value, axis) => (value + minima[axis]) / 2);
  const local = atoms.map(atom => rotateProteinVector(xyz(atom).map((value, axis) => value - center[axis]), orientation));
  const extent = [0, 1].map(axis => Math.max(1, Math.max(...local.map(p => p[axis])) - Math.min(...local.map(p => p[axis]))));
  return { orientation, center, extent, zoom: 1, pan: [0, 0] };
}

export function projectCoordinates(atoms, view, width, height) {
  const scale = Math.min(Math.max(1, width - 70) / view.extent[0], Math.max(1, height - 55) / view.extent[1]) * .82 * view.zoom;
  return atoms.map(atom => {
    const p = rotateProteinVector(xyz(atom).map((value, axis) => value - view.center[axis]), view.orientation);
    return { x: width / 2 + p[0] * scale + view.pan[0], y: height / 2 - p[1] * scale + view.pan[1], z: p[2] };
  });
}

export function rotateCoordinateView(view, dx, dy) {
  if (![dx, dy].every(Number.isFinite) || !Math.hypot(dx, dy)) return view;
  const amount = Math.hypot(dx, dy);
  const rotation = axisRotation([dy / amount, dx / amount, 0], amount * .008);
  return { ...view, orientation: multiplyProteinOrientations(rotation, normalizeProteinOrientation(view.orientation)) };
}

export function zoomCoordinateView(view, factor) {
  return Number.isFinite(factor) && factor > 0 ? { ...view, zoom: clamp(view.zoom * factor, .25, 10) } : view;
}

export function panCoordinateView(view, dx, dy) {
  return [dx, dy].every(Number.isFinite) ? { ...view, pan: [clamp(view.pan[0] + dx, -2000, 2000), clamp(view.pan[1] + dy, -2000, 2000)] } : view;
}

export function focusCoordinateView(view, atoms) {
  if (!validAtoms(atoms)) return view;
  const minima = [0, 1, 2].map(axis => Math.min(...atoms.map(atom => xyz(atom)[axis])));
  const maxima = [0, 1, 2].map(axis => Math.max(...atoms.map(atom => xyz(atom)[axis])));
  return { ...view, center: maxima.map((value, axis) => (value + minima[axis]) / 2), zoom: Math.max(view.zoom, 2.5), pan: [0, 0] };
}

/** A backbone trace connects consecutive C-alpha residues only within a chain. */
export function backboneConnections(atoms) {
  const previous = new Map(), connections = [];
  atoms.forEach((atom, index) => {
    if (atom.atom !== "CA") return;
    const prev = previous.get(atom.chain);
    if (prev && atom.resi === prev.resi + 1) connections.push([prev.index, index]);
    previous.set(atom.chain, { index, resi: atom.resi });
  });
  return connections;
}

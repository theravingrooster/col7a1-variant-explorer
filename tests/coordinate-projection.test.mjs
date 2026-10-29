import test from "node:test";
import assert from "node:assert/strict";
import { backboneConnections, createCoordinateView, focusCoordinateView, panCoordinateView, projectCoordinates, rotateCoordinateView, zoomCoordinateView } from "../src/coordinate-projection.mjs";

const atoms = [
  { x: 1, y: 2, z: 3, atom: "CA", chain: "A", resi: 1 },
  { x: 4, y: 5, z: 8, atom: "CA", chain: "A", resi: 2 },
  { x: -2, y: 7, z: 4, atom: "CA", chain: "B", resi: 1 },
  { x: 3, y: 9, z: -6, atom: "CA", chain: "B", resi: 3 },
];
test("coordinate projection keeps original atomic coordinates intact and rotates all dimensions", () => {
  const original = structuredClone(atoms), view = createCoordinateView(atoms);
  const baseline = projectCoordinates(atoms, view, 900, 340);
  for (const movement of [[40, 0], [0, 40], [40, 30]]) {
    const next = rotateCoordinateView(view, ...movement);
    assert.notDeepEqual(projectCoordinates(atoms, next, 900, 340), baseline);
    assert.ok(Math.abs(Math.hypot(...next.orientation) - 1) < 1e-10);
  }
  assert.deepEqual(atoms, original);
});
test("camera zoom, pan and focus do not change atomic geometry or source numbering", () => {
  const view = createCoordinateView(atoms), original = structuredClone(view);
  assert.equal(zoomCoordinateView(view, 2).zoom, 2);
  assert.deepEqual(panCoordinateView(view, 8, -5).pan, [8, -5]);
  assert.deepEqual(focusCoordinateView(view, [atoms[1]]).center, [4, 5, 8]);
  assert.deepEqual(view, original);
  assert.throws(() => createCoordinateView([{ x: NaN, y: 0, z: 1 }]), /invalid/);
});
test("backbone traces never connect separate chains or gaps in residue numbering", () => {
  assert.deepEqual(backboneConnections(atoms), [[0, 1]]);
});

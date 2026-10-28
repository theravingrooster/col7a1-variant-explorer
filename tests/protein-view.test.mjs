import test from "node:test";
import assert from "node:assert/strict";
import { VIEWBOX, MIN_PROTEIN_ZOOM, MAX_PROTEIN_ZOOM, createProteinView, rotateProteinVector,
  projectProteinPoint, rotateProteinView, trackballProteinView, zoomProteinView, panProteinView } from "../src/protein-view.mjs";

const bounds = { left: 20, top: 30, width: 760, height: 460 };
const center = [400, 260];
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
const samePose = (a, b) => a.orientation.forEach((value, index) => close(value, b.orientation[index]));

test("view defaults are independent and project the model center to the viewport center", () => {
  const a = createProteinView(), b = createProteinView();
  a.orientation[0] = 900; a.pan[0] = 100;
  assert.notDeepEqual(a, b);
  assert.deepEqual(b.pan, [0, 0]);
  assert.equal(b.zoom, 1);
  close(Math.hypot(...b.orientation), 1);
  assert.deepEqual(projectProteinPoint([273, 118, 0], b), { x: VIEWBOX.width / 2, y: VIEWBOX.height / 2, z: 0 });
});

test("horizontal, vertical and diagonal trackball drags produce distinct 3D orientations", () => {
  const initial = createProteinView();
  const horizontal = trackballProteinView(initial, center, [center[0] + 90, center[1]], bounds);
  const vertical = trackballProteinView(initial, center, [center[0], center[1] + 90], bounds);
  const diagonal = trackballProteinView(initial, center, [center[0] + 90, center[1] + 90], bounds);
  for (const changed of [horizontal, vertical, diagonal]) {
    assert.notDeepEqual(changed.orientation, initial.orientation);
    close(Math.hypot(...changed.orientation), 1);
    assert.deepEqual(changed.pan, initial.pan);
    assert.equal(changed.zoom, initial.zoom);
  }
  assert.notDeepEqual(horizontal.orientation, vertical.orientation);
  assert.notDeepEqual(diagonal.orientation, horizontal.orientation);
  samePose(trackballProteinView(initial, center, center, bounds), initial);
});

test("successive trackball movements compose, reverse cleanly, and stay finite outside the viewer", () => {
  const initial = createProteinView(), right = [center[0] + 90, center[1]], down = [right[0], right[1] + 90];
  const moved = trackballProteinView(initial, center, right, bounds);
  const composed = trackballProteinView(moved, right, down, bounds);
  assert.notDeepEqual(composed.orientation, moved.orientation);
  assert.notDeepEqual(composed.orientation, trackballProteinView(initial, right, down, bounds).orientation);
  samePose(trackballProteinView(moved, right, center, bounds), initial);
  const far = trackballProteinView(initial, [-100000, 260], [100000, 260], bounds);
  assert.ok(far.orientation.every(Number.isFinite));
  close(Math.hypot(...far.orientation), 1);
});

test("quaternion rotation preserves geometry distances after thousands of mixed-axis movements", () => {
  let camera = createProteinView();
  const original = [221, -16.575, 12], length = Math.hypot(...original);
  for (let i = 0; i < 4000; i++) camera = rotateProteinView(camera, Math.sin(i) * 8, Math.cos(i) * 11);
  close(Math.hypot(...camera.orientation), 1);
  close(Math.hypot(...rotateProteinVector(original, camera.orientation)), length);
  assert.ok(projectProteinPoint([494, 118, 0], camera).x !== projectProteinPoint([494, 118, 0], createProteinView()).x);
  const rotated = rotateProteinView({ orientation: [0,0,0,1], zoom: 1, pan: [0,0] }, 0, 100);
  const rotatedY = rotateProteinVector([0,1,0], rotated.orientation);
  assert.ok(Math.abs(rotatedY[2]) > .5, "A vertical drag changes the 3D pose, not just a 2D screen position");
});

test("pan accounts for SVG letterboxing and zoom has safe finite limits", () => {
  const initial = createProteinView();
  const panned = panProteinView(initial, 20, -10, { left: 0, top: 0, width: 1520, height: 460 });
  assert.deepEqual(panned.pan, [20,-10]);
  samePose(panned, initial);
  const huge = panProteinView(initial, 1e9, -1e9, bounds);
  assert.ok(huge.pan[0] <= VIEWBOX.width && huge.pan[1] >= -VIEWBOX.height);
  assert.equal(zoomProteinView(initial, 100).zoom, MAX_PROTEIN_ZOOM);
  assert.equal(zoomProteinView(initial, .001).zoom, MIN_PROTEIN_ZOOM);
  assert.equal(zoomProteinView(initial, -1).zoom, initial.zoom);
  assert.equal(zoomProteinView(initial, NaN).zoom, initial.zoom);
  const projected = projectProteinPoint([373, 118, 0], { orientation: [0,0,0,1], zoom: 2, pan: [20,-10] });
  assert.deepEqual(projected, { x: 600, y: 220, z: 0 });
});

test("invalid gesture input leaves a valid pose and never mutates the supplied view", () => {
  const initial = createProteinView(), snapshot = JSON.stringify(initial);
  Object.freeze(initial.orientation); Object.freeze(initial.pan); Object.freeze(initial);
  samePose(trackballProteinView(initial, center, [NaN, 30], bounds), initial);
  samePose(trackballProteinView(initial, center, [30, 30], { ...bounds, width: 0 }), initial);
  samePose(rotateProteinView(initial, Infinity, 0), initial);
  samePose(panProteinView(initial, 10, 10, null), initial);
  rotateProteinView(initial, 30, 40); zoomProteinView(initial, 2); panProteinView(initial, 5, 8, bounds);
  assert.equal(JSON.stringify(initial), snapshot);
});

import test from "node:test";
import assert from "node:assert/strict";
import { startRotationDrag, moveRotationDrag, endRotationDrag } from "../src/rotation-drag.mjs";
import { createProteinView } from "../src/protein-view.mjs";

const bounds = { left: 40, top: 100, width: 760, height: 460 };
const pointer = (overrides = {}) => ({ pointerId: 4, pointerType: "mouse", isPrimary: true, button: 0, clientX: 420, clientY: 330, ...overrides });
const begin = (overrides = {}, view = createProteinView()) => startRotationDrag(pointer(overrides), view, bounds);
const closeVector = (a, b) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-10));

test("primary left rotates, right or control/meta pans, and invalid starts are ignored", () => {
  assert.equal(begin().mode, "rotate");
  assert.equal(begin({ shiftKey: true }).mode, "rotate");
  for (const modifier of [{ button: 2 }, { ctrlKey: true }, { metaKey: true }]) assert.equal(begin(modifier).mode, "pan");
  for (const invalid of [{ button: 1 }, { isPrimary: false }, { clientX: NaN }, { pointerId: Infinity }]) assert.equal(begin(invalid), null);
  assert.equal(startRotationDrag(null, createProteinView(), bounds), null);
  assert.equal(begin({}, { ...createProteinView(), zoom: 0 }), null);
  assert.equal(begin({}, { ...createProteinView(), orientation: [0, 0, 0, 0] }), null);
  assert.equal(startRotationDrag(pointer(), createProteinView(), { ...bounds, height: 0 }), null);
  assert.equal(startRotationDrag(pointer(), createProteinView(), { ...bounds, width: Infinity }), null);
});

test("small jitter stays a click, while horizontal, vertical and diagonal drags rotate", () => {
  const initial = createProteinView();
  const jitter = moveRotationDrag(begin({}, initial), pointer({ clientX: 422, clientY: 332 }));
  assert.equal(jitter.dragging, false);
  assert.deepEqual(jitter.view, initial);
  assert.equal(endRotationDrag(jitter, pointer({ clientX: 422, clientY: 332 })).suppressClick, false);
  const poses = [];
  for (const motion of [{ clientX: 500 }, { clientY: 410 }, { clientX: 500, clientY: 410 }]) {
    const moved = moveRotationDrag(begin({}, initial), pointer(motion));
    assert.equal(moved.dragging, true);
    assert.notDeepEqual(moved.view.orientation, initial.orientation);
    assert.equal(endRotationDrag(moved, pointer(motion)).suppressClick, true);
    poses.push(moved.view.orientation);
  }
  assert.notDeepEqual(poses[0], poses[1]);
  assert.notDeepEqual(poses[0], poses[2]);
});

test("one-finger vertical motion now rotates instead of abandoning the gesture", () => {
  const drag = begin({ pointerType: "touch" });
  const moved = moveRotationDrag(drag, pointer({ pointerType: "touch", clientY: 420 }));
  assert.equal(moved.cancelled, false);
  assert.equal(moved.dragging, true);
  assert.notDeepEqual(moved.view.orientation, drag.view.orientation);
  assert.equal(endRotationDrag(moved, pointer({ pointerType: "touch", clientY: 420 })).suppressClick, true);
});

test("rotation is independent of event frequency, and later gestures compose with the saved pose", () => {
  const initial = begin();
  const direct = moveRotationDrag(initial, pointer({ clientX: 560, clientY: 410 }));
  const sampled = moveRotationDrag(moveRotationDrag(initial, pointer({ clientX: 470, clientY: 360 })), pointer({ clientX: 560, clientY: 410 }));
  closeVector(direct.view.orientation, sampled.view.orientation);
  const next = moveRotationDrag(begin({}, direct.view), pointer({ clientY: 260 }));
  assert.notDeepEqual(next.view.orientation, direct.view.orientation);
  assert.notDeepEqual(next.view.orientation, moveRotationDrag(begin(), pointer({ clientY: 260 })).view.orientation);
});

test("returning to the initial position restores the pose but still suppresses click selection", () => {
  const initial = begin();
  const returned = moveRotationDrag(moveRotationDrag(initial, pointer({ clientX: 560, clientY: 390 })), pointer());
  closeVector(returned.view.orientation, initial.view.orientation);
  assert.equal(returned.dragging, true);
  assert.equal(endRotationDrag(returned, pointer()).suppressClick, true);
});

test("panning moves both axes without rotating, and retains its mode when modifiers change", () => {
  const initial = begin({ ctrlKey: true });
  const moved = moveRotationDrag(initial, pointer({ clientX: 470, clientY: 365, ctrlKey: false }));
  assert.equal(moved.mode, "pan");
  assert.deepEqual(moved.view.orientation, initial.view.orientation);
  assert.equal(moved.view.zoom, initial.view.zoom);
  assert.ok(moved.view.pan[0] > initial.view.pan[0]);
  assert.ok(moved.view.pan[1] > initial.view.pan[1]);
  assert.equal(endRotationDrag(initial, pointer()).suppressClick, true);
  const rotated = moveRotationDrag(begin(), pointer({ clientX: 470, ctrlKey: true }));
  assert.equal(rotated.mode, "rotate");
});

test("unrelated or invalid pointer events cannot move or finish the gesture", () => {
  const drag = begin();
  assert.equal(moveRotationDrag(drag, pointer({ pointerId: 5, clientX: 580 })), drag);
  assert.equal(moveRotationDrag(drag, pointer({ clientX: NaN })), drag);
  assert.equal(moveRotationDrag(drag, null), drag);
  assert.equal(endRotationDrag(drag, pointer({ pointerId: 5 })), null);
  assert.equal(endRotationDrag(null, pointer()), null);
});

test("cancellation keeps the last pose and release can discover a missed threshold crossing", () => {
  const drag = begin();
  const moved = moveRotationDrag(drag, pointer({ clientX: 460 }));
  const cancelled = endRotationDrag(moved, pointer({ clientX: 700 }), true);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.suppressClick, true);
  assert.deepEqual(cancelled.view, moved.view);
  assert.equal(endRotationDrag(drag, null, true).suppressClick, true);
  const released = endRotationDrag(drag, pointer({ clientY: 360 }));
  assert.equal(released.dragged, true);
  assert.equal(released.suppressClick, true);
  assert.notDeepEqual(released.view.orientation, drag.view.orientation);
});

test("gesture snapshots do not mutate or retain mutable camera and viewport inputs", () => {
  const view = createProteinView(), original = structuredClone(view), viewport = { ...bounds };
  const drag = startRotationDrag(pointer(), view, viewport);
  view.orientation[0] = 99;
  view.pan[0] = 99;
  viewport.width = 1;
  assert.deepEqual(drag.startView, original);
  assert.deepEqual(drag.bounds, bounds);
  moveRotationDrag(drag, pointer({ clientX: 600, clientY: 430 }));
  assert.deepEqual(drag.view, original);
  assert.equal(drag.dragging, false);
});

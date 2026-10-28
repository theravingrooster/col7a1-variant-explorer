import test from "node:test";
import assert from "node:assert/strict";
import { startRotationDrag, moveRotationDrag, endRotationDrag } from "../src/rotation-drag.mjs";

const pointer = (overrides = {}) => ({ pointerId: 4, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100, clientY: 80, ...overrides });

test("only the primary left-button pointer can begin rotation", () => {
  assert.equal(startRotationDrag(pointer({ button: 2 }), 24), null);
  assert.equal(startRotationDrag(pointer({ isPrimary: false }), 24), null);
  assert.equal(startRotationDrag(pointer({ clientX: NaN }), 24), null);
  assert.equal(startRotationDrag(pointer(), Infinity), null);
  const drag = startRotationDrag(pointer(), 24);
  assert.equal(drag.angle, 24);
  assert.equal(drag.dragging, false);
});

test("small pointer jitter remains a region click, while horizontal dragging wraps rotation", () => {
  const drag = startRotationDrag(pointer(), 350);
  const jitter = moveRotationDrag(drag, pointer({ clientX: 103, clientY: 81 }));
  assert.equal(jitter.dragging, false);
  assert.equal(endRotationDrag(jitter, pointer({ clientX: 103, clientY: 81 })).suppressClick, false);
  const rotated = moveRotationDrag(drag, pointer({ clientX: 150 }));
  assert.equal(rotated.dragging, true);
  assert.equal(rotated.angle, 20);
  assert.equal(endRotationDrag(rotated, pointer({ clientX: 150 })).suppressClick, true);
  assert.equal(moveRotationDrag(startRotationDrag(pointer(), 10), pointer({ clientX: 50 })).angle, 340);
});

test("returning to the starting point after a drag must not select a region", () => {
  const moved = moveRotationDrag(startRotationDrag(pointer(), 24), pointer({ clientX: 160 }));
  const returned = moveRotationDrag(moved, pointer());
  assert.equal(returned.angle, 24);
  assert.equal(returned.dragging, true);
  assert.equal(endRotationDrag(returned, pointer()).suppressClick, true);
});

test("unrelated pointers cannot move or finish an active rotation", () => {
  const drag = startRotationDrag(pointer(), 24);
  assert.equal(moveRotationDrag(drag, pointer({ pointerId: 5, clientX: 180 })), drag);
  assert.equal(endRotationDrag(drag, pointer({ pointerId: 5 })), null);
});

test("vertical touch scrolling cancels rotation and cannot become an accidental region tap", () => {
  const drag = startRotationDrag(pointer({ pointerType: "touch" }), 24);
  const scrolling = moveRotationDrag(drag, pointer({ clientX: 102, clientY: 110 }));
  assert.equal(scrolling.cancelled, true);
  assert.equal(scrolling.dragging, false);
  assert.equal(scrolling.angle, 24);
  assert.equal(moveRotationDrag(scrolling, pointer({ clientX: 190, clientY: 112 })), scrolling);
  assert.equal(endRotationDrag(scrolling, pointer({ clientX: 190, clientY: 112 })).suppressClick, true);
  const horizontal = moveRotationDrag(drag, pointer({ clientX: 120, clientY: 82 }));
  assert.equal(horizontal.dragging, true);
  assert.equal(moveRotationDrag(horizontal, pointer({ clientX: 125, clientY: 180 })).cancelled, false);
});

test("pointer cancellation and a release that crosses the threshold suppress selection", () => {
  const drag = startRotationDrag(pointer(), 24);
  assert.equal(endRotationDrag(drag, null, true).suppressClick, true);
  const released = endRotationDrag(drag, pointer({ clientX: 130 }));
  assert.equal(released.dragged, true);
  assert.equal(released.angle, 42);
  assert.equal(released.suppressClick, true);
});

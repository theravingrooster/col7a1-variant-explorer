// Pointer gesture math only; source protein geometry is unchanged.
export const ROTATION_DRAG_THRESHOLD = 5;
export const ROTATION_DEGREES_PER_PIXEL = 0.6;
export const normalizeRotation = angle => ((angle % 360) + 360) % 360;

export function startRotationDrag(pointer, angle) {
  if (pointer.isPrimary === false || pointer.button !== 0 ||
      ![pointer.pointerId, pointer.clientX, pointer.clientY, angle].every(Number.isFinite)) return null;
  return {
    pointerId: pointer.pointerId,
    pointerType: pointer.pointerType || "mouse",
    startX: pointer.clientX,
    startY: pointer.clientY,
    startAngle: normalizeRotation(angle),
    angle: normalizeRotation(angle),
    moved: false,
    dragging: false,
    cancelled: false,
  };
}

export function moveRotationDrag(drag, pointer) {
  if (!drag || drag.pointerId !== pointer.pointerId ||
      ![pointer.clientX, pointer.clientY].every(Number.isFinite) || drag.cancelled) return drag;
  const dx = pointer.clientX - drag.startX, dy = pointer.clientY - drag.startY;
  const moved = drag.moved || Math.hypot(dx, dy) >= ROTATION_DRAG_THRESHOLD;
  // Let a predominantly vertical touch gesture scroll the page. Once a
  // horizontal drag begins, its direction remains locked until release.
  if (!drag.dragging && drag.pointerType === "touch" && moved && Math.abs(dy) > Math.abs(dx))
    return { ...drag, moved: true, cancelled: true };
  const dragging = drag.dragging || (moved && Math.abs(dx) >= ROTATION_DRAG_THRESHOLD);
  return { ...drag, moved, dragging, angle: dragging ? normalizeRotation(drag.startAngle + dx * ROTATION_DEGREES_PER_PIXEL) : drag.angle };
}

export function endRotationDrag(drag, pointer, cancelled = false) {
  if (!drag || (pointer && drag.pointerId !== pointer.pointerId)) return null;
  const final = pointer && !cancelled ? moveRotationDrag(drag, pointer) : drag;
  return {
    angle: final.angle,
    dragged: final.dragging,
    suppressClick: cancelled || final.cancelled || final.moved,
    cancelled: cancelled || final.cancelled,
  };
}

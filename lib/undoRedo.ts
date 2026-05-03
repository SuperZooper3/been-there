/**
 * Session-scoped undo/redo stack for draw and erase interactions.
 * Lives in React state — clears on page reload by design.
 */

export type CellAction =
  | { type: "paint"; cells: string[] }
  | { type: "erase"; cells: string[] };

export interface UndoRedoStack {
  past: CellAction[];
  future: CellAction[];
}

export function initialStack(): UndoRedoStack {
  return { past: [], future: [] };
}

export function pushAction(
  stack: UndoRedoStack,
  action: CellAction
): UndoRedoStack {
  return {
    past: [...stack.past, action],
    future: [], // new action clears redo history
  };
}

export function undo(
  stack: UndoRedoStack
): { stack: UndoRedoStack; action: CellAction | null } {
  if (stack.past.length === 0) return { stack, action: null };
  const past = [...stack.past];
  const action = past.pop()!;
  return {
    stack: { past, future: [action, ...stack.future] },
    action,
  };
}

export function redo(
  stack: UndoRedoStack
): { stack: UndoRedoStack; action: CellAction | null } {
  if (stack.future.length === 0) return { stack, action: null };
  const future = [...stack.future];
  const action = future.shift()!;
  return {
    stack: { past: [...stack.past, action], future },
    action,
  };
}

export function canUndo(stack: UndoRedoStack): boolean {
  return stack.past.length > 0;
}

export function canRedo(stack: UndoRedoStack): boolean {
  return stack.future.length > 0;
}

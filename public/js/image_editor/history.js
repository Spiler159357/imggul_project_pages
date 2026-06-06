export function createHistory(limit = 100) {
    return {
        stack: [],
        index: -1,
        limit
    };
}

export function pushCommand(history, command) {
    if (!history || !command) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push({
        id: command.id || `cmd_${Date.now().toString(36)}`,
        createdAt: Date.now(),
        ...command
    });
    if (history.stack.length > history.limit) history.stack.shift();
    history.index = history.stack.length - 1;
}

export function canUndo(history) {
    return !!history && history.index >= 0;
}

export function canRedo(history) {
    return !!history && history.index < history.stack.length - 1;
}

export function undo(history, editor) {
    if (!canUndo(history)) return false;
    const command = history.stack[history.index];
    command.revert?.(editor);
    history.index -= 1;
    editor.state.dirty = true;
    return true;
}

export function redo(history, editor) {
    if (!canRedo(history)) return false;
    history.index += 1;
    const command = history.stack[history.index];
    command.apply?.(editor);
    editor.state.dirty = true;
    return true;
}

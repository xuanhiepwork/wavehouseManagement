import { useEffect, useMemo, useState } from 'react';

const editors = ['sales', 'receiving', 'shift', 'receipt', 'issue', 'transfer', 'branches', 'users', 'catalog', 'warehouse'] as const;
type Editor = typeof editors[number];
type State = { dirty?: boolean; working?: boolean };

/** Stable callbacks let mounted editors survive navigation and token refreshes. */
export function useWorkspaceForms() {
    const [states, setStates] = useState<Partial<Record<Editor, State>>>({});
    const callbacks = useMemo(() => {
        const result = {} as Record<Editor, { onDirtyChange: (value: boolean) => void; onWorkingChange: (value: boolean) => void }>;
        for (const editor of editors) {
            const update = (field: keyof State, value: boolean) => setStates(previous => previous[editor]?.[field] === value ? previous
                : { ...previous, [editor]: { ...previous[editor], [field]: value } });
            result[editor] = { onDirtyChange: value => update('dirty', value), onWorkingChange: value => update('working', value) };
        }
        return result;
    }, []);
    const dirty = Object.values(states).some(state => state?.dirty);
    const working = Object.values(states).some(state => state?.working);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (dirty || working) { event.preventDefault(); event.returnValue = ''; }
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [dirty, working]);
    return { callbacks, dirty, working, reset: () => setStates({}) };
}

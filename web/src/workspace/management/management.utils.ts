import { useEffect } from 'react';

export type ActivityProps = {
    onDirtyChange?: (dirty: boolean) => void;
    onWorkingChange?: (working: boolean) => void;
};
export function useManagementActivity(dirty: boolean, busy: boolean, { onDirtyChange, onWorkingChange }: ActivityProps) {
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => { onWorkingChange?.(busy); }, [busy, onWorkingChange]);
    useEffect(() => () => { onDirtyChange?.(false); onWorkingChange?.(false); }, [onDirtyChange, onWorkingChange]);
    useEffect(() => {
        if (!dirty) return;
        const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', protect);
        return () => window.removeEventListener('beforeunload', protect);
    }, [dirty]);
}
export function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : 'Không thể hoàn tất yêu cầu. Dữ liệu nhập vẫn được giữ.';
}
export function mayDiscard(dirty: boolean): boolean {
    return !dirty || window.confirm('Bỏ các thay đổi chưa lưu trong biểu mẫu quản trị?');
}
export function timestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Thời gian không hợp lệ' : date.toLocaleString('vi-VN');
}

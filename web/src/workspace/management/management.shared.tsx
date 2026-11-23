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
export function Pagination({ page, total, busy, onPage }: { page: number; total: number; busy: boolean; onPage: (page: number) => void }) {
    const totalPages = Math.max(1, Math.ceil(total / 50));
    return <div className="wh-management-pagination" aria-label="Phân trang">
        <span>{total} bản ghi · Trang {page}/{totalPages} · 50 bản ghi/trang</span>
        <button type="button" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Trang trước</button>
        <button type="button" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>Trang sau</button>
    </div>;
}

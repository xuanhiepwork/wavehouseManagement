export function Pagination({ page, total, busy, onPage }: { page: number; total: number; busy: boolean; onPage: (page: number) => void }) {
    const totalPages = Math.max(1, Math.ceil(total / 50));
    return <div className="wh-management-pagination" aria-label="Phân trang">
        <span>{total} bản ghi · Trang {page}/{totalPages} · 50 bản ghi/trang</span>
        <button type="button" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Trang trước</button>
        <button type="button" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>Trang sau</button>
    </div>;
}

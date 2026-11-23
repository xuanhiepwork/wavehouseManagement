/** Presentation helpers only. Official KPI aggregation belongs to the server. */
export function dateOnly(value: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = (key: string) => parts.find(item => item.type === key)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}
export function dateIsValid(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function defaultDateRange(): { from: string; to: string } {
    const to = dateOnly();
    return { from: new Date(Date.parse(`${to}T00:00:00.000Z`) - 13 * 86400000).toISOString().slice(0, 10), to };
}
export function dateRangeError(from: string, to: string): string | null {
    if (!dateIsValid(from) || !dateIsValid(to)) return 'Chọn ngày bắt đầu và ngày kết thúc hợp lệ.';
    if (from > to) return 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.';
    if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1 > 93) return 'Chọn tối đa 93 ngày, bao gồm hai ngày đầu và cuối.';
    return null;
}
export function formatQuantity(value: string | null | undefined): string {
    if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value)) return '—';
    const [whole = '', fraction = ''] = value.split('.');
    const trimmed = fraction.replace(/0+$/, '');
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${trimmed ? `,${trimmed}` : ''}`;
}
export function formatMoney(value: string | null | undefined): string { return value == null ? '—' : `${formatQuantity(value)} ₫`; }
export function shiftName(value: string): string {
    return ({ MORNING: 'Ca sáng', AFTERNOON: 'Ca chiều', EVENING: 'Ca tối' } as Record<string, string>)[value] ?? value;
}
export function statusName(value: string): string {
    return ({ DRAFT: 'Nháp', SUBMITTED: 'Chờ duyệt', RETURNED: 'Trả sửa', APPROVED: 'Đã duyệt', CONFIRMED: 'Đã xác nhận', AWAITING_RECEIVING: 'Chưa lập biên bản' } as Record<string, string>)[value] ?? value;
}
export function timestamp(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa có cập nhật';
}
export type TrendRow = { date: string; approvedReports: number; netExpected: string | null };
export function revenueBars(rows: TrendRow[]) {
    const values = rows.map(r => r.approvedReports > 0 && r.netExpected !== null && /^-?\d+$/.test(r.netExpected) ? BigInt(r.netExpected) : null);
    let maximum = 0n;
    for (const value of values) if (value !== null) { const absolute = value < 0n ? -value : value; if (absolute > maximum) maximum = absolute; }
    return rows.map((row, index) => {
        const value = values[index];
        if (value === null || value === undefined) return { ...row, width: null, negative: false };
        const absolute = value < 0n ? -value : value;
        // Only this bounded visual scale (0..10000) is converted to Number.
        return { ...row, width: maximum === 0n ? 0 : Number(absolute * 10000n / maximum) / 100, negative: value < 0n };
    });
}

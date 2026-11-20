import { calculateSales, reviewDraft, type SalesDraft } from '../sales/sales-report';
import type { ShiftCount, CountStatus } from '../shift/shift-count.api';

export type DailyCount = {
    date: string;
    total: number;
    approved: number;
    submitted: number;
    returned: number;
    draft: number;
};

export type CountSummary = {
    total: number;
    approved: number;
    submitted: number;
    returned: number;
    draft: number;
    daily: DailyCount[];
};

export type SalesRow = {
    key: string;
    branchId: string;
    branchName: string;
    businessDate: string;
    shift: string;
    soldCups: number;
    netExpected: number;
    recordedReceipts: number;
    salesDifference: number;
    cashDifference: number;
};

export type SalesSummary = {
    rows: SalesRow[];
    cups: number | null;
    netExpected: number | null;
    recordedReceipts: number | null;
    salesDifference: number | null;
    cashDifference: number | null;
    skipped: number;
};

export function dateOnly(value: Date): string {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function dateIsValid(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftName(value: string): string {
    if (value === 'MORNING') return 'Ca sáng';
    if (value === 'AFTERNOON') return 'Ca chiều';
    if (value === 'EVENING') return 'Ca tối';
    return 'Không rõ';
}

const statuses: CountStatus[] = ['APPROVED', 'SUBMITTED', 'RETURNED', 'DRAFT'];

export function countSummary(counts: ShiftCount[], from: string, to: string, branchId: string): CountSummary {
    const filtered = counts.filter(item =>
        dateIsValid(item.businessDate) && item.businessDate >= from && item.businessDate <= to &&
        (!branchId || item.branchId === branchId)
    );
    const unique = new Map<string, ShiftCount>();
    for (const item of filtered) unique.set(item.id, item);
    const dailyMap = new Map<string, DailyCount>();
    const totals: CountSummary = { total: 0, approved: 0, submitted: 0, returned: 0, draft: 0, daily: [] };
    for (const count of unique.values()) {
        if (!statuses.includes(count.status)) continue;
        const date = count.businessDate;
        const daily = dailyMap.get(date) ?? { date, total: 0, approved: 0, submitted: 0, returned: 0, draft: 0 };
        daily.total++;
        totals.total++;
        if (count.status === 'APPROVED') { daily.approved++; totals.approved++; }
        if (count.status === 'SUBMITTED') { daily.submitted++; totals.submitted++; }
        if (count.status === 'RETURNED') { daily.returned++; totals.returned++; }
        if (count.status === 'DRAFT') { daily.draft++; totals.draft++; }
        dailyMap.set(date, daily);
    }
    totals.daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    return totals;
}

function safeSum(values: number[]): number | null {
    let result = 0;
    for (const value of values) {
        result += value;
        if (!Number.isSafeInteger(result)) return null;
    }
    return result;
}

export function salesSummary(drafts: SalesDraft[], from: string, to: string, branchId: string): SalesSummary {
    const rows: SalesRow[] = [];
    const keys = new Set<string>();
    let skipped = 0;
    for (const draft of drafts) {
        if (!dateIsValid(draft.businessDate) || draft.businessDate < from || draft.businessDate > to) continue;
        if (branchId && draft.branchId !== branchId) continue;
        const key = `${draft.branchId}:${draft.businessDate}:${draft.shift}`;
        if (keys.has(key)) { skipped++; continue; }
        if (reviewDraft(draft).length) { skipped++; continue; }
        const totals = calculateSales(draft);
        if (
            totals.soldCups === null || totals.netExpected === null || totals.recordedReceipts === null ||
            totals.salesDifference === null || totals.cashDifference === null
        ) { skipped++; continue; }
        keys.add(key);
        rows.push({
            key,
            branchId: draft.branchId,
            branchName: draft.branchName,
            businessDate: draft.businessDate,
            shift: draft.shift,
            soldCups: totals.soldCups,
            netExpected: totals.netExpected,
            recordedReceipts: totals.recordedReceipts,
            salesDifference: totals.salesDifference,
            cashDifference: totals.cashDifference,
        });
    }
    rows.sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.branchId.localeCompare(b.branchId));
    return {
        rows,
        cups: rows.length ? safeSum(rows.map(row => row.soldCups)) : null,
        netExpected: rows.length ? safeSum(rows.map(row => row.netExpected)) : null,
        recordedReceipts: rows.length ? safeSum(rows.map(row => row.recordedReceipts)) : null,
        salesDifference: rows.length ? safeSum(rows.map(row => row.salesDifference)) : null,
        cashDifference: rows.length ? safeSum(rows.map(row => row.cashDifference)) : null,
        skipped,
    };
}

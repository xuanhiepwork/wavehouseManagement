/** W4 draft-only accounting model. No API writes and no token persistence. */
export type WorkShift = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type DrinkSize = 'S' | 'M' | 'L' | 'OTHER';

export type SalesLine = {
    id: string;
    productName: string;
    size: DrinkSize;
    quantity: string;
    unitPrice: string;
    note: string;
};

export type SalesAmounts = {
    cashReceived: string;
    bankTransfer: string;
    momo: string;
    grab: string;
    otherReceived: string;
    discounts: string;
    refunds: string;
    openingCash: string;
    cashExpenses: string;
    cashHandovers: string;
    closingCashActual: string;
};

export type SalesDraft = {
    formatVersion: 1;
    businessDate: string;
    shift: WorkShift;
    branchId: string;
    branchName: string;
    reporterName: string;
    cashierName: string;
    baristaName: string;
    notes: string;
    lines: SalesLine[];
    amounts: SalesAmounts;
};

export type SalesTotals = {
    grossSales: number | null;
    netExpected: number | null;
    recordedReceipts: number | null;
    salesDifference: number | null;
    expectedClosingCash: number | null;
    cashDifference: number | null;
    soldCups: number | null;
};

export const amountFields: ReadonlyArray<{ key: keyof SalesAmounts; label: string; hint: string }> = [
    { key: 'cashReceived', label: 'Tiền mặt thu từ bán hàng', hint: 'Không bao gồm tiền đầu ca' },
    { key: 'bankTransfer', label: 'Chuyển khoản', hint: 'Số tiền giao dịch ghi nhận' },
    { key: 'momo', label: 'MoMo', hint: 'Số tiền giao dịch ghi nhận' },
    { key: 'grab', label: 'Grab / nền tảng giao đồ uống', hint: 'Ghi số bán trước khi trừ phí nền tảng' },
    { key: 'otherReceived', label: 'Kênh khác', hint: 'Ghi chú rõ nguồn thu' },
    { key: 'discounts', label: 'Giảm giá trong ca', hint: 'Tổng giá trị ưu đãi' },
    { key: 'refunds', label: 'Hoàn / hủy đơn đã ghi doanh thu', hint: 'Chỉ nhập khi doanh thu gộp có bao gồm đơn đó' },
    { key: 'openingCash', label: 'Tiền mặt đầu ca', hint: 'Tiền nhận bàn giao trước khi bán' },
    { key: 'cashExpenses', label: 'Tiền mặt chi trong ca', hint: 'Có chứng từ hoặc ghi chú' },
    { key: 'cashHandovers', label: 'Tiền mặt đã nộp / bàn giao trước chốt', hint: 'Không gồm tiền thực đếm còn lại' },
    { key: 'closingCashActual', label: 'Tiền mặt thực đếm cuối ca', hint: 'Nhập sau khi kiểm đếm két tiền' },
];

export function newLine(): SalesLine {
    return {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        productName: '', size: 'M', quantity: '', unitPrice: '', note: '',
    };
}

export function newSalesDraft(): SalesDraft {
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return {
        formatVersion: 1,
        businessDate: localDate,
        shift: 'MORNING',
        branchId: '', branchName: '', reporterName: '', cashierName: '', baristaName: '', notes: '',
        lines: [newLine()],
        amounts: {
            cashReceived: '0', bankTransfer: '0', momo: '0', grab: '0', otherReceived: '0',
            discounts: '0', refunds: '0', openingCash: '0', cashExpenses: '0',
            cashHandovers: '0', closingCashActual: '',
        },
    };
}

// Only integer VND values. A blank or malformed value never silently becomes zero.
export function parseVnd(value: string): number | null {
    if (!/^\d{1,12}$/.test(value)) return null;
    const amount = Number(value);
    return Number.isSafeInteger(amount) ? amount : null;
}
export function parseCups(value: string): number | null {
    if (!/^\d{1,6}$/.test(value)) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n <= 100000 ? n : null;
}
export function formatVnd(value: number | null): string {
    return value === null || !Number.isSafeInteger(value)
        ? 'Chưa đủ dữ liệu'
        : `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
}

export function calculateSales(draft: SalesDraft): SalesTotals {
    let grossSales: number | null = draft.lines.length > 0 ? 0 : null;
    let soldCups: number | null = draft.lines.length > 0 ? 0 : null;
    for (const line of draft.lines) {
        const count = parseCups(line.quantity);
        const price = parseVnd(line.unitPrice);
        if (!line.productName.trim() || count === null || price === null) {
            grossSales = null;
            soldCups = null;
            break;
        }
        if (grossSales !== null) {
            const lineTotal = count * price;
            grossSales += lineTotal;
            if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(grossSales)) grossSales = null;
        }
        if (soldCups !== null) soldCups += count;
    }
    const a = draft.amounts;
    const sum = (keys: (keyof SalesAmounts)[]): number | null => {
        let result = 0;
        for (const key of keys) {
            const number = parseVnd(a[key]);
            if (number === null) return null;
            result += number;
        }
        return Number.isSafeInteger(result) ? result : null;
    };
    const discountsAndRefunds = sum(['discounts', 'refunds']);
    const netExpected = grossSales !== null && discountsAndRefunds !== null
        ? grossSales - discountsAndRefunds : null;
    const recordedReceipts = sum(['cashReceived', 'bankTransfer', 'momo', 'grab', 'otherReceived']);
    const cashBase = sum(['openingCash', 'cashReceived']);
    const cashOut = sum(['cashExpenses', 'cashHandovers']);
    const expectedClosingCash = cashBase !== null && cashOut !== null ? cashBase - cashOut : null;
    const closingCashActual = parseVnd(a.closingCashActual);
    return {
        grossSales, netExpected, recordedReceipts,
        salesDifference: netExpected !== null && recordedReceipts !== null ? recordedReceipts - netExpected : null,
        expectedClosingCash,
        cashDifference: expectedClosingCash !== null && closingCashActual !== null
            ? closingCashActual - expectedClosingCash : null,
        soldCups,
    };
}

export function reviewDraft(draft: SalesDraft): string[] {
    const problems: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate)
        || Number.isNaN(new Date(`${draft.businessDate}T00:00:00Z`).getTime())
        || new Date(`${draft.businessDate}T00:00:00Z`).toISOString().slice(0, 10) !== draft.businessDate) {
        problems.push('Ngày kinh doanh không hợp lệ.');
    }
    if (!draft.branchId.trim()) problems.push('Chưa có mã chi nhánh; vui lòng chọn/điền chi nhánh trước khi bàn giao.');
    if (!draft.reporterName.trim()) problems.push('Chưa nhập tên người lập báo cáo.');
    if (draft.lines.length === 0) problems.push('Chưa nhập đồ uống được bán.');
    for (const [index, line] of draft.lines.entries()) {
        if (!line.productName.trim() || parseCups(line.quantity) === null || parseVnd(line.unitPrice) === null) {
            problems.push(`Dòng đồ uống ${index + 1}: cần tên, số ly nguyên và đơn giá nguyên VND.`);
        }
    }
    for (const { key, label } of amountFields) {
        if (parseVnd(draft.amounts[key]) === null) problems.push(`${label}: cần số nguyên không âm (VND).`);
    }
    const totals = calculateSales(draft);
    if (draft.lines.every(line => line.productName.trim() && parseCups(line.quantity) !== null && parseVnd(line.unitPrice) !== null) && totals.grossSales === null) problems.push('Doanh thu theo sản phẩm vượt giới hạn số nguyên an toàn.');
    if (totals.netExpected !== null && totals.netExpected < 0) problems.push('Giảm giá và hoàn tiền lớn hơn doanh thu gộp.');
    if (totals.expectedClosingCash !== null && totals.expectedClosingCash < 0) problems.push('Dòng tiền mặt dự kiến âm; cần kiểm tra khoản chi/bàn giao.');
    return problems;
}

function asObj(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}
function text(value: unknown, max = 300): string {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Import only known fields; JSON is treated as untrusted input. */
export function importDraft(raw: unknown): SalesDraft {
    const root = asObj(raw);
    const entry = asObj(root?.draft);
    if (!root || root.kind !== 'WAVEHOUSE_W4_DRAFT' || !entry || entry.formatVersion !== 1) {
        throw new Error('File không phải bản nháp W4 hợp lệ.');
    }
    if (!Array.isArray(entry.lines) || entry.lines.length > 100) {
        throw new Error('Danh sách đồ uống trong file không hợp lệ (tối đa 100 dòng).');
    }
    if (!['MORNING', 'AFTERNOON', 'EVENING'].includes(String(entry.shift))) {
        throw new Error('Ca làm việc trong file không hợp lệ.');
    }
    const a = asObj(entry.amounts);
    if (!a) throw new Error('File thiếu thông tin thanh toán.');
    const base = newSalesDraft();
    const amounts = { ...base.amounts };
    for (const { key } of amountFields) {
        amounts[key] = text(a[key], 12);
    }
    const lines: SalesLine[] = entry.lines.map((value, i) => {
        const obj = asObj(value);
        if (!obj) throw new Error(`Định dạng dòng ${i + 1} không hợp lệ.`);
        const size = String(obj.size);
        if (!['S', 'M', 'L', 'OTHER'].includes(size)) throw new Error(`Size dòng ${i + 1} không hợp lệ.`);
        return {
            id: `import-${i}-${Math.random().toString(36).slice(2, 9)}`,
            productName: text(obj.productName, 120),
            size: size as DrinkSize,
            quantity: text(obj.quantity, 6),
            unitPrice: text(obj.unitPrice, 12),
            note: text(obj.note, 240),
        };
    });
    return {
        formatVersion: 1,
        businessDate: text(entry.businessDate, 10),
        shift: entry.shift as WorkShift,
        branchId: text(entry.branchId, 100),
        branchName: text(entry.branchName, 100),
        reporterName: text(entry.reporterName, 120),
        cashierName: text(entry.cashierName, 120),
        baristaName: text(entry.baristaName, 120),
        notes: text(entry.notes, 1500),
        lines,
        amounts,
    };
}

export function exportDraft(draft: SalesDraft): string {
    return JSON.stringify({
        kind: 'WAVEHOUSE_W4_DRAFT',
        status: 'LOCAL_DRAFT_NOT_SUBMITTED',
        createdAt: new Date().toISOString(),
        draft,
        calculations: calculateSales(draft),
        validationProblems: reviewDraft(draft),
        disclaimer: 'Bản nháp do trình duyệt xuất. Chưa được lưu hoặc xác nhận trên hệ thống.',
    }, null, 2);
}

/** AI4: pure, read-only display helpers. Never use JS Number for quantity arithmetic. */
export type Origin = 'AI2_ML' | 'B7_HEURISTIC';
export type OverlayState = 'ML_AVAILABLE' | 'ML_PARTIAL' | 'B7_FALLBACK' | 'NOT_CONNECTED' | 'INVALID_OVERLAY';
export type Shift = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type IngredientUnit = 'g' | 'ml' | 'piece';
export type B7Recommendation = {
    destinationBranchId: string;
    destinationBranchCode: string;
    destinationBranchName: string;
    ingredientId: string;
    ingredientCode: string;
    ingredientName: string;
    unit: IngredientUnit;
    onHand: string;
    predictedConsumption: string;
    requestedQuantity: string;
    proposedDeliveryQuantity: string;
    unfulfilledQuantity: string;
    historySamples: number | null;
    forecastMethod: string;
};
export type AI4Row = B7Recommendation & {
    effectiveDemand: string;
    source: Origin;
    modelVersion: string | null;
    uncertaintyLower: string | null;
    uncertaintyUpper: string | null;
    reason: string | null;
};
export type AI4View = {
    businessDate: string;
    shift: Shift;
    sourceBranchName: string;
    sourceBranchCode: string;
    rows: AI4Row[];
    state: OverlayState;
    warnings: string[];
    generatedAt: string | null;
    deliveryQuantitiesRemainB7: true;
};

export const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const QUANTITY = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
export const SHIFT_LABEL: Record<Shift, string> = { MORNING: 'Ca sáng', AFTERNOON: 'Ca chiều', EVENING: 'Ca tối' };

export function isQuantity(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 48 && QUANTITY.test(value);
}
export function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}
function str(value: unknown): string { return typeof value === 'string' ? value : ''; }
function decimalParts(value: string): [string, string] {
    const [whole, fraction = ''] = value.split('.');
    return [whole.replace(/^0+(?=\d)/, ''), fraction.replace(/0+$/, '')];
}
export function compareQuantity(a: string, b: string): number {
    if (!isQuantity(a) || !isQuantity(b)) throw new Error('Số lượng không hợp lệ.');
    const [aw, af] = decimalParts(a);
    const [bw, bf] = decimalParts(b);
    if (aw.length !== bw.length) return aw.length > bw.length ? 1 : -1;
    if (aw !== bw) return aw > bw ? 1 : -1;
    const len = Math.max(af.length, bf.length);
    const aa = af.padEnd(len, '0');
    const bb = bf.padEnd(len, '0');
    return aa === bb ? 0 : aa > bb ? 1 : -1;
}
export function formatQuantity(value: string): string {
    if (!isQuantity(value)) return '—';
    const [w, f] = decimalParts(value);
    const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return f ? `${grouped},${f}` : grouped;
}
export function validDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function nextBusinessDateVN(): string {
    // Advance one civil day from the current instant, then format in VN timezone.
    const instant = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant);
    const part = (type: string) => parts.find(row => row.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}
function parseB7Row(value: unknown): B7Recommendation {
    const obj = asRecord(value);
    if (!obj) throw new Error('B7 trả dòng nguyên liệu không hợp lệ.');
    const branchId = str(obj.destinationBranchId), ingredientId = str(obj.ingredientId), unit = str(obj.unit);
    if (!UUID.test(branchId) || !UUID.test(ingredientId) || !['g', 'ml', 'piece'].includes(unit)) {
        throw new Error('B7 trả ID hoặc đơn vị nguyên liệu không hợp lệ.');
    }
    const quantities = [obj.onHand, obj.predictedConsumption, obj.requestedQuantity, obj.proposedDeliveryQuantity, obj.unfulfilledQuantity];
    if (quantities.some(item => !isQuantity(item))) throw new Error('B7 trả số lượng không hợp lệ.');
    return {
        destinationBranchId: branchId,
        destinationBranchCode: str(obj.destinationBranchCode),
        destinationBranchName: str(obj.destinationBranchName) || branchId,
        ingredientId,
        ingredientCode: str(obj.ingredientCode),
        ingredientName: str(obj.ingredientName) || ingredientId,
        unit: unit as IngredientUnit,
        onHand: quantities[0] as string,
        predictedConsumption: quantities[1] as string,
        requestedQuantity: quantities[2] as string,
        proposedDeliveryQuantity: quantities[3] as string,
        unfulfilledQuantity: quantities[4] as string,
        historySamples: typeof obj.historySamples === 'number' && Number.isInteger(obj.historySamples) && obj.historySamples >= 0
            ? obj.historySamples : null,
        forecastMethod: str(obj.forecastMethod),
    };
}
function fallback(row: B7Recommendation, reason: string): AI4Row {
    return {
        ...row, effectiveDemand: row.predictedConsumption,
        source: 'B7_HEURISTIC', modelVersion: null,
        uncertaintyLower: null, uncertaintyUpper: null, reason
    };
}
const STATES: OverlayState[] = ['ML_AVAILABLE', 'ML_PARTIAL', 'B7_FALLBACK', 'NOT_CONNECTED', 'INVALID_OVERLAY'];
function readOverlay(raw: unknown, rows: B7Recommendation[]): { rows: AI4Row[]; state: OverlayState; warnings: string[] } {
    if (raw === undefined || raw === null) {
        return {
            rows: rows.map(r => fallback(r, 'AI3_NOT_WIRED')),
            state: 'NOT_CONNECTED', warnings: ['Backend B7 chưa trả trường ai. Đang hiển thị số liệu B7, không phải dự báo Machine Learning.']
        };
    }
    const invalid = (): { rows: AI4Row[]; state: OverlayState; warnings: string[] } => ({
        rows: rows.map(r => fallback(r, 'INVALID_AI_OVERLAY')),
        state: 'INVALID_OVERLAY', warnings: ['AI3 trả dữ liệu không khớp B7; hiển thị B7 an toàn. Cần đối chiếu contract AI3 tại Backend.'],
    });
    const obj = asRecord(raw);
    if (!obj || !STATES.slice(0, 3).includes(obj.status as OverlayState)
        || obj.deliveryQuantitiesRemainB7 !== true || !Array.isArray(obj.demandEstimates)
        || !Array.isArray(obj.warnings) || obj.demandEstimates.length !== rows.length) return invalid();
    if (obj.warnings.length > 40 || obj.warnings.some(w => typeof w !== 'string' || w.length > 500)) return invalid();
    const baseline = new Map(rows.map(r => [`${r.destinationBranchId}/${r.ingredientId}`, r]));
    if (baseline.size !== rows.length) return invalid();
    const seen = new Set<string>();
    const enriched: AI4Row[] = [];
    for (const item of obj.demandEstimates) {
        const d = asRecord(item);
        if (!d) return invalid();
        const key = `${str(d.destinationBranchId)}/${str(d.ingredientId)}`;
        const row = baseline.get(key);
        if (!row || seen.has(key) || d.unit !== row.unit || !isQuantity(d.predictedConsumption)
            || compareQuantity(d.predictedConsumption, row.predictedConsumption) !== 0
            || (d.source !== 'AI2_ML' && d.source !== 'B7_HEURISTIC')
            || !isQuantity(d.effectiveDemand)) return invalid();
        seen.add(key);
        if (d.source === 'AI2_ML') {
            if (typeof d.modelVersion !== 'string' || !d.modelVersion || d.modelVersion.length > 120) return invalid();
            const lo = d.uncertaintyLower, hi = d.uncertaintyUpper;
            if (!((lo === null && hi === null) || (isQuantity(lo) && isQuantity(hi)
                && compareQuantity(lo, d.effectiveDemand) <= 0 && compareQuantity(d.effectiveDemand, hi) <= 0))) return invalid();
        } else if (d.modelVersion !== null || d.uncertaintyLower !== null || d.uncertaintyUpper !== null
            || compareQuantity(d.effectiveDemand, row.predictedConsumption) !== 0) return invalid();
        if (d.reason !== null && (typeof d.reason !== 'string' || d.reason.length > 200)) return invalid();
        enriched.push({
            ...row, effectiveDemand: d.effectiveDemand,
            source: d.source, modelVersion: d.modelVersion as string | null,
            uncertaintyLower: d.uncertaintyLower as string | null,
            uncertaintyUpper: d.uncertaintyUpper as string | null, reason: d.reason as string | null
        });
    }
    const ml = enriched.filter(r => r.source === 'AI2_ML').length;
    const derived = ml === 0 ? 'B7_FALLBACK' : ml === rows.length ? 'ML_AVAILABLE' : 'ML_PARTIAL';
    if (derived !== obj.status) return invalid();
    const dataByKey = new Map(enriched.map(r => [`${r.destinationBranchId}/${r.ingredientId}`, r]));
    return {
        rows: rows.map(row => dataByKey.get(`${row.destinationBranchId}/${row.ingredientId}`) ?? fallback(row, 'AI_ROW_MISSING')),
        state: derived, warnings: obj.warnings as string[],
    };
}
/** Strictly retain B7 dispatch quantities; AI controls advisory demand only. */
export function parseAI4Response(payload: unknown): AI4View {
    const root = asRecord(payload);
    const b7 = asRecord(root?.data);
    if (!root || !b7 || !Array.isArray(b7.recommendations)
        || b7.recommendations.length > 5000 || !validDate(str(b7.businessDate))
        || !['MORNING', 'AFTERNOON', 'EVENING'].includes(str(b7.shift))) {
        throw new Error('API B7 trả dữ liệu kế hoạch không đúng cấu trúc.');
    }
    const branch = asRecord(b7.sourceBranch);
    const rows = b7.recommendations.map(parseB7Row);
    const overlay = readOverlay(root.ai, rows);
    const notes = Array.isArray(b7.notes) ? b7.notes.filter(
        (note): note is string => typeof note === 'string' && note.length <= 500,
    ).slice(0, 20) : [];
    const lowHistory = rows.filter(row => row.historySamples !== null && row.historySamples < 3).length;
    if (lowHistory > 0) notes.push(`${lowHistory} dòng B7 có dưới 3 mẫu lịch sử; kiểm tra độ bao phủ trước khi lập phiếu.`);
    return {
        businessDate: b7.businessDate as string, shift: b7.shift as Shift,
        sourceBranchName: str(branch?.name) || str(branch?.id),
        sourceBranchCode: str(branch?.code),
        rows: overlay.rows, state: overlay.state,
        warnings: [...overlay.warnings, ...notes], generatedAt: null,
        deliveryQuantitiesRemainB7: true,
    };
}
export function sourceLabel(source: Origin): string {
    return source === 'AI2_ML' ? 'AI2 · ML' : 'B7 · Quy tắc';
}

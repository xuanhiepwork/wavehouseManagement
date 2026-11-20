import { isQuantity, quantityScaled, type ForecastPlan, type Recommendation } from './warehouse.api';

export type DispatchLine = {
    destinationBranchId: string;
    destinationBranchCode: string;
    ingredientId: string;
    ingredientCode: string;
    ingredientName: string;
    unit: string;
    quantity: string;
    requestedQuantity: string;
    notCoveredQuantity: string;
};

function formatScaled(value: bigint): string {
    const whole = value / 1000000n;
    const decimal = String(value % 1000000n).padStart(6, '0').replace(/0+$/, '');
    return `${whole}${decimal ? `.${decimal}` : ''}`;
}

export function lineId(line: Pick<Recommendation, 'destinationBranchId' | 'ingredientId'>): string {
    return `${line.destinationBranchId}:${line.ingredientId}`;
}
export function validateDispatchQuantity(quantity: string, row: Recommendation): string | null {
    if (!isQuantity(quantity)) return 'Số lượng phải không âm, tối đa 6 chữ số thập phân.';
    if (row.unit.toLowerCase() === 'piece' && !/^\d+$/.test(quantity)) return 'Nguyên liệu đơn vị piece cần số nguyên.';
    if (quantityScaled(quantity) > quantityScaled(row.proposedDeliveryQuantity)) {
        return 'Không được vượt lượng kho có thể cấp theo dự báo đã tải.';
    }
    return null;
}
export function buildDispatchDraft(
    plan: ForecastPlan,
    quantities: Record<string, string>,
    selected: Record<string, boolean>,
    metadata: { deliveryTime: string; assignedTo: string; note: string },
): string {
    if (!/^\d{2}:\d{2}$/.test(metadata.deliveryTime)) throw new Error('Chọn giờ dự kiến giao (HH:MM).');
    const [hour, minute] = metadata.deliveryTime.split(':').map(Number);
    if (hour > 23 || minute > 59) throw new Error('Giờ giao không hợp lệ.');
    if (metadata.assignedTo.length > 120 || metadata.note.length > 500) throw new Error('Thông tin giao hàng quá dài.');

    const lines: DispatchLine[] = plan.recommendations.filter(row => selected[lineId(row)] !== false).map(row => {
        const quantity = quantities[lineId(row)] ?? row.proposedDeliveryQuantity;
        const error = validateDispatchQuantity(quantity, row);
        if (error) throw new Error(`${row.ingredientName} / ${row.destinationBranchName}: ${error}`);
        return {
            destinationBranchId: row.destinationBranchId,
            destinationBranchCode: row.destinationBranchCode,
            ingredientId: row.ingredientId,
            ingredientCode: row.ingredientCode,
            ingredientName: row.ingredientName,
            unit: row.unit,
            quantity,
            requestedQuantity: row.requestedQuantity,
            notCoveredQuantity: formatScaled(quantityScaled(row.requestedQuantity) - quantityScaled(quantity)),
        };
    }).filter(line => quantityScaled(line.quantity) > 0n);
    if (lines.length === 0) throw new Error('Không có dòng nguyên liệu có số lượng giao lớn hơn 0.');

    return JSON.stringify({
        kind: 'WAVEHOUSE_W5_DISPATCH_DRAFT',
        schemaVersion: 1,
        status: 'LOCAL_DRAFT_NOT_POSTED',
        exportedAt: new Date().toISOString(),
        forecastFetchedAt: plan.fetchedAt,
        sourceBranch: plan.sourceBranch,
        businessDate: plan.businessDate,
        shift: plan.shift,
        dayType: plan.dayType,
        estimatedDeliveryTime: metadata.deliveryTime,
        assignedTo: metadata.assignedTo.trim(),
        note: metadata.note.trim(),
        lines,
        warning: 'Chỉ là bản nháp điều phối từ B7. Chưa tạo phiếu B5, chưa trừ tồn, chưa xác nhận giao/nhận. Phải kiểm tra lại tồn thực tế trước khi ghi chứng từ.',
    }, null, 2);
}

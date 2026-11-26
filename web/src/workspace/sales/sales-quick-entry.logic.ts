import type { SalesInput, SalesProduct, SalesSize } from './sales.api';

export type QuickSize = Exclude<SalesSize, 'OTHER'>;
export const quickSizes: readonly QuickSize[] = ['S', 'M', 'L'];
export type SalesLine = SalesInput['lines'][number];

/** A Catalog price is eligible for W7.3 only when it is exactly an integer VND value.
 * Accept a decimal representation with trailing zeroes without rounding money. */
export function catalogVnd(price: string): string | null {
    const match = /^(0|[1-9]\d{0,11})(?:\.0{1,4})?$/.exec(price);
    return match ? match[1] : null;
}

export function lineForVariant(lines: SalesLine[], productId: string, size: QuickSize): SalesLine | undefined {
    return lines.find(l => l.productId === productId && l.size === size);
}

export function countForVariant(lines: SalesLine[], productId: string, size: QuickSize): number {
    return lines.filter(l => l.productId === productId && l.size === size)
        .reduce((quantity, line) => quantity + (Number.isSafeInteger(line.quantity) ? line.quantity : 0), 0);
}

/** Edits ONLY an identified Catalog product/size. Never coalesces historical duplicate rows.
 * Clearing a non-annotated variant removes it from the draft; annotated rows need explicit review. */
export function setVariantQuantity(lines: SalesLine[], product: SalesProduct, size: QuickSize, raw: string): SalesLine[] {
    if (!product.isAvailable) throw new Error('Sản phẩm đã ngừng bán.');
    if (!/^(?:0|[1-9]\d{0,5})?$/.test(raw)) throw new Error('Số ly phải là số nguyên từ 0 đến 999999.');
    const variant = product.prices.find(item => item.size === size);
    if (!variant) throw new Error('Sản phẩm không có kích cỡ này.');
    const unitPrice = catalogVnd(variant.price);
    if (unitPrice === null) throw new Error('Đơn giá Catalog chưa phải số nguyên VND; cần chỉnh sửa giá trước khi chọn.');
    const hits = lines.map((line, index) => line.productId === product._id && line.size === size ? index : -1).filter(index => index >= 0);
    if (hits.length > 1) throw new Error('Biến thể có nhiều dòng trong báo cáo. Chỉnh sửa từng dòng ở bảng chi tiết.');
    const amount = raw === '' ? 0 : Number(raw);
    const index = hits[0];
    if (index !== undefined) {
        const existing = lines[index];
        if (amount === 0 && !existing.note) return lines.filter((_, i) => i !== index);
        return lines.map((line, i) => i === index ? { ...line, quantity: amount } : line);
    }
    if (amount === 0) return lines;
    if (lines.length >= 100) throw new Error('Báo cáo đã có tối đa 100 dòng bán hàng.');
    return [...lines, { productId: product._id, productName: product.name, size, quantity: amount, unitPrice, note: null }];
}

export function quickTotals(lines: SalesLine[]) {
    let cups = 0;
    let amount = 0n;
    for (const line of lines) {
        if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) continue;
        cups += line.quantity;
        const price = catalogVnd(line.unitPrice);
        if (price !== null) amount += BigInt(price) * BigInt(line.quantity);
    }
    return { cups, amount: amount.toString() };
}

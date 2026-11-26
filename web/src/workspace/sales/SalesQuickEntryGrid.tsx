import { useMemo, useState } from 'react';
import type { SalesInput, SalesProduct } from './sales.api';
import { catalogVnd, countForVariant, quickSizes, quickTotals, setVariantQuantity } from './sales-quick-entry.logic';
import './SalesQuickEntryGrid.css';

type Props = {
    products: SalesProduct[];
    lines: SalesInput['lines'];
    disabled: boolean;
    onChange: (lines: SalesInput['lines']) => void;
};
const money = (raw: string) => BigInt(raw).toLocaleString('vi-VN');

/** An Excel-like input surface backed by real PostgreSQL Catalog products.
 * SalesInput remains the only source of truth; the detail table below is still available. */
export default function SalesQuickEntryGrid({ products, lines, disabled, onChange }: Props) {
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');
    const active = useMemo(() => products.filter(p => p.isAvailable).sort((a, b) => a.name.localeCompare(b.name, 'vi')), [products]);
    const visible = useMemo(() => active.filter(p => p.name.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))), [active, search]);
    const totals = useMemo(() => quickTotals(lines), [lines]);
    function change(product: SalesProduct, size: 'S' | 'M' | 'L', raw: string) {
        try {
            const next = setVariantQuantity(lines, product, size, raw);
            setError('');
            onChange(next);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể cập nhật số ly.'); }
    }
    if (!active.length) return <p className="w73-muted">Chưa có sản phẩm đang kinh doanh trong Catalog. Cần tạo sản phẩm và kích cỡ trước khi nhập số ly theo bảng.</p>;
    return <div className="w73-quick-entry">
        <div className="w73-quick-head"><div><h4>Nhập nhanh số ly theo sản phẩm và kích cỡ</h4>
            <p className="w73-muted">Nhập 0 hoặc xóa ô để bỏ dòng chưa ghi chú; bản nháp giữ nguyên đơn giá đã lưu. Bảng chi tiết bên dưới cho phép chỉnh giá thực tế và ghi chú.</p></div>
            <label>Tìm đồ uống<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên sản phẩm…" /></label>
        </div>
        {error && <p className="w4-error" role="alert">{error}</p>}
        <div className="w4-table-scroll" role="region" aria-label="Bảng nhập nhanh số ly" tabIndex={0}>
            <table className="w4-table w73-quick-table"><thead><tr><th scope="col">Sản phẩm</th>
                {quickSizes.map(size => <th key={size} scope="col">Size {size}</th>)}<th scope="col">Tổng ly</th></tr></thead>
                <tbody>{visible.map(product => <tr key={product._id}><th scope="row">{product.name}</th>
                    {quickSizes.map(size => {
                        const price = product.prices.find(p => p.size === size);
                        const normalized = price ? catalogVnd(price.price) : null;
                        const matching = lines.filter(line => line.productId === product._id && line.size === size);
                        const duplicate = matching.length > 1;
                        const quantity = countForVariant(lines, product._id, size);
                        return <td key={size}>{price ? <div className="w73-quick-cell">
                            <input aria-label={`${product.name} size ${size} - số ly`} type="number" inputMode="numeric"
                                min={0} max={999999} step={1} value={quantity || ''} placeholder="0"
                                title={duplicate ? 'Nhiều dòng trùng kích cỡ; chỉnh trong bảng chi tiết.' : normalized === null ? 'Đơn giá không nguyên VND.' : undefined}
                                disabled={disabled || duplicate || normalized === null}
                                onChange={event => change(product, size, event.target.value)} />
                            <small>{normalized === null ? 'Giá chưa hợp lệ' : `${money(normalized)} ₫`}</small>
                        </div> : <span className="w73-quick-na" aria-label={`${product.name} không có size ${size}`}>—</span>}</td>;
                    })}<td className="w73-quick-total">{quickSizes.reduce((n, size) => n + countForVariant(lines, product._id, size), 0)}</td></tr>)}
                    {visible.length === 0 && <tr><td colSpan={5}>Không có sản phẩm phù hợp từ Catalog.</td></tr>}
                </tbody>
            </table>
        </div>
        <p className="w73-quick-summary">Tổng trong bản nháp: <strong>{totals.cups.toLocaleString('vi-VN')} ly</strong> · Doanh thu gộp dự kiến <strong>{money(totals.amount)} ₫</strong></p>
    </div>;
}

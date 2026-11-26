import { useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import { belowMinimum, formatInventoryQuantity, INVENTORY_PAGE_SIZE, loadInventoryBalances, loadInventoryBranches, loadInventoryMovements,
    type Balance, type InventoryBranch, type InventoryPageResult, type Movement } from './inventory.api';
import './InventoryPage.css';

type Props = { session: AuthSession };
type View = 'balances' | 'movements';
type InventoryResult = {
    key: string;
    balances?: InventoryPageResult<Balance>;
    movements?: InventoryPageResult<Movement>;
};
const kindNames: Record<string, string> = { OPENING: 'Tồn đầu kỳ', RECEIPT: 'Nhập hàng', ISSUE: 'Xuất hàng', TRANSFER_IN: 'Chuyển đến',
    TRANSFER_OUT: 'Chuyển đi', COUNT_ADJUSTMENT: 'Điều chỉnh kiểm kê', RECIPE_CONSUMPTION: 'Tiêu hao công thức' };
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Không tải được dữ liệu kho.';
const dateText = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export function InventoryPage({ session }: Props) {
    const admin = session.user.role === 'ADMIN';
    const [branches, setBranches] = useState<InventoryBranch[]>([]);
    const [branchId, setBranchId] = useState(admin ? '' : session.user.branchId ?? '');
    const [branchLoading, setBranchLoading] = useState(true);
    const [branchError, setBranchError] = useState('');
    const [branchReload, setBranchReload] = useState(0);
    const [view, setView] = useState<View>('balances');
    const [ingredientFilter, setIngredientFilter] = useState<{ id: string; label: string } | null>(null);
    const [page, setPage] = useState(1);
    const [reload, setReload] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<InventoryResult | null>(null);
    const requestSequence = useRef(0);
    const key = JSON.stringify({ branchId, view, ingredientId: ingredientFilter?.id ?? '', page });
    const latestKey = useRef(key);
    useEffect(() => { latestKey.current = key; }, [key]);

    useEffect(() => {
        const controller = new AbortController();
        void Promise.resolve().then(() => {
            if (controller.signal.aborted) return null;
            setBranchLoading(true); setBranchError('');
            return loadInventoryBranches(session, controller.signal);
        }).then(items => {
            if (items && !controller.signal.aborted) {
                setBranches(items);
                setBranchId(current => items.some(item => item.id === current) ? current : (items[0]?.id ?? ''));
            }
        }).catch(cause => { if (!controller.signal.aborted) setBranchError(errorText(cause)); })
            .finally(() => { if (!controller.signal.aborted) setBranchLoading(false); });
        return () => controller.abort();
    }, [session, branchReload]);

    useEffect(() => {
        const sequence = ++requestSequence.current;
        const controller = new AbortController();
        const requestKey = key;
        void Promise.resolve().then<InventoryResult | null>(() => {
            if (controller.signal.aborted) return null;
            setError('');
            if (!branchId) { setResult(null); setLoading(false); return null; }
            setLoading(true);
            return view === 'balances'
                ? loadInventoryBalances(session, branchId, page, controller.signal).then(balances => ({ key: requestKey, balances }))
                : loadInventoryMovements(session, branchId, page, ingredientFilter?.id, controller.signal).then(movements => ({ key: requestKey, movements }));
        }).then(next => {
            if (next && !controller.signal.aborted && sequence === requestSequence.current && requestKey === latestKey.current) setResult(next);
        }).catch(cause => { if (!controller.signal.aborted && sequence === requestSequence.current) { setResult(null); setError(errorText(cause)); } })
            .finally(() => { if (!controller.signal.aborted && sequence === requestSequence.current) setLoading(false); });
        return () => controller.abort();
    }, [session, branchId, view, ingredientFilter?.id, page, reload, key]);

    const current = result?.key === key ? result : null;
    const data = view === 'balances' ? current?.balances : current?.movements;
    const total = data?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
    function changeView(next: View) { setView(next); setPage(1); if (next === 'balances') setIngredientFilter(null); }
    function viewMovements(balance: Balance) {
        setIngredientFilter({ id: balance.ingredientId, label: `${balance.ingredient.code} · ${balance.ingredient.name}` });
        setView('movements'); setPage(1);
    }

    return <section className="w75-inventory">
        <header><div><p className="w75-inventory-eyebrow">QUẢN LÝ KHO</p><h2>Tồn kho và biến động</h2>
            <p>Số dư hiện tại và lịch sử hạch toán theo chi nhánh. Mỗi trang tải tối đa 50 bản ghi từ máy chủ.</p></div></header>
        <div className="w75-inventory-panel">
            {branches.length > 0 ? <label className="w75-inventory-branch">Chi nhánh
                <select value={branchId} disabled={branchLoading} onChange={event => { setBranchId(event.target.value); setPage(1); setIngredientFilter(null); }}>
                    <option value="">{branchLoading ? 'Đang tải chi nhánh…' : 'Chọn chi nhánh'}</option>
                    {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}{branch.isActive ? '' : ' (ngừng hoạt động)'}</option>)}
                </select></label>
                : <p className="w75-inventory-note">Không có quầy được phân công hôm nay, hoặc chưa tải được danh sách.</p>}
            {branchError && <p className="w75-inventory-error" role="alert">{branchError} <button type="button" onClick={() => setBranchReload(value => value + 1)}>Tải lại chi nhánh</button></p>}
            <div className="w75-inventory-toolbar">
                <div className="w75-inventory-tabs" role="group" aria-label="Loại dữ liệu kho">
                    <button type="button" aria-pressed={view === 'balances'} onClick={() => changeView('balances')}>Số dư tồn kho</button>
                    <button type="button" aria-pressed={view === 'movements'} onClick={() => changeView('movements')}>Lịch sử biến động</button>
                </div>
                <button type="button" disabled={!branchId || loading} onClick={() => setReload(value => value + 1)}>Tải lại</button>
            </div>
            {ingredientFilter && <p className="w75-inventory-note">Nguyên liệu: {ingredientFilter.label} <button type="button" onClick={() => { setIngredientFilter(null); setPage(1); }}>Xem mọi nguyên liệu</button></p>}
            {error && <p className="w75-inventory-error" role="alert">{error}</p>}
            {!branchId && <p className="w75-inventory-empty">Chọn một quầy được cấp quyền để xem tồn kho.</p>}
            {loading && <p role="status" className="w75-inventory-note">Đang tải {view === 'balances' ? 'số dư kho' : 'lịch sử biến động'}…</p>}
            {!loading && data && <>
                {view === 'balances' && <p className="w75-inventory-note">Ngưỡng tối thiểu và đơn vị lấy từ danh mục nguyên liệu hiện tại. Danh sách chỉ gồm nguyên liệu đã có bản ghi số dư; không suy diễn tồn bằng 0 cho bản ghi chưa tồn tại.</p>}
                {data.items.length === 0 ? <p className="w75-inventory-empty">Không có bản ghi trong trang này.</p> : <div className="w75-inventory-table-wrap">
                    {view === 'balances' ? <table><thead><tr><th>Mã / nguyên liệu</th><th>Đơn vị</th><th>Tồn hiện tại</th><th>Tồn tối thiểu</th><th>Cập nhật số dư</th><th>Trạng thái</th><th>Lịch sử</th></tr></thead>
                        <tbody>{current?.balances?.items.map(balance => <tr key={balance.ingredientId}>
                            <td><strong>{balance.ingredient.code}</strong><span>{balance.ingredient.name}</span></td><td>{balance.ingredient.unit}</td>
                            <td className="w75-inventory-number">{formatInventoryQuantity(balance.quantity)}</td><td className="w75-inventory-number">{formatInventoryQuantity(balance.ingredient.minStock)}</td>
                            <td>{dateText(balance.updatedAt)}</td><td>{!balance.ingredient.isActive && <span className="w75-inventory-tag">Ngừng hoạt động</span>}{belowMinimum(balance) ? <span className="w75-inventory-low">Dưới tối thiểu</span> : <span>Đủ ngưỡng</span>}</td>
                            <td><button type="button" onClick={() => viewMovements(balance)}>Xem biến động</button></td>
                        </tr>)}</tbody></table>
                        : <table><thead><tr><th>Thời điểm</th><th>Mã / nguyên liệu</th><th>Loại biến động</th><th>Thay đổi</th><th>Tồn sau</th><th>Chứng từ nguồn</th><th>Người thực hiện</th></tr></thead>
                            <tbody>{current?.movements?.items.map(movement => <tr key={movement.id}>
                                <td>{dateText(movement.createdAt)}</td><td><strong>{movement.ingredient.code}</strong><span>{movement.ingredient.name} · {movement.ingredient.unit}</span></td>
                                <td>{kindNames[movement.kind]}</td><td className="w75-inventory-number">{movement.delta.startsWith('-') ? '' : '+'}{formatInventoryQuantity(movement.delta)}</td>
                                <td className="w75-inventory-number">{formatInventoryQuantity(movement.quantityAfter)}</td><td className="w75-inventory-id">{movement.sourceId}</td><td className="w75-inventory-id">{movement.actorId}</td>
                            </tr>)}</tbody></table>}
                </div>}
                <div className="w75-inventory-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Trước</button>
                    <span>Trang {page}/{pageCount} · {total} bản ghi</span><button type="button" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>Sau</button></div>
            </>}
        </div>
    </section>;
}

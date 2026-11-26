import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { ApiError } from '../api';
import { kitchenApi, type KitchenBatch, type KitchenBalance, type KitchenIngredient, type KitchenMovement,
    type KitchenReceipt, type KitchenWarehouse, type KitchenWorker, type KitchenAssignment } from './kitchen.api';
import './KitchenPage.css';

type QuantityRow = { ingredientId: string; quantity: string };
type ReceiptRow = QuantityRow & { unitCost: string };
type Tab = 'stock' | 'receipts' | 'production' | 'workers';
const blankReceipt = (): ReceiptRow => ({ ingredientId: '', quantity: '', unitCost: '0' });
const blankQuantity = (): QuantityRow => ({ ingredientId: '', quantity: '' });

const dateText = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '—';
function displayDecimal(value: string | number): string {
    const [whole, fraction = ''] = String(value).split('.');
    const trimmed = fraction.replace(/0+$/, '');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (trimmed ? `,${trimmed}` : '');
}
function problem(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    return 'Không thể thực hiện yêu cầu. Hãy kiểm tra dữ liệu trên máy chủ.';
}

function IngredientLines<T extends QuantityRow>({ ingredients, rows, onChange, withCost, disabled }: {
    ingredients: KitchenIngredient[];
    rows: T[];
    onChange: (rows: T[]) => void;
    withCost?: boolean;
    disabled: boolean;
}) {
    function modify(index: number, property: 'ingredientId' | 'quantity' | 'unitCost', value: string) {
        const next = rows.map((item, i) => i === index ? { ...item, [property]: value } : item);
        onChange(next);
    }
    return <div className="wh-kitchen-lines">
        {rows.map((row, index) => <div className="wh-kitchen-line" key={index}>
            <label>Nguyên liệu / thành phẩm
                <select disabled={disabled} required value={row.ingredientId} onChange={e => modify(index, 'ingredientId', e.target.value)}>
                    <option value="">Chọn SKU</option>
                    {ingredients.map(ingredient => <option key={ingredient.id} value={ingredient.id}>
                        {ingredient.code} — {ingredient.name} ({ingredient.unit})
                    </option>)}
                </select>
            </label>
            <label>Số lượng
                <input disabled={disabled} required placeholder="VD: 1000" inputMode="decimal" value={row.quantity}
                    onChange={e => modify(index, 'quantity', e.target.value)} />
            </label>
            {withCost && <label>Đơn giá nhập (VND)
                <input disabled={disabled} required placeholder="0" inputMode="decimal" value={(row as ReceiptRow).unitCost}
                    onChange={e => modify(index, 'unitCost', e.target.value)} />
            </label>}
            <button type="button" className="wh-kitchen-subtle" disabled={disabled || rows.length === 1}
                onClick={() => onChange(rows.filter((_, i) => i !== index))} aria-label={`Xóa dòng ${index + 1}`}>Bỏ</button>
        </div>)}
        <button type="button" disabled={disabled || rows.length >= 50} className="wh-kitchen-subtle"
            onClick={() => onChange([...rows, (withCost ? blankReceipt() : blankQuantity()) as T])}>+ Thêm dòng</button>
    </div>;
}

export default function KitchenPage({ session }: { session: AuthSession }) {
    const isAdmin = session.user.role === 'ADMIN';
    const [warehouses, setWarehouses] = useState<KitchenWarehouse[]>([]);
    const [selected, setSelected] = useState('');
    const [ingredients, setIngredients] = useState<KitchenIngredient[]>([]);
    const [balances, setBalances] = useState<KitchenBalance[]>([]);
    const [movements, setMovements] = useState<KitchenMovement[]>([]);
    const [receipts, setReceipts] = useState<KitchenReceipt[]>([]);
    const [batches, setBatches] = useState<KitchenBatch[]>([]);
    const [workers, setWorkers] = useState<KitchenWorker[]>([]);
    const [assignments, setAssignments] = useState<KitchenAssignment[]>([]);
    const [workerId, setWorkerId] = useState('');
    const [tab, setTab] = useState<Tab>('stock');
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const detailRequest = useRef(0);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const [newCode, setNewCode] = useState('');
    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [receiptCode, setReceiptCode] = useState('');
    const [supplier, setSupplier] = useState('');
    const [receiptNote, setReceiptNote] = useState('');
    const [receiptRows, setReceiptRows] = useState<ReceiptRow[]>([blankReceipt()]);
    const [batchCode, setBatchCode] = useState('');
    const [batchNote, setBatchNote] = useState('');
    const [inputs, setInputs] = useState<QuantityRow[]>([blankQuantity()]);
    const [outputs, setOutputs] = useState<QuantityRow[]>([blankQuantity()]);

    const loadBasic = useCallback(async () => {
        const [warehousesResult, ingredientsResult] = await Promise.all([
            kitchenApi.warehouses(session), kitchenApi.ingredients(session),
        ]);
        setWarehouses(warehousesResult.items);
        setIngredients(ingredientsResult.items);
        setSelected(current => warehousesResult.items.some(item => item.id === current)
            ? current : (warehousesResult.items.find(item => item.isActive)?.id ?? ''));
        if (isAdmin) {
            const result = await kitchenApi.workers(session);
            setWorkers(result.items);
        }
    }, [session, isAdmin]);

    const loadDetails = useCallback(async (warehouseId: string) => {
        const requestId = ++detailRequest.current;
        if (!warehouseId) { setBalances([]); setMovements([]); setReceipts([]); setBatches([]); setAssignments([]); return; }
        const [balanceResponse, movementResponse, receiptResponse, batchResponse] = await Promise.all([
            kitchenApi.balances(session, warehouseId), kitchenApi.movements(session, warehouseId),
            kitchenApi.receipts(session, warehouseId), kitchenApi.batches(session, warehouseId),
        ]);
        const assignmentResponse = isAdmin ? await kitchenApi.assignments(session, warehouseId) : null;
        if (requestId !== detailRequest.current) return;
        setBalances(balanceResponse.items); setMovements(movementResponse.items);
        setReceipts(receiptResponse.items); setBatches(batchResponse.items);
        if (assignmentResponse) setAssignments(assignmentResponse.items);
    }, [session, isAdmin]);

    useEffect(() => { void loadBasic().catch(cause => setError(problem(cause))); }, [loadBasic]);
    useEffect(() => { void loadDetails(selected).catch(cause => setError(problem(cause)));
        return () => { detailRequest.current += 1; };
    }, [loadDetails, selected]);

    async function action(fn: () => Promise<void>) {
        if (pending.current || uncertain) return;
        pending.current = true; setBusy(true); setError(''); setNotice('');
        try { await fn(); }
        catch (cause) {
            setError(problem(cause));
            if (cause instanceof ApiError && cause.uncertain) {
                setUncertain(true);
                setNotice('Kết quả ghi chưa xác định. Chỉ mở lại thao tác sau khi đối chiếu mã chứng từ và trạng thái tại máy chủ.');
            }
        }
        finally { pending.current = false; setBusy(false); }
    }

    function refresh() {
        if (pending.current) return;
        setError(''); setNotice('');
        void Promise.all([loadBasic(), loadDetails(selected)]).then(() => {
            if (uncertain) setNotice('Đã tải trạng thái mới. Kiểm tra mã chứng từ, tồn kho và lịch sử trước khi mở lại thao tác.');
            else setNotice('Đã tải lại dữ liệu từ máy chủ.');
        }).catch(cause => setError(problem(cause)));
    }

    async function createWarehouse(e: FormEvent) {
        e.preventDefault();
        await action(async () => {
            const result = await kitchenApi.createWarehouse(session, { code: newCode, name: newName, address: newAddress });
            await loadBasic(); setSelected(result.data.id);
            setNewCode(''); setNewName(''); setNewAddress('');
            setNotice('Đã tạo kho trung tâm.');
        });
    }
    async function assignWorker(e: FormEvent) {
        e.preventDefault();
        await action(async () => {
            await kitchenApi.assignWorker(session, selected, workerId);
            await loadDetails(selected); setWorkerId(''); setNotice('Đã phân công nhân viên vào kho.');
        });
    }
    async function createReceipt(e: FormEvent) {
        e.preventDefault();
        await action(async () => {
            await kitchenApi.createReceipt(session, selected,
                { code: receiptCode, supplierName: supplier, note: receiptNote, items: receiptRows });
            await loadDetails(selected); setReceiptCode(''); setSupplier(''); setReceiptNote(''); setReceiptRows([blankReceipt()]);
            setNotice('Đã lưu phiếu nhập DRAFT. Cần bấm Ghi sổ để cập nhật tồn kho trung tâm.');
        });
    }
    async function createBatch(e: FormEvent) {
        e.preventDefault();
        await action(async () => {
            await kitchenApi.createBatch(session, selected, { code: batchCode, note: batchNote, inputs, outputs });
            await loadDetails(selected); setBatchCode(''); setBatchNote(''); setInputs([blankQuantity()]); setOutputs([blankQuantity()]);
            setNotice('Đã lưu mẻ pha chế DRAFT. Tồn kho chưa thay đổi.');
        });
    }
    async function postReceipt(id: string, code: string) {
        if (!window.confirm(`Ghi sổ phiếu nhập ${code}? Thao tác này tăng tồn kho và không thể tự hủy.`)) return;
        await action(async () => {
            await kitchenApi.postReceipt(session, id);
            await loadDetails(selected);
            setNotice(`Đã ghi sổ phiếu nhập ${code}.`);
        });
    }
    async function postBatch(id: string, code: string) {
        if (!window.confirm(`Ghi sổ mẻ ${code}? Nguyên liệu đầu vào sẽ bị trừ và thành phẩm tăng. Không thể tự hủy.`)) return;
        await action(async () => {
            await kitchenApi.postBatch(session, id);
            await loadDetails(selected);
            setNotice(`Đã ghi sổ mẻ ${code}.`);
        });
    }
    const locked = busy || uncertain;
    const nameOf = (id: string) => {
        const ingredient = ingredients.find(item => item.id === id);
        return ingredient ? `${ingredient.name} (${ingredient.unit})` : id;
    };

    return <div className="wh-kitchen">
        <div className="wh-heading"><div><p className="wh-eyebrow">G3 / KHO BẾP TRUNG TÂM</p>
            <h2>Kho bếp và pha chế theo mẻ</h2></div>
            <button type="button" className="wh-kitchen-subtle" onClick={refresh} disabled={busy}>Tải lại dữ liệu</button>
        </div>
        <p className="wh-intro">Kho trung tâm quản lý tồn riêng, không phải quầy bán. Phiếu nhập và mẻ pha chế chỉ làm thay đổi tồn khi được ghi sổ.</p>
        {error && <p className="wh-kitchen-alert" role="alert">{error}</p>}
        {notice && <p className="wh-kitchen-notice" role="status">{notice}</p>}
        {uncertain && <div className="wh-kitchen-card"><strong>Cần đối chiếu trước khi thực hiện tiếp</strong>
            <p>Kiểm tra trên máy chủ xem chứng từ đã được tạo/ghi sổ chưa. Không gửi lại một thao tác không chắc chắn.</p>
            <button type="button" className="wh-kitchen-subtle" disabled={busy}
                onClick={() => { if (window.confirm('Tôi đã đối chiếu dữ liệu mới nhất và hiểu nguy cơ gửi trùng thao tác.')) { setUncertain(false); setNotice('Đã xác nhận đối chiếu.'); } }}>
                Đã đối chiếu — mở lại thao tác</button></div>}
        <div className="wh-kitchen-card wh-kitchen-toolbar">
            <label>Kho được phân quyền
                <select value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
                    <option value="">Chọn kho</option>
                    {warehouses.filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                </select>
            </label>
            {selected && <span className="wh-kitchen-hint">{warehouses.find(item => item.id === selected)?.address || 'Chưa có địa chỉ kho'}</span>}
        </div>
        {isAdmin && <details className="wh-kitchen-card">
            <summary>Tạo kho trung tâm mới (ADMIN)</summary>
            <form className="wh-kitchen-form" onSubmit={e => { void createWarehouse(e); }}>
                <label>Mã kho<input required value={newCode} disabled={locked} onChange={e => setNewCode(e.target.value)} placeholder="KHO-TONG-01" /></label>
                <label>Tên kho<input required value={newName} disabled={locked} onChange={e => setNewName(e.target.value)} placeholder="Kho bếp trung tâm" /></label>
                <label>Địa chỉ<input value={newAddress} disabled={locked} onChange={e => setNewAddress(e.target.value)} placeholder="Địa chỉ kho (tùy chọn)" /></label>
                <button className="wh-primary" type="submit" disabled={locked}>Tạo kho</button>
            </form>
        </details>}
        {!selected ? <div className="wh-kitchen-card">Chưa có kho được phân quyền. ADMIN tạo kho và phân công nhân viên kho/giao hàng trước khi sử dụng.</div> : <>
            <div className="wh-kitchen-tabs" role="group" aria-label="Chức năng kho bếp">
                {([['stock','Tồn kho & lịch sử'], ['receipts','Nhập kho'], ['production','Pha chế theo mẻ'], ...(isAdmin ? [['workers','Nhân viên kho']] : [])] as [Tab,string][])
                    .map(([value,label]) => <button key={value} className={tab === value ? 'is-active' : ''} type="button" onClick={() => setTab(value)}>{label}</button>)}
            </div>
            {tab === 'stock' && <>
                <section className="wh-kitchen-card"><h3>Tồn kho bếp hiện tại</h3>
                    <div className="wh-kitchen-table"><table><thead><tr><th>SKU</th><th>Nguyên liệu / thành phẩm</th><th>Đơn vị</th><th>Số dư</th></tr></thead>
                        <tbody>{balances.map(row => <tr key={row.ingredientId}><td>{row.ingredient.code}</td><td>{row.ingredient.name}</td>
                            <td>{row.ingredient.unit}</td><td>{displayDecimal(row.quantity)}</td></tr>)}</tbody></table>
                    </div>{balances.length === 0 && <p className="wh-kitchen-hint">Chưa có tồn kho. Lập phiếu nhập và ghi sổ để bắt đầu.</p>}
                </section>
                <section className="wh-kitchen-card"><h3>100 biến động gần nhất</h3>
                    <div className="wh-kitchen-table"><table><thead><tr><th>Thời điểm</th><th>Nghiệp vụ</th><th>Nguyên liệu</th><th>Chênh lệch</th><th>Tồn sau</th></tr></thead>
                        <tbody>{movements.map(row => <tr key={row.id}><td>{dateText(row.createdAt)}</td><td>{row.kind}</td>
                            <td>{row.ingredient.name}</td><td>{displayDecimal(row.delta)} {row.ingredient.unit}</td>
                            <td>{displayDecimal(row.quantityAfter)}</td></tr>)}</tbody></table></div>
                </section>
            </>}
            {tab === 'receipts' && <>
                <section className="wh-kitchen-card"><h3>Tạo phiếu nhập kho bếp</h3>
                    <form className="wh-kitchen-form" onSubmit={e => { void createReceipt(e); }}>
                        <div className="wh-kitchen-grid"><label>Mã phiếu<input disabled={locked} value={receiptCode} onChange={e => setReceiptCode(e.target.value)} required placeholder="KN-20261126-001" /></label>
                            <label>Nhà cung cấp<input disabled={locked} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Tùy chọn" /></label></div>
                        <label>Ghi chú<input disabled={locked} value={receiptNote} onChange={e => setReceiptNote(e.target.value)} /></label>
                        <IngredientLines ingredients={ingredients} rows={receiptRows} onChange={setReceiptRows} withCost disabled={locked} />
                        <button className="wh-primary" type="submit" disabled={locked}>Lưu phiếu nhập DRAFT</button>
                    </form>
                </section>
                <section className="wh-kitchen-card"><h3>Phiếu nhập gần đây</h3>
                    {receipts.map(row => <article className="wh-kitchen-record" key={row.id}>
                        <div><strong>{row.code}</strong> · <span>{row.status}</span> · {dateText(row.createdAt)}
                            <p>{row.supplierName || 'Không ghi nhà cung cấp'}</p>
                            <ul>{row.items.map(item => <li key={item.id}>{nameOf(item.ingredientId)}: {displayDecimal(item.quantity)} · {displayDecimal(item.unitCost)} VND/đơn vị</li>)}</ul>
                        </div>
                        {row.status === 'DRAFT' && <button className="wh-primary" disabled={locked} type="button" onClick={() => { void postReceipt(row.id, row.code); }}>Ghi sổ nhập</button>}
                    </article>)}
                    {receipts.length === 0 && <p className="wh-kitchen-hint">Chưa có phiếu nhập.</p>}
                </section>
            </>}
            {tab === 'production' && <>
                <section className="wh-kitchen-card"><h3>Ghi nhận mẻ pha chế</h3>
                    <p className="wh-kitchen-hint">Chọn SKU đầu vào và SKU thành phẩm khác nhau. Sản lượng đầu ra phải là lượng thực tế; chưa có công thức/BOM tự động ở G3.</p>
                    <form className="wh-kitchen-form" onSubmit={e => { void createBatch(e); }}>
                        <label>Mã mẻ<input disabled={locked} value={batchCode} onChange={e => setBatchCode(e.target.value)} required placeholder="ME-20261126-001" /></label>
                        <label>Ghi chú<input disabled={locked} value={batchNote} onChange={e => setBatchNote(e.target.value)} placeholder="Loại sản phẩm, thời gian, tình trạng thực tế" /></label>
                        <h4>Nguyên liệu đầu vào — trừ tồn</h4>
                        <IngredientLines ingredients={ingredients} rows={inputs} onChange={setInputs} disabled={locked} />
                        <h4>Thành phẩm thực tế — tăng tồn</h4>
                        <IngredientLines ingredients={ingredients} rows={outputs} onChange={setOutputs} disabled={locked} />
                        <button className="wh-primary" type="submit" disabled={locked}>Lưu mẻ DRAFT</button>
                    </form>
                </section>
                <section className="wh-kitchen-card"><h3>Các mẻ pha chế gần đây</h3>
                    {batches.map(batch => <article className="wh-kitchen-record" key={batch.id}>
                        <div><strong>{batch.code}</strong> · {batch.status} · {dateText(batch.createdAt)}
                            <p>{batch.note || 'Không có ghi chú'}</p>
                            <small>Đầu vào: {batch.inputs.map(row => `${nameOf(row.ingredientId)} ${displayDecimal(row.quantity)}`).join(' • ')}</small>
                            <small>Đầu ra: {batch.outputs.map(row => `${nameOf(row.ingredientId)} ${displayDecimal(row.quantity)}`).join(' • ')}</small>
                        </div>
                        {batch.status === 'DRAFT' && <button className="wh-primary" disabled={locked} type="button" onClick={() => { void postBatch(batch.id, batch.code); }}>Ghi sổ mẻ</button>}
                    </article>)}
                    {batches.length === 0 && <p className="wh-kitchen-hint">Chưa có mẻ pha chế.</p>}
                </section>
            </>}
            {tab === 'workers' && isAdmin && <section className="wh-kitchen-card"><h3>Phân công nhân viên kho/giao hàng</h3>
                <p className="wh-kitchen-hint">Chỉ nhân viên STAFF có nhóm công việc KITCHEN_DELIVERY mới được gán kho. Nhân viên bán hàng không có quyền ghi sổ kho trung tâm.</p>
                <form className="wh-kitchen-form" onSubmit={e => { void assignWorker(e); }}>
                    <label>Chọn nhân viên<select required value={workerId} onChange={e => setWorkerId(e.target.value)} disabled={locked}>
                        <option value="">Chọn nhân viên kho</option>
                        {workers.map(row => <option key={row.id} value={row.id}>{row.displayName} ({row.email})</option>)}
                    </select></label>
                    <button type="submit" className="wh-primary" disabled={locked}>Phân công vào kho</button>
                </form>
                <ul>{assignments.map(row => <li key={row.userId}>{row.user.displayName} — {row.isActive ? 'Đang phân công' : 'Đã ngừng phân công'}</li>)}</ul>
            </section>}
        </>}
    </div>;
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { kitchenApi, type KitchenWarehouse, type KitchenIngredient, type KitchenWorker } from '../kitchen/kitchen.api';
import { distributionApi, type DeliveryTrip, type DistributionBranch } from './distribution.api';
import './DistributionPage.css';

type Entry = { ingredientId: string; quantity: string };
type StopDraft = { branchId: string; items: Entry[] };
type Actual = { receivedQuantity: string; damagedQuantity: string };
const initialStop = (): StopDraft => ({ branchId: '', items: [{ ingredientId: '', quantity: '1' }] });
const dateToday = () => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const find = (kind: string) => parts.find(part => part.type === kind)?.value ?? '';
    return `${find('year')}-${find('month')}-${find('day')}`;
};
const quantityPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const formatQuantity = (value: string) => value;
const statusText: Record<string, string> = {
    DRAFT: 'Đang lập', IN_TRANSIT: 'Đang giao', COMPLETE: 'Hoàn tất',
    PLANNED: 'Chưa xuất kho', DISPATCHED: 'Chưa xác nhận', RECEIVED: 'Đã nhận',
};
export default function DistributionPage({ session }: { session: AuthSession }) {
    const canPrepare = session.user.role === 'ADMIN' || session.user.workKind === 'KITCHEN_DELIVERY';
    const [day, setDay] = useState(dateToday);
    const [branches, setBranches] = useState<DistributionBranch[]>([]);
    const [warehouses, setWarehouses] = useState<KitchenWarehouse[]>([]);
    const [ingredients, setIngredients] = useState<KitchenIngredient[]>([]);
    const [couriers, setCouriers] = useState<KitchenWorker[]>([]);
    const [trips, setTrips] = useState<DeliveryTrip[]>([]);
    const [warehouseId, setWarehouseId] = useState('');
    const [courierId, setCourierId] = useState('');
    const [code, setCode] = useState('');
    const [memo, setMemo] = useState('');
    const [stops, setStops] = useState<StopDraft[]>([initialStop()]);
    const [actuals, setActuals] = useState<Record<string, Record<string, Actual>>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const requestLock = useRef(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [available, list] = await Promise.all([
                distributionApi.branches(session, day), distributionApi.trips(session, day),
            ]);
            setBranches(available.items);
            setTrips(list.items);
            setError('');
            setUncertain(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Không thể tải các chuyến giao.');
        } finally { setLoading(false); }
    }, [session, day]);
    useEffect(() => { void refresh(); }, [refresh]);

    useEffect(() => {
        if (!canPrepare) return;
        let mounted = true;
        void Promise.all([kitchenApi.warehouses(session), kitchenApi.ingredients(session)])
            .then(([w, i]) => { if (mounted) { setWarehouses(w.items); setIngredients(i.items); setWarehouseId(old => old || w.items[0]?.id || ''); } })
            .catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : 'Không tải được danh mục kho.'); });
        return () => { mounted = false; };
    }, [session, canPrepare]);
    useEffect(() => {
        if (!warehouseId || session.user.role !== 'ADMIN') return;
        let mounted = true;
        void kitchenApi.assignments(session, warehouseId).then(result => {
            if (mounted) setCouriers(result.items.filter(x => x.isActive).map(x => ({
                id: x.userId, displayName: x.user.displayName, email: x.user.email,
            })));
        }).catch(() => { if (mounted) setCouriers([]); });
        return () => { mounted = false; };
    }, [warehouseId, session]);

    const warehouseReady = useMemo(() => warehouses.some(w => w.id === warehouseId && w.isActive), [warehouses, warehouseId]);
    const deliveryDay = (trip: DeliveryTrip) => trip.businessDate.slice(0, 10);
    const updateStop = (index: number, fn: (row: StopDraft) => StopDraft) => setStops(old => old.map((row, i) => i === index ? fn(row) : row));
    const addItem = (index: number) => updateStop(index, row => ({ ...row, items: [...row.items, { ingredientId: '', quantity: '1' }] }));
    const updateItem = (index: number, itemIndex: number, patch: Partial<Entry>) => updateStop(index, row => ({
        ...row, items: row.items.map((item, i) => i === itemIndex ? { ...item, ...patch } : item),
    }));

    async function run(action: () => Promise<unknown>, success: string) {
        if (requestLock.current || uncertain) return;
        requestLock.current = true;
        setBusy(true); setError(''); setMessage('');
        try {
            await action();
            setMessage(success);
            await refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Có lỗi khi gửi yêu cầu.');
            // A lost response can occur AFTER the server commits; no automatic mutation retry.
            setUncertain(true);
        } finally { requestLock.current = false; setBusy(false); }
    }

    function createTrip(event: FormEvent) {
        event.preventDefault();
        if (!canPrepare || !warehouseReady || (session.user.role === 'ADMIN' && !courierId)) { setError('Hãy chọn kho và nhân viên giao hàng được phân công.'); return; }
        const valid = code.trim().length >= 2 && stops.length > 0 && stops.every(stop =>
            stop.branchId && stop.items.length > 0 && stop.items.every(item =>
                item.ingredientId && quantityPattern.test(item.quantity) && Number(item.quantity) > 0));
        if (!valid || new Set(stops.map(stop => stop.branchId)).size !== stops.length ||
            stops.some(stop => new Set(stop.items.map(x => x.ingredientId)).size !== stop.items.length)) {
            setError('Vui lòng nhập mã chuyến, quầy, SKU và số lượng hợp lệ; không trùng quầy/SKU.'); return;
        }
        const currentCode = code.trim().toUpperCase();
        if (trips.some(t => t.code === currentCode)) { setError('Mã chuyến đã tồn tại trong danh sách.'); return; }
        void run(() => distributionApi.create(session, {
            code: currentCode, warehouseId, businessDate: day,
            courierId: session.user.role === 'ADMIN' ? (courierId || null) : session.user.id,
            note: memo, stops,
        }), 'Đã lưu chuyến giao. Kiểm tra hàng tại kho trước khi xuất chuyến.');
    }

    const editActual = (stopId: string, ingredientId: string, key: keyof Actual, value: string, planned: string) => {
        setActuals(old => ({ ...old, [stopId]: {
            ...old[stopId], [ingredientId]: { receivedQuantity: old[stopId]?.[ingredientId]?.receivedQuantity ?? planned,
                damagedQuantity: old[stopId]?.[ingredientId]?.damagedQuantity ?? '0', [key]: value },
        } }));
    };
    const stopActual = (stopId: string, ingredientId: string, planned: string): Actual =>
        actuals[stopId]?.[ingredientId] ?? { receivedQuantity: planned, damagedQuantity: '0' };
    const receive = (stop: DeliveryTrip['stops'][number]) => {
        const items = stop.items.map(item => ({ ingredientId: item.ingredientId,
            ...stopActual(stop.id, item.ingredientId, item.plannedQuantity) }));
        const valid = items.every(item => quantityPattern.test(item.receivedQuantity) &&
            quantityPattern.test(item.damagedQuantity));
        if (!valid) { setError('Số lượng nhận/hỏng không hợp lệ.'); return; }
        void run(() => distributionApi.receive(session, stop.id, { items, note: notes[stop.id] ?? '' }),
            'Đã xác nhận điểm giao. Chỉ số lượng thực nhận được cộng vào tồn quầy.');
    };
    const canDispatch = (trip: DeliveryTrip) => session.user.role === 'ADMIN' ||
        (session.user.workKind === 'KITCHEN_DELIVERY' && trip.courierId === session.user.id);
    const canReceive = session.user.workKind !== 'KITCHEN_DELIVERY' &&
        (session.user.role === 'ADMIN' || session.user.role === 'BRANCH_MANAGER' || session.user.workKind === 'SALES');

    return <section className="wh-distribution">
        <div className="wh-heading"><div><p className="wh-eyebrow">KHO BẾP / ĐIỀU PHỐI SÁNG</p><h2>Chuyến giao nhiều quầy</h2></div>
            <button type="button" disabled={busy || loading} onClick={() => { void refresh(); }}>Tải lại từ máy chủ</button></div>
        <p className="wh-intro">Lập chuyến, xuất hàng từ kho trung tâm và xác nhận thực nhận tại từng quầy. Hàng đang vận chuyển chưa được cộng tồn quầy.</p>
        <label className="wh-dist-date">Ngày giao <input type="date" value={day} disabled={busy} onChange={e => { setDay(e.target.value); setActuals({}); setNotes({}); }} /></label>
        {error && <p role="alert" className="wh-error">{error}</p>}
        {message && <p role="status" className="wh-dist-success">{message}</p>}
        {uncertain && <p className="wh-note">Nếu máy chủ không trả lời, hãy tải lại danh sách và đối chiếu mã chuyến/trạng thái trước khi gửi yêu cầu mới.
            <button type="button" disabled={loading || busy} onClick={() => { void refresh(); }}>Đối chiếu</button></p>}
        {canPrepare && <form className="wh-dist-panel" onSubmit={createTrip}>
            <h3>Tạo chuyến giao</h3>
            <div className="wh-dist-fields">
                <label>Kho xuất<select required value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                    <option value="">Chọn kho</option>{warehouses.filter(w => w.isActive).map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select></label>
                <label>Mã chuyến<input required maxLength={40} placeholder="GIAO-20261126-01" value={code} onChange={e => setCode(e.target.value)} /></label>
                {session.user.role === 'ADMIN' && <label>Người giao<select required value={courierId} onChange={e => setCourierId(e.target.value)}>
                    <option value="">Chọn người giao</option>
                    {couriers.map(c => <option value={c.id} key={c.id}>{c.displayName}</option>)}
                </select></label>}
            </div>
            <label>Ghi chú chuyến<input maxLength={500} value={memo} onChange={e => setMemo(e.target.value)} placeholder="Chuyến giao sáng" /></label>
            {stops.map((stop, index) => <div className="wh-dist-stop-draft" key={index}>
                <div className="wh-dist-inline"><strong>Điểm giao {index + 1}</strong>
                    <button type="button" disabled={stops.length === 1} onClick={() => setStops(old => old.filter((_, i) => i !== index))}>Bỏ điểm</button></div>
                <label>Quầy<select required value={stop.branchId} onChange={e => updateStop(index, row => ({ ...row, branchId: e.target.value }))}>
                    <option value="">Chọn quầy</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
                </select></label>
                {stop.items.map((item, itemIndex) => <div className="wh-dist-item-row" key={itemIndex}>
                    <label>Nguyên liệu/thành phẩm<select required value={item.ingredientId} onChange={e => updateItem(index, itemIndex, { ingredientId: e.target.value })}>
                        <option value="">Chọn SKU</option>{ingredients.map(i => <option value={i.id} key={i.id}>{i.code} — {i.name} ({i.unit})</option>)}
                    </select></label>
                    <label>Số lượng<input required value={item.quantity} onChange={e => updateItem(index, itemIndex, { quantity: e.target.value })} /></label>
                    <button type="button" disabled={stop.items.length === 1} onClick={() => updateStop(index, row => ({ ...row, items: row.items.filter((_, j) => j !== itemIndex) }))}>Xóa SKU</button>
                </div>)}
                <button type="button" onClick={() => addItem(index)}>+ Thêm SKU</button>
            </div>)}
            <div className="wh-dist-actions"><button type="button" disabled={stops.length >= 25} onClick={() => setStops(old => [...old, initialStop()])}>+ Thêm quầy</button>
                <button type="submit" className="wh-primary" disabled={busy || uncertain || !warehouseReady}>Lưu chuyến nháp</button></div>
        </form>}
        <section className="wh-dist-panel">
            <h3>Danh sách chuyến giao {day}</h3>
            {loading && <p>Đang tải chuyến giao…</p>}
            {!loading && trips.length === 0 && <p className="wh-muted">Không có chuyến giao nào trong phạm vi tài khoản ở ngày này.</p>}
            {trips.map(trip => <article className="wh-dist-trip" key={trip.id}>
                <div className="wh-dist-inline"><div><strong>{trip.code}</strong> — {trip.warehouse.name} · {deliveryDay(trip)}
                    <p className="wh-muted">{statusText[trip.status]} · {trip.receivedStops} điểm đã nhận · Người giao: {trip.courier?.displayName ?? 'Chưa phân công'}</p></div>
                    {trip.status === 'DRAFT' && canDispatch(trip) && <button type="button" className="wh-primary"
                        disabled={busy || uncertain} onClick={() => {
                            if (window.confirm(`Xác nhận xuất chuyến ${trip.code}? Tồn kho trung tâm sẽ bị trừ ngay.`))
                                void run(() => distributionApi.dispatch(session, trip.id), 'Đã xuất chuyến và ghi nhận hàng đang vận chuyển.');
                        }}>Xuất chuyến</button>}
                </div>
                {trip.stops.map(stop => <div key={stop.id} className="wh-dist-receive">
                    <div className="wh-dist-inline"><strong>#{stop.stopOrder} — {stop.branch.code}: {stop.branch.name}</strong>
                        <span>{statusText[stop.status]}</span></div>
                    <table><thead><tr><th>SKU</th><th>Đã soạn</th><th>Thực nhận</th><th>Hỏng</th></tr></thead><tbody>
                        {stop.items.map(item => {
                            const actual = stopActual(stop.id, item.ingredientId, item.plannedQuantity);
                            const editable = canReceive && stop.status === 'DISPATCHED' && !busy && !uncertain;
                            return <tr key={item.ingredientId}><td>{item.ingredient.code} — {item.ingredient.name}</td>
                                <td>{formatQuantity(item.plannedQuantity)} {item.ingredient.unit}</td>
                                <td>{editable ? <input aria-label={`Thực nhận ${item.ingredient.code}`} value={actual.receivedQuantity}
                                    onChange={e => editActual(stop.id, item.ingredientId, 'receivedQuantity', e.target.value, item.plannedQuantity)} /> : (item.receivedQuantity ?? '—')}</td>
                                <td>{editable ? <input aria-label={`Hỏng ${item.ingredient.code}`} value={actual.damagedQuantity}
                                    onChange={e => editActual(stop.id, item.ingredientId, 'damagedQuantity', e.target.value, item.plannedQuantity)} /> : (item.damagedQuantity ?? '—')}</td>
                            </tr>;
                        })}
                    </tbody></table>
                    {canReceive && stop.status === 'DISPATCHED' && <div className="wh-dist-actions">
                        <input aria-label="Ghi chú chênh lệch" maxLength={500} placeholder="Giải trình nếu thiếu/hỏng…"
                            value={notes[stop.id] ?? ''} onChange={e => setNotes(old => ({ ...old, [stop.id]: e.target.value }))} />
                        <button type="button" disabled={busy || uncertain} onClick={() => {
                            if (window.confirm(`Xác nhận số thực nhận tại ${stop.branch.name}? Không thể sửa sau khi ghi nhận.`)) receive(stop);
                        }}>Xác nhận nhận hàng</button></div>}
                    {stop.note && <p className="wh-muted">Ghi chú nhận hàng: {stop.note}</p>}
                </div>)}
            </article>)}
        </section>
    </section>;
}

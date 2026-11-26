import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import { distributionApi, type DeliveryTrip } from './distribution.api';
import './DistributionPage.css';

type Actual = { receivedQuantity: string; damagedQuantity: string };
const todayVN = () => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};
const qty = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const statusText: Record<string, string> = {
    DRAFT: 'Đang lập', IN_TRANSIT: 'Đang giao', COMPLETE: 'Hoàn tất',
    PLANNED: 'Chưa xuất kho', DISPATCHED: 'Chưa xác nhận', RECEIVED: 'Đã nhận',
};

/** G10: view/dispatch/receive only. G6 approval page is the sole trip-creation UI. */
export default function DistributionPage({ session, onOpenPlanning }: {
    session: AuthSession; onOpenPlanning: () => void;
}) {
    const [day, setDay] = useState(todayVN);
    const [trips, setTrips] = useState<DeliveryTrip[]>([]);
    const [actuals, setActuals] = useState<Record<string, Record<string, Actual>>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const lock = useRef(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const result = await distributionApi.trips(session, day);
            setTrips(result.items); setError('');
            setUncertain(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Không thể tải chuyến giao.');
            throw cause;
        } finally { setLoading(false); }
    }, [session, day]);
    useEffect(() => { void Promise.resolve().then(() => refresh()).catch(() => undefined); }, [refresh]);

    async function run(action: () => Promise<unknown>, success: string) {
        if (lock.current || uncertain) return;
        lock.current = true; setBusy(true); setError(''); setMessage('');
        try {
            await action();
            setMessage(success);
            await refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Không thể hoàn tất yêu cầu.');
            // The mutation might have committed before the response was lost.
            setUncertain(true);
        } finally { lock.current = false; setBusy(false); }
    }

    function editActual(stopId: string, ingredientId: string, key: keyof Actual, value: string, planned: string) {
        setActuals(old => ({ ...old, [stopId]: {
            ...old[stopId], [ingredientId]: {
                receivedQuantity: old[stopId]?.[ingredientId]?.receivedQuantity ?? planned,
                damagedQuantity: old[stopId]?.[ingredientId]?.damagedQuantity ?? '0',
                [key]: value,
            },
        } }));
    }
    const stopActual = (stopId: string, ingredientId: string, planned: string): Actual =>
        actuals[stopId]?.[ingredientId] ?? { receivedQuantity: planned, damagedQuantity: '0' };

    function receive(stop: DeliveryTrip['stops'][number]) {
        const items = stop.items.map(item => ({ ingredientId: item.ingredientId,
            ...stopActual(stop.id, item.ingredientId, item.plannedQuantity) }));
        if (!items.every(item => qty.test(item.receivedQuantity) && qty.test(item.damagedQuantity))) {
            setError('Số lượng thực nhận/hỏng không hợp lệ.'); return;
        }
        void run(() => distributionApi.receive(session, stop.id, { items, note: notes[stop.id] ?? '' }),
            'Đã xác nhận điểm giao. Chỉ lượng thực nhận được cộng vào tồn quầy.');
    }
    const canDispatch = (trip: DeliveryTrip) => session.user.role === 'ADMIN' ||
        (session.user.workKind === 'KITCHEN_DELIVERY' && trip.courierId === session.user.id);
    const canReceive = session.user.workKind !== 'KITCHEN_DELIVERY' &&
        (session.user.role === 'ADMIN' || session.user.role === 'BRANCH_MANAGER' || session.user.workKind === 'SALES');
    const canPlan = session.user.role === 'ADMIN' || session.user.role === 'BRANCH_MANAGER';

    return <section className="wh-distribution">
        <div className="wh-heading"><div><p className="wh-eyebrow">KHO BẾP / ĐIỀU PHỐI SÁNG</p><h2>Chuyến giao nhiều quầy</h2></div>
            <button type="button" disabled={busy || loading} onClick={() => { void refresh().catch(() => undefined); }}>Tải lại từ máy chủ</button></div>
        <p className="wh-intro">Chuyến nháp chỉ được tạo từ kế hoạch G6 đã phê duyệt. Kho xuất hàng; quầy xác nhận số thực nhận. Hàng đang vận chuyển chưa được cộng vào tồn quầy.</p>
        {canPlan && <div className="wh-dist-panel">
            <strong>Quy trình bắt buộc: đề xuất → ADMIN khác người lập duyệt → chuyển chuyến nháp.</strong>
            <div className="wh-dist-actions"><button type="button" onClick={onOpenPlanning}>Mở Kế hoạch & duyệt G6</button></div>
        </div>}
        <label className="wh-dist-date">Ngày giao <input type="date" value={day} disabled={busy}
            onChange={event => { setDay(event.target.value); setActuals({}); setNotes({}); }} /></label>
        {error && <p className="wh-error" role="alert">{error}</p>}
        {message && <p role="status" className="wh-dist-success">{message}</p>}
        {uncertain && <p className="wh-note" role="alert">Có thể yêu cầu đã được ghi nhận dù mất phản hồi. Hãy đối chiếu trước khi thao tác tiếp.
            <button type="button" disabled={loading || busy} onClick={() => { void refresh().catch(() => undefined); }}>Đối chiếu</button></p>}
        <section className="wh-dist-panel">
            <h3>Danh sách chuyến giao {day}</h3>
            {loading && <p>Đang tải chuyến giao…</p>}
            {!loading && trips.length === 0 && <p className="wh-muted">Không có chuyến giao trong phạm vi tài khoản ở ngày này.</p>}
            {trips.map(trip => <article className="wh-dist-trip" key={trip.id}>
                <div className="wh-dist-inline"><div><strong>{trip.code}</strong> — {trip.warehouse.name} · {trip.businessDate.slice(0, 10)}
                    <p className="wh-muted">{statusText[trip.status]} · {trip.receivedStops} điểm đã nhận · Người giao: {trip.courier?.displayName ?? 'Chưa phân công'}</p></div>
                    {trip.status === 'DRAFT' && canDispatch(trip) && <button type="button" className="wh-primary"
                        disabled={busy || uncertain} onClick={() => {
                            if (window.confirm(`Xuất chuyến ${trip.code}? Hệ thống kiểm tra G6 đã duyệt và trừ tồn kho.`))
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
                                <td>{item.plannedQuantity} {item.ingredient.unit}</td>
                                <td>{editable ? <input aria-label={`Thực nhận ${item.ingredient.code}`} value={actual.receivedQuantity}
                                    onChange={event => editActual(stop.id, item.ingredientId, 'receivedQuantity', event.target.value, item.plannedQuantity)} /> : (item.receivedQuantity ?? '—')}</td>
                                <td>{editable ? <input aria-label={`Hỏng ${item.ingredient.code}`} value={actual.damagedQuantity}
                                    onChange={event => editActual(stop.id, item.ingredientId, 'damagedQuantity', event.target.value, item.plannedQuantity)} /> : (item.damagedQuantity ?? '—')}</td>
                            </tr>;
                        })}
                    </tbody></table>
                    {canReceive && stop.status === 'DISPATCHED' && <div className="wh-dist-actions">
                        <input aria-label="Ghi chú chênh lệch" maxLength={500} placeholder="Giải trình nếu thiếu/hỏng…"
                            value={notes[stop.id] ?? ''} onChange={event => setNotes(old => ({ ...old, [stop.id]: event.target.value }))} />
                        <button type="button" disabled={busy || uncertain} onClick={() => {
                            if (window.confirm(`Xác nhận thực nhận tại ${stop.branch.name}? Không thể sửa sau khi ghi.`)) receive(stop);
                        }}>Xác nhận nhận hàng</button></div>}
                    {stop.note && <p className="wh-muted">Ghi chú nhận hàng: {stop.note}</p>}
                </div>)}
            </article>)}
        </section>
    </section>;
}

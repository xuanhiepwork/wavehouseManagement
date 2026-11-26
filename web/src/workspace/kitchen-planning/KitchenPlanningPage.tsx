import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { kitchenApi, type KitchenAssignment } from '../kitchen/kitchen.api';
import { distributionApi } from '../distribution/distribution.api';
import { kitchenPlanningApi, type KitchenPlan, type KitchenAiOverlay, type OpsSummary,
    type PlanningWarehouse, type PlanningBranch } from './kitchen-planning.api';
import './KitchenPlanningPage.css';

const todayVN = () => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};
const codeValid = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const nonZero = (qty: string) => /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(qty) && Number(qty) > 0;
const explainMethod: Record<string, string> = {
    MATCHED_DAY_AND_SHIFT: 'Cùng loại ngày, cùng ca', SAME_SHIFT_HEURISTIC: 'Cùng ca, dữ liệu ngày chưa đủ',
    MIN_STOCK_ONLY: 'Chỉ dựa trên tồn tối thiểu',
};
type Preview = { warehouseId: string; branchIds: string[]; day: string; plan: KitchenPlan; ai: KitchenAiOverlay | null };
export default function KitchenPlanningPage({ session, onOpenDistribution }: {
    session: AuthSession; onOpenDistribution: () => void;
}) {
    const admin = session.user.role === 'ADMIN';
    const [day, setDay] = useState(todayVN);
    const [warehouseId, setWarehouseId] = useState('');
    const [warehouses, setWarehouses] = useState<PlanningWarehouse[]>([]);
    const [branches, setBranches] = useState<PlanningBranch[]>([]);
    const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
    const [withAi, setWithAi] = useState(false);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [ops, setOps] = useState<OpsSummary | null>(null);
    const [assignments, setAssignments] = useState<KitchenAssignment[]>([]);
    const [courierId, setCourierId] = useState('');
    const [tripCode, setTripCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const lock = useRef(false);

    const refresh = useCallback(async () => {
        const [r, o] = await Promise.all([kitchenPlanningApi.reference(session), kitchenPlanningApi.operations(session, day)]);
        setWarehouses(r.warehouses); setBranches(r.branches); setOps(o.data);
        setWarehouseId(previous => previous || r.warehouses[0]?.id || '');
        setSelectedBranches(previous => previous.filter(id => r.branches.some(branch => branch.id === id)));
    }, [session, day]);
    useEffect(() => { void refresh().catch(cause => setError(cause instanceof Error ? cause.message : 'Không tải được kế hoạch.')); }, [refresh]);
    useEffect(() => {
        if (!admin || !warehouseId) return;
        let alive = true;
        void kitchenApi.assignments(session, warehouseId).then(result => {
            if (alive) {
                setAssignments(result.items.filter(item => item.isActive));
                setCourierId(previous => result.items.some(item => item.userId === previous && item.isActive) ? previous : '');
            }
        }).catch(() => { if (alive) setAssignments([]); });
        return () => { alive = false; };
    }, [session, warehouseId, admin]);
    const stale = !!preview && (preview.day !== day || preview.warehouseId !== warehouseId ||
        preview.branchIds.join(',') !== selectedBranches.join(','));
    const deliverable = useMemo(() => preview?.plan.recommendations.filter(row => nonZero(row.proposedDeliveryQuantity)) ?? [], [preview]);
    const totalUnfulfilled = preview?.plan.recommendations.filter(row => nonZero(row.unfulfilledQuantity)).length ?? 0;
    const overLimit = preview?.branchIds.some(id => deliverable.filter(row => row.destinationBranchId === id).length > 50) ?? false;
    const toggleBranch = (id: string, checked: boolean) => {
        setSelectedBranches(previous => checked ? (previous.includes(id) || previous.length >= 10 ? previous : [...previous, id])
            : previous.filter(x => x !== id));
        setPreview(null);
    };

    async function calculate(event: FormEvent) {
        event.preventDefault();
        if (lock.current || selectedBranches.length < 1 || !warehouseId) return;
        lock.current = true; setBusy(true); setError(''); setMessage(''); setPreview(null);
        try {
            const response = await kitchenPlanningApi.recommendations(session, warehouseId, selectedBranches, day, withAi);
            setPreview({ warehouseId, branchIds: [...selectedBranches], day, plan: response.data, ai: response.ai });
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tính kế hoạch.'); }
        finally { lock.current = false; setBusy(false); }
    }
    async function createDraft() {
        if (!admin || lock.current || uncertain || !preview || stale || !courierId || !codeValid.test(tripCode.trim().toUpperCase()) || !deliverable.length) {
            setError('Chọn người giao, mã chuyến hợp lệ và tải kế hoạch mới nhất trước khi tạo.'); return;
        }
        if (overLimit) { setError('Một quầy có hơn 50 SKU; cần tách thành nhiều chuyến trong Điều phối G4.'); return; }
        const grouped = new Map<string, { ingredientId: string; quantity: string }[]>();
        for (const row of deliverable) grouped.set(row.destinationBranchId, [...(grouped.get(row.destinationBranchId) ?? []),
            { ingredientId: row.ingredientId, quantity: row.proposedDeliveryQuantity }]);
        if (!window.confirm(`Tạo chuyến G4 NHÁP cho ${grouped.size} quầy? Chưa trừ tồn hoặc xuất hàng. Nhân viên kho cần đối chiếu trước khi xuất chuyến.`)) return;
        lock.current = true; setBusy(true); setError(''); setMessage('');
        let postStarted = false;
        try {
            // Advisory results may be stale; refresh B7/kitchen stock before writing anything.
            const checked = await kitchenPlanningApi.recommendations(session, warehouseId, preview.branchIds, day, false);
            const original = preview.plan.recommendations.map(x => `${x.destinationBranchId}:${x.ingredientId}:${x.proposedDeliveryQuantity}`).sort();
            const latest = checked.data.recommendations.map(x => `${x.destinationBranchId}:${x.ingredientId}:${x.proposedDeliveryQuantity}`).sort();
            if (original.join('|') !== latest.join('|')) throw new Error('Tồn kho hoặc đề xuất đã thay đổi. Tải lại kế hoạch trước khi tạo chuyến.');
            postStarted = true;
            const result = await distributionApi.create(session, {
                code: tripCode.trim().toUpperCase(), warehouseId, businessDate: day, courierId,
                note: `G5 B7 xem trước ${day}; ADMIN duyệt lập chuyến nháp. Không tự động xuất kho.`,
                stops: preview.branchIds.filter(id => grouped.has(id)).map(id => ({ branchId: id, items: grouped.get(id)! })),
            });
            setMessage(`Đã tạo chuyến NHÁP ${result.data.code}. Vào Điều phối giao hàng để kiểm tra trước khi xuất.`);
            setPreview(null); setTripCode('');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Không thể lưu chuyến.');
            // A POST can commit before losing its response. Never retry before checking G4.
            if (postStarted) setUncertain(true);
        } finally { lock.current = false; setBusy(false); }
    }
    return <section className="wh-g5">
        <div className="wh-heading"><div><p className="wh-eyebrow">G5 / KẾ HOẠCH KHO BẾP</p><h2>Đề xuất bổ sung theo quầy</h2></div>
            <button type="button" disabled={busy} onClick={() => { void refresh().catch(cause => setError(String(cause))); }}>Làm mới số liệu</button></div>
        <p className="wh-intro">Dùng thuật toán B7 hiện có, nguồn cung là tồn kho bếp G3. Hàng G4 đã xuất nhưng chưa xác nhận được tính là đang về quầy. AI (nếu bật) chỉ hỗ trợ tham khảo, không đổi số lượng giao.</p>
        {ops && <div className="wh-g5-metrics">
            <div><strong>{ops.branchCount}</strong><span>Quầy trong phạm vi</span></div>
            <div><strong>{ops.pendingReceivingStops}</strong><span>Điểm đang chờ nhận</span></div>
            <div><strong>{ops.discrepantStops}</strong><span>Điểm có chênh lệch</span></div>
            <div><strong>{ops.submittedSalesReports}</strong><span>Báo cáo bán chờ duyệt</span></div>
            <div><strong>{ops.submittedStockCounts}</strong><span>Phiếu kiểm kê chờ duyệt</span></div>
        </div>}
        {error && <p className="wh-error" role="alert">{error}</p>}
        {message && <p className="wh-g5-success" role="status">{message}</p>}
        {uncertain && <div className="wh-note" role="alert">Có thể chuyến G4 đã được lưu dù không nhận được phản hồi. Hãy mở Điều phối giao hàng và tìm mã chuyến trước khi thử thao tác khác. <button type="button" onClick={onOpenDistribution}>Mở Điều phối</button></div>}
        <form onSubmit={event => { void calculate(event); }} className="wh-g5-form">
            <label>Ngày giao buổi sáng<input type="date" required value={day} onChange={e => { setDay(e.target.value); setPreview(null); }} /></label>
            <label>Kho nguồn<select required value={warehouseId} onChange={e => { setWarehouseId(e.target.value); setPreview(null); }}>
                <option value="">Chọn kho</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select></label>
            <fieldset><legend>Chọn tối đa 10 quầy ({selectedBranches.length}/10)</legend>
                <div className="wh-g5-branches">{branches.map(branch => <label key={branch.id}>
                    <input type="checkbox" checked={selectedBranches.includes(branch.id)} disabled={!selectedBranches.includes(branch.id) && selectedBranches.length >= 10}
                        onChange={e => toggleBranch(branch.id, e.target.checked)} />{branch.code} — {branch.name}
                </label>)}</div>
                {!branches.length && <p>Không có quầy hoạt động trong phạm vi quản lý.</p>}
            </fieldset>
            <label className="wh-g5-inline"><input type="checkbox" checked={withAi} onChange={e => setWithAi(e.target.checked)} /> Lấy dự báo AI2/AI3 khi có đủ dữ liệu (không thay đổi lượng đề xuất)</label>
            <button className="wh-primary" type="submit" disabled={busy || selectedBranches.length < 1 || !warehouseId}>{busy ? 'Đang tính…' : 'Xem đề xuất B7 cho kho bếp'}</button>
        </form>
        {preview && <div className="wh-g5-preview">
            <h3>Kế hoạch xem trước · {preview.plan.businessDate} · {preview.plan.sourceWarehouse.name}</h3>
            {stale && <p className="wh-error">Đã thay đổi tham số. Hãy tính lại kế hoạch.</p>}
            <p>Dòng được đề xuất: <strong>{preview.plan.recommendations.length}</strong> · Có thể cấp: <strong>{deliverable.length}</strong> · Chưa đáp ứng đủ: <strong>{totalUnfulfilled}</strong></p>
            <p>Chất lượng dữ liệu phụ thuộc kiểm kê B6 đã duyệt; số âm chênh lệch có thể chứa hao hụt, không đồng nghĩa lượng bán.</p>
            {preview.ai && <p>AI: <strong>{preview.ai.status}</strong>. {preview.ai.warnings.join(' ') || 'Dự báo AI chỉ để tham khảo.'}</p>}
            <div className="wh-g5-table"><table><thead><tr><th>Quầy</th><th>Nguyên liệu</th><th>Tồn quầy</th><th>Đang giao</th><th>Dự báo dùng</th><th>Cần</th><th>Kho có thể cấp</th><th>Thiếu</th><th>Cơ sở</th></tr></thead><tbody>
                {preview.plan.recommendations.map(row => <tr key={`${row.destinationBranchId}/${row.ingredientId}`}>
                    <td>{row.destinationBranchCode}</td><td>{row.ingredientName} ({row.unit})</td><td>{row.onHand}</td><td>{row.expectedIncomingQuantity}</td>
                    <td>{row.predictedConsumption}</td><td>{row.requestedQuantity}</td><td><strong>{row.proposedDeliveryQuantity}</strong></td><td>{row.unfulfilledQuantity}</td>
                    <td title={row.forecastMethod}>{explainMethod[row.forecastMethod] ?? row.forecastMethod} · {row.historySamples} mẫu</td>
                </tr>)}</tbody></table></div>
            {!preview.plan.recommendations.length && <p>Chưa có SKU cần bổ sung dựa trên tồn quầy, tồn tối thiểu và dữ liệu B6 được duyệt.</p>}
            <p className="wh-g5-warning">Đây chưa phải phê duyệt tồn kho hoặc lệnh xuất hàng. Chuyến G4 nháp không giữ tồn; kho sẽ kiểm tra lại số lượng khi xuất.</p>
            {overLimit && <p className="wh-error">Có quầy vượt 50 SKU/chuyến G4. Vui lòng chia các chuyến thủ công trên trang Điều phối giao hàng.</p>}
            {admin && <div className="wh-g5-approve"><h4>ADMIN xác nhận lập chuyến G4 nháp</h4>
                <label>Mã chuyến (duy nhất)<input value={tripCode} maxLength={40} placeholder="G5-20261127-01" onChange={e => setTripCode(e.target.value.toUpperCase())} /></label>
                <label>Người giao<select value={courierId} onChange={e => setCourierId(e.target.value)}>
                    <option value="">Chọn nhân viên kho được phân công</option>{assignments.map(a => <option key={a.userId} value={a.userId}>{a.user.displayName}</option>)}
                </select></label>
                <button type="button" className="wh-primary" disabled={busy || stale || uncertain || overLimit || !deliverable.length || !courierId || !codeValid.test(tripCode)}
                    onClick={() => { void createDraft(); }}>Xác nhận tạo chuyến G4 NHÁP</button>
            </div>}
        </div>}
    </section>;
}

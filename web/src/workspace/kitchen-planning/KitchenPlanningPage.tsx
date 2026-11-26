import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { kitchenApi, type KitchenAssignment } from '../kitchen/kitchen.api';
import { kitchenPlanningApi, type KitchenPlan, type KitchenAiOverlay, type OpsSummary,
    type PlanningWarehouse, type PlanningBranch, restockApprovalApi, type RestockPlanRecord } from './kitchen-planning.api';
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
    const [reviewNote,setReviewNote] = useState('');
    const [submissionNote,setSubmissionNote] = useState('');
    const [plans,setPlans] = useState<RestockPlanRecord[]>([]);
    const [submissionKey,setSubmissionKey] = useState<string|null>(null);
    const [selectedPlan,setSelectedPlan] = useState<string|null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const lock = useRef(false);

    const refresh = useCallback(async () => {
        const [r, o, saved] = await Promise.all([
            kitchenPlanningApi.reference(session), kitchenPlanningApi.operations(session, day),
            restockApprovalApi.list(session, day),
        ]);
        setPlans(saved.items);
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
        setPreview(null);setSubmissionKey(null);
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
    async function submitProposal() {
        if (lock.current || uncertain || !preview || stale || !deliverable.length || overLimit) return;
        if (!window.confirm('Gửi đề xuất G6 để ADMIN xét duyệt? Sau khi gửi, các dòng hàng và số lượng sẽ được lưu thành bản ghi bất biến.')) return;
        lock.current=true;setBusy(true);setError('');setMessage('');
        // Reusing the same key on an uncertain retry prevents two proposals.
        const key = submissionKey ?? crypto.randomUUID();
        setSubmissionKey(key);
        try {
            const result = await restockApprovalApi.submit(session, {
                submissionKey:key, warehouseId:preview.warehouseId, businessDate:preview.day,
                branchIds:preview.branchIds,
                expectedRows:deliverable.map(x=>({branchId:x.destinationBranchId,ingredientId:x.ingredientId,quantity:x.proposedDeliveryQuantity})),
                note:submissionNote.trim(),
            });
            setSubmissionKey(null);setUncertain(false);setPreview(null);
            setSelectedPlan(result.data.id);setMessage(`Đã gửi đề xuất ${result.data.id.slice(0,8)}; chờ ADMIN xét duyệt.`);
            await refresh();
        } catch(e) {
            setUncertain(true);
            setError(e instanceof Error?e.message:'Không gửi được đề xuất.');
        } finally {lock.current=false;setBusy(false);}
    }
    async function reviewProposal(plan:RestockPlanRecord,decision:'APPROVED'|'REJECTED') {
        if (!admin || lock.current || uncertain || plan.createdById===session.user.id) return;
        if (decision==='REJECTED' && reviewNote.trim().length<8) {setError('Cần lý do từ chối từ 8 ký tự.');return;}
        if (!window.confirm(`${decision==='APPROVED'?'Duyệt':'Từ chối'} đề xuất ${plan.id.slice(0,8)}?`)) return;
        lock.current=true;setBusy(true);setError('');setMessage('');
        try {
            await restockApprovalApi.review(session,plan.id,decision,reviewNote);
            setMessage('Đã ghi nhận quyết định và lịch sử phê duyệt.');setReviewNote('');await refresh();
        } catch(e) {setUncertain(true);setError(e instanceof Error?e.message:'Lỗi xử lý duyệt.');}
        finally {lock.current=false;setBusy(false);}
    }
    async function convertProposal(plan:RestockPlanRecord) {
        if (!admin || lock.current || uncertain || plan.status!=='APPROVED' || !courierId || !codeValid.test(tripCode)) {
            setError('Cần chuyến đã duyệt, mã chuyến và nhân viên kho hợp lệ.');return;
        }
        if (!window.confirm('Chuyển đề xuất đã duyệt thành chuyến G4 NHÁP? Bước này chưa xuất hàng, chưa giữ tồn.')) return;
        lock.current=true;setBusy(true);setError('');setMessage('');
        try {
            const result=await restockApprovalApi.convert(session,plan.id,tripCode,courierId);
            setMessage(`Đã tạo chuyến G4 NHÁP ${result.data.tripCode}. Kho cần kiểm tra trước khi xuất.`);
            setTripCode('');await refresh();
        } catch(e) {setUncertain(true);setError(e instanceof Error?e.message:'Chưa tạo được chuyến.');}
        finally {lock.current=false;setBusy(false);}
    }
    return <section className="wh-g5">
        <div className="wh-heading"><div><p className="wh-eyebrow">G6 / KẾ HOẠCH & PHÊ DUYỆT</p><h2>Đề xuất bổ sung theo quầy</h2></div>
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
        {uncertain && <div className="wh-note" role="alert">Yêu cầu có thể đã được ghi nhận dù phản hồi bị mất. Hãy tải lại đề xuất/chuyến trước khi thao tác khác. <button type="button" onClick={()=>{void refresh().then(()=>setUncertain(false)).catch(e=>setError(String(e)));}}>Đối chiếu trạng thái</button> <button type="button" onClick={onOpenDistribution}>Mở Điều phối</button></div>}
        <form onSubmit={event => { void calculate(event); }} className="wh-g5-form">
            <label>Ngày giao buổi sáng<input type="date" required value={day} onChange={e => { setDay(e.target.value); setPreview(null);setSubmissionKey(null); }} /></label>
            <label>Kho nguồn<select required value={warehouseId} onChange={e => { setWarehouseId(e.target.value); setPreview(null);setSubmissionKey(null); }}>
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
            <div className="wh-g5-approve"><h4>G6 — Gửi kế hoạch để xét duyệt</h4>
                <p>Bản kế hoạch được hệ thống tính lại trước khi lưu. ADMIN không được tự duyệt đề xuất do mình gửi.</p>
                <label>Ghi chú đề xuất<textarea value={submissionNote} maxLength={500} onChange={e=>setSubmissionNote(e.target.value)} /></label>
                <button type="button" className="wh-primary" disabled={busy||uncertain||stale||overLimit||!deliverable.length} onClick={()=>{void submitProposal();}}>Gửi đề xuất (SUBMITTED)</button>
            </div>
        </div>}
        <div className="wh-g5-preview">
            <div className="wh-heading"><h3>Đề xuất đã gửi · {day}</h3><button type="button" disabled={busy} onClick={()=>{void refresh().then(()=>setUncertain(false)).catch(e=>setError(String(e)));}}>Tải lại lịch sử</button></div>
            {plans.map(p=><article key={p.id} className="wh-g6-card">
                <header><strong>{p.area.code} · {p.warehouse.code}</strong><span>{p.status} · {p.lines.length} SKU</span></header>
                <p>Mã hồ sơ {p.id.slice(0,8)} · Gửi bởi {p.createdBy.displayName} · {p.businessDate.slice(0,10)}</p>
                <button type="button" onClick={()=>setSelectedPlan(selectedPlan===p.id?null:p.id)}> {selectedPlan===p.id?'Thu gọn':'Chi tiết hồ sơ'} </button>
                {selectedPlan===p.id && <div>
                    <p>Ghi chú: {p.note||'—'} · Ý kiến duyệt: {p.reviewNote||'—'}</p>
                    <div className="wh-g5-table"><table><thead><tr><th>Quầy</th><th>Nguyên liệu</th><th>Số lượng đề xuất</th></tr></thead><tbody>
                        {p.lines.map(line=><tr key={`${line.branchId}/${line.ingredientId}`}><td>{line.branch.code}</td><td>{line.ingredient.name}</td><td>{line.quantity} {line.ingredient.unit}</td></tr>)}
                    </tbody></table></div>
                    {admin&&p.status==='SUBMITTED'&&p.createdById!==session.user.id&&<div className="wh-g6-review">
                        <label>Ý kiến duyệt<textarea maxLength={500} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="Cần nhập lý do khi từ chối"/></label>
                        <button type="button" disabled={busy||uncertain} onClick={()=>{void reviewProposal(p,'APPROVED');}}>Phê duyệt</button>
                        <button type="button" disabled={busy||uncertain||reviewNote.trim().length<8} onClick={()=>{void reviewProposal(p,'REJECTED');}}>Từ chối</button>
                    </div>}
                    {admin&&p.status==='APPROVED'&&<div className="wh-g6-review">
                        <p>Kho: {p.warehouse.name}. Chuyến DRAFT không giữ hàng và không xuất kho.</p>
                        <label>Mã chuyến mới<input value={tripCode} maxLength={40} onChange={e=>setTripCode(e.target.value.toUpperCase())} placeholder="G6-20261127-01" /></label>
                        <label>Nhân viên giao<select value={courierId} onChange={e=>setCourierId(e.target.value)}>
                            <option value="">Chọn nhân viên kho</option>{assignments.map(a=><option key={a.userId} value={a.userId}>{a.user.displayName}</option>)}
                        </select></label>
                        {p.warehouseId!==warehouseId&&<p className="wh-g5-warning">Chọn đúng kho {p.warehouse.code} ở bộ lọc phía trên trước khi chọn nhân viên giao.</p>}
                        <button type="button" disabled={busy||uncertain||p.warehouseId!==warehouseId||!courierId||!codeValid.test(tripCode)} onClick={()=>{void convertProposal(p);}}>Tạo chuyến G4 nháp từ đề xuất đã duyệt</button>
                    </div>}
                    {p.status==='CONVERTED'&&<p>Đã chuyển thành chuyến G4: {p.deliveryTripId}. <button type="button" onClick={onOpenDistribution}>Mở Điều phối</button></p>}
                    <details><summary>Lịch sử duyệt ({p.events.length})</summary><ul>{p.events.map(e=><li key={e.id}>{new Date(e.createdAt).toLocaleString('vi-VN')}: {e.action} — {e.actor.displayName}. {e.note}</li>)}</ul></details>
                </div>}
            </article>)}
            {!plans.length&&<p>Chưa có đề xuất cho ngày đã chọn.</p>}
        </div>
    </section>;
}

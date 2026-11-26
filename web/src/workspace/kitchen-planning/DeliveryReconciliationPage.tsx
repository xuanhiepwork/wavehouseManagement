import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import { deliveryReconciliationApi, type ReconciliationCase, type RecoveryRequest } from './delivery-reconciliation.api';
import './KitchenPlanningPage.css';

function todayVN() {
    const tokens = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (key: string) => tokens.find(t => t.type === key)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}
const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const amount = (text: string) => Number(text || '0');

export default function DeliveryReconciliationPage({ session }: {session: AuthSession}) {
    const [day, setDay] = useState(todayVN);
    const [cases, setCases] = useState<ReconciliationCase[]>([]);
    const [requests, setRequests] = useState<RecoveryRequest[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [quantities, setQuantities] = useState<Record<string,string>>({});
    const [evidence, setEvidence] = useState('');
    const [reviewNote, setReviewNote] = useState<Record<string,string>>({});
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const key = useRef<string | null>(null);
    const refresh = useCallback(async () => {
        const [report, documents] = await Promise.all([
            deliveryReconciliationApi.report(session,day), deliveryReconciliationApi.requests(session,day),
        ]);
        setCases(report.items); setRequests(documents.items);
    },[session,day]);
    useEffect(() => { void Promise.resolve().then(() => refresh()).catch(cause => setError(cause instanceof Error ? cause.message : 'Không tải được đối soát.')); },[refresh]);
    function clearDraft() { setSelected(null); setEvidence(''); setQuantities({}); key.current=null; }
    async function reload() {
        setError(''); setMessage('');
        try { await refresh(); setUncertain(false); clearDraft(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu.'); }
    }
    async function submit(record:ReconciliationCase) {
        if (lock.current || uncertain) return;
        const lines = record.items.filter(item => amount(quantities[item.ingredientId] ?? '') > 0)
            .map(item => ({ingredientId:item.ingredientId,quantity:quantities[item.ingredientId]}));
        if (!lines.length || evidence.trim().length < 10 || lines.some(line => !amountPattern.test(line.quantity))) {
            setError('Chọn số lượng thu hồi hợp lệ và ghi chứng cứ kiểm đếm từ 10 ký tự.'); return;
        }
        if (lines.some(line => {
            const item = record.items.find(x => x.ingredientId === line.ingredientId)!;
            return amount(line.quantity) > amount(item.outstandingQuantity) ||
                (item.ingredient.unit === 'piece' && !Number.isInteger(amount(line.quantity)));
        })) { setError('Số lượng không được vượt số hàng còn thiếu; đơn vị cái phải là số nguyên.'); return; }
        if (!window.confirm('Gửi yêu cầu ghi nhận hàng tìm thấy? Chứng từ cần ADMIN khác duyệt; gửi chưa thay đổi tồn kho.')) return;
        if (!key.current) key.current = crypto.randomUUID();
        lock.current = true; setBusy(true); setError(''); setMessage('');
        try {
            await deliveryReconciliationApi.submit(session,{submissionKey:key.current,discrepancyId:record.id,
                evidence:evidence.trim(),lines});
            await refresh(); clearDraft(); setMessage('Đã gửi chứng từ. Tồn kho chưa thay đổi; chờ ADMIN xét duyệt.');
        } catch (cause) { setUncertain(true); setError(cause instanceof Error ? cause.message : 'Không gửi được chứng từ.'); }
        finally {lock.current=false;setBusy(false);}
    }
    async function review(request:RecoveryRequest, decision:'POSTED'|'REJECTED') {
        if (lock.current || uncertain) return;
        const note = (reviewNote[request.id] ?? '').trim();
        if (note.length < 10) {setError('Cần giải trình quyết định tối thiểu 10 ký tự.');return;}
        const action = decision === 'POSTED' ? 'GHI TĂNG TỒN KHO' : 'TỪ CHỐI';
        if (!window.confirm(`Xác nhận ${action} cho chứng từ này? Quyết định không thể hoàn tác.`)) return;
        lock.current=true;setBusy(true);setError('');setMessage('');
        try {
            await deliveryReconciliationApi.review(session,request.id,decision,note);
            await refresh();setMessage(decision==='POSTED'
                ? 'Đã ghi tăng đúng số hàng thực tìm thấy, ghi sổ và lưu vết phê duyệt.'
                : 'Đã từ chối chứng từ; không phát sinh biến động tồn kho.');
        } catch (cause) {setUncertain(true);setError(cause instanceof Error?cause.message:'Không duyệt được chứng từ.');}
        finally {lock.current=false;setBusy(false);}
    }
    const totalPending = requests.filter(x=>x.status==='SUBMITTED').length;
    return <section className="wh-g5">
        <div className="wh-heading"><div><p className="wh-eyebrow">G7 / ĐỐI SOÁT KHO</p><h2>Đối soát giao hàng và thu hồi hàng thiếu</h2></div></div>
        <p className="wh-intro">Hàng G4 đã thực nhận chỉ được ghi tồn một lần. Hàng hỏng và còn thiếu không tự động tạo bút toán. Chỉ hàng thiếu được tìm thấy, kiểm đếm lại và được ADMIN phê duyệt mới ghi tăng tồn quầy.</p>
        <div className="wh-g6-toolbar"><label>Ngày giao <input type="date" value={day} onChange={event=>{setDay(event.target.value);clearDraft();}} /></label>
            <button type="button" disabled={busy} onClick={()=>{void reload();}}>Tải lại / đối chiếu</button>
            <span>{cases.length} hồ sơ · {totalPending} chứng từ chờ duyệt</span></div>
        {error && <p className="wh-error" role="alert">{error}</p>}
        {message && <p className="wh-g5-success" role="status">{message}</p>}
        {uncertain && <p className="wh-g5-warning">Phản hồi trước chưa chắc chắn. Hãy tải lại chứng từ trước khi gửi/duyệt tiếp.</p>}
        <h3>Đối soát theo điểm giao</h3>
        <div className="wh-g6-list">{cases.map(record=><article key={record.id} className="wh-g6-card">
            <header><strong>{record.trip.code} · {record.branch.code}</strong><span>{record.status==='RESOLVED'?'Đã kết luận G6':'Chờ kết luận G6'}</span></header>
            <p>Quầy {record.branch.name} · Kho {record.trip.warehouse.code} · Phân loại: {record.classification||'—'}</p>
            <div className="wh-g5-table"><table><thead><tr><th>SKU</th><th>Xuất</th><th>Nhận tốt</th><th>Hỏng</th><th>Thiếu</th><th>Thu hồi đã ghi</th><th>Còn thiếu</th></tr></thead><tbody>
                {record.items.map(row=><tr key={row.ingredientId}><td>{row.ingredient.code} — {row.ingredient.name}</td>
                    <td>{row.plannedQuantity}</td><td>{row.receivedQuantity}</td><td>{row.damagedQuantity}</td>
                    <td>{row.missingQuantity}</td><td>{row.recoveredQuantity}</td><td>{row.outstandingQuantity}</td></tr>)}
            </tbody></table></div>
            {record.status==='RESOLVED' && record.items.some(item=>amount(item.outstandingQuantity)>0) && <>
                {selected===record.id ? <div className="wh-g6-review">
                    <p><strong>Yêu cầu ghi nhận hàng tìm thấy:</strong> nhập lượng thực kiểm tại quầy; không ghi nhận hàng hỏng hoặc thiếu chưa tìm thấy.</p>
                    {record.items.filter(x=>amount(x.outstandingQuantity)>0).map(item=><label key={item.ingredientId}>
                        {item.ingredient.code} (tối đa {item.outstandingQuantity} {item.ingredient.unit})
                        <input type="text" inputMode="decimal" placeholder="0" value={quantities[item.ingredientId]??''}
                            onChange={e=>setQuantities(old=>({...old,[item.ingredientId]:e.target.value}))} />
                    </label>)}
                    <label>Biên bản / chứng cứ kiểm đếm<textarea maxLength={500} value={evidence}
                        onChange={e=>setEvidence(e.target.value)} placeholder="Thời điểm tìm thấy, người chứng kiến, vị trí vật lý…" /></label>
                    <button className="wh-primary" type="button" disabled={busy||uncertain||evidence.trim().length<10}
                        onClick={()=>{void submit(record);}}>Gửi chứng từ chờ duyệt</button>
                    <button type="button" onClick={clearDraft}>Hủy</button>
                </div> : <button type="button" disabled={busy||uncertain}
                    onClick={()=>{clearDraft();setSelected(record.id);}}>Ghi nhận tìm thấy hàng thiếu</button>}
            </>}
        </article>)}
        {!cases.length && <p>Không có hồ sơ chênh lệch G6 trong ngày được chọn.</p>}</div>
        <h3>Chứng từ thu hồi và lịch sử phê duyệt</h3>
        <div className="wh-g6-list">{requests.map(request=><article key={request.id} className="wh-g6-card">
            <header><strong>{request.branch.code} · {request.discrepancy.stop.trip.code}</strong>
                <span>{request.status==='SUBMITTED'?'Chờ ADMIN':request.status==='POSTED'?'Đã ghi sổ':'Từ chối'}</span></header>
            <p>Người lập: {request.createdBy.displayName} · Chứng cứ: {request.evidence}</p>
            <p>{request.lines.map(x=>`${x.ingredient.code}: ${x.quantity} ${x.ingredient.unit}`).join(' · ')}</p>
            {request.reviewNote && <p>Kết luận: {request.reviewNote} — {request.reviewedBy?.displayName}</p>}
            {request.status==='SUBMITTED' && session.user.role==='ADMIN' && request.createdById!==session.user.id &&
                request.discrepancy.stop.receivedById!==session.user.id && <div className="wh-g6-review">
                <label>Giải trình quyết định<textarea maxLength={500} value={reviewNote[request.id]??''}
                    onChange={e=>setReviewNote(old=>({...old,[request.id]:e.target.value}))} /></label>
                <button type="button" className="wh-primary" disabled={busy||uncertain} onClick={()=>{void review(request,'POSTED');}}>Phê duyệt & ghi tăng tồn</button>
                <button type="button" disabled={busy||uncertain} onClick={()=>{void review(request,'REJECTED');}}>Từ chối</button>
            </div>}
            {request.status==='SUBMITTED' && session.user.id===request.createdById && <p>Người lập không được tự phê duyệt.</p>}
            <details><summary>Lịch sử chứng từ ({request.events.length})</summary><ul>{request.events.map((event,i)=><li key={i}>{new Date(event.createdAt).toLocaleString('vi-VN')}: {event.action} — {event.actor.displayName}. {event.note}</li>)}</ul></details>
        </article>)}
        {!requests.length && <p>Chưa có chứng từ thu hồi nào cho ngày được chọn.</p>}</div>
    </section>;
}

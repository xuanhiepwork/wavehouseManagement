import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import { deliveryDiscrepancyApi, type DiscrepancyRecord } from './delivery-discrepancies.api';
import './KitchenPlanningPage.css';

function todayVN() {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh',
        year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date());
    const get = (type:string) => parts.find(x=>x.type===type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}
const classificationNames: Record<string,string> = {
    SHORTAGE: 'Thiếu hàng trên đường giao', DAMAGED: 'Hàng hỏng',
    COUNT_ERROR: 'Sai lệch kiểm đếm', OTHER: 'Nguyên nhân khác',
};
export default function DeliveryDiscrepanciesPage({ session }:{session:AuthSession}) {
    const [day,setDay] = useState(todayVN);
    const [items,setItems] = useState<DiscrepancyRecord[]>([]);
    const [busy,setBusy] = useState(false);
    const [error,setError] = useState('');
    const [message,setMessage] = useState('');
    const [uncertain,setUncertain] = useState(false);
    const [selected,setSelected] = useState<string|null>(null);
    const [classification,setClassification] = useState('SHORTAGE');
    const [note,setNote] = useState('');
    const lock = useRef(false);
    const refresh = useCallback(async () => {
        const data = await deliveryDiscrepancyApi.list(session,day);
        setItems(data.items);
    },[session,day]);
    useEffect(()=>{ void Promise.resolve().then(() => refresh()).catch(e=>setError(e instanceof Error?e.message:'Không tải được hồ sơ.')); },[refresh]);
    async function resolve(id:string) {
        if (lock.current || uncertain || note.trim().length<10) {setError('Cần giải trình từ 10 ký tự.');return;}
        if (!window.confirm('Kết luận hồ sơ chênh lệch? Thao tác không điều chỉnh tồn kho và không thể hoàn tác.')) return;
        lock.current=true; setBusy(true); setError(''); setMessage('');
        try {
            await deliveryDiscrepancyApi.resolve(session,id,classification,note);
            setMessage('Đã lưu kết luận và lịch sử xử lý. Không có bút toán tồn kho phát sinh.');
            setSelected(null); setNote(''); await refresh();
        } catch(e) { setUncertain(true); setError(e instanceof Error?e.message:'Lỗi kết luận.'); }
        finally { lock.current=false;setBusy(false); }
    }
    return <section className="wh-g5">
        <div className="wh-heading"><div><p className="wh-eyebrow">G6 / GIAO NHẬN</p><h2>Hồ sơ chênh lệch giao hàng</h2></div></div>
        <p className="wh-intro">Chỉ tạo hồ sơ sau khi quầy xác nhận thực nhận. Kết luận thiếu/hỏng không tự cộng hoặc trừ tồn kho. Nhân viên nhận hàng không được tự kết luận hồ sơ của mình.</p>
        <div className="wh-g6-toolbar"><label>Ngày giao <input type="date" value={day} onChange={e=>{setDay(e.target.value);setSelected(null);}} /></label>
            <button type="button" onClick={()=>{setUncertain(false);void refresh().catch(e=>setError(String(e)));}}>Tải lại hồ sơ</button></div>
        {error && <p className="wh-error" role="alert">{error}</p>}
        {message && <p className="wh-g5-success" role="status">{message}</p>}
        {uncertain && <p className="wh-g5-warning">Không gửi lại yêu cầu khi chưa đối chiếu trạng thái hồ sơ mới nhất. Nhấn “Tải lại hồ sơ” trước.</p>}
        <div className="wh-g6-list">{items.map(item=><article key={item.id} className="wh-g6-card">
            <header><strong>{item.stop.trip.code} · {item.stop.branch.code}</strong> <span>{item.status==='OPEN'?'Chờ kết luận':'Đã kết luận'}</span></header>
            <p>Kho {item.stop.trip.warehouse.code} → {item.stop.branch.name} · {item.stop.trip.businessDate.slice(0,10)}</p>
            <p>Ghi chú lúc nhận: {item.stop.note||'—'}</p>
            <div className="wh-g5-table"><table><thead><tr><th>Nguyên liệu</th><th>Đã xuất</th><th>Thực nhận</th><th>Hỏng</th></tr></thead><tbody>
                {item.stop.items.map(row=><tr key={row.ingredientId}><td>{row.ingredient.code} — {row.ingredient.name}</td><td>{row.plannedQuantity}</td><td>{row.receivedQuantity??'—'}</td><td>{row.damagedQuantity??'—'}</td></tr>)}
            </tbody></table></div>
            {item.status==='RESOLVED'?<p><strong>{classificationNames[item.classification||'']||item.classification}:</strong> {item.resolutionNote} — {item.resolvedBy?.displayName}</p>
                : <>
                    {selected===item.id?<div className="wh-g6-review">
                        <label>Phân loại<select value={classification} onChange={e=>setClassification(e.target.value)}>
                            {Object.entries(classificationNames).map(([code,name])=><option key={code} value={code}>{name}</option>)}
                        </select></label>
                        <label>Giải trình<textarea value={note} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="Nêu nguyên nhân, biện pháp và người phụ trách…" /></label>
                        <button type="button" className="wh-primary" disabled={busy||uncertain||note.trim().length<10||session.user.id===item.stop.receivedById}
                            onClick={()=>{void resolve(item.id);}}>Lưu kết luận</button>
                        <button type="button" onClick={()=>setSelected(null)}>Hủy</button>
                    </div>:<button type="button" disabled={busy||session.user.id===item.stop.receivedById}
                        onClick={()=>{setSelected(item.id);setNote('');setClassification('SHORTAGE');}}>Phân loại và kết luận</button>}
                    {session.user.id===item.stop.receivedById && <p>Người đã nhận hàng phải chuyển hồ sơ cho quản lý/ADMIN khác kết luận.</p>}
                </>}
            <details><summary>Lịch sử xử lý ({item.events.length})</summary><ul>{item.events.map(e=><li key={e.id}>{new Date(e.createdAt).toLocaleString('vi-VN')}: {e.action} — {e.actor.displayName}. {e.note}</li>)}</ul></details>
        </article>)}
        {!items.length && <p>Không có hồ sơ chênh lệch được ghi nhận cho ngày này.</p>}</div>
    </section>;
}

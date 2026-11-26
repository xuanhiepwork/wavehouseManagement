import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import { stockWriteOffApi, type LocationType, type StockLocation, type StockBalance,
    type StockWriteOff, type WriteOffReason } from './stock-writeoffs.api';
import './StockWriteOffPage.css';

const labels: Record<WriteOffReason,string> = {
    EXPIRED:'Hết hạn', DAMAGED:'Hư hỏng tại kho/quầy', SPOILAGE:'Hao hụt chế biến/bảo quản',
    LOSS:'Mất mát', COUNT_VARIANCE:'Chênh lệch thiếu sau kiểm kê',
};
const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
function validQuantity(value:string,available:string,unit:string) {
    if (!amountPattern.test(value)) return false;
    const amount=Number(value);
    return amount>0 && amount<=Number(available) && (unit!=='piece' || Number.isInteger(amount));
}
export default function StockWriteOffPage({session}:{session:AuthSession}) {
    const [targets,setTargets] = useState<{branches:StockLocation[];warehouses:StockLocation[]}>({branches:[],warehouses:[]});
    const [locationType,setLocationType] = useState<LocationType>('BRANCH');
    const [locationId,setLocationId] = useState('');
    const [balances,setBalances] = useState<StockBalance[]>([]);
    const [requests,setRequests] = useState<StockWriteOff[]>([]);
    const [reason,setReason] = useState<WriteOffReason>('EXPIRED');
    const [evidence,setEvidence] = useState('');
    const [quantities,setQuantities] = useState<Record<string,string>>({});
    const [notes,setNotes] = useState<Record<string,string>>({});
    const [busy,setBusy] = useState(false);
    const [uncertain,setUncertain] = useState(false);
    const [error,setError] = useState('');
    const [message,setMessage] = useState('');
    const lock = useRef(false);
    const submissionKey = useRef<string|null>(null);
    const refresh = useCallback(async()=> {
        const [available, documents]=await Promise.all([stockWriteOffApi.targets(session),stockWriteOffApi.requests(session)]);
        setTargets(available); setRequests(documents.items);
    },[session]);
    useEffect(()=>{void Promise.resolve().then(() => refresh()).catch(err=>setError(err instanceof Error?err.message:'Không tải được G8.'));},[refresh]);
    useEffect(()=>{
        if(!locationId)return;
        let active=true;
        void stockWriteOffApi.balances(session,locationType,locationId).then(result=>{
            if(active)setBalances(result.items);
        }).catch(err=>{if(active)setError(err instanceof Error?err.message:'Không tải được tồn kho.');});
        return()=>{active=false;};
    },[session,locationType,locationId]);
    const available=locationType==='BRANCH'?targets.branches:targets.warehouses;
    function clearDraft(){setQuantities({});setEvidence('');submissionKey.current=null;}
    async function reload(){
        setError('');setMessage('');
        try{
            await refresh();
            if(locationId){const data=await stockWriteOffApi.balances(session,locationType,locationId);setBalances(data.items);}
            setUncertain(false);clearDraft();
        }catch(err){setError(err instanceof Error?err.message:'Không tải lại được dữ liệu.');}
    }
    async function submit(){
        if(lock.current||uncertain)return;
        const lines=balances.filter(row=>quantities[row.ingredientId]?.trim()).map(row=>({
            ingredientId:row.ingredientId,quantity:quantities[row.ingredientId].trim(),
        }));
        if(!locationId||!lines.length||evidence.trim().length<10||evidence.trim().length>500 ||
            lines.some(line=>{const row=balances.find(x=>x.ingredientId===line.ingredientId)!;
                return !validQuantity(line.quantity,row.quantity,row.ingredient.unit);})){
            setError('Chọn địa điểm, nhập 1–50 số lượng hợp lệ và giải trình ít nhất 10 ký tự.');return;
        }
        if(lines.length>50){setError('Một chứng từ tối đa 50 SKU.');return;}
        if(!window.confirm('Gửi yêu cầu giảm tồn? Gửi chưa trừ kho; cần ADMIN khác phê duyệt.'))return;
        submissionKey.current ??= crypto.randomUUID();
        lock.current=true;setBusy(true);setError('');setMessage('');
        try{
            await stockWriteOffApi.submit(session,{submissionKey:submissionKey.current,locationType,locationId,reason,evidence:evidence.trim(),lines});
            await refresh();clearDraft();setMessage('Đã gửi yêu cầu G8; tồn kho chưa thay đổi.');
        }catch(err){setUncertain(true);setError(err instanceof Error?err.message:'Không gửi được chứng từ.');}
        finally{lock.current=false;setBusy(false);}
    }
    async function review(record:StockWriteOff,decision:'POSTED'|'REJECTED'){
        if(lock.current||uncertain)return;
        const note=(notes[record.id]??'').trim();
        if(note.length<10||note.length>500){setError('Cần giải trình duyệt hoặc từ chối từ 10–500 ký tự.');return;}
        if(!window.confirm(decision==='POSTED'?'Xác nhận ghi giảm tồn kho? Không thể hoàn tác trực tiếp.':'Xác nhận từ chối chứng từ?'))return;
        lock.current=true;setBusy(true);setError('');setMessage('');
        try{
            await stockWriteOffApi.review(session,record.id,decision,note);
            await refresh();
            if(locationId){const data=await stockWriteOffApi.balances(session,locationType,locationId);setBalances(data.items);}
            setMessage(decision==='POSTED'?'Đã ghi giảm tồn đúng địa điểm và lưu lịch sử.':'Đã từ chối; tồn kho không thay đổi.');
        }catch(err){setUncertain(true);setError(err instanceof Error?err.message:'Không xử lý được chứng từ.');}
        finally{lock.current=false;setBusy(false);}
    }
    return <section className="wh-g8">
        <div className="wh-heading"><div><p className="wh-eyebrow">G8 / QUẢN LÝ HAO HỤT</p><h2>Hủy hàng và ghi giảm tồn có phê duyệt</h2></div></div>
        <p className="wh-intro">Chỉ xử lý hàng đã nằm trong tồn kho quầy/kho bếp. Không dùng G8 để trừ tiếp hàng thiếu, hàng hỏng của chuyến G4 chưa từng được cộng vào tồn. Mọi thay đổi phải qua ADMIN khác người lập.</p>
        <div className="wh-g8-toolbar"><button type="button" disabled={busy} onClick={()=>{void reload();}}>Tải lại / đối chiếu</button><span>{requests.filter(x=>x.status==='SUBMITTED').length} chứng từ chờ duyệt</span></div>
        {error && <p className="wh-error" role="alert">{error}</p>}
        {message && <p role="status" className="wh-g8-success">{message}</p>}
        {uncertain && <p className="wh-g8-warning">Phản hồi chưa xác định. Hãy tải lại và kiểm tra danh sách chứng từ trước khi gửi thao tác tiếp.</p>}
        <article className="wh-g8-card"><h3>Lập yêu cầu giảm tồn</h3>
            <div className="wh-g8-fields"><label>Loại địa điểm<select value={locationType} disabled={busy} onChange={e=>{setLocationType(e.target.value as LocationType);setLocationId('');setBalances([]);clearDraft();}}>
                <option value="BRANCH">Quầy bán</option><option value="WAREHOUSE">Kho bếp trung tâm</option></select></label>
                <label>Địa điểm<select value={locationId} disabled={busy} onChange={e=>{setLocationId(e.target.value);setBalances([]);clearDraft();}}>
                    <option value="">Chọn địa điểm</option>{available.map(item=><option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}
                </select></label>
                <label>Nguyên nhân<select value={reason} disabled={busy} onChange={e=>{setReason(e.target.value as WriteOffReason);clearDraft();}}>
                    {(Object.keys(labels) as WriteOffReason[]).map(code=><option key={code} value={code}>{labels[code]}</option>)}</select></label></div>
            <label>Chứng cứ và giải trình (10–500 ký tự)<textarea value={evidence} disabled={busy} rows={3} maxLength={500}
                onChange={e=>{setEvidence(e.target.value);submissionKey.current=null;}} placeholder="Vị trí, ngày phát hiện, đối chiếu số lượng, người kiểm đếm…" /></label>
            {locationId && <div className="wh-g8-table"><table><thead><tr><th>SKU</th><th>Tồn hiện có</th><th>Lượng xin giảm</th></tr></thead><tbody>
                {balances.map(row=><tr key={row.ingredientId}><td>{row.ingredient.code} — {row.ingredient.name} ({row.ingredient.unit})</td>
                    <td>{row.quantity}</td><td><input aria-label={`Số lượng ${row.ingredient.code}`} inputMode="decimal"
                        value={quantities[row.ingredientId]??''} disabled={busy} placeholder="0" onChange={e=>{setQuantities(curr=>({...curr,[row.ingredientId]:e.target.value}));submissionKey.current=null;}} /></td></tr>)}
                </tbody></table></div>}
            <button type="button" className="wh-primary" disabled={busy||uncertain||!locationId} onClick={()=>{void submit();}}>Gửi đề xuất (chưa trừ tồn)</button>
        </article>
        <h3>Danh sách chứng từ gần đây</h3>
        <div className="wh-g8-docs">{requests.map(record=><article className="wh-g8-card" key={record.id}>
            <header><strong>{record.branch?.code??record.warehouse?.code} · {labels[record.reason]}</strong>
                <span>{record.status==='SUBMITTED'?'Chờ duyệt':record.status==='POSTED'?'Đã ghi giảm':'Từ chối'}</span></header>
            <p>Người lập: {record.createdBy.displayName} · Ngày {new Date(record.createdAt).toLocaleString('vi-VN')} · {record.evidence}</p>
            <ul>{record.lines.map(line=><li key={line.ingredientId}>{line.ingredient.code}: {line.quantity} {line.ingredient.unit}</li>)}</ul>
            {record.events.map((event,i)=><p className="wh-g8-event" key={i}>{event.action} · {event.actor.displayName} · {event.note??''}</p>)}
            {session.user.role==='ADMIN' && record.status==='SUBMITTED' && record.createdById!==session.user.id &&
                <div className="wh-g8-review"><label>Giải trình phê duyệt<textarea value={notes[record.id]??''} maxLength={500} rows={2}
                    disabled={busy} onChange={e=>setNotes(curr=>({...curr,[record.id]:e.target.value}))} /></label>
                    <button disabled={busy||uncertain} onClick={()=>{void review(record,'POSTED');}}>Phê duyệt và ghi giảm</button>
                    <button disabled={busy||uncertain} onClick={()=>{void review(record,'REJECTED');}}>Từ chối</button>
                </div>}
        </article>)}{!requests.length&&<p>Chưa có chứng từ giảm tồn.</p>}</div>
    </section>;
}

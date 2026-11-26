import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import { stockAuditApi, type AuditRow, type StockAuditSnapshot } from './stock-audit.api';
import './StockAuditPage.css';

const dayInVietnam = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit',
    }).formatToParts(new Date());
    const get = (key:string)=>parts.find(item=>item.type===key)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};
const initialDates = () => {
    const end = dayInVietnam();
    const start = new Date(`${end}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate()-6);
    return {from:start.toISOString().slice(0,10),to:end};
};
const fmt = (value:string) => {
    const num = Number(value);
    return Number.isFinite(num) ? new Intl.NumberFormat('vi-VN',{ maximumFractionDigits:6 }).format(num) : value;
};
const tableCols: {key:keyof AuditRow;label:string;title:string}[] = [
    {key:'branchOnHand',label:'Tồn quầy',title:'Số dư hiện tại tại các quầy được phép xem'},
    {key:'warehouseOnHand',label:'Tồn bếp',title:'Số dư hiện tại tại kho bếp (chỉ ADMIN)'},
    {key:'inTransit',label:'Đang giao',title:'Đã xuất nhưng quầy chưa xác nhận, không cộng vào tồn khả dụng'},
    {key:'dispatched',label:'Xuất tới điểm đã nhận',title:'Lượng dự kiến của các điểm đã nhận trong kỳ'},
    {key:'received',label:'Thực nhận',title:'Lượng thực nhận G4 của các điểm đã xác nhận trong kỳ'},
    {key:'damaged',label:'Hỏng',title:'Lượng hỏng tại lúc nhận, không cộng tồn'},
    {key:'missing',label:'Thiếu',title:'Lượng chưa nhận sau khi loại hàng hỏng'},
    {key:'recovered',label:'Thu hồi G7',title:'Lượng thiếu đã tìm thấy và POSTED'},
    {key:'stillMissing',label:'Còn thiếu',title:'Thiếu trừ thu hồi đã POSTED'},
    {key:'postedWriteOff',label:'Ghi giảm G8',title:'Lượng đã phê duyệt giảm tồn trong kỳ, đã nằm trong số dư hiện tại'},
];
function downloadCsv(snapshot:StockAuditSnapshot, rows:AuditRow[]) {
    const headers = ['SKU','Nguyên liệu','Đơn vị',...tableCols.map(c=>c.label)];
    const csvCell = (raw:string) => {
        const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
        return `"${safe.replaceAll('"','""')}"`;
    };
    const records = [headers,...rows.map(r=>[r.code,r.name,r.unit,...tableCols.map(c=>r[c.key]===null?'':String(r[c.key]))])];
    const payload = '\uFEFF'+records.map(r=>r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([payload],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;
    a.download=`WaveHouse_G9_${snapshot.period.from}_${snapshot.period.to}.csv`;
    document.body.appendChild(a);a.click();a.remove();
    URL.revokeObjectURL(url);
}

export default function StockAuditPage({session}:{session:AuthSession}) {
    const [dates,setDates] = useState(initialDates);
    const [draftFrom,setDraftFrom] = useState(dates.from);
    const [draftTo,setDraftTo] = useState(dates.to);
    const [data,setData] = useState<StockAuditSnapshot|null>(null);
    const [busy,setBusy] = useState(true);
    const [error,setError] = useState('');
    const [search,setSearch] = useState('');
    const [reload,setReload] = useState(0);
    useEffect(()=>{
        let active=true;
        void stockAuditApi.snapshot(session,dates.from,dates.to).then(result=>{
            if(active)setData(result);
        }).catch(err=>{if(active){setData(null);setError(err instanceof Error?err.message:'Không thể đọc báo cáo G9.');}})
            .finally(()=>{if(active)setBusy(false);});
        return ()=>{active=false;};
    },[session,dates.from,dates.to,reload]);
    const visible=useMemo(()=>{
        const needle=search.trim().toLocaleLowerCase('vi-VN');
        return (data?.rows ?? []).filter(r=>!needle || `${r.code} ${r.name} ${r.unit}`.toLocaleLowerCase('vi-VN').includes(needle));
    },[data,search]);
    function applyDates(event:FormEvent<HTMLFormElement>){
        event.preventDefault();
        if(!draftFrom||!draftTo||draftFrom>draftTo){setError('Khoảng ngày không hợp lệ.');return;}
        const span=(Date.parse(draftTo)-Date.parse(draftFrom))/86400000;
        if(span>30){setError('Chọn tối đa 31 ngày.');return;}
        setBusy(true);setError('');setDates({from:draftFrom,to:draftTo});setReload(x=>x+1);
    }
    return <section className="wh-g9">
        <div className="wh-heading"><div><p className="wh-eyebrow">G9 / BÁO CÁO ĐỐI SOÁT</p><h2>Tồn kho toàn chuỗi & luồng giao nhận</h2></div></div>
        <p className="wh-intro">Dữ liệu chỉ đọc, không ghi sổ. ADMIN xem toàn hệ thống; quản lý chỉ xem tồn quầy và giao nhận của khu vực mình phụ trách.</p>
        <form className="wh-g9-filters" onSubmit={applyDates}>
            <label>Từ ngày <input type="date" value={draftFrom} onChange={e=>setDraftFrom(e.target.value)} required/></label>
            <label>Đến ngày <input type="date" value={draftTo} onChange={e=>setDraftTo(e.target.value)} required/></label>
            <button className="wh-primary" type="submit" disabled={busy}>Xem báo cáo</button>
            <button type="button" disabled={busy} onClick={()=>setReload(x=>x+1)}>Tải lại số dư</button>
            {data && <button type="button" onClick={()=>downloadCsv(data,visible)}>Xuất CSV ({visible.length} SKU)</button>}
        </form>
        {error && <p className="wh-error" role="alert">{error}</p>}
        {busy && <p role="status">Đang đọc snapshot dữ liệu…</p>}
        {data && <>
            <p className="wh-g9-asof">Snapshot lúc {new Date(data.asOf).toLocaleString('vi-VN')} · Kỳ giao nhận {data.period.from} → {data.period.to} · {data.scope.branches.length} quầy{data.scope.role==='ADMIN'?` · ${data.scope.warehouses.length} kho bếp`:''}</p>
            <div className="wh-g9-metrics">
                {([
                    ['Điểm giao chờ nhận',data.counts.pendingStops],
                    ['Điểm giao đã nhận trong kỳ',data.counts.receivedStops],
                    ['Hồ sơ chênh lệch còn mở',data.counts.openDiscrepancies],
                    ['Phiếu hao hụt chờ duyệt',data.counts.pendingWriteOffs],
                    ['Kế hoạch chờ duyệt',data.counts.pendingRestockPlans],
                    ['Phiếu giảm tồn đã duyệt trong kỳ',data.counts.postedWriteOffs],
                ] as const).map(([label,value])=><article key={label}><span>{label}</span><strong>{value}</strong></article>)}
            </div>
            <div className="wh-g9-notes"><strong>Cách đọc báo cáo:</strong><ul>{data.notes.map((note,i)=><li key={i}>{note}</li>)}</ul></div>
            <div className="wh-g9-table-head"><h3>Đối chiếu số lượng theo từng SKU</h3><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Lọc mã / tên nguyên liệu" aria-label="Lọc nguyên liệu"/></div>
            <p className="wh-g9-muted">Có {visible.length} SKU phù hợp. Bảng hiển thị tối đa 150 dòng; xuất CSV để lấy đủ.</p>
            <div className="wh-g9-scroll"><table><thead><tr><th>Mã SKU / nguyên liệu</th><th>Đơn vị</th>{tableCols.map(col=><th key={col.key} title={col.title}>{col.label}</th>)}</tr></thead>
                <tbody>{visible.slice(0,150).map(row=><tr key={row.ingredientId}><td><strong>{row.code}</strong><small>{row.name}</small></td><td>{row.unit}</td>
                    {tableCols.map(col=><td key={col.key} className={col.key==='stillMissing'&&row.stillMissing!=='0.000000'?'wh-g9-attention':''}>{row[col.key]===null?'—':fmt(String(row[col.key]))}</td>)}
                </tr>)}{visible.length===0&&<tr><td colSpan={12}>Không có SKU trong phạm vi này.</td></tr>}</tbody></table></div>
            <div className="wh-g9-two">
                <section><h3>Điểm giao đang chờ xác nhận ({data.pendingStops.length})</h3>
                    <div className="wh-g9-list">{data.pendingStops.slice(0,70).map(stop=><p key={stop.id}><strong>{stop.tripCode}</strong> · {stop.branchCode} · {stop.businessDate} · {stop.itemCount} SKU</p>)}
                        {data.pendingStops.length>70&&<p>Còn {data.pendingStops.length-70} điểm. Xem module G4 để xử lý.</p>}
                        {!data.pendingStops.length&&<p>Không có điểm giao tồn đọng.</p>}</div></section>
                <section><h3>Cảnh báo kiểm soát sổ kho</h3>
                    <p className="wh-g9-muted">{data.ledgerIssues.length} sai khác hiển thị{data.counts.ledgerIssuesMore?' (còn thêm chưa hiển thị)':''}; {data.counts.deliveryAnomalyCount} bất thường giao nhận.</p>
                    <div className="wh-g9-list">{data.ledgerIssues.slice(0,70).map((issue,i)=><p key={`${i}-${issue.locationCode}`}><strong>{issue.locationType==='BRANCH'?'Quầy':'Kho'} {issue.locationCode} · {issue.ingredientCode}</strong> — {issue.issue==='NO_MOVEMENT'?'Số dư chưa có bút toán gốc':'Số dư khác bút toán cuối'}: {issue.current} / {issue.ledger??'không có'}</p>)}
                        {data.deliveryAnomalies.slice(0,30).map((a,i)=><p key={`a${i}`}><strong>{a.tripCode} · {a.branchCode} · {a.ingredientCode}</strong> — {a.message}</p>)}
                        {!data.ledgerIssues.length&&!data.deliveryAnomalies.length&&<p>Chưa phát hiện sai khác theo các quy tắc kiểm tra G9.</p>}</div>
                </section>
            </div>
        </>}
    </section>;
}

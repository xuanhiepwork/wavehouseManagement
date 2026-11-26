import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthSession } from '../auth';
import type { SalesShift } from '../sales/sales.api';
import { loadForecast, type ForecastPlan } from '../warehouse/warehouse.api';
import { DashboardApiError, loadDashboardBranches, loadDashboardSummary, type DashboardBranch,
    type DashboardFilters, type DashboardSummary, type StatusCounts } from './dashboard.api';
import { dateIsValid, dateRangeError, defaultDateRange, formatMoney, formatQuantity, revenueBars, shiftName, statusName, timestamp } from './dashboard.logic';
import './AreaDashboard.css';

type NavTarget = 'shift' | 'receiving' | 'sales' | 'reconciliation' | 'planning' | 'inventory';
type Props = { session: AuthSession; onNavigate: (target: NavTarget) => void };
const statuses = ['APPROVED', 'SUBMITTED', 'RETURNED', 'DRAFT'] as const;
const shifts: SalesShift[] = ['MORNING', 'AFTERNOON', 'EVENING'];
const channelName: Record<string, string> = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', MOMO: 'MoMo', GRAB: 'Grab', OTHER: 'Khác' };
const forecastMethodName: Record<string, string> = { MATCHED_DAY_AND_SHIFT: 'Khớp loại ngày và ca', SAME_SHIFT_HEURISTIC: 'Ước tính từ lịch sử cùng ca', MIN_STOCK_ONLY: 'Theo mức tồn tối thiểu' };
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Không tải được dữ liệu.';

function PagedTable<T>({ items, headers, row, empty = 'Chưa có bản ghi phù hợp.' }: {
    items: T[]; headers: string[]; row: (item: T) => ReactNode; empty?: string;
}) {
    const [page, setPage] = useState(1);
    useEffect(() => { setPage(1); }, [items]);
    const pages = Math.max(1, Math.ceil(items.length / 25));
    const currentPage = Math.min(page, pages);
    if (!items.length) return <p className="w6-empty">{empty}</p>;
    return <><div className="w6-table-scroll"><table className="w6-table"><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{items.slice((currentPage - 1) * 25, currentPage * 25).map(row)}</tbody></table></div>
        <div className="w74-pagination"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trước</button>
            <span>Trang {currentPage}/{pages} · {items.length} bản ghi</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Sau</button></div></>;
}
function StatusOverview({ value }: { value: StatusCounts }) {
    return <><div className="w6-status-bar" role="img" aria-label={statuses.map(s => `${statusName(s)} ${value[s]}`).join(', ')}>
        {statuses.map(s => <span key={s} className={`w6-${s.toLowerCase()}`} style={{ width: value.total ? `${value[s] * 100 / value.total}%` : '0%' }} />)}</div>
        <div className="w6-legend">{statuses.map(s => <span key={s}>{statusName(s)}: {value[s]}</span>)}</div>
        <p className="w6-small">Tổng {value.total} bản ghi thực có. Biểu đồ thể hiện cơ cấu trạng thái, không phải tỷ lệ hoàn thành lịch ca.</p></>;
}

function RestockPlanner({ session, branches, branchError, onReloadBranches }: { session: AuthSession; branches: DashboardBranch[];
    branchError: string; onReloadBranches: () => void }) {
    const [businessDate, setBusinessDate] = useState('');
    const [shift, setShift] = useState<SalesShift | ''>('');
    const [source, setSource] = useState('');
    const [destinations, setDestinations] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<{ key: string; plan: ForecastPlan } | null>(null);
    const sequence = useRef(0);
    const locked = useRef(false);
    const alive = useRef(true);
    const key = JSON.stringify({ businessDate, shift, source, destinations });
    const keyRef = useRef(key); keyRef.current = key;
    useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
    const plan = result?.key === key ? result.plan : null;
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (locked.current) return;
        const activeIds = new Set(branches.filter(b => b.isActive).map(b => b.id));
        if (!dateIsValid(businessDate) || !shift || !activeIds.has(source) || destinations.length < 1 || destinations.length > 10
            || destinations.some(id => id === source || !activeIds.has(id))) {
            setError('Chọn ngày, ca, một kho nguồn và 1–10 chi nhánh nhận đang hoạt động, khác kho nguồn.'); return;
        }
        const request = ++sequence.current; const requestKey = key;
        locked.current = true; setLoading(true); setError(''); setResult(null);
        try {
            const next = await loadForecast(session, { businessDate, shift, sourceBranchId: source, destinationBranchIds: [...destinations] });
            if (next.businessDate !== businessDate || next.shift !== shift) throw new Error('B7 trả ngày hoặc ca khác yêu cầu. Vui lòng tải lại.');
            if (alive.current && request === sequence.current && requestKey === keyRef.current) setResult({ key: requestKey, plan: next });
        } catch (cause) { if (alive.current && request === sequence.current) setError(errorText(cause)); }
        finally { locked.current = false; if (alive.current && request === sequence.current) setLoading(false); }
    }
    return <section className="w6-panel" id="w74-restock"><h3>Lập kế hoạch bổ sung B7</h3>
        <p className="w6-small">Dự báo theo quy tắc, dùng lịch sử chênh lệch kiểm kê và hệ số an toàn. Kết quả là ước tính cần kiểm tra, không phải lượng tiêu thụ được xác nhận. Không tự tạo phiếu hoặc điều chỉnh tồn.</p>
        <p className="w6-note">Chọn đầy đủ tham số bên dưới để gọi B7. Ngày/ca lập kế hoạch độc lập với kỳ doanh thu ở đầu trang.</p>
        {branchError && <p className="w6-error" role="alert">{branchError} <button type="button" onClick={onReloadBranches}>Tải lại chi nhánh</button></p>}
        <form onSubmit={event => { void submit(event); }}><fieldset className="w74-fieldset" disabled={loading}>
            <div className="w6-filters"><label>Ngày cần bổ sung<input required type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)} /></label>
                <label>Ca<select required value={shift} onChange={e => setShift(e.target.value as SalesShift | '')}><option value="">Chọn ca</option>{shifts.map(s => <option value={s} key={s}>{shiftName(s)}</option>)}</select></label>
                <label>Kho nguồn<select required value={source} onChange={e => { setSource(e.target.value); setDestinations(v => v.filter(id => id !== e.target.value)); }}><option value="">Chọn kho nguồn</option>{branches.filter(b => b.isActive).map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></label></div>
            <fieldset className="w74-destinations"><legend>Chi nhánh nhận — chọn 1–10</legend>{branches.filter(b => b.isActive && b.id !== source).map(b => <label key={b.id}>
                <input type="checkbox" checked={destinations.includes(b.id)} disabled={!destinations.includes(b.id) && destinations.length >= 10}
                    onChange={e => setDestinations(v => e.target.checked ? [...v, b.id] : v.filter(id => id !== b.id))} />{b.code} — {b.name}</label>)}
                {branches.length === 0 && <p className="w6-small">Chưa có danh sách chi nhánh để lập kế hoạch.</p>}</fieldset>
            <button className="w6-button" type="submit" disabled={loading || branches.length < 2}>{loading ? 'Đang đọc B7…' : 'Tải đề xuất theo tham số đã chọn'}</button>
        </fieldset></form>{error && <p role="alert" className="w6-error">{error}</p>}
        {!plan && !loading && <p className="w6-empty">Chưa có đề xuất cho bộ tham số hiện tại. Không hiển thị dự báo khi chưa gọi B7.</p>}
        {plan && <><p className="w6-source">Ngày {plan.businessDate} · {shiftName(plan.shift)} · Kho {plan.sourceBranch.name} · Lịch sử {plan.historyWindowDays} ngày · Hệ số {plan.safetyMultiplier} · Tải lúc {timestamp(plan.fetchedAt)}</p>
            <PagedTable items={plan.recommendations} headers={['Chi nhánh nhận','Nguyên liệu','Đơn vị','Tồn hiện tại','Ước tính B7','Cần cấp','Đề xuất cấp','Chưa đủ','Số mẫu / phương pháp']}
                empty="B7 chưa trả dòng đề xuất cho bộ tham số đã chọn." row={r => <tr key={`${r.destinationBranchId}:${r.ingredientId}`}><td>{r.destinationBranchName}</td><td>{r.ingredientCode} — {r.ingredientName}</td><td>{r.unit}</td>
                    <td>{formatQuantity(r.onHand)}</td><td>{formatQuantity(r.predictedConsumption)}</td><td>{formatQuantity(r.requestedQuantity)}</td><td>{formatQuantity(r.proposedDeliveryQuantity)}</td><td>{formatQuantity(r.unfulfilledQuantity)}</td><td>{r.historySamples} / {forecastMethodName[r.forecastMethod] ?? 'Phương pháp B7 khác'}</td></tr>} />
            <p className="w6-small">Mỗi dòng giữ đơn vị riêng. Cột “Ước tính B7” là baseline theo quy tắc, có thể gồm hao hụt chưa giải thích trong dữ liệu kiểm kê.</p></>}
    </section>;
}

function ManagementDashboard({ session, onNavigate }: Props) {
    const isAdmin = session.user.role === 'ADMIN';
    const [filters, setFilters] = useState<DashboardFilters>(() => ({ ...defaultDateRange(), branchId: '' }));
    const [branches, setBranches] = useState<DashboardBranch[]>([]);
    const [branchError, setBranchError] = useState('');
    const [branchReload, setBranchReload] = useState(0);
    const [reload, setReload] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<{ message: string; status: number } | null>(null);
    const [result, setResult] = useState<{ key: string; data: DashboardSummary } | null>(null);
    const [inventoryFilter, setInventoryFilter] = useState('ALL');
    const [inventorySearch, setInventorySearch] = useState('');
    const sequence = useRef(0);
    const requestKey = JSON.stringify(filters);
    const rangeError = dateRangeError(filters.from, filters.to);
    const data = !rangeError && result?.key === requestKey ? result.data : null;
    useEffect(() => {
        const controller = new AbortController(); let active = true;
        setBranchError('');
        void loadDashboardBranches(session, controller.signal).then(rows => { if (active) setBranches(rows); })
            .catch(cause => { if (active) setBranchError(errorText(cause)); });
        return () => { active = false; controller.abort(); };
    }, [session, branchReload]);
    useEffect(() => {
        const request = ++sequence.current;
        const controller = new AbortController();
        setResult(null); setError(null);
        if (rangeError) { setLoading(false); return () => controller.abort(); }
        setLoading(true);
        const timeout = window.setTimeout(() => controller.abort(), 40000);
        let active = true;
        void loadDashboardSummary(session, filters, controller.signal).then(next => {
            if (active && request === sequence.current) setResult({ key: requestKey, data: next });
        }).catch(cause => {
            if (active && request === sequence.current) setError({ message: cause instanceof DashboardApiError ? cause.message : 'Không kết nối được máy chủ hoặc yêu cầu đã hết thời gian. Hãy thử tải lại.',
                status: cause instanceof DashboardApiError ? cause.status : 0 });
        }).finally(() => { window.clearTimeout(timeout); if (active && request === sequence.current) setLoading(false); });
        return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
    }, [session, requestKey, reload, rangeError]);
    const branchMap = useMemo(() => new Map(data?.scope.branches.map(b => [b.id, `${b.code} — ${b.name}`]) ?? []), [data]);
    const branchName = (id: string) => branchMap.get(id) ?? id;
    const inventoryRows = useMemo(() => data?.inventorySummary.rows.filter(r => {
        const matches = !inventorySearch || `${r.code} ${r.name}`.toLocaleLowerCase('vi-VN').includes(inventorySearch.toLocaleLowerCase('vi-VN'));
        return matches && (inventoryFilter === 'ALL' || (inventoryFilter === 'MISSING' && r.quantity === null)
            || (inventoryFilter === 'ZERO' && r.zeroStock) || (inventoryFilter === 'LOW' && r.belowMinimum) || (inventoryFilter === 'NEGATIVE' && r.negativeStock));
    }) ?? [], [data, inventoryFilter, inventorySearch]);
    const bars = useMemo(() => revenueBars(data?.salesSeries.map(row => ({ date: row.date, approvedReports: row.approvedReports, netExpected: row.totals?.netExpected ?? null })) ?? []), [data]);
    const kpis = data?.kpis;
    const cards = [
        ['Doanh thu kỳ vọng đã duyệt', formatMoney(kpis?.netExpected)], ['Doanh thu gộp', formatMoney(kpis?.grossSales)],
        ['Thu ròng ghi nhận', formatMoney(kpis?.netRecorded)], ['Số đồ uống đã bán', formatQuantity(kpis?.beveragesSold)],
    ];
    return <section className="w6-root w74-root" aria-label="Dashboard quản lý">
        <div className="w6-head"><div><p className="w6-eyebrow">WAVEHOUSE / TỔNG QUAN</p><h2>{isAdmin ? 'Dashboard toàn hệ thống' : 'Dashboard khu vực'}</h2>
            <p>Doanh thu chính thức từ báo cáo đã duyệt; theo dõi kiểm kê, nhận hàng và tồn nguyên liệu từ server.</p>
            {isAdmin && <a className="w74-planning-link" href="#w74-restock">Lập kế hoạch bổ sung B7 ↓</a>}</div><span className="w6-mode">{isAdmin ? 'TOÀN HỆ THỐNG / CHI NHÁNH' : 'CÁC QUẦY THUỘC KHU VỰC'}</span></div>
        <div className="w6-panel w6-filters"><label>Quầy<select value={filters.branchId} onChange={e => setFilters(v => ({ ...v, branchId: e.target.value }))}>
            <option value="">{isAdmin ? 'Tất cả chi nhánh' : 'Tất cả quầy trong khu vực'}</option>
            {filters.branchId && !branches.some(b => b.id === filters.branchId) && <option value={filters.branchId}>{filters.branchId}</option>}
            {branches.map(b => <option value={b.id} key={b.id}>{b.code} — {b.name}{b.isActive ? '' : ' (ngừng hoạt động)'}</option>)}
        </select></label>
            <label>Từ ngày<input type="date" value={filters.from} onChange={e => setFilters(v => ({ ...v, from: e.target.value }))} /></label>
            <label>Đến ngày<input type="date" value={filters.to} onChange={e => setFilters(v => ({ ...v, to: e.target.value }))} /></label>
            <button type="button" className="w6-button" disabled={loading || !!rangeError} onClick={() => setReload(v => v + 1)}>Làm mới</button></div>
        {rangeError && <p role="alert" className="w6-error">{rangeError}</p>}{branchError && <p role="alert" className="w6-error">Danh mục chi nhánh: {branchError} <button type="button" onClick={() => setBranchReload(v => v + 1)}>Thử lại</button></p>}
        {loading && <p className="w6-note" role="status">Đang đọc dữ liệu dashboard từ server…</p>}
        {error && <div className="w6-error" role="alert"><strong>{error.status === 403 ? 'Không có quyền truy cập. ' : ''}</strong>{error.message}<button type="button" onClick={() => setReload(v => v + 1)}>Thử tải lại</button></div>}
        {data && <>
            <p className="w6-source">Phạm vi server: {data.scope.mode === 'ALL_BRANCHES' ? `${data.scope.branches.length} chi nhánh` : data.scope.branches[0]?.name ?? 'Chi nhánh'} · {data.scope.from} → {data.scope.to} · Cập nhật {timestamp(data.asOf)} (giờ Việt Nam)</p>
            <div className="w6-note"><ul>{data.warnings.map(w => <li key={w.code}>{w.message}</li>)}</ul></div>
            {!kpis && <p className="w6-empty">Chưa có báo cáo đã duyệt trong kỳ. KPI tài chính chưa xác định; đây không phải kết luận doanh thu bằng 0. Báo cáo nháp, chờ duyệt và trả sửa không được cộng vào doanh thu.</p>}
            <div className="w6-kpis">{cards.map(([label, value]) => <article className="w6-kpi" key={label}><span>{label}</span><strong>{value}</strong><small>{data.coverage.statuses.APPROVED} báo cáo đã duyệt trong kỳ</small></article>)}</div>
            <div className="w6-grid"><section className="w6-panel"><div className="w6-panel-head"><h3>Độ phủ báo cáo doanh thu</h3><button type="button" onClick={() => onNavigate('sales')}>Mở báo cáo →</button></div><StatusOverview value={data.coverage.statuses} />
                <p className="w6-small">Có báo cáo tại {data.coverage.representedBranchIds.length}/{data.scope.branches.length} chi nhánh trong phạm vi; {data.coverage.approvedBranchIds.length} chi nhánh có báo cáo đã duyệt.</p>
                <p className="w6-small">Ngày có báo cáo: {data.coverage.coveredDates.length ? data.coverage.coveredDates.join(', ') : 'Chưa có'}. Ca có báo cáo: {data.coverage.coveredShifts.length ? data.coverage.coveredShifts.map(shiftName).join(', ') : 'Chưa có'}.</p>
                <details><summary>Xem ngày và ca thực có báo cáo</summary><PagedTable items={data.coverage.reportedSlots} headers={['Ngày','Chi nhánh','Ca','Trạng thái']} row={r => <tr key={r.reportId}><td>{r.businessDate}</td><td>{branchName(r.branchId)}</td><td>{shiftName(r.shift)}</td><td>{statusName(r.status)}</td></tr>} /></details></section>
                <section className="w6-panel"><div className="w6-panel-head"><h3>Đối soát báo cáo đã duyệt</h3><button type="button" onClick={() => onNavigate('reconciliation')}>Mở đối soát →</button></div><div className="w6-finance-list">
                    {([['Giảm giá',kpis?.discounts], ['Hoàn tiền theo kênh',kpis?.recognizedRefunds], ['Chênh lệch doanh thu',kpis?.salesDifference], ['Chênh lệch tiền mặt',kpis?.cashDifference]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatMoney(value)}</strong></div>)}</div>
                    <p className="w6-small">{kpis ? `${kpis.salesDiscrepancyReports} báo cáo có chênh lệch doanh thu; ${kpis.cashDiscrepancyReports} báo cáo có chênh lệch tiền mặt. Tổng có thể bù trừ giữa báo cáo.` : 'Chưa có dữ liệu tài chính đã duyệt.'} Chênh lệch cần đối chiếu chứng từ, không phải kết luận sai phạm.</p></section></div>
            <section className="w6-panel"><h3>Xu hướng doanh thu kỳ vọng theo ngày</h3><p className="w6-small">Mỗi cột chỉ gồm báo cáo đã duyệt của ngày đó. Ngày thiếu dữ liệu không được nối hoặc quy đổi thành doanh thu 0.</p>
                <div className="w74-trend" role="list" aria-label="Doanh thu kỳ vọng theo ngày">{bars.map(row => <div className={`w74-trend-row ${row.width === null ? 'is-missing' : ''}`} key={row.date} role="listitem">
                    <span>{row.date}</span><div className="w74-trend-track" aria-hidden="true">{row.width !== null && <span className={row.negative ? 'is-negative' : ''} style={{ width: `${row.width}%` }} />}</div>
                    <strong>{row.width === null ? 'Chưa có bản duyệt' : formatMoney(row.netExpected)}</strong><small>{row.approvedReports} báo cáo</small></div>)}</div></section>
            {isAdmin && <section className="w6-panel"><h3>So sánh chi nhánh trong kỳ</h3><PagedTable items={data.branchSummaries}
                headers={['Chi nhánh','Đã duyệt / tổng báo cáo','Doanh thu kỳ vọng','Thu ròng','Chênh lệch doanh thu','Chênh lệch tiền mặt','Số ly','Cập nhật báo cáo']}
                row={r => <tr key={r.branch.id}><td>{r.branch.code} — {r.branch.name}{!r.branch.isActive && ' (ngừng hoạt động)'}</td><td>{r.coverage.APPROVED} / {r.coverage.total}</td><td>{formatMoney(r.kpis?.netExpected)}</td><td>{formatMoney(r.kpis?.netRecorded)}</td><td>{formatMoney(r.kpis?.salesDifference)}</td><td>{formatMoney(r.kpis?.cashDifference)}</td><td>{formatQuantity(r.kpis?.beveragesSold)}</td><td>{timestamp(r.latestSalesUpdate)}</td></tr>} />
                <p className="w6-small">Dấu “—” là chưa có báo cáo đã duyệt của chi nhánh. Số báo cáo khác nhau không chứng minh mức độ hoàn thành hay hiệu suất tương đương.</p></section>}
            <div className="w6-grid"><section className="w6-panel"><h3>Doanh thu theo ca</h3><PagedTable items={data.salesByShift} headers={['Ca','Báo cáo đã duyệt','Doanh thu kỳ vọng','Số ly']}
                row={r => <tr key={r.shift}><td>{shiftName(r.shift)}</td><td>{r.totals?.approvedReports ?? 0}</td><td>{formatMoney(r.totals?.netExpected)}</td><td>{formatQuantity(r.totals?.beveragesSold)}</td></tr>} /></section>
                <section className="w6-panel"><h3>Thu / hoàn theo kênh</h3><PagedTable items={data.paymentChannels} headers={['Kênh','Đã thu','Đã hoàn','Thu ròng','Phí nền tảng','Chênh lệch thanh toán']}
                    empty="Chưa có báo cáo đã duyệt để tổng hợp kênh thanh toán." row={r => <tr key={r.channel}><td>{channelName[r.channel]}</td><td>{formatMoney(r.collectedAmount)}</td><td>{formatMoney(r.refundedAmount)}</td><td>{formatMoney(r.netRecorded)}</td><td>{formatMoney(r.platformFee)}</td><td>{formatMoney(r.settlementDifference)}</td></tr>} />
                    <p className="w6-small">Phí và chênh lệch thanh toán được theo dõi riêng, không tự giảm doanh thu hay được gán thành doanh thu thiếu.</p></section></div>
            <section className="w6-panel"><div className="w6-panel-head"><h3>Kiểm kê B6 theo kỳ</h3><button type="button" onClick={() => onNavigate('shift')}>Mở kiểm kê →</button></div>
                <StatusOverview value={data.stockCountSummary.period} /><p className="w6-source">Cập nhật hồ sơ liên quan: {timestamp(data.stockCountSummary.latestUpdatedAt)}</p>
                <PagedTable items={data.stockCountSummary.items} headers={['Ngày','Chi nhánh','Ca','Trạng thái','Cập nhật']} row={r => <tr key={r.id}><td>{r.businessDate}</td><td>{branchName(r.branchId)}</td><td>{shiftName(r.shift)}</td><td>{statusName(r.status)}</td><td>{timestamp(r.updatedAt)}</td></tr>} />
                <details><summary>Hồ sơ kiểm kê hiện chưa hoàn tất, gồm ngoài kỳ ({data.stockCountSummary.currentUnresolved.length})</summary><p className="w6-source">Trạng thái tại {timestamp(data.asOf)}, không phải hồ sơ còn mở tại ngày cuối kỳ quá khứ.</p><PagedTable items={data.stockCountSummary.currentUnresolved} headers={['Ngày','Chi nhánh','Ca','Trạng thái']}
                    row={r => <tr key={r.id}><td>{r.businessDate}</td><td>{branchName(r.branchId)}</td><td>{shiftName(r.shift)}</td><td>{statusName(r.status)}</td></tr>} /></details>
                <p className="w6-note">B6 đối chiếu lượng đếm với số dư sổ để tạo điều chỉnh kiểm kê khi duyệt. Chênh lệch âm không được xem là tiêu thụ nguyên liệu thực tế. Chưa có lịch ca để xác định phiếu bắt buộc còn thiếu.</p></section>
            <section className="w6-panel"><div className="w6-panel-head"><h3>Nhận hàng W7.2</h3><button type="button" onClick={() => onNavigate('receiving')}>Mở nhận hàng →</button></div>
                <p className="w6-source">Các trạng thái theo nhóm phiếu chuyển ghi sổ trong kỳ; hai chỉ tiêu “xác nhận trong kỳ” theo ngày xác nhận biên bản. Đều dùng giờ Việt Nam. Trạng thái lấy tại {timestamp(data.asOf)}. Cập nhật gần nhất: {timestamp(data.receivingSummary.latestUpdatedAt)}.</p>
                <div className="w6-balance-stats">{([['Phiếu chuyển đã ghi sổ trong kỳ',data.receivingSummary.period.postedTransfers], ['Biên bản đã xác nhận',data.receivingSummary.period.confirmed],
                    ['Biên bản nháp',data.receivingSummary.period.draft], ['Chưa lập biên bản',data.receivingSummary.period.awaiting], ['Biên bản xác nhận có chênh lệch',data.receivingSummary.period.discrepancyReceipts],
                    ['Biên bản nháp có chênh lệch',data.receivingSummary.period.draftDiscrepancyReceipts],
                    ['Biên bản xác nhận trong kỳ (ngày xác nhận)',data.receivingSummary.period.confirmedDuringPeriod],
                    ['Xác nhận trong kỳ có chênh lệch',data.receivingSummary.period.confirmedDuringPeriodWithDiscrepancy]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
                <h4>Phiếu chuyển hiện chưa xác nhận — tất cả ngày</h4><p className="w6-small">{data.receivingSummary.backlog.postedTransfers} phiếu chưa xác nhận, trong đó {data.receivingSummary.backlog.legacyUnresolved} phiếu lịch sử cần xử lý. Đây là trạng thái hiện tại, không giới hạn bởi bộ lọc ngày.</p>
                <PagedTable items={data.receivingSummary.backlog.items} headers={['Mã phiếu','Chi nhánh nhận','Ngày ghi sổ','Trạng thái','Lịch sử','Dòng chênh lệch nháp']}
                    empty="Không có phiếu chuyển đã ghi sổ đang chờ xác nhận trong phạm vi." row={r => <tr key={r.stockDocumentId}><td>{r.code}</td><td>{branchName(r.branchId)}</td><td>{r.postedAt ? timestamp(r.postedAt) : 'Thiếu ngày ghi sổ — cần kiểm tra'}</td><td>{statusName(r.status)}</td><td>{r.legacyReceivingRequired ? 'Cần xử lý lịch sử' : '—'}</td><td>{r.discrepancyLines}</td></tr>} />
                {data.receivingSummary.backlog.undatedTransfers > 0 && <p className="w6-error">{data.receivingSummary.backlog.undatedTransfers} phiếu chưa xác nhận bị thiếu ngày ghi sổ; không xếp vào thống kê phiếu chuyển theo kỳ.</p>}
                <h4>Chênh lệch / hư hỏng đã ghi nhận</h4><PagedTable items={data.receivingSummary.discrepancies} headers={['Chi nhánh','Nguyên liệu','Đơn vị','Trạng thái','Phạm vi','Theo phiếu','Thực nhận','Hư hỏng','Usable','Thiếu','Thừa']}
                    empty="Không có dòng chênh lệch trong biên bản của kỳ hoặc hồ sơ nháp đang chờ xử lý." row={r => <tr key={`${r.receiptId}:${r.ingredientId}`}><td>{branchName(r.branchId)}</td><td>{r.code} — {r.name}</td><td>{r.unit}</td><td>{statusName(r.receiptStatus)}</td><td>{r.inSelectedPeriod ? 'Ghi sổ trong kỳ' : r.confirmedInSelectedPeriod ? 'Xác nhận trong kỳ' : r.receiptStatus === 'DRAFT' ? 'Nháp ngoài kỳ' : 'Không xác định kỳ'}</td>
                        <td>{formatQuantity(r.plannedQuantity)}</td><td>{formatQuantity(r.receivedQuantity)}</td><td>{formatQuantity(r.damagedQuantity)}</td><td>{formatQuantity(r.usableQuantity)}</td><td>{formatQuantity(r.shortageQuantity)}</td><td>{formatQuantity(r.overageQuantity)}</td></tr>} />
                <h4>Lượng hư hỏng từ biên bản xác nhận trong kỳ (theo ngày xác nhận)</h4><PagedTable items={data.receivingSummary.period.confirmedDamage} headers={['Nguyên liệu','Đơn vị','Lượng hư hỏng']}
                    empty="Chưa ghi nhận lượng hư hỏng dương ở biên bản đã xác nhận của kỳ." row={r => <tr key={`${r.ingredientId}:${r.unit}`}><td>{r.code} — {r.name}</td><td>{r.unit}</td><td>{formatQuantity(r.damagedQuantity)}</td></tr>} />
                <p className="w6-note">Phiếu chuyển POSTED đã ghi sổ kho, không chứng minh hàng đã nhận thực tế. Biên bản nhận, hàng hư/thiếu và điều chỉnh kiểm kê B6 là các dữ liệu riêng. Dashboard không tự bù thiếu, đánh dấu đã nhận hoặc sửa tồn.</p></section>
            <section className="w6-panel"><h3>Tồn nguyên liệu hiện tại</h3><p className="w6-source">Tại {timestamp(data.inventorySummary.asOf)} · Lần cập nhật số dư gần nhất: {timestamp(data.inventorySummary.latestUpdatedAt)}. Không phải tồn cuối kỳ đã chọn.</p>
                <div className="w6-balance-stats">{([['Bản ghi có số dư',data.inventorySummary.availableBalances], ['Cặp nguyên liệu chưa có số dư',data.inventorySummary.missingBalances],
                    ['Tồn bằng 0',data.inventorySummary.zeroStock], ['Dưới tối thiểu',data.inventorySummary.belowMinimum], ['Tồn âm',data.inventorySummary.negativeStock]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
                <div className="w6-filters"><label>Lọc cảnh báo<select value={inventoryFilter} onChange={e => setInventoryFilter(e.target.value)}><option value="ALL">Tất cả bản ghi</option><option value="MISSING">Chưa có số dư</option><option value="ZERO">Tồn bằng 0</option><option value="LOW">Dưới tối thiểu</option><option value="NEGATIVE">Tồn âm</option></select></label>
                    <label>Tìm nguyên liệu<input value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} placeholder="Mã hoặc tên nguyên liệu" /></label></div>
                <PagedTable items={inventoryRows} headers={['Chi nhánh','Nguyên liệu','Đơn vị','Số dư','Mức tối thiểu','Tình trạng','Cập nhật']} row={r => <tr key={`${r.branchId}:${r.ingredientId}`}><td>{branchName(r.branchId)}</td><td>{r.code} — {r.name}{!r.isActive && ' (ngừng hoạt động)'}</td><td>{r.unit}</td><td>{r.quantity === null ? 'Chưa có bản ghi' : formatQuantity(r.quantity)}</td><td>{formatQuantity(r.minStock)}</td>
                    <td>{r.quantity === null ? 'Chưa xác định' : r.negativeStock ? 'Tồn âm' : [r.zeroStock && 'Bằng 0', r.belowMinimum && 'Dưới tối thiểu'].filter(Boolean).join(' / ') || 'Đạt mức cấu hình'}</td><td>{timestamp(r.updatedAt)}</td></tr>} />
                <p className="w6-small">Cảnh báo bằng 0 và dưới tối thiểu có thể trùng một bản ghi. Mỗi nguyên liệu giữ đúng đơn vị Catalog; không cộng gram, ml và piece thành tổng chung. Thiếu bản ghi không đồng nghĩa tồn bằng 0.</p></section>
            <section className="w6-panel"><h3>Các hồ sơ / chỉ dấu cần xem</h3><p className="w6-small">{data.exceptions.total} mục; {data.exceptions.truncated ? `hiển thị tối đa ${data.exceptions.limit} mục đầu. Xem các bảng đầy đủ bên trên hoặc thu hẹp phạm vi.` : 'đã hiển thị toàn bộ.'}</p>
                <PagedTable items={data.exceptions.items} headers={['Chi nhánh','Nội dung','Mã tham chiếu','Thao tác']} empty="Chưa có chỉ dấu cần xem theo dữ liệu đang có." row={r => <tr key={`${r.kind}:${r.branchId}:${r.referenceId}`}><td>{branchName(r.branchId)}</td><td className="w74-wrap">{r.message}</td><td>{r.referenceId}</td><td><button type="button" onClick={() => onNavigate(r.target)}>Mở khu vực</button></td></tr>} /></section>
        </>}
        {isAdmin ? <RestockPlanner key={session.user.id} session={session} branches={branches} branchError={branchError} onReloadBranches={() => setBranchReload(v => v + 1)} />
            : <p className="w6-note">Lập kế hoạch phân bổ B7 chỉ dành cho ADMIN. Quản lý chi nhánh dùng cảnh báo tồn/nhận hàng để phối hợp bổ sung.</p>}
    </section>;
}

export default function AreaDashboard(props: Props) {
    if (props.session.user.role === 'STAFF' ||
        (props.session.user.role === 'BRANCH_MANAGER' && !props.session.user.areaId)) {
        return <p className="wh-error" role="alert">Tài khoản không có quyền xem dashboard quản lý hoặc chưa được phân công khu vực.</p>;
    }
    return <ManagementDashboard key={`${props.session.user.id}:${props.session.user.areaId ?? ''}`} {...props} />;
}

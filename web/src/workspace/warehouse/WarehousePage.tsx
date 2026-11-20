import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AuthSession } from '../auth';
import {
    displayQuantity, isUuid, loadBalances, loadBranches, loadForecast,
    validBusinessDate, type BalanceResult, type Branch, type ForecastPlan, type WorkShift,
} from './warehouse.api';
import { buildDispatchDraft, lineId, validateDispatchQuantity } from './delivery-draft';
import './WarehousePage.css';

type Props = {
    session: AuthSession;
    mode: 'inventory' | 'planning' | 'delivery';
    plan: ForecastPlan | null;
    onPlanChange: (value: ForecastPlan | null) => void;
};
const SHIFTS: { value: WorkShift; label: string }[] = [
    { value: 'MORNING', label: 'Ca sáng' },
    { value: 'AFTERNOON', label: 'Ca chiều' },
    { value: 'EVENING', label: 'Ca tối' },
];
const DAY_TYPE: Record<string, string> = { WEEKDAY: 'Ngày thường', WEEKEND: 'Cuối tuần', HOLIDAY: 'Ngày lễ' };
function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : 'Không thể hoàn tất thao tác.';
}
function vnDateTomorrow(): string {
    const date = new Date(Date.now() + 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function downloadJson(value: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([value], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function WarehousePage({ session, mode, plan, onPlanChange }: Props) {
    const isAdmin = session.user.role === 'ADMIN';
    const canSeeInventory = isAdmin || session.user.role === 'BRANCH_MANAGER';
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState(session.user.branchId ?? '');
    const [balances, setBalances] = useState<BalanceResult | null>(null);
    const [sourceBranchId, setSourceBranchId] = useState(plan?.sourceBranch.id ?? '');
    const [destinations, setDestinations] = useState<string[]>(plan?.destinationBranchIds ?? []);
    const [businessDate, setBusinessDate] = useState(plan?.businessDate ?? vnDateTomorrow());
    const [shift, setShift] = useState<WorkShift>(plan?.shift ?? 'MORNING');
    const [busy, setBusy] = useState(false);
    const [loadingBranches, setLoadingBranches] = useState(isAdmin);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [search, setSearch] = useState('');
    const [quantities, setQuantities] = useState<Record<string, string>>({});
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [deliveryTime, setDeliveryTime] = useState('06:30');
    const [assignedTo, setAssignedTo] = useState('');
    const [dispatchNote, setDispatchNote] = useState('');

    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        void loadBranches(session).then(items => {
            if (!active) return;
            setBranches(items);
            setBranchId(previous => previous || items[0]?.id || '');
            setSourceBranchId(previous => previous || items[0]?.id || '');
        }).catch(cause => { if (active) setError(errorMessage(cause)); })
            .finally(() => { if (active) setLoadingBranches(false); });
        return () => { active = false; };
    }, [session, isAdmin]);

    const filteredBalances = useMemo(() => {
        const term = search.toLocaleLowerCase('vi-VN').trim();
        return balances?.items.filter(row => !term || `${row.name} ${row.code} ${row.ingredientId}`.toLocaleLowerCase('vi-VN').includes(term)) ?? [];
    }, [balances, search]);

    const selectedInputMatchesPlan = plan !== null && plan.sourceBranch.id === sourceBranchId &&
        plan.businessDate === businessDate && plan.shift === shift &&
        [...plan.destinationBranchIds].sort().join(',') === [...destinations].sort().join(',');

    async function refreshInventory(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!isUuid(branchId)) { setError('Vui lòng chọn chi nhánh hợp lệ.'); return; }
        setBusy(true); setError(''); setNotice(''); setBalances(null);
        try {
            setBalances(await loadBalances(session, branchId));
            setNotice('Đã tải dữ liệu số dư từ API B3. Chỉ đọc, không điều chỉnh tồn.');
        } catch (cause) { setError(errorMessage(cause)); }
        finally { setBusy(false); }
    }
    function toggleDestination(id: string) {
        setDestinations(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
        setNotice('');
    }
    async function requestForecast(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!isAdmin) return;
        if (destinations.length < 1 || destinations.length > 10 || destinations.includes(sourceBranchId)) {
            setError('Chọn 1–10 điểm nhận khác kho nguồn.'); return;
        }
        if (!validBusinessDate(businessDate)) { setError('Ngày dự báo không hợp lệ.'); return; }
        setBusy(true); setError(''); setNotice('');
        try {
            const response = await loadForecast(session, { sourceBranchId, destinationBranchIds: destinations, businessDate, shift });
            onPlanChange(response);
            setQuantities({}); setSelected({});
            setNotice('Đã tải đề xuất B7. Đây là kế hoạch tham khảo, chưa tạo phiếu chuyển kho.');
        } catch (cause) { setError(errorMessage(cause)); }
        finally { setBusy(false); }
    }
    function exportDispatch() {
        if (!plan) return;
        setError(''); setNotice('');
        try {
            const json = buildDispatchDraft(plan, quantities, selected, {
                deliveryTime, assignedTo, note: dispatchNote,
            });
            downloadJson(json, `wavehouse-W5-NHAP-${plan.businessDate}-${plan.shift}.json`);
            setNotice('Đã xuất biên bản nháp ra máy. Không tạo chứng từ B5, không đổi số dư Aiven.');
        } catch (cause) { setError(errorMessage(cause)); }
    }
    if (!canSeeInventory) return <div className="w5-alert" role="alert">Tài khoản không có quyền vào nghiệp vụ kho W5.</div>;
    if ((mode === 'delivery' || mode === 'planning') && !isAdmin) {
        return <div className="w5-alert" role="alert">Chỉ ADMIN có thể lập kế hoạch giao nguyên liệu giữa các chi nhánh.</div>;
    }

    return (
        <section className="w5-root" aria-label="Vận hành kho WaveHouse">
            <div className="w5-heading">
                <div>
                    <p className="w5-eyebrow">WAVEHOUSE / W5 / {mode === 'inventory' ? 'TỒN KHO' : mode === 'planning' ? 'DỰ BÁO' : 'ĐIỀU PHỐI'}</p>
                    <h2>{mode === 'inventory' ? 'Kho & tồn nguyên liệu' : mode === 'planning' ? 'Đề xuất bổ sung cho ca tới' : 'Chuẩn bị & phân chia hàng giao'}</h2>
                    <p>{mode === 'inventory' ? 'Xem số dư theo chi nhánh từ Backend B3.' : mode === 'planning' ? 'Xem nhu cầu dự báo theo điểm bán, ca và loại ngày từ B7.' : 'Từ kế hoạch B7, lập danh sách giao dự kiến để đối chiếu và bàn giao.'}</p>
                </div>
                <span className="w5-badge">{mode === 'delivery' ? 'BẢN NHÁP CHƯA GHI DB' : 'CHỈ ĐỌC API'}</span>
            </div>
            <div className="w5-alert" role="note">
                {mode === 'inventory' ? (
                    <>Số dư được lấy tại thời điểm tải trang, có thể thay đổi bởi giao dịch kho. Nếu API phân trang, màn hình phải cảnh báo thay vì coi kết quả là toàn bộ kho.</>
                ) : mode === 'planning' ? (
                    <>Dự báo B7 sử dụng dữ liệu kiểm kê; sai lệch kiểm kê chưa đồng nghĩa với tiêu thụ bán hàng. Lượng đề xuất cần được kho xác minh trước khi lập chứng từ B5.</>
                ) : (
                    <>W5 <strong>không tự POST phiếu chuyển kho và không tự trừ tồn</strong>. File JSON chỉ là phiếu chuẩn bị nội bộ, chưa được ký giao, ký nhận hoặc đồng bộ hệ thống.</>
                )}
            </div>
            {error && <div className="w5-error" role="alert">{error}</div>}
            {notice && <div className="w5-success" role="status">{notice}</div>}

            {mode === 'inventory' && (
                <>
                    <form className="w5-panel w5-controls" onSubmit={event => { void refreshInventory(event); }}>
                        <label>Chi nhánh kiểm tra
                            {isAdmin ? (
                                <select value={branchId} onChange={event => { setBranchId(event.target.value); setBalances(null); setSearch(''); }} disabled={busy || loadingBranches}>
                                    <option value="">Chọn chi nhánh</option>
                                    {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
                                </select>
                            ) : <input value={branchId} readOnly aria-label="Chi nhánh được phân quyền" />}
                        </label>
                        <button type="submit" className="w5-primary" disabled={busy || !isUuid(branchId)}>{busy ? 'Đang tải…' : 'Lấy tồn kho từ B3'}</button>
                    </form>
                    {balances && (
                        <div className="w5-panel">
                            <div className="w5-panel-title"><h3>Số dư nguyên liệu</h3><span>{balances.items.length} dòng đã tải</span></div>
                            {balances.paginationWarning && <p className="w5-caution" role="note">{balances.paginationWarning}</p>}
                            <label className="w5-search">Lọc theo mã hoặc tên nguyên liệu
                                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Nhập từ khóa…" />
                            </label>
                            <div className="w5-table-wrap"><table className="w5-table"><thead><tr><th>Mã</th><th>Nguyên liệu</th><th>Đơn vị</th><th>Tồn hệ thống</th></tr></thead>
                                <tbody>{filteredBalances.map(row => <tr key={`${row.branchId}:${row.ingredientId}`}><td>{row.code || '—'}</td><td>{row.name}</td><td>{row.unit}</td><td className="w5-number">{displayQuantity(row.quantity)}</td></tr>)}</tbody></table></div>
                            {filteredBalances.length === 0 && <p className="w5-empty">Không có dòng phù hợp trong dữ liệu vừa tải.</p>}
                        </div>
                    )}
                </>
            )}

            {mode === 'planning' && (
                <>
                    <form className="w5-panel" onSubmit={event => { void requestForecast(event); }}>
                        <h3>Thông số lập kế hoạch</h3>
                        <div className="w5-controls">
                            <label>Kho/chi nhánh nguồn
                                <select required value={sourceBranchId} disabled={busy || loadingBranches} onChange={event => { setSourceBranchId(event.target.value); setNotice(''); }}>
                                    <option value="">Chọn nguồn xuất hàng</option>
                                    {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
                                </select>
                            </label>
                            <label>Ngày cần hàng
                                <input type="date" required value={businessDate} onChange={event => { setBusinessDate(event.target.value); setNotice(''); }} />
                            </label>
                            <label>Ca cần hàng
                                <select value={shift} onChange={event => { setShift(event.target.value as WorkShift); setNotice(''); }}>
                                    {SHIFTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                </select>
                            </label>
                        </div>
                        <fieldset className="w5-destinations">
                            <legend>Chi nhánh nhận hàng (tối đa 10)</legend>
                            <div className="w5-destination-grid">
                                {branches.filter(branch => branch.id !== sourceBranchId).map(branch => (
                                    <label key={branch.id} className="w5-check">
                                        <input type="checkbox" checked={destinations.includes(branch.id)} disabled={busy || (!destinations.includes(branch.id) && destinations.length >= 10)} onChange={() => toggleDestination(branch.id)} />
                                        <span>{branch.code} — {branch.name}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                        <button className="w5-primary" type="submit" disabled={busy || loadingBranches}>{busy ? 'Đang tính…' : 'Tải đề xuất từ B7'}</button>
                    </form>
                    {plan && selectedInputMatchesPlan && (
                        <div className="w5-panel">
                            <div className="w5-panel-title"><h3>Dự báo ngày {plan.businessDate}</h3><span>{DAY_TYPE[plan.dayType]} · {SHIFTS.find(item => item.value === plan.shift)?.label}</span></div>
                            <p className="w5-muted">Nguồn: {plan.sourceBranch.code} — {plan.sourceBranch.name}. Lịch sử: {plan.historyWindowDays} ngày. Hệ số dự phòng: {plan.safetyMultiplier}. Cập nhật lúc {new Date(plan.fetchedAt).toLocaleString('vi-VN')}.</p>
                            <div className="w5-table-wrap"><table className="w5-table"><thead><tr><th>Chi nhánh nhận</th><th>Nguyên liệu</th><th>Tồn điểm nhận</th><th>Nhu cầu dự báo</th><th>Cần bổ sung</th><th>Kho có thể cấp</th><th>Còn thiếu</th><th>Mẫu</th></tr></thead>
                                <tbody>{plan.recommendations.map(row => <tr key={lineId(row)}>
                                    <td>{row.destinationBranchCode || row.destinationBranchName}</td><td>{row.ingredientCode ? `${row.ingredientCode} — ` : ''}{row.ingredientName} <small>({row.unit})</small></td>
                                    <td className="w5-number">{displayQuantity(row.onHand)}</td><td className="w5-number">{displayQuantity(row.predictedConsumption)}</td>
                                    <td className="w5-number">{displayQuantity(row.requestedQuantity)}</td><td className="w5-number w5-strong">{displayQuantity(row.proposedDeliveryQuantity)}</td>
                                    <td className="w5-number">{displayQuantity(row.unfulfilledQuantity)}</td><td title={row.forecastMethod}>{row.historySamples}{row.forecastMethod !== 'MATCHED_DAY_AND_SHIFT' ? ' ⚠' : ''}</td>
                                </tr>)}</tbody></table></div>
                            {plan.recommendations.length === 0 && <p className="w5-empty">B7 không đề xuất bổ sung cho các chi nhánh này.</p>}
                            <p className="w5-caution">⚠ Số mẫu ít hoặc dùng MIN_STOCK_ONLY là ước tính, không phải nhu cầu đã được xác nhận. Mở mục <strong>Điều phối giao hàng</strong> để xuất bản nháp.</p>
                        </div>
                    )}
                    {plan && !selectedInputMatchesPlan && <p className="w5-caution">Bạn đã thay đổi nguồn/điểm nhận/ngày/ca. Bấm “Tải đề xuất từ B7” để cập nhật; không dùng kết quả cũ.</p>}
                </>
            )}

            {mode === 'delivery' && (
                !plan ? (
                    <div className="w5-panel w5-empty">Chưa có kế hoạch B7 trong phiên này. Mở mục <strong>Đề xuất bổ sung</strong>, chọn nguồn và điểm nhận rồi tải dự báo trước.</div>
                ) : (
                    <div className="w5-panel">
                        <div className="w5-panel-title"><h3>Danh sách chuẩn bị hàng</h3><span>{plan.businessDate} · {SHIFTS.find(item => item.value === plan.shift)?.label}</span></div>
                        <p className="w5-muted">Kho xuất: <strong>{plan.sourceBranch.code} — {plan.sourceBranch.name}</strong>. Dữ liệu dự báo được tải lúc {new Date(plan.fetchedAt).toLocaleString('vi-VN')}. Không thay cho phiếu B5.</p>
                        <div className="w5-controls">
                            <label>Giờ dự kiến giao (theo giờ VN)
                                <input type="time" value={deliveryTime} onChange={event => setDeliveryTime(event.target.value)} />
                            </label>
                            <label>Người/bộ phận phụ trách giao
                                <input maxLength={120} value={assignedTo} onChange={event => setAssignedTo(event.target.value)} placeholder="Nhập người phụ trách (tùy chọn)" />
                            </label>
                        </div>
                        <div className="w5-table-wrap"><table className="w5-table"><thead><tr><th>Chọn</th><th>Điểm nhận</th><th>Nguyên liệu</th><th>Cần bổ sung</th><th>B7 có thể cấp</th><th>Lượng chuẩn bị</th></tr></thead>
                            <tbody>{plan.recommendations.map(row => {
                                const id = lineId(row);
                                const quantity = quantities[id] ?? row.proposedDeliveryQuantity;
                                const error = validateDispatchQuantity(quantity, row);
                                return <tr key={id}>
                                    <td><input type="checkbox" checked={selected[id] !== false} onChange={event => setSelected(current => ({ ...current, [id]: event.target.checked }))} aria-label={`Chọn ${row.ingredientName} cho ${row.destinationBranchName}`} /></td>
                                    <td>{row.destinationBranchCode || row.destinationBranchName}</td>
                                    <td>{row.ingredientName} <small>({row.unit})</small></td>
                                    <td className="w5-number">{displayQuantity(row.requestedQuantity)}</td>
                                    <td className="w5-number">{displayQuantity(row.proposedDeliveryQuantity)}</td>
                                    <td><input className="w5-quantity" type="text" inputMode="decimal" value={quantity} onChange={event => setQuantities(current => ({ ...current, [id]: event.target.value }))} aria-label={`Lượng chuẩn bị ${row.ingredientName} tại ${row.destinationBranchName}`} aria-invalid={Boolean(error)} />{error && selected[id] !== false && <small className="w5-invalid">{error}</small>}</td>
                                </tr>;
                            })}</tbody></table></div>
                        <label className="w5-note-label">Ghi chú kế hoạch giao
                            <textarea maxLength={500} rows={3} value={dispatchNote} onChange={event => setDispatchNote(event.target.value)} placeholder="Ghi giờ hẹn, điểm bàn giao, lưu ý nguyên liệu…" />
                        </label>
                        <button type="button" className="w5-primary" onClick={exportDispatch}>Xuất danh sách chuẩn bị nháp JSON</button>
                        <p className="w5-caution">Trước khi xuất phiếu thật cần kiểm tra lại tồn kho B3, đối chiếu người nhận và tạo phiếu B5 qua quy trình có quyền duyệt. Xuất JSON không xác nhận đã giao hàng.</p>
                    </div>
                )
            )}
        </section>
    );
}

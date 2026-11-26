import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { AuthSession } from '../auth';
import {
    amountFields, calculateSales, exportDraft, formatVnd, importDraft,
    newLine, newSalesDraft, parseCups, reviewDraft,
    type DrinkSize, type SalesAmounts, type SalesDraft, type SalesLine, type WorkShift,
} from './sales-report';
import './SalesReportPage.css';

type Props = {
    session: AuthSession;
    mode: 'sales' | 'reconciliation';
    draft: SalesDraft;
    onChange: Dispatch<SetStateAction<SalesDraft>>;
};
const shifts: { value: WorkShift; label: string }[] = [
    { value: 'MORNING', label: 'Ca sáng' },
    { value: 'AFTERNOON', label: 'Ca chiều' },
    { value: 'EVENING', label: 'Ca tối' },
];
const sizeLabels: Record<DrinkSize, string> = {
    S: 'Nhỏ (S)', M: 'Vừa (M)', L: 'Lớn (L)', OTHER: 'Khác',
};

function varianceLabel(value: number | null): string {
    if (value === null) return 'Chưa đủ dữ liệu';
    if (value === 0) return 'Khớp';
    return `${value > 0 ? 'Dư' : 'Thiếu'} ${formatVnd(Math.abs(value))}`;
}
function changeLine(draft: SalesDraft, id: string, patch: Partial<SalesLine>): SalesDraft {
    return { ...draft, lines: draft.lines.map(line => line.id === id ? { ...line, ...patch } : line) };
}
function changeAmount(draft: SalesDraft, key: keyof SalesAmounts, value: string): SalesDraft {
    return { ...draft, amounts: { ...draft.amounts, [key]: value } };
}
function downloadJson(content: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SalesReportPage({ session, mode, draft, onChange }: Props) {
    const isManager = session.user.role !== 'STAFF';
    const isAdmin = session.user.role === 'ADMIN';
    const [notice, setNotice] = useState('');
    const [fileError, setFileError] = useState('');
    const [showAllWarnings, setShowAllWarnings] = useState(false);
    const totals = useMemo(() => calculateSales(draft), [draft]);
    const problems = useMemo(() => reviewDraft(draft), [draft]);

    useEffect(() => {
        onChange(current => {
            const reporterName = current.reporterName || session.user.displayName || session.user.email;
            const branchId = session.user.role === 'STAFF'
                ? (session.user.branchId || current.branchId)
                : (current.branchId || session.user.branchId || '');
            if (reporterName === current.reporterName && branchId === current.branchId) return current;
            return { ...current, reporterName, branchId };
        });
    }, [onChange, session.user.id, session.user.role, session.user.branchId, session.user.displayName, session.user.email]);

    if (mode === 'reconciliation' && !isManager) {
        return <div className="w4-panel">Tài khoản hiện tại không có quyền truy cập màn hình đối soát của quản lý.</div>;
    }

    const setField = (key: keyof Pick<SalesDraft, 'businessDate' | 'branchId' | 'branchName' | 'reporterName' | 'cashierName' | 'baristaName' | 'notes'>, value: string) => {
        onChange(current => ({ ...current, [key]: value }));
        setNotice('');
    };
    const setLine = (id: string, patch: Partial<SalesLine>) => {
        onChange(current => changeLine(current, id, patch));
        setNotice('');
    };
    const setAmount = (key: keyof SalesAmounts, value: string) => {
        onChange(current => changeAmount(current, key, value));
        setNotice('');
    };

    async function loadJson(event: ChangeEvent<HTMLInputElement>): Promise<void> {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setNotice('');
        setFileError('');
        if (file.size > 200_000) {
            setFileError('File quá lớn; chỉ nhận báo cáo JSON dưới 200 KB.');
            return;
        }
        try {
            const content: unknown = JSON.parse(await file.text()) as unknown;
            const parsed = importDraft(content);
            if (session.user.role === 'STAFF' && session.user.branchId && parsed.branchId !== session.user.branchId) {
                throw new Error('Nhân viên chỉ được mở báo cáo thuộc chi nhánh được phân quyền.');
            }
            onChange(parsed);
            setShowAllWarnings(true);
            setNotice('Đã mở bản nháp từ file. Dữ liệu CHƯA được xác thực hay đồng bộ với Backend.');
        } catch (error) {
            setFileError(error instanceof Error ? error.message : 'Không thể đọc file JSON.');
        }
    }
    function saveJson(): void {
        const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate) ? draft.businessDate : 'chua-xac-dinh';
        downloadJson(exportDraft(draft), `wavehouse-W4-NHAP-${safeDate}-${draft.shift}.json`);
        setNotice('Đã tải bản nháp JSON xuống máy. Đây KHÔNG phải báo cáo đã nộp hay đã được duyệt.');
    }
    function resetDraft(): void {
        if (!window.confirm('Xóa bản nháp đang nhập trên trang này? Nếu cần lưu, hãy xuất JSON trước.')) return;
        const empty = newSalesDraft();
        empty.branchId = session.user.branchId || '';
        empty.reporterName = session.user.displayName || session.user.email;
        onChange(empty);
        setNotice('Đã tạo biểu mẫu trống.');
        setFileError('');
        setShowAllWarnings(false);
    }

    const salesFields = amountFields.slice(0, 7);
    const cashFields = amountFields.slice(7);
    const isReconciliation = mode === 'reconciliation';

    return (
        <section className="w4-root" aria-label={isReconciliation ? 'Đối soát tiền cuối ca' : 'Báo cáo số ly bán'}>
            <div className="w4-heading">
                <div>
                    <p className="w4-eyebrow">WAVEHOUSE / W4 / {isReconciliation ? 'ĐỐI SOÁT' : 'BÁO CÁO BÁN HÀNG'}</p>
                    <h2>{isReconciliation ? 'Đối soát doanh thu & tiền cuối ca' : 'Báo cáo đồ uống bán trong ca'}</h2>
                    <p>Ghi nhận từng sản phẩm/size và đối chiếu thu tiền theo cách các điểm bán đang làm với Excel.</p>
                </div>
                <span className="w4-status">BẢN NHÁP TRÊN TRÌNH DUYỆT</span>
            </div>

            <div className="w4-warning" role="note">
                <strong>Chưa có API lưu báo cáo doanh thu.</strong> Nội dung chỉ giữ trong trang đang mở; tải file JSON để sao lưu/bàn giao. Không dùng bản nháp để kết luận thất thoát hoặc đánh giá nhân viên. Đóng hoặc tải lại trang có thể mất dữ liệu chưa xuất.
            </div>

            <div className="w4-actions">
                <button type="button" className="w4-primary" onClick={saveJson}>Xuất báo cáo nháp JSON</button>
                <label className="w4-import">Mở file JSON đã lưu
                    <input type="file" accept=".json,application/json" onChange={event => { void loadJson(event); }} />
                </label>
                <button type="button" className="w4-muted" onClick={resetDraft}>Biểu mẫu mới</button>
            </div>
            {notice && <p className="w4-notice" role="status">{notice}</p>}
            {fileError && <p className="w4-error" role="alert">{fileError}</p>}

            <div className="w4-panel">
                <div className="w4-section-header"><h3>01. Thông tin ca bán</h3><small>Nhập thông tin thực tế của điểm bán</small></div>
                <div className="w4-fields">
                    <label>Ngày kinh doanh
                        <input type="date" value={draft.businessDate} onChange={event => setField('businessDate', event.target.value)} />
                    </label>
                    <label>Ca làm việc
                        <select value={draft.shift} onChange={event => onChange(current => ({ ...current, shift: event.target.value as WorkShift }))}>
                            {shifts.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                    </label>
                    <label>Mã chi nhánh (UUID)
                        <input value={draft.branchId} maxLength={100} disabled={!isAdmin && Boolean(session.user.branchId)} onChange={event => setField('branchId', event.target.value)} placeholder="ID chi nhánh được phân quyền" />
                    </label>
                    <label>Tên điểm bán / mã quầy
                        <input value={draft.branchName} maxLength={100} onChange={event => setField('branchName', event.target.value)} placeholder="Ví dụ: CT, ĐBP-3" />
                    </label>
                    <label>Người lập báo cáo
                        <input value={draft.reporterName} maxLength={120} onChange={event => setField('reporterName', event.target.value)} />
                    </label>
                    <label>Người giữ tiền
                        <input value={draft.cashierName} maxLength={120} onChange={event => setField('cashierName', event.target.value)} />
                    </label>
                    <label>Người pha chế
                        <input value={draft.baristaName} maxLength={120} onChange={event => setField('baristaName', event.target.value)} />
                    </label>
                </div>
            </div>

            <div className="w4-panel">
                <div className="w4-section-header">
                    <div><h3>02. Số lượng đồ uống đã bán</h3><small>Giá nhập theo từng size và giá bán thực tế; chưa tự lấy bảng giá từ Catalog</small></div>
                    <button type="button" className="w4-outline" disabled={draft.lines.length >= 100} onClick={() => onChange(current => ({ ...current, lines: [...current.lines, newLine()] }))}>+ Thêm dòng</button>
                </div>
                <div className="w4-table-scroll">
                    <table className="w4-table">
                        <thead><tr><th>Sản phẩm / topping</th><th>Size</th><th>Số ly</th><th>Đơn giá (đ)</th><th>Thành tiền</th><th>Ghi chú</th><th></th></tr></thead>
                        <tbody>
                            {draft.lines.map((line, i) => {
                                const count = parseCups(line.quantity);
                                const price = /^\d{1,12}$/.test(line.unitPrice) ? Number(line.unitPrice) : null;
                                return (
                                    <tr key={line.id}>
                                        <td><input aria-label={`Tên đồ uống dòng ${i + 1}`} value={line.productName} maxLength={120} onChange={event => setLine(line.id, { productName: event.target.value })} placeholder="Tên sản phẩm" /></td>
                                        <td><select aria-label={`Size dòng ${i + 1}`} value={line.size} onChange={event => setLine(line.id, { size: event.target.value as DrinkSize })}>
                                            {(Object.keys(sizeLabels) as DrinkSize[]).map(size => <option key={size} value={size}>{sizeLabels[size]}</option>)}
                                        </select></td>
                                        <td><input aria-label={`Số ly dòng ${i + 1}`} inputMode="numeric" value={line.quantity} onChange={event => setLine(line.id, { quantity: event.target.value })} placeholder="0" /></td>
                                        <td><input aria-label={`Đơn giá dòng ${i + 1}`} inputMode="numeric" value={line.unitPrice} onChange={event => setLine(line.id, { unitPrice: event.target.value })} placeholder="0" /></td>
                                        <td className="w4-table-money">{count !== null && price !== null ? formatVnd(count * price) : '—'}</td>
                                        <td><input aria-label={`Ghi chú dòng ${i + 1}`} value={line.note} maxLength={240} onChange={event => setLine(line.id, { note: event.target.value })} placeholder="Ghi chú" /></td>
                                        <td><button aria-label={`Xóa dòng ${i + 1}`} type="button" className="w4-delete" disabled={draft.lines.length === 1} onClick={() => onChange(current => ({ ...current, lines: current.lines.filter(item => item.id !== line.id) }))}>Xóa</button></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="w4-sales-foot"><span>Tổng số ly: <strong>{totals.soldCups === null ? '—' : totals.soldCups}</strong></span><span>Doanh thu gộp theo sản phẩm: <strong>{formatVnd(totals.grossSales)}</strong></span></div>
            </div>

            <div className="w4-panel">
                <div className="w4-section-header"><h3>03. Tiền theo kênh thanh toán</h3><small>Giá trị VND nguyên, nhập 0 nếu không phát sinh</small></div>
                <div className="w4-money-grid">
                    {salesFields.map(field => (
                        <label key={field.key}>{field.label}
                            <input inputMode="numeric" value={draft.amounts[field.key]} onChange={event => setAmount(field.key, event.target.value)} />
                            <small>{field.hint}</small>
                        </label>
                    ))}
                </div>
            </div>

            <div className="w4-panel">
                <div className="w4-section-header"><h3>04. Kiểm kê tiền mặt</h3><small>Đối chiếu tiền bàn giao và tiền thực đếm</small></div>
                <div className="w4-money-grid">
                    {cashFields.map(field => (
                        <label key={field.key}>{field.label}
                            <input inputMode="numeric" value={draft.amounts[field.key]} onChange={event => setAmount(field.key, event.target.value)} placeholder={field.key === 'closingCashActual' ? 'Nhập tiền kiểm đếm' : '0'} />
                            <small>{field.hint}</small>
                        </label>
                    ))}
                </div>
                <label className="w4-notes">Ghi chú/giải trình chênh lệch và phát sinh
                    <textarea rows={4} maxLength={1500} value={draft.notes} onChange={event => setField('notes', event.target.value)} placeholder="Ghi nhận khuyến mãi, hủy đơn, thu chi có chứng từ, nguyên nhân chênh lệch nếu có..." />
                </label>
            </div>

            <div className="w4-panel w4-summary">
                <div className="w4-section-header"><h3>05. Kết quả đối chiếu {isReconciliation ? '— dành cho quản lý' : '(tham khảo)'}</h3><small>Chỉ là phép tính, không phải kết luận vi phạm</small></div>
                <div className="w4-metrics">
                    <div><small>Doanh thu sau giảm/hoàn</small><strong>{formatVnd(totals.netExpected)}</strong></div>
                    <div><small>Tổng thu ghi theo kênh</small><strong>{formatVnd(totals.recordedReceipts)}</strong></div>
                    <div className={totals.salesDifference === null || totals.salesDifference === 0 ? '' : 'w4-attention'}><small>Chênh lệch ghi nhận / doanh thu</small><strong>{varianceLabel(totals.salesDifference)}</strong></div>
                    <div><small>Tiền mặt dự kiến cuối ca</small><strong>{formatVnd(totals.expectedClosingCash)}</strong></div>
                    <div><small>Tiền mặt thực đếm</small><strong>{formatVnd(/^\d{1,12}$/.test(draft.amounts.closingCashActual) ? Number(draft.amounts.closingCashActual) : null)}</strong></div>
                    <div className={totals.cashDifference === null || totals.cashDifference === 0 ? '' : 'w4-attention'}><small>Chênh lệch tiền mặt</small><strong>{varianceLabel(totals.cashDifference)}</strong></div>
                </div>
                <div className="w4-formulas">
                    <p><b>Doanh thu ròng:</b> số ly × đơn giá − giảm giá − hoàn tiền.</p>
                    <p><b>Chênh lệch doanh thu:</b> tổng thu theo các kênh − doanh thu ròng.</p>
                    <p><b>Tiền mặt dự kiến:</b> tiền đầu ca + thu tiền mặt − chi tiền mặt − tiền đã bàn giao.</p>
                    <p><b>Chênh lệch tiền mặt:</b> tiền thực đếm − tiền mặt dự kiến.</p>
                </div>
                {problems.length > 0 ? (
                    <div className="w4-issues" role="status"><strong>{problems.length} nội dung cần hoàn thiện trước khi đối soát</strong>
                        <button type="button" className="w4-issues-toggle" onClick={() => setShowAllWarnings(previous => !previous)}>{showAllWarnings ? 'Thu gọn' : 'Xem chi tiết'}</button>
                        {showAllWarnings && <ul>{problems.map((problem, i) => <li key={`${i}-${problem}`}>{problem}</li>)}</ul>}
                    </div>
                ) : <div className="w4-complete">Các trường tính toán đã đủ. Vẫn cần người có thẩm quyền đối chiếu chứng từ gốc trước khi kết luận.</div>}
            </div>
        </section>
    );
}

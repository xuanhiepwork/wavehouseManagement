import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { AuthSession } from '../auth';
import { importDraft as importW4Draft } from './sales-report';
import { createSalesApi, SalesApiError, type PaymentChannel, type SalesBranch, type SalesHistory, type SalesInput,
    type SalesProduct, type SalesReport, type SalesRevision, type SalesShift, type SalesSize, type SalesStatus } from './sales.api';
import './SalesReportPage.css';
import './PersistentSalesReportPage.css';
import SalesQuickEntryGrid from './SalesQuickEntryGrid';
import { catalogVnd } from './sales-quick-entry.logic';

type Props = { session: AuthSession; mode: 'sales' | 'reconciliation';
    onUnsavedChange?: (dirty: boolean) => void; onWorkingChange?: (working: boolean) => void };
const channels: PaymentChannel[] = ['CASH', 'BANK_TRANSFER', 'MOMO', 'GRAB', 'OTHER'];
const channelNames: Record<PaymentChannel, string> = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', MOMO: 'MoMo', GRAB: 'Grab', OTHER: 'Khác' };
const shiftNames: Record<SalesShift, string> = { MORNING: 'Ca sáng', AFTERNOON: 'Ca chiều', EVENING: 'Ca tối' };
const statusNames: Record<SalesStatus, string> = { DRAFT: 'Bản nháp', SUBMITTED: 'Chờ duyệt', RETURNED: 'Đã trả lại', APPROVED: 'Đã duyệt' };
const eventNames = { CREATED: 'Tạo báo cáo', UPDATED: 'Lưu phiên bản', SUBMITTED: 'Gửi duyệt', RETURNED: 'Trả lại', APPROVED: 'Duyệt' };
const vnd = (value: string | null) => value === null ? 'Chưa nhập' : `${value.replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
const timestamp = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Không thể hoàn tất yêu cầu.';
function emptyInput(branchId: string): SalesInput {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (key: string) => parts.find(p => p.type === key)?.value;
    return { branchId, businessDate: `${part('year')}-${part('month')}-${part('day')}`, shift: 'MORNING', note: null,
        discounts: '0', lines: [], payments: channels.map(channel => ({ channel, collectedAmount: '0', refundedAmount: '0',
            platformFee: '0', settlementDifference: '0', note: null })), expenses: [],
        cash: { openingCash: '0', cashHandovers: '0', closingCashActual: null } };
}
function fromReport(report: SalesReport): SalesInput {
    const r = report.currentRevision;
    return { branchId: report.branchId, businessDate: report.businessDate, shift: report.shift, note: r.note, discounts: r.discounts,
        lines: r.lines.map(l => ({ productId: l.productId, productName: l.productNameSnapshot, size: l.size,
            quantity: l.quantity, unitPrice: l.unitPriceSnapshot, note: l.note })),
        payments: channels.map(channel => {
            const p = r.payments.find(item => item.channel === channel);
            return { channel, collectedAmount: p?.collectedAmount ?? '0', refundedAmount: p?.refundedAmount ?? '0',
                platformFee: p?.platformFee ?? '0', settlementDifference: p?.settlementDifference ?? '0', note: p?.note ?? null };
        }), expenses: r.expenses.map(e => ({ channel: e.channel, description: e.description, amount: e.amount })), cash: { ...r.cash } };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const unsigned = (v: unknown): v is string => typeof v === 'string' && /^(?:0|[1-9]\d{0,11})$/.test(v);
function validate(input: SalesInput) {
    const errors: string[] = [];
    if (!input.branchId) errors.push('Chọn chi nhánh.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) errors.push('Ngày kinh doanh không hợp lệ.');
    if (!(input.shift in shiftNames)) errors.push('Ca không hợp lệ.');
    if (!unsigned(input.discounts)) errors.push('Giảm giá phải là số nguyên VND không âm, tối đa 12 chữ số.');
    if (input.note && input.note.length > 1500) errors.push('Ghi chú báo cáo tối đa 1500 ký tự; rút gọn nội dung nhập từ file nếu cần.');
    if (input.lines.length > 100 || input.expenses.length > 100) errors.push('Tối đa 100 dòng bán hàng và 100 khoản chi.');
    input.lines.forEach((l, i) => {
        if (!l.productName.trim() || !unsigned(l.unitPrice) || !Number.isSafeInteger(l.quantity) || l.quantity < 0 || l.quantity > 999999) {
            errors.push(`Dòng ${i + 1}: cần tên, số lượng nguyên 0–999999 và đơn giá nguyên VND.`);
        }
    });
    input.payments.forEach(p => {
        if (![p.collectedAmount, p.refundedAmount, p.platformFee].every(unsigned) || !/^-?(?:0|[1-9]\d{0,11})$/.test(p.settlementDifference)) {
            errors.push(`${channelNames[p.channel]}: kiểm tra số tiền thu, hoàn, phí và chênh lệch đối soát.`);
        }
    });
    input.expenses.forEach((e, i) => { if (!e.description.trim() || !unsigned(e.amount)) errors.push(`Khoản chi ${i + 1}: cần nội dung và số nguyên VND không âm.`); });
    if (!unsigned(input.cash.openingCash) || !unsigned(input.cash.cashHandovers)
        || (input.cash.closingCashActual !== null && !unsigned(input.cash.closingCashActual))) errors.push('Kiểm tra các khoản kiểm đếm tiền mặt.');
    return errors;
}
/** Import an untrusted draft only. Server identity, approval and version are never imported. */
function parseImport(raw: unknown): { input: SalesInput; unallocatedRefunds: string | null } {
    if (object(raw) && raw.kind === 'WAVEHOUSE_W4_DRAFT') {
        const old = importW4Draft(raw);
        const input = emptyInput(old.branchId);
        input.businessDate = old.businessDate; input.shift = old.shift; input.discounts = old.amounts.discounts;
        input.note = [old.notes, old.reporterName && `Người lập (file nháp): ${old.reporterName}`,
            old.cashierName && `Thu ngân: ${old.cashierName}`, old.baristaName && `Pha chế: ${old.baristaName}`].filter(Boolean).join('\n') || null;
        input.lines = old.lines.map(l => ({ productId: null, productName: l.productName, size: l.size, quantity: Number(l.quantity), unitPrice: l.unitPrice, note: l.note || null }));
        const collections = [old.amounts.cashReceived, old.amounts.bankTransfer, old.amounts.momo, old.amounts.grab, old.amounts.otherReceived];
        input.payments = input.payments.map((p, i) => ({ ...p, collectedAmount: collections[i] ?? '0' }));
        input.cash = { openingCash: old.amounts.openingCash, cashHandovers: old.amounts.cashHandovers, closingCashActual: old.amounts.closingCashActual || null };
        if (old.amounts.cashExpenses !== '0') input.expenses = [{ channel: 'CASH', description: 'Khoản chi từ bản nháp W4 — cần đối chiếu chứng từ', amount: old.amounts.cashExpenses }];
        if (!unsigned(old.amounts.refunds)) throw new Error('Khoản hoàn tiền trong file W4 không hợp lệ.');
        return { input, unallocatedRefunds: old.amounts.refunds === '0' ? null : old.amounts.refunds };
    }
    if (!object(raw) || raw.format !== 'WAVEHOUSE_SALES_DRAFT_V1' || !object(raw.draft)) throw new Error('File không phải bản nháp W7.3 hoặc W4.');
    const d = raw.draft;
    if (typeof d.branchId !== 'string' || typeof d.businessDate !== 'string' || typeof d.shift !== 'string' || !['MORNING','AFTERNOON','EVENING'].includes(d.shift)
        || (d.note !== null && typeof d.note !== 'string') || typeof d.discounts !== 'string' || !object(d.cash)
        || !Array.isArray(d.lines) || !Array.isArray(d.payments) || !Array.isArray(d.expenses)) throw new Error('Cấu trúc bản nháp không hợp lệ.');
    const nullableText = (v: unknown): v is string | null => v === null || typeof v === 'string';
    if (!d.lines.every(l => object(l) && nullableText(l.productId) && typeof l.productName === 'string'
        && typeof l.size === 'string' && ['S','M','L','OTHER'].includes(l.size) && typeof l.quantity === 'number' && typeof l.unitPrice === 'string' && nullableText(l.note))
        || !d.payments.every(p => object(p) && channels.includes(p.channel as PaymentChannel)
            && ['collectedAmount','refundedAmount','platformFee','settlementDifference'].every(key => typeof p[key] === 'string') && nullableText(p.note))
        || !d.expenses.every(e => object(e) && channels.includes(e.channel as PaymentChannel) && typeof e.description === 'string' && typeof e.amount === 'string')
        || typeof d.cash.openingCash !== 'string' || typeof d.cash.cashHandovers !== 'string' || !nullableText(d.cash.closingCashActual)
        || new Set(d.payments.map(p => (p as Record<string, unknown>).channel)).size !== d.payments.length) throw new Error('Chi tiết bản nháp không hợp lệ.');
    const typed = d as unknown as SalesInput;
    // Copy only editable fields, dropping unexpected identity/state/totals keys.
    const input: SalesInput = { branchId: typed.branchId, businessDate: typed.businessDate, shift: typed.shift, note: typed.note,
        discounts: typed.discounts, cash: { openingCash: typed.cash.openingCash, cashHandovers: typed.cash.cashHandovers, closingCashActual: typed.cash.closingCashActual },
        lines: typed.lines.map(l => ({ productId: l.productId, productName: l.productName, size: l.size, quantity: l.quantity, unitPrice: l.unitPrice, note: l.note })),
        expenses: typed.expenses.map(e => ({ channel: e.channel, description: e.description, amount: e.amount })),
        payments: channels.map(channel => {
            const p = typed.payments.find(item => item.channel === channel);
            return { channel, collectedAmount: p?.collectedAmount ?? '0', refundedAmount: p?.refundedAmount ?? '0', platformFee: p?.platformFee ?? '0', settlementDifference: p?.settlementDifference ?? '0', note: p?.note ?? null };
        }) };
    if (raw.unallocatedRefunds !== undefined && raw.unallocatedRefunds !== null && !unsigned(raw.unallocatedRefunds)) throw new Error('Hoàn tiền chưa phân bổ không hợp lệ.');
    return { input, unallocatedRefunds: typeof raw.unallocatedRefunds === 'string' && raw.unallocatedRefunds !== '0' ? raw.unallocatedRefunds : null };
}
function Totals({ revision, dirty = false }: { revision: SalesRevision; dirty?: boolean }) {
    const fields: [string, string | null][] = [['Doanh thu gộp', revision.totals.grossSales], ['Giảm giá', revision.discounts], ['Hoàn tiền theo kênh', revision.recognizedRefunds],
        ['Doanh thu kỳ vọng', revision.totals.netExpected], ['Thu ròng ghi nhận', revision.totals.netRecorded], ['Chênh lệch doanh thu', revision.totals.salesDifference],
        ['Tiền mặt kỳ vọng', revision.totals.expectedCash], ['Thực đếm cuối ca', revision.cash.closingCashActual], ['Chênh lệch tiền mặt', revision.totals.cashDifference]];
    return <div className="w4-panel"><h3>Tổng hợp từ máy chủ — phiên bản #{revision.number}</h3>
        {dirty && <p className="w4-warning">Các tổng dưới đây thuộc bản đã lưu, chưa bao gồm thay đổi đang nhập.</p>}
        <div className="w4-metrics">{fields.map(([label, value]) => <div key={label} className={label.startsWith('Chênh lệch') && value !== '0' && value !== null ? 'w4-attention' : ''}><small>{label}</small><strong>{vnd(value)}</strong></div>)}</div>
        <p className="w73-muted">Chênh lệch cần đối chiếu chứng từ và giải thích; không phải kết luận về hành vi của nhân viên.</p>
    </div>;
}

export default function PersistentSalesReportPage({ session, mode, onUnsavedChange, onWorkingChange }: Props) {
    const api = useMemo(() => createSalesApi(session.token), [session.token]);
    const isAdmin = session.user.role === 'ADMIN';
    const isSalesStaff = session.user.role === 'STAFF';
    const boundBranch = session.user.branchId ?? '';
    const [form, setForm] = useState(() => emptyInput(isAdmin ? '' : boundBranch));
    const [baseline, setBaseline] = useState(() => JSON.stringify(form));
    const [report, setReport] = useState<SalesReport | null>(null);
    const [products, setProducts] = useState<SalesProduct[]>([]);
    const [branches, setBranches] = useState<SalesBranch[]>([]);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [catalogError, setCatalogError] = useState('');
    const [branchError, setBranchError] = useState('');
    const [assignedShifts, setAssignedShifts] = useState<{ branchId: string; shift: SalesShift }[]>([]);
    const [contextLoading, setContextLoading] = useState(false);
    const [catalogRetry, setCatalogRetry] = useState(0);
    const [filters, setFilters] = useState({ branchId: '', from: '', to: '', shift: '', status: '', page: 1 });
    const [items, setItems] = useState<SalesReport[]>([]);
    const [total, setTotal] = useState(0);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [conflict, setConflict] = useState(false);
    const [reason, setReason] = useState('');
    const [unallocatedRefunds, setUnallocatedRefunds] = useState<string | null>(null);
    const [history, setHistory] = useState<SalesHistory | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState('');
    const [revisionNumber, setRevisionNumber] = useState(0);
    const alive = useRef(true);
    const actionLock = useRef(false);
    const historySequence = useRef(0);
    const dirty = JSON.stringify(form) !== baseline || unallocatedRefunds !== null;
    const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
    const callbacks = useRef({ onUnsavedChange, onWorkingChange }); callbacks.current = { onUnsavedChange, onWorkingChange };
    const editable = !report || report.allowedActions.canEdit;
    const productMap = useMemo(() => new Map(products.map(p => [p._id, p])), [products]);

    useEffect(() => {
        alive.current = true;
        const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || actionLock.current) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', beforeUnload);
        return () => { alive.current = false; historySequence.current++; window.removeEventListener('beforeunload', beforeUnload);
            callbacks.current.onUnsavedChange?.(false); callbacks.current.onWorkingChange?.(false); };
    }, []);
    useEffect(() => { callbacks.current.onUnsavedChange?.(dirty); }, [dirty]);
    useEffect(() => { callbacks.current.onWorkingChange?.(working); }, [working]);
    useEffect(() => {
        let cancelled = false;
        setCatalogLoading(true); setCatalogError(''); setBranchError('');
        void api.products().then(data => { if (!cancelled) setProducts(data); }).catch(cause => { if (!cancelled) setCatalogError(errorText(cause)); })
            .finally(() => { if (!cancelled) setCatalogLoading(false); });
        return () => { cancelled = true; };
    }, [api, catalogRetry]);
    useEffect(() => {
        let cancelled = false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.businessDate)) return;
        setContextLoading(true); setBranchError('');
        void api.workContext(form.businessDate).then(context => {
            if (cancelled) return;
            setBranches(context.branches);
            setAssignedShifts(context.assignments);
            if (isSalesStaff) setForm(previous => report ? previous : ({ ...previous,
                branchId: context.assignments.find(item => item.shift === previous.shift)?.branchId ?? '',
            }));
        }).catch(cause => { if (!cancelled) {
            setAssignedShifts([]); setBranches([]); setBranchError(errorText(cause));
        } }).finally(() => { if (!cancelled) setContextLoading(false); });
        return () => { cancelled = true; };
    }, [api, form.businessDate, isSalesStaff, report?.id, catalogRetry]);
    useEffect(() => {
        let cancelled = false;
        setListLoading(true); setListError('');
        if (filters.from && filters.to && filters.from > filters.to) { setListError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'); setListLoading(false); return; }
        const query: Record<string, string | number> = { page: filters.page };
        for (const [key, value] of Object.entries(filters)) if (key !== 'page' && value !== '') query[key] = value;
        void api.list(query).then(result => { if (!cancelled) { setItems(result.items); setTotal(result.total); } })
            .catch(cause => { if (!cancelled) { setListError(errorText(cause)); setItems([]); } }).finally(() => { if (!cancelled) setListLoading(false); });
        return () => { cancelled = true; };
    }, [api, filters, refresh]);

    function install(next: SalesReport) {
        const input = fromReport(next);
        setReport(next); setForm(input); setBaseline(JSON.stringify(input)); setReason(''); setConflict(false); setUnallocatedRefunds(null);
        setHistory(null); setHistoryError(''); setHistoryLoading(false); historySequence.current++;
    }
    function discard() { return !dirtyRef.current || window.confirm('Có thay đổi chưa lưu. Bỏ thay đổi để mở báo cáo khác?'); }
    async function run(work: () => Promise<SalesReport>, success: string) {
        if (actionLock.current) return;
        actionLock.current = true; setWorking(true); setError(''); setNotice(''); setConflict(false);
        try { const next = await work(); if (alive.current) { install(next); setNotice(success); setRefresh(x => x + 1); } }
        catch (cause) { if (alive.current) { setError(errorText(cause)); setConflict(cause instanceof SalesApiError && cause.status === 409); } }
        finally { actionLock.current = false; if (alive.current) setWorking(false); }
    }
    function open(id: string) { if (!actionLock.current && discard()) void run(() => api.get(id), 'Đã tải báo cáo.'); }
    function newDraft() {
        if (actionLock.current || !discard()) return;
        const assigned = assignedShifts.find(item => item.shift === 'MORNING') ?? assignedShifts[0];
        const input = emptyInput(isAdmin ? filters.branchId : isSalesStaff ? assigned?.branchId ?? '' : '');
        if (isSalesStaff && assigned) input.shift = assigned.shift;
        setReport(null); setForm(input); setBaseline(JSON.stringify(input)); setUnallocatedRefunds(null); setReason(''); setError(''); setNotice(''); setConflict(false);
        setHistory(null); setHistoryError(''); setHistoryLoading(false); historySequence.current++;
    }
    function save() {
        if (!editable || actionLock.current) return;
        const problems = validate(form);
        if (unallocatedRefunds !== null) problems.push('Phân bổ khoản hoàn tiền W4 vào các kênh và xác nhận trước khi lưu.');
        if (problems.length) { setError(problems.join('\n')); return; }
        const input = structuredClone(form);
        void run(() => report ? api.update(report.id, input, report.version) : api.create(input), 'Đã lưu bản nháp trên máy chủ.');
    }
    function submit() {
        if (!report?.allowedActions.canSubmit || dirty || actionLock.current) return;
        if (form.lines.some(l => !l.productId || l.size === 'OTHER' || l.quantity <= 0)) {
            setError('Trước khi gửi: từng dòng cần số lượng dương và liên kết Catalog sản phẩm/size. Xóa dòng trống hoặc số lượng 0.'); return;
        }
        if (!form.lines.length && !form.note?.trim()) { setError('Ca không phát sinh bán hàng cần ghi chú giải thích trước khi gửi.'); return; }
        if (form.cash.closingCashActual === null) { setError('Nhập và lưu tiền mặt thực đếm trước khi gửi.'); return; }
        void run(() => api.submit(report.id, report.version), 'Đã gửi báo cáo cho quản lý.');
    }
    function review(decision: 'return' | 'approve') {
        if (!report || dirty || actionLock.current || report.submittedRevisionNumber === null) return;
        if (decision === 'return' ? !report.allowedActions.canReturn : !report.allowedActions.canApprove) return;
        if (decision === 'return' && !reason.trim()) { setError('Cần nhập lý do trả lại.'); return; }
        const number = report.submittedRevisionNumber;
        void run(() => decision === 'return' ? api.returnReport(report.id, report.version, number, reason.trim())
            : api.approve(report.id, report.version, number), decision === 'return' ? 'Đã trả lại báo cáo.' : 'Đã duyệt báo cáo.');
    }
    async function loadHistory() {
        if (!report || actionLock.current) return;
        const sequence = ++historySequence.current;
        setHistoryLoading(true); setHistoryError('');
        try { const result = await api.revisions(report.id); if (alive.current && sequence === historySequence.current) {
            setHistory(result); setRevisionNumber(report.currentRevisionNumber); } }
        catch (cause) { if (alive.current && sequence === historySequence.current) setHistoryError(errorText(cause)); }
        finally { if (alive.current && sequence === historySequence.current) setHistoryLoading(false); }
    }
    function lineChange(index: number, patch: Partial<SalesInput['lines'][number]>) { setForm(value => ({ ...value, lines: value.lines.map((l, i) => i === index ? { ...l, ...patch } : l) })); }
    function chooseProduct(index: number, id: string) {
        if (!id) { lineChange(index, { productId: null }); return; }
        const p = productMap.get(id);
        if (!p?.isAvailable) return;
        const price = p.prices.find(v => v.size === form.lines[index]?.size) ?? p.prices[0];
        const integralPrice = price ? catalogVnd(price.price) : null;
        if (!price || integralPrice === null) { setError('Catalog có giá không nguyên VND. Nhập giá nguyên VND rõ ràng trước khi lưu.');
            return; }
        lineChange(index, { productId: p._id, productName: p.name, size: price.size, unitPrice: integralPrice });
    }
    function chooseSize(index: number, size: SalesSize) {
        const p = productMap.get(form.lines[index]?.productId ?? '');
        const price = p?.prices.find(v => v.size === size);
        const integralPrice = price ? catalogVnd(price.price) : null;
        if (price && integralPrice === null) { setError('Kích cỡ này có giá không nguyên VND. Kiểm tra Catalog trước khi chọn.'); return; }
        lineChange(index, { size, ...(integralPrice !== null ? { unitPrice: integralPrice } : {}) });
    }
    function paymentChange(index: number, key: keyof Omit<SalesInput['payments'][number], 'channel'>, value: string) {
        setForm(old => ({ ...old, payments: old.payments.map((p, i) => i === index ? { ...p, [key]: value } : p) }));
    }
    function exportJson() {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'WAVEHOUSE_SALES_DRAFT_V1', status: 'UNTRUSTED_DRAFT', draft: form,
            unallocatedRefunds, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `wavehouse-sales-NHAP-${form.businessDate}-${form.shift}.json`;
        link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function importJson(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file || actionLock.current || !editable || !discard()) return;
        actionLock.current = true; setWorking(true); setError(''); setNotice('');
        try {
            if (file.size > 200000) throw new Error('File tối đa 200 KB.');
            const { input, unallocatedRefunds: refunds } = parseImport(JSON.parse(await file.text()));
            if (isSalesStaff && !assignedShifts.some(item => item.branchId === input.branchId && item.shift === input.shift))
                throw new Error('File không khớp quầy/ca được phân công trong ngày.');
            if (report && (input.branchId !== report.branchId || input.businessDate !== report.businessDate || input.shift !== report.shift)) throw new Error('Tạo bản nháp mới để nhập file khác chi nhánh, ngày hoặc ca.');
            if (alive.current) { setForm(input); setUnallocatedRefunds(refunds); setNotice('Đã nhập bản nháp. Dữ liệu và quyền duyệt cần được máy chủ xác nhận khi lưu/gửi.'); }
        } catch (cause) { if (alive.current) setError(errorText(cause)); }
        finally { actionLock.current = false; if (alive.current) setWorking(false); }
    }
    const inspected = history?.revisions.find(r => r.number === revisionNumber);
    function filterChange(key: 'branchId' | 'from' | 'to' | 'shift' | 'status', value: string) { setFilters(old => ({ ...old, [key]: value, page: 1 })); }
    const channelOptions = channels.map(c => <option key={c} value={c}>{channelNames[c]}</option>);
    return <section className="w4-root w73-root" aria-label={mode === 'sales' ? 'Báo cáo bán hàng' : 'Đối soát tiền'}>
        <div className="w4-heading"><div><p className="w4-eyebrow">WAVEHOUSE / W7.3</p><h2>{mode === 'sales' ? 'Báo cáo bán hàng theo ca' : 'Đối soát doanh thu & tiền mặt'}</h2>
            <p>Hai khu vực dùng chung báo cáo, bản nháp và lịch sử xét duyệt.</p></div><span className="w4-status">{report ? statusNames[report.status] : 'NHÁP MỚI'}{dirty ? ' · CHƯA LƯU' : ''}</span></div>
        <div className="w4-panel"><h3>Danh sách báo cáo</h3><div className="w73-filters">
            <label>Chi nhánh<select value={filters.branchId} disabled={isSalesStaff} onChange={e => filterChange('branchId', e.target.value)}>
                <option value="">{isSalesStaff ? 'Báo cáo của tôi' : 'Tất cả quầy trong phạm vi'}</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (ngừng hoạt động)'}</option>)}</select></label>
            <label>Từ ngày<input type="date" value={filters.from} onChange={e => filterChange('from', e.target.value)} /></label>
            <label>Đến ngày<input type="date" value={filters.to} onChange={e => filterChange('to', e.target.value)} /></label>
            <label>Ca<select value={filters.shift} onChange={e => filterChange('shift', e.target.value)}><option value="">Tất cả ca</option>{Object.entries(shiftNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
            <label>Trạng thái<select value={filters.status} onChange={e => filterChange('status', e.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(statusNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        </div>{branchError && <p className="w4-error" role="alert">{branchError} <button onClick={() => setCatalogRetry(x => x + 1)}>Tải lại chi nhánh</button></p>}
            <div className="w4-actions"><button disabled={listLoading} onClick={() => setRefresh(x => x + 1)}>Tải lại danh sách</button>{(isAdmin || isSalesStaff) && <button disabled={working || contextLoading} onClick={newDraft}>Biểu mẫu mới</button>}</div>
            {listLoading && <p role="status">Đang tải danh sách…</p>}{listError && <p role="alert" className="w4-error">{listError}</p>}
            {!listLoading && !listError && items.length === 0 && <p>Chưa có báo cáo phù hợp.</p>}
            {items.length > 0 && <div className="w4-table-scroll"><table className="w4-table w73-list"><thead><tr><th>Ngày / ca</th><th>Chi nhánh</th><th>Trạng thái</th><th>Phiên bản</th><th>Doanh thu kỳ vọng</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id} aria-selected={report?.id === item.id}>
                <td>{item.businessDate} / {shiftNames[item.shift]}</td><td>{item.branch.name}</td><td>{statusNames[item.status]}</td><td>#{item.currentRevisionNumber}</td><td>{vnd(item.currentRevision.totals.netExpected)}</td><td><button disabled={working} onClick={() => open(item.id)}>{report?.id === item.id ? 'Tải bản mới nhất' : 'Mở'}</button></td></tr>)}</tbody></table></div>}
            <div className="w4-actions"><button disabled={listLoading || filters.page === 1} onClick={() => setFilters(v => ({ ...v, page: v.page - 1 }))}>Trang trước</button><span>Trang {filters.page} · {total} báo cáo</span><button disabled={listLoading || filters.page * 20 >= total} onClick={() => setFilters(v => ({ ...v, page: v.page + 1 }))}>Trang sau</button></div>
        </div>
        {isSalesStaff && !report && !contextLoading && assignedShifts.length === 0 &&
            <p className="w4-warning" role="status">Ngày đã chọn chưa có ca bán được phân công. Liên hệ quản lý khu vực để xếp lịch trước khi lập báo cáo.</p>}
        {error && <p className="w4-error w73-pre" role="alert">{error}{conflict && '\nBản đang nhập vẫn được giữ. Xuất JSON trước khi tải bản mới nhất nếu cần.'}</p>}
        {notice && <p className="w4-notice" role="status">{notice}</p>}{working && <p role="status">Đang xử lý, vui lòng chờ…</p>}
        {report?.returnReason && <p className="w4-warning">Lý do trả lại: {report.returnReason}</p>}
        <div className="w4-panel"><div className="w4-section-header"><h3>Thông tin ca bán</h3>{report && <small>Mã {report.id} · v{report.version} · {timestamp(report.updatedAt)}</small>}</div>
            <fieldset disabled={working || !editable} className="w73-fieldset"><div className="w4-fields">
                <label>Chi nhánh<select disabled={!!report || isSalesStaff || !isAdmin} value={form.branchId} onChange={e => setForm(v => ({ ...v, branchId: e.target.value }))}><option value="">Chọn chi nhánh</option>
                    {report && !branches.some(b => b.id === report.branchId) && <option value={report.branchId}>{report.branch.name}</option>}{branches.map(b => <option key={b.id} disabled={!b.isActive && !report} value={b.id}>{b.name}</option>)}</select></label>
                <label>Ngày kinh doanh<input disabled={!!report} type="date" value={form.businessDate} onChange={e => setForm(v => ({ ...v, businessDate: e.target.value }))} /></label>
                <label>Ca<select disabled={!!report} value={form.shift} onChange={e => setForm(v => {
                    const shift = e.target.value as SalesShift;
                    return { ...v, shift, branchId: isSalesStaff ? assignedShifts.find(item => item.shift === shift)?.branchId ?? '' : v.branchId };
                })}>{Object.entries(shiftNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                <label>Giảm giá (VND)<input inputMode="numeric" value={form.discounts} onChange={e => setForm(v => ({ ...v, discounts: e.target.value }))} /></label>
            </div><label className="w4-notes">Ghi chú / giải thích phát sinh<textarea maxLength={1500} rows={3} value={form.note ?? ''} onChange={e => setForm(v => ({ ...v, note: e.target.value || null }))} /></label></fieldset>
            {!editable && <p className="w73-muted">Báo cáo chỉ đọc. Quyền sửa và xét duyệt do máy chủ xác định.</p>}
        </div>
        <div className="w4-panel"><h3>Đồ uống đã bán</h3><p className="w73-muted">Giá và tên đã lưu được giữ theo phiên bản. Chỉ khi chọn sản phẩm/size mới lấy giá Catalog hiện tại. Có thể ghi đơn giá thực tế nguyên VND.</p>
            {catalogLoading && <p role="status">Đang tải Catalog…</p>}{catalogError && <p className="w4-error" role="alert">{catalogError} <button onClick={() => setCatalogRetry(x => x + 1)}>Thử lại Catalog</button></p>}
            {!catalogLoading && !catalogError && products.length === 0 && <p>Catalog chưa có sản phẩm. Có thể lưu dòng nhập tay làm nháp.</p>}
            {!catalogLoading && !catalogError && <SalesQuickEntryGrid products={products} lines={form.lines} disabled={working || !editable}
                onChange={lines => setForm(value => ({ ...value, lines }))} />}
            <h4>Chi tiết dòng bán hàng / giá thực tế</h4>
            {form.lines.length === 0 && <p className="w73-muted">Chưa có dòng bán hàng. Nếu ca không phát sinh bán, ghi rõ trong ghi chú để gửi báo cáo.</p>}
            <fieldset disabled={working || !editable} className="w73-fieldset"><div className="w4-table-scroll"><table className="w4-table w73-lines"><thead><tr><th>Catalog</th><th>Tên chụp tại ca</th><th>Size</th><th>Số ly</th><th>Đơn giá (VND)</th><th>Ghi chú</th><th /></tr></thead><tbody>{form.lines.map((l, index) => {
                const product = productMap.get(l.productId ?? '');
                return <tr key={index}><td><select aria-label={`Catalog dòng ${index + 1}`} value={l.productId ?? ''} onChange={e => chooseProduct(index, e.target.value)}><option value="">Nhập tay (chỉ nháp)</option>
                    {l.productId && !product && <option value={l.productId}>{l.productName} (ngoài Catalog hiện tại)</option>}{products.map(p => <option key={p._id} value={p._id} disabled={!p.isAvailable}>{p.name}{p.isAvailable ? '' : ' (ngừng bán)'}</option>)}</select></td>
                    <td><input aria-label={`Tên dòng ${index + 1}`} maxLength={200} readOnly={!!l.productId} value={l.productName} onChange={e => lineChange(index, { productName: e.target.value })} /></td>
                    <td><select aria-label={`Size dòng ${index + 1}`} value={l.size} onChange={e => chooseSize(index, e.target.value as SalesSize)}>{(['S','M','L','OTHER'] as const).map(s => <option key={s} value={s} disabled={!!product && !product.prices.some(p => p.size === s)}>{s === 'OTHER' ? 'Khác' : s}</option>)}</select></td>
                    <td><input aria-label={`Số ly dòng ${index + 1}`} type="number" min={0} max={999999} step={1} value={Number.isNaN(l.quantity) ? '' : l.quantity} onChange={e => lineChange(index, { quantity: e.target.value === '' ? NaN : Number(e.target.value) })} /></td>
                    <td><input aria-label={`Đơn giá dòng ${index + 1}`} inputMode="numeric" value={l.unitPrice} onChange={e => lineChange(index, { unitPrice: e.target.value })} /></td>
                    <td><input aria-label={`Ghi chú dòng ${index + 1}`} maxLength={240} value={l.note ?? ''} onChange={e => lineChange(index, { note: e.target.value || null })} /></td>
                    <td><button type="button" onClick={() => setForm(v => ({ ...v, lines: v.lines.filter((_, i) => i !== index) }))}>Xóa</button></td></tr>;
            })}</tbody></table></div><button type="button" disabled={form.lines.length >= 100} onClick={() => setForm(v => ({ ...v, lines: [...v.lines, { productId: null, productName: '', size: 'M', quantity: 1, unitPrice: '0', note: null }] }))}>Thêm dòng nhập tay (chỉ lưu nháp)</button></fieldset>
        </div>
        <div className="w4-panel"><h3>Thu tiền, hoàn tiền & đối soát theo kênh</h3><p className="w73-muted">Thu trước phí nền tảng. Khoản hoàn phải thuộc doanh thu gộp của ca này; tổng hoàn được máy chủ cộng theo kênh. Phí và chênh lệch thanh toán được ghi riêng.</p>
            {unallocatedRefunds !== null && <div className="w4-warning">File W4 có {vnd(unallocatedRefunds)} hoàn tiền chưa gắn kênh. Phân bổ vào các ô hoàn bên dưới rồi xác nhận.
                <button disabled={working || !editable} onClick={() => {
                    if (form.payments.every(p => unsigned(p.refundedAmount)) && form.payments.reduce((s, p) => s + BigInt(p.refundedAmount), 0n) === BigInt(unallocatedRefunds)) setUnallocatedRefunds(null);
                    else setError('Tổng hoàn theo kênh phải bằng khoản hoàn chưa phân bổ trong file W4.');
                }}>Xác nhận đã phân bổ</button></div>}
            <fieldset disabled={working || !editable} className="w73-fieldset"><div className="w4-table-scroll"><table className="w4-table w73-payments"><thead><tr><th>Kênh</th><th>Đã thu</th><th>Đã hoàn</th><th>Phí nền tảng</th><th>Chênh lệch thanh toán (+/−)</th><th>Ghi chú</th></tr></thead><tbody>{form.payments.map((p, i) => <tr key={p.channel}><th scope="row">{channelNames[p.channel]}</th>
                {(['collectedAmount','refundedAmount','platformFee','settlementDifference'] as const).map(key => <td key={key}><input aria-label={`${channelNames[p.channel]} ${key}`} inputMode={key === 'settlementDifference' ? 'text' : 'numeric'} value={p[key]} onChange={e => paymentChange(i, key, e.target.value)} /></td>)}
                <td><input aria-label={`Ghi chú ${channelNames[p.channel]}`} maxLength={300} value={p.note ?? ''} onChange={e => paymentChange(i, 'note', e.target.value)} /></td></tr>)}</tbody></table></div></fieldset>
        </div>
        <div className="w4-panel"><h3>Chi phí vận hành</h3><fieldset disabled={working || !editable} className="w73-fieldset">{form.expenses.length === 0 && <p>Chưa có khoản chi.</p>}{form.expenses.map((e, i) => <div className="w73-expense" key={i}>
            <label>Kênh chi<select value={e.channel} onChange={event => setForm(v => ({ ...v, expenses: v.expenses.map((row, n) => n === i ? { ...row, channel: event.target.value as PaymentChannel } : row) }))}>{channelOptions}</select></label>
            <label>Nội dung / chứng từ<input maxLength={300} value={e.description} onChange={event => setForm(v => ({ ...v, expenses: v.expenses.map((row, n) => n === i ? { ...row, description: event.target.value } : row) }))} /></label>
            <label>Số tiền (VND)<input inputMode="numeric" value={e.amount} onChange={event => setForm(v => ({ ...v, expenses: v.expenses.map((row, n) => n === i ? { ...row, amount: event.target.value } : row) }))} /></label>
            <button onClick={() => setForm(v => ({ ...v, expenses: v.expenses.filter((_, n) => n !== i) }))}>Xóa</button></div>)}
            <button disabled={form.expenses.length >= 100} onClick={() => setForm(v => ({ ...v, expenses: [...v.expenses, { channel: 'CASH', description: '', amount: '0' }] }))}>Thêm khoản chi</button></fieldset>
        </div>
        <div className="w4-panel"><h3>Kiểm đếm tiền mặt</h3><fieldset disabled={working || !editable} className="w73-fieldset"><div className="w4-money-grid">{([
            ['openingCash', 'Tiền đầu ca'], ['cashHandovers', 'Tiền đã bàn giao'], ['closingCashActual', 'Tiền thực đếm cuối ca'],
        ] as const).map(([key, label]) => <label key={key}>{label} (VND)<input inputMode="numeric" placeholder={key === 'closingCashActual' ? 'Chưa đếm' : '0'} value={form.cash[key] ?? ''}
            onChange={e => setForm(v => ({ ...v, cash: { ...v.cash, [key]: key === 'closingCashActual' && e.target.value === '' ? null : e.target.value } }))} /></label>)}</div></fieldset></div>
        {report ? <Totals revision={report.currentRevision} dirty={dirty} /> : <p className="w4-warning">Lưu bản nháp để nhận tổng hợp được máy chủ tính.</p>}
        <div className="w4-formulas"><p>Doanh thu gộp = Σ(số lượng × đơn giá chụp tại ca).</p><p>Doanh thu kỳ vọng = doanh thu gộp − giảm giá − tổng hoàn theo kênh.</p><p>Thu ròng = Σ(đã thu − đã hoàn). Chênh lệch doanh thu = thu ròng − doanh thu kỳ vọng.</p><p>Tiền mặt kỳ vọng = đầu ca + thu tiền mặt − hoàn tiền mặt − chi tiền mặt − bàn giao.</p><p>Chênh lệch tiền mặt = thực đếm − tiền mặt kỳ vọng.</p></div>
        <div className="w4-actions">{editable && <button className="w4-primary" disabled={working || (!!report && !dirty)} onClick={save}>Lưu bản nháp</button>}
            {report?.allowedActions.canSubmit && <button className="w4-primary" disabled={working || dirty} onClick={submit}>Gửi duyệt</button>}
            <button disabled={working} onClick={exportJson}>Xuất JSON nháp</button>{editable && <label className={`w4-import ${working ? 'w73-disabled' : ''}`}>Nhập JSON W7.3 / W4<input disabled={working} type="file" accept=".json,application/json" onChange={e => { void importJson(e); }} /></label>}
            {report && <><button disabled={working} onClick={() => open(report.id)}>Tải bản mới nhất</button><button disabled={working || historyLoading} onClick={() => { void loadHistory(); }}>Lịch sử phiên bản</button></>}
        </div>{dirty && report?.allowedActions.canSubmit && <p className="w73-muted">Lưu mọi thay đổi trước khi gửi duyệt.</p>}
        {report && (report.allowedActions.canReturn || report.allowedActions.canApprove) && <div className="w4-panel"><h3>Xét duyệt phiên bản đã gửi #{report.submittedRevisionNumber}</h3><p>Người gửi: {report.submittedById} · {report.submittedAt ? timestamp(report.submittedAt) : ''}</p>
            {report.allowedActions.canReturn && <label className="w4-notes">Lý do trả lại (bắt buộc)<textarea disabled={working} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>}
            <div className="w4-actions">{report.allowedActions.canReturn && <button disabled={working || dirty || !reason.trim()} onClick={() => review('return')}>Trả lại</button>}{report.allowedActions.canApprove && <button className="w4-primary" disabled={working || dirty} onClick={() => review('approve')}>Duyệt báo cáo</button>}</div></div>}
        {historyLoading && <p role="status">Đang tải lịch sử…</p>}{historyError && <p className="w4-error" role="alert">{historyError}</p>}
        {history && <div className="w4-panel"><h3>Lịch sử phiên bản & xét duyệt</h3><label className="w4-notes">Phiên bản<select value={revisionNumber} onChange={e => setRevisionNumber(Number(e.target.value))}>{history.revisions.map(r => <option value={r.number} key={r.id}>#{r.number} · {timestamp(r.createdAt)}{r.number === report?.approvedRevisionNumber ? ' · ĐÃ DUYỆT' : ''}</option>)}</select></label>
            {inspected && <><p>Người lưu: {inspected.createdById} · {timestamp(inspected.createdAt)}</p><p className="w73-pre">{inspected.note}</p><Totals revision={inspected} />
                <div className="w4-table-scroll"><table className="w4-table w73-list"><thead><tr><th>Sản phẩm chụp tại ca</th><th>Size</th><th>Số lượng</th><th>Đơn giá</th><th>Ghi chú</th></tr></thead><tbody>{inspected.lines.map(l => <tr key={l.id}><td>{l.productNameSnapshot}{l.productId ? '' : ' (nhập tay)'}</td><td>{l.size}</td><td>{l.quantity}</td><td>{vnd(l.unitPriceSnapshot)}</td><td>{l.note}</td></tr>)}</tbody></table></div>
                <h4>Thanh toán đã lưu</h4><ul>{inspected.payments.map(p => <li key={p.id}>{channelNames[p.channel]}: thu {vnd(p.collectedAmount)}, hoàn {vnd(p.refundedAmount)}, phí {vnd(p.platformFee)}, chênh lệch thanh toán {vnd(p.settlementDifference)}. {p.note}</li>)}</ul>
                <h4>Khoản chi đã lưu</h4><ul>{inspected.expenses.map(e => <li key={e.id}>{channelNames[e.channel]}: {e.description} — {vnd(e.amount)}</li>)}</ul><p>Tiền đầu ca {vnd(inspected.cash.openingCash)} · bàn giao {vnd(inspected.cash.cashHandovers)}</p></>}
            <h4>Nhật ký thao tác</h4><ol className="w73-history">{history.events.map(e => <li key={e.id}><strong>{eventNames[e.type]}</strong> · #{e.revisionNumber} · {timestamp(e.createdAt)}<br />Người thực hiện: {e.actorId}{e.reason && <p>{e.reason}</p>}</li>)}</ol>
        </div>}
        <p className="w73-muted">JSON chỉ là bản nháp. Chỉ phiên bản được duyệt mới đủ điều kiện đưa vào KPI tài chính chính thức. Báo cáo doanh thu không tự động trừ tồn kho.</p>
    </section>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../auth';
import {
    changeDocumentStatus, findDocumentByCode, getDocument, isDocumentId, listDocuments,
    loadDocumentBranches, loadDocumentIngredients, loadSourceBalances, saveDocument,
    type BranchOption, type DocumentFilter, type DocumentInput, type DocumentKind,
    type DocumentPage, type IngredientOption, type SourceBalance, type StockDocument,
} from './stock-documents.api';
import './StockDocumentsPage.css';

type Props = {
    session: AuthSession; kind: DocumentKind;
    onDirtyChange?: (dirty: boolean) => void; onWorkingChange?: (working: boolean) => void;
    initialDocumentId?: string | null; initialRequest?: number; onOpenReceiving?: (documentId: string) => void;
};
type FormLine = { ingredientId: string; quantity: string; unitCost: string };
type Form = { code: string; branchId: string; destinationBranchId: string; supplierName: string; note: string; items: FormLine[] };
type Uncertain = { action: 'create' | 'save' | 'post' | 'cancel'; code: string; id?: string; input?: DocumentInput };
const titles: Record<DocumentKind, string> = { receipt: 'Phiếu nhập kho', issue: 'Phiếu xuất kho', transfer: 'Phiếu điều chuyển' };
const statuses = { DRAFT: 'Bản nháp', POSTED: 'Đã ghi sổ', CANCELLED: 'Đã hủy' };
const quantityPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const costPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const blankLine = (): FormLine => ({ ingredientId: '', quantity: '', unitCost: '0' });
const blankForm = (session: AuthSession): Form => ({ code: '', branchId: session.user.branchId ?? '', destinationBranchId: '', supplierName: '', note: '', items: [blankLine()] });
const fromDocument = (item: StockDocument): Form => ({ code: item.code, branchId: item.branchId ?? item.sourceBranchId ?? '',
    destinationBranchId: item.destinationBranchId ?? '', supplierName: item.supplierName ?? '', note: item.note ?? '',
    items: (item.items ?? []).map(line => ({ ingredientId: line.ingredientId, quantity: line.quantity, unitCost: line.unitCost ?? '0' })) });
const message = (error: unknown) => error instanceof Error ? error.message : 'Không thể hoàn thành yêu cầu.';
const normalizeDecimal = (value: string) => value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
function scaled(value: string): bigint {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const quantity = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    return negative ? -quantity : quantity;
}
function amount(quantity: string, cost: string): bigint {
    const [whole, fraction = ''] = cost.split('.');
    return scaled(quantity) * (BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0')));
}
function amountText(value: bigint): string {
    const whole = value / 10_000_000_000n;
    const fraction = (value % 10_000_000_000n).toString().padStart(10, '0').replace(/0+$/, '');
    return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction ? `,${fraction}` : ''}`;
}
function dateText(value?: string | null): string { return value ? new Date(value).toLocaleString('vi-VN') : '—'; }
function receivingLabel(item: StockDocument): string {
    if (item.status !== 'POSTED') return '—';
    if (item.transferReceipt === undefined) return 'Chưa tải thông tin nhận hàng';
    if (item.transferReceipt === null) return 'Chờ đối chiếu';
    return item.transferReceipt.status === 'CONFIRMED' ? 'Đã xác nhận' : 'Nháp đối chiếu';
}
function uncertainFailure(error: unknown): boolean {
    if (typeof error === 'object' && error !== null && 'uncertain' in error && (error as { uncertain?: unknown }).uncertain === true) return true;
    const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
    return typeof status !== 'number' || status === 0 || status >= 500;
}
function matchesInput(item: StockDocument, input: DocumentInput, kind: DocumentKind): boolean {
    return item.code === input.code && (item.branchId ?? item.sourceBranchId) === input.branchId &&
        (kind !== 'transfer' || item.destinationBranchId === input.destinationBranchId) &&
        (item.note ?? '') === (input.note ?? '') && (kind !== 'receipt' || (item.supplierName ?? '') === (input.supplierName ?? '')) &&
        item.items?.length === input.items.length && input.items.every(line => item.items?.some(saved => saved.ingredientId === line.ingredientId &&
            normalizeDecimal(saved.quantity) === normalizeDecimal(line.quantity) && (kind !== 'receipt' || normalizeDecimal(saved.unitCost ?? '0') === normalizeDecimal(line.unitCost ?? '0'))));
}

export default function StockDocumentsPage({ session, kind, onDirtyChange, onWorkingChange, initialDocumentId, initialRequest, onOpenReceiving }: Props) {
    const writer = session.user.role === 'ADMIN' || (kind !== 'transfer' && session.user.role === 'BRANCH_MANAGER');
    const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [metadataReady, setMetadataReady] = useState(false);
    const [metadataError, setMetadataError] = useState('');
    const [metadataRevision, setMetadataRevision] = useState(0);
    const [result, setResult] = useState<DocumentPage>({ items: [], page: 1, total: 0 });
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<DocumentFilter>({});
    const [listRevision, setListRevision] = useState(0);
    const [loadingList, setLoadingList] = useState(false);
    const [listError, setListError] = useState('');
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [selected, setSelected] = useState<StockDocument | null>(null);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState<Form>(() => blankForm(session));
    const [baseline, setBaseline] = useState(() => JSON.stringify(blankForm(session)));
    const [working, setWorking] = useState(false);
    const lock = useRef(false);
    const selectionRequest = useRef(0);
    const initialSeen = useRef('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [uncertain, setUncertain] = useState<Uncertain | null>(null);
    const [recoveryConflictId, setRecoveryConflictId] = useState<string | null>(null);
    const [attemptedCode, setAttemptedCode] = useState('');
    const [balances, setBalances] = useState<SourceBalance[]>([]);
    const [balanceError, setBalanceError] = useState('');
    const [balanceAt, setBalanceAt] = useState('');
    const [balanceRevision, setBalanceRevision] = useState(0);
    const editable = writer && (creating || selected?.status === 'DRAFT');
    const dirty = Boolean(selected || creating) && JSON.stringify(form) !== baseline;
    const needsAttention = dirty || Boolean(uncertain);
    const busy = working || loadingDetail;
    const receivingAllowed = session.user.role === 'ADMIN' || Boolean(selected?.destinationBranchId && selected.destinationBranchId === session.user.branchId);
    const totalPages = Math.max(1, Math.ceil(result.total / 50));
    const ingredientById = new Map(ingredients.map(item => [item.id, item]));
    const balanceById = new Map(balances.map(item => [item.ingredientId, item]));
    const branchLabel = (id?: string | null) => {
        if (!id) return '—';
        const branch = branches.find(item => item.id === id);
        return branch ? `${branch.code} — ${branch.name}` : id === session.user.branchId ? `Chi nhánh của tôi (${id})` : id;
    };

    useEffect(() => { onDirtyChange?.(needsAttention); }, [needsAttention, onDirtyChange]);
    useEffect(() => { onWorkingChange?.(working); }, [working, onWorkingChange]);
    useEffect(() => () => { onDirtyChange?.(false); onWorkingChange?.(false); }, [onDirtyChange, onWorkingChange]);
    useEffect(() => {
        if (!needsAttention && !working) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [needsAttention, working]);
    useEffect(() => {
        const controller = new AbortController();
        setMetadataReady(false); setMetadataError('');
        void Promise.all([loadDocumentIngredients(session, controller.signal), loadDocumentBranches(session, controller.signal)]).then(([ingredientRows, branchRows]) => {
            if (controller.signal.aborted) return;
            setIngredients(ingredientRows); setBranches(branchRows); setMetadataReady(true);
        }).catch(failure => { if (!controller.signal.aborted) setMetadataError(message(failure)); });
        return () => controller.abort();
    }, [session, metadataRevision]);
    useEffect(() => {
        const controller = new AbortController();
        setLoadingList(true); setListError(''); setResult({ items: [], page, total: 0 });
        void listDocuments(session, kind, page, filter, controller.signal).then(value => {
            if (!controller.signal.aborted) setResult(value);
        }).catch(failure => { if (!controller.signal.aborted) setListError(message(failure)); })
            .finally(() => { if (!controller.signal.aborted) setLoadingList(false); });
        return () => controller.abort();
    }, [session, kind, page, filter, listRevision]);
    useEffect(() => {
        const controller = new AbortController();
        setBalances([]); setBalanceAt(''); setBalanceError('');
        if ((!selected && !creating) || !form.branchId) return () => controller.abort();
        if (session.user.role !== 'ADMIN' && session.user.branchId !== form.branchId) {
            setBalanceError('Tồn nguồn thuộc chi nhánh khác; tài khoản này không có quyền xem.');
            return () => controller.abort();
        }
        void loadSourceBalances(session, form.branchId, controller.signal).then(value => {
            if (!controller.signal.aborted) { setBalances(value); setBalanceAt(new Date().toISOString()); }
        }).catch(failure => { if (!controller.signal.aborted) setBalanceError(message(failure)); });
        return () => controller.abort();
    }, [session, form.branchId, selected?.id, creating, balanceRevision]);

    const applyDocument = useCallback((value: StockDocument) => {
        const next = fromDocument(value);
        setSelected(value); setCreating(false); setForm(next); setBaseline(JSON.stringify(next)); setAttemptedCode('');
    }, []);
    async function openDocument(id: string) {
        if (lock.current || (dirty && !window.confirm('Bỏ các thay đổi chưa lưu để mở chứng từ khác?'))) return;
        if (!isDocumentId(id)) { setError('Mã định danh chứng từ không hợp lệ.'); return; }
        const request = ++selectionRequest.current;
        setLoadingDetail(true); setError(''); setNotice('');
        try {
            const value = await getDocument(session, kind, id);
            if (request === selectionRequest.current) { applyDocument(value); setUncertain(null); setRecoveryConflictId(null); }
        } catch (failure) { if (request === selectionRequest.current) setError(message(failure)); }
        finally { if (request === selectionRequest.current) setLoadingDetail(false); }
    }
    useEffect(() => {
        const selectionKey = `${kind}:${initialDocumentId}:${initialRequest ?? 0}`;
        if (!initialDocumentId || initialSeen.current === selectionKey) return;
        initialSeen.current = selectionKey;
        void openDocument(initialDocumentId);
        // An external selection is consumed once, so local typing never reloads it.
    }, [initialDocumentId, initialRequest, kind]);

    function startNew() {
        if (!writer || busy || uncertain || (dirty && !window.confirm('Bỏ các thay đổi chưa lưu để tạo phiếu mới?'))) return;
        selectionRequest.current += 1;
        const next = blankForm(session);
        setSelected(null); setCreating(true); setForm(next); setBaseline(JSON.stringify(next)); setAttemptedCode(''); setError(''); setNotice('');
    }
    function updateForm(values: Partial<Form>) { setForm(previous => ({ ...previous, ...values })); setNotice(''); }
    function updateLine(index: number, values: Partial<FormLine>) {
        setForm(previous => ({ ...previous, items: previous.items.map((line, current) => current === index ? { ...line, ...values } : line) }));
        setNotice('');
    }
    function inputForSave(): DocumentInput {
        const code = form.code.trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) throw new Error('Mã phiếu gồm 3–40 ký tự A–Z, 0–9, dấu gạch ngang hoặc gạch dưới.');
        if (!isDocumentId(form.branchId)) throw new Error('Chọn chi nhánh hợp lệ.');
        if (session.user.role !== 'ADMIN' && form.branchId !== session.user.branchId) throw new Error('Chỉ được lập phiếu cho chi nhánh của bạn.');
        if (kind === 'transfer' && (!isDocumentId(form.destinationBranchId) || form.destinationBranchId === form.branchId)) throw new Error('Chọn chi nhánh nhận khác chi nhánh nguồn.');
        if (!metadataReady) throw new Error('Tải danh mục nguyên liệu trước khi lưu.');
        if (!form.items.length || form.items.length > 50) throw new Error('Phiếu phải có từ 1 đến 50 dòng nguyên liệu.');
        const seen = new Set<string>();
        const items = form.items.map((line, index) => {
            const ingredient = ingredientById.get(line.ingredientId);
            if (!ingredient?.isActive) throw new Error(`Dòng ${index + 1}: chọn nguyên liệu đang hoạt động.`);
            if (seen.has(line.ingredientId)) throw new Error(`Dòng ${index + 1}: nguyên liệu đã có trên phiếu.`);
            seen.add(line.ingredientId);
            if (!quantityPattern.test(line.quantity) || scaled(line.quantity) <= 0n) throw new Error(`Dòng ${index + 1}: số lượng phải lớn hơn 0, tối đa 6 chữ số thập phân.`);
            if (ingredient.unit === 'piece' && scaled(line.quantity) % 1_000_000n !== 0n) throw new Error(`Dòng ${index + 1}: đơn vị piece phải là số nguyên.`);
            if (kind === 'receipt' && !costPattern.test(line.unitCost)) throw new Error(`Dòng ${index + 1}: đơn giá không âm, tối đa 4 chữ số thập phân.`);
            return { ingredientId: line.ingredientId, quantity: line.quantity, ...(kind === 'receipt' ? { unitCost: line.unitCost } : {}) };
        });
        return { code, branchId: form.branchId, ...(kind === 'transfer' ? { destinationBranchId: form.destinationBranchId } : {}),
            supplierName: form.supplierName.trim() || null, note: form.note.trim() || null, items };
    }
    async function save() {
        if (!editable || lock.current || uncertain) return;
        let input: DocumentInput;
        try { input = inputForSave(); } catch (failure) { setError(message(failure)); return; }
        const id = selected?.id;
        lock.current = true; setWorking(true); setError(''); setNotice('');
        if (!id) setAttemptedCode(input.code);
        // Keep the normalized unique code in the form for safe manual recovery.
        setForm(previous => ({ ...previous, code: input.code }));
        try {
            const value = await saveDocument(session, kind, input, id);
            applyDocument(value); setListRevision(value => value + 1); setNotice('Đã lưu bản nháp. Tồn kho chưa thay đổi.');
        } catch (failure) {
            setError(message(failure));
            if (uncertainFailure(failure)) setUncertain({ action: id ? 'save' : 'create', code: input.code, id, input });
            else if (!id) setAttemptedCode('');
        } finally { lock.current = false; setWorking(false); }
    }
    async function changeStatus(action: 'post' | 'cancel') {
        if (!selected || !writer || selected.status !== 'DRAFT' || lock.current || uncertain) return;
        if (dirty) { setError('Lưu hoặc bỏ thay đổi trước khi ghi sổ/hủy phiếu.'); return; }
        const consequence = kind === 'receipt' ? 'Tồn kho chi nhánh sẽ tăng.' : kind === 'issue' ? 'Tồn kho nguồn sẽ giảm.' : 'Tồn nguồn giảm và tồn đích tăng ngay trong cùng giao dịch. Xác nhận nhận hàng thực tế sau đó không cộng tồn lần nữa.';
        if (!window.confirm(action === 'post' ? `Ghi sổ phiếu ${selected.code}? ${consequence} Phiếu đã ghi sổ không thể sửa hoặc hủy.` : `Hủy bản nháp ${selected.code}? Thao tác này không thay đổi tồn kho.`)) return;
        lock.current = true; setWorking(true); setError(''); setNotice('');
        try {
            const value = await changeDocumentStatus(session, kind, selected.id, action);
            applyDocument(value); setListRevision(value => value + 1); setBalanceRevision(value => value + 1);
            setNotice(action === 'post' ? `Đã ghi sổ phiếu. ${consequence}` : 'Đã hủy bản nháp.');
        } catch (failure) {
            setError(message(failure));
            if (uncertainFailure(failure)) setUncertain({ action, id: selected.id, code: selected.code });
        } finally { lock.current = false; setWorking(false); }
    }
    async function reconcile() {
        if (!uncertain || lock.current) return;
        lock.current = true; setWorking(true); setError('');
        try {
            const value = uncertain.id ? await getDocument(session, kind, uncertain.id) : await findDocumentByCode(session, kind, uncertain.code);
            if (!value) {
                setNotice(`Chưa tìm thấy mã ${uncertain.code} trong danh sách hiện tại. Dữ liệu nhập vẫn được giữ. Có thể gửi lại cùng mã; máy chủ kiểm tra mã duy nhất.`);
                setUncertain(null);
            } else if (uncertain.action === 'create' || uncertain.action === 'save') {
                if (uncertain.input && matchesInput(value, uncertain.input, kind)) {
                    applyDocument(value); setNotice('Đã tìm thấy dữ liệu đã lưu trên máy chủ.'); setUncertain(null);
                } else {
                    setRecoveryConflictId(value.id);
                    setNotice(`Máy chủ đã có phiếu ${value.code}, trạng thái ${statuses[value.status]}, với nội dung khác. Nội dung nhập được giữ để đối chiếu. Chọn mở dữ liệu máy chủ sau khi đã lưu lại thông tin cần giữ.`);
                }
            } else {
                applyDocument(value); setUncertain(null);
                setNotice(`Trạng thái hiện tại: ${statuses[value.status]}. Chỉ thực hiện lại sau khi đã kiểm tra.`);
            }
            setListRevision(value => value + 1); setBalanceRevision(value => value + 1);
        } catch (failure) { setError(message(failure)); }
        finally { lock.current = false; setWorking(false); }
    }
    const sum = kind === 'receipt' ? form.items.reduce((total, line) => quantityPattern.test(line.quantity) && costPattern.test(line.unitCost) ? total + amount(line.quantity, line.unitCost) : total, 0n) : 0n;

    return <section className="w75-documents" aria-busy={working}>
        <header className="w75-documents-heading"><div><p className="w75-documents-eyebrow">CHỨNG TỪ KHO · {kind === 'receipt' ? 'B4' : 'B5'}</p><h2>{titles[kind]}</h2>
            <p>{kind === 'transfer' ? 'Ghi sổ điều chuyển cập nhật tồn nguồn và tồn đích ngay. Nhận hàng thực tế được đối chiếu riêng.' : 'Lưu bản nháp, kiểm tra chi tiết và xác nhận ghi sổ để cập nhật tồn kho.'}</p></div>
            {writer && <button className="w75-documents-primary" type="button" disabled={busy || Boolean(uncertain)} onClick={startNew}>Tạo phiếu</button>}</header>
        {!writer && <p className="w75-documents-info">Tài khoản này có quyền xem chứng từ trong phạm vi chi nhánh. {kind === 'transfer' ? 'Chỉ ADMIN được tạo, sửa, ghi sổ và hủy điều chuyển.' : 'ADMIN và quản lý chi nhánh được lập phiếu.'}</p>}
        {error && <p className="w75-documents-error" role="alert">{error}</p>}
        {notice && <p className="w75-documents-success" role="status">{notice}</p>}
        {metadataError && <div className="w75-documents-error" role="alert">Không tải được danh mục: {metadataError} <button type="button" disabled={busy} onClick={() => setMetadataRevision(value => value + 1)}>Tải lại danh mục</button></div>}
        {uncertain && <div className="w75-documents-warning" role="alert"><strong>Chưa xác định kết quả ghi dữ liệu.</strong><p>Nội dung đang được giữ. Kiểm tra máy chủ trước khi gửi lại; không tự động thử lại thao tác ghi. Mã đối chiếu: <code>{uncertain.code}</code>.</p>
            <button type="button" disabled={working} onClick={() => void reconcile()}>Kiểm tra lại trạng thái</button>
            {recoveryConflictId && <button type="button" disabled={busy} onClick={() => void openDocument(recoveryConflictId)}>Mở dữ liệu máy chủ</button>}</div>}
        <section className="w75-documents-panel" aria-label="Danh sách chứng từ">
            {listError && <p className="w75-documents-error" role="alert">{listError}</p>}
            <div className="w75-documents-controls">
                {session.user.role === 'ADMIN' && <label>{kind === 'receipt' ? 'Chi nhánh' : 'Chi nhánh nguồn'}<select disabled={busy} value={filter.branchId ?? ''} onChange={event => { setPage(1); setFilter(previous => ({ ...previous, branchId: event.target.value || undefined })); }}><option value="">Tất cả chi nhánh</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}{branch.isActive ? '' : ' (ngừng hoạt động)'}</option>)}</select></label>}
                {kind === 'transfer' && session.user.role === 'ADMIN' && <label>Chi nhánh nhận<select disabled={busy} value={filter.destinationBranchId ?? ''} onChange={event => { setPage(1); setFilter(previous => ({ ...previous, destinationBranchId: event.target.value || undefined })); }}><option value="">Tất cả chi nhánh</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}</select></label>}
                {kind !== 'receipt' && <label>Trạng thái<select disabled={busy} value={filter.status ?? ''} onChange={event => { setPage(1); setFilter(previous => ({ ...previous, status: (event.target.value || undefined) as DocumentFilter['status'] })); }}><option value="">Tất cả</option><option value="DRAFT">Bản nháp</option><option value="POSTED">Đã ghi sổ</option><option value="CANCELLED">Đã hủy</option></select></label>}
                <button type="button" disabled={busy || loadingList} onClick={() => setListRevision(value => value + 1)}>{loadingList ? 'Đang tải…' : 'Làm mới danh sách'}</button>
            </div>
            <div className="w75-documents-table-wrap"><table><thead><tr><th>Mã phiếu</th><th>{kind === 'receipt' ? 'Chi nhánh' : 'Nguồn'}</th>{kind === 'transfer' && <th>Đích</th>}<th>Trạng thái</th>{kind === 'transfer' && <th>Nhận hàng thực tế</th>}<th>Ngày tạo</th><th>Ghi sổ lúc</th><th /></tr></thead><tbody>
                {result.items.map(item => <tr key={item.id} className={selected?.id === item.id ? 'is-selected' : ''}>
                    <td><strong>{item.code}</strong></td><td>{branchLabel(item.branchId ?? item.sourceBranchId)}</td>{kind === 'transfer' && <td>{branchLabel(item.destinationBranchId)}</td>}
                    <td><span className={`w75-documents-status is-${item.status.toLowerCase()}`}>{statuses[item.status]}</span></td>
                    {kind === 'transfer' && <td>{receivingLabel(item)}{item.status === 'POSTED' && <>
                        {item.legacyReceivingRequired && <small className="w75-documents-shortage">Phiếu cũ</small>}
                        {item.transferReceipt && <small>Phiên bản {item.transferReceipt.version}{item.transferReceipt.status === 'CONFIRMED' ? ` · ${dateText(item.transferReceipt.confirmedAt)}` : ''}</small>}
                    </>}</td>}
                    <td>{dateText(item.createdAt)}</td><td>{dateText(item.postedAt)}</td><td><button type="button" disabled={busy || Boolean(uncertain)} onClick={() => void openDocument(item.id)}>Chi tiết</button></td>
                </tr>)}
            </tbody></table></div>
            {!loadingList && !listError && !result.items.length && <p className="w75-documents-muted">Không có chứng từ ở trang này.</p>}
            <div className="w75-documents-pagination"><button type="button" disabled={page <= 1 || loadingList || busy} onClick={() => setPage(value => value - 1)}>Trang trước</button><span>Trang {page}/{totalPages} · {result.total} phiếu · 50 phiếu/trang</span><button type="button" disabled={page >= totalPages || loadingList || busy} onClick={() => setPage(value => value + 1)}>Trang sau</button></div>
        </section>
        {loadingDetail && <p role="status">Đang tải chi tiết…</p>}
        {(selected || creating) && <section className="w75-documents-panel" aria-label="Chi tiết chứng từ">
            <div className="w75-documents-heading"><div><h3>{creating ? 'Lập bản nháp mới' : `${selected?.code} · ${selected ? statuses[selected.status] : ''}`}</h3><p>{dirty ? 'Có thay đổi chưa lưu.' : 'Nội dung đang trùng với bản đã tải.'}</p></div>{selected && <button type="button" disabled={busy || Boolean(uncertain)} onClick={() => void openDocument(selected.id)}>Tải lại chi tiết</button>}</div>
            <fieldset disabled={!editable || busy || Boolean(uncertain)} className="w75-documents-fieldset">
                <div className="w75-documents-grid"><label>Mã phiếu<input maxLength={40} value={form.code} disabled={!creating || Boolean(attemptedCode)} placeholder="VD: NK-20261121-001" onChange={event => updateForm({ code: event.target.value })} />{attemptedCode && <small>Giữ nguyên mã đã gửi để tránh tạo trùng sau lỗi kết nối.</small>}</label>
                    <label>{kind === 'receipt' ? 'Chi nhánh nhập' : 'Chi nhánh nguồn'}{session.user.role === 'ADMIN' ? <select value={form.branchId} disabled={!creating} onChange={event => updateForm({ branchId: event.target.value })}><option value="">Chọn chi nhánh</option>{branches.map(branch => <option key={branch.id} value={branch.id} disabled={!branch.isActive}>{branch.code} — {branch.name}{branch.isActive ? '' : ' (ngừng hoạt động)'}</option>)}</select> : <input value={branchLabel(form.branchId)} readOnly />}</label>
                    {kind === 'transfer' && <label>Chi nhánh nhận<select value={form.destinationBranchId} disabled={!creating} onChange={event => updateForm({ destinationBranchId: event.target.value })}><option value="">Chọn chi nhánh nhận</option>{branches.map(branch => <option key={branch.id} value={branch.id} disabled={!branch.isActive || branch.id === form.branchId}>{branch.code} — {branch.name}{branch.isActive ? '' : ' (ngừng hoạt động)'}</option>)}</select></label>}
                    {kind === 'receipt' && <label>Nhà cung cấp<input maxLength={160} value={form.supplierName} onChange={event => updateForm({ supplierName: event.target.value })} /></label>}
                </div>
                <label>Ghi chú<textarea rows={3} maxLength={500} value={form.note} onChange={event => updateForm({ note: event.target.value })} /></label>
                <div className="w75-documents-table-wrap"><table><thead><tr><th>Nguyên liệu</th><th>Đơn vị</th><th>Số lượng</th>{kind === 'receipt' && <><th>Đơn giá (VND/đơn vị)</th><th>Thành tiền (VND)</th></>}<th>Tồn {kind === 'receipt' ? 'chi nhánh' : 'nguồn'} gần nhất</th><th /></tr></thead><tbody>{form.items.map((line, index) => {
                    const ingredient = ingredientById.get(line.ingredientId);
                    const balance = balanceById.get(line.ingredientId);
                    const negativeBalance = Boolean(balanceAt) && scaled(balance?.quantity ?? '0') < 0n;
                    const enough = kind === 'receipt' || !balanceAt || !quantityPattern.test(line.quantity) || scaled(line.quantity) <= scaled(balance?.quantity ?? '0');
                    return <tr key={index}><td><select aria-label={`Nguyên liệu dòng ${index + 1}`} value={line.ingredientId} onChange={event => updateLine(index, { ingredientId: event.target.value })}><option value="">Chọn nguyên liệu</option>{line.ingredientId && !ingredient && <option value={line.ingredientId}>{line.ingredientId} (chưa tải được danh mục)</option>}{ingredients.map(item => <option key={item.id} value={item.id} disabled={!item.isActive || form.items.some((other, otherIndex) => otherIndex !== index && other.ingredientId === item.id)}>{item.code} — {item.name}{item.isActive ? '' : ' (ngừng hoạt động)'}</option>)}</select></td><td>{ingredient?.unit ?? '—'}</td><td><input className="w75-documents-number-input" aria-label={`Số lượng dòng ${index + 1}`} inputMode="decimal" value={line.quantity} onChange={event => updateLine(index, { quantity: event.target.value })} />{ingredient?.unit === 'piece' && <small>Số nguyên</small>}</td>{kind === 'receipt' && <><td><input className="w75-documents-number-input" aria-label={`Đơn giá dòng ${index + 1}`} inputMode="decimal" value={line.unitCost} onChange={event => updateLine(index, { unitCost: event.target.value })} /></td><td className="w75-documents-number">{quantityPattern.test(line.quantity) && costPattern.test(line.unitCost) ? amountText(amount(line.quantity, line.unitCost)) : '—'}</td></>}<td>{balanceAt && line.ingredientId ? normalizeDecimal(balance?.quantity ?? '0') : '—'}{negativeBalance && <small className="w75-documents-shortage">Đang âm tồn; cần đối chiếu số dư.</small>}{!enough && <small className="w75-documents-shortage">Số lượng vượt tồn đã tải; ghi sổ sẽ được máy chủ kiểm tra lại.</small>}</td><td>{editable && <button type="button" disabled={form.items.length <= 1} onClick={() => updateForm({ items: form.items.filter((_, current) => current !== index) })}>Xóa dòng</button>}</td></tr>;
                })}</tbody></table></div>
                {editable && <button type="button" disabled={form.items.length >= 50 || !metadataReady} onClick={() => updateForm({ items: [...form.items, blankLine()] })}>Thêm nguyên liệu ({form.items.length}/50)</button>}
            </fieldset>
            {kind === 'receipt' && <p className="w75-documents-total">Tổng giá trị dòng hợp lệ: <strong>{amountText(sum)} VND</strong></p>}
            <div className="w75-documents-stock-note"><p>{balanceAt ? `Tồn tải lúc ${dateText(balanceAt)}. Máy chủ kiểm tra tồn và quyền khi ghi sổ.` : balanceError || 'Đang tải tồn chi nhánh…'}</p><button type="button" disabled={busy || !form.branchId} onClick={() => setBalanceRevision(value => value + 1)}>Tải lại tồn</button></div>
            {selected && <details className="w75-documents-audit"><summary>Thông tin truy vết</summary><dl><dt>ID</dt><dd>{selected.id}</dd><dt>Người tạo (ID)</dt><dd>{selected.createdById ?? '—'}</dd><dt>Tạo lúc</dt><dd>{dateText(selected.createdAt)}</dd><dt>Cập nhật lúc</dt><dd>{dateText(selected.updatedAt)}</dd><dt>Người ghi sổ (ID)</dt><dd>{selected.postedById ?? '—'}</dd><dt>Ghi sổ lúc</dt><dd>{dateText(selected.postedAt)}</dd></dl></details>}
            <div className="w75-documents-actions">
                {editable && <button className="w75-documents-primary" type="button" disabled={busy || Boolean(uncertain) || !metadataReady || (!dirty && !creating)} onClick={() => void save()}>{working ? 'Đang xử lý…' : creating ? 'Lưu bản nháp mới' : 'Lưu thay đổi'}</button>}
                {writer && selected?.status === 'DRAFT' && <><button className="w75-documents-primary" type="button" disabled={busy || dirty || Boolean(uncertain)} onClick={() => void changeStatus('post')}>Xác nhận ghi sổ</button><button className="w75-documents-danger" type="button" disabled={busy || dirty || Boolean(uncertain)} onClick={() => void changeStatus('cancel')}>Hủy bản nháp</button></>}
                {kind === 'transfer' && selected?.status === 'POSTED' && onOpenReceiving && <>
                    <button type="button" disabled={busy || !receivingAllowed} aria-describedby={!receivingAllowed ? 'w75-transfer-receiving-scope' : undefined} onClick={() => { if (receivingAllowed) onOpenReceiving(selected.id); }}>Đối chiếu nhận hàng thực tế</button>
                    {!receivingAllowed && <p id="w75-transfer-receiving-scope" className="w75-documents-muted">Chỉ ADMIN hoặc tài khoản thuộc chi nhánh nhận được đối chiếu nhận hàng thực tế. Bạn đang xem phiếu điều chuyển đi từ chi nhánh của mình.</p>}
                </>}
            </div>
        </section>}
    </section>;
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import ExistingCatalog from '../App';
import { restoreSession, signIn, signOut, type AuthSession, type UserRole } from './auth';
import ReceivingPage from './receiving/ReceivingPage';
import ShiftStockCountPage from './shift/ShiftStockCountPage';
import PersistentSalesReportPage from './sales/PersistentSalesReportPage';
import AreaDashboard from './dashboard/AreaDashboard';
import ManagementPage from './management/ManagementPage';
import StockDocumentsPage from './stock-documents/StockDocumentsPage';
import { InventoryPage } from './inventory/InventoryPage';
import WarehousePage from './warehouse/WarehousePage';
import KitchenPage from './kitchen/KitchenPage';
import DistributionPage from './distribution/DistributionPage';
import AIAdvisoryPage from './ai4/AIAdvisoryPage';
import RecipeEvidencePage from './ai5/RecipeEvidencePage';
import SchedulingPage from './scheduling/SchedulingPage';
import AreaManagement from './management/AreaManagement';
import type { ForecastPlan } from './warehouse/warehouse.api';
import { SESSION_EXPIRED_EVENT } from './api';
import SessionRefresh from './SessionRefresh';
import { useWorkspaceForms } from './useWorkspaceForms';
import './WorkspaceApp.css';

type Section =
    | 'overview'
    | 'shift'
    | 'receiving'
    | 'sales'
    | 'reconciliation'
    | 'inventory'
    | 'delivery'
    | 'planning'
    | 'ai-forecast'
    | 'ai-evidence'
    | 'catalog'
    | 'branches'
    | 'users'
    | 'scheduling'
    | 'areas'
    | 'kitchen'
    | 'receipts'
    | 'issues'
    | 'transfers';

type NavItem = {
    id: Section;
    label: string;
    symbol: string;
    roles: UserRole[];
    detail: string;
};

const everyone: UserRole[] = ['ADMIN', 'BRANCH_MANAGER', 'STAFF'];
const managers: UserRole[] = ['ADMIN', 'BRANCH_MANAGER'];

const navigation: NavItem[] = [
    { id: 'kitchen', label: 'Kho bếp trung tâm', symbol: '♨', roles: ['ADMIN', 'STAFF'], detail: 'Nhập kho, pha chế và ghi nhận mẻ tại kho trung tâm' },
    { id: 'scheduling', label: 'Lịch làm việc', symbol: '▦', roles: everyone, detail: 'Đăng ký lịch rảnh và phân ca linh hoạt theo khu vực' },
    { id: 'overview', label: 'Tổng quan', symbol: '▦', roles: everyone, detail: 'Các công việc cần thực hiện theo vai trò' },
    { id: 'shift', label: 'Chốt ca & kiểm kê', symbol: '▤', roles: everyone, detail: 'Nhập nguyên liệu còn lại cuối ca, gửi và duyệt kiểm kê (B6)' },
    { id: 'receiving', label: 'Nhận hàng đầu ca', symbol: '◫', roles: everyone, detail: 'Đối chiếu hàng giao và hàng thực nhận' },
    { id: 'sales', label: 'Báo cáo bán hàng', symbol: '▥', roles: everyone, detail: 'Nhập số ly bán theo sản phẩm và kích cỡ như biểu mẫu Excel' },
    { id: 'reconciliation', label: 'Đối soát tiền', symbol: '◈', roles: managers, detail: 'Đối chiếu doanh thu lý thuyết và tiền thực tế' },
    { id: 'inventory', label: 'Kho & tồn nguyên liệu', symbol: '▧', roles: everyone, detail: 'Số dư và lịch sử biến động kho B3' },
    { id: 'receipts', label: 'Nhập hàng nhà cung cấp', symbol: '↓', roles: everyone, detail: 'Phiếu nhập hàng B4' },
    { id: 'issues', label: 'Xuất kho', symbol: '↑', roles: everyone, detail: 'Phiếu xuất kho B5' },
    { id: 'transfers', label: 'Chuyển kho', symbol: '⇄', roles: everyone, detail: 'Phiếu chuyển kho và tình trạng nhận hàng' },
    { id: 'delivery', label: 'Điều phối giao hàng', symbol: '↗', roles: everyone, detail: 'Giao hàng từ kho trung tâm đến các quầy và xác nhận thực nhận' },
    { id: 'planning', label: 'Đề xuất bổ sung', symbol: '▥', roles: ['ADMIN'], detail: 'Dự báo theo chi nhánh, ca và loại ngày (B7)' },
    { id: 'ai-forecast', label: 'Dự báo AI', symbol: '✦', roles: ['ADMIN'], detail: 'So sánh AI2 và B7, khoảng bất định và cảnh báo dữ liệu' },
    { id: 'ai-evidence', label: 'Bằng chứng công thức AI', symbol: '✓', roles: ['ADMIN'], detail: 'Xác nhận công thức lịch sử cho báo cáo bán hàng đã duyệt' },
    { id: 'catalog', label: 'Danh mục sản phẩm', symbol: '▦', roles: ['ADMIN'], detail: 'Nguyên liệu, sản phẩm và công thức B2' },
    { id: 'areas', label: 'Khu vực', symbol: '◎', roles: ['ADMIN'], detail: 'Quản lý khu vực, quầy và phân công nhân sự' },
    { id: 'branches', label: 'Chi nhánh', symbol: '⌂', roles: ['ADMIN'], detail: 'Quản lý chi nhánh B1' },
    { id: 'users', label: 'Tài khoản nhân viên', symbol: '♙', roles: ['ADMIN'], detail: 'Quản lý nhân sự và phân quyền B1' },
];

function roleName(role: UserRole, workKind?: string): string {
    if (role === 'ADMIN') return 'Quản trị hệ thống';
    if (role === 'BRANCH_MANAGER') return 'Quản lý khu vực';
    return workKind === 'KITCHEN_DELIVERY' ? 'Nhân viên kho/giao hàng' : 'Nhân viên quầy';
}

function StartingPage({ role, onOpen }: { role: UserRole; onOpen: (section: Section) => void }) {
    const options: { section: Section; kicker: string; title: string; description: string }[] = [
        { section: 'shift', kicker: 'CUỐI CA', title: 'Kiểm kê nguyên liệu', description: 'Nhập số lượng còn lại và gửi phiếu cho quản lý.' },
        { section: 'receiving', kicker: 'ĐẦU CA', title: 'Xác nhận nhận hàng', description: 'Đối chiếu thực nhận với phiếu giao của kho.' },
        { section: 'sales', kicker: 'BÁO CÁO', title: 'Ghi nhận số ly bán', description: 'Nhập sản phẩm, size và ghi chú trong buổi.' },
        { section: role === 'ADMIN' ? 'planning' : role === 'BRANCH_MANAGER' ? 'inventory' : 'shift', kicker: 'PHỐI HỢP', title: role === 'ADMIN' ? 'Chuẩn bị hàng cho ca tới' : role === 'BRANCH_MANAGER' ? 'Theo dõi tồn chi nhánh' : 'Theo dõi phiếu chốt ca', description: role === 'ADMIN' ? 'Kiểm tra dự báo và lượng tồn các chi nhánh.' : role === 'BRANCH_MANAGER' ? 'Đối chiếu số dư và các chứng từ kho.' : 'Xem lại số liệu đã nhập.' },
    ];

    return (
        <>
            <div className="wh-heading">
                <div><p className="wh-eyebrow">WORKSPACE / TỔNG QUAN</p><h2>Công việc hằng ngày</h2></div>
                <span className="wh-soft-badge">Dựa trên biểu mẫu khu vực</span>
            </div>
            <p className="wh-intro">Mở ca kiểm kê, nhận hàng và báo cáo bán hàng của chi nhánh được phân công. Các mục kho và chứng từ cho phép xem theo quyền máy chủ.</p>
            <div className="wh-card-grid">
                {options.map(item => (
                    <button className="wh-work-card" type="button" key={`${item.section}-${item.kicker}`} onClick={() => onOpen(item.section)}>
                        <span className="wh-eyebrow">{item.kicker}</span>
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                        <span className="wh-card-action">Mở khu vực →</span>
                    </button>
                ))}
            </div>
            <div className="wh-note"><strong>Dữ liệu vận hành:</strong> các biểu mẫu đọc và lưu qua API. Báo cáo bán hàng không tự trừ nguyên liệu; xác nhận nhận hàng không ghi sổ lại phiếu chuyển kho.</div>
        </>
    );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const submitLock = useRef(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitLock.current) return;
        submitLock.current = true;
        setError('');
        setBusy(true);
        try {
            const session = await signIn(email, password);
            setPassword('');
            onAuthenticated(session);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập.');
        } finally {
            submitLock.current = false;
            setBusy(false);
        }
    }

    return (
        <div className="wh-login-screen">
            <section className="wh-login-story">
                <div className="wh-brand"><span className="wh-brand-mark">W</span><span>WAVEHOUSE <small>MANAGEMENT</small></span></div>
                <div>
                    <p className="wh-eyebrow">QUẢN LÝ VẬN HÀNH CHUỖI CỬA HÀNG</p>
                    <h1>Mọi ca bán đều có số liệu rõ ràng.</h1>
                    <p>Từ xác nhận hàng đầu ca, kiểm kê cuối ca đến đề xuất kho chuẩn bị nguyên liệu cho ngày tiếp theo.</p>
                </div>
                <span className="wh-story-footer">WaveHouse • Internal workspace</span>
            </section>
            <section className="wh-login-panel">
                <form className="wh-login-form" onSubmit={submit}>
                    <p className="wh-eyebrow">CHÀO MỪNG TRỞ LẠI</p>
                    <h2>Đăng nhập</h2>
                    <p className="wh-muted">Sử dụng tài khoản nhân viên được cấp trong hệ thống.</p>
                    <label htmlFor="wh-email">Email</label>
                    <input id="wh-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="email@congty.vn" />
                    <label htmlFor="wh-password">Mật khẩu</label>
                    <input id="wh-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Nhập mật khẩu" />
                    {error && <p role="alert" className="wh-error">{error}</p>}
                    <button type="submit" className="wh-primary" disabled={busy}>{busy ? 'Đang xác thực…' : 'Đăng nhập →'}</button>
                    <p className="wh-form-hint">Không có chức năng tự đăng ký. Quản trị viên tạo tài khoản và phân quyền khu vực hoặc kho trung tâm.</p>
                </form>
            </section>
        </div>
    );
}

export default function WorkspaceApp() {
    const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
    const [active, setActive] = useState<Section>('overview');
    const [visited, setVisited] = useState<Set<Section>>(() => new Set(['sales']));
    const [expired, setExpired] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [plan, setPlan] = useState<ForecastPlan | null>(null);
    const [warehouseMode, setWarehouseMode] = useState<'planning' | 'delivery'>('planning');
    const [transferId, setTransferId] = useState<string | null>(null);
    const [receivingId, setReceivingId] = useState<string | null>(null);
    const [transferRequest, setTransferRequest] = useState(0);
    const [receivingRequest, setReceivingRequest] = useState(0);
    const forms = useWorkspaceForms();
    const logoutLock = useRef(false);

    useEffect(() => {
        let mounted = true;
        void restoreSession().then(result => { if (mounted) setSession(result); });
        return () => { mounted = false; };
    }, []);
    useEffect(() => {
        const onExpired = (event: Event) => {
            const detail = (event as CustomEvent<{ matches?: (token: string) => boolean }>).detail;
            if (session && detail?.matches?.(session.token)) setExpired(true);
        };
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    }, [session]);

    function navigate(section: Section): boolean {
        if (!session || forms.working || logoutLock.current || !navigation.some(item => item.id === section && item.roles.includes(session.user.role) &&
            !(session.user.role === 'STAFF' && session.user.workKind === 'KITCHEN_DELIVERY' &&
            ['sales', 'reconciliation', 'scheduling', 'shift'].includes(item.id)) &&
            !(session.user.role === 'STAFF' && session.user.workKind !== 'KITCHEN_DELIVERY' && item.id === 'kitchen'))) return false;
        setActive(section);
        setVisited(previous => new Set(previous).add(section));
        if (section === 'planning' || section === 'delivery') setWarehouseMode(section);
        return true;
    }
    function authenticated(value: AuthSession) {
        forms.reset(); setExpired(false); setSession(value); setActive('overview');
        setVisited(new Set(['sales'])); setPlan(null); setTransferId(null); setReceivingId(null);
    }
    if (session === undefined) return <div className="wh-loading" role="status">Đang kiểm tra phiên làm việc…</div>;
    if (session === null) return <LoginScreen onAuthenticated={authenticated} />;

    const isCentralStaff = session.user.role === 'STAFF' && session.user.workKind === 'KITCHEN_DELIVERY';
    const allowed = navigation.filter(item => item.roles.includes(session.user.role) &&
        !(isCentralStaff && ['sales', 'reconciliation', 'scheduling', 'shift'].includes(item.id)) &&
        !(session.user.role === 'STAFF' && !isCentralStaff && item.id === 'kitchen'));
    const selected = allowed.find(item => item.id === active) ?? allowed[0];
    async function logout() {
        if (logoutLock.current || forms.working || (forms.dirty && !window.confirm('Có dữ liệu chưa lưu hoặc kết quả ghi cần đối chiếu. Đăng xuất sẽ đóng các biểu mẫu đang mở. Bạn đã lưu/sao lưu và muốn đăng xuất?'))) return;
        logoutLock.current = true; setLoggingOut(true);
        try { await signOut(session!.token); }
        catch { /* The single local token store is cleared even if logout cannot reach the server. */ }
        finally {
            forms.reset(); setSession(null); setActive('overview'); setExpired(false);
            setVisited(new Set(['sales'])); setPlan(null); setTransferId(null); setReceivingId(null);
            logoutLock.current = false; setLoggingOut(false);
        }
    }
    function openTransfer(id: string) { if (navigate('transfers')) { setTransferId(id); setTransferRequest(value => value + 1); } }
    function openReceiving(id: string) { if (navigate('receiving')) { setReceivingId(id); setReceivingRequest(value => value + 1); } }

    return <div className="wh-root">
        <aside className="wh-sidebar">
            <div className="wh-brand"><span className="wh-brand-mark">W</span><span>WAVEHOUSE <small>MANAGEMENT</small></span></div>
            <p className="wh-sidebar-label">ĐIỀU HÀNH</p>
            <nav aria-label="Điều hướng chính" className="wh-nav">
                {allowed.map(item => <button key={item.id} type="button" disabled={forms.working || loggingOut}
                    aria-current={selected.id === item.id ? 'page' : undefined} className={`wh-nav-item ${selected.id === item.id ? 'is-active' : ''}`}
                    onClick={() => navigate(item.id)}><span className="wh-nav-symbol" aria-hidden="true">{item.symbol}</span><span>{item.label}</span></button>)}
            </nav>
            <div className="wh-sidebar-bottom"><span className="wh-live-dot" /> Nội bộ · Quản lý vận hành</div>
        </aside>
        <div className="wh-main">
            <header className="wh-topbar">
                <div><p className="wh-eyebrow">WAVEHOUSE / VẬN HÀNH</p><h1>{selected.label}</h1></div>
                <div className="wh-account"><span className="wh-avatar">{(session.user.displayName || session.user.email || 'W').slice(0, 1).toUpperCase()}</span>
                    <div><strong>{session.user.displayName || session.user.email}</strong><small>{roleName(session.user.role, session.user.workKind)}</small></div>
                    <button type="button" disabled={loggingOut || forms.working} onClick={() => { void logout(); }} className="wh-logout">{loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</button></div>
            </header>
            <main className="wh-content">
                {expired && <SessionRefresh session={session} onRestored={value => { setSession(value); setExpired(false); }} />}
                {forms.dirty && <p className="wh-editor-notice" role="status">Có biểu mẫu chưa lưu hoặc kết quả cần đối chiếu. Chuyển menu giữ nguyên dữ liệu trong phiên; đăng xuất/tải lại có thể mất thay đổi chưa lưu.</p>}
                <fieldset className="wh-workspace-pages" disabled={expired || loggingOut}>
                    {/* One persistent editor serves both sales and cash reconciliation. */}
                    {!isCentralStaff && <div hidden={selected.id !== 'sales' && selected.id !== 'reconciliation'}>
                        <PersistentSalesReportPage key={session.user.id} session={session}
                            mode={selected.id === 'reconciliation' ? 'reconciliation' : 'sales'}
                            onUnsavedChange={forms.callbacks.sales.onDirtyChange} onWorkingChange={forms.callbacks.sales.onWorkingChange} />
                    </div>}
                    {selected.id === 'overview' && (isCentralStaff
                        ? <section className="wh-kitchen-card"><h2>Công việc tại kho trung tâm</h2><p>Nhập nguyên liệu, chuẩn bị mẻ và ghi sổ tồn kho.</p><button className="wh-primary" type="button" onClick={() => navigate('kitchen')}>Mở kho bếp trung tâm</button></section>
                        : session.user.role === 'STAFF' ? <StartingPage role={session.user.role} onOpen={navigate} />
                        : <AreaDashboard session={session} onNavigate={navigate} />)}
                    {visited.has('kitchen') && <div hidden={selected.id !== 'kitchen'}><KitchenPage session={session} /></div>}
                    {visited.has('delivery') && <div hidden={selected.id !== 'delivery'}><DistributionPage session={session} /></div>}
                    {visited.has('scheduling') && <div hidden={selected.id !== 'scheduling'}><SchedulingPage session={session} /></div>}
                    {visited.has('shift') && <div hidden={selected.id !== 'shift'}><ShiftStockCountPage session={session} {...forms.callbacks.shift} /></div>}
                    {visited.has('receiving') && <div hidden={selected.id !== 'receiving'}><ReceivingPage session={session} initialTransferId={receivingId} initialRequest={receivingRequest}
                        onUnsavedChange={forms.callbacks.receiving.onDirtyChange} onWorkingChange={forms.callbacks.receiving.onWorkingChange} /></div>}
                    {visited.has('inventory') && <div hidden={selected.id !== 'inventory'}><InventoryPage session={session} /></div>}
                    {(['receipt', 'issue', 'transfer'] as const).map((kind, index) => {
                        const section = (['receipts', 'issues', 'transfers'] as const)[index];
                        return visited.has(section) && <div key={kind} hidden={selected.id !== section}>
                            <StockDocumentsPage session={session} kind={kind} {...forms.callbacks[kind]}
                                initialDocumentId={kind === 'transfer' ? transferId : null} initialRequest={transferRequest} onOpenReceiving={openReceiving} />
                        </div>;
                    })}
                    {session.user.role === 'ADMIN' && <>
                        {visited.has('planning') && <div hidden={selected.id !== 'planning'}>
                            <WarehousePage session={session} mode={warehouseMode} plan={plan} onPlanChange={setPlan} {...forms.callbacks.warehouse}
                                onOpenTransfer={openTransfer} onOpenPlanning={() => navigate('planning')} />
                        </div>}
                        {visited.has('ai-forecast') && <div hidden={selected.id !== 'ai-forecast'}><AIAdvisoryPage session={session} /></div>}
                        {visited.has('ai-evidence') && <div hidden={selected.id !== 'ai-evidence'}><RecipeEvidencePage session={session} /></div>}
                        {visited.has('catalog') && <div className="wh-catalog-wrap" hidden={selected.id !== 'catalog'}><ExistingCatalog session={session} {...forms.callbacks.catalog} /></div>}
                        {visited.has('areas') && <div hidden={selected.id !== 'areas'}><AreaManagement session={session} /></div>}
                        {(['branches', 'users'] as const).map(mode => visited.has(mode) && <div key={mode} hidden={selected.id !== mode}>
                            <ManagementPage session={session} mode={mode} {...forms.callbacks[mode]} />
                        </div>)}
                    </>}
                </fieldset>
            </main>
        </div>
    </div>;
}

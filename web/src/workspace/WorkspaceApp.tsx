import { useEffect, useState, type FormEvent } from 'react';
import ExistingCatalog from '../App';
import { restoreSession, signIn, signOut, type AuthSession, type UserRole } from './auth';
import ReceivingPage from './receiving/ReceivingPage';
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
    | 'catalog'
    | 'people';

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
    { id: 'overview', label: 'Tổng quan', symbol: '▦', roles: everyone, detail: 'Các công việc cần thực hiện theo vai trò' },
    { id: 'shift', label: 'Chốt ca & kiểm kê', symbol: '▤', roles: everyone, detail: 'Nhập nguyên liệu còn lại cuối ca, gửi và duyệt kiểm kê (B6)' },
    { id: 'receiving', label: 'Nhận hàng đầu ca', symbol: '◫', roles: everyone, detail: 'Đối chiếu hàng giao và hàng thực nhận' },
    { id: 'sales', label: 'Báo cáo bán hàng', symbol: '▥', roles: everyone, detail: 'Nhập số ly bán theo sản phẩm và kích cỡ như biểu mẫu Excel' },
    { id: 'reconciliation', label: 'Đối soát tiền', symbol: '◈', roles: managers, detail: 'Đối chiếu doanh thu lý thuyết và tiền thực tế' },
    { id: 'inventory', label: 'Kho & tồn nguyên liệu', symbol: '▧', roles: managers, detail: 'Xem tồn và chứng từ nhập, xuất, chuyển kho (B3–B5)' },
    { id: 'delivery', label: 'Điều phối giao hàng', symbol: '↗', roles: ['ADMIN'], detail: 'Lập danh sách hàng cần giao và theo dõi giao nhận' },
    { id: 'planning', label: 'Đề xuất bổ sung', symbol: '▥', roles: ['ADMIN'], detail: 'Dự báo theo chi nhánh, ca và loại ngày (B7)' },
    { id: 'catalog', label: 'Danh mục sản phẩm', symbol: '▦', roles: ['ADMIN'], detail: 'Module Catalog đã có sẵn trong web/src/App.tsx' },
    { id: 'people', label: 'Chi nhánh & nhân viên', symbol: '♙', roles: ['ADMIN'], detail: 'Quản lý tài khoản và chi nhánh (B2)' },
];

function roleName(role: UserRole): string {
    if (role === 'ADMIN') return 'Quản trị hệ thống';
    if (role === 'BRANCH_MANAGER') return 'Quản lý chi nhánh';
    return 'Nhân viên quầy';
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
            <p className="wh-intro">Giao diện được tổ chức theo công việc thực tế của quầy bán hàng, kho và quản lý. Các bước chưa có API sẽ được hoàn thiện ở giai đoạn tiếp theo.</p>
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
            <div className="wh-note"><strong>Nguyên tắc dữ liệu:</strong> chưa hiển thị doanh thu, tồn kho hoặc số đơn giả. Dashboard thật sẽ đọc dữ liệu Aiven qua API, không lấy số minh họa làm số liệu vận hành.</div>
        </>
    );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        setBusy(true);
        try {
            const session = await signIn(email, password);
            setPassword('');
            onAuthenticated(session);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập.');
        } finally {
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
                    <p className="wh-form-hint">Không có chức năng tự đăng ký. Quản trị viên tạo tài khoản và phân quyền chi nhánh.</p>
                </form>
            </section>
        </div>
    );
}

export default function WorkspaceApp() {
    // Undefined = restoring stored session; null = guest.
    const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
    const [active, setActive] = useState<Section>('overview');

    useEffect(() => {
        let mounted = true;
        void restoreSession().then(result => {
            if (mounted) setSession(result);
        });
        return () => { mounted = false; };
    }, []);

    if (session === undefined) {
        return <div className="wh-loading" role="status">Đang kiểm tra phiên làm việc…</div>;
    }
    if (session === null) {
        return <LoginScreen onAuthenticated={value => { setSession(value); setActive('overview'); }} />;
    }

    const allowed = navigation.filter(item => item.roles.includes(session.user.role));
    const selected = allowed.find(item => item.id === active) ?? allowed[0];

    async function logout() {
        try {
            await signOut(session!.token);
        } catch {
            // Server is unreachable: local session still clears.
        } finally {
            setSession(null);
            setActive('overview');
        }
    }

    return (
        <div className="wh-root">
            <aside className="wh-sidebar">
                <div className="wh-brand"><span className="wh-brand-mark">W</span><span>WAVEHOUSE <small>MANAGEMENT</small></span></div>
                <p className="wh-sidebar-label">ĐIỀU HÀNH</p>
                <nav aria-label="Điều hướng chính" className="wh-nav">
                    {allowed.map(item => (
                        <button key={item.id} type="button" aria-current={selected?.id === item.id ? 'page' : undefined} className={`wh-nav-item ${selected?.id === item.id ? 'is-active' : ''}`} onClick={() => setActive(item.id)}>
                            <span className="wh-nav-symbol" aria-hidden="true">{item.symbol}</span><span>{item.label}</span>
                        </button>
                    ))}
                </nav>
                <div className="wh-sidebar-bottom"><span className="wh-live-dot" /> Nội bộ • API qua Vite proxy</div>
            </aside>
            <div className="wh-main">
                <header className="wh-topbar">
                    <div><p className="wh-eyebrow">WAVEHOUSE / VẬN HÀNH</p><h1>{selected?.label ?? 'Tổng quan'}</h1></div>
                    <div className="wh-account"><span className="wh-avatar">{(session.user.displayName || session.user.email || 'W').slice(0, 1).toUpperCase()}</span><div><strong>{session.user.displayName || session.user.email || 'Người dùng'}</strong><small>{roleName(session.user.role)}</small></div><button type="button" onClick={() => { void logout(); }} className="wh-logout">Đăng xuất</button></div>
                </header>
                <main className="wh-content">
                    {selected?.id === 'overview' ? (
                        <StartingPage role={session.user.role} onOpen={setActive} />
                    ) : selected?.id === 'receiving' ? (
            <ReceivingPage session={session} />
          ) : selected?.id === 'catalog' ? (
                        <div className="wh-catalog-wrap">
                            <div className="wh-note"><strong>Catalog hiện có:</strong> giữ nguyên module cũ. Nếu request Catalog trả 401, bước tích hợp kế tiếp sẽ gắn Bearer token vào client tại <code>src/api/catalog.ts</code>.</div>
                            <ExistingCatalog />
                        </div>
                    ) : (
                        <div className="wh-section-page">
                            <p className="wh-eyebrow">{selected?.label.toUpperCase()}</p>
                            <h2>{selected?.label}</h2>
                            <p>{selected?.detail}</p>
                            <span className="wh-soft-badge">Giao diện nghiệp vụ đang xây dựng</span>
                            <div className="wh-next-box"><strong>Bước tiếp theo</strong><p>{selected?.id === 'shift' ? 'Kết nối GET /api/shift-stock-counts/template, tạo phiếu và gửi duyệt từ form kiểm kê B6.' : selected?.id === 'planning' ? 'Kết nối GET /api/restock-planning/recommendations và đối chiếu tồn thực tế trước khi lập phiếu B5.' : 'Dựng biểu mẫu theo file Excel của khu vực và bổ sung API còn thiếu. Không lưu dữ liệu giả.'}</p></div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

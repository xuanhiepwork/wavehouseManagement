import { useRef, useState, type FormEvent } from 'react';
import { signIn, type AuthSession } from './auth';

export default function SessionRefresh({ session, onRestored }: { session: AuthSession; onRestored: (value: AuthSession) => void }) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const lock = useRef(false);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try {
            const next = await signIn(session.user.email, password, session.user.id, session.user);
            setPassword('');
            onRestored(next);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không xác thực được tài khoản.'); }
        finally { lock.current = false; setBusy(false); }
    }
    return <section className="wh-session-refresh" aria-label="Xác thực lại phiên làm việc">
        <p role="alert">Phiên đã hết hạn hoặc không hợp lệ. Các biểu mẫu đang mở được giữ trong phiên này. Xác thực lại bằng cùng tài khoản để tiếp tục.</p>
        <form onSubmit={event => { void submit(event); }}>
            <label>Email <input type="email" autoComplete="username" value={session.user.email} readOnly /></label>
            <label>Mật khẩu <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
            <button type="submit" disabled={busy}>{busy ? 'Đang xác thực…' : 'Xác thực lại'}</button>
        </form>
        {error && <p role="alert">{error}</p>}
    </section>;
}

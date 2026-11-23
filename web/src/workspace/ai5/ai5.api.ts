/** AI5 ADMIN-only attestation UI. Uses the existing authenticated Express API. */
import type { AuthSession } from '../auth';
import { sessionFetch } from '../api';

export type EvidenceSummary = {
    id: string;
    branchId: string;
    businessDate: string;
    shift: 'MORNING' | 'AFTERNOON' | 'EVENING';
    version: number;
    approvedRevisionNumber: number;
    totalLines: number;
    attestedLines: number;
    consistent: boolean;
};
export type RecipeCandidate = {
    recipeId: string;
    version: number;
    createdAt: string;
    ingredients: { ingredientId: string; name: string; unit: string; quantity: string }[];
};
export type EvidenceLine = {
    salesLineId: string;
    productId: string | null;
    productName: string;
    size: string;
    quantity: number;
    evidence: { id: string; recipeId: string; attestedAt: string } | null;
    candidates: RecipeCandidate[];
};
export type EvidenceDetail = {
    reportId: string;
    branchId: string;
    businessDate: string;
    shift: EvidenceSummary['shift'];
    version: number;
    revisionNumber: number;
    needsExplicitHistoricalAttestation: true;
    lines: EvidenceLine[];
};
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const dateString = /^\d{4}-\d{2}-\d{2}$/;

async function callApi(session: AuthSession, path: string, options: RequestInit = {}): Promise<unknown> {
    if (session.user.role !== 'ADMIN') throw new Error('Chỉ ADMIN được quản lý bằng chứng công thức.');
    const response = await sessionFetch(session, path, options);
    const text = await response.text();
    if (text.length > 3_000_000) throw new Error('Phản hồi từ API vượt giới hạn.');
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch { throw new Error(`API trả JSON không hợp lệ (HTTP ${response.status}).`); }
    if (!response.ok) {
        const raw = object(payload) ? payload.error : null;
        throw new Error(typeof raw === 'string' && raw.length < 400 ? raw : `Không hoàn tất yêu cầu (HTTP ${response.status}).`);
    }
    return payload;
}

export async function listEvidence(session: AuthSession, branchId: string, from: string, to: string): Promise<EvidenceSummary[]> {
    if (!uuid.test(branchId) || !dateString.test(from) || !dateString.test(to) || from > to) {
        throw new Error('Chọn chi nhánh và khoảng ngày hợp lệ.');
    }
    const query = new URLSearchParams({ branchId, from, to });
    const result = await callApi(session, `/restock-planning/ai-evidence?${query}`);
    if (!object(result) || !Array.isArray(result.items)) throw new Error('Danh sách bằng chứng sai định dạng.');
    return result.items as EvidenceSummary[];
}

export async function detailEvidence(session: AuthSession, reportId: string): Promise<EvidenceDetail> {
    if (!uuid.test(reportId)) throw new Error('ID báo cáo không hợp lệ.');
    const result = await callApi(session, `/restock-planning/ai-evidence/${reportId}`);
    if (!object(result) || !object(result.data) || !Array.isArray(result.data.lines)) {
        throw new Error('Chi tiết bằng chứng sai định dạng.');
    }
    return result.data as EvidenceDetail;
}

export async function attestEvidence(
    session: AuthSession, detail: EvidenceDetail, mappings: Record<string, string>, note: string,
): Promise<void> {
    if (!uuid.test(detail.reportId) || !Number.isInteger(detail.version) || detail.version < 1
        || !Number.isInteger(detail.revisionNumber) || detail.revisionNumber < 1) {
        throw new Error('Dữ liệu phiên bản báo cáo không hợp lệ.');
    }
    const lines = detail.lines.filter(item => item.quantity > 0);
    if (!lines.length || lines.some(item => item.evidence || !uuid.test(mappings[item.salesLineId] ?? '')
        || !item.candidates.some(candidate => candidate.recipeId === mappings[item.salesLineId]))) {
        throw new Error('Mỗi dòng bán phải chọn một công thức hợp lệ và chưa xác nhận.');
    }
    if (note.trim().length < 10 || note.trim().length > 500) {
        throw new Error('Ghi rõ chứng cứ đối chiếu công thức (10–500 ký tự).');
    }
    await callApi(session, `/restock-planning/ai-evidence/${detail.reportId}/attest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            expectedVersion: detail.version,
            expectedRevisionNumber: detail.revisionNumber,
            acknowledgement: 'I_VERIFIED_THE_RECIPE_USED_DURING_THIS_SHIFT',
            note: note.trim(),
            lines: lines.map(item => ({ salesLineId: item.salesLineId, recipeId: mappings[item.salesLineId] })),
        }),
    });
}

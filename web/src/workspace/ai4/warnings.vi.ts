/** Presentation-only Vietnamese descriptions of current B7/AI3 warnings.
 * Preserve the raw machine-readable warnings in the API contract. */
const exact: Record<string, string> = {
    'Delivery proposals still come from B7; AI demand estimates do not recalculate dispatch quantities.':
        'Số lượng đề xuất giao vẫn lấy từ B7; dự báo AI không tự điều chỉnh lượng điều phối.',
    'AI overlay supports at most ten destinations per B7 plan.':
        'Mỗi kế hoạch B7 chỉ hỗ trợ tối đa 10 chi nhánh nhận khi so sánh với AI.',
    'Recommendations require warehouse approval.':
        'Các đề xuất cần được quản lý kho phê duyệt trước khi thực hiện.',
    'Consumption includes unexplained stock loss.':
        'Mức tiêu hao có thể bao gồm hao hụt tồn kho chưa xác định nguyên nhân.',
    'Sparse history uses heuristic or minimum stock.':
        'Khi dữ liệu lịch sử còn ít, hệ thống sử dụng quy tắc dự báo hoặc mức tồn tối thiểu.',
    'Delivery times must follow branch shift schedules.':
        'Giờ giao hàng cần phù hợp với lịch làm việc của chi nhánh.',
};

export function vietnameseWarning(raw: string): string {
    const warning = raw.trim();
    if (exact[warning]) return exact[warning];
    const history = /^Verified historical export is unavailable for branch ([a-f\d-]{36})\.$/i.exec(warning);
    if (history) return `Chi nhánh ${history[1]} chưa có dữ liệu lịch sử được xác minh để chạy dự báo AI.`;
    const unavailable = /^AI3 unavailable for branch ([a-f\d-]{36}); B7 remains active \(([A-Z0-9_]+)\)\.$/i.exec(warning);
    if (unavailable) return `Không thể truy cập dịch vụ AI tại chi nhánh ${unavailable[1]}; hệ thống tiếp tục dùng dự báo B7 (mã: ${unavailable[2]}).`;
    // Keep already-Vietnamese B7 notes, without hiding their meaning.
    if (/[À-ỹà-ỹĐđ]/u.test(warning) && warning.length <= 500) return warning;
    // Do not show arbitrary backend English, URLs or sensitive adapter messages in the UI.
    return 'Có cảnh báo từ nguồn dữ liệu chưa được Việt hóa. Cần kiểm tra nhật ký hệ thống để biết chi tiết.';
}

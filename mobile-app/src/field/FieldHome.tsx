import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { fieldApi } from './field.api.ts';
import { Header, Panel, Page, Copy, Warning, LoadControl, Status, businessToday, formatShift, useFieldRead, ux } from './field.ui.tsx';
import type { WorkContext } from './field.types.ts';
const roleName = {ADMIN:'Quản trị',BRANCH_MANAGER:'Quản lý khu',STAFF:'Nhân viên'};
function Tile({to,label,detail}: {to:Href;label:string;detail:string}) {
  return <Link href={to} asChild><Pressable accessibilityRole="link" accessibilityLabel={`${label}. ${detail}`}
    style={({pressed})=>[ux.card, {minHeight:94,justifyContent:'center'},pressed&&{borderColor:'#145b3f',backgroundColor:'#e2f2e8'}]}>
    <Text allowFontScaling style={ux.label}>{label}</Text><Text allowFontScaling style={ux.small}>{detail}</Text>
  </Pressable></Link>;
}
export function FieldHome() {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const day=businessToday();
  const sales=user?.role==='STAFF' && user.workKind==='SALES';
  const courier=user?.role==='STAFF' && user.workKind==='KITCHEN_DELIVERY';
  const manager=user?.role==='BRANCH_MANAGER'||user?.role==='ADMIN';
  const read=useFieldRead(useCallback((signal:AbortSignal)=> sales?fieldApi.workContext(day,signal):Promise.resolve<WorkContext>({branches:[],assignments:[]}),[sales,day]));
  if(!user)return null;
  return <Page title="WaveHouse · Làm việc" lead={`Xin chào ${user.displayName}. ${roleName[user.role]}. Ngày ${day}.`}>
    <Panel><Header>Ưu tiên hôm nay</Header>
      {sales ? <>
        <Copy>Quầy và ca làm lấy trực tiếp từ lịch đã phân công, không chọn quầy tùy ý.</Copy>
        {read.value?.assignments.length ? read.value.assignments.map((a,index)=><Status key={`${a.branchId}-${a.shift}-${index}`}>
          {read.value?.branches.find(b=>b.id===a.branchId)?.name??'Quầy'} · {formatShift(a.shift)}
        </Status>):<Copy>Chưa thấy ca được phân công. Nếu vừa đổi ca, bấm tải lại.</Copy>}
        <LoadControl loading={read.loading} error={read.error} onRefresh={()=>{void read.refresh();}}/>
      </>: courier ? <>
        <Warning>Chỉ xem thông tin và thao tác giao hàng khi đã dừng xe tại nơi an toàn. Không dùng App lúc lái xe.</Warning>
        <Copy>Kiểm tra chuyến được phân công, điểm giao và trạng thái nhận hàng.</Copy>
      </> : manager ? <Copy>Ưu tiên các báo cáo chờ duyệt, tình trạng nhận hàng và lịch tại khu vực được phân công.</Copy>
      : <Copy>Chưa được phân công vai trò phù hợp. Liên hệ quản trị để cập nhật.</Copy>}
    </Panel>
    <Header>Thao tác nhanh</Header>
    {sales ? <View style={ux.gap}>
      <Tile to="/field/sales" label="🧾 Báo cáo bán hàng" detail="Tạo, kiểm tra và gửi báo cáo theo ca"/>
      <Tile to="/field/receiving" label="📦 Nhận hàng sáng" detail="Đối chiếu từng SKU và báo thiếu/hỏng"/>
      <Tile to="/field/schedule" label="📅 Ca làm / đăng ký rảnh" detail="Xem ca, đăng ký thời gian rảnh"/>
      <Tile to="/field/inventory" label="📋 Tồn kho quầy" detail="Xem tồn, kiểm kê khi cần"/>
    </View>:null}
    {courier ? <View style={ux.gap}>
      <Tile to="/field/deliveries" label="🚚 Chuyến giao hôm nay" detail="Xem điểm giao và xuất chuyến được phân công"/>
      <Tile to="/field/schedule" label="📅 Lịch làm" detail="Kiểm tra thông tin công tác"/>
    </View>:null}
    {manager ? <View style={ux.gap}>
      <Tile to="/field/manager" label="📊 Tổng quan khu vực" detail="Các quầy, báo cáo và giao nhận cần chú ý"/>
      <Tile to="/field/sales" label="🧾 Duyệt báo cáo doanh thu" detail="Xem chi tiết, trả về hoặc phê duyệt"/>
      <Tile to="/field/receiving" label="📦 Theo dõi nhận hàng" detail="Xem chuyến, điểm giao và sai lệch"/>
      <Tile to="/field/roster" label="📅 Xếp ca nhân viên" detail="Xem đăng ký rảnh và phân công quầy"/>
      <Tile to="/field/schedule" label="🗓️ Lịch trong ngày" detail="Xem ca nhân viên đã được phân công"/>
      <Tile to="/field/inventory" label="📋 Tồn kho" detail="Xem tồn của các quầy trong phạm vi"/>
      {user.role==='ADMIN'?<Tile to="/field/deliveries" label="🚚 Chuyến phân phối" detail="Kiểm tra chuyến từ kế hoạch đã duyệt"/>:null}
    </View>:null}
    <Header>Tra cứu danh mục</Header>
    <View style={ux.gap}>
      <Tile to="/ingredients" label="Nguyên liệu" detail="Tra cứu nguyên liệu, đơn vị, trạng thái"/>
      <Tile to="/products" label="Sản phẩm" detail="Xem món đang bán và giá từng size"/>
      <Tile to="/recipes" label="Công thức" detail="Tra cứu phiên bản công thức được phép xem"/>
    </View>
    <Copy small>App không tự chạy thao tác nghiệp vụ khi mất kết nối. Nếu mạng yếu hoặc không nhận được phản hồi, hãy kiểm tra trạng thái mới nhất trước khi xác nhận lần nữa.</Copy>
  </Page>;
}

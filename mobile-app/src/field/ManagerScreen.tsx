import { router } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { fieldApi } from './field.api.ts';
import { FieldFormNotice, FieldFormReview, FieldFormSection } from './FieldForm.ts';
import { FieldEmptyRecords, FieldFactRow, FieldListHeading } from './FieldRecordUI.tsx';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, StateNotice,
  Status, Warning, businessToday, useFieldRead, useSafeMutation } from './field.ui.tsx';

export function ManagerScreen(){
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [date,setDate]=useState(businessToday());
  const [day,setDay]=useState(businessToday());
  const summary=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.operations(day,signal),[day]));
  const plans=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.plans(day,signal),[day]));
  const discrepancy=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.discrepancies(day,signal),[day]));
  const counts=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.counts(day,signal),[day]));
  if(user?.role==='STAFF')return <Page title="Không có quyền"><Warning>Chức năng chỉ dành cho quản lý khu và quản trị.</Warning></Page>;
  return <Page title="Điều hành khu vực" lead="Số liệu trực tiếp từ phạm vi máy chủ cho phép; không dùng bảng cũ khi mất mạng.">
    <Panel><FieldInput label="Ngày kinh doanh (YYYY-MM-DD)" value={date} onChangeText={setDate}/>
      <Action label="Xem tình hình ngày" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)} onPress={()=>setDay(date)}/>
    </Panel>
    <Header>Tình hình vận hành</Header>
    {summary.value?<Panel>
      <FieldFactRow label="Quầy thuộc phạm vi" value={summary.value.branchCount}/>
      <FieldFactRow label="Điểm chờ nhận hàng" value={summary.value.pendingReceivingStops} emphasis/>
      <FieldFactRow label="Điểm đã nhận" value={summary.value.receivedStops}/>
      <FieldFactRow label="Điểm sai lệch" value={summary.value.discrepantStops} emphasis/>
      <FieldFactRow label="Báo cáo bán chờ duyệt" value={summary.value.submittedSalesReports} emphasis/>
      <FieldFactRow label="Phiếu kiểm kê đã nộp" value={summary.value.submittedStockCounts}/>
    </Panel>:null}
    <LoadControl loading={summary.loading} error={summary.error} onRefresh={()=>{void summary.refresh();}}/>
    <Action label="Mở báo cáo bán hàng" onPress={()=>router.push('/field/sales')}/>
    <Action secondary label="Mở lịch phân ca" onPress={()=>router.push('/field/schedule')}/>
    <FieldListHeading title="Phiếu kiểm kê chờ xử lý" count={counts.value?.filter(c=>c.status==='SUBMITTED'||c.status==='RETURNED').length} unit="phiếu"/>
    {counts.value?.filter(c=>c.status==='SUBMITTED'||c.status==='RETURNED').map(c=><Panel key={c.id}>
      <Header>{String(c.businessDate).slice(0,10)} · {c.shift}</Header><Status>{c.status}</Status>
      <Action secondary label="Mở phiếu kiểm kê" onPress={()=>router.push({pathname:'/field/count/[id]',params:{id:c.id}})}/>
    </Panel>)}
    {counts.value!==null&&!counts.value.some(c=>c.status==='SUBMITTED'||c.status==='RETURNED')?<FieldEmptyRecords title="Không có phiếu cần xử lý"/>:null}
    <LoadControl loading={counts.loading} error={counts.error} onRefresh={()=>{void counts.refresh();}}/>
    <FieldListHeading title="Kế hoạch bổ sung hàng" count={plans.value?.length} unit="kế hoạch"/>
    <Warning>Đề xuất phải được ADMIN khác người lập duyệt; chỉ chuyến được chuyển đổi từ kế hoạch đã duyệt mới được xuất kho.</Warning>
    {plans.value?.map(plan=><Panel key={plan.id}>
      <Header>{plan.area?.name??'Khu vực'} · {plan.warehouse?.name??'Kho'}</Header>
      <Status>{plan.status}</Status>
      <Copy>{plan.lines.length} dòng nguyên liệu</Copy>
      <Action secondary label="Chi tiết kế hoạch" onPress={()=>router.push({pathname:'/field/plan/[id]',params:{id:plan.id}})}/>
    </Panel>)}
    {plans.value!==null&&plans.value.length===0?<FieldEmptyRecords title="Chưa có kế hoạch trong ngày"/>:null}
    <LoadControl loading={plans.loading} error={plans.error} onRefresh={()=>{void plans.refresh();}}/>
    <FieldListHeading title="Sai lệch nhận hàng" count={discrepancy.value?.length} unit="hồ sơ"/>
    {discrepancy.value?.map(item=><Panel key={item.id}>
      <Header>Hồ sơ {item.id.slice(0,8)}</Header><Status>{item.status}</Status>
      <Copy small>{item.stop?.branch?.name??item.branch?.name??'Quầy'}</Copy>
    </Panel>)}
    {discrepancy.value!==null&&discrepancy.value.length===0?<FieldEmptyRecords title="Không có hồ sơ sai lệch trong ngày"/>:null}
    <LoadControl loading={discrepancy.loading} error={discrepancy.error} onRefresh={()=>{void discrepancy.refresh();}}/>
    <Copy small>Phê duyệt hay điều chỉnh tồn kho chỉ hiển thị khi đủ quyền trên Backend. Không có thao tác duyệt hàng loạt một chạm.</Copy>
  </Page>;
}
export function PlanScreen({id}: {id:string}) {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [reason,setReason]=useState('');const [decision,setDecision]=useState<'APPROVED'|'REJECTED'|null>(null);
  const plan=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.plan(id,signal),[id]));
  const mutation=useSafeMutation();
  const data=plan.value;
  const canReview=user?.role==='ADMIN'&&data?.status==='SUBMITTED'&&data.createdById!==user.id;
  return <Page title="Chi tiết kế hoạch" lead="Đối chiếu quầy, SKU và số lượng trước khi duyệt đề xuất.">
    {data?<>
      <Panel><Header>{data.area?.name??'Khu vực'} · {data.warehouse?.name??'Kho'}</Header><Status>{data.status}</Status>
        <Copy>{data.lines.length} dòng nguyên liệu</Copy>
      </Panel>
      {data.lines.map((line,i)=><Panel key={`${line.branchId}/${line.ingredientId}/${i}`}>
        <Header>{line.branch?.name??'Quầy'}</Header>
        <Copy>{line.ingredient?.name??'Nguyên liệu'} · {String(line.quantity)} {line.ingredient?.unit??''}</Copy>
      </Panel>)}
      {canReview?<FieldFormSection title="Quyết định của quản trị" description="Chỉ ADMIN khác người lập mới có thể phê duyệt.">
        <FieldFormReview title="Rà soát đề xuất" items={[
          {label:'Khu vực',value:data.area?.name??'—'},
          {label:'Kho',value:data.warehouse?.name??'—'},
          {label:'Trạng thái',value:data.status},
          {label:'Số dòng nguyên liệu',value:data.lines.length,emphasis:true},
        ]}/>
        <FieldFormNotice tone="warning" message="Duyệt kế hoạch không tự tạo chuyến hoặc làm giảm tồn kho; cần tiếp tục bước điều phối theo quy trình."/>
        <Action label="Xem xác nhận duyệt" onPress={()=>setDecision('APPROVED')}/>
        <Action secondary label="Từ chối đề xuất" onPress={()=>setDecision('REJECTED')}/>
        {decision?<>
          <FieldInput label={decision==='REJECTED'?'Lý do từ chối (ít nhất 8 ký tự)':'Ghi chú duyệt (tùy chọn)'} value={reason}
            onChangeText={setReason} multiline/>
          <Action label={mutation.busy?'Đang xử lý...':'XÁC NHẬN '+(decision==='APPROVED'?'DUYỆT':'TỪ CHỐI')}
            disabled={mutation.busy||(decision==='REJECTED'&&reason.trim().length<8)}
            onPress={()=>{void mutation.execute(()=>fieldApi.reviewPlan(id,decision,reason),()=>{
              setDecision(null);void plan.refresh();
            });}}/>
          <Action secondary label="Đóng xác nhận" onPress={()=>setDecision(null)}/>
        </>:null}
        {mutation.error?<StateNotice error={mutation.error}/>:null}
      </FieldFormSection>:null}
    </>:<Copy>Kế hoạch không nằm trong danh sách của ngày hiện tại hoặc bạn không được phân quyền.</Copy>}
    <LoadControl loading={plan.loading} error={plan.error} onRefresh={()=>{void plan.refresh();}}/>
  </Page>;
}

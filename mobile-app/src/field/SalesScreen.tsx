import { router } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { createCatalogClient } from '../api/catalog.ts';
import type { Product } from '../api/catalog.types.ts';
import { fieldApi } from './field.api.ts';
import type { SalesChannel, SalesInput, SalesLine, SalesReport, WorkContext, WorkShift } from './field.types.ts';
import { Action, Copy, FieldInput, Header, LoadControl, Page, Panel, Selection, StateNotice,
  Status, Warning, businessToday, formatShift, shifts, useFieldRead, useSafeMutation, ux } from './field.ui.tsx';

const vnd=(value:string):boolean=>/^(?:0|[1-9]\d{0,11})$/.test(value);
const cleanVnd=(value:string)=>/^\d+\.0+$/.test(value)?value.split('.')[0]:value;
const channelChoices:[{code:SalesChannel;label:string},...Array<{code:SalesChannel;label:string}>]=[
  {code:'CASH',label:'Tiền mặt'},{code:'BANK_TRANSFER',label:'Chuyển khoản'},
  {code:'MOMO',label:'MoMo'},{code:'GRAB',label:'Grab'},{code:'OTHER',label:'Khác'},
];
const visibleStatus:Record<string,string>={DRAFT:'Bản nháp',SUBMITTED:'Chờ duyệt',RETURNED:'Cần bổ sung',APPROVED:'Đã duyệt'};

export function SalesScreen(){
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [day,setDay]=useState(businessToday());
  const [selectedDay,setSelectedDay]=useState(businessToday());
  const [page,setPage]=useState(1);
  const query=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.salesReports(selectedDay,page,signal),[selectedDay,page]));
  return <Page title="Báo cáo bán hàng" lead="Báo cáo theo ca được lập tại quầy đã phân công. Chỉ số liệu trên máy chủ mới có giá trị.">
    <Panel><FieldInput label="Ngày (YYYY-MM-DD)" value={day} onChangeText={setDay}/>
      <Action label="Xem báo cáo ngày" onPress={()=>{setPage(1);setSelectedDay(day);}} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(day)}/>
    </Panel>
    {user?.role==='STAFF'&&user.workKind==='SALES'?<Action label="+ Tạo báo cáo theo ca" onPress={()=>router.push('/field/sales-edit')}/>:null}
    <Header>Báo cáo ngày {selectedDay}</Header>
    {query.value?.items.map(report=><Panel key={report.id}>
      <Header>{report.branch?.name??'Quầy'} · {formatShift(report.shift)}</Header>
      <Status>{visibleStatus[report.status]??report.status}</Status>
      <Copy small>Ngày {report.businessDate} · Phiên bản {report.version}</Copy>
      <Copy>Doanh thu ghi nhận: {report.currentRevision?.totals?.netRecorded??'—'} VND</Copy>
      <Action secondary label="Mở báo cáo và các thao tác" onPress={()=>router.push({pathname:'/field/sales/[id]',params:{id:report.id}})}/>
    </Panel>)}
    {!query.value?.items.length&&!query.loading?<Copy>Không có báo cáo trong ngày này.</Copy>:null}
    {query.value&&query.value.total>20?<View style={ux.row}>
      <Action secondary disabled={page===1} label="Trang trước" onPress={()=>setPage(p=>Math.max(1,p-1))}/>
      <Copy>Trang {page}</Copy>
      <Action secondary disabled={page*20>=query.value.total} label="Trang sau" onPress={()=>setPage(p=>p+1)}/>
    </View>:null}
    <LoadControl loading={query.loading} error={query.error} onRefresh={()=>{void query.refresh();}}/>
  </Page>;
}

export function SalesReportScreen({id}: {id:string}) {
  const query=useFieldRead(useCallback((signal:AbortSignal)=>fieldApi.salesReport(id,signal),[id]));
  const mutation=useSafeMutation();
  const [reason,setReason]=useState('');
  const [armed,setArmed]=useState<'submit'|'approve'|'return'|null>(null);
  const report=query.value;
  const allowed=report?.allowedActions;
  const process=(action:'submit'|'approve'|'return')=>{
    if(!report)return;
    void mutation.execute(()=>action==='submit'?fieldApi.submitSales(id,report.version):
      fieldApi.reviewSales(id,action,report.version,report.submittedRevisionNumber??report.currentRevisionNumber,reason.trim()),()=>{
      setArmed(null);setReason('');void query.refresh();
    });
  };
  return <Page title="Chi tiết báo cáo" lead="Kiểm tra các dòng bán, thanh toán và chênh lệch trước khi xác nhận.">
    {report?<>
      <Panel><Header>{report.branch?.name??'Quầy'} · {formatShift(report.shift)}</Header>
        <Status>{visibleStatus[report.status]??report.status}</Status>
        <Copy>Ngày {report.businessDate} · Phiên bản {report.version}</Copy>
        {report.returnReason?<Warning>Yêu cầu bổ sung: {report.returnReason}</Warning>:null}
      </Panel>
      <Panel><Header>Chi tiết sản phẩm</Header>
        {report.currentRevision.lines.map((line,i)=><Copy key={i}>{line.productNameSnapshot} ({line.size}) · {line.quantity} × {line.unitPriceSnapshot} VND</Copy>)}
        {report.currentRevision.lines.length===0?<Copy>Chưa nhập sản phẩm.</Copy>:null}
      </Panel>
      <Panel><Header>Đối soát</Header>
        <Copy>Doanh thu sản phẩm: {report.currentRevision.totals.grossSales} VND</Copy>
        <Copy>Thanh toán ghi nhận: {report.currentRevision.totals.netRecorded} VND</Copy>
        <Copy>Chênh lệch doanh thu: {report.currentRevision.totals.salesDifference} VND</Copy>
        <Copy small>{report.currentRevision.note??'Không có ghi chú'}</Copy>
        {report.currentRevision.payments.map(p=><Copy key={p.channel}>{p.channel}: {p.collectedAmount} VND</Copy>)}
      </Panel>
      {allowed?.canEdit?<Action secondary label="Sửa bản nháp / báo cáo trả lại" onPress={()=>router.push({pathname:'/field/sales-edit',params:{id}})}/>:null}
      {allowed?.canSubmit?<Action label="Chuẩn bị gửi báo cáo duyệt" onPress={()=>setArmed('submit')}/>:null}
      {allowed?.canApprove?<Action label="Xem xác nhận phê duyệt" onPress={()=>setArmed('approve')}/>:null}
      {allowed?.canReturn?<Action secondary label="Trả lại để bổ sung" onPress={()=>setArmed('return')}/>:null}
      {armed?<Panel>
        <Header>{armed==='submit'?'Gửi báo cáo chính thức':armed==='approve'?'Phê duyệt báo cáo':'Trả lại báo cáo'}</Header>
        <Warning>Hãy đọc kỹ số liệu. Thao tác sẽ ghi nhận trên máy chủ với phiên bản đang hiển thị. Không gửi lại khi mạng không rõ trạng thái.</Warning>
        {armed==='return'?<FieldInput label="Lý do yêu cầu bổ sung" value={reason} onChangeText={setReason} multiline/>:null}
        <Action label={mutation.busy?'Đang xử lý...':'XÁC NHẬN THAO TÁC'}
          disabled={mutation.busy||(armed==='return'&&!reason.trim())} onPress={()=>process(armed)}/>
        <Action secondary label="Hủy xác nhận" onPress={()=>setArmed(null)}/>
      </Panel>:null}
      {mutation.error?<StateNotice error={mutation.error}/>:null}
    </>:!query.loading?<Copy>Báo cáo không còn tồn tại hoặc không thuộc phạm vi của bạn.</Copy>:null}
    <LoadControl loading={query.loading} error={query.error} onRefresh={()=>{void query.refresh();}}/>
  </Page>;
}

export function SalesEditScreen({id}: {id?:string}) {
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const today=businessToday();
  const isEdit=!!id;
  const [date,setDate]=useState(today);
  const [contextDate,setContextDate]=useState(today);
  const [branchId,setBranchId]=useState('');
  const [shift,setShift]=useState<WorkShift>('MORNING');
  const [lines,setLines]=useState<SalesLine[]>([]);
  const [productSearch,setProductSearch]=useState('');
  const [appliedSearch,setAppliedSearch]=useState('');
  const [discounts,setDiscounts]=useState('0');
  const [payments,setPayments]=useState<SalesInput['payments']>([{channel:'CASH',collectedAmount:'0',refundedAmount:'0',platformFee:'0',settlementDifference:'0',note:null}]);
  const [expenses,setExpenses]=useState<SalesInput['expenses']>([]);
  const [opening,setOpening]=useState('0');
  const [handovers,setHandovers]=useState('0');
  const [closing,setClosing]=useState('0');
  const [memo,setMemo]=useState('');
  const [cashChecked,setCashChecked]=useState(false);
  const [ready,setReady]=useState(false);
  const [loadedEdit,setLoadedEdit]=useState<string|null>(null);
  const [editVersion,setEditVersion]=useState<number|null>(null);
  const context=useFieldRead<SalesReport|WorkContext>(useCallback((signal:AbortSignal):Promise<SalesReport|WorkContext>=>id?fieldApi.salesReport(id,signal):fieldApi.workContext(contextDate,signal),[id,contextDate]));
  const products=useFieldRead(useCallback(async(signal:AbortSignal)=>{
    const result=await createCatalogClient().products.list({page:1,limit:60,isAvailable:true,
      ...(appliedSearch?{search:appliedSearch}:{}),
    },{signal});
    return result.data;
  },[appliedSearch]));
  const mutation=useSafeMutation();
  const report=isEdit?context.value as SalesReport|null:null;
  const ctx=!isEdit?context.value as {branches:{id:string;code:string;name:string}[];assignments:{branchId:string;shift:WorkShift}[]}|null:null;
  // Load one authoritative revision; later refreshes must not erase an employee's unsaved edits.
  useEffect(()=>{
    if(!report||loadedEdit===report.id)return;
    setLoadedEdit(report.id);setEditVersion(report.version);setDate(report.businessDate);setBranchId(report.branchId);setShift(report.shift);
    setLines(report.currentRevision.lines.map(x=>({productId:x.productId,productName:x.productNameSnapshot,
      size:x.size as SalesLine['size'],quantity:x.quantity,unitPrice:x.unitPriceSnapshot,note:x.note})));
    setDiscounts(report.currentRevision.discounts);
    setPayments(report.currentRevision.payments.map(p=>({
      channel:p.channel,collectedAmount:p.collectedAmount,refundedAmount:p.refundedAmount,
      platformFee:p.platformFee,settlementDifference:p.settlementDifference,note:p.note,
    }))); 
    setExpenses(report.currentRevision.expenses.map(e=>({channel:e.channel,description:e.description,amount:e.amount}))); 
    setOpening(report.currentRevision.cash.openingCash);setHandovers(report.currentRevision.cash.cashHandovers);
    setClosing(report.currentRevision.cash.closingCashActual??'0');
    setCashChecked(report.currentRevision.cash.closingCashActual!==null);
    setMemo(report.currentRevision.note??'');
  },[report,loadedEdit]);
  const allowedBranches=ctx?.branches.filter(b=>ctx.assignments.some(a=>a.branchId===b.id&&a.shift===shift))??[];
  const visibleProducts=(products.value??[]).slice(0,30);
  const appendProduct=(product:Product,size:'S'|'M'|'L',price:string)=>{
    if(lines.length>=100)return;
    setReady(false);
    setLines(previous=>[...previous,{productId:product._id,productName:product.name,size,quantity:1,unitPrice:cleanVnd(price),note:null}]);
  };
  const valid=lines.length<=100&&(!id||editVersion!==null)&&!!branchId&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&lines.length>0&&lines.every(line=>
    line.quantity>0&&line.quantity<=999999&&Number.isSafeInteger(line.quantity)&&vnd(line.unitPrice))&&
    [discounts,opening,handovers,...(cashChecked?[closing]:[])].every(vnd)&&
    payments.length<=5&&payments.every(p=>vnd(p.collectedAmount)&&vnd(p.refundedAmount)&&vnd(p.platformFee)&&/^-?(?:0|[1-9]\d{0,11})$/.test(p.settlementDifference))&&
    expenses.length<=100&&expenses.every(e=>e.description.trim().length>0&&e.description.trim().length<=300&&vnd(e.amount))&&
    new Set(payments.map(p=>p.channel)).size===payments.length&&memo.trim().length<=1500;
  const amount=(value:string):bigint=>vnd(value)?BigInt(value):0n;
  const gross=lines.reduce((total,line)=>total+(vnd(line.unitPrice)&&Number.isSafeInteger(line.quantity)&&line.quantity>=0
    ?BigInt(line.quantity)*amount(line.unitPrice):0n),0n);
  const expected=gross-amount(discounts);
  const collected=payments.reduce((total,p)=>total+amount(p.collectedAmount)-amount(p.refundedAmount),0n);
  const payload:SalesInput={branchId,businessDate:date,shift,note:memo.trim()||null,discounts,lines,
    payments,expenses,cash:{openingCash:opening,cashHandovers:handovers,closingCashActual:cashChecked?closing:null}};
  const save=()=>{void mutation.execute(()=>id&&report?
    fieldApi.updateSales(id,payload,editVersion??report.version):fieldApi.createSales(payload),result=>{
      router.replace({pathname:'/field/sales/[id]',params:{id:result.id}});
    });};
  if(user?.role==='BRANCH_MANAGER')return <Page title="Không thể lập báo cáo"><Warning>Quản lý khu duyệt báo cáo, không lập báo cáo thay nhân viên.</Warning></Page>;
  return <Page title={id?'Sửa báo cáo':'Tạo báo cáo bán hàng'} lead="Ghi nhanh theo sản phẩm và size. Lưu bản nháp trước, sau đó kiểm tra và gửi duyệt riêng.">
    <Warning>Dữ liệu chỉ gửi một lần khi bạn xác nhận. Khi gặp timeout, hãy trở lại danh sách và kiểm tra trước khi lập bản mới.</Warning>
    {id?<Panel><Header>Báo cáo: {report?.branch?.name??'Đang tải'}</Header>
      <Status>{report?.status??'...'}</Status>
      {report&&!report.allowedActions.canEdit?<Warning>Báo cáo này không còn được phép chỉnh sửa.</Warning>:null}
    </Panel>:<Panel>
      <FieldInput label="Ngày bán (YYYY-MM-DD)" value={date} onChangeText={value=>{setDate(value);setBranchId('');setReady(false);}}/>
      <Action secondary label="Tải phân công ngày đã nhập" onPress={()=>setContextDate(date)} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}/>
      <Header>Ca làm</Header><Selection options={shifts} value={shift} onChange={value=>{setShift(value);setBranchId('');setReady(false);}}/>
      <Header>Quầy được phân công</Header>
      {allowedBranches.map(b=><Action key={b.id} secondary={branchId!==b.id}
        label={`${branchId===b.id?'✓ ':''}${b.name}`} onPress={()=>{setBranchId(b.id);setReady(false);}}/>)}
      {!allowedBranches.length?<Copy>Không có quầy được phân công trong ca đã chọn.</Copy>:null}
      <LoadControl loading={context.loading} error={context.error} onRefresh={()=>{void context.refresh();}}/>
    </Panel>}
    <Header>Thêm món từ Catalog</Header>
    <Panel><FieldInput label="Tìm tên hoặc mã sản phẩm" value={productSearch} onChangeText={setProductSearch}/>
      <Action label="Tìm sản phẩm trên máy chủ" onPress={()=>setAppliedSearch(productSearch.trim())}/>
      {visibleProducts.map(product=><View style={ux.gap} key={product._id}>
        <Header>{product.name}</Header>
        <View style={ux.row}>{product.prices.map(price=><Action key={price.size} secondary
          label={`+ ${price.size} · ${price.price}đ`} onPress={()=>appendProduct(product,price.size,price.price)}/>)}</View>
      </View>)}
      <LoadControl loading={products.loading} error={products.error} onRefresh={()=>{void products.refresh();}}/>
    </Panel>
    <Header>Giỏ số liệu bán trong ca</Header>
    {lines.map((line,i)=><Panel key={`${line.productId}-${line.size}-${i}`}>
      <Header>{line.productName} · Size {line.size}</Header>
      <FieldInput label="Số lượng" value={String(line.quantity)} keyboardType="number-pad" onChangeText={value=>{
        setReady(false);setLines(list=>list.map((v,k)=>k===i?{...v,quantity:Number(value)}:v));
      }}/>
      <FieldInput label="Đơn giá VND" value={line.unitPrice} keyboardType="number-pad" onChangeText={value=>{
        setReady(false);setLines(list=>list.map((v,k)=>k===i?{...v,unitPrice:value}:v));
      }}/>
      <Action secondary label="Xóa dòng" onPress={()=>{setReady(false);setLines(list=>list.filter((_,k)=>k!==i));}}/>
    </Panel>)}
    {!lines.length?<Copy>Chưa chọn sản phẩm. Thêm từng món/size trước khi lưu nháp.</Copy>:null}
    <Header>Đối soát thanh toán</Header>
    <Panel>
      <Header>Tiền hàng tính từ giỏ: {gross.toString()} VND</Header>
      <Copy>Trừ giảm giá: {expected.toString()} VND · Tổng đã thu trừ hoàn: {collected.toString()} VND</Copy>
      {expected!==collected?<Warning>Chênh lệch tạm tính {String(collected-expected)} VND. Đối chiếu kênh thanh toán trước khi lưu.</Warning>:null}
      <FieldInput label="Giảm giá tổng (VND)" value={discounts} keyboardType="number-pad" onChangeText={v=>{setReady(false);setDiscounts(v);}}/>
      <Header>Các kênh thanh toán</Header>
      {payments.map((payment,i)=><Panel key={i}>
        <Header>Kênh {i+1}</Header>
        <Selection options={channelChoices.filter(x=>x.code===payment.channel||!payments.some((p,j)=>j!==i&&p.channel===x.code))}
          value={payment.channel} onChange={channel=>{setReady(false);setPayments(items=>items.map((p,j)=>j===i?{...p,channel}:p));}}/>
        <FieldInput label="Đã thu (VND)" value={payment.collectedAmount} keyboardType="number-pad" onChangeText={value=>{
          setReady(false);setPayments(items=>items.map((p,j)=>j===i?{...p,collectedAmount:value}:p));
        }}/>
        <FieldInput label="Hoàn tiền (VND)" value={payment.refundedAmount} keyboardType="number-pad" onChangeText={value=>{
          setReady(false);setPayments(items=>items.map((p,j)=>j===i?{...p,refundedAmount:value}:p));
        }}/>
        <FieldInput label="Phí nền tảng (VND)" value={payment.platformFee} keyboardType="number-pad" onChangeText={value=>{
          setReady(false);setPayments(items=>items.map((p,j)=>j===i?{...p,platformFee:value}:p));
        }}/>
        <FieldInput label="Chênh lệch đối soát (VND, có thể âm)" value={payment.settlementDifference}
          keyboardType="numbers-and-punctuation" onChangeText={value=>{
          setReady(false);setPayments(items=>items.map((p,j)=>j===i?{...p,settlementDifference:value}:p));
        }}/>
        <Action secondary label="Xóa kênh này" onPress={()=>{setReady(false);setPayments(items=>items.filter((_,j)=>i!==j));}}/>
      </Panel>)}
      <Action secondary label="+ Thêm kênh thanh toán" disabled={payments.length>=5} onPress={()=>{
        const next=channelChoices.find(x=>!payments.some(p=>p.channel===x.code));
        if(next){setReady(false);setPayments(items=>[...items,{channel:next.code,collectedAmount:'0',refundedAmount:'0',platformFee:'0',settlementDifference:'0',note:null}]);}
      }}/>
      <Header>Chi phí phát sinh trong ca (nếu có)</Header>
      {expenses.map((expense,i)=><Panel key={i}>
        <FieldInput label="Nội dung chi" value={expense.description} onChangeText={value=>{
          setReady(false);setExpenses(items=>items.map((e,j)=>j===i?{...e,description:value}:e));
        }}/>
        <Selection options={channelChoices} value={expense.channel} onChange={channel=>{
          setReady(false);setExpenses(items=>items.map((e,j)=>j===i?{...e,channel}:e));
        }}/>
        <FieldInput label="Số tiền chi (VND)" value={expense.amount} keyboardType="number-pad" onChangeText={value=>{
          setReady(false);setExpenses(items=>items.map((e,j)=>j===i?{...e,amount:value}:e));
        }}/>
        <Action secondary label="Bỏ khoản chi" onPress={()=>{setReady(false);setExpenses(items=>items.filter((_,j)=>i!==j));}}/>
      </Panel>)}
      <Action secondary label="+ Thêm khoản chi" disabled={expenses.length>=100} onPress={()=>{
        setReady(false);setExpenses(items=>[...items,{description:'',channel:'CASH',amount:'0'}]);
      }}/>
      <FieldInput label="Tiền đầu ca (VND)" value={opening} keyboardType="number-pad" onChangeText={v=>{setReady(false);setOpening(v);}}/>
      <FieldInput label="Bàn giao tiền trong ca (VND)" value={handovers} keyboardType="number-pad" onChangeText={v=>{setReady(false);setHandovers(v);}}/>
      <Action secondary label={cashChecked?'✓ Đã kiểm đếm tiền mặt cuối ca':'Chưa kiểm tiền mặt cuối ca'}
        onPress={()=>{setReady(false);setCashChecked(v=>!v);}}/>
      {cashChecked?<FieldInput label="Tiền mặt cuối ca thực đếm (VND)" value={closing} keyboardType="number-pad" onChangeText={v=>{setReady(false);setClosing(v);}}/>:null}
      <FieldInput label="Ghi chú" value={memo} onChangeText={v=>{setReady(false);setMemo(v);}} multiline/>
    </Panel>
    <Warning>Đối chiếu từng kênh, khoản hoàn và chi phí. Chênh lệch sẽ được Backend tính lại khi nộp báo cáo. Bản nháp chưa phải số liệu đã duyệt.</Warning>
    <Action secondary label={ready?'✓ Đã xác nhận số liệu':'Tôi đã kiểm tra sản phẩm, số tiền và quầy'}
      disabled={!valid||mutation.busy} onPress={()=>setReady(v=>!v)}/>
    <Action label={mutation.busy?'Đang lưu...':id?'LƯU BẢN CHỈNH SỬA':'LƯU BẢN NHÁP'}
      disabled={!ready||!valid||mutation.busy||(!!id&&!report?.allowedActions.canEdit)}
      onPress={save}/>
    {mutation.error?<StateNotice error={mutation.error}/>:null}
  </Page>;
}

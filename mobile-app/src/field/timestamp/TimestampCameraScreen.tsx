import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet,
  Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { captureRef } from 'react-native-view-shot';
import { router } from 'expo-router';
import { addEvidence, evidenceFor, getEvidenceSnapshot, MAX_PER_TARGET, MAX_TOTAL_DRAFTS,
  type EvidenceKind, type EvidenceTarget } from '../evidence.store';
import { getAuthSnapshot } from '../../auth/session.ts';
import { palette } from '../../design/doclap/theme';
import { lockCaptureFacts, requestOneLocation, type LocationFix } from './location';
import { DEFAULT_STAMP, hasFreshLocation, type CaptureFacts, type StampStyle } from './stamp.model';
import { StampOverlay } from './StampOverlay';
import { STAMP_PRESETS, type StampPresetId } from './presets';
import { deleteCameraTemplate, loadCameraTemplate, saveCameraTemplate,
  MAX_LOGO_DATA_URI_CHARS } from './template.store';

interface Captured { uri:string; facts:CaptureFacts; aspect:number }
interface Props { target:EvidenceTarget; kind:EvidenceKind }
const caption = (target: EvidenceTarget) => target.type==='trip'?'Chuyến giao'
  : target.type==='stop'?'Điểm nhận':target.type==='count'?'Phiếu kiểm kê':'Ảnh tự do';
const limitString='Camera đã đạt giới hạn ảnh nháp. Vui lòng quay lại và xử lý ảnh đang có.';

export function TimestampCameraScreen({target,kind}: Props) {
  const {width:screenWidth}=useWindowDimensions();
  const frameWidth=Math.min(screenWidth-28,460);
  const cameraRef=useRef<CameraView|null>(null);
  const imageFrameRef=useRef<View|null>(null);
  const takingRef=useRef(false);
  const mountedRef=useRef(true);
  const [permission,requestPermission]=useCameraPermissions();
  const [facing,setFacing]=useState<CameraType>('back');
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [photoReady,setPhotoReady]=useState(false);
  const [fix,setFix]=useState<LocationFix|null>(null);
  const [locBusy,setLocBusy]=useState(false);
  const [locMessage,setLocMessage]=useState('Chưa lấy vị trí · Bấm “Lấy GPS” trước khi chụp');
  const [now,setNow]=useState(Date.now());
  const [captured,setCaptured]=useState<Captured|null>(null);
  const [config,setConfig]=useState<StampStyle>(DEFAULT_STAMP);
  const [showTemplate,setShowTemplate]=useState(false);
  const [logoUri,setLogoUri]=useState<string|null>(null);
  const [presetId,setPresetId]=useState<StampPresetId|null>(null);
  const [templateBusy,setTemplateBusy]=useState(false);
  const [templateMessage,setTemplateMessage]=useState('');
  const userId=getAuthSnapshot().user?.id??null;
  const [note,setNote]=useState('');
  const [error,setError]=useState('');
  const operator=getAuthSnapshot().user?.displayName??'';

  useEffect(()=>{
    mountedRef.current=true;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>{mountedRef.current=false;clearInterval(timer);};
  },[]);

  // Only display saved settings belonging to the active account. No GPS/photo/token stored.
  useEffect(()=>{
    let active=true;
    const generation=getAuthSnapshot().generation;
    if(!userId)return ()=>{active=false;};
    void (async()=>{
      try {
        const saved=await loadCameraTemplate(userId);
        if(!active || generation!==getAuthSnapshot().generation || !saved)return;
        setConfig(saved.config);
        setLogoUri(saved.logoDataUri);
        setPresetId(saved.presetId);
        setTemplateMessage('Đã tải mẫu đã lưu cho tài khoản này.');
      } catch {
        if(active)setTemplateMessage('Chưa tải được mẫu đã lưu; đang sử dụng mẫu mặc định.');
      }
    })();
    return ()=>{active=false;};
  },[userId]);

  const getGps=useCallback(async()=>{
    if(locBusy || busy) return;
    setLocBusy(true);setLocMessage('Đang xác định vị trí...');setError('');
    try {
      const item=await requestOneLocation();
      if(!mountedRef.current) return;
      setFix(item);
      setLocMessage(item.address??`${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)} (GPS)`);
    } catch(e) {
      if(!mountedRef.current) return;
      setFix(null);
      setLocMessage(e instanceof Error?e.message:'Không thể lấy vị trí.');
    } finally {if(mountedRef.current) setLocBusy(false);}
  },[locBusy,busy]);

  const shoot=useCallback(async()=>{
    if(takingRef.current || !ready || !permission?.granted || captured) return;
    const snapshot=getEvidenceSnapshot();
    if(evidenceFor(target,snapshot).length>=MAX_PER_TARGET || snapshot.items.length>=MAX_TOTAL_DRAFTS){
      setError(limitString);return;
    }
    takingRef.current=true;setBusy(true);setError('');setPhotoReady(false);
    try {
      // Timestamp is sampled immediately before the native shutter request.
      const shutterAt=Date.now();
      const facts=lockCaptureFacts(shutterAt,fix);
      const result=await cameraRef.current?.takePictureAsync({quality:0.92,skipProcessing:false});
      if(!result?.uri) throw new Error('Không chụp được ảnh. Hãy thử lại.');
      const aspect=result.width>0&&result.height>0 ? result.height/result.width : 4/3;
      if(mountedRef.current) setCaptured({uri:result.uri,facts,aspect});
    } catch(e) {
      if(mountedRef.current)setError(e instanceof Error?e.message:'Không chụp được ảnh.');
    } finally {takingRef.current=false;if(mountedRef.current)setBusy(false);}
  },[ready,permission,captured,target,fix]);

  const remember=async()=>{
    if(busy || !captured || !photoReady || !imageFrameRef.current) return;
    setBusy(true);setError('');
    try {
      // captureRef bakes the stamp into the JPG pixels, unlike a mere UI overlay.
      const stampedUri=await captureRef(imageFrameRef.current,{format:'jpg',quality:0.88,result:'tmpfile'});
      let file=await ImageManipulator.manipulateAsync(stampedUri,[],{
        compress:0.78,format:ImageManipulator.SaveFormat.JPEG,base64:true,
      });
      if(!file.base64 || file.base64.length>2_790_000) {
        file=await ImageManipulator.manipulateAsync(stampedUri,[{resize:{width:900}}],{
          compress:0.65,format:ImageManipulator.SaveFormat.JPEG,base64:true,
        });
      }
      if(!file.base64 || file.base64.length>2_790_000) {
        throw new Error('Ảnh lớn hơn giới hạn Backend 2 MB. Hãy thử lại với ảnh khác.');
      }
      addEvidence({uri:file.uri,mimeType:'image/jpeg',base64:file.base64,kind,target,note,
        captureFacts:captured.facts});
      if(mountedRef.current)router.back();
    } catch(e) {
      if(mountedRef.current)setError(e instanceof Error?e.message:'Không tạo được ảnh có dấu.');
    } finally {if(mountedRef.current)setBusy(false);}
  };

  const saveWithGpsNotice=()=>{
    if(!captured) return;
    if(captured.facts.latitude===null && target.type!=='general') {
      Alert.alert('Thiếu vị trí tại lúc chụp',
        'Minh chứng nghiệp vụ yêu cầu GPS. Hãy chụp lại sau khi bấm Lấy GPS. Không thể thêm vị trí vào ảnh đã chụp.',[
          {text:'Đóng',style:'cancel'},
          {text:'Chụp lại',onPress:()=>{setCaptured(null);setPhotoReady(false);setReady(false);}},
        ]);
      return;
    }
    if(captured.facts.latitude===null) {
      Alert.alert('Ảnh không có GPS','Ảnh tự do sẽ có dấu “CHƯA XÁC ĐỊNH VỊ TRÍ”; không thể gửi ảnh này vào phiếu nghiệp vụ.',[
        {text:'Hủy',style:'cancel'},
        {text:'Lưu ảnh nháp',onPress:()=>{void remember();}},
      ]);
    } else void remember();
  };

  const selectLogo=async()=>{
    try {
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:false,
        allowsMultipleSelection:false,quality:0.8});
      const uri=result.canceled?null:result.assets[0]?.uri;
      if(!uri)return;
      // Resize the selected logo before persistence. Keep alpha via PNG.
      const small=await ImageManipulator.manipulateAsync(uri,[{resize:{width:240}}],{
        compress:1,format:ImageManipulator.SaveFormat.PNG,base64:true,
      });
      if(!small.base64)throw new Error('Không đọc được dữ liệu logo.');
      const dataUri=`data:image/png;base64,${small.base64}`;
      if(dataUri.length>MAX_LOGO_DATA_URI_CHARS) {
        throw new Error('Logo vượt giới hạn lưu 250 KB. Hãy chọn hình đơn giản hơn.');
      }
      if(!mountedRef.current)return;
      setLogoUri(dataUri);
      setTemplateMessage('Logo đã chọn. Bấm “Lưu mẫu của tôi” để dùng lại lần sau.');
    } catch(e) {if(mountedRef.current)setError(e instanceof Error?e.message:'Không chọn được logo trên thiết bị.');}
  };
  const update=<K extends keyof StampStyle>(key:K,value:StampStyle[K])=>{
    setConfig(current=>({...current,[key]:value}));
    setPresetId(null);
    setTemplateMessage('Mẫu đã thay đổi nhưng chưa lưu trên thiết bị.');
  };
  const choosePreset=(id:StampPresetId)=>{
    const preset=STAMP_PRESETS.find(p=>p.id===id);
    if(!preset)return;
    setConfig({...preset.style});
    setPresetId(id);
    setTemplateMessage('Đã chọn mẫu. Bấm “Lưu mẫu của tôi” để giữ cho lần mở sau.');
  };
  const rememberTemplate=async()=>{
    if(templateBusy||busy||!userId)return;
    setTemplateBusy(true);setError('');
    const generation=getAuthSnapshot().generation;
    try {
      if(generation!==getAuthSnapshot().generation)throw new Error('Phiên đăng nhập đã thay đổi.');
      await saveCameraTemplate(userId,{config,logoDataUri:logoUri,presetId});
      if(mountedRef.current&&generation===getAuthSnapshot().generation)
        setTemplateMessage('Đã lưu mẫu và logo vào thiết bị cho tài khoản này.');
    } catch(e) {if(mountedRef.current)setError(e instanceof Error?e.message:'Không lưu được mẫu.');}
    finally {if(mountedRef.current)setTemplateBusy(false);}
  };
  const forgetTemplate=async()=>{
    if(templateBusy||busy||!userId)return;
    setTemplateBusy(true);setError('');
    try {
      await deleteCameraTemplate(userId);
      if(mountedRef.current){
        setConfig({...DEFAULT_STAMP});setLogoUri(null);setPresetId(null);
        setTemplateMessage('Đã xóa mẫu tùy chỉnh trên thiết bị; quay về mẫu mặc định.');
      }
    } catch(e) {if(mountedRef.current)setError(e instanceof Error?e.message:'Không xóa được mẫu.');}
    finally {if(mountedRef.current)setTemplateBusy(false);}
  };
  const liveFacts=lockCaptureFacts(now,fix);
  const locationFresh=Boolean(fix&&hasFreshLocation(fix.readAt,now));
  // Captured picture is shown at its actual aspect ratio (no crop) before stamping.
  const photoHeight=captured?Math.max(220,Math.min(frameWidth*captured.aspect,frameWidth*1.65)):0;

  return <SafeAreaView style={styles.root} edges={['top','bottom']}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Đóng Camera" onPress={()=>router.back()} style={styles.headerButton}>
        <Text style={styles.headerButtonText}>‹ Trở lại</Text>
      </Pressable>
      <View style={styles.titleBlock}>
        <Text style={styles.headerTitle}>ĐỘC LẬP CAMERA</Text>
        <Text style={styles.headerSubtitle}>{caption(target)}{target.type!=='general' ? ` · ${target.id.slice(0,8)}` : ''}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Tùy chỉnh mẫu đóng dấu" onPress={()=>setShowTemplate(v=>!v)} style={styles.headerButton}>
        <Text style={styles.headerButtonText}>Mẫu</Text>
      </Pressable>
    </View>

    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {!permission?.granted ? <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Cấp quyền Camera</Text>
        <Text style={styles.noticeBody}>Ứng dụng chỉ dùng Camera khi bạn mở màn hình này.</Text>
        <Action label="Cấp quyền Camera" onPress={()=>{void requestPermission();}} />
      </View> : null}

      {!captured && permission?.granted ? <View style={[styles.cameraWrap,{width:frameWidth,height:Math.min(490,frameWidth*1.26)}]}>
        <CameraView ref={cameraRef} facing={facing} style={StyleSheet.absoluteFillObject}
          onCameraReady={()=>setReady(true)} onMountError={()=>setError('Camera không khởi tạo được trên thiết bị.')}/>
        <StampOverlay facts={liveFacts} styleConfig={config} employee={operator} context={`${caption(target)} · ${target.id.slice(0,8)}`}
          note={note} logoUri={logoUri} captured={false}/>
        <View pointerEvents="none" style={[styles.previewLabel,config.position==='top'&&styles.previewLabelBottom]}><Text style={styles.previewLabelText}>XEM TRƯỚC DẤU ẢNH</Text></View>
      </View> : null}

      {captured ? <View style={styles.pictureWrap}>
        <Text style={styles.titleLabel}>Ảnh đã chụp · Dấu thời gian được cố định</Text>
        <View ref={imageFrameRef} collapsable={false}
          style={[styles.photoCanvas,{width:frameWidth,height:photoHeight}]}>
          <Image source={{uri:captured.uri}} resizeMode="contain" style={StyleSheet.absoluteFillObject}
            onLoad={()=>setPhotoReady(true)} onError={()=>setError('Không mở được ảnh vừa chụp.')} />
          <StampOverlay facts={captured.facts} styleConfig={config} employee={operator} context={`${caption(target)} · ${target.id.slice(0,8)}`}
            note={note} logoUri={logoUri} captured />
        </View>
        <Text style={styles.noticeBody}>Nội dung hiển thị trong khung này sẽ được đóng trực tiếp vào ảnh JPEG khi bấm Lưu.</Text>
      </View> : null}

      <View style={styles.locationBar}>
        <View style={{flex:1}}>
          <Text style={styles.locationTitle}>{locationFresh ? 'GPS đã lấy' : 'GPS chưa sẵn sàng'}</Text>
          <Text style={styles.locationBody}>{captured ?
            (captured.facts.latitude===null?'Ảnh này không có vị trí tại thời điểm chụp.':'Vị trí đã cố định trong ảnh.')
            :locMessage}</Text>
        </View>
        {!captured ? <Action small label={locBusy?'Đang lấy...':'Lấy GPS'} disabled={locBusy||busy}
          onPress={()=>{void getGps();}}/> : null}
      </View>

      <View style={styles.actions}>
        {!captured ? <>
          <Action label="Đổi camera" secondary disabled={busy} onPress={()=>{setReady(false);setFacing(v=>v==='back'?'front':'back');}}/>
          <Action label={busy?'Đang chụp...':'● Chụp ảnh'} disabled={!ready||busy||!permission?.granted}
            onPress={()=>{void shoot();}}/>
        </> : <>
          <Action label="Chụp lại" secondary disabled={busy} onPress={()=>{setCaptured(null);setPhotoReady(false);setReady(false);}} />
          <Action label={busy?'Đang tạo JPEG...':'Lưu ảnh có dấu'} disabled={busy||!photoReady} onPress={saveWithGpsNotice}/>
        </>}
      </View>

      <View style={styles.noteSection}>
        <Text style={styles.titleLabel}>Ghi chú minh chứng (tùy chọn)</Text>
        <TextInput value={note} onChangeText={setNote} maxLength={250} multiline placeholder="Ví dụ: Nhận đủ 5 thùng, 1 thùng móp..."
          placeholderTextColor="#8D817A" style={styles.input} accessibilityLabel="Ghi chú ảnh" />
      </View>

      {showTemplate ? <View style={styles.template}>
        <Text style={styles.templateTitle}>Mẫu dấu ảnh ĐỘC LẬP</Text>
        <Text style={styles.noticeBody}>Các mẫu chỉ thay đổi cách trình bày. Thời gian, GPS và mã phiếu luôn được cố định tại lúc chụp.</Text>
        <Text style={styles.titleLabel}>Mẫu nghiệp vụ</Text>
        <View style={styles.presetList}>{STAMP_PRESETS.map(preset=><Pressable key={preset.id}
          accessibilityRole="button" accessibilityLabel={`Chọn mẫu ${preset.title}`}
          accessibilityState={{selected:presetId===preset.id}}
          onPress={()=>choosePreset(preset.id)} style={[styles.preset,presetId===preset.id&&styles.presetSelected]}>
          <Text style={[styles.presetTitle,presetId===preset.id&&styles.presetTextSelected]}>{preset.title}</Text>
          <Text style={[styles.presetDescription,presetId===preset.id&&styles.presetTextSelected]}>{preset.description}</Text>
        </Pressable>)}</View>
        <Toggle label="Logo ĐỘC LẬP" value={config.logo} onPress={()=>update('logo',!config.logo)}/>
        {config.logo ? <View style={styles.actions}>
          <Action small label={logoUri?'Đổi ảnh logo':'Chọn logo từ máy'} secondary onPress={()=>{void selectLogo();}}/>
          {logoUri ? <Action small label="Logo chữ mặc định" secondary onPress={()=>{
            setLogoUri(null);setTemplateMessage('Đang dùng logo chữ. Bấm Lưu mẫu để giữ thay đổi.');
          }}/> : null}
        </View> : null}
        <Toggle label="Hiển thị tọa độ và độ chính xác GPS" value={config.coordinates} onPress={()=>update('coordinates',!config.coordinates)}/>
        <Toggle label="Hiển thị tên nhân viên" value={config.employee} onPress={()=>update('employee',!config.employee)}/>
        <Toggle label="Hiển thị ghi chú trên ảnh" value={config.note} onPress={()=>update('note',!config.note)}/>
        <Text style={styles.titleLabel}>Kích thước chữ</Text>
        <View style={styles.actions}>{(['small','medium','large'] as const).map(value=><Action key={value} small secondary={config.size!==value}
          label={value==='small'?'Nhỏ':value==='medium'?'Vừa':'Lớn'} onPress={()=>update('size',value)} />)}</View>
        <Text style={styles.titleLabel}>Nền dấu</Text>
        <View style={styles.actions}>
          <Action small secondary={config.background!=='burgundy'} label="Đỏ đô" onPress={()=>update('background','burgundy')}/>
          <Action small secondary={config.background!=='dark'} label="Đen mờ" onPress={()=>update('background','dark')}/>
          <Action small secondary={config.background!=='cream'} label="Kem" onPress={()=>update('background','cream')}/>
        </View>
        <Text style={styles.titleLabel}>Vị trí dấu</Text>
        <View style={styles.actions}>
          <Action small secondary={config.position!=='bottom'} label="Dưới ảnh" onPress={()=>update('position','bottom')}/>
          <Action small secondary={config.position!=='top'} label="Trên ảnh" onPress={()=>update('position','top')}/>
        </View>
        <Text style={styles.templateHelp}>Lưu riêng cho tài khoản hiện tại trên điện thoại. Không lưu vị trí, tên, ảnh chụp hay token trong mẫu.</Text>
        <View style={styles.actions}>
          <Action label={templateBusy?'Đang xử lý...':'Lưu mẫu của tôi'} disabled={templateBusy||busy||!userId} onPress={()=>{void rememberTemplate();}}/>
          <Action secondary label="Đặt lại mẫu" disabled={templateBusy||busy||!userId} onPress={()=>{
            Alert.alert('Đặt lại mẫu?','Xóa cấu hình và logo tùy chỉnh đã lưu trên thiết bị của tài khoản này.',[
              {text:'Hủy',style:'cancel'},
              {text:'Đặt lại',onPress:()=>{void forgetTemplate();}},
            ]);
          }}/>
        </View>
        {templateMessage?<Text accessibilityLiveRegion="polite" style={styles.templateHelp}>{templateMessage}</Text>:null}
      </View> : null}
      {!showTemplate && templateMessage ? <Text accessibilityLiveRegion="polite" style={styles.templateHelp}>{templateMessage}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator color={palette.orange}/> : null}
      <Text style={styles.disclaimer}>Thời gian và GPS lấy từ thiết bị, không phải chứng nhận độc lập. Không theo dõi vị trí nền. Ảnh chỉ thành minh chứng đã lưu khi Backend xác nhận upload.</Text>
    </ScrollView>
  </SafeAreaView>;
}

function Action({label,onPress,secondary=false,disabled=false,small=false}:{
  label:string;onPress:()=>void;secondary?:boolean;disabled?:boolean;small?:boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({pressed})=>[styles.action,secondary?styles.actionSecondary:styles.actionPrimary,small&&styles.actionSmall,
      (disabled||pressed)&&{opacity:0.55}] }>
    <Text style={[styles.actionText,secondary&&styles.actionTextSecondary,small&&{fontSize:13}]}>{label}</Text>
  </Pressable>;
}
function Toggle({label,value,onPress}:{label:string;value:boolean;onPress:()=>void}) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{checked:value}}
    onPress={onPress} style={styles.toggle}>
    <Text style={styles.toggleLabel}>{label}</Text>
    <View style={[styles.switch,{backgroundColor:value?palette.orange:'#B8B0AA'}]}>
      <View style={[styles.switchDot,value&&{alignSelf:'flex-end'}]}/>
    </View>
  </Pressable>;
}
const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#FBF6EE'},
  header:{backgroundColor:'#5B070D',flexDirection:'row',paddingHorizontal:12,paddingVertical:10,alignItems:'center',gap:6},
  headerButton:{minWidth:68,minHeight:46,justifyContent:'center',alignItems:'center'},
  headerButtonText:{color:'#FFFFFF',fontSize:14,fontWeight:'800'},
  titleBlock:{flex:1,alignItems:'center',gap:3},
  headerTitle:{color:'#FFFFFF',fontWeight:'900',letterSpacing:0.7,fontSize:15},
  headerSubtitle:{color:'#F0DCBC',fontSize:12},
  scroll:{alignItems:'center',padding:14,paddingBottom:34,gap:14},
  cameraWrap:{position:'relative',borderRadius:16,overflow:'hidden',backgroundColor:'#1B1615'},
  previewLabel:{position:'absolute',left:10,top:10,backgroundColor:'rgba(91,7,13,.7)',padding:8,borderRadius:8},
  previewLabelText:{color:'#FFFFFF',fontSize:11,fontWeight:'800'},
  previewLabelBottom:{top:undefined,bottom:10},
  pictureWrap:{width:'100%',alignItems:'center',gap:10},
  photoCanvas:{overflow:'hidden',backgroundColor:'#1B1615',position:'relative'},
  titleLabel:{color:'#5B070D',fontSize:15,fontWeight:'800'},
  locationBar:{width:'100%',borderWidth:1,borderColor:'#E7DCD0',backgroundColor:'#FFFFFF',borderRadius:14,padding:12,flexDirection:'row',alignItems:'center',gap:8},
  locationTitle:{color:'#5B070D',fontWeight:'800',fontSize:14},
  locationBody:{color:'#675D59',fontSize:12,lineHeight:18,marginTop:4},
  actions:{width:'100%',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,flexWrap:'wrap'},
  action:{minHeight:50,borderRadius:12,paddingHorizontal:18,paddingVertical:10,justifyContent:'center',alignItems:'center',flexGrow:1},
  actionPrimary:{backgroundColor:'#D64027'},
  actionSecondary:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#5B070D'},
  actionSmall:{minHeight:44,paddingHorizontal:10,flexGrow:0},
  actionText:{color:'#FFFFFF',fontSize:15,fontWeight:'800'},
  actionTextSecondary:{color:'#5B070D'},
  noteSection:{width:'100%',gap:8},
  input:{minHeight:76,maxHeight:125,backgroundColor:'#FFFFFF',borderRadius:12,borderWidth:1,borderColor:'#E7DCD0',padding:12,textAlignVertical:'top',fontSize:15,color:'#251B19'},
  template:{width:'100%',backgroundColor:'#FFFFFF',borderRadius:16,borderWidth:1,borderColor:'#E7DCD0',padding:14,gap:12},
  templateTitle:{fontWeight:'900',fontSize:17,color:'#5B070D'},
  presetList:{flexDirection:'row',flexWrap:'wrap',gap:8},
  preset:{flexGrow:1,flexBasis:'45%',minHeight:76,borderRadius:12,padding:10,borderWidth:1,
    borderColor:'#E7DCD0',backgroundColor:'#FBF6EE',justifyContent:'center',gap:3},
  presetSelected:{backgroundColor:'#5B070D',borderColor:'#5B070D'},
  presetTitle:{color:'#5B070D',fontWeight:'800',fontSize:14},
  presetDescription:{color:'#675D59',fontSize:12,lineHeight:17},
  presetTextSelected:{color:'#FFFFFF'},
  templateHelp:{color:'#675D59',fontSize:12,lineHeight:18},
  toggle:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,minHeight:48},
  toggleLabel:{color:'#251B19',fontSize:14,flex:1},
  switch:{width:52,height:30,borderRadius:18,justifyContent:'center',padding:3},
  switchDot:{width:24,height:24,borderRadius:12,backgroundColor:'#FFFFFF'},
  notice:{backgroundColor:'#FFFFFF',borderRadius:14,padding:14,gap:10,width:'100%'},
  noticeTitle:{fontSize:17,fontWeight:'800',color:'#5B070D'},
  noticeBody:{fontSize:12,lineHeight:18,color:'#675D59',textAlign:'center'},
  error:{color:'#A32626',fontSize:14,lineHeight:20,padding:12},
  disclaimer:{color:'#675D59',fontSize:12,lineHeight:19,textAlign:'center',paddingHorizontal:12},
});

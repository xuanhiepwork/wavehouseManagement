import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FieldApiError } from './field.api.ts';

/** High-contrast, large touch targets for bright outdoor environments. */
export const theme = { bg:'#f5f9f7',ink:'#132e26', muted:'#37564b',green:'#145b3f', light:'#e2f2e8',
  border:'#a6c4b4', white:'#ffffff', danger:'#9d2433', amber:'#8b4d08', gold:'#fff0ce' };
export const ux = StyleSheet.create({
  screen:{flex:1, backgroundColor:theme.bg}, content:{gap:15,paddingHorizontal:18,paddingVertical:20,paddingBottom:56,maxWidth:680,width:'100%',alignSelf:'center'},
  title:{color:theme.ink,fontSize:28,lineHeight:36,fontWeight:'800'},
  sub:{color:theme.muted,fontSize:17,lineHeight:26},
  label:{color:theme.ink,fontSize:17,lineHeight:25,fontWeight:'700'},
  text:{color:theme.ink,fontSize:16,lineHeight:25},
  small:{color:theme.muted,fontSize:15,lineHeight:23},
  card:{backgroundColor:theme.white,borderColor:theme.border,borderWidth:1.5,borderRadius:16,padding:17,gap:10},
  action:{backgroundColor:theme.green,borderRadius:14,minHeight:58,paddingHorizontal:16,paddingVertical:14,alignItems:'center',justifyContent:'center'},
  actionText:{color:'#fff',fontSize:18,fontWeight:'800',lineHeight:25,textAlign:'center'},
  secondary:{backgroundColor:theme.white,borderColor:theme.green,borderWidth:2},
  secondaryText:{color:theme.green},
  disabled:{opacity:.45},
  input:{minHeight:56,borderWidth:1.6,borderColor:theme.border,borderRadius:12,backgroundColor:theme.white,
    paddingHorizontal:14,paddingVertical:11,fontSize:18,color:theme.ink},
  badge:{backgroundColor:theme.light,borderRadius:10,paddingHorizontal:10,paddingVertical:5,alignSelf:'flex-start'},
  warning:{backgroundColor:theme.gold,borderRadius:12,padding:14,gap:5},
  gap:{gap:12}, row:{flexDirection:'row',gap:10,flexWrap:'wrap',alignItems:'center'},
});
export function Page({title,lead,children}: {title:string;lead?:string;children:ReactNode}) {
  return <SafeAreaView edges={['left','right','bottom']} style={ux.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ux.content}>
      <Text allowFontScaling accessibilityRole="header" style={ux.title}>{title}</Text>
      {lead ? <Text allowFontScaling style={ux.sub}>{lead}</Text> : null}
      {children}
    </ScrollView>
  </SafeAreaView>;
}
export function Panel({children}: {children:ReactNode}) {return <View style={ux.card}>{children}</View>;}
export function Copy({children,small=false}: {children:ReactNode;small?:boolean}) {return <Text allowFontScaling style={small?ux.small:ux.text}>{children}</Text>;}
export function Header({children}: {children:ReactNode}) {return <Text accessibilityRole="header" allowFontScaling style={ux.label}>{children}</Text>;}
export function Action({label,onPress,secondary=false,disabled=false,testID}: {label:string;onPress:()=>void;secondary?:boolean;disabled?:boolean;testID?:string}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} testID={testID}
    disabled={disabled} onPress={onPress} style={({pressed})=>[ux.action,secondary&&ux.secondary,(pressed||disabled)&&ux.disabled]}>
      <Text allowFontScaling style={[ux.actionText,secondary&&ux.secondaryText]}>{label}</Text>
    </Pressable>;
}
export function FieldInput({label,value,onChangeText,keyboardType='default',placeholder,multiline=false}: {
  label:string;value:string;onChangeText:(value:string)=>void;keyboardType?:KeyboardTypeOptions;placeholder?:string;multiline?:boolean;
}) {return <View style={ux.gap}>
  <Text allowFontScaling style={ux.label}>{label}</Text>
  <TextInput allowFontScaling accessibilityLabel={label} value={value} onChangeText={onChangeText}
    keyboardType={keyboardType} multiline={multiline} placeholder={placeholder} placeholderTextColor="#526759"
    autoCorrect={false} selectionColor={theme.green} style={[ux.input,multiline&&{minHeight:100,textAlignVertical:'top'}]} />
</View>;}
export function Warning({children}: {children:ReactNode}) { return <View style={ux.warning}><Copy>{children}</Copy></View>; }
export function StateNotice({error}: {error:unknown}) { return <View style={ux.warning}>
  <Copy>{error instanceof Error ? error.message : 'Không thể tải dữ liệu. Vui lòng thử tải lại.'}</Copy>
</View>; }
export function Status({children}: {children:ReactNode}) {return <View style={ux.badge}><Copy small>{children}</Copy></View>;}

/** Use Vietnam business date even if handset timezone differs. */
export function businessToday(now = new Date()):string {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(key:string)=>parts.find(x=>x.type===key)?.value??'';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export const shifts = [{code:'MORNING',label:'Sáng'},{code:'AFTERNOON',label:'Chiều'},{code:'EVENING',label:'Tối'}] as const;
export function formatShift(value:string):string {return shifts.find(x=>x.code===value)?.label??value;}
export function formatQuantity(value:unknown):string {
  return typeof value==='string' ? value : value!=null ? String(value) : '—';
}
export function parseQuantity(value:string):boolean {
  return /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value) && Number.isFinite(Number(value));
}
export function Selection<T extends string>({options,value,onChange}: {options:readonly {code:T;label:string}[];value:T;onChange:(v:T)=>void}) {
  return <View style={ux.row}>{options.map(option=><Pressable key={option.code} accessibilityRole="radio"
    accessibilityState={{checked:value===option.code}} onPress={()=>onChange(option.code)}
    style={[ux.action, {flexGrow:1,minWidth:85}, value!==option.code&&ux.secondary]}>
      <Text allowFontScaling style={[ux.actionText,value!==option.code&&ux.secondaryText]}>{option.label}</Text>
    </Pressable>)}</View>;
}
/** Abort GETs on route blur; refresh is explicit and never runs during background navigation. */
export function useFieldRead<T>(fetcher:(signal:AbortSignal)=>Promise<T>) {
  const [value,setValue]=useState<T|null>(null);
  const [error,setError]=useState<unknown>(null);
  const [loading,setLoading]=useState(false);
  const ref=useRef<AbortController|null>(null);
  const current=useRef(0);
  const refresh=useCallback(async()=>{
    ref.current?.abort();
    const controller=new AbortController();ref.current=controller;
    const seq=++current.current;
    setLoading(true);setError(null);setValue(null);
    try { const data=await fetcher(controller.signal);
      if (!controller.signal.aborted&&seq===current.current)setValue(data);
    } catch (e) { if (!controller.signal.aborted&&seq===current.current)setError(e); }
    finally {if(!controller.signal.aborted&&seq===current.current)setLoading(false);}
  },[fetcher]);
  useFocusEffect(useCallback(()=>{void refresh();return ()=>{
    ref.current?.abort();current.current++;
  };},[refresh]));
  useEffect(()=>()=>{ref.current?.abort();},[]);
  return {value,error,loading,refresh,clear:()=>setValue(null)};
}
export function LoadControl({loading,onRefresh,error}: {loading:boolean;onRefresh:()=>void;error:unknown}) {
  return <View style={ux.gap}>
    {loading?<ActivityIndicator size="large" color={theme.green} accessibilityLabel="Đang tải dữ liệu" />:null}
    {error?<StateNotice error={error}/>:null}
    <Action label={loading?'Đang tải...':'Tải lại thông tin'} disabled={loading} secondary onPress={onRefresh}/>
  </View>;
}
/** Blocks duplicate taps and asks for explicit human confirmation before inventory-affecting requests. */
export function useSafeMutation() {
  const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>(null);const lock=useRef(false);
  const execute=useCallback(async<T,>(work:()=>Promise<T>, after:(data:T)=>void)=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);setError(null);
    try {after(await work());} catch(e){setError(e);} finally {lock.current=false;setBusy(false);}
  },[]);
  return {busy,error,execute,reset:()=>setError(null)};
}
export function explainWriteError(error:unknown):string {
  if(error instanceof FieldApiError && error.uncertainWrite) return error.message;
  return error instanceof Error?error.message:'Thao tác chưa hoàn tất.';
}

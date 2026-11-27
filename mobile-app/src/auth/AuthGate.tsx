import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createMobileAuthClient, MobileAuthError } from './auth.api.ts';
import { clearAuthSession, getAuthSnapshot, subscribeAuth } from './session.ts';

const styles = StyleSheet.create({
  frame:{flex:1,backgroundColor:'#f5f9f7'},
  scroll:{flexGrow:1,justifyContent:'center',padding:20},
  form:{width:'100%',maxWidth:520,alignSelf:'center',gap:16},
  eyebrow:{fontSize:17,fontWeight:'800',color:'#145b3f'},
  title:{color:'#132e26',fontSize:31,lineHeight:40,fontWeight:'800'},
  caption:{color:'#37564b',fontSize:17,lineHeight:25},
  label:{color:'#132e26',fontWeight:'700',fontSize:17},
  input:{minHeight:58,borderWidth:1.6,borderColor:'#9dbfae',backgroundColor:'#fff',borderRadius:14,paddingHorizontal:15,fontSize:18,color:'#132e26'},
  button:{backgroundColor:'#145b3f',minHeight:60,paddingVertical:15,paddingHorizontal:18,borderRadius:14,justifyContent:'center',alignItems:'center'},
  buttonText:{color:'#fff',fontSize:18,fontWeight:'800'},
  error:{color:'#921c2c',fontSize:16,lineHeight:24},
  bar:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,paddingHorizontal:12,
    backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#9dbfae',minHeight:62},
  user:{color:'#132e26',fontSize:15,fontWeight:'700',flex:1},
  signOut:{color:'#145b3f',fontWeight:'800',fontSize:16},
  signOutTap:{minHeight:48,minWidth:88,paddingHorizontal:12,alignItems:'center',justifyContent:'center',borderRadius:12,
    borderColor:'#145b3f',borderWidth:1.5},
});
function SignInScreen(){
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const signIn=useCallback(async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{await createMobileAuthClient().signIn(email.trim(),password);}
    catch(cause){setError(cause instanceof MobileAuthError?cause.message:'Không đăng nhập được. Kiểm tra kết nối.');}
    finally{lock.current=false;setPassword('');setBusy(false);}
  },[email,password]);
  return <SafeAreaView style={styles.frame}>
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.frame}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View style={styles.form}>
          <Text allowFontScaling style={styles.eyebrow}>WAVEHOUSE · MOBILE</Text>
          <Text allowFontScaling accessibilityRole="header" style={styles.title}>Đăng nhập làm việc</Text>
          <Text allowFontScaling style={styles.caption}>Dành cho nhân viên quầy, nhân viên giao hàng và quản lý khu. Vui lòng đăng nhập khi đã dừng xe an toàn.</Text>
          <Text allowFontScaling style={styles.label}>Email tài khoản</Text>
          <TextInput allowFontScaling accessibilityLabel="Email" value={email} onChangeText={setEmail}
            placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            autoComplete="email" editable={!busy} placeholderTextColor="#526759" style={styles.input}/>
          <Text allowFontScaling style={styles.label}>Mật khẩu</Text>
          <TextInput allowFontScaling accessibilityLabel="Mật khẩu" value={password} onChangeText={setPassword}
            placeholder="Mật khẩu" secureTextEntry autoCapitalize="none" autoComplete="current-password"
            editable={!busy} onSubmitEditing={()=>{void signIn();}} placeholderTextColor="#526759" style={styles.input}/>
          {error?<Text allowFontScaling accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
          <Pressable accessibilityRole="button" accessibilityLabel="Đăng nhập" disabled={busy}
            onPress={()=>{void signIn();}} style={({pressed})=>[styles.button,(busy||pressed)&&{opacity:.7}]}>
            {busy?<ActivityIndicator color="#fff"/>:<Text allowFontScaling style={styles.buttonText}>Đăng nhập</Text>}
          </Pressable>
          <Text allowFontScaling style={styles.caption}>Nếu không có mạng, App sẽ không gửi thông tin đăng nhập. Không chia sẻ tài khoản cho người khác.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
/** Route-level guard: prevents deep links from mounting operational clients without a session. */
export function AuthGate({children}:{children:ReactNode}){
  const {user}=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  if(!user)return <SignInScreen/>;
  return <View style={styles.frame}>
    <View style={styles.bar}>
      <Text allowFontScaling numberOfLines={2} style={styles.user}>{user.displayName} · {user.role==='BRANCH_MANAGER'?'Quản lý khu':user.role==='ADMIN'?'Quản trị':user.workKind==='KITCHEN_DELIVERY'?'Giao hàng / Kho':'Nhân viên quầy'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Đăng xuất" onPress={()=>{
        try{void createMobileAuthClient().signOut();}
        catch{clearAuthSession();}
      }} style={styles.signOutTap}><Text allowFontScaling style={styles.signOut}>Thoát</Text></Pressable>
    </View>
    {children}
  </View>;
}

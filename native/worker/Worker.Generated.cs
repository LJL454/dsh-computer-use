using System;
using System.Collections.Generic;
namespace DshWorker {
partial class Program {
static void Register(Scope s){var o=new List<object>();s.Set(@"script:CancelFile",@"");
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"env:DSH_COMPUTER_USE_CANCEL_FILE"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1) => {R.Emit(o1,s.Get(@"env:DSH_COMPUTER_USE_CANCEL_FILE"));}))),@""))))){s.Set(@"script:CancelFile",(""+R.Str(R.Capture((o2) => {R.Emit(o2,s.Get(@"env:DSH_COMPUTER_USE_CANCEL_FILE"));}))));}
s.Set(@"script:BootGen",R.Invoke(R.Invoke(R.Invoke(R.Type(@"System.Guid"),@"NewGuid",new object[]{}),@"ToString",new object[]{@"N"}),@"Substring",new object[]{0,4}));
s.Set(@"script:RequestSeq",0);
s.Functions[@"Test-CancelRequested"]=new Fn(s,F_Test_CancelRequested_3);
s.Functions[@"Clear-CancelRequest"]=new Fn(s,F_Clear_CancelRequest_5);
s.Functions[@"Assert-NotCancelled"]=new Fn(s,F_Assert_NotCancelled_7);
s.Set(@"script:DeadlineAtMs",R.Cast(@"int64",0));
s.Functions[@"Set-DeadlineAt"]=new Fn(s,F_Set_DeadlineAt_8);
s.Functions[@"Clear-Deadline"]=new Fn(s,F_Clear_Deadline_9);
s.Functions[@"Get-DeadlineRemainingMs"]=new Fn(s,F_Get_DeadlineRemainingMs_10);
s.Functions[@"Assert-WithinDeadline"]=new Fn(s,F_Assert_WithinDeadline_11);
s.Functions[@"Assert-CanSend"]=new Fn(s,F_Assert_CanSend_12);
s.Functions[@"Test-InputDelivery"]=new Fn(s,F_Test_InputDelivery_13);
s.Functions[@"Assert-InputDelivered"]=new Fn(s,F_Assert_InputDelivered_14);
s.Functions[@"Wait-Cancellable"]=new Fn(s,F_Wait_Cancellable_18);
R.Emit(o,R.Call(s,@"Out-Null",new Args(new object[]{}),R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"TypeDefinition",R.Switch),s.Get(@"nativeSource"),new Named(@"Language",R.Switch),@"CSharp"}),null)));
R.Emit(o,R.Call(s,@"Out-Null",new Args(new object[]{}),R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"System.Drawing"}),null)));
R.Emit(o,R.Call(s,@"Out-Null",new Args(new object[]{}),R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"System.Windows.Forms"}),null)));
s.Set(@"script:ComUiaReady",s.Get(@"false"));
try{R.Emit(o,R.Call(s,@"Out-Null",new Args(new object[]{}),R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"TypeDefinition",R.Switch),s.Get(@"uiaComSource"),new Named(@"Language",R.Switch),@"CSharp"}),null)));
s.Set(@"script:ComUiaReady",R.Invoke(R.Type(@"DshUia.Engine"),@"Available",new object[]{}));
if(R.Bool(R.Unary(@"Not",s.Get(@"script:ComUiaReady")))){s.Set(@"script:ComUiaError",R.Invoke(R.Type(@"DshUia.Engine"),@"LastError",new object[]{}));}}catch(Exception error20) when (!(error20 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error20}));s.Set(@"script:ComUiaReady",s.Get(@"false"));
s.Set(@"script:ComUiaError",R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}
s.Set(@"dpiMode",R.Invoke(R.Type(@"DshNative"),@"EnableDpiAwareness",new object[]{}));
s.Set(@"dpiActual",R.Invoke(R.Type(@"DshNative"),@"ActualDpiAwareness",new object[]{}));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"dpiActual"),@"per-monitor")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"dpiActual"),@"per-monitor-v2"))))){R.Emit(o,R.Invoke(R.Member(R.Type(@"Console"),@"Error"),@"WriteLine",new object[]{(""+@"dsh-computer-use: DPI awareness is '"+R.Str(s.Get(@"dpiActual"))+@"' (asked for '"+R.Str(s.Get(@"dpiMode"))+@"'); on a scaled display screen coordinates may be virtualized")}));}
s.Set(@"VK",R.Map(new object[]{}));
{s.Set(@"c",R.Cast(@"int",R.Cast(@"char",@"A")));while(R.Bool(R.Binary(s,@"Ile",s.Get(@"c"),R.Cast(@"int",R.Cast(@"char",@"Z"))))){try{R.SetIndex(s.Get(@"VK"),R.Cast(@"string",R.Cast(@"char",s.Get(@"c"))),s.Get(@"c"));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u21=s.Get(@"c");s.Set(@"c",R.Binary(s,@"Plus",u21,1L));return u21;}));}}
{s.Set(@"c",R.Cast(@"int",R.Cast(@"char",@"0")));while(R.Bool(R.Binary(s,@"Ile",s.Get(@"c"),R.Cast(@"int",R.Cast(@"char",@"9"))))){try{R.SetIndex(s.Get(@"VK"),R.Cast(@"string",R.Cast(@"char",s.Get(@"c"))),s.Get(@"c"));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u22=s.Get(@"c");s.Set(@"c",R.Binary(s,@"Plus",u22,1L));return u22;}));}}
{s.Set(@"i",1);while(R.Bool(R.Binary(s,@"Ile",s.Get(@"i"),24))){try{R.SetIndex(s.Get(@"VK"),(""+@"f"+R.Str(s.Get(@"i"))),R.Binary(s,@"Plus",111,s.Get(@"i")));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u23=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u23,1L));return u23;}));}}
R.SetIndex(s.Get(@"VK"),@"backspace",8);
R.SetIndex(s.Get(@"VK"),@"tab",9);
R.SetIndex(s.Get(@"VK"),@"enter",13);
R.SetIndex(s.Get(@"VK"),@"return",13);
R.SetIndex(s.Get(@"VK"),@"shift",16);
R.SetIndex(s.Get(@"VK"),@"ctrl",17);
R.SetIndex(s.Get(@"VK"),@"control",17);
R.SetIndex(s.Get(@"VK"),@"alt",18);
R.SetIndex(s.Get(@"VK"),@"pause",19);
R.SetIndex(s.Get(@"VK"),@"capslock",20);
R.SetIndex(s.Get(@"VK"),@"esc",27);
R.SetIndex(s.Get(@"VK"),@"escape",27);
R.SetIndex(s.Get(@"VK"),@"space",32);
R.SetIndex(s.Get(@"VK"),@"pageup",33);
R.SetIndex(s.Get(@"VK"),@"pagedown",34);
R.SetIndex(s.Get(@"VK"),@"end",35);
R.SetIndex(s.Get(@"VK"),@"home",36);
R.SetIndex(s.Get(@"VK"),@"left",37);
R.SetIndex(s.Get(@"VK"),@"up",38);
R.SetIndex(s.Get(@"VK"),@"right",39);
R.SetIndex(s.Get(@"VK"),@"down",40);
R.SetIndex(s.Get(@"VK"),@"printscreen",44);
R.SetIndex(s.Get(@"VK"),@"insert",45);
R.SetIndex(s.Get(@"VK"),@"delete",46);
R.SetIndex(s.Get(@"VK"),@"del",46);
R.SetIndex(s.Get(@"VK"),@"win",91);
R.SetIndex(s.Get(@"VK"),@"lwin",91);
R.SetIndex(s.Get(@"VK"),@"meta",91);
R.SetIndex(s.Get(@"VK"),@"super",91);
R.SetIndex(s.Get(@"VK"),@"rwin",92);
R.SetIndex(s.Get(@"VK"),@"cmd",91);
R.SetIndex(s.Get(@"VK"),@"command",91);
R.SetIndex(s.Get(@"VK"),@"opt",18);
R.SetIndex(s.Get(@"VK"),@"option",18);
R.SetIndex(s.Get(@"VK"),@"numlock",144);
R.SetIndex(s.Get(@"VK"),@"scrolllock",145);
R.SetIndex(s.Get(@"VK"),@";",186);
R.SetIndex(s.Get(@"VK"),@"=",187);
R.SetIndex(s.Get(@"VK"),@",",188);
R.SetIndex(s.Get(@"VK"),@"-",189);
R.SetIndex(s.Get(@"VK"),@".",190);
R.SetIndex(s.Get(@"VK"),@"/",191);
R.SetIndex(s.Get(@"VK"),@"`",192);
R.SetIndex(s.Get(@"VK"),@"[",219);
R.SetIndex(s.Get(@"VK"),@"\",220);
R.SetIndex(s.Get(@"VK"),@"]",221);
R.SetIndex(s.Get(@"VK"),@"'",222);
s.Set(@"EXTENDED",R.Array(R.Capture((o24) => {R.Emit(o24,new object[]{33,34,35,36,37,38,39,40,44,45,46,91,92,144});})));
s.Set(@"script:HeldKeys",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[int]"}),null));
s.Set(@"script:HeldButtons",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[int]"}),null));
s.Set(@"script:HeldStateFile",@"");
if(R.Bool(s.Get(@"env:DSH_COMPUTER_USE_HELD_FILE"))){s.Set(@"script:HeldStateFile",(""+R.Str(R.Capture((o25) => {R.Emit(o25,s.Get(@"env:DSH_COMPUTER_USE_HELD_FILE"));}))));}
s.Functions[@"Get-PacingEnvInt"]=new Fn(s,F_Get_PacingEnvInt_26);
s.Set(@"script:Clock",R.Invoke(R.Type(@"System.Diagnostics.Stopwatch"),@"StartNew",new object[]{}));
s.Set(@"script:PostActionMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_SETTLE_MS",300,0,5000}),null));
s.Set(@"script:StabilityPollMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_STABILITY_POLL_MS",250,20,2000}),null));
s.Set(@"script:StabilityCeilingMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_STABILITY_MS",0,0,30000}),null));
s.Set(@"script:StabilityStableMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_STABLE_MS",1500,1,30000}),null));
s.Set(@"script:StabilityMaxMs",30000);
s.Set(@"script:WriteStampTtlMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_WRITE_TTL_MS",2000,100,60000}),null));
s.Set(@"script:WaitPollMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_WAIT_POLL_MS",120,20,2000}),null));
s.Set(@"script:WaitHeavyPollMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_WAIT_HEAVY_POLL_MS",300,20,2000}),null));
s.Set(@"script:WaitMaxMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_WAIT_MAX_MS",30000,100,120000}),null));
s.Set(@"script:ReadSettleMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_READ_SETTLE_MS",0,0,1000}),null));
s.Set(@"script:FrameVerifyAfterMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_FRAME_VERIFY_MS",2500,0,600000}),null));
s.Set(@"script:LastWrite",s.Get(@"null"));
s.Set(@"script:LastDrag",s.Get(@"null"));
s.Set(@"script:DragTtlMs",R.Call(s,@"Get-PacingEnvInt",new Args(new object[]{@"DSH_COMPUTER_USE_DRAG_TTL_MS",8000,100,120000}),null));
s.Set(@"script:DragGeneration",0);
s.Functions[@"Set-DragHandle"]=new Fn(s,F_Set_DragHandle_27);
s.Functions[@"Get-DragHandle"]=new Fn(s,F_Get_DragHandle_30);
s.Functions[@"Clear-DragHandle"]=new Fn(s,F_Clear_DragHandle_35);
s.Set(@"script:RegionBaselines",R.Map(new object[]{}));
s.Set(@"script:WriteSeq",R.Cast(@"int64",0));
s.Set(@"script:LastCapture",s.Get(@"null"));
s.Set(@"script:CaptureSeq",0);
s.Functions[@"Record-Capture"]=new Fn(s,F_Record_Capture_36);
s.Functions[@"Advance-ObservationEpoch"]=new Fn(s,F_Advance_ObservationEpoch_38);
s.Functions[@"Get-CaptureStampInfo"]=new Fn(s,F_Get_CaptureStampInfo_39);
s.Functions[@"Set-PayloadField"]=new Fn(s,F_Set_PayloadField_42);
s.Functions[@"Remove-PayloadField"]=new Fn(s,F_Remove_PayloadField_43);
s.Functions[@"Test-CaptureAfterWrite"]=new Fn(s,F_Test_CaptureAfterWrite_44);
s.Functions[@"Test-CaptureReusable"]=new Fn(s,F_Test_CaptureReusable_45);
s.Functions[@"Set-WriteStamp"]=new Fn(s,F_Set_WriteStamp_48);
s.Functions[@"Get-WriteStampInfo"]=new Fn(s,F_Get_WriteStampInfo_50);
s.Functions[@"Complete-WriteStamp"]=new Fn(s,F_Complete_WriteStamp_52);
s.Functions[@"Wait-ForSettle"]=new Fn(s,F_Wait_ForSettle_53);
s.Functions[@"Resolve-StabilityBudget"]=new Fn(s,F_Resolve_StabilityBudget_54);
s.Functions[@"New-StabilityResult"]=new Fn(s,F_New_StabilityResult_56);
s.Functions[@"New-StabilityTarget"]=new Fn(s,F_New_StabilityTarget_57);
s.Functions[@"Wait-ForStable"]=new Fn(s,F_Wait_ForStable_58);
s.Functions[@"Get-PacingConfig"]=new Fn(s,F_Get_PacingConfig_68);
s.Functions[@"Add-HeldKey"]=new Fn(s,F_Add_HeldKey_69);
s.Functions[@"Remove-HeldKey"]=new Fn(s,F_Remove_HeldKey_70);
s.Functions[@"Add-HeldButton"]=new Fn(s,F_Add_HeldButton_71);
s.Functions[@"Remove-HeldButton"]=new Fn(s,F_Remove_HeldButton_72);
s.Functions[@"Save-HeldState"]=new Fn(s,F_Save_HeldState_73);
s.Functions[@"Get-UpFlag"]=new Fn(s,F_Get_UpFlag_79);
s.Functions[@"Release-HeldInput"]=new Fn(s,F_Release_HeldInput_80);
s.Functions[@"Get-WindowInfoForHwnd"]=new Fn(s,F_Get_WindowInfoForHwnd_88);
s.Functions[@"Get-WindowRectInfo"]=new Fn(s,F_Get_WindowRectInfo_90);
s.Functions[@"Get-BitmapDigest"]=new Fn(s,F_Get_BitmapDigest_91);
s.Functions[@"Get-BitmapDigestScaled"]=new Fn(s,F_Get_BitmapDigestScaled_92);
s.Functions[@"Get-RegionDigest"]=new Fn(s,F_Get_RegionDigest_93);
s.Functions[@"Get-WindowDigest"]=new Fn(s,F_Get_WindowDigest_94);
s.Functions[@"Get-ForegroundRect"]=new Fn(s,F_Get_ForegroundRect_95);
s.Functions[@"Get-InjectableForeground"]=new Fn(s,F_Get_InjectableForeground_96);
s.Functions[@"Assert-ExpectedForeground"]=new Fn(s,F_Assert_ExpectedForeground_98);
s.Functions[@"Assert-InjectableForeground"]=new Fn(s,F_Assert_InjectableForeground_104);
s.Functions[@"Get-ScreenList"]=new Fn(s,F_Get_ScreenList_106);
s.Functions[@"Get-VirtualBounds"]=new Fn(s,F_Get_VirtualBounds_110);
s.Functions[@"Get-ForegroundInfo"]=new Fn(s,F_Get_ForegroundInfo_111);
s.Set(@"MAX_CAPTURE_PIXELS",33554432);
s.Set(@"MAX_CAPTURE_EDGE",16384);
s.Functions[@"Resolve-Target"]=new Fn(s,F_Resolve_Target_113);
s.Set(@"script:JpegCodec",s.Get(@"null"));
s.Functions[@"Test-BitmapHasContent"]=new Fn(s,F_Test_BitmapHasContent_121);
s.Functions[@"Save-BitmapToFile"]=new Fn(s,F_Save_BitmapToFile_124);
s.Set(@"script:ZOrderCache",s.Get(@"null"));
s.Functions[@"Get-TopLevelZOrder"]=new Fn(s,F_Get_TopLevelZOrder_126);
s.Functions[@"Get-RelatedWindowList"]=new Fn(s,F_Get_RelatedWindowList_128);
s.Functions[@"Do-ScreenshotRelated"]=new Fn(s,F_Do_ScreenshotRelated_137);
s.Functions[@"Do-Screenshot"]=new Fn(s,F_Do_Screenshot_173);
s.Functions[@"Test-PointOnDesktop"]=new Fn(s,F_Test_PointOnDesktop_218);
s.Functions[@"Assert-PointOnDesktop"]=new Fn(s,F_Assert_PointOnDesktop_219);
s.Functions[@"Wait-ForCursorToSettle"]=new Fn(s,F_Wait_ForCursorToSettle_222);
s.Functions[@"Do-MouseMoveRelative"]=new Fn(s,F_Do_MouseMoveRelative_223);
s.Functions[@"Do-MouseMove"]=new Fn(s,F_Do_MouseMove_225);
s.Functions[@"Get-ButtonFlags"]=new Fn(s,F_Get_ButtonFlags_232);
s.Functions[@"Get-PressableElementAtPoint"]=new Fn(s,F_Get_PressableElementAtPoint_238);
s.Functions[@"Get-HitIdentity"]=new Fn(s,F_Get_HitIdentity_242);
s.Set(@"script:FrameRegistry",R.Map(new object[]{}));
s.Set(@"script:FrameSeq",0);
s.Set(@"script:FrameKeep",32);
s.Set(@"MAX_MERGED_NAME",240);
s.Set(@"script:ObservationEpoch",R.Cast(@"int64",0));
s.Set(@"script:FrameProtocol",2);
s.Functions[@"Get-CaptureSpecKey"]=new Fn(s,F_Get_CaptureSpecKey_246);
s.Functions[@"New-CaptureFrame"]=new Fn(s,F_New_CaptureFrame_251);
s.Functions[@"Set-FrameCompleted"]=new Fn(s,F_Set_FrameCompleted_264);
s.Functions[@"Test-FrameContentUnchanged"]=new Fn(s,F_Test_FrameContentUnchanged_265);
s.Functions[@"Get-LandingWindow"]=new Fn(s,F_Get_LandingWindow_269);
s.Functions[@"Get-WindowRootHwnd"]=new Fn(s,F_Get_WindowRootHwnd_272);
s.Functions[@"Get-WindowOwnerHwnd"]=new Fn(s,F_Get_WindowOwnerHwnd_274);
s.Functions[@"Get-ProcessStartTicks"]=new Fn(s,F_Get_ProcessStartTicks_276);
s.Functions[@"Get-WindowDpi"]=new Fn(s,F_Get_WindowDpi_278);
s.Functions[@"Test-LandingGuard"]=new Fn(s,F_Test_LandingGuard_280);
s.Functions[@"Get-FrameTransform"]=new Fn(s,F_Get_FrameTransform_297);
s.Functions[@"Assert-FrameContentFresh"]=new Fn(s,F_Assert_FrameContentFresh_306);
s.Functions[@"Test-FrameLive"]=new Fn(s,F_Test_FrameLive_309);
s.Functions[@"Resolve-FramePoint"]=new Fn(s,F_Resolve_FramePoint_332);
s.Functions[@"Get-FrameReceipt"]=new Fn(s,F_Get_FrameReceipt_348);
s.Functions[@"Do-Click"]=new Fn(s,F_Do_Click_352);
s.Functions[@"Do-Drag"]=new Fn(s,F_Do_Drag_360);
s.Functions[@"Do-Scroll"]=new Fn(s,F_Do_Scroll_400);
s.Functions[@"Do-Type"]=new Fn(s,F_Do_Type_406);
s.Functions[@"Get-KeyVkList"]=new Fn(s,F_Get_KeyVkList_414);
s.Functions[@"Send-Modifiers"]=new Fn(s,F_Send_Modifiers_421);
s.Functions[@"Do-Key"]=new Fn(s,F_Do_Key_425);
s.Set(@"CLIPBOARD_ATTEMPTS",6);
s.Set(@"CLIPBOARD_RETRY_MS",40);
s.Set(@"CLIPBOARD_MAX_CHARS",200000);
s.Functions[@"Get-ClipboardText"]=new Fn(s,F_Get_ClipboardText_433);
s.Functions[@"Set-ClipboardText"]=new Fn(s,F_Set_ClipboardText_437);
s.Functions[@"Do-Clipboard"]=new Fn(s,F_Do_Clipboard_441);
s.Functions[@"Send-CtrlV"]=new Fn(s,F_Send_CtrlV_443);
s.Functions[@"Get-TextFingerprint"]=new Fn(s,F_Get_TextFingerprint_445);
s.Functions[@"Get-ClipboardShape"]=new Fn(s,F_Get_ClipboardShape_446);
s.Functions[@"Get-PasteVerification"]=new Fn(s,F_Get_PasteVerification_458);
s.Functions[@"Do-Paste"]=new Fn(s,F_Do_Paste_483);
s.Set(@"script:AppDiscovery",R.Map(new object[]{@"startMenu",s.Get(@"null"),@"startMenuAt",R.Member(R.Type(@"DateTime"),@"MinValue"),@"startApps",s.Get(@"null"),@"startAppsAt",R.Member(R.Type(@"DateTime"),@"MinValue"),@"usage",s.Get(@"null"),@"usageKnown",s.Get(@"false"),@"usageAt",R.Member(R.Type(@"DateTime"),@"MinValue"),@"processes",s.Get(@"null"),@"processesAt",R.Member(R.Type(@"DateTime"),@"MinValue")}));
s.Functions[@"Get-AppDiscovery"]=new Fn(s,F_Get_AppDiscovery_498);
s.Functions[@"Get-RunningProcessMap"]=new Fn(s,F_Get_RunningProcessMap_521);
s.Functions[@"Get-NameMatchScore"]=new Fn(s,F_Get_NameMatchScore_529);
s.Functions[@"Get-AppUsageCountFor"]=new Fn(s,F_Get_AppUsageCountFor_530);
s.Functions[@"Add-LaunchSignals"]=new Fn(s,F_Add_LaunchSignals_533);
s.Functions[@"Resolve-LaunchTarget"]=new Fn(s,F_Resolve_LaunchTarget_540);
s.Functions[@"Get-VisibleWindows"]=new Fn(s,F_Get_VisibleWindows_588);
s.Functions[@"Find-WindowForPid"]=new Fn(s,F_Find_WindowForPid_592);
s.Functions[@"Do-Launch"]=new Fn(s,F_Do_Launch_594);
s.Functions[@"Do-Release"]=new Fn(s,F_Do_Release_620);
s.Functions[@"Do-Digest"]=new Fn(s,F_Do_Digest_622);
s.Functions[@"Do-Windows"]=new Fn(s,F_Do_Windows_623);
s.Functions[@"Do-Focus"]=new Fn(s,F_Do_Focus_627);
s.Functions[@"Do-Cursor"]=new Fn(s,F_Do_Cursor_629);
s.Functions[@"Test-Pattern"]=new Fn(s,F_Test_Pattern_630);
s.Functions[@"ConvertTo-SafeInt"]=new Fn(s,F_ConvertTo_SafeInt_632);
s.Functions[@"Test-RectFinite"]=new Fn(s,F_Test_RectFinite_633);
s.Functions[@"ConvertFrom-ComRows"]=new Fn(s,F_ConvertFrom_ComRows_636);
s.Functions[@"Get-ComUiTree"]=new Fn(s,F_Get_ComUiTree_639);
s.Functions[@"Test-LegacyBridgeRows"]=new Fn(s,F_Test_LegacyBridgeRows_645);
s.Functions[@"Get-VisitBudget"]=new Fn(s,F_Get_VisitBudget_654);
s.Functions[@"New-WalkLedger"]=new Fn(s,F_New_WalkLedger_655);
s.Functions[@"Test-WalkAllowed"]=new Fn(s,F_Test_WalkAllowed_656);
s.Functions[@"Add-WalkHit"]=new Fn(s,F_Add_WalkHit_657);
s.Functions[@"Add-HealthProbe"]=new Fn(s,F_Add_HealthProbe_659);
s.Functions[@"Add-ClientReset"]=new Fn(s,F_Add_ClientReset_661);
s.Functions[@"Reset-WalkCounters"]=new Fn(s,F_Reset_WalkCounters_663);
s.Set(@"script:WalkLedger",s.Get(@"null"));
s.Set(@"script:ElementRegistry",R.Map(new object[]{}));
s.Set(@"script:SnapshotSeq",0);
s.Set(@"script:ElementRegistryCap",4000);
s.Set(@"script:SnapshotKeep",64);
s.Functions[@"Get-NodeToken"]=new Fn(s,F_Get_NodeToken_664);
s.Functions[@"Get-RowKey"]=new Fn(s,F_Get_RowKey_668);
s.Functions[@"New-ElementSnapshot"]=new Fn(s,F_New_ElementSnapshot_672);
s.Functions[@"Test-RowAnonymous"]=new Fn(s,F_Test_RowAnonymous_685);
s.Functions[@"Test-RowNumericName"]=new Fn(s,F_Test_RowNumericName_689);
s.Functions[@"Get-RowPriority"]=new Fn(s,F_Get_RowPriority_690);
s.Functions[@"Get-RowLeafFlags"]=new Fn(s,F_Get_RowLeafFlags_695);
s.Functions[@"Test-RowTextOnly"]=new Fn(s,F_Test_RowTextOnly_697);
s.Functions[@"Get-TextRunSeparator"]=new Fn(s,F_Get_TextRunSeparator_701);
s.Functions[@"Merge-UiTextRuns"]=new Fn(s,F_Merge_UiTextRuns_702);
s.Functions[@"Test-RowPassThrough"]=new Fn(s,F_Test_RowPassThrough_708);
s.Functions[@"Collapse-UiPassThroughChains"]=new Fn(s,F_Collapse_UiPassThroughChains_712);
s.Functions[@"Optimize-UiRows"]=new Fn(s,F_Optimize_UiRows_718);
s.Functions[@"Get-SnapshotEntries"]=new Fn(s,F_Get_SnapshotEntries_741);
s.Functions[@"New-TreeDelta"]=new Fn(s,F_New_TreeDelta_743);
s.Functions[@"Complete-UiTree"]=new Fn(s,F_Complete_UiTree_788);
s.Set(@"script:TextBudgetDefault",2000);
s.Set(@"script:TextBudgetMax",16000);
s.Set(@"script:FocusedSummaryDefault",256);
s.Set(@"script:FocusedSummaryMax",1024);
s.Set(@"script:SelectedItemsDefault",20);
s.Set(@"script:SelectedItemsMax",100);
s.Functions[@"Get-ArgMember"]=new Fn(s,F_Get_ArgMember_796);
s.Functions[@"Get-TextObservationConfig"]=new Fn(s,F_Get_TextObservationConfig_797);
s.Functions[@"New-TextBudget"]=new Fn(s,F_New_TextBudget_803);
s.Functions[@"Get-BudgetRemaining"]=new Fn(s,F_Get_BudgetRemaining_804);
s.Functions[@"Split-TextAtBudget"]=new Fn(s,F_Split_TextAtBudget_805);
s.Functions[@"Add-BudgetedText"]=new Fn(s,F_Add_BudgetedText_806);
s.Functions[@"Read-UiaRangeText"]=new Fn(s,F_Read_UiaRangeText_808);
s.Functions[@"Test-UiaCurrentPattern"]=new Fn(s,F_Test_UiaCurrentPattern_811);
s.Functions[@"Get-UiaCurrentPattern"]=new Fn(s,F_Get_UiaCurrentPattern_813);
s.Functions[@"Get-UiaElementWindowHwnd"]=new Fn(s,F_Get_UiaElementWindowHwnd_815);
s.Functions[@"Get-UiaElementValueText"]=new Fn(s,F_Get_UiaElementValueText_818);
s.Functions[@"Format-UiaElementLine"]=new Fn(s,F_Format_UiaElementLine_820);
s.Functions[@"Get-UiaSelectionSummaries"]=new Fn(s,F_Get_UiaSelectionSummaries_824);
s.Functions[@"Test-UiaElementMatchesRow"]=new Fn(s,F_Test_UiaElementMatchesRow_831);
s.Functions[@"Find-TreeRowForElement"]=new Fn(s,F_Find_TreeRowForElement_839);
s.Functions[@"Resolve-TextTarget"]=new Fn(s,F_Resolve_TextTarget_852);
s.Functions[@"Get-UiaTextObservationManaged"]=new Fn(s,F_Get_UiaTextObservationManaged_892);
s.Functions[@"Find-RowForIdentity"]=new Fn(s,F_Find_RowForIdentity_923);
s.Functions[@"Resolve-TextTargetCom"]=new Fn(s,F_Resolve_TextTargetCom_932);
s.Functions[@"New-TextFieldEntry"]=new Fn(s,F_New_TextFieldEntry_967);
s.Functions[@"Get-UiaTextObservationCom"]=new Fn(s,F_Get_UiaTextObservationCom_979);
s.Functions[@"Get-UiaTextObservation"]=new Fn(s,F_Get_UiaTextObservation_1004);
s.Functions[@"Add-TextObservation"]=new Fn(s,F_Add_TextObservation_1005);
s.Functions[@"Get-UiTreeSpec"]=new Fn(s,F_Get_UiTreeSpec_1007);
s.Functions[@"Do-UiTree"]=new Fn(s,F_Do_UiTree_1009);
s.Functions[@"Do-Health"]=new Fn(s,F_Do_Health_1036);
s.Functions[@"Do-Pacing"]=new Fn(s,F_Do_Pacing_1039);
s.Functions[@"Get-UiaRootForHwnd"]=new Fn(s,F_Get_UiaRootForHwnd_1040);
s.Functions[@"Get-UiaRoot"]=new Fn(s,F_Get_UiaRoot_1045);
s.Set(@"script:UiaPatternSpecs",s.Get(@"null"));
s.Functions[@"Get-UiaPatternSpecs"]=new Fn(s,F_Get_UiaPatternSpecs_1046);
s.Functions[@"New-UiaCacheRequest"]=new Fn(s,F_New_UiaCacheRequest_1055);
s.Functions[@"Get-UiaPatterns"]=new Fn(s,F_Get_UiaPatterns_1062);
s.Functions[@"Read-UiaNode"]=new Fn(s,F_Read_UiaNode_1066);
s.Functions[@"ConvertTo-Node"]=new Fn(s,F_ConvertTo_Node_1067);
s.Functions[@"Find-UiaMatch"]=new Fn(s,F_Find_UiaMatch_1068);
s.Functions[@"Get-UiaTextPattern"]=new Fn(s,F_Get_UiaTextPattern_1072);
s.Set(@"script:UiaRangeStart",s.Get(@"null"));
s.Set(@"script:UiaRangeEnd",s.Get(@"null"));
s.Set(@"script:UiaTextUnit",s.Get(@"null"));
s.Functions[@"Initialize-UiaTextRangeTypes"]=new Fn(s,F_Initialize_UiaTextRangeTypes_1073);
s.Functions[@"Find-UiaTextRange"]=new Fn(s,F_Find_UiaTextRange_1074);
s.Functions[@"Test-HasSurrogate"]=new Fn(s,F_Test_HasSurrogate_1080);
s.Functions[@"Select-UiaText"]=new Fn(s,F_Select_UiaText_1082);
s.Functions[@"Get-UiaTextRect"]=new Fn(s,F_Get_UiaTextRect_1085);
s.Functions[@"Get-UiaCaret"]=new Fn(s,F_Get_UiaCaret_1095);
s.Functions[@"Read-UiaText"]=new Fn(s,F_Read_UiaText_1096);
s.Functions[@"Get-ComUiTextAction"]=new Fn(s,F_Get_ComUiTextAction_1097);
s.Functions[@"Get-ComUiAct"]=new Fn(s,F_Get_ComUiAct_1101);
s.Functions[@"Do-UiAct"]=new Fn(s,F_Do_UiAct_1104);
s.Functions[@"Do-Wait"]=new Fn(s,F_Do_Wait_1124);
s.Functions[@"Get-ConditionField"]=new Fn(s,F_Get_ConditionField_1125);
s.Functions[@"Get-WaitConditionSpec"]=new Fn(s,F_Get_WaitConditionSpec_1126);
s.Functions[@"Get-WaitConditionWeight"]=new Fn(s,F_Get_WaitConditionWeight_1127);
s.Functions[@"New-PredicateResult"]=new Fn(s,F_New_PredicateResult_1144);
s.Functions[@"Set-PredicateStatus"]=new Fn(s,F_Set_PredicateStatus_1145);
s.Functions[@"Get-CompositeStatus"]=new Fn(s,F_Get_CompositeStatus_1146);
s.Functions[@"Get-EnabledWindowInfo"]=new Fn(s,F_Get_EnabledWindowInfo_1149);
s.Functions[@"Test-ConditionValue"]=new Fn(s,F_Test_ConditionValue_1150);
s.Functions[@"Test-ConditionControl"]=new Fn(s,F_Test_ConditionControl_1165);
s.Functions[@"Test-ConditionText"]=new Fn(s,F_Test_ConditionText_1187);
s.Functions[@"Test-FileParseable"]=new Fn(s,F_Test_FileParseable_1200);
s.Functions[@"Test-ConditionFile"]=new Fn(s,F_Test_ConditionFile_1209);
s.Functions[@"Test-ConditionWindow"]=new Fn(s,F_Test_ConditionWindow_1218);
s.Functions[@"Test-ConditionGroup"]=new Fn(s,F_Test_ConditionGroup_1240);
s.Functions[@"Test-ConditionRegion"]=new Fn(s,F_Test_ConditionRegion_1254);
s.Functions[@"Test-ConditionPredicate"]=new Fn(s,F_Test_ConditionPredicate_1263);
s.Functions[@"Get-WaitDeadlineMs"]=new Fn(s,F_Get_WaitDeadlineMs_1281);
s.Functions[@"Wait-ForCondition"]=new Fn(s,F_Wait_ForCondition_1282);
s.Functions[@"Get-NodeLabel"]=new Fn(s,F_Get_NodeLabel_1304);
s.Functions[@"Invoke-UiaStep"]=new Fn(s,F_Invoke_UiaStep_1305);
s.Set(@"UIA_STEP_ACTIONS",R.Array(R.Capture((o1310) => {R.Emit(o1310,new object[]{@"invoke",@"set_value",@"get_value",@"get_text",@"select_text",@"scroll_into_view",@"toggle",@"select",@"expand",@"collapse",@"close",@"minimize",@"maximize",@"restore",@"legacy_action",@"click_text",@"locate_text",@"get_caret"});})));
s.Set(@"STEP_ACTIONS",R.Binary(s,@"Plus",R.Array(R.Capture((o1311) => {R.Emit(o1311,new object[]{@"click",@"move",@"drag",@"scroll",@"type",@"key",@"wait",@"wait_for",@"screenshot",@"paste",@"focus",@"clipboard"});})),s.Get(@"UIA_STEP_ACTIONS")));
s.Functions[@"Get-UiaStepLine"]=new Fn(s,F_Get_UiaStepLine_1312);
s.Set(@"WRITE_STEP_ACTIONS",R.Array(R.Capture((o1322) => {R.Emit(o1322,new object[]{@"move",@"click",@"drag",@"scroll",@"type",@"key",@"paste",@"focus",@"invoke",@"set_value",@"select_text",@"toggle",@"select",@"expand",@"collapse",@"scroll_into_view",@"close",@"minimize",@"maximize",@"restore",@"legacy_action",@"click_text"});})));
s.Set(@"FOREGROUND_STEP_ACTIONS",R.Array(R.Capture((o1323) => {R.Emit(o1323,new object[]{@"click",@"move",@"drag",@"scroll",@"type",@"key",@"paste",@"click_text"});})));
s.Functions[@"Test-ExpectedTransition"]=new Fn(s,F_Test_ExpectedTransition_1324);
s.Functions[@"New-CaptureArgs"]=new Fn(s,F_New_CaptureArgs_1332);
s.Functions[@"Test-SameCaptureSpec"]=new Fn(s,F_Test_SameCaptureSpec_1347);
s.Functions[@"New-BatchProgress"]=new Fn(s,F_New_BatchProgress_1360);
s.Functions[@"Do-Batch"]=new Fn(s,F_Do_Batch_1363);
s.Functions[@"Resolve-ElementRef"]=new Fn(s,F_Resolve_ElementRef_1527);
s.Functions[@"Do-UiActByRef"]=new Fn(s,F_Do_UiActByRef_1575);
s.Functions[@"Do-Prune"]=new Fn(s,F_Do_Prune_1582);
s.Functions[@"Do-Delta"]=new Fn(s,F_Do_Delta_1587);
s.Functions[@"ConvertTo-FrameRecord"]=new Fn(s,F_ConvertTo_FrameRecord_1600);
s.Functions[@"Do-FrameAttach"]=new Fn(s,F_Do_FrameAttach_1604);
s.Functions[@"Do-FrameProject"]=new Fn(s,F_Do_FrameProject_1608);
s.Set(@"handler",R.Map(new object[]{@"ping",new Fn(s,Block_1613),@"screenshot",new Fn(s,Block_1615),@"batch",new Fn(s,Block_1617),@"cursor",new Fn(s,Block_1618),@"click",new Fn(s,Block_1619),@"wait",new Fn(s,Block_1620),@"wait_for",new Fn(s,Block_1621),@"drag",new Fn(s,Block_1622),@"scroll",new Fn(s,Block_1623),@"type",new Fn(s,Block_1624),@"key",new Fn(s,Block_1625),@"clipboard",new Fn(s,Block_1626),@"paste",new Fn(s,Block_1627),@"launch",new Fn(s,Block_1628),@"release",new Fn(s,Block_1629),@"digest",new Fn(s,Block_1630),@"windows",new Fn(s,Block_1631),@"focus",new Fn(s,Block_1632),@"uireset",new Fn(s,Block_1633),@"uitree",new Fn(s,Block_1634),@"uiact",new Fn(s,Block_1635),@"health",new Fn(s,Block_1636),@"pacing",new Fn(s,Block_1637),@"prune",new Fn(s,Block_1638),@"delta",new Fn(s,Block_1639),@"frameproject",new Fn(s,Block_1640),@"frameattach",new Fn(s,Block_1641),@"shutdown",new Fn(s,Block_1642)}));}
static object F_Test_CancelRequested_3(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"script:CancelFile"),@""))){throw new ReturnFlow(s.Get(@"false"));}
try{throw new ReturnFlow(R.Call(s,@"Test-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"script:CancelFile")}),null));}catch(Exception error4) when (!(error4 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error4}));throw new ReturnFlow(s.Get(@"false"));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Clear_CancelRequest_5(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"script:CancelFile"),@""))){throw new ReturnFlow(null);}
try{if(R.Bool(R.Call(s,@"Test-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"script:CancelFile")}),null))){R.Emit(o,R.Call(s,@"Remove-Item",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"script:CancelFile"),new Named(@"Force",R.Switch),new Named(@"ErrorAction",R.Switch),@"SilentlyContinue"}),null));}}catch(Exception error6) when (!(error6 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error6}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_NotCancelled_7(Scope s,Args a){var o=new List<object>();s.Set(@"where",R.Bind(a,0,@"where",()=>null,@"string"));
try{if(R.Bool(R.Call(s,@"Test-CancelRequested",new Args(new object[]{}),null))){throw R.Error((""+@"[CANCELED] the caller cancelled this request ("+R.Str(s.Get(@"where"))+@"). No further input was sent to the desktop; anything this command was holding down is released before this error leaves the worker."));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Set_DeadlineAt_8(Scope s,Args a){var o=new List<object>();s.Set(@"atMs",R.Bind(a,0,@"atMs",()=>null,@"int64"));
try{s.Set(@"script:DeadlineAtMs",s.Get(@"atMs"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Clear_Deadline_9(Scope s,Args a){var o=new List<object>();
try{s.Set(@"script:DeadlineAtMs",R.Cast(@"int64",0));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_DeadlineRemainingMs_10(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ile",s.Get(@"script:DeadlineAtMs"),0))){throw new ReturnFlow(R.Member(R.Type(@"int"),@"MaxValue"));}
s.Set(@"left",R.Binary(s,@"Minus",R.Cast(@"int64",s.Get(@"script:DeadlineAtMs")),R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds"))));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"left"),0))){s.Set(@"left",0);}
throw new ReturnFlow(R.Cast(@"int",s.Get(@"left")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_WithinDeadline_11(Scope s,Args a){var o=new List<object>();s.Set(@"where",R.Bind(a,0,@"where",()=>null,@"string"));
try{if(R.Bool(R.Binary(s,@"Ile",R.Call(s,@"Get-DeadlineRemainingMs",new Args(new object[]{}),null),0))){throw R.Error((""+@"[DEADLINE_EXHAUSTED] this call's budget ran out "+R.Str(s.Get(@"where"))+@"; nothing further was sent to the desktop, and the steps that already ran did happen. Observe the result with computer_screenshot or computer_ui before deciding anything else -- do not repeat this step blindly."));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_CanSend_12(Scope s,Args a){var o=new List<object>();s.Set(@"where",R.Bind(a,0,@"where",()=>null,@"string"));
try{R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{s.Get(@"where")}),null));
R.Emit(o,R.Call(s,@"Assert-WithinDeadline",new Args(new object[]{s.Get(@"where")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_InputDelivery_13(Scope s,Args a){var o=new List<object>();s.Set(@"sent",R.Bind(a,0,@"sent",()=>null,@"int"));
s.Set(@"expected",R.Bind(a,1,@"expected",()=>null,@"int"));
s.Set(@"what",R.Bind(a,2,@"what",()=>null,@"string"));
try{if(R.Bool(R.Binary(s,@"Ile",s.Get(@"expected"),0))){throw new ReturnFlow(R.Map(new object[]{@"state",@"completed",@"complete",s.Get(@"true"),@"sent",R.Cast(@"int",s.Get(@"sent")),@"expected",R.Cast(@"int",s.Get(@"expected")),@"note",@"nothing needed to be sent"}));}
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"sent"),s.Get(@"expected")))){throw new ReturnFlow(R.Map(new object[]{@"state",@"completed",@"complete",s.Get(@"true"),@"sent",R.Cast(@"int",s.Get(@"sent")),@"expected",R.Cast(@"int",s.Get(@"expected")),@"note",@""}));}
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"sent"),0))){throw new ReturnFlow(R.Map(new object[]{@"state",@"none",@"complete",s.Get(@"false"),@"sent",R.Cast(@"int",s.Get(@"sent")),@"expected",R.Cast(@"int",s.Get(@"expected")),@"note",(""+@"SendInput inserted none of the "+R.Str(s.Get(@"expected"))+@" event(s) for "+R.Str(s.Get(@"what"))+@" (the desktop may be locked, or the target is at a higher integrity level)")}));}
throw new ReturnFlow(R.Map(new object[]{@"state",@"partial",@"complete",s.Get(@"false"),@"sent",R.Cast(@"int",s.Get(@"sent")),@"expected",R.Cast(@"int",s.Get(@"expected")),@"note",(""+@"SendInput inserted "+R.Str(s.Get(@"sent"))+@" of the "+R.Str(s.Get(@"expected"))+@" event(s) for "+R.Str(s.Get(@"what"))+@", so part of this action landed and part of it did not")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_InputDelivered_14(Scope s,Args a){var o=new List<object>();s.Set(@"sent",R.Bind(a,0,@"sent",()=>null,@"int"));
s.Set(@"expected",R.Bind(a,1,@"expected",()=>null,@"int"));
s.Set(@"what",R.Bind(a,2,@"what",()=>null,@"string"));
s.Set(@"where",R.Bind(a,3,@"where",()=>null,@"string"));
try{s.Set(@"delivery",R.Call(s,@"Test-InputDelivery",new Args(new object[]{s.Get(@"sent"),s.Get(@"expected"),s.Get(@"what")}),null));
if(R.Bool(R.Member(s.Get(@"delivery"),@"complete"))){throw new ReturnFlow(s.Get(@"delivery"));}
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o15) => {R.Emit(o15,R.Member(s.Get(@"delivery"),@"state"));}))),@"none"))){throw R.Error((""+R.Str(R.Capture((o16) => {R.Emit(o16,R.Member(s.Get(@"delivery"),@"note"));}))));}
throw R.Error((""+@"[PARTIAL_INPUT] "+R.Str(R.Capture((o17) => {R.Emit(o17,R.Member(s.Get(@"delivery"),@"note"));}))+@" ("+R.Str(s.Get(@"where"))+@"; action_sent=true, outcome=unknown). Do not repeat this step as it stands: some of it is already in the application, so observe the desktop (computer_screenshot or computer_ui) and decide from what is actually there."));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Wait_Cancellable_18(Scope s,Args a){var o=new List<object>();s.Set(@"ms",R.Bind(a,0,@"ms",()=>null,@"int"));
s.Set(@"sliceMs",R.Bind(a,1,@"sliceMs",()=>100,@"int"));
try{s.Set(@"remaining",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,s.Get(@"ms")}));
while(R.Bool(R.Binary(s,@"Igt",s.Get(@"remaining"),0))){try{R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{(""+@"during a "+R.Str(R.Capture((o19) => {R.Emit(o19,s.Get(@"ms"));}))+@" ms wait")}),null));
s.Set(@"slice",R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"sliceMs"),s.Get(@"remaining")}));
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),s.Get(@"slice")}),null));
s.Set(@"remaining",R.Binary(s,@"Minus",s.Get(@"remaining"),s.Get(@"slice")));}catch(ContinueFlow){}catch(BreakFlow){break;}}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_PacingEnvInt_26(Scope s,Args a){var o=new List<object>();s.Set(@"name",R.Bind(a,0,@"name",()=>null,@"string"));
s.Set(@"fallback",R.Bind(a,1,@"fallback",()=>null,@"int"));
s.Set(@"minimum",R.Bind(a,2,@"minimum",()=>null,@"int"));
s.Set(@"maximum",R.Bind(a,3,@"maximum",()=>null,@"int"));
try{s.Set(@"raw",R.Invoke(R.Type(@"Environment"),@"GetEnvironmentVariable",new object[]{s.Get(@"name")}));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"raw")}))){throw new ReturnFlow(s.Get(@"fallback"));}
s.Set(@"parsed",0);
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"int"),@"TryParse",new object[]{R.Invoke(s.Get(@"raw"),@"Trim",new object[]{}),new Ref(()=>s.Get(@"parsed"),v=>{s.Set(@"parsed",v);})})))){throw new ReturnFlow(s.Get(@"fallback"));}
throw new ReturnFlow(R.Invoke(R.Type(@"Math"),@"Max",new object[]{s.Get(@"minimum"),R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"maximum"),s.Get(@"parsed")})}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Set_DragHandle_27(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
s.Set(@"Hwnd",R.Bind(a,2,@"Hwnd",()=>s.Get(@"null"),@"object"));
try{s.Set(@"script:DragGeneration",R.Binary(s,@"Plus",s.Get(@"script:DragGeneration"),1));
s.Set(@"hwndValue",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Hwnd")))){s.Set(@"hwndValue",R.Cast(@"int64",s.Get(@"Hwnd")));}
s.Set(@"script:LastDrag",R.Cast(@"ordered",R.Map(new object[]{@"id",(""+@"d"+R.Str(R.Capture((o28) => {R.Emit(o28,s.Get(@"script:BootGen"));}))+@"."+R.Str(R.Capture((o29) => {R.Emit(o29,s.Get(@"script:DragGeneration"));}))),@"x",R.Cast(@"int",s.Get(@"x")),@"y",R.Cast(@"int",s.Get(@"y")),@"hwnd",s.Get(@"hwndValue"),@"generation",s.Get(@"script:DragGeneration"),@"atMs",R.Cast(@"int64",R.Member(R.Binary(s,@"Minus",R.Member(R.Type(@"DateTime"),@"UtcNow"),R.Invoke(R.Call(s,@"Get-Date",new Args(new object[]{@"1970-01-01Z"}),null),@"ToUniversalTime",new object[]{})),@"TotalMilliseconds"))})));
throw new ReturnFlow(s.Get(@"script:LastDrag"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_DragHandle_30(Scope s,Args a){var o=new List<object>();s.Set(@"Id",R.Bind(a,0,@"Id",()=>@"",@"string"));
try{s.Set(@"handle",s.Get(@"script:LastDrag"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"handle")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"code",@"DRAG_HANDLE_MISSING",@"note",@"no drag has been performed in this session yet"}));}
s.Set(@"nowMs",R.Cast(@"int64",R.Member(R.Binary(s,@"Minus",R.Member(R.Type(@"DateTime"),@"UtcNow"),R.Invoke(R.Call(s,@"Get-Date",new Args(new object[]{@"1970-01-01Z"}),null),@"ToUniversalTime",new object[]{})),@"TotalMilliseconds")));
s.Set(@"ageMs",R.Binary(s,@"Minus",s.Get(@"nowMs"),R.Cast(@"int64",R.Member(s.Get(@"handle"),@"atMs"))));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"ageMs"),s.Get(@"script:DragTtlMs")))){s.Set(@"script:LastDrag",s.Get(@"null"));
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"code",@"DRAG_HANDLE_STALE",@"note",(""+@"the last drag ended "+R.Str(R.Capture((o31) => {R.Emit(o31,R.Cast(@"int",R.Binary(s,@"Divide",s.Get(@"ageMs"),1000)));}))+@" s ago, past the "+R.Str(R.Capture((o32) => {R.Emit(o32,R.Cast(@"int",R.Binary(s,@"Divide",s.Get(@"script:DragTtlMs"),1000)));}))+@" s a continuation is allowed to trust (DSH_COMPUTER_USE_DRAG_TTL_MS)")}));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"Id"),@"")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"Id"),(""+R.Str(R.Capture((o33) => {R.Emit(o33,R.Member(s.Get(@"handle"),@"id"));})))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"code",@"DRAG_HANDLE_MISSING",@"note",(""+@"that drag handle ("+R.Str(s.Get(@"Id"))+@") is not the most recent one ("+R.Str(R.Capture((o34) => {R.Emit(o34,R.Member(s.Get(@"handle"),@"id"));}))+@"); the newest one is what a continuation continues from")}));}
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"code",@"",@"note",@"",@"handle",s.Get(@"handle"),@"ageMs",s.Get(@"ageMs")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Clear_DragHandle_35(Scope s,Args a){var o=new List<object>();s.Set(@"why",R.Bind(a,0,@"why",()=>@"",@"string"));
try{s.Set(@"script:LastDrag",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"why"),@""))){throw new ReturnFlow((""+@"drag handle cleared: "+R.Str(s.Get(@"why"))));}
throw new ReturnFlow(@"drag handle cleared");}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Record_Capture_36(Scope s,Args a){var o=new List<object>();s.Set(@"Rect",R.Bind(a,0,@"Rect",()=>null,@"object"));
s.Set(@"Hwnd",R.Bind(a,1,@"Hwnd",()=>null,@"object"));
s.Set(@"Source",R.Bind(a,2,@"Source",()=>null,@"string"));
s.Set(@"SpecKey",R.Bind(a,3,@"SpecKey",()=>@"",@"string"));
try{R.Eval(()=>R.Eval(()=>{var u37=s.Get(@"script:CaptureSeq");s.Set(@"script:CaptureSeq",R.Binary(s,@"Plus",u37,1L));return u37;}));
s.Set(@"script:LastCapture",R.Cast(@"ordered",R.Map(new object[]{@"atMs",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),@"seq",R.Cast(@"int",s.Get(@"script:CaptureSeq")),@"writeSeq",R.Cast(@"int64",s.Get(@"script:WriteSeq")),@"epoch",R.Cast(@"int64",s.Get(@"script:ObservationEpoch")),@"specKey",(""+R.Str(s.Get(@"SpecKey"))),@"x",R.Cast(@"int",R.Member(s.Get(@"Rect"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"Rect"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"Rect"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"Rect"),@"height")),@"window",R.Cast(@"int64",s.Get(@"Hwnd")),@"source",(""+R.Str(s.Get(@"Source")))})));
throw new ReturnFlow(s.Get(@"script:LastCapture"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Advance_ObservationEpoch_38(Scope s,Args a){var o=new List<object>();
try{s.Set(@"script:ObservationEpoch",R.Binary(s,@"Plus",R.Cast(@"int64",s.Get(@"script:ObservationEpoch")),1));
throw new ReturnFlow(s.Get(@"script:ObservationEpoch"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_CaptureStampInfo_39(Scope s,Args a){var o=new List<object>();
try{s.Set(@"stamp",s.Get(@"script:LastCapture"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"stamp")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"age",R.Binary(s,@"Minus",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"atMs"))));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"atMs",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"atMs")),@"ageMs",R.Cast(@"int",s.Get(@"age")),@"seq",R.Cast(@"int",R.Member(s.Get(@"stamp"),@"seq")),@"writeSeq",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"writeSeq")),@"epoch",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"epoch")),@"specKey",(""+R.Str(R.Capture((o40) => {R.Emit(o40,R.Member(s.Get(@"stamp"),@"specKey"));}))),@"x",R.Cast(@"int",R.Member(s.Get(@"stamp"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"stamp"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"stamp"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"stamp"),@"height")),@"window",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"window")),@"source",(""+R.Str(R.Capture((o41) => {R.Emit(o41,R.Member(s.Get(@"stamp"),@"source"));})))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Set_PayloadField_42(Scope s,Args a){var o=new List<object>();s.Set(@"Record",R.Bind(a,0,@"Record",()=>null,@"object"));
s.Set(@"Name",R.Bind(a,1,@"Name",()=>null,@"string"));
s.Set(@"Value",R.Bind(a,2,@"Value",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Record")))){throw new ReturnFlow(null);}
if(R.Bool(R.Binary(s,@"Is",s.Get(@"Record"),R.Type(@"System.Collections.IDictionary")))){R.SetIndex(s.Get(@"Record"),s.Get(@"Name"),s.Get(@"Value"));
throw new ReturnFlow(null);}
R.Emit(o,R.Call(s,@"Add-Member",new Args(new object[]{new Named(@"NotePropertyName",R.Switch),s.Get(@"Name"),new Named(@"NotePropertyValue",R.Switch),s.Get(@"Value"),new Named(@"Force",R.Switch)}),s.Get(@"Record")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Remove_PayloadField_43(Scope s,Args a){var o=new List<object>();s.Set(@"Record",R.Bind(a,0,@"Record",()=>null,@"object"));
s.Set(@"Name",R.Bind(a,1,@"Name",()=>null,@"string"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Record")))){throw new ReturnFlow(null);}
if(R.Bool(R.Binary(s,@"Is",s.Get(@"Record"),R.Type(@"System.Collections.IDictionary")))){if(R.Bool(R.Invoke(s.Get(@"Record"),@"Contains",new object[]{s.Get(@"Name")}))){R.Emit(o,R.Invoke(s.Get(@"Record"),@"Remove",new object[]{s.Get(@"Name")}));}
throw new ReturnFlow(null);}
R.Emit(o,R.Invoke(R.Member(R.Member(s.Get(@"Record"),@"PSObject"),@"Properties"),@"Remove",new object[]{s.Get(@"Name")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_CaptureAfterWrite_44(Scope s,Args a){var o=new List<object>();s.Set(@"Capture",R.Bind(a,0,@"Capture",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Capture")))){throw new ReturnFlow(s.Get(@"false"));}
throw new ReturnFlow(R.Binary(s,@"Ige",R.Cast(@"int64",R.Member(s.Get(@"Capture"),@"writeSeq")),R.Cast(@"int64",s.Get(@"script:WriteSeq"))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_CaptureReusable_45(Scope s,Args a){var o=new List<object>();s.Set(@"Capture",R.Bind(a,0,@"Capture",()=>null,@"object"));
s.Set(@"SpecKey",R.Bind(a,1,@"SpecKey",()=>@"",@"string"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Capture")))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool(R.Unary(@"Not",R.Call(s,@"Test-CaptureAfterWrite",new Args(new object[]{s.Get(@"Capture")}),null)))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"Capture"),@"epoch")),R.Cast(@"int64",s.Get(@"script:ObservationEpoch"))))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"SpecKey"))),@"")) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o46) => {R.Emit(o46,R.Member(s.Get(@"Capture"),@"specKey"));}))),@"")))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o47) => {R.Emit(o47,R.Member(s.Get(@"Capture"),@"specKey"));}))),(""+R.Str(s.Get(@"SpecKey")))))))){throw new ReturnFlow(s.Get(@"false"));}
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Set_WriteStamp_48(Scope s,Args a){var o=new List<object>();s.Set(@"What",R.Bind(a,0,@"What",()=>@"",@"string"));
s.Set(@"Hwnd",R.Bind(a,1,@"Hwnd",()=>s.Get(@"null"),@"object"));
try{s.Set(@"target",R.Cast(@"int64",0));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Hwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",s.Get(@"Hwnd")),0))))){s.Set(@"target",R.Cast(@"int64",s.Get(@"Hwnd")));}else{s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"target",R.Cast(@"int64",s.Get(@"fg")));}}
R.Eval(()=>R.Eval(()=>{var u49=s.Get(@"script:WriteSeq");s.Set(@"script:WriteSeq",R.Binary(s,@"Plus",u49,1L));return u49;}));
s.Set(@"script:LastWrite",R.Cast(@"ordered",R.Map(new object[]{@"atMs",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),@"seq",R.Cast(@"int64",s.Get(@"script:WriteSeq")),@"hwnd",s.Get(@"target"),@"what",s.Get(@"What")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WriteStampInfo_50(Scope s,Args a){var o=new List<object>();
try{s.Set(@"stamp",s.Get(@"script:LastWrite"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"stamp")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"age",R.Binary(s,@"Minus",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"atMs"))));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"age"),s.Get(@"script:WriteStampTtlMs")))){s.Set(@"script:LastWrite",s.Get(@"null"));
throw new ReturnFlow(s.Get(@"null"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"atMs",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"atMs")),@"ageMs",R.Cast(@"int",s.Get(@"age")),@"hwnd",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"hwnd")),@"what",(""+R.Str(R.Capture((o51) => {R.Emit(o51,R.Member(s.Get(@"stamp"),@"what"));})))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Complete_WriteStamp_52(Scope s,Args a){var o=new List<object>();
try{s.Set(@"script:LastWrite",s.Get(@"null"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Wait_ForSettle_53(Scope s,Args a){var o=new List<object>();s.Set(@"override",R.Bind(a,0,@"override",()=>null,@"object"));
try{s.Set(@"ms",s.Get(@"script:PostActionMs"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"override")))){s.Set(@"ms",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{5000,R.Cast(@"int",s.Get(@"override"))})}));}
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"ms"),0))){throw new ReturnFlow(0);}
s.Set(@"stamp",R.Call(s,@"Get-WriteStampInfo",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"stamp")))){throw new ReturnFlow(0);}
if(R.Bool(R.Binary(s,@"Ige",R.Cast(@"int",R.Member(s.Get(@"stamp"),@"ageMs")),s.Get(@"ms")))){throw new ReturnFlow(0);}
s.Set(@"rest",R.Cast(@"int",R.Binary(s,@"Minus",s.Get(@"ms"),R.Cast(@"int",R.Member(s.Get(@"stamp"),@"ageMs")))));
R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{s.Get(@"rest")}),null));
throw new ReturnFlow(s.Get(@"rest"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Resolve_StabilityBudget_54(Scope s,Args a){var o=new List<object>();s.Set(@"budget",R.Bind(a,0,@"budget",()=>null,@"object"));
s.Set(@"flag",R.Bind(a,1,@"flag",()=>null,@"object"));
try{s.Set(@"hasBudget",(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"budget"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"budget"))),@""))));
s.Set(@"hasFlag",(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"flag"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"flag"))),@""))));
s.Set(@"ceiling",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:StabilityMaxMs"),R.Cast(@"int",s.Get(@"script:StabilityCeilingMs"))})}));
s.Set(@"resolvedBy",@"default");
s.Set(@"conflict",@"");
if(R.Bool(s.Get(@"hasBudget"))){s.Set(@"ceiling",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:StabilityMaxMs"),R.Cast(@"int",s.Get(@"budget"))})}));
s.Set(@"resolvedBy",@"stability_ms");}
if(R.Bool((R.Bool(s.Get(@"hasFlag")) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"flag"))),@"False"))))){s.Set(@"ceiling",0);
s.Set(@"resolvedBy",@"stable=false");
if(R.Bool((R.Bool(s.Get(@"hasBudget")) && R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",s.Get(@"budget")),0))))){s.Set(@"conflict",(""+@"stable: false overrides stability_ms="+R.Str(R.Capture((o55) => {R.Emit(o55,R.Cast(@"int",s.Get(@"budget")));}))));}}else if(R.Bool((R.Bool(s.Get(@"hasFlag")) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"flag"))),@"True"))))){if(R.Bool((R.Bool(s.Get(@"hasBudget")) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",s.Get(@"budget")),0))))){s.Set(@"conflict",@"stable: true with stability_ms: 0: the explicit budget wins, so nothing was polled");}else if(R.Bool(R.Unary(@"Not",s.Get(@"hasBudget")))){s.Set(@"ceiling",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",s.Get(@"script:StabilityStableMs"))}));
s.Set(@"resolvedBy",@"stable=true");}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ceilingMs",s.Get(@"ceiling"),@"resolvedBy",s.Get(@"resolvedBy"),@"conflict",s.Get(@"conflict")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_StabilityResult_56(Scope s,Args a){var o=new List<object>();s.Set(@"state",R.Bind(a,0,@"state",()=>null,@"string"));
s.Set(@"target",R.Bind(a,1,@"target",()=>null,@"object"));
s.Set(@"budget",R.Bind(a,2,@"budget",()=>null,@"int"));
s.Set(@"resolvedBy",R.Bind(a,3,@"resolvedBy",()=>null,@"string"));
s.Set(@"note",R.Bind(a,4,@"note",()=>null,@"string"));
s.Set(@"conflict",R.Bind(a,5,@"conflict",()=>@"",@"string"));
try{throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"state",s.Get(@"state"),@"stable",s.Get(@"null"),@"polls",0,@"waitedMs",0,@"budgetMs",s.Get(@"budget"),@"pollMs",s.Get(@"script:StabilityPollMs"),@"sampled",@"",@"target",s.Get(@"target"),@"resolvedBy",s.Get(@"resolvedBy"),@"width",0,@"height",0,@"note",s.Get(@"note"),@"conflict",s.Get(@"conflict")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_StabilityTarget_57(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"windowHwnd",R.Bind(a,1,@"windowHwnd",()=>null,@"IntPtr"));
s.Set(@"captureRect",R.Bind(a,2,@"captureRect",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"windowHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"kind",@"window",@"hwnd",R.Cast(@"int64",s.Get(@"windowHwnd")),@"x",0,@"y",0,@"width",0,@"height",0})));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"captureRect")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"kind",@"region",@"hwnd",0,@"x",R.Cast(@"int",R.Member(s.Get(@"captureRect"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"captureRect"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"captureRect"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"captureRect"),@"height"))})));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"kind",@"foreground",@"hwnd",0,@"x",0,@"y",0,@"width",0,@"height",0})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Wait_ForStable_58(Scope s,Args a){var o=new List<object>();s.Set(@"ceiling",R.Bind(a,0,@"ceiling",()=>null,@"object"));
s.Set(@"target",R.Bind(a,1,@"target",()=>null,@"object"));
s.Set(@"resolvedBy",R.Bind(a,2,@"resolvedBy",()=>@"default",@"string"));
s.Set(@"conflict",R.Bind(a,3,@"conflict",()=>@"",@"string"));
try{s.Set(@"budget",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:StabilityMaxMs"),R.Cast(@"int",s.Get(@"ceiling"))})}));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"budget"),0))){throw new ReturnFlow(R.Call(s,@"New-StabilityResult",new Args(new object[]{@"disabled",s.Get(@"target"),0,s.Get(@"resolvedBy"),@"",s.Get(@"conflict")}),null));}
s.Set(@"kind",@"screen");
s.Set(@"hwnd",R.Member(R.Type(@"IntPtr"),@"Zero"));
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target"))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o59) => {R.Emit(o59,R.Member(s.Get(@"target"),@"kind"));}))),@"window")))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"target"),@"hwnd")),0))))){s.Set(@"kind",@"window");
s.Set(@"hwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"target"),@"hwnd"))));}
s.Set(@"sampled",@"screen");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@"window"))){s.Set(@"sampled",@"window");}
s.Set(@"sw",R.Invoke(R.Type(@"System.Diagnostics.Stopwatch"),@"StartNew",new object[]{}));
s.Set(@"state",@"timeout");
s.Set(@"stable",s.Get(@"false"));
s.Set(@"polls",0);
s.Set(@"note",@"");
s.Set(@"prev",@"");
s.Set(@"width",0);
s.Set(@"height",0);
s.Set(@"firstHwnd",R.Cast(@"int64",0));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target")))){s.Set(@"firstHwnd",R.Cast(@"int64",R.Member(s.Get(@"target"),@"hwnd")));}
while(R.Bool(s.Get(@"true"))){try{R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{@"while waiting for the picture to stop changing"}),null));
if(R.Bool(R.Binary(s,@"Ige",R.Cast(@"int",R.Member(s.Get(@"sw"),@"ElapsedMilliseconds")),s.Get(@"budget")))){s.Set(@"state",@"timeout");
throw new BreakFlow();}
s.Set(@"rect",s.Get(@"null"));
s.Set(@"digest",@"");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@"window"))){if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindow",new object[]{s.Get(@"hwnd")})))){s.Set(@"state",@"target-lost");
s.Set(@"note",(""+@"hwnd "+R.Str(R.Capture((o60) => {R.Emit(o60,R.Cast(@"int64",s.Get(@"hwnd")));}))+@" is not a window any more"));
throw new BreakFlow();}
s.Set(@"rect",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"hwnd")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"rect")))){s.Set(@"state",@"target-lost");
s.Set(@"note",(""+@"hwnd "+R.Str(R.Capture((o61) => {R.Emit(o61,R.Cast(@"int64",s.Get(@"hwnd")));}))+@" has no usable rectangle"));
throw new BreakFlow();}
try{s.Set(@"digest",R.Call(s,@"Get-WindowDigest",new Args(new object[]{s.Get(@"hwnd"),320}),null));}catch(Exception error62) when (!(error62 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error62}));s.Set(@"digest",@"");}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"digest"),@""))){s.Set(@"sampled",@"screen-fallback");
try{s.Set(@"digest",R.Call(s,@"Get-RegionDigest",new Args(new object[]{R.Member(s.Get(@"rect"),@"x"),R.Member(s.Get(@"rect"),@"y"),R.Member(s.Get(@"rect"),@"width"),R.Member(s.Get(@"rect"),@"height"),320}),null));}catch(Exception error63) when (!(error63 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error63}));s.Set(@"digest",@"");}}}else{if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target"))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o64) => {R.Emit(o64,R.Member(s.Get(@"target"),@"kind"));}))),@"region"))))){s.Set(@"rect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"target"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"target"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"target"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"target"),@"height"))})));}else{s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"state",@"target-lost");
s.Set(@"note",@"no window holds the foreground any more");
throw new BreakFlow();}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"firstHwnd"),0))){s.Set(@"firstHwnd",R.Cast(@"int64",s.Get(@"fg")));}else if(R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",s.Get(@"fg")),s.Get(@"firstHwnd")))){s.Set(@"state",@"target-changed");
s.Set(@"note",(""+@"the foreground moved from hwnd "+R.Str(s.Get(@"firstHwnd"))+@" to hwnd "+R.Str(R.Capture((o65) => {R.Emit(o65,R.Cast(@"int64",s.Get(@"fg")));}))+@" ("""+R.Str(R.Capture((o66) => {R.Emit(o66,R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"fg")}));}))+@""") while this observation was waiting"));
throw new BreakFlow();}
s.Set(@"rect",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"fg")}),null));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"rect")))){s.Set(@"state",@"target-lost");
s.Set(@"note",@"the region to watch has no usable rectangle");
throw new BreakFlow();}
try{s.Set(@"digest",R.Call(s,@"Get-RegionDigest",new Args(new object[]{R.Member(s.Get(@"rect"),@"x"),R.Member(s.Get(@"rect"),@"y"),R.Member(s.Get(@"rect"),@"width"),R.Member(s.Get(@"rect"),@"height"),320}),null));}catch(Exception error67) when (!(error67 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error67}));s.Set(@"digest",@"");}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"digest"),@""))){s.Set(@"state",@"capture-failed");
s.Set(@"note",@"the region could not be read while waiting");
throw new BreakFlow();}
s.Set(@"width",R.Cast(@"int",R.Member(s.Get(@"rect"),@"width")));
s.Set(@"height",R.Cast(@"int",R.Member(s.Get(@"rect"),@"height")));
s.Set(@"polls",R.Binary(s,@"Plus",s.Get(@"polls"),1));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"prev"),@"")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"digest"),s.Get(@"prev")))))){s.Set(@"stable",s.Get(@"true"));
s.Set(@"state",@"stable");
throw new BreakFlow();}
s.Set(@"prev",s.Get(@"digest"));
s.Set(@"left",R.Binary(s,@"Minus",s.Get(@"budget"),R.Cast(@"int",R.Member(s.Get(@"sw"),@"ElapsedMilliseconds"))));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"left"),0))){s.Set(@"state",@"timeout");
throw new BreakFlow();}
R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{R.Invoke(R.Type(@"Math"),@"Min",new object[]{R.Cast(@"int",s.Get(@"script:StabilityPollMs")),R.Cast(@"int",s.Get(@"left"))})}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"state",s.Get(@"state"),@"stable",s.Get(@"stable"),@"polls",s.Get(@"polls"),@"waitedMs",R.Cast(@"int",R.Member(s.Get(@"sw"),@"ElapsedMilliseconds")),@"budgetMs",s.Get(@"budget"),@"pollMs",s.Get(@"script:StabilityPollMs"),@"sampled",s.Get(@"sampled"),@"target",s.Get(@"target"),@"resolvedBy",s.Get(@"resolvedBy"),@"width",s.Get(@"width"),@"height",s.Get(@"height"),@"note",s.Get(@"note"),@"conflict",s.Get(@"conflict")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_PacingConfig_68(Scope s,Args a){var o=new List<object>();
try{throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"settleMs",R.Cast(@"int",s.Get(@"script:PostActionMs")),@"stabilityMs",R.Cast(@"int",s.Get(@"script:StabilityCeilingMs")),@"stableMs",R.Cast(@"int",s.Get(@"script:StabilityStableMs")),@"stabilityPollMs",R.Cast(@"int",s.Get(@"script:StabilityPollMs")),@"stabilityMaxMs",R.Cast(@"int",s.Get(@"script:StabilityMaxMs")),@"writeTtlMs",R.Cast(@"int",s.Get(@"script:WriteStampTtlMs")),@"waitPollMs",R.Cast(@"int",s.Get(@"script:WaitPollMs")),@"waitMaxMs",R.Cast(@"int",s.Get(@"script:WaitMaxMs")),@"clockMs",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds"))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_HeldKey_69(Scope s,Args a){var o=new List<object>();s.Set(@"vk",R.Bind(a,0,@"vk",()=>null,@"int"));
try{if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"script:HeldKeys"),@"Contains",new object[]{s.Get(@"vk")})))){R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"script:HeldKeys"),@"Add",new object[]{s.Get(@"vk")})));}
R.Emit(o,R.Call(s,@"Save-HeldState",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Remove_HeldKey_70(Scope s,Args a){var o=new List<object>();s.Set(@"vk",R.Bind(a,0,@"vk",()=>null,@"int"));
try{R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"script:HeldKeys"),@"Remove",new object[]{s.Get(@"vk")})));
R.Emit(o,R.Call(s,@"Save-HeldState",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_HeldButton_71(Scope s,Args a){var o=new List<object>();s.Set(@"downFlag",R.Bind(a,0,@"downFlag",()=>null,@"uint32"));
try{if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"script:HeldButtons"),@"Contains",new object[]{R.Cast(@"int",s.Get(@"downFlag"))})))){R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"script:HeldButtons"),@"Add",new object[]{R.Cast(@"int",s.Get(@"downFlag"))})));}
R.Emit(o,R.Call(s,@"Save-HeldState",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Remove_HeldButton_72(Scope s,Args a){var o=new List<object>();s.Set(@"downFlag",R.Bind(a,0,@"downFlag",()=>null,@"uint32"));
try{R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"script:HeldButtons"),@"Remove",new object[]{R.Cast(@"int",s.Get(@"downFlag"))})));
R.Emit(o,R.Call(s,@"Save-HeldState",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_75(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"int",s.Get(@"_")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_77(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"int",s.Get(@"_")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Save_HeldState_73(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"script:HeldStateFile"),@""))){throw new ReturnFlow(null);}
try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"script:HeldKeys"),@"Count"),0)) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"script:HeldButtons"),@"Count"),0))))){R.Emit(o,R.Call(s,@"Remove-Item",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"script:HeldStateFile"),new Named(@"Force",R.Switch),new Named(@"ErrorAction",R.Switch),@"SilentlyContinue"}),null));
throw new ReturnFlow(null);}
s.Set(@"state",R.Cast(@"ordered",R.Map(new object[]{@"pid",s.Get(@"PID"),@"bootGen",s.Get(@"script:BootGen"),@"at",R.Cast(@"int64",R.Invoke(R.Member(R.Type(@"DateTimeOffset"),@"UtcNow"),@"ToUnixTimeMilliseconds",new object[]{})),@"keys",R.Array(R.Capture((o74) => {R.Emit(o74,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_75)}),R.Invoke(s.Get(@"script:HeldKeys"),@"ToArray",new object[]{})));})),@"buttons",R.Array(R.Capture((o76) => {R.Emit(o76,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_77)}),R.Invoke(s.Get(@"script:HeldButtons"),@"ToArray",new object[]{})));}))})));
R.Emit(o,R.Invoke(R.Type(@"System.IO.File"),@"WriteAllText",new object[]{s.Get(@"script:HeldStateFile"),R.Call(s,@"ConvertTo-Json",new Args(new object[]{new Named(@"Compress",R.Switch)}),s.Get(@"state")),R.Call(s,@"New-Object",new Args(new object[]{@"System.Text.UTF8Encoding",s.Get(@"false")}),null)}));}catch(Exception error78) when (!(error78 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error78}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UpFlag_79(Scope s,Args a){var o=new List<object>();s.Set(@"downFlag",R.Bind(a,0,@"downFlag",()=>null,@"uint32"));
try{throw new ReturnFlow(R.Cast(@"uint32",R.Binary(s,@"Multiply",s.Get(@"downFlag"),2)));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Release_HeldInput_80(Scope s,Args a){var o=new List<object>();
try{s.Set(@"released",R.Array(R.Capture((o81) => {})));
s.Set(@"events",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[DshNative+INPUT]"}),null));
s.Set(@"records",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item82 in R.Array(R.Array(R.Capture((o83) => {R.Emit(o83,R.Invoke(s.Get(@"script:HeldKeys"),@"ToArray",new object[]{}));})))){s.Set(@"vk",item82);try{s.Set(@"f",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP"));
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"EXTENDED"),s.Get(@"vk")))){s.Set(@"f",R.Binary(s,@"Bor",s.Get(@"f"),R.Member(R.Type(@"DshNative"),@"KEYEVENTF_EXTENDEDKEY")));}
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",s.Get(@"vk")),0,R.Cast(@"uint32",s.Get(@"f"))})}));
R.Emit(o,R.Invoke(s.Get(@"records"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"kind",@"key",@"value",s.Get(@"vk"),@"label",(""+@"key:"+R.Str(s.Get(@"vk")))}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
foreach(var item84 in R.Array(R.Array(R.Capture((o85) => {R.Emit(o85,R.Invoke(s.Get(@"script:HeldButtons"),@"ToArray",new object[]{}));})))){s.Set(@"down",item84);try{R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{0,0,0,R.Call(s,@"Get-UpFlag",new Args(new object[]{R.Cast(@"uint32",s.Get(@"down"))}),null)})}));
s.Set(@"label",(""+@"mouse:"+R.Str(s.Get(@"down"))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"down"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_LEFTDOWN")))){s.Set(@"label",@"mouse:left");}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"down"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_RIGHTDOWN")))){s.Set(@"label",@"mouse:right");}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"down"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_MIDDLEDOWN")))){s.Set(@"label",@"mouse:middle");}
R.Emit(o,R.Invoke(s.Get(@"records"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"kind",@"button",@"value",s.Get(@"down"),@"label",s.Get(@"label")}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"events"),@"Count"),0))){throw new ReturnFlow(s.Get(@"released"));}
s.Set(@"sent",0);
try{s.Set(@"sent",R.Cast(@"int",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Invoke(s.Get(@"events"),@"ToArray",new object[]{})})));}catch(Exception error86) when (!(error86 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error86}));s.Set(@"sent",0);}
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Member(s.Get(@"records"),@"Count")))){try{if(R.Bool(R.Binary(s,@"Ige",s.Get(@"i"),s.Get(@"sent")))){throw new BreakFlow();}
s.Set(@"record",R.Index(s.Get(@"records"),s.Get(@"i")));
s.Set(@"released",R.Binary(s,@"Plus",s.Get(@"released"),R.Member(s.Get(@"record"),@"label")));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"record"),@"kind"),@"key"))){R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"script:HeldKeys"),@"Remove",new object[]{R.Cast(@"int",R.Member(s.Get(@"record"),@"value"))})));}else{R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"script:HeldButtons"),@"Remove",new object[]{R.Cast(@"uint32",R.Member(s.Get(@"record"),@"value"))})));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u87=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u87,1L));return u87;}));}}
throw new ReturnFlow(s.Get(@"released"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WindowInfoForHwnd_88(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"IntPtr"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"hwnd",0,@"title",@"",@"process",@"",@"pid",0})));}
s.Set(@"procId",0);
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetWindowThreadProcessId",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"procId"),v=>{s.Set(@"procId",v);})})));
s.Set(@"procName",@"");
try{s.Set(@"procName",R.Member(R.Call(s,@"Get-Process",new Args(new object[]{new Named(@"Id",R.Switch),s.Get(@"procId"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null),@"ProcessName"));}catch(Exception error89) when (!(error89 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error89}));s.Set(@"procName",@"");}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"hwnd")),@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"hwnd")}),@"process",s.Get(@"procName"),@"pid",s.Get(@"procId")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WindowRectInfo_90(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"IntPtr"));
try{s.Set(@"rect",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+RECT"}),null));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"WindowBounds",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"rect"),v=>{s.Set(@"rect",v);})})))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"w",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Right"),R.Member(s.Get(@"rect"),@"Left")));
s.Set(@"h",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Bottom"),R.Member(s.Get(@"rect"),@"Top")));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"w"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"h"),0))))){throw new ReturnFlow(s.Get(@"null"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"x",R.Member(s.Get(@"rect"),@"Left"),@"y",R.Member(s.Get(@"rect"),@"Top"),@"width",s.Get(@"w"),@"height",s.Get(@"h")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_BitmapDigest_91(Scope s,Args a){var o=new List<object>();s.Set(@"bmp",R.Bind(a,0,@"bmp",()=>null,@"object"));
try{s.Set(@"rect",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Rectangle",new object[]{0,0,R.Member(s.Get(@"bmp"),@"Width"),R.Member(s.Get(@"bmp"),@"Height")}}),null));
s.Set(@"data",R.Invoke(s.Get(@"bmp"),@"LockBits",new object[]{s.Get(@"rect"),R.Member(R.Type(@"System.Drawing.Imaging.ImageLockMode"),@"ReadOnly"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}));
try{s.Set(@"len",R.Binary(s,@"Multiply",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Member(s.Get(@"data"),@"Stride")}),R.Member(s.Get(@"bmp"),@"Height")));
s.Set(@"buf",R.Call(s,@"New-Object",new Args(new object[]{@"byte[]",s.Get(@"len")}),null));
R.Emit(o,R.Invoke(R.Type(@"System.Runtime.InteropServices.Marshal"),@"Copy",new object[]{R.Member(s.Get(@"data"),@"Scan0"),s.Get(@"buf"),0,s.Get(@"len")}));}finally{R.Emit(o,R.Invoke(s.Get(@"bmp"),@"UnlockBits",new object[]{s.Get(@"data")}));}
s.Set(@"sha",R.Invoke(R.Type(@"System.Security.Cryptography.SHA256"),@"Create",new object[]{}));
try{s.Set(@"hex",R.Invoke(R.Invoke(R.Type(@"BitConverter"),@"ToString",new object[]{R.Invoke(s.Get(@"sha"),@"ComputeHash",new object[]{s.Get(@"buf")})}),@"Replace",new object[]{@"-",@""}));
throw new ReturnFlow(R.Invoke(R.Invoke(s.Get(@"hex"),@"Substring",new object[]{0,16}),@"ToLowerInvariant",new object[]{}));}finally{R.Emit(o,R.Invoke(s.Get(@"sha"),@"Dispose",new object[]{}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_BitmapDigestScaled_92(Scope s,Args a){var o=new List<object>();s.Set(@"bmp",R.Bind(a,0,@"bmp",()=>null,@"object"));
s.Set(@"maxSide",R.Bind(a,1,@"maxSide",()=>null,@"int"));
try{s.Set(@"w",R.Member(s.Get(@"bmp"),@"Width"));
s.Set(@"h",R.Member(s.Get(@"bmp"),@"Height"));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"w"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"h"),0))))){throw new ReturnFlow(@"");}
s.Set(@"scale",1d);
s.Set(@"long",R.Invoke(R.Type(@"Math"),@"Max",new object[]{s.Get(@"w"),s.Get(@"h")}));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"maxSide"),0)) && R.Bool(R.Binary(s,@"Igt",s.Get(@"long"),s.Get(@"maxSide")))))){s.Set(@"scale",R.Binary(s,@"Divide",s.Get(@"maxSide"),s.Get(@"long")));}
s.Set(@"iw",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",s.Get(@"w"),s.Get(@"scale"))}))}));
s.Set(@"ih",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",s.Get(@"h"),s.Get(@"scale"))}))}));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"iw"),s.Get(@"w"))) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"ih"),s.Get(@"h")))))){throw new ReturnFlow(R.Call(s,@"Get-BitmapDigest",new Args(new object[]{s.Get(@"bmp")}),null));}
s.Set(@"small",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Bitmap",new object[]{s.Get(@"iw"),s.Get(@"ih"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}}),null));
try{s.Set(@"g2",R.Invoke(R.Type(@"System.Drawing.Graphics"),@"FromImage",new object[]{s.Get(@"small")}));
try{R.SetMember(s.Get(@"g2"),@"InterpolationMode",R.Member(R.Type(@"System.Drawing.Drawing2D.InterpolationMode"),@"Low"));
R.Emit(o,R.Invoke(s.Get(@"g2"),@"DrawImage",new object[]{s.Get(@"bmp"),0,0,s.Get(@"iw"),s.Get(@"ih")}));}finally{R.Emit(o,R.Invoke(s.Get(@"g2"),@"Dispose",new object[]{}));}
throw new ReturnFlow(R.Call(s,@"Get-BitmapDigest",new Args(new object[]{s.Get(@"small")}),null));}finally{R.Emit(o,R.Invoke(s.Get(@"small"),@"Dispose",new object[]{}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_RegionDigest_93(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
s.Set(@"w",R.Bind(a,2,@"w",()=>null,@"int"));
s.Set(@"h",R.Bind(a,3,@"h",()=>null,@"int"));
s.Set(@"maxSide",R.Bind(a,4,@"maxSide",()=>null,@"int"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"w"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"h"),0))))){throw new ReturnFlow(@"");}
s.Set(@"full",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Bitmap",new object[]{s.Get(@"w"),s.Get(@"h"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}}),null));
try{s.Set(@"g",R.Invoke(R.Type(@"System.Drawing.Graphics"),@"FromImage",new object[]{s.Get(@"full")}));
try{R.Emit(o,R.Invoke(s.Get(@"g"),@"CopyFromScreen",new object[]{s.Get(@"x"),s.Get(@"y"),0,0,R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Size",new object[]{s.Get(@"w"),s.Get(@"h")}}),null),R.Member(R.Type(@"System.Drawing.CopyPixelOperation"),@"SourceCopy")}));}finally{R.Emit(o,R.Invoke(s.Get(@"g"),@"Dispose",new object[]{}));}
throw new ReturnFlow(R.Call(s,@"Get-BitmapDigestScaled",new Args(new object[]{s.Get(@"full"),s.Get(@"maxSide")}),null));}finally{R.Emit(o,R.Invoke(s.Get(@"full"),@"Dispose",new object[]{}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WindowDigest_94(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"IntPtr"));
s.Set(@"maxSide",R.Bind(a,1,@"maxSide",()=>null,@"int"));
try{s.Set(@"rect",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"hwnd")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"rect")))){throw new ReturnFlow(@"");}
if(R.Bool(R.Binary(s,@"Igt",R.Binary(s,@"Multiply",R.Member(s.Get(@"rect"),@"width"),R.Member(s.Get(@"rect"),@"height")),s.Get(@"MAX_CAPTURE_PIXELS")))){throw new ReturnFlow(@"");}
s.Set(@"bmp",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Bitmap",new object[]{R.Member(s.Get(@"rect"),@"width"),R.Member(s.Get(@"rect"),@"height"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}}),null));
try{s.Set(@"g",R.Invoke(R.Type(@"System.Drawing.Graphics"),@"FromImage",new object[]{s.Get(@"bmp")}));
try{s.Set(@"hdc",R.Invoke(s.Get(@"g"),@"GetHdc",new object[]{}));
s.Set(@"drew",s.Get(@"false"));
try{s.Set(@"drew",R.Invoke(R.Type(@"DshNative"),@"PrintWindow",new object[]{s.Get(@"hwnd"),s.Get(@"hdc"),2}));}finally{R.Emit(o,R.Invoke(s.Get(@"g"),@"ReleaseHdc",new object[]{s.Get(@"hdc")}));}
if(R.Bool(R.Unary(@"Not",s.Get(@"drew")))){throw new ReturnFlow(@"");}}finally{R.Emit(o,R.Invoke(s.Get(@"g"),@"Dispose",new object[]{}));}
throw new ReturnFlow(R.Call(s,@"Get-BitmapDigestScaled",new Args(new object[]{s.Get(@"bmp"),s.Get(@"maxSide")}),null));}finally{R.Emit(o,R.Invoke(s.Get(@"bmp"),@"Dispose",new object[]{}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ForegroundRect_95(Scope s,Args a){var o=new List<object>();
try{s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
s.Set(@"r",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"r",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"fg")}),null));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"r")))){throw new ReturnFlow(R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null));}
throw new ReturnFlow(s.Get(@"r"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_InjectableForeground_96(Scope s,Args a){var o=new List<object>();
try{{s.Set(@"attempt",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"attempt"),4))){try{s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero"))) && R.Bool(R.Invoke(R.Type(@"DshNative"),@"IsWindowVisible",new object[]{s.Get(@"fg")})))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"fg")}),null)))))){throw new ReturnFlow(R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"fg")}),null));}
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),25}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u97=s.Get(@"attempt");s.Set(@"attempt",R.Binary(s,@"Plus",u97,1L));return u97;}));}}
throw new ReturnFlow(s.Get(@"null"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_ExpectedForeground_98(Scope s,Args a){var o=new List<object>();s.Set(@"expected",R.Bind(a,0,@"expected",()=>null,@"object"));
s.Set(@"what",R.Bind(a,1,@"what",()=>null,@"string"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"expected"))) || R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",s.Get(@"expected")),0))))){throw new ReturnFlow(null);}
s.Set(@"want",R.Cast(@"int64",s.Get(@"expected")));
s.Set(@"info",R.Call(s,@"Get-InjectableForeground",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"info")))){throw R.Error((""+R.Str(s.Get(@"what"))+@" would go nowhere: no window holds the foreground. (action_sent=false)"));}
if(R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"info"),@"hwnd")),s.Get(@"want")))){s.Set(@"who",R.Capture((o99) => {if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"info"),@"title"),@""))){R.Emit(o99,(""+@""""+R.Str(R.Capture((o100) => {R.Emit(o100,R.Member(s.Get(@"info"),@"title"));}))+@""" ["+R.Str(R.Capture((o101) => {R.Emit(o101,R.Member(s.Get(@"info"),@"process"));}))+@"]"));}else{R.Emit(o99,(""+@"["+R.Str(R.Capture((o102) => {R.Emit(o102,R.Member(s.Get(@"info"),@"process"));}))+@"]"));}}));
throw R.Error((""+@"[FRONT_NOT_TARGET] "+R.Str(s.Get(@"what"))+@" was aimed at hwnd "+R.Str(s.Get(@"want"))+@" but the foreground is hwnd "+R.Str(R.Capture((o103) => {R.Emit(o103,R.Member(s.Get(@"info"),@"hwnd"));}))+@" "+R.Str(s.Get(@"who"))+@", which is what would receive it. Bring the target forward first (computer_windows with focus_hwnd, or a click inside it) and retry. (action_sent=false, recovery=computer_windows)"));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_InjectableForeground_104(Scope s,Args a){var o=new List<object>();s.Set(@"what",R.Bind(a,0,@"what",()=>null,@"string"));
try{s.Set(@"info",R.Call(s,@"Get-InjectableForeground",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"info")))){throw new ReturnFlow(s.Get(@"info"));}
s.Set(@"raw",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
s.Set(@"detail",@"no window holds the foreground");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"raw"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"detail",(""+@"the foreground is hwnd="+R.Str(R.Capture((o105) => {R.Emit(o105,R.Cast(@"int64",s.Get(@"raw")));}))+@", which is not a visible window"));}
throw R.Error((""+R.Str(s.Get(@"what"))+@" would go nowhere: "+R.Str(s.Get(@"detail"))+@". Bring the target window forward first (computer_windows with focus_hwnd, computer_launch, or a click inside it) and retry."));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ScreenList_106(Scope s,Args a){var o=new List<object>();
try{s.Set(@"list",R.Array(R.Capture((o107) => {})));
s.Set(@"i",0);
foreach(var item108 in R.Array(R.Member(R.Type(@"System.Windows.Forms.Screen"),@"AllScreens"))){s.Set(@"s",item108);try{s.Set(@"list",R.Binary(s,@"Plus",s.Get(@"list"),R.Cast(@"ordered",R.Map(new object[]{@"index",s.Get(@"i"),@"deviceName",R.Member(s.Get(@"s"),@"DeviceName"),@"primary",R.Cast(@"bool",R.Member(s.Get(@"s"),@"Primary")),@"x",R.Member(R.Member(s.Get(@"s"),@"Bounds"),@"X"),@"y",R.Member(R.Member(s.Get(@"s"),@"Bounds"),@"Y"),@"width",R.Member(R.Member(s.Get(@"s"),@"Bounds"),@"Width"),@"height",R.Member(R.Member(s.Get(@"s"),@"Bounds"),@"Height")}))));
R.Eval(()=>R.Eval(()=>{var u109=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u109,1L));return u109;}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"list"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_VirtualBounds_110(Scope s,Args a){var o=new List<object>();
try{s.Set(@"x0",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_XVIRTUALSCREEN")}));
s.Set(@"y0",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_YVIRTUALSCREEN")}));
s.Set(@"w",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_CXVIRTUALSCREEN")}));
s.Set(@"h",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_CYVIRTUALSCREEN")}));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"x0"),@"y",s.Get(@"y0"),@"width",s.Get(@"w"),@"height",s.Get(@"h")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ForegroundInfo_111(Scope s,Args a){var o=new List<object>();
try{s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"hwnd",0,@"title",@"",@"process",@""})));}
s.Set(@"procId",0);
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetWindowThreadProcessId",new object[]{s.Get(@"fg"),new Ref(()=>s.Get(@"procId"),v=>{s.Set(@"procId",v);})})));
s.Set(@"procName",@"");
try{s.Set(@"procName",R.Member(R.Call(s,@"Get-Process",new Args(new object[]{new Named(@"Id",R.Switch),s.Get(@"procId"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null),@"ProcessName"));}catch(Exception error112) when (!(error112 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error112}));s.Set(@"procName",@"");}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"fg")),@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"fg")}),@"process",s.Get(@"procName")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Resolve_Target_113(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"screens",R.Array(R.Capture((o114) => {R.Emit(o114,R.Call(s,@"Get-ScreenList",new Args(new object[]{}),null));})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"region")))){s.Set(@"r",R.Member(s.Get(@"Arg"),@"region"));
s.Set(@"rx",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")));
s.Set(@"ry",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")));
s.Set(@"rw",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")));
s.Set(@"rh",R.Cast(@"int",R.Member(s.Get(@"r"),@"height")));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"rw"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"rh"),0))))){throw R.Error((""+@"a capture region needs a positive width and height; got "+R.Str(s.Get(@"rw"))+@"x"+R.Str(s.Get(@"rh"))));}
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"rw"),s.Get(@"MAX_CAPTURE_EDGE"))) || R.Bool(R.Binary(s,@"Igt",s.Get(@"rh"),s.Get(@"MAX_CAPTURE_EDGE")))))){throw R.Error((""+@"a capture region may be at most "+R.Str(s.Get(@"MAX_CAPTURE_EDGE"))+@"x"+R.Str(s.Get(@"MAX_CAPTURE_EDGE"))+@"; got "+R.Str(s.Get(@"rw"))+@"x"+R.Str(s.Get(@"rh"))));}
s.Set(@"vb",R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null));
s.Set(@"x0",R.Invoke(R.Type(@"Math"),@"Max",new object[]{s.Get(@"rx"),R.Member(s.Get(@"vb"),@"x")}));
s.Set(@"y0",R.Invoke(R.Type(@"Math"),@"Max",new object[]{s.Get(@"ry"),R.Member(s.Get(@"vb"),@"y")}));
s.Set(@"x1",R.Invoke(R.Type(@"Math"),@"Min",new object[]{R.Binary(s,@"Plus",s.Get(@"rx"),s.Get(@"rw")),R.Binary(s,@"Plus",R.Member(s.Get(@"vb"),@"x"),R.Member(s.Get(@"vb"),@"width"))}));
s.Set(@"y1",R.Invoke(R.Type(@"Math"),@"Min",new object[]{R.Binary(s,@"Plus",s.Get(@"ry"),s.Get(@"rh")),R.Binary(s,@"Plus",R.Member(s.Get(@"vb"),@"y"),R.Member(s.Get(@"vb"),@"height"))}));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"x1"),s.Get(@"x0"))) || R.Bool(R.Binary(s,@"Ile",s.Get(@"y1"),s.Get(@"y0")))))){throw R.Error((""+@"the capture region ("+R.Str(s.Get(@"rx"))+@","+R.Str(s.Get(@"ry"))+@") "+R.Str(s.Get(@"rw"))+@"x"+R.Str(s.Get(@"rh"))+@" does not overlap the virtual desktop (x="+R.Str(R.Capture((o115) => {R.Emit(o115,R.Member(s.Get(@"vb"),@"x"));}))+@".."+R.Str(R.Capture((o116) => {R.Emit(o116,R.Binary(s,@"Minus",R.Binary(s,@"Plus",R.Member(s.Get(@"vb"),@"x"),R.Member(s.Get(@"vb"),@"width")),1));}))+@", y="+R.Str(R.Capture((o117) => {R.Emit(o117,R.Member(s.Get(@"vb"),@"y"));}))+@".."+R.Str(R.Capture((o118) => {R.Emit(o118,R.Binary(s,@"Minus",R.Binary(s,@"Plus",R.Member(s.Get(@"vb"),@"y"),R.Member(s.Get(@"vb"),@"height")),1));}))+@")"));}
s.Set(@"cw",R.Binary(s,@"Minus",s.Get(@"x1"),s.Get(@"x0")));
s.Set(@"ch",R.Binary(s,@"Minus",s.Get(@"y1"),s.Get(@"y0")));
if(R.Bool(R.Binary(s,@"Igt",R.Binary(s,@"Multiply",s.Get(@"cw"),s.Get(@"ch")),s.Get(@"MAX_CAPTURE_PIXELS")))){throw R.Error((""+@"the capture region covers "+R.Str(R.Capture((o119) => {R.Emit(o119,R.Binary(s,@"Multiply",s.Get(@"cw"),s.Get(@"ch")));}))+@" pixels, over the "+R.Str(s.Get(@"MAX_CAPTURE_PIXELS"))+@" limit; capture one display, or pass a smaller region or a scale"));}
s.Set(@"clipped",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"x0"),s.Get(@"rx"))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"y0"),s.Get(@"ry"))))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"cw"),s.Get(@"rw"))))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"ch"),s.Get(@"rh")))));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"x0"),@"y",s.Get(@"y0"),@"width",s.Get(@"cw"),@"height",s.Get(@"ch"),@"clipped",s.Get(@"clipped")})));}
s.Set(@"display",R.Member(s.Get(@"Arg"),@"display"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"display")))){s.Set(@"display",0);}
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"display"))),@"all"))){throw new ReturnFlow(R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null));}
s.Set(@"idx",0);
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"int"),@"TryParse",new object[]{(""+R.Str(s.Get(@"display"))),new Ref(()=>s.Get(@"idx"),v=>{s.Set(@"idx",v);})})))){s.Set(@"idx",0);}
if(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"idx"),0)) || R.Bool(R.Binary(s,@"Ige",s.Get(@"idx"),R.Member(s.Get(@"screens"),@"Count")))))){throw R.Error((""+@"display "+R.Str(s.Get(@"idx"))+@" is out of range (0.."+R.Str(R.Capture((o120) => {R.Emit(o120,R.Binary(s,@"Minus",R.Member(s.Get(@"screens"),@"Count"),1));}))+@", or 'all')"));}
s.Set(@"s",R.Index(s.Get(@"screens"),s.Get(@"idx")));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"s"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"s"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"s"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"s"),@"height"))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_BitmapHasContent_121(Scope s,Args a){var o=new List<object>();s.Set(@"bmp",R.Bind(a,0,@"bmp",()=>null,@"object"));
try{s.Set(@"w",R.Member(s.Get(@"bmp"),@"Width"));
s.Set(@"h",R.Member(s.Get(@"bmp"),@"Height"));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"w"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"h"),0))))){throw new ReturnFlow(s.Get(@"false"));}
s.Set(@"cols",24);
s.Set(@"rows",16);
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"w"),s.Get(@"cols")))){s.Set(@"cols",s.Get(@"w"));}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"h"),s.Get(@"rows")))){s.Set(@"rows",s.Get(@"h"));}
s.Set(@"minLum",255);
s.Set(@"maxLum",0);
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"cols")))){try{{s.Set(@"j",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"j"),s.Get(@"rows")))){try{s.Set(@"x",R.Cast(@"int",R.Binary(s,@"Divide",R.Binary(s,@"Multiply",s.Get(@"i"),R.Binary(s,@"Minus",s.Get(@"w"),1)),R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Binary(s,@"Minus",s.Get(@"cols"),1)}))));
s.Set(@"y",R.Cast(@"int",R.Binary(s,@"Divide",R.Binary(s,@"Multiply",s.Get(@"j"),R.Binary(s,@"Minus",s.Get(@"h"),1)),R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Binary(s,@"Minus",s.Get(@"rows"),1)}))));
s.Set(@"c",R.Invoke(s.Get(@"bmp"),@"GetPixel",new object[]{s.Get(@"x"),s.Get(@"y")}));
s.Set(@"lum",R.Cast(@"int",R.Binary(s,@"Divide",R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Binary(s,@"Multiply",R.Member(s.Get(@"c"),@"R"),30),R.Binary(s,@"Multiply",R.Member(s.Get(@"c"),@"G"),59)),R.Binary(s,@"Multiply",R.Member(s.Get(@"c"),@"B"),11)),100)));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"lum"),s.Get(@"minLum")))){s.Set(@"minLum",s.Get(@"lum"));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"lum"),s.Get(@"maxLum")))){s.Set(@"maxLum",s.Get(@"lum"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u122=s.Get(@"j");s.Set(@"j",R.Binary(s,@"Plus",u122,1L));return u122;}));}}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u123=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u123,1L));return u123;}));}}
throw new ReturnFlow(R.Binary(s,@"Igt",R.Binary(s,@"Minus",s.Get(@"maxLum"),s.Get(@"minLum")),8));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_125(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",R.Member(s.Get(@"_"),@"MimeType"),@"image/jpeg"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Save_BitmapToFile_124(Scope s,Args a){var o=new List<object>();s.Set(@"bmp",R.Bind(a,0,@"bmp",()=>null,@"object"));
s.Set(@"path",R.Bind(a,1,@"path",()=>null,@"string"));
s.Set(@"format",R.Bind(a,2,@"format",()=>null,@"string"));
s.Set(@"quality",R.Bind(a,3,@"quality",()=>null,@"int"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"format"),@"jpeg")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"format"),@"jpg"))))){if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"script:JpegCodec")))){s.Set(@"script:JpegCodec",R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"First",R.Switch),1}),R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_125)}),R.Invoke(R.Type(@"System.Drawing.Imaging.ImageCodecInfo"),@"GetImageEncoders",new object[]{}))));}
s.Set(@"q",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Invoke(R.Type(@"Math"),@"Min",new object[]{100,s.Get(@"quality")})}));
s.Set(@"ps",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Imaging.EncoderParameters",1}),null));
R.SetIndex(R.Member(s.Get(@"ps"),@"Param"),0,R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Imaging.EncoderParameter",new object[]{R.Member(R.Type(@"System.Drawing.Imaging.Encoder"),@"Quality"),R.Cast(@"int64",s.Get(@"q"))}}),null));
try{R.Emit(o,R.Invoke(s.Get(@"bmp"),@"Save",new object[]{s.Get(@"path"),s.Get(@"script:JpegCodec"),s.Get(@"ps")}));}finally{R.Emit(o,R.Invoke(s.Get(@"ps"),@"Dispose",new object[]{}));}
throw new ReturnFlow(null);}
R.Emit(o,R.Invoke(s.Get(@"bmp"),@"Save",new object[]{s.Get(@"path"),R.Member(R.Type(@"System.Drawing.Imaging.ImageFormat"),@"Png")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_127(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"object"));
s.Set(@"param",R.Bind(a,1,@"param",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){R.Emit(o,R.Invoke(s.Get(@"list"),@"Add",new object[]{R.Cast(@"int64",s.Get(@"hwnd"))}));}
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_TopLevelZOrder_126(Scope s,Args a){var o=new List<object>();
try{s.Set(@"cached",s.Get(@"script:ZOrderCache"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"cached"))) && R.Bool(R.Binary(s,@"Ilt",R.Member(R.Binary(s,@"Minus",R.Member(R.Type(@"DateTime"),@"UtcNow"),R.Member(s.Get(@"cached"),@"at")),@"TotalMilliseconds"),200))))){throw new ReturnFlow(R.Member(s.Get(@"cached"),@"list"));}
s.Set(@"list",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[int64]"}),null));
s.Set(@"callback",R.Cast(@"DshNative+EnumWindowsProc",new Fn(s,Block_127)));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"EnumWindows",new object[]{s.Get(@"callback"),R.Member(R.Type(@"IntPtr"),@"Zero")})));
s.Set(@"script:ZOrderCache",R.Map(new object[]{@"at",R.Member(R.Type(@"DateTime"),@"UtcNow"),@"list",s.Get(@"list")}));
throw new ReturnFlow(s.Get(@"list"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_136(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ilt",R.Cast(@"int",R.Index(s.Get(@"_"),@"z_rank")),0))){R.Emit(o,1000000);}else{R.Emit(o,R.Cast(@"int",R.Index(s.Get(@"_"),@"z_rank")));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_RelatedWindowList_128(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
try{s.Set(@"observedAt",R.Member(R.Type(@"DateTime"),@"UtcNow"));
s.Set(@"zOrder",R.Call(s,@"Get-TopLevelZOrder",new Args(new object[]{}),null));
s.Set(@"candidates",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[int64]"}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),0))){R.Emit(o,R.Invoke(s.Get(@"candidates"),@"Add",new object[]{s.Get(@"hwnd")}));}
foreach(var item129 in R.Array(s.Get(@"zOrder"))){s.Set(@"candidate",item129);try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"candidate"),s.Get(@"hwnd")))){throw new ContinueFlow();}
s.Set(@"owner",R.Cast(@"int64",R.Invoke(R.Type(@"DshNative"),@"GetWindow",new object[]{R.Cast(@"IntPtr",s.Get(@"candidate")),R.Member(R.Type(@"DshNative"),@"GW_OWNER")})));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"owner"),0))){throw new ContinueFlow();}
s.Set(@"walk",s.Get(@"owner"));
s.Set(@"hops",0);
s.Set(@"related",s.Get(@"false"));
while(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"walk"),0)) && R.Bool(R.Binary(s,@"Ilt",s.Get(@"hops"),16))))){try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"walk"),s.Get(@"hwnd")))){s.Set(@"related",s.Get(@"true"));
throw new BreakFlow();}
s.Set(@"walk",R.Cast(@"int64",R.Invoke(R.Type(@"DshNative"),@"GetWindow",new object[]{R.Cast(@"IntPtr",s.Get(@"walk")),R.Member(R.Type(@"DshNative"),@"GW_OWNER")})));
R.Eval(()=>R.Eval(()=>{var u130=s.Get(@"hops");s.Set(@"hops",R.Binary(s,@"Plus",u130,1L));return u130;}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(s.Get(@"related"))){R.Emit(o,R.Invoke(s.Get(@"candidates"),@"Add",new object[]{s.Get(@"candidate")}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"rows",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item131 in R.Array(s.Get(@"candidates"))){s.Set(@"candidate",item131);try{s.Set(@"handle",R.Cast(@"IntPtr",s.Get(@"candidate")));
s.Set(@"rect",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"handle")}),null));
s.Set(@"owner",R.Cast(@"int64",R.Invoke(R.Type(@"DshNative"),@"GetWindow",new object[]{s.Get(@"handle"),R.Member(R.Type(@"DshNative"),@"GW_OWNER")})));
s.Set(@"rank",-1);
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Member(s.Get(@"zOrder"),@"Count")))){try{if(R.Bool(R.Binary(s,@"Ieq",R.Index(s.Get(@"zOrder"),s.Get(@"i")),s.Get(@"candidate")))){s.Set(@"rank",s.Get(@"i"));
throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u132=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u132,1L));return u132;}));}}
s.Set(@"relation",@"self");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"candidate"),s.Get(@"hwnd")))){s.Set(@"relation",@"owned-popup");}
s.Set(@"info",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"handle")}),null));
R.Emit(o,R.Invoke(s.Get(@"rows"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"candidate")),@"owner_hwnd",s.Get(@"owner"),@"relation",s.Get(@"relation"),@"rect",s.Get(@"rect"),@"visible",R.Cast(@"bool",R.Invoke(R.Type(@"DshNative"),@"IsWindowVisible",new object[]{s.Get(@"handle")})),@"minimized",R.Cast(@"bool",R.Invoke(R.Type(@"DshNative"),@"IsIconic",new object[]{s.Get(@"handle")})),@"z_rank",s.Get(@"rank"),@"z_rank_known",R.Binary(s,@"Ige",s.Get(@"rank"),0),@"title",(""+R.Str(R.Capture((o133) => {R.Emit(o133,R.Member(s.Get(@"info"),@"title"));}))),@"process",(""+R.Str(R.Capture((o134) => {R.Emit(o134,R.Member(s.Get(@"info"),@"process"));}))),@"pid",R.Cast(@"int",R.Member(s.Get(@"info"),@"pid")),@"observed_at",R.Invoke(s.Get(@"observedAt"),@"ToString",new object[]{@"o"})}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"sorted",R.Array(R.Capture((o135) => {R.Emit(o135,R.Call(s,@"Sort-Object",new Args(new object[]{new Named(@"Property",R.Switch),R.Map(new object[]{@"Expression",new Fn(s,Block_136)})}),R.Invoke(s.Get(@"rows"),@"ToArray",new object[]{})));})));
throw new ReturnFlow(s.Get(@"sorted"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_140(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ine",(""+R.Str(R.Capture((o141) => {R.Emit(o141,R.Index(s.Get(@"_"),@"relation"));}))),@"self"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_143(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o144) => {R.Emit(o144,R.Index(s.Get(@"_"),@"relation"));}))),@"self"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_ScreenshotRelated_137(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"hwnd",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"window")))){s.Set(@"hwnd",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"window")));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),0))){throw R.Error(@"[BAD_REQUEST] captures: 'related' needs a window: it captures that window and the windows that belong to it");}
s.Set(@"max",2);
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"maxCaptures"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o138) => {R.Emit(o138,R.Member(s.Get(@"Arg"),@"maxCaptures"));}))),@""))))){s.Set(@"max",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"maxCaptures")));}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"max"),1))){s.Set(@"max",1);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"max"),3))){s.Set(@"max",3);}
s.Set(@"related",R.Call(s,@"Get-RelatedWindowList",new Args(new object[]{s.Get(@"hwnd")}),null));
s.Set(@"ordered",R.Array(R.Capture((o139) => {R.Emit(o139,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_140)}),s.Get(@"related")));})));
s.Set(@"target",R.Array(R.Capture((o142) => {R.Emit(o142,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_143)}),s.Get(@"related")));})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"target"),@"Count"),0))){s.Set(@"ordered",R.Binary(s,@"Plus",s.Get(@"ordered"),R.Index(s.Get(@"target"),0)));}
s.Set(@"captures",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"omitted",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item145 in R.Array(s.Get(@"ordered"))){s.Set(@"row",item145);try{if(R.Bool(R.Binary(s,@"Ige",R.Member(s.Get(@"captures"),@"Count"),s.Get(@"max")))){R.Emit(o,R.Invoke(s.Get(@"omitted"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd")),@"relation",(""+R.Str(R.Capture((o146) => {R.Emit(o146,R.Index(s.Get(@"row"),@"relation"));}))),@"reason",(""+@"over max_captures ("+R.Str(s.Get(@"max"))+@")")}))}));
throw new ContinueFlow();}
if(R.Bool(R.Cast(@"bool",R.Index(s.Get(@"row"),@"minimized")))){R.Emit(o,R.Invoke(s.Get(@"omitted"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd")),@"relation",(""+R.Str(R.Capture((o147) => {R.Emit(o147,R.Index(s.Get(@"row"),@"relation"));}))),@"reason",@"minimized: a window capture would return the shell placeholder, not the window"}))}));
throw new ContinueFlow();}
s.Set(@"single",R.Cast(@"ordered",R.Map(new object[]{@"window",R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd"))})));
foreach(var item148 in R.Array(R.Array(R.Capture((o149) => {R.Emit(o149,new object[]{R.Array(R.Capture((o150) => {R.Emit(o150,new object[]{@"scale",@"scale"});})),R.Array(R.Capture((o151) => {R.Emit(o151,new object[]{@"format",@"format"});})),R.Array(R.Capture((o152) => {R.Emit(o152,new object[]{@"quality",@"quality"});})),R.Array(R.Capture((o153) => {R.Emit(o153,new object[]{@"clip",@"clip"});})),R.Array(R.Capture((o154) => {R.Emit(o154,new object[]{@"regionSpace",@"regionSpace"});})),R.Array(R.Capture((o155) => {R.Emit(o155,new object[]{@"surface",@"surface"});})),R.Array(R.Capture((o156) => {R.Emit(o156,new object[]{@"settleMs",@"settleMs"});})),R.Array(R.Capture((o157) => {R.Emit(o157,new object[]{@"stabilityMs",@"stabilityMs"});})),R.Array(R.Capture((o158) => {R.Emit(o158,new object[]{@"path",@"path"});}))});})))){s.Set(@"pair",item148);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),R.Index(s.Get(@"pair"),1)}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value")))){R.SetIndex(s.Get(@"single"),R.Index(s.Get(@"pair"),0),s.Get(@"value"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"index",R.Binary(s,@"Plus",R.Member(s.Get(@"captures"),@"Count"),1));
s.Set(@"ext",@"png");
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o159) => {R.Emit(o159,R.Index(s.Get(@"single"),@"format"));}))),@"jpeg")) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o160) => {R.Emit(o160,R.Index(s.Get(@"single"),@"format"));}))),@"jpg"))))){s.Set(@"ext",@"jpg");}
s.Set(@"base",(""+R.Str(R.Capture((o161) => {R.Emit(o161,R.Member(s.Get(@"Arg"),@"path"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"base"),@""))){s.Set(@"dir",R.Invoke(R.Type(@"System.IO.Path"),@"GetDirectoryName",new object[]{s.Get(@"base")}));
s.Set(@"leaf",R.Invoke(R.Type(@"System.IO.Path"),@"GetFileNameWithoutExtension",new object[]{s.Get(@"base")}));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"leaf")}))){s.Set(@"leaf",@"capture");}
s.Set(@"suffix",(""+@"related-"+R.Str(s.Get(@"index"))+@"-"+R.Str(R.Capture((o162) => {R.Emit(o162,R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd")));}))));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"dir")}))){s.Set(@"derived",(""+R.Str(s.Get(@"leaf"))+@"."+R.Str(s.Get(@"suffix"))+@"."+R.Str(s.Get(@"ext"))));}else{s.Set(@"derived",R.Invoke(R.Type(@"System.IO.Path"),@"Combine",new object[]{s.Get(@"dir"),(""+R.Str(s.Get(@"leaf"))+@"."+R.Str(s.Get(@"suffix"))+@"."+R.Str(s.Get(@"ext")))}));}}else{s.Set(@"derived",R.Invoke(R.Type(@"System.IO.Path"),@"Combine",new object[]{R.Invoke(R.Type(@"System.IO.Path"),@"GetTempPath",new object[]{}),(""+@"dsh-frame-"+R.Str(s.Get(@"PID"))+@"-"+R.Str(R.Capture((o163) => {R.Emit(o163,s.Get(@"script:RequestSeq"));}))+@"-"+R.Str(s.Get(@"index"))+@"-"+R.Str(R.Capture((o164) => {R.Emit(o164,R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd")));}))+@"."+R.Str(s.Get(@"ext")))}));}
R.SetIndex(s.Get(@"single"),@"path",s.Get(@"derived"));
try{s.Set(@"shot",R.Call(s,@"Do-Screenshot",new Args(new object[]{s.Get(@"single")}),null));}catch(Exception error165) when (!(error165 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error165}));R.Emit(o,R.Invoke(s.Get(@"omitted"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd")),@"relation",(""+R.Str(R.Capture((o166) => {R.Emit(o166,R.Index(s.Get(@"row"),@"relation"));}))),@"reason",(""+R.Str(R.Capture((o167) => {R.Emit(o167,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));})))}))}));
throw new ContinueFlow();}
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"path",s.Get(@"derived")}),null));
R.SetIndex(s.Get(@"shot"),@"relation",(""+R.Str(R.Capture((o168) => {R.Emit(o168,R.Index(s.Get(@"row"),@"relation"));}))));
R.SetIndex(s.Get(@"shot"),@"windowHwnd",R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd")));
R.SetIndex(s.Get(@"shot"),@"ownerHwnd",R.Cast(@"int64",R.Index(s.Get(@"row"),@"owner_hwnd")));
R.SetIndex(s.Get(@"shot"),@"zRank",R.Cast(@"int",R.Index(s.Get(@"row"),@"z_rank")));
R.SetIndex(s.Get(@"shot"),@"zRankKnown",R.Cast(@"bool",R.Index(s.Get(@"row"),@"z_rank_known")));
R.SetIndex(s.Get(@"shot"),@"windowTitle",(""+R.Str(R.Capture((o169) => {R.Emit(o169,R.Index(s.Get(@"row"),@"title"));}))));
R.Emit(o,R.Invoke(s.Get(@"captures"),@"Add",new object[]{s.Get(@"shot")}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"captures",R.Array(R.Capture((o170) => {R.Emit(o170,R.Invoke(s.Get(@"captures"),@"ToArray",new object[]{}));})),@"omitted",R.Array(R.Capture((o171) => {R.Emit(o171,R.Invoke(s.Get(@"omitted"),@"ToArray",new object[]{}));})),@"related",R.Array(R.Capture((o172) => {R.Emit(o172,s.Get(@"related"));}))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Screenshot_173(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"shotClock",R.Invoke(R.Type(@"System.Diagnostics.Stopwatch"),@"StartNew",new object[]{}));
s.Set(@"windowHwnd",R.Member(R.Type(@"IntPtr"),@"Zero"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"window"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"window")),0))))){s.Set(@"windowHwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"window"))));}
s.Set(@"captureSource",@"screen");
s.Set(@"windowInfo",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"windowHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindow",new object[]{s.Get(@"windowHwnd")})))){throw R.Error((""+@"hwnd "+R.Str(R.Capture((o174) => {R.Emit(o174,R.Cast(@"int64",s.Get(@"windowHwnd")));}))+@" is not a window any more; list windows with computer_windows and use a current handle"));}
if(R.Bool(R.Invoke(R.Type(@"DshNative"),@"IsIconic",new object[]{s.Get(@"windowHwnd")}))){throw R.Error((""+@"[WINDOW_MINIMIZED] hwnd "+R.Str(R.Capture((o175) => {R.Emit(o175,R.Cast(@"int64",s.Get(@"windowHwnd")));}))+@" is minimized: what it would render is the placeholder the shell keeps for it (a few dozen pixels wide, off the top-left of the virtual desktop), not the window's content. Restore it first (computer_ui_action with control_type Window and action restore), or capture the screen instead. (action_sent=false, recovery=computer_ui_action)"));}
s.Set(@"windowInfo",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"windowHwnd")}),null));
s.Set(@"r",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"windowHwnd")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"r")))){throw R.Error((""+@"hwnd "+R.Str(R.Capture((o176) => {R.Emit(o176,R.Cast(@"int64",s.Get(@"windowHwnd")));}))+@" has no usable rectangle"));}
s.Set(@"captureSource",@"window");}else{s.Set(@"r",R.Call(s,@"Resolve-Target",new Args(new object[]{s.Get(@"Arg")}),null));}
if(R.Bool((R.Bool(R.Binary(s,@"Ile",R.Member(s.Get(@"r"),@"width"),0)) || R.Bool(R.Binary(s,@"Ile",R.Member(s.Get(@"r"),@"height"),0))))){throw R.Error((""+@"empty capture region "+R.Str(R.Capture((o177) => {R.Emit(o177,R.Member(s.Get(@"r"),@"width"));}))+@"x"+R.Str(R.Capture((o178) => {R.Emit(o178,R.Member(s.Get(@"r"),@"height"));}))));}
if(R.Bool(R.Binary(s,@"Igt",R.Binary(s,@"Multiply",R.Member(s.Get(@"r"),@"width"),R.Member(s.Get(@"r"),@"height")),s.Get(@"MAX_CAPTURE_PIXELS")))){throw R.Error((""+@"the capture covers "+R.Str(R.Capture((o179) => {R.Emit(o179,R.Binary(s,@"Multiply",R.Member(s.Get(@"r"),@"width"),R.Member(s.Get(@"r"),@"height")));}))+@" pixels, over the "+R.Str(s.Get(@"MAX_CAPTURE_PIXELS"))+@" limit; pass a smaller region, a scale, or a smaller window"));}
s.Set(@"format",@"png");
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"format"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o180) => {R.Emit(o180,R.Member(s.Get(@"Arg"),@"format"));}))),@""))))){s.Set(@"format",R.Invoke((""+R.Str(R.Capture((o181) => {R.Emit(o181,R.Member(s.Get(@"Arg"),@"format"));}))),@"ToLowerInvariant",new object[]{}));}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"format"),@"png")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"format"),@"jpeg")))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"format"),@"jpg"))))){throw R.Error((""+@"unsupported image format '"+R.Str(s.Get(@"format"))+@"' (use png or jpeg)"));}
s.Set(@"quality",85);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"quality")))){s.Set(@"quality",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"quality")));}
s.Set(@"requestedScale",1d);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"scale")))){s.Set(@"requestedScale",R.Cast(@"double",R.Member(s.Get(@"Arg"),@"scale")));}
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"requestedScale"),0))){s.Set(@"requestedScale",1d);}
s.Set(@"effectiveScale",R.Invoke(R.Type(@"Math"),@"Min",new object[]{1d,s.Get(@"requestedScale")}));
s.Set(@"scaleNote",@"");
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"requestedScale"),1d))){s.Set(@"scaleNote",(""+@"scale "+R.Str(s.Get(@"requestedScale"))+@" was asked for and this backend only downscales, so the frame is 1:1 (effectiveScale=1): interpolation would not add detail, and pretending it had would misstate what the pixels are"));}
s.Set(@"scale",s.Get(@"effectiveScale"));
s.Set(@"clipRequested",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"clip"),s.Get(@"true")));
s.Set(@"cropRect",s.Get(@"null"));
s.Set(@"regionClipped",s.Get(@"false"));
s.Set(@"deliverX",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")));
s.Set(@"deliverY",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")));
s.Set(@"deliverW",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")));
s.Set(@"deliverH",R.Cast(@"int",R.Member(s.Get(@"r"),@"height")));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"windowHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"surfaceKind",@"wholeWindow");
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o182) => {R.Emit(o182,R.Member(s.Get(@"Arg"),@"surface"));}))),@"client")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"region")))))){s.Set(@"clientRect",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+RECT"}),null));
s.Set(@"clientOrigin",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
if(R.Bool((R.Bool(R.Invoke(R.Type(@"DshNative"),@"GetClientRect",new object[]{s.Get(@"windowHwnd"),new Ref(()=>s.Get(@"clientRect"),v=>{s.Set(@"clientRect",v);})})) && R.Bool(R.Invoke(R.Type(@"DshNative"),@"ClientToScreen",new object[]{s.Get(@"windowHwnd"),new Ref(()=>s.Get(@"clientOrigin"),v=>{s.Set(@"clientOrigin",v);})}))))){s.Set(@"cx",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"clientOrigin"),@"X")),R.Cast(@"int",R.Member(s.Get(@"r"),@"x"))));
s.Set(@"cy",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"clientOrigin"),@"Y")),R.Cast(@"int",R.Member(s.Get(@"r"),@"y"))));
s.Set(@"cw",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"clientRect"),@"Right")),R.Cast(@"int",R.Member(s.Get(@"clientRect"),@"Left"))));
s.Set(@"ch",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"clientRect"),@"Bottom")),R.Cast(@"int",R.Member(s.Get(@"clientRect"),@"Top"))));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"cw"),0)) && R.Bool(R.Binary(s,@"Igt",s.Get(@"ch"),0))))){s.Set(@"cropRect",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"cx"),@"y",s.Get(@"cy"),@"width",s.Get(@"cw"),@"height",s.Get(@"ch")})));
s.Set(@"deliverX",R.Binary(s,@"Plus",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")),s.Get(@"cx")));
s.Set(@"deliverY",R.Binary(s,@"Plus",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")),s.Get(@"cy")));
s.Set(@"deliverW",s.Get(@"cw"));
s.Set(@"deliverH",s.Get(@"ch"));
s.Set(@"surfaceKind",@"clientArea");}else{throw R.Error((""+@"[BAD_REQUEST] surface: 'client' was asked for but hwnd "+R.Str(R.Capture((o183) => {R.Emit(o183,R.Cast(@"int64",s.Get(@"windowHwnd")));}))+@" reports a client area of "+R.Str(s.Get(@"cw"))+@"x"+R.Str(s.Get(@"ch"))+@", which is not a rectangle anything can be captured from. Use surface: 'window' (the default) instead. (action_sent=false)"));}}else{throw R.Error((""+@"[CAPTURE_SURFACE_UNAVAILABLE] surface: 'client' was asked for but the client rectangle of hwnd "+R.Str(R.Capture((o184) => {R.Emit(o184,R.Cast(@"int64",s.Get(@"windowHwnd")));}))+@" could not be read, so there is nothing to crop to. Use surface: 'window' (the default), or read a screen region instead. (action_sent=false, recovery=computer_screenshot)"));}}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"region")))){s.Set(@"reg",R.Member(s.Get(@"Arg"),@"region"));
s.Set(@"rx",R.Cast(@"int",R.Member(s.Get(@"reg"),@"x")));
s.Set(@"ry",R.Cast(@"int",R.Member(s.Get(@"reg"),@"y")));
s.Set(@"rw",R.Cast(@"int",R.Member(s.Get(@"reg"),@"width")));
s.Set(@"rh",R.Cast(@"int",R.Member(s.Get(@"reg"),@"height")));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"rw"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"rh"),0))))){throw R.Error((""+@"[BAD_REQUEST] the capture region needs a positive width and height (got "+R.Str(s.Get(@"rw"))+@"x"+R.Str(s.Get(@"rh"))+@"). (action_sent=false)"));}
s.Set(@"regionSpace",(""+R.Str(R.Capture((o185) => {R.Emit(o185,R.Member(s.Get(@"Arg"),@"regionSpace"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"regionSpace"),@"window"))){s.Set(@"cx",s.Get(@"rx"));
s.Set(@"cy",s.Get(@"ry"));}else{s.Set(@"cx",R.Binary(s,@"Minus",s.Get(@"rx"),R.Cast(@"int",R.Member(s.Get(@"r"),@"x"))));
s.Set(@"cy",R.Binary(s,@"Minus",s.Get(@"ry"),R.Cast(@"int",R.Member(s.Get(@"r"),@"y"))));}
s.Set(@"inside",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ige",s.Get(@"cx"),0)) && R.Bool(R.Binary(s,@"Ige",s.Get(@"cy"),0)))) && R.Bool(R.Binary(s,@"Ile",R.Binary(s,@"Plus",s.Get(@"cx"),s.Get(@"rw")),R.Cast(@"int",R.Member(s.Get(@"r"),@"width")))))) && R.Bool(R.Binary(s,@"Ile",R.Binary(s,@"Plus",s.Get(@"cy"),s.Get(@"rh")),R.Cast(@"int",R.Member(s.Get(@"r"),@"height"))))));
if(R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"inside"))) && R.Bool(R.Unary(@"Not",s.Get(@"clipRequested")))))){s.Set(@"how",(""+@"the region ("+R.Str(s.Get(@"rx"))+@","+R.Str(s.Get(@"ry"))+@") "+R.Str(s.Get(@"rw"))+@"x"+R.Str(s.Get(@"rh"))+@" in window pixels"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"regionSpace"),@"window"))){s.Set(@"how",(""+@"the region ("+R.Str(s.Get(@"rx"))+@","+R.Str(s.Get(@"ry"))+@") "+R.Str(s.Get(@"rw"))+@"x"+R.Str(s.Get(@"rh"))+@" (screen pixels)"));}
throw R.Error((""+@"[BAD_REQUEST] "+R.Str(s.Get(@"how"))+@" is not inside the captured window, whose own bitmap is "+R.Str(R.Capture((o186) => {R.Emit(o186,R.Member(s.Get(@"r"),@"width"));}))+@"x"+R.Str(R.Capture((o187) => {R.Emit(o187,R.Member(s.Get(@"r"),@"height"));}))+@" with its origin at (0,0) in screen pixels "+R.Str(R.Capture((o188) => {R.Emit(o188,R.Member(s.Get(@"r"),@"x"));}))+@","+R.Str(R.Capture((o189) => {R.Emit(o189,R.Member(s.Get(@"r"),@"y"));}))+@". A region passed together with window: is a rectangle of the screen (region_space: 'screen', the default) or of that window (region_space: 'window') -- pass clip: true to take the part of it that exists, drop window: to read those screen pixels on their own, or fix the rectangle. (action_sent=false)"));}
s.Set(@"cx0",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,s.Get(@"cx")}));
s.Set(@"cy0",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,s.Get(@"cy")}));
s.Set(@"cx1",R.Invoke(R.Type(@"Math"),@"Min",new object[]{R.Cast(@"int",R.Member(s.Get(@"r"),@"width")),R.Binary(s,@"Plus",s.Get(@"cx"),s.Get(@"rw"))}));
s.Set(@"cy1",R.Invoke(R.Type(@"Math"),@"Min",new object[]{R.Cast(@"int",R.Member(s.Get(@"r"),@"height")),R.Binary(s,@"Plus",s.Get(@"cy"),s.Get(@"rh"))}));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"cx1"),s.Get(@"cx0"))) || R.Bool(R.Binary(s,@"Ile",s.Get(@"cy1"),s.Get(@"cy0")))))){throw R.Error((""+@"[BAD_REQUEST] the region ("+R.Str(s.Get(@"rx"))+@","+R.Str(s.Get(@"ry"))+@") "+R.Str(s.Get(@"rw"))+@"x"+R.Str(s.Get(@"rh"))+@" does not overlap the captured window at all, so there is nothing to clip to. (action_sent=false)"));}
s.Set(@"regionClipped",R.Unary(@"Not",s.Get(@"inside")));
s.Set(@"cropRect",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"cx0"),@"y",s.Get(@"cy0"),@"width",R.Binary(s,@"Minus",s.Get(@"cx1"),s.Get(@"cx0")),@"height",R.Binary(s,@"Minus",s.Get(@"cy1"),s.Get(@"cy0"))})));
s.Set(@"deliverX",R.Binary(s,@"Plus",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")),s.Get(@"cx0")));
s.Set(@"deliverY",R.Binary(s,@"Plus",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")),s.Get(@"cy0")));
s.Set(@"deliverW",R.Binary(s,@"Minus",s.Get(@"cx1"),s.Get(@"cx0")));
s.Set(@"deliverH",R.Binary(s,@"Minus",s.Get(@"cy1"),s.Get(@"cy0")));}
s.Set(@"surfaceRect",R.Cast(@"ordered",R.Map(new object[]{@"kind",@"wholeWindow",@"x",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"r"),@"height"))})));}else{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"region")))){s.Set(@"surfaceKind",@"screenRegion");}else if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o190) => {R.Emit(o190,R.Member(s.Get(@"Arg"),@"display"));}))),@"all"))){s.Set(@"surfaceKind",@"virtualDesktop");}else{s.Set(@"surfaceKind",@"display");}
s.Set(@"surfaceRect",R.Cast(@"ordered",R.Map(new object[]{@"kind",s.Get(@"surfaceKind"),@"x",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"r"),@"height"))})));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"cropRect")))){s.Set(@"cropRect",R.Cast(@"ordered",R.Map(new object[]{@"x",0,@"y",0,@"width",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"r"),@"height"))})));}
s.Set(@"displayKey",(""+R.Str(R.Capture((o191) => {R.Emit(o191,R.Member(s.Get(@"Arg"),@"display"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"display"))) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o192) => {R.Emit(o192,R.Member(s.Get(@"Arg"),@"display"));}))),@""))))){s.Set(@"displayKey",@"primary");}
s.Set(@"specKey",R.Call(s,@"Get-CaptureSpecKey",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"targetHwnd",R.Cast(@"int64",s.Get(@"windowHwnd")),@"surfaceKind",s.Get(@"surfaceKind"),@"cropRectSurface",(""+R.Str(R.Capture((o193) => {R.Emit(o193,R.Member(s.Get(@"cropRect"),@"x"));}))+@","+R.Str(R.Capture((o194) => {R.Emit(o194,R.Member(s.Get(@"cropRect"),@"y"));}))+@","+R.Str(R.Capture((o195) => {R.Emit(o195,R.Member(s.Get(@"cropRect"),@"width"));}))+@","+R.Str(R.Capture((o196) => {R.Emit(o196,R.Member(s.Get(@"cropRect"),@"height"));}))),@"displayKey",s.Get(@"displayKey"),@"effectiveScale",s.Get(@"effectiveScale"),@"format",s.Get(@"format")}))}),null));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Record-Capture",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"deliverX"),@"y",s.Get(@"deliverY"),@"width",s.Get(@"deliverW"),@"height",s.Get(@"deliverH")})),s.Get(@"windowHwnd"),s.Get(@"captureSource"),s.Get(@"specKey")}),null)));
s.Set(@"stamp",R.Call(s,@"Get-WriteStampInfo",new Args(new object[]{}),null));
s.Set(@"budget",R.Call(s,@"Resolve-StabilityBudget",new Args(new object[]{R.Member(s.Get(@"Arg"),@"stabilityMs"),R.Member(s.Get(@"Arg"),@"stable")}),null));
s.Set(@"stabilityTarget",R.Call(s,@"New-StabilityTarget",new Args(new object[]{s.Get(@"Arg"),s.Get(@"windowHwnd"),s.Get(@"r")}),null));
s.Set(@"settled",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"stamp")))){s.Set(@"settled",R.Call(s,@"Wait-ForSettle",new Args(new object[]{R.Member(s.Get(@"Arg"),@"settleMs")}),null));}
s.Set(@"stability",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"stamp")))){s.Set(@"stability",R.Call(s,@"New-StabilityResult",new Args(new object[]{@"none",s.Get(@"stabilityTarget"),R.Member(s.Get(@"budget"),@"ceilingMs"),R.Member(s.Get(@"budget"),@"resolvedBy"),@""}),null));}else if(R.Bool(R.Binary(s,@"Ile",R.Member(s.Get(@"budget"),@"ceilingMs"),0))){s.Set(@"stability",R.Call(s,@"New-StabilityResult",new Args(new object[]{@"disabled",s.Get(@"stabilityTarget"),0,R.Member(s.Get(@"budget"),@"resolvedBy"),@"",R.Member(s.Get(@"budget"),@"conflict")}),null));}else if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"windowHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"hwnd")),0)))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"hwnd")),R.Cast(@"int64",s.Get(@"windowHwnd"))))))){s.Set(@"note",@"the last write");
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o197) => {R.Emit(o197,R.Member(s.Get(@"stamp"),@"what"));}))),@""))){s.Set(@"note",(""+@"the last write ("+R.Str(R.Capture((o198) => {R.Emit(o198,R.Member(s.Get(@"stamp"),@"what"));}))+@")"));}
s.Set(@"note",(""+R.Str(s.Get(@"note"))+@" went to hwnd "+R.Str(R.Capture((o199) => {R.Emit(o199,R.Cast(@"int64",R.Member(s.Get(@"stamp"),@"hwnd")));}))+@", not to the hwnd "+R.Str(R.Capture((o200) => {R.Emit(o200,R.Cast(@"int64",s.Get(@"windowHwnd")));}))+@" this capture is of, so waiting for this window to stop changing says nothing about that action"));
s.Set(@"stability",R.Call(s,@"New-StabilityResult",new Args(new object[]{@"other-target",s.Get(@"stabilityTarget"),R.Member(s.Get(@"budget"),@"ceilingMs"),R.Member(s.Get(@"budget"),@"resolvedBy"),s.Get(@"note")}),null));}else{s.Set(@"stability",R.Call(s,@"Wait-ForStable",new Args(new object[]{R.Member(s.Get(@"budget"),@"ceilingMs"),s.Get(@"stabilityTarget"),R.Member(s.Get(@"budget"),@"resolvedBy"),R.Member(s.Get(@"budget"),@"conflict")}),null));}
s.Set(@"bmp",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Bitmap",new object[]{R.Member(s.Get(@"r"),@"width"),R.Member(s.Get(@"r"),@"height"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}}),null));
s.Set(@"out",s.Get(@"null"));
s.Set(@"frameBmp",s.Get(@"null"));
s.Set(@"encodedWidth",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")));
s.Set(@"encodedHeight",R.Cast(@"int",R.Member(s.Get(@"r"),@"height")));
s.Set(@"surfaceDigest",@"");
s.Set(@"verification",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[string]"}),null));
s.Set(@"hasContent",s.Get(@"null"));
try{s.Set(@"g",R.Invoke(R.Type(@"System.Drawing.Graphics"),@"FromImage",new object[]{s.Get(@"bmp")}));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"captureSource"),@"window"))){s.Set(@"hdc",R.Invoke(s.Get(@"g"),@"GetHdc",new object[]{}));
s.Set(@"drew",s.Get(@"false"));
try{s.Set(@"drew",R.Invoke(R.Type(@"DshNative"),@"PrintWindow",new object[]{s.Get(@"windowHwnd"),s.Get(@"hdc"),2}));}finally{R.Emit(o,R.Invoke(s.Get(@"g"),@"ReleaseHdc",new object[]{s.Get(@"hdc")}));}
if(R.Bool(R.Unary(@"Not",s.Get(@"drew")))){R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{@"PrintWindow reported failure"}));}
s.Set(@"hasContent",R.Call(s,@"Test-BitmapHasContent",new Args(new object[]{s.Get(@"bmp")}),null));
if(R.Bool(R.Unary(@"Not",s.Get(@"hasContent")))){R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{@"the window rendered a uniform frame"}));
R.Emit(o,R.Invoke(s.Get(@"g"),@"CopyFromScreen",new object[]{R.Member(s.Get(@"r"),@"x"),R.Member(s.Get(@"r"),@"y"),0,0,R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Size",new object[]{R.Member(s.Get(@"r"),@"width"),R.Member(s.Get(@"r"),@"height")}}),null),R.Member(R.Type(@"System.Drawing.CopyPixelOperation"),@"SourceCopy")}));
s.Set(@"captureSource",@"screen");
R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{@"fell back to the screen, which shows whatever covers the window"}));}else{R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{@"the window rendered its own pixels"}));}}else{R.Emit(o,R.Invoke(s.Get(@"g"),@"CopyFromScreen",new object[]{R.Member(s.Get(@"r"),@"x"),R.Member(s.Get(@"r"),@"y"),0,0,R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Size",new object[]{R.Member(s.Get(@"r"),@"width"),R.Member(s.Get(@"r"),@"height")}}),null),R.Member(R.Type(@"System.Drawing.CopyPixelOperation"),@"SourceCopy")}));
s.Set(@"hasContent",R.Call(s,@"Test-BitmapHasContent",new Args(new object[]{s.Get(@"bmp")}),null));}}finally{R.Emit(o,R.Invoke(s.Get(@"g"),@"Dispose",new object[]{}));}
s.Set(@"evidenceDigest",@"");
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"evidenceRect"))) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"captureSource"),@"screen"))))){s.Set(@"er",R.Member(s.Get(@"Arg"),@"evidenceRect"));
s.Set(@"ex",R.Cast(@"int",R.Member(s.Get(@"er"),@"x")));
s.Set(@"ey",R.Cast(@"int",R.Member(s.Get(@"er"),@"y")));
s.Set(@"ew",R.Cast(@"int",R.Member(s.Get(@"er"),@"width")));
s.Set(@"eh",R.Cast(@"int",R.Member(s.Get(@"er"),@"height")));
s.Set(@"maxSide",320);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"er"),@"maxSide")))){s.Set(@"maxSide",R.Cast(@"int",R.Member(s.Get(@"er"),@"maxSide")));}
s.Set(@"inside",(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"ew"),0)) && R.Bool(R.Binary(s,@"Igt",s.Get(@"eh"),0)))) && R.Bool(R.Binary(s,@"Ige",s.Get(@"ex"),R.Member(s.Get(@"r"),@"x"))))) && R.Bool(R.Binary(s,@"Ige",s.Get(@"ey"),R.Member(s.Get(@"r"),@"y"))))) && R.Bool(R.Binary(s,@"Ile",R.Binary(s,@"Plus",s.Get(@"ex"),s.Get(@"ew")),R.Binary(s,@"Plus",R.Member(s.Get(@"r"),@"x"),R.Member(s.Get(@"r"),@"width")))))) && R.Bool(R.Binary(s,@"Ile",R.Binary(s,@"Plus",s.Get(@"ey"),s.Get(@"eh")),R.Binary(s,@"Plus",R.Member(s.Get(@"r"),@"y"),R.Member(s.Get(@"r"),@"height"))))));
if(R.Bool(s.Get(@"inside"))){s.Set(@"crop",s.Get(@"null"));
try{s.Set(@"clip",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Rectangle",new object[]{R.Binary(s,@"Minus",s.Get(@"ex"),R.Member(s.Get(@"r"),@"x")),R.Binary(s,@"Minus",s.Get(@"ey"),R.Member(s.Get(@"r"),@"y")),s.Get(@"ew"),s.Get(@"eh")}}),null));
s.Set(@"crop",R.Invoke(s.Get(@"bmp"),@"Clone",new object[]{s.Get(@"clip"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}));
s.Set(@"evidenceDigest",R.Call(s,@"Get-BitmapDigestScaled",new Args(new object[]{s.Get(@"crop"),s.Get(@"maxSide")}),null));}catch(Exception error201) when (!(error201 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error201}));s.Set(@"evidenceDigest",@"");}finally{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"crop")))){R.Emit(o,R.Invoke(s.Get(@"crop"),@"Dispose",new object[]{}));}}}}
try{s.Set(@"surfaceDigest",R.Call(s,@"Get-BitmapDigestScaled",new Args(new object[]{s.Get(@"bmp"),320}),null));}catch(Exception error202) when (!(error202 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error202}));s.Set(@"surfaceDigest",@"");}
s.Set(@"path",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"path")));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"path")}))){throw R.Error(@"screenshot requires a path");}
s.Set(@"dir",R.Call(s,@"Split-Path",new Args(new object[]{new Named(@"Parent",R.Switch),s.Get(@"path")}),null));
if(R.Bool((R.Bool(s.Get(@"dir")) && R.Bool(R.Unary(@"Not",R.Call(s,@"Test-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"dir")}),null)))))){R.Emit(o,R.Call(s,@"Out-Null",new Args(new object[]{}),R.Call(s,@"New-Item",new Args(new object[]{new Named(@"ItemType",R.Switch),@"Directory",new Named(@"Force",R.Switch),new Named(@"Path",R.Switch),s.Get(@"dir")}),null)));}
s.Set(@"cropOnly",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"x")),0)) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"y")),0)))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"width")),R.Member(s.Get(@"bmp"),@"Width"))))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"height")),R.Member(s.Get(@"bmp"),@"Height")))));
if(R.Bool(s.Get(@"cropOnly"))){s.Set(@"clipRect",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Rectangle",new object[]{R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"x")),R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"y")),R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"width")),R.Cast(@"int",R.Member(s.Get(@"cropRect"),@"height"))}}),null));
s.Set(@"frameBmp",R.Invoke(s.Get(@"bmp"),@"Clone",new object[]{s.Get(@"clipRect"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}));}else{s.Set(@"frameBmp",s.Get(@"bmp"));}
s.Set(@"sourceW",R.Member(s.Get(@"frameBmp"),@"Width"));
s.Set(@"sourceH",R.Member(s.Get(@"frameBmp"),@"Height"));
s.Set(@"encodedWidth",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",s.Get(@"sourceW"),s.Get(@"scale"))}))}));
s.Set(@"encodedHeight",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",s.Get(@"sourceH"),s.Get(@"scale"))}))}));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"encodedWidth"),s.Get(@"sourceW"))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"encodedHeight"),s.Get(@"sourceH")))))){s.Set(@"out",R.Call(s,@"New-Object",new Args(new object[]{@"System.Drawing.Bitmap",new object[]{s.Get(@"encodedWidth"),s.Get(@"encodedHeight"),R.Member(R.Type(@"System.Drawing.Imaging.PixelFormat"),@"Format32bppArgb")}}),null));
s.Set(@"g2",R.Invoke(R.Type(@"System.Drawing.Graphics"),@"FromImage",new object[]{s.Get(@"out")}));
try{R.SetMember(s.Get(@"g2"),@"InterpolationMode",R.Member(R.Type(@"System.Drawing.Drawing2D.InterpolationMode"),@"HighQualityBilinear"));
R.SetMember(s.Get(@"g2"),@"PixelOffsetMode",R.Member(R.Type(@"System.Drawing.Drawing2D.PixelOffsetMode"),@"HighQuality"));
R.Emit(o,R.Invoke(s.Get(@"g2"),@"DrawImage",new object[]{s.Get(@"frameBmp"),0,0,s.Get(@"encodedWidth"),s.Get(@"encodedHeight")}));}finally{R.Emit(o,R.Invoke(s.Get(@"g2"),@"Dispose",new object[]{}));}
R.Emit(o,R.Call(s,@"Save-BitmapToFile",new Args(new object[]{s.Get(@"out"),s.Get(@"path"),s.Get(@"format"),s.Get(@"quality")}),null));}else{R.Emit(o,R.Call(s,@"Save-BitmapToFile",new Args(new object[]{s.Get(@"frameBmp"),s.Get(@"path"),s.Get(@"format"),s.Get(@"quality")}),null));}}finally{if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"frameBmp"))) && R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"Object"),@"ReferenceEquals",new object[]{s.Get(@"frameBmp"),s.Get(@"bmp")})))))){R.Emit(o,R.Invoke(s.Get(@"frameBmp"),@"Dispose",new object[]{}));}
R.Emit(o,R.Invoke(s.Get(@"bmp"),@"Dispose",new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"out")))){R.Emit(o,R.Invoke(s.Get(@"out"),@"Dispose",new object[]{}));}}
s.Set(@"cursor",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"cursor"),v=>{s.Set(@"cursor",v);})})));
s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
s.Set(@"fileInfo",R.Call(s,@"Get-Item",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"path")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"captureSource"),@"window"))){s.Set(@"after",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"windowHwnd")}),null));
if(R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"after"),@"pid")),R.Cast(@"int",R.Member(s.Get(@"windowInfo"),@"pid"))))){R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{(""+@"the window changed owner during the capture (pid "+R.Str(R.Capture((o203) => {R.Emit(o203,R.Member(s.Get(@"windowInfo"),@"pid"));}))+@" -> "+R.Str(R.Capture((o204) => {R.Emit(o204,R.Member(s.Get(@"after"),@"pid"));}))+@"); this frame may not be the window you asked for")}));}else{R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{@"the window still belonged to the same process afterwards"}));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hasContent"),s.Get(@"false")))){R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{@"the frame carries no contrast at all"}));}
s.Set(@"rectAfter",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"windowHwnd")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"rectAfter"))) && R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"rectAfter"),@"x"),R.Member(s.Get(@"r"),@"x"))) || R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"rectAfter"),@"y"),R.Member(s.Get(@"r"),@"y"))))) || R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"rectAfter"),@"width"),R.Member(s.Get(@"r"),@"width"))))) || R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"rectAfter"),@"height"),R.Member(s.Get(@"r"),@"height")))))))){R.Emit(o,R.Invoke(s.Get(@"verification"),@"Add",new object[]{(""+@"the window changed geometry while the frame was being taken (was "+R.Str(R.Capture((o205) => {R.Emit(o205,R.Member(s.Get(@"r"),@"x"));}))+@","+R.Str(R.Capture((o206) => {R.Emit(o206,R.Member(s.Get(@"r"),@"y"));}))+@" "+R.Str(R.Capture((o207) => {R.Emit(o207,R.Member(s.Get(@"r"),@"width"));}))+@"x"+R.Str(R.Capture((o208) => {R.Emit(o208,R.Member(s.Get(@"r"),@"height"));}))+@", is now "+R.Str(R.Capture((o209) => {R.Emit(o209,R.Member(s.Get(@"rectAfter"),@"x"));}))+@","+R.Str(R.Capture((o210) => {R.Emit(o210,R.Member(s.Get(@"rectAfter"),@"y"));}))+@" "+R.Str(R.Capture((o211) => {R.Emit(o211,R.Member(s.Get(@"rectAfter"),@"width"));}))+@"x"+R.Str(R.Capture((o212) => {R.Emit(o212,R.Member(s.Get(@"rectAfter"),@"height"));}))+@"); the origin recorded with this frame is the earlier one")}));}}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"hasContent"),s.Get(@"false"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"windowHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))))){s.Set(@"why",R.Binary(s,@"Join",R.Array(R.Capture((o213) => {R.Emit(o213,R.Invoke(s.Get(@"verification"),@"ToArray",new object[]{}));})),@"; "));
s.Set(@"detail",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"why"),@""))){s.Set(@"detail",(""+@" Checked: "+R.Str(s.Get(@"why"))+@"."));}
throw R.Error((""+@"[CAPTURE_SURFACE_UNAVAILABLE] hwnd "+R.Str(R.Capture((o214) => {R.Emit(o214,R.Cast(@"int64",s.Get(@"windowHwnd")));}))+@" came back with no contrast at all: every sampled pixel was the same, so the frame holds no window. "+R.Str(s.Get(@"detail"))+@" Try a region capture of the same area instead, or bring the window on screen and retry. (action_sent=false, recovery=computer_screenshot)"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"requireWindow"),s.Get(@"true"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"captureSource"),@"window"))))){s.Set(@"why",R.Binary(s,@"Join",R.Array(R.Capture((o215) => {R.Emit(o215,R.Invoke(s.Get(@"verification"),@"ToArray",new object[]{}));})),@"; "));
throw R.Error((""+@"[CAPTURE_SURFACE_UNAVAILABLE] require=window was asked for and this window could not render itself, so the capture would have fallen back to the screen (which shows whatever covers it). Why: "+R.Str(s.Get(@"why"))+@". Retry without require, or capture the screen deliberately with a region. (action_sent=false, recovery=computer_screenshot)"));}
s.Set(@"payload",R.Cast(@"ordered",R.Map(new object[]{@"path",s.Get(@"path"),@"x",s.Get(@"deliverX"),@"y",s.Get(@"deliverY"),@"width",s.Get(@"deliverW"),@"height",s.Get(@"deliverH"),@"scale",s.Get(@"scale"),@"requestedScale",s.Get(@"requestedScale"),@"effectiveScale",s.Get(@"effectiveScale"),@"format",s.Get(@"format"),@"bytes",R.Cast(@"int64",R.Member(s.Get(@"fileInfo"),@"Length")),@"settledMs",s.Get(@"settled"),@"stability",s.Get(@"stability"),@"clipped",(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"r"),@"clipped"))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"r"),@"clipped"),s.Get(@"true"))))) || R.Bool(s.Get(@"regionClipped"))),@"source",s.Get(@"captureSource"),@"surfaceKind",s.Get(@"surfaceKind"),@"units",@"physicalPixels",@"surface",s.Get(@"surfaceRect"),@"cropRectSurface",s.Get(@"cropRect"),@"encodedWidth",s.Get(@"encodedWidth"),@"encodedHeight",s.Get(@"encodedHeight"),@"specKey",s.Get(@"specKey"),@"surfaceDigest",s.Get(@"surfaceDigest"),@"verification",R.Array(R.Capture((o216) => {R.Emit(o216,R.Invoke(s.Get(@"verification"),@"ToArray",new object[]{}));})),@"screens",R.Array(R.Capture((o217) => {R.Emit(o217,R.Call(s,@"Get-ScreenList",new Args(new object[]{}),null));})),@"virtual",R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null),@"cursor",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Member(s.Get(@"cursor"),@"X"),@"y",R.Member(s.Get(@"cursor"),@"Y")})),@"foreground",R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"fg")),@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"fg")})})),@"window",s.Get(@"windowInfo")})));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"surfaceKind"),@"wholeWindow"))){R.SetMember(s.Get(@"payload"),@"windowRect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"r"),@"height"))})));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"effectiveScale"),s.Get(@"requestedScale")))){R.SetMember(s.Get(@"payload"),@"scaleClamped",s.Get(@"true"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"scaleNote"),@""))){R.SetMember(s.Get(@"payload"),@"scaleNote",s.Get(@"scaleNote"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"evidenceDigest"),@""))){R.SetMember(s.Get(@"payload"),@"evidenceDigest",s.Get(@"evidenceDigest"));}
R.SetMember(s.Get(@"payload"),@"timing",R.Cast(@"ordered",R.Map(new object[]{@"totalMs",R.Cast(@"int64",R.Member(s.Get(@"shotClock"),@"ElapsedMilliseconds")),@"settleMs",R.Cast(@"int",s.Get(@"settled")),@"pollMs",0,@"polls",0,@"stabilityMs",0})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"stability")))){R.SetMember(R.Member(s.Get(@"payload"),@"timing"),@"polls",R.Cast(@"int",R.Member(s.Get(@"stability"),@"polls")));
R.SetMember(R.Member(s.Get(@"payload"),@"timing"),@"pollMs",R.Cast(@"int",R.Member(s.Get(@"stability"),@"waitedMs")));
R.SetMember(R.Member(s.Get(@"payload"),@"timing"),@"stabilityMs",R.Cast(@"int",R.Member(s.Get(@"stability"),@"budgetMs")));}
R.SetMember(s.Get(@"payload"),@"captureSpanMs",R.Cast(@"int64",R.Member(s.Get(@"shotClock"),@"ElapsedMilliseconds")));
R.SetMember(s.Get(@"payload"),@"frame",R.Call(s,@"New-CaptureFrame",new Args(new object[]{s.Get(@"payload")}),null));
R.Emit(o,R.Call(s,@"Set-FrameCompleted",new Args(new object[]{R.Member(s.Get(@"payload"),@"frame")}),null));
R.Emit(o,R.Call(s,@"Complete-WriteStamp",new Args(new object[]{}),null));
throw new ReturnFlow(s.Get(@"payload"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_PointOnDesktop_218(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
try{s.Set(@"vx",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_XVIRTUALSCREEN")}));
s.Set(@"vy",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_YVIRTUALSCREEN")}));
s.Set(@"vw",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_CXVIRTUALSCREEN")}));
s.Set(@"vh",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_CYVIRTUALSCREEN")}));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"vw"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"vh"),0))))){throw new ReturnFlow(s.Get(@"true"));}
throw new ReturnFlow((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ige",s.Get(@"x"),s.Get(@"vx"))) && R.Bool(R.Binary(s,@"Ilt",s.Get(@"x"),R.Binary(s,@"Plus",s.Get(@"vx"),s.Get(@"vw")))))) && R.Bool(R.Binary(s,@"Ige",s.Get(@"y"),s.Get(@"vy"))))) && R.Bool(R.Binary(s,@"Ilt",s.Get(@"y"),R.Binary(s,@"Plus",s.Get(@"vy"),s.Get(@"vh"))))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_PointOnDesktop_219(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
try{if(R.Bool(R.Call(s,@"Test-PointOnDesktop",new Args(new object[]{s.Get(@"x"),s.Get(@"y")}),null))){throw new ReturnFlow(null);}
s.Set(@"vx",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_XVIRTUALSCREEN")}));
s.Set(@"vy",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_YVIRTUALSCREEN")}));
s.Set(@"vw",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_CXVIRTUALSCREEN")}));
s.Set(@"vh",R.Invoke(R.Type(@"DshNative"),@"GetSystemMetrics",new object[]{R.Member(R.Type(@"DshNative"),@"SM_CYVIRTUALSCREEN")}));
throw R.Error((""+@"("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") is outside the virtual desktop, which spans x="+R.Str(s.Get(@"vx"))+@".."+R.Str(R.Capture((o220) => {R.Emit(o220,R.Binary(s,@"Minus",R.Binary(s,@"Plus",s.Get(@"vx"),s.Get(@"vw")),1));}))+@" and y="+R.Str(s.Get(@"vy"))+@".."+R.Str(R.Capture((o221) => {R.Emit(o221,R.Binary(s,@"Minus",R.Binary(s,@"Plus",s.Get(@"vy"),s.Get(@"vh")),1));}))+@"; nothing was sent"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Wait_ForCursorToSettle_222(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
s.Set(@"timeoutMs",R.Bind(a,2,@"timeoutMs",()=>null,@"int"));
try{s.Set(@"deadline",R.Invoke(R.Call(s,@"Get-Date",new Args(new object[]{}),null),@"AddMilliseconds",new object[]{s.Get(@"timeoutMs")}));
while(R.Bool(R.Binary(s,@"Ilt",R.Call(s,@"Get-Date",new Args(new object[]{}),null),s.Get(@"deadline")))){try{s.Set(@"cursor",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
if(R.Bool(R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"cursor"),v=>{s.Set(@"cursor",v);})}))){if(R.Bool((R.Bool(R.Binary(s,@"Ile",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",R.Member(s.Get(@"cursor"),@"X"),s.Get(@"x"))}),1)) && R.Bool(R.Binary(s,@"Ile",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",R.Member(s.Get(@"cursor"),@"Y"),s.Get(@"y"))}),1))))){throw new ReturnFlow(s.Get(@"true"));}}
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),10}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"false"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_MouseMoveRelative_223(Scope s,Args a){var o=new List<object>();s.Set(@"dx",R.Bind(a,0,@"dx",()=>null,@"int"));
s.Set(@"dy",R.Bind(a,1,@"dy",()=>null,@"int"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before a relative move"}),null));
if(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"dx"),-32767)) || R.Bool(R.Binary(s,@"Igt",s.Get(@"dx"),32767)))) || R.Bool(R.Binary(s,@"Ilt",s.Get(@"dy"),-32767)))) || R.Bool(R.Binary(s,@"Igt",s.Get(@"dy"),32767))))){throw R.Error((""+@"[BAD_REQUEST] a relative move is limited to ±32767 on each axis (got dx="+R.Str(s.Get(@"dx"))+@", dy="+R.Str(s.Get(@"dy"))+@")"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"dx"),0)) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"dy"),0))))){throw R.Error(@"[BAD_REQUEST] a relative move needs a non-zero dx or dy");}
R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{@"before the relative move"}),null));
s.Set(@"before",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"before"),v=>{s.Set(@"before",v);})})));
s.Set(@"sent",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Array(R.Capture((o224) => {R.Emit(o224,R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{s.Get(@"dx"),s.Get(@"dy"),0,R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_MOVE")}));}))}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"sent"),0))){throw R.Error(@"SendInput delivered no mouse events (the desktop may be locked or the target is at a higher integrity level)");}
s.Set(@"after",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"after"),v=>{s.Set(@"after",v);})})));
s.Set(@"observedX",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"after"),@"X")),R.Cast(@"int",R.Member(s.Get(@"before"),@"X"))));
s.Set(@"observedY",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"after"),@"Y")),R.Cast(@"int",R.Member(s.Get(@"before"),@"Y"))));
s.Set(@"receipt",R.Cast(@"ordered",R.Map(new object[]{@"requested",R.Cast(@"ordered",R.Map(new object[]{@"dx",s.Get(@"dx"),@"dy",s.Get(@"dy")})),@"cursorBefore",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"before"),@"X")),@"y",R.Cast(@"int",R.Member(s.Get(@"before"),@"Y"))})),@"cursorAfter",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"after"),@"X")),@"y",R.Cast(@"int",R.Member(s.Get(@"after"),@"Y"))})),@"observedDelta",R.Cast(@"ordered",R.Map(new object[]{@"dx",s.Get(@"observedX"),@"dy",s.Get(@"observedY")})),@"events",s.Get(@"sent")})));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"observedX"),0)) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"observedY"),0))))){R.SetIndex(s.Get(@"receipt"),@"note",@"the pointer did not move on screen. The events were delivered, so either the target consumes relative motion without moving the cursor (a locked or recentred pointer, which is what this action exists for), or the desktop is discarding synthesized input. Check whether the target reacted before retrying.");}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"observedX"),s.Get(@"dx"))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"observedY"),s.Get(@"dy")))))){R.SetIndex(s.Get(@"receipt"),@"note",(""+@"the pointer moved ("+R.Str(s.Get(@"observedX"))+@","+R.Str(s.Get(@"observedY"))+@") for a requested ("+R.Str(s.Get(@"dx"))+@","+R.Str(s.Get(@"dy"))+@"): pointer acceleration and desktop scaling apply to relative moves, so this is not an error."));}
throw new ReturnFlow(s.Get(@"receipt"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_MouseMove_225(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
s.Set(@"wait",R.Bind(a,2,@"wait",()=>s.Get(@"false"),@"bool"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before moving the pointer"}),null));
R.Emit(o,R.Call(s,@"Assert-PointOnDesktop",new Args(new object[]{s.Get(@"x"),s.Get(@"y")}),null));
s.Set(@"start",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"start"),v=>{s.Set(@"start",v);})})));
s.Set(@"startX",R.Member(s.Get(@"start"),@"X"));
s.Set(@"startY",R.Member(s.Get(@"start"),@"Y"));
s.Set(@"abs",R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{R.Invoke(R.Type(@"DshNative"),@"ToAbsoluteX",new object[]{s.Get(@"x")}),R.Invoke(R.Type(@"DshNative"),@"ToAbsoluteY",new object[]{s.Get(@"y")}),0,R.Binary(s,@"Bor",R.Binary(s,@"Bor",R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_MOVE"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_ABSOLUTE")),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_VIRTUALDESK"))}));
s.Set(@"sent",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Array(R.Capture((o226) => {R.Emit(o226,s.Get(@"abs"));}))}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"sent"),0))){throw R.Error(@"SendInput delivered no mouse events (the desktop may be locked or the target is at a higher integrity level)");}
if(R.Bool(s.Get(@"wait"))){if(R.Bool(R.Unary(@"Not",R.Call(s,@"Wait-ForCursorToSettle",new Args(new object[]{s.Get(@"x"),s.Get(@"y"),150}),null)))){s.Set(@"cursor",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"cursor"),v=>{s.Set(@"cursor",v);})})));
s.Set(@"moved",R.Binary(s,@"Plus",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",R.Member(s.Get(@"cursor"),@"X"),s.Get(@"startX"))}),R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",R.Member(s.Get(@"cursor"),@"Y"),s.Get(@"startY"))})));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"moved"),2))){s.Set(@"abs2",R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{R.Invoke(R.Type(@"DshNative"),@"ToAbsoluteX",new object[]{s.Get(@"x")}),R.Invoke(R.Type(@"DshNative"),@"ToAbsoluteY",new object[]{s.Get(@"y")}),0,R.Binary(s,@"Bor",R.Binary(s,@"Bor",R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_MOVE"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_ABSOLUTE")),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_VIRTUALDESK"))}));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Array(R.Capture((o227) => {R.Emit(o227,s.Get(@"abs2"));}))})));
if(R.Bool(R.Call(s,@"Wait-ForCursorToSettle",new Args(new object[]{s.Get(@"x"),s.Get(@"y"),400}),null))){throw new ReturnFlow(null);}
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"cursor"),v=>{s.Set(@"cursor",v);})})));
throw R.Error((""+@"[POINTER_NOT_SETTLED] the pointer was moved to ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") and is still at "+R.Str(R.Capture((o228) => {R.Emit(o228,R.Member(s.Get(@"cursor"),@"X"));}))+@","+R.Str(R.Capture((o229) => {R.Emit(o229,R.Member(s.Get(@"cursor"),@"Y"));}))+@" after being sent twice. Input is reaching this desktop -- the pointer did travel -- so this is a slow or contended desktop rather than a locked one. Retry the action, or raise the wait. (action_sent=true, dispatch_status=possibly_sent)"));}
throw R.Error((""+@"the pointer did not reach ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@"): SendInput was accepted but nothing moved (it is still at "+R.Str(R.Capture((o230) => {R.Emit(o230,R.Member(s.Get(@"cursor"),@"X"));}))+@","+R.Str(R.Capture((o231) => {R.Emit(o231,R.Member(s.Get(@"cursor"),@"Y"));}))+@"). This is what a locked workstation, a secure desktop, or a session that is not attached to the console looks like -- synthesized input is being discarded by Windows. (action_sent=true, dispatch_status=possibly_sent)"));}}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ButtonFlags_232(Scope s,Args a){var o=new List<object>();s.Set(@"button",R.Bind(a,0,@"button",()=>null,@"string"));
try{foreach(var switchValue233 in R.Array(R.Invoke((""+R.Str(s.Get(@"button"))),@"ToLowerInvariant",new object[]{}))){try{bool hit234=false;if(R.SwitchMatch(s,switchValue233,@"right")){hit234=true;throw new ReturnFlow(R.Array(R.Capture((o235) => {R.Emit(o235,new object[]{R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_RIGHTDOWN"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_RIGHTUP")});})));}if(R.SwitchMatch(s,switchValue233,@"middle")){hit234=true;throw new ReturnFlow(R.Array(R.Capture((o236) => {R.Emit(o236,new object[]{R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_MIDDLEDOWN"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_MIDDLEUP")});})));}if(!hit234){throw new ReturnFlow(R.Array(R.Capture((o237) => {R.Emit(o237,new object[]{R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_LEFTDOWN"),R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_LEFTUP")});})));}}catch(BreakFlow){break;}catch(ContinueFlow){}}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_PressableElementAtPoint_238(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
try{R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationClient"}),null));
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationTypes"}),null));
s.Set(@"el",s.Get(@"null"));
try{s.Set(@"point",R.Call(s,@"New-Object",new Args(new object[]{@"System.Windows.Point",new object[]{s.Get(@"x"),s.Get(@"y")}}),null));
s.Set(@"el",R.Invoke(R.Type(@"System.Windows.Automation.AutomationElement"),@"FromPoint",new object[]{s.Get(@"point")}));}catch(Exception error239) when (!(error239 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error239}));s.Set(@"el",s.Get(@"null"));}
s.Set(@"walker",R.Member(R.Type(@"System.Windows.Automation.TreeWalker"),@"ControlViewWalker"));
{s.Set(@"hop",0);while(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"hop"),4)) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"el")))))){try{try{s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));
if(R.Bool(R.Member(s.Get(@"info"),@"IsEnabled"))){s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.InvokePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})}))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"element",s.Get(@"el"),@"name",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@"controlType",R.Cast(@"string",R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName")),@"automationId",R.Cast(@"string",R.Member(s.Get(@"info"),@"AutomationId"))})));}}
s.Set(@"el",R.Invoke(s.Get(@"walker"),@"GetParent",new object[]{s.Get(@"el")}));}catch(Exception error240) when (!(error240 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error240}));throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u241=s.Get(@"hop");s.Set(@"hop",R.Binary(s,@"Plus",u241,1L));return u241;}));}}
throw new ReturnFlow(s.Get(@"null"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_HitIdentity_242(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
try{R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationClient"}),null));
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationTypes"}),null));
s.Set(@"el",s.Get(@"null"));
try{s.Set(@"el",R.Invoke(R.Type(@"System.Windows.Automation.AutomationElement"),@"FromPoint",new object[]{R.Call(s,@"New-Object",new Args(new object[]{@"System.Windows.Point",new object[]{s.Get(@"x"),s.Get(@"y")}}),null)}));}catch(Exception error243) when (!(error243 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error243}));s.Set(@"el",s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"el")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"walker",R.Member(R.Type(@"System.Windows.Automation.TreeWalker"),@"ControlViewWalker"));
s.Set(@"hitHwnd",0);
s.Set(@"hitPid",0);
s.Set(@"hitName",@"");
s.Set(@"hitType",@"");
s.Set(@"node",s.Get(@"el"));
{s.Set(@"hop",0);while(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"hop"),6)) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"node")))))){try{try{s.Set(@"info",R.Member(s.Get(@"node"),@"Current"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hop"),0))){s.Set(@"hitName",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")));
s.Set(@"hitType",R.Cast(@"string",R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName")));
s.Set(@"hitPid",R.Cast(@"int",R.Member(s.Get(@"info"),@"ProcessId")));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"hitHwnd"),0)) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"info"),@"NativeWindowHandle")),0))))){s.Set(@"hitHwnd",R.Cast(@"int64",R.Member(s.Get(@"info"),@"NativeWindowHandle")));}
s.Set(@"node",R.Invoke(s.Get(@"walker"),@"GetParent",new object[]{s.Get(@"node")}));}catch(Exception error244) when (!(error244 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error244}));throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u245=s.Get(@"hop");s.Set(@"hop",R.Binary(s,@"Plus",u245,1L));return u245;}));}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"hwnd",s.Get(@"hitHwnd"),@"pid",s.Get(@"hitPid"),@"name",s.Get(@"hitName"),@"controlType",s.Get(@"hitType")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_CaptureSpecKey_246(Scope s,Args a){var o=new List<object>();s.Set(@"payload",R.Bind(a,0,@"payload",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"payload")))){throw new ReturnFlow(@"");}
s.Set(@"hwnd",R.Cast(@"int64",0));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"window"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(R.Member(s.Get(@"payload"),@"window"),@"hwnd")))))){s.Set(@"hwnd",R.Cast(@"int64",R.Member(R.Member(s.Get(@"payload"),@"window"),@"hwnd")));}else if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"targetHwnd")))){s.Set(@"hwnd",R.Cast(@"int64",R.Member(s.Get(@"payload"),@"targetHwnd")));}
s.Set(@"surface",(""+R.Str(R.Capture((o247) => {R.Emit(o247,R.Member(s.Get(@"payload"),@"surfaceKind"));}))));
s.Set(@"crop",(""+R.Str(R.Capture((o248) => {R.Emit(o248,R.Member(s.Get(@"payload"),@"cropRectSurface"));}))));
s.Set(@"display",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"displayKey")))){s.Set(@"display",(""+R.Str(R.Capture((o249) => {R.Emit(o249,R.Member(s.Get(@"payload"),@"displayKey"));}))));}
s.Set(@"scale",@"1");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"effectiveScale")))){s.Set(@"scale",R.Invoke(R.Cast(@"double",R.Member(s.Get(@"payload"),@"effectiveScale")),@"ToString",new object[]{@"0.####",R.Member(R.Type(@"System.Globalization.CultureInfo"),@"InvariantCulture")}));}
throw new ReturnFlow((""+@"hwnd="+R.Str(s.Get(@"hwnd"))+@";surface="+R.Str(s.Get(@"surface"))+@";crop="+R.Str(s.Get(@"crop"))+@";display="+R.Str(s.Get(@"display"))+@";scale="+R.Str(s.Get(@"scale"))+@";format="+R.Str(R.Capture((o250) => {R.Emit(o250,R.Member(s.Get(@"payload"),@"format"));}))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_CaptureFrame_251(Scope s,Args a){var o=new List<object>();s.Set(@"payload",R.Bind(a,0,@"payload",()=>null,@"object"));
try{R.Eval(()=>R.Eval(()=>{var u252=s.Get(@"script:FrameSeq");s.Set(@"script:FrameSeq",R.Binary(s,@"Plus",u252,1L));return u252;}));
s.Set(@"id",(""+@"f"+R.Str(R.Capture((o253) => {R.Emit(o253,s.Get(@"script:BootGen"));}))+R.Str(R.Capture((o254) => {R.Emit(o254,s.Get(@"script:FrameSeq"));}))));
s.Set(@"hwnd",0);
s.Set(@"ownerPid",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"window")))){s.Set(@"hwnd",R.Cast(@"int64",R.Member(R.Member(s.Get(@"payload"),@"window"),@"hwnd")));
s.Set(@"ownerPid",R.Cast(@"int",R.Member(R.Member(s.Get(@"payload"),@"window"),@"pid")));}
s.Set(@"dpi",R.Call(s,@"Get-WindowDpi",new Args(new object[]{s.Get(@"hwnd")}),null));
s.Set(@"procStart",R.Call(s,@"Get-ProcessStartTicks",new Args(new object[]{s.Get(@"ownerPid")}),null));
s.Set(@"rootHwnd",R.Call(s,@"Get-WindowRootHwnd",new Args(new object[]{s.Get(@"hwnd")}),null));
s.Set(@"virtual",R.Member(s.Get(@"payload"),@"virtual"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"virtual")))){s.Set(@"virtual",R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null));}
s.Set(@"windowRect",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"windowRect")))){s.Set(@"windowRect",R.Member(s.Get(@"payload"),@"windowRect"));}else if(R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),0))){s.Set(@"windowRect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"payload"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"payload"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"payload"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"payload"),@"height"))})));}
s.Set(@"surface",R.Member(s.Get(@"payload"),@"surface"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"surface")))){s.Set(@"surface",R.Cast(@"ordered",R.Map(new object[]{@"kind",@"screen",@"x",R.Cast(@"int",R.Member(s.Get(@"payload"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"payload"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"payload"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"payload"),@"height"))})));}
s.Set(@"crop",R.Member(s.Get(@"payload"),@"cropRectSurface"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"crop")))){s.Set(@"crop",R.Cast(@"ordered",R.Map(new object[]{@"x",0,@"y",0,@"width",R.Cast(@"int",R.Member(s.Get(@"surface"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"surface"),@"height"))})));}
s.Set(@"encWidth",R.Cast(@"int",R.Member(s.Get(@"payload"),@"encodedWidth")));
s.Set(@"encHeight",R.Cast(@"int",R.Member(s.Get(@"payload"),@"encodedHeight")));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"encWidth"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"encHeight"),0))))){s.Set(@"eff",1d);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"effectiveScale")))){s.Set(@"eff",R.Cast(@"double",R.Member(s.Get(@"payload"),@"effectiveScale")));}
s.Set(@"encWidth",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",R.Cast(@"int",R.Member(s.Get(@"crop"),@"width")),s.Get(@"eff"))}))})));
s.Set(@"encHeight",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",R.Cast(@"int",R.Member(s.Get(@"crop"),@"height")),s.Get(@"eff"))}))})));}
s.Set(@"attached",R.Cast(@"ordered",R.Map(new object[]{@"width",R.Cast(@"int",R.Member(s.Get(@"payload"),@"attachedWidth")),@"height",R.Cast(@"int",R.Member(s.Get(@"payload"),@"attachedHeight")),@"transformKnown",s.Get(@"false"),@"reported",s.Get(@"false")})));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"attached"),@"width"),0)) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"attached"),@"height"),0))))){R.SetMember(s.Get(@"attached"),@"transformKnown",s.Get(@"true"));}
s.Set(@"record",R.Cast(@"ordered",R.Map(new object[]{@"id",s.Get(@"id"),@"schemaVersion",2,@"hwnd",s.Get(@"hwnd"),@"pid",s.Get(@"ownerPid"),@"windowRect",s.Get(@"windowRect"),@"surface",s.Get(@"surface"),@"crop",s.Get(@"crop"),@"encoded",R.Cast(@"ordered",R.Map(new object[]{@"width",s.Get(@"encWidth"),@"height",s.Get(@"encHeight")})),@"attached",s.Get(@"attached"),@"requestedScale",R.Capture((o255) => {if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"requestedScale")))){R.Emit(o255,R.Cast(@"double",R.Member(s.Get(@"payload"),@"requestedScale")));}else{R.Emit(o255,1d);}}),@"effectiveScale",R.Capture((o256) => {if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"effectiveScale")))){R.Emit(o256,R.Cast(@"double",R.Member(s.Get(@"payload"),@"effectiveScale")));}else{R.Emit(o256,1d);}}),@"source",(""+R.Str(R.Capture((o257) => {R.Emit(o257,R.Member(s.Get(@"payload"),@"source"));}))),@"surfaceKind",(""+R.Str(R.Capture((o258) => {R.Emit(o258,R.Member(s.Get(@"surface"),@"kind"));}))),@"epoch",R.Cast(@"int64",s.Get(@"script:ObservationEpoch")),@"writeSeq",R.Cast(@"int64",s.Get(@"script:WriteSeq")),@"specKey",(""+R.Str(R.Capture((o259) => {R.Emit(o259,R.Member(s.Get(@"payload"),@"specKey"));}))),@"seq",R.Cast(@"int",s.Get(@"script:FrameSeq")),@"dpi",R.Cast(@"int",s.Get(@"dpi")),@"processStart",R.Cast(@"int64",s.Get(@"procStart")),@"rootHwnd",R.Cast(@"int64",s.Get(@"rootHwnd")),@"surfaceDigest",(""+R.Str(R.Capture((o260) => {R.Emit(o260,R.Member(s.Get(@"payload"),@"surfaceDigest"));}))),@"captureStartedMonoMs",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),@"captureCompletedMonoMs",R.Cast(@"int64",0),@"width",R.Cast(@"int",R.Member(s.Get(@"payload"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"payload"),@"height")),@"x",R.Cast(@"int",R.Member(s.Get(@"payload"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"payload"),@"y")),@"imageWidth",s.Get(@"encWidth"),@"imageHeight",s.Get(@"encHeight"),@"scale",R.Capture((o261) => {if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"effectiveScale")))){R.Emit(o261,R.Cast(@"double",R.Member(s.Get(@"payload"),@"effectiveScale")));}else{R.Emit(o261,1d);}}),@"vx",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"x")),@"vy",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"y")),@"vwidth",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"width")),@"vheight",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"height"))})));
R.SetIndex(s.Get(@"script:FrameRegistry"),s.Get(@"id"),s.Get(@"record"));
s.Set(@"floor",R.Binary(s,@"Minus",s.Get(@"script:FrameSeq"),s.Get(@"script:FrameKeep")));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"floor"),0))){foreach(var item262 in R.Array(R.Array(R.Capture((o263) => {R.Emit(o263,R.Member(s.Get(@"script:FrameRegistry"),@"Keys"));})))){s.Set(@"key",item262);try{s.Set(@"entry",R.Index(s.Get(@"script:FrameRegistry"),s.Get(@"key")));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"entry"))) && R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Member(s.Get(@"entry"),@"seq")),s.Get(@"floor")))))){R.Emit(o,R.Invoke(s.Get(@"script:FrameRegistry"),@"Remove",new object[]{s.Get(@"key")}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
throw new ReturnFlow(s.Get(@"id"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Set_FrameCompleted_264(Scope s,Args a){var o=new List<object>();s.Set(@"frameId",R.Bind(a,0,@"frameId",()=>null,@"string"));
try{s.Set(@"frame",R.Index(s.Get(@"script:FrameRegistry"),s.Get(@"frameId")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"frame")))){throw new ReturnFlow(null);}
R.SetIndex(s.Get(@"frame"),@"captureCompletedMonoMs",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_FrameContentUnchanged_265(Scope s,Args a){var o=new List<object>();s.Set(@"frame",R.Bind(a,0,@"frame",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ile",s.Get(@"script:FrameVerifyAfterMs"),0))){throw new ReturnFlow(R.Map(new object[]{@"checked",s.Get(@"false"),@"changed",s.Get(@"false")}));}
s.Set(@"stored",(""+R.Str(R.Capture((o266) => {R.Emit(o266,R.Member(s.Get(@"frame"),@"surfaceDigest"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"stored"),@""))){throw new ReturnFlow(R.Map(new object[]{@"checked",s.Get(@"false"),@"changed",s.Get(@"false")}));}
s.Set(@"ageMs",R.Cast(@"int64",0));
if(R.Bool(R.Binary(s,@"Igt",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"captureCompletedMonoMs")),0))){s.Set(@"ageMs",R.Binary(s,@"Minus",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),R.Cast(@"int64",R.Member(s.Get(@"frame"),@"captureCompletedMonoMs"))));}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"frame"),@"frameAgeMs"))) && R.Bool(R.Binary(s,@"Igt",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"frameAgeMs")),0))))){s.Set(@"ageMs",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"frameAgeMs")));}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"ageMs"),R.Cast(@"int64",s.Get(@"script:FrameVerifyAfterMs"))))){throw new ReturnFlow(R.Map(new object[]{@"checked",s.Get(@"false"),@"changed",s.Get(@"false"),@"ageMs",s.Get(@"ageMs")}));}
s.Set(@"live",@"");
try{if(R.Bool((R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd")),0)) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o267) => {R.Emit(o267,R.Member(s.Get(@"frame"),@"source"));}))),@"window"))))){s.Set(@"live",R.Call(s,@"Get-WindowDigest",new Args(new object[]{R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd"))),320}),null));}else{s.Set(@"surface",R.Member(s.Get(@"frame"),@"surface"));
s.Set(@"live",R.Call(s,@"Get-RegionDigest",new Args(new object[]{R.Cast(@"int",R.Member(s.Get(@"surface"),@"x")),R.Cast(@"int",R.Member(s.Get(@"surface"),@"y")),R.Cast(@"int",R.Member(s.Get(@"surface"),@"width")),R.Cast(@"int",R.Member(s.Get(@"surface"),@"height")),320}),null));}}catch(Exception error268) when (!(error268 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error268}));s.Set(@"live",@"");}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"live"),@""))){throw new ReturnFlow(R.Map(new object[]{@"checked",s.Get(@"false"),@"changed",s.Get(@"false"),@"ageMs",s.Get(@"ageMs"),@"note",@"the surface could not be read again, so nothing was compared"}));}
throw new ReturnFlow(R.Map(new object[]{@"checked",s.Get(@"true"),@"changed",R.Binary(s,@"Ine",s.Get(@"live"),s.Get(@"stored")),@"ageMs",s.Get(@"ageMs")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_LandingWindow_269(Scope s,Args a){var o=new List<object>();s.Set(@"x",R.Bind(a,0,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,1,@"y",()=>null,@"int"));
try{s.Set(@"pt",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
R.SetMember(s.Get(@"pt"),@"X",s.Get(@"x"));
R.SetMember(s.Get(@"pt"),@"Y",s.Get(@"y"));
s.Set(@"hit",R.Member(R.Type(@"IntPtr"),@"Zero"));
try{s.Set(@"hit",R.Invoke(R.Type(@"DshNative"),@"WindowFromPoint",new object[]{s.Get(@"pt")}));}catch(Exception error270) when (!(error270 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error270}));s.Set(@"hit",R.Member(R.Type(@"IntPtr"),@"Zero"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hit"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"procId",0);
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetWindowThreadProcessId",new object[]{s.Get(@"hit"),new Ref(()=>s.Get(@"procId"),v=>{s.Set(@"procId",v);})})));
s.Set(@"root",R.Member(R.Type(@"IntPtr"),@"Zero"));
try{s.Set(@"root",R.Invoke(R.Type(@"DshNative"),@"GetAncestor",new object[]{s.Get(@"hit"),R.Member(R.Type(@"DshNative"),@"GA_ROOT")}));}catch(Exception error271) when (!(error271 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error271}));s.Set(@"root",s.Get(@"hit"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"root"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"root",s.Get(@"hit"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"hit")),@"root",R.Cast(@"int64",s.Get(@"root")),@"pid",R.Cast(@"int",s.Get(@"procId"))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WindowRootHwnd_272(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),0))){throw new ReturnFlow(0);}
s.Set(@"root",R.Member(R.Type(@"IntPtr"),@"Zero"));
try{s.Set(@"root",R.Invoke(R.Type(@"DshNative"),@"GetAncestor",new object[]{R.Cast(@"IntPtr",s.Get(@"hwnd")),R.Member(R.Type(@"DshNative"),@"GA_ROOT")}));}catch(Exception error273) when (!(error273 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error273}));s.Set(@"root",R.Member(R.Type(@"IntPtr"),@"Zero"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"root"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new ReturnFlow(s.Get(@"hwnd"));}
throw new ReturnFlow(R.Cast(@"int64",s.Get(@"root")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WindowOwnerHwnd_274(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),0))){throw new ReturnFlow(0);}
try{s.Set(@"owner",R.Invoke(R.Type(@"DshNative"),@"GetWindow",new object[]{R.Cast(@"IntPtr",s.Get(@"hwnd")),R.Member(R.Type(@"DshNative"),@"GW_OWNER")}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"owner"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new ReturnFlow(0);}
throw new ReturnFlow(R.Cast(@"int64",s.Get(@"owner")));}catch(Exception error275) when (!(error275 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error275}));throw new ReturnFlow(0);}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ProcessStartTicks_276(Scope s,Args a){var o=new List<object>();s.Set(@"procId",R.Bind(a,0,@"procId",()=>null,@"int"));
try{if(R.Bool(R.Binary(s,@"Ile",s.Get(@"procId"),0))){throw new ReturnFlow(R.Cast(@"int64",0));}
try{s.Set(@"proc",R.Call(s,@"Get-Process",new Args(new object[]{new Named(@"Id",R.Switch),s.Get(@"procId"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));
throw new ReturnFlow(R.Cast(@"int64",R.Member(R.Member(s.Get(@"proc"),@"StartTime"),@"Ticks")));}catch(Exception error277) when (!(error277 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error277}));throw new ReturnFlow(R.Cast(@"int64",0));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WindowDpi_278(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
try{try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),0))){throw new ReturnFlow(R.Cast(@"int",R.Invoke(R.Type(@"DshNative"),@"DpiForWindowOrZero",new object[]{R.Cast(@"IntPtr",s.Get(@"hwnd"))})));}
throw new ReturnFlow(R.Cast(@"int",R.Invoke(R.Type(@"DshNative"),@"SystemDpiOrZero",new object[]{})));}catch(Exception error279) when (!(error279 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error279}));throw new ReturnFlow(0);}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_LandingGuard_280(Scope s,Args a){var o=new List<object>();s.Set(@"targetHwnd",R.Bind(a,0,@"targetHwnd",()=>null,@"int64"));
s.Set(@"targetPid",R.Bind(a,1,@"targetPid",()=>null,@"int"));
s.Set(@"x",R.Bind(a,2,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,3,@"y",()=>null,@"int"));
s.Set(@"allowWindows",R.Bind(a,4,@"allowWindows",()=>s.Get(@"null"),@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"targetHwnd"),0))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"how",@"no-target",@"note",@"this frame has no window identity (a screen capture), so the landing point was not compared against a target"})));}
s.Set(@"hit",R.Call(s,@"Get-LandingWindow",new Args(new object[]{s.Get(@"x"),s.Get(@"y")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"hit")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"how",@"unavailable",@"note",(""+@"nothing could be read under ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@"), so the landing point was not verified")})));}
s.Set(@"targetRoot",R.Call(s,@"Get-WindowRootHwnd",new Args(new object[]{s.Get(@"targetHwnd")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",R.Member(s.Get(@"hit"),@"root")),s.Get(@"targetRoot"))) || R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",R.Member(s.Get(@"hit"),@"hwnd")),s.Get(@"targetHwnd")))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"how",@"root",@"hit",s.Get(@"hit")})));}
s.Set(@"allowed",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"allowWindows")))){foreach(var item281 in R.Array(R.Array(R.Capture((o282) => {R.Emit(o282,s.Get(@"allowWindows"));})))){s.Set(@"candidate",item281);try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",s.Get(@"candidate")),R.Cast(@"int64",R.Member(s.Get(@"hit"),@"hwnd")))) || R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",s.Get(@"candidate")),R.Cast(@"int64",R.Member(s.Get(@"hit"),@"root"))))))){s.Set(@"allowed",s.Get(@"true"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(s.Get(@"allowed"))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"how",@"allowed-transition",@"hit",s.Get(@"hit"),@"note",(""+@"hwnd "+R.Str(R.Capture((o283) => {R.Emit(o283,R.Member(s.Get(@"hit"),@"hwnd"));}))+@" is in this call's expected window transitions, so the point was allowed")})));}
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"targetPid"),0)) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Member(s.Get(@"hit"),@"pid")),s.Get(@"targetPid")))))){s.Set(@"owner",R.Call(s,@"Get-WindowOwnerHwnd",new Args(new object[]{R.Cast(@"int64",R.Member(s.Get(@"hit"),@"hwnd"))}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"owner"),0)) && R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"owner"),s.Get(@"targetHwnd"))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"owner"),s.Get(@"targetRoot"))))) || R.Bool(R.Binary(s,@"Ieq",R.Call(s,@"Get-WindowRootHwnd",new Args(new object[]{s.Get(@"owner")}),null),s.Get(@"targetRoot")))))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"how",@"owned-by-target",@"hit",s.Get(@"hit"),@"note",(""+@"the window under ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") is hwnd "+R.Str(R.Capture((o284) => {R.Emit(o284,R.Member(s.Get(@"hit"),@"hwnd"));}))+@", owned by the target window "+R.Str(s.Get(@"targetHwnd"))+@" -- a dialog or popup that belongs to it")})));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"how",@"same-process-other-window",@"hit",s.Get(@"hit"),@"reason",(""+@"[TARGET_OCCLUDED] ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") is over hwnd "+R.Str(R.Capture((o285) => {R.Emit(o285,R.Member(s.Get(@"hit"),@"hwnd"));}))+@" (root "+R.Str(R.Capture((o286) => {R.Emit(o286,R.Member(s.Get(@"hit"),@"root"));}))+@"), a different window of the *same* process (pid "+R.Str(s.Get(@"targetPid"))+@") as the target hwnd "+R.Str(s.Get(@"targetHwnd"))+@", and it is not a window owned by the target. A shared pid does not make it the same window, so nothing was sent. Bring the target forward, aim the action at a control instead, capture that window's own frame and act on it, or name hwnd "+R.Str(R.Capture((o287) => {R.Emit(o287,R.Member(s.Get(@"hit"),@"hwnd"));}))+@" in allow_windows when this window is the transition you expect. (action_sent=false, recovery=computer_screenshot, auto_reresolve=false)")})));}
s.Set(@"uia",s.Get(@"null"));
try{s.Set(@"uia",R.Call(s,@"Get-HitIdentity",new Args(new object[]{s.Get(@"x"),s.Get(@"y")}),null));}catch(Exception error288) when (!(error288 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error288}));s.Set(@"uia",s.Get(@"null"));}
s.Set(@"uiaHwnd",R.Cast(@"int64",0));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"uia")))){s.Set(@"uiaHwnd",R.Cast(@"int64",R.Member(s.Get(@"uia"),@"hwnd")));}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"uiaHwnd"),0)) && R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"uiaHwnd"),s.Get(@"targetHwnd"))) || R.Bool(R.Binary(s,@"Ieq",R.Call(s,@"Get-WindowRootHwnd",new Args(new object[]{s.Get(@"uiaHwnd")}),null),s.Get(@"targetRoot"))))))) && R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"targetPid"),0)) || R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Member(s.Get(@"uia"),@"pid")),s.Get(@"targetPid")))))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"how",@"uia-agrees",@"hit",s.Get(@"hit"),@"note",(""+@"WindowFromPoint named pid "+R.Str(R.Capture((o289) => {R.Emit(o289,R.Member(s.Get(@"hit"),@"pid"));}))+@" under ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@"), but the element there belongs to the target window ("+R.Str(s.Get(@"uiaHwnd"))+@", pid "+R.Str(R.Capture((o290) => {R.Emit(o290,R.Member(s.Get(@"uia"),@"pid"));}))+@"); the accessibility answer was taken as the deciding one")})));}
s.Set(@"who",@"");
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"uia"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o291) => {R.Emit(o291,R.Member(s.Get(@"uia"),@"name"));}))),@""))))){s.Set(@"who",(""+@" ('"+R.Str(R.Capture((o292) => {R.Emit(o292,R.Member(s.Get(@"uia"),@"name"));}))+@"' "+R.Str(R.Capture((o293) => {R.Emit(o293,R.Member(s.Get(@"uia"),@"controlType"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(s.Get(@"uia"),@"pid")),0)) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"uia"),@"pid")),R.Cast(@"int",R.Member(s.Get(@"hit"),@"pid"))))))){s.Set(@"who",(""+R.Str(s.Get(@"who"))+@" in pid "+R.Str(R.Capture((o294) => {R.Emit(o294,R.Member(s.Get(@"uia"),@"pid"));}))));}
s.Set(@"who",(""+R.Str(s.Get(@"who"))+@")"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"how",@"occluded",@"hit",s.Get(@"hit"),@"reason",(""+@"[TARGET_OCCLUDED] ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") is over hwnd "+R.Str(R.Capture((o295) => {R.Emit(o295,R.Member(s.Get(@"hit"),@"hwnd"));}))+R.Str(s.Get(@"who"))+@" -- pid "+R.Str(R.Capture((o296) => {R.Emit(o296,R.Member(s.Get(@"hit"),@"pid"));}))+@", while the target is hwnd "+R.Str(s.Get(@"targetHwnd"))+@" (pid "+R.Str(s.Get(@"targetPid"))+@"). A coordinate sent there would go to that other window, so nothing was sent. Observe what is on screen (computer_screenshot or computer_windows), bring the target forward, or aim the action at a control instead. (action_sent=false, recovery=computer_screenshot, auto_reresolve=false)")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_FrameTransform_297(Scope s,Args a){var o=new List<object>();s.Set(@"frame",R.Bind(a,0,@"frame",()=>null,@"object"));
s.Set(@"ax",R.Bind(a,1,@"ax",()=>null,@"double"));
s.Set(@"ay",R.Bind(a,2,@"ay",()=>null,@"double"));
try{s.Set(@"ex",s.Get(@"ax"));
s.Set(@"ey",s.Get(@"ay"));
s.Set(@"mapping",@"encoded-1:1");
s.Set(@"note",@"");
s.Set(@"attached",R.Member(s.Get(@"frame"),@"attached"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"attached"))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"attached"),@"reported"),s.Get(@"true")))))){s.Set(@"aw",R.Cast(@"int",R.Member(s.Get(@"attached"),@"width")));
s.Set(@"ah",R.Cast(@"int",R.Member(s.Get(@"attached"),@"height")));
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"attached"),@"transformKnown"),s.Get(@"true"))) || R.Bool(R.Binary(s,@"Ile",s.Get(@"aw"),0)))) || R.Bool(R.Binary(s,@"Ile",s.Get(@"ah"),0))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[COORDINATE_MAPPING_UNKNOWN] the image the host delivered for frame "+R.Str(R.Capture((o298) => {R.Emit(o298,R.Member(s.Get(@"frame"),@"id"));}))+@" has an unknown transform (the attachment layer did not report its size), so a point in that image cannot be mapped to the screen. Take a new capture of what you need, or act on a control instead of a coordinate. (action_sent=false, recovery=computer_screenshot)")}));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"aw"),R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"ah"),R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height"))))))){s.Set(@"plausible",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"aw"),R.Binary(s,@"Plus",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")),2))) && R.Bool(R.Binary(s,@"Ile",s.Get(@"ah"),R.Binary(s,@"Plus",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")),2))))) && R.Bool(R.Binary(s,@"Ige",R.Binary(s,@"Divide",s.Get(@"aw"),R.Cast(@"double",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width"))),0.05d)))) && R.Bool(R.Binary(s,@"Ige",R.Binary(s,@"Divide",s.Get(@"ah"),R.Cast(@"double",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height"))),0.05d))));
if(R.Bool(s.Get(@"plausible"))){s.Set(@"ex",R.Binary(s,@"Multiply",s.Get(@"ax"),R.Binary(s,@"Divide",R.Cast(@"double",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")),R.Cast(@"double",s.Get(@"aw")))));
s.Set(@"ey",R.Binary(s,@"Multiply",s.Get(@"ay"),R.Binary(s,@"Divide",R.Cast(@"double",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")),R.Cast(@"double",s.Get(@"ah")))));
s.Set(@"mapping",(""+@"attached-rescaled("+R.Str(s.Get(@"aw"))+@"x"+R.Str(s.Get(@"ah"))+@"->"+R.Str(R.Capture((o299) => {R.Emit(o299,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")));}))+@"x"+R.Str(R.Capture((o300) => {R.Emit(o300,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")));}))+@")"));}else{s.Set(@"mapping",(""+@"attached-ignored("+R.Str(s.Get(@"aw"))+@"x"+R.Str(s.Get(@"ah"))+@" for a "+R.Str(R.Capture((o301) => {R.Emit(o301,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")));}))+@"x"+R.Str(R.Capture((o302) => {R.Emit(o302,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")));}))+@" frame)"));
s.Set(@"note",(""+@"the attachment layer reported a "+R.Str(s.Get(@"aw"))+@"x"+R.Str(s.Get(@"ah"))+@" image for a "+R.Str(R.Capture((o303) => {R.Emit(o303,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")));}))+@"x"+R.Str(R.Capture((o304) => {R.Emit(o304,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")));}))+@" frame, which is not a rescale of this capture, so it was ignored and the projection stayed 1:1"));}}}
s.Set(@"crop",R.Member(s.Get(@"frame"),@"crop"));
s.Set(@"encodedWidth",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")));
s.Set(@"encodedHeight",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"encodedWidth"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"encodedHeight"),0))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[COORDINATE_MAPPING_UNKNOWN] frame "+R.Str(R.Capture((o305) => {R.Emit(o305,R.Member(s.Get(@"frame"),@"id"));}))+@" records an image of "+R.Str(s.Get(@"encodedWidth"))+@" x "+R.Str(s.Get(@"encodedHeight"))+@" pixels, which is not a size anything can be mapped from. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}
s.Set(@"ratioX",R.Binary(s,@"Divide",R.Cast(@"double",R.Member(s.Get(@"crop"),@"width")),R.Cast(@"double",s.Get(@"encodedWidth"))));
s.Set(@"ratioY",R.Binary(s,@"Divide",R.Cast(@"double",R.Member(s.Get(@"crop"),@"height")),R.Cast(@"double",s.Get(@"encodedHeight"))));
s.Set(@"sx",R.Binary(s,@"Plus",R.Cast(@"double",R.Member(s.Get(@"crop"),@"x")),R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",s.Get(@"ex"),s.Get(@"ratioX")),R.Member(R.Type(@"System.MidpointRounding"),@"AwayFromZero")})));
s.Set(@"sy",R.Binary(s,@"Plus",R.Cast(@"double",R.Member(s.Get(@"crop"),@"y")),R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Multiply",s.Get(@"ey"),s.Get(@"ratioY")),R.Member(R.Type(@"System.MidpointRounding"),@"AwayFromZero")})));
s.Set(@"surface",R.Member(s.Get(@"frame"),@"surface"));
s.Set(@"dx",R.Binary(s,@"Plus",R.Cast(@"double",R.Member(s.Get(@"surface"),@"x")),s.Get(@"sx")));
s.Set(@"dy",R.Binary(s,@"Plus",R.Cast(@"double",R.Member(s.Get(@"surface"),@"y")),s.Get(@"sy")));
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"desktopX",R.Cast(@"double",s.Get(@"dx")),@"desktopY",R.Cast(@"double",s.Get(@"dy")),@"surfaceX",R.Cast(@"double",s.Get(@"sx")),@"surfaceY",R.Cast(@"double",s.Get(@"sy")),@"mapping",s.Get(@"mapping"),@"note",s.Get(@"note")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Assert_FrameContentFresh_306(Scope s,Args a){var o=new List<object>();s.Set(@"frame",R.Bind(a,0,@"frame",()=>null,@"object"));
s.Set(@"verify",R.Bind(a,1,@"verify",()=>null,@"bool"));
try{if(R.Bool(R.Unary(@"Not",s.Get(@"verify")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"content",R.Call(s,@"Test-FrameContentUnchanged",new Args(new object[]{s.Get(@"frame")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"content"),@"checked"),s.Get(@"true"))) || R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"content"),@"changed"),s.Get(@"true")))))){throw new ReturnFlow(s.Get(@"null"));}
throw new ReturnFlow((""+@"[FRAME_CONTENT_CHANGED] frame "+R.Str(R.Capture((o307) => {R.Emit(o307,R.Member(s.Get(@"frame"),@"id"));}))+@" was taken "+R.Str(R.Capture((o308) => {R.Emit(o308,R.Member(s.Get(@"content"),@"ageMs"));}))+@" ms ago and the surface it came from does not look the same any more: its rectangle is unchanged but the pixels are not, which is what a scroll, a refresh or a navigation looks like. A coordinate from that image would land on whatever is there now. Take a new capture and read the panel again, act on a control by ref (a ref is re-resolved before it is used), or pass verify_content: false when this surface is simply animated. (action_sent=false, recovery=computer_screenshot)"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_FrameLive_309(Scope s,Args a){var o=new List<object>();s.Set(@"frameId",R.Bind(a,0,@"frameId",()=>null,@"string"));
s.Set(@"Options",R.Bind(a,1,@"Options",()=>s.Get(@"null"),@"object"));
try{s.Set(@"frame",R.Index(s.Get(@"script:FrameRegistry"),s.Get(@"frameId")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"frame")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[EXPIRED_FRAME] frame '"+R.Str(s.Get(@"frameId"))+@"' is not in this worker's registry: it was taken before the worker restarted, or it has been retired. Take a new capture. (action_sent=false, element_lookup=n/a, recovery=computer_screenshot, auto_reresolve=false)")}));}
s.Set(@"verifyContent",s.Get(@"true"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Options"))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Options"),@"verifyContent"),s.Get(@"false")))))){s.Set(@"verifyContent",s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd")),0))){s.Set(@"vb",R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null));
if(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"vb"),@"x"),R.Cast(@"int",R.Member(s.Get(@"frame"),@"vx")))) || R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"vb"),@"y"),R.Cast(@"int",R.Member(s.Get(@"frame"),@"vy")))))) || R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"vb"),@"width"),R.Cast(@"int",R.Member(s.Get(@"frame"),@"vwidth")))))) || R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"vb"),@"height"),R.Cast(@"int",R.Member(s.Get(@"frame"),@"vheight"))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[DISPLAY_TOPOLOGY_CHANGED] the display layout changed since frame "+R.Str(s.Get(@"frameId"))+@" was taken: the virtual desktop was ("+R.Str(R.Capture((o310) => {R.Emit(o310,R.Member(s.Get(@"frame"),@"vx"));}))+@","+R.Str(R.Capture((o311) => {R.Emit(o311,R.Member(s.Get(@"frame"),@"vy"));}))+@") "+R.Str(R.Capture((o312) => {R.Emit(o312,R.Member(s.Get(@"frame"),@"vwidth"));}))+@"x"+R.Str(R.Capture((o313) => {R.Emit(o313,R.Member(s.Get(@"frame"),@"vheight"));}))+@" then and is ("+R.Str(R.Capture((o314) => {R.Emit(o314,R.Member(s.Get(@"vb"),@"x"));}))+@","+R.Str(R.Capture((o315) => {R.Emit(o315,R.Member(s.Get(@"vb"),@"y"));}))+@") "+R.Str(R.Capture((o316) => {R.Emit(o316,R.Member(s.Get(@"vb"),@"width"));}))+@"x"+R.Str(R.Capture((o317) => {R.Emit(o317,R.Member(s.Get(@"vb"),@"height"));}))+@" now, so this frame's pixels no longer map to those screen coordinates. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}
if(R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(s.Get(@"frame"),@"dpi")),0))){s.Set(@"liveDpi",R.Call(s,@"Get-WindowDpi",new Args(new object[]{0}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"liveDpi"),0)) && R.Bool(R.Binary(s,@"Ine",s.Get(@"liveDpi"),R.Cast(@"int",R.Member(s.Get(@"frame"),@"dpi"))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[DPI_CHANGED] the system is at "+R.Str(s.Get(@"liveDpi"))+@" dpi now and was at "+R.Str(R.Capture((o318) => {R.Emit(o318,R.Cast(@"int",R.Member(s.Get(@"frame"),@"dpi")));}))+@" dpi when frame "+R.Str(s.Get(@"frameId"))+@" was taken, so this frame's pixels map to a different scale. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}}
s.Set(@"stale",R.Call(s,@"Assert-FrameContentFresh",new Args(new object[]{s.Get(@"frame"),s.Get(@"verifyContent")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"stale")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",s.Get(@"stale")}));}
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"frame",s.Get(@"frame"),@"screen",s.Get(@"true"),@"rect",s.Get(@"null"),@"windowRect",s.Get(@"null"),@"drift",0}));}
s.Set(@"hwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd"))));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindow",new object[]{s.Get(@"hwnd")})))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[EXPIRED_FRAME] the window frame "+R.Str(s.Get(@"frameId"))+@" was taken from (hwnd "+R.Str(R.Capture((o319) => {R.Emit(o319,R.Member(s.Get(@"frame"),@"hwnd"));}))+@") is gone. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}
s.Set(@"live",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"hwnd")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(s.Get(@"frame"),@"pid")),0)) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"live"),@"pid")),R.Cast(@"int",R.Member(s.Get(@"frame"),@"pid"))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[TARGET_CHANGED] hwnd "+R.Str(R.Capture((o320) => {R.Emit(o320,R.Member(s.Get(@"frame"),@"hwnd"));}))+@" belonged to pid "+R.Str(R.Capture((o321) => {R.Emit(o321,R.Member(s.Get(@"frame"),@"pid"));}))+@" when frame "+R.Str(s.Get(@"frameId"))+@" was taken and belongs to pid "+R.Str(R.Capture((o322) => {R.Emit(o322,R.Member(s.Get(@"live"),@"pid"));}))+@" now -- the handle was reused. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}
if(R.Bool(R.Binary(s,@"Igt",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"processStart")),0))){s.Set(@"liveStart",R.Call(s,@"Get-ProcessStartTicks",new Args(new object[]{R.Cast(@"int",R.Member(s.Get(@"frame"),@"pid"))}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"liveStart"),0)) && R.Bool(R.Binary(s,@"Ine",s.Get(@"liveStart"),R.Cast(@"int64",R.Member(s.Get(@"frame"),@"processStart"))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[TARGET_CHANGED] hwnd "+R.Str(R.Capture((o323) => {R.Emit(o323,R.Member(s.Get(@"frame"),@"hwnd"));}))+@" still reports pid "+R.Str(R.Capture((o324) => {R.Emit(o324,R.Member(s.Get(@"frame"),@"pid"));}))+@", but that pid now belongs to a different process (it started at another time than the one frame "+R.Str(s.Get(@"frameId"))+@" was taken from), so the handle was recycled. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}}
if(R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(s.Get(@"frame"),@"dpi")),0))){s.Set(@"liveDpi",R.Call(s,@"Get-WindowDpi",new Args(new object[]{R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd"))}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"liveDpi"),0)) && R.Bool(R.Binary(s,@"Ine",s.Get(@"liveDpi"),R.Cast(@"int",R.Member(s.Get(@"frame"),@"dpi"))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[DPI_CHANGED] hwnd "+R.Str(R.Capture((o325) => {R.Emit(o325,R.Member(s.Get(@"frame"),@"hwnd"));}))+@" is being rendered at "+R.Str(s.Get(@"liveDpi"))+@" dpi now and was at "+R.Str(R.Capture((o326) => {R.Emit(o326,R.Cast(@"int",R.Member(s.Get(@"frame"),@"dpi")));}))+@" dpi when frame "+R.Str(s.Get(@"frameId"))+@" was taken, so the pixels in that image sit at a different scale even though the window's rectangle is unchanged (this is what dragging a window onto a monitor with another scale factor looks like). Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}}
s.Set(@"rect",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{s.Get(@"hwnd")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"rect")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[EXPIRED_FRAME] hwnd "+R.Str(R.Capture((o327) => {R.Emit(o327,R.Member(s.Get(@"frame"),@"hwnd"));}))+@" has no usable rectangle any more, so frame "+R.Str(s.Get(@"frameId"))+@" cannot be projected. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}
s.Set(@"frameRect",R.Member(s.Get(@"frame"),@"windowRect"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"frameRect")))){s.Set(@"frameRect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"frame"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"frame"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"frame"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"frame"),@"height"))})));}
s.Set(@"drift",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Max",new object[]{R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"rect"),@"x")),R.Cast(@"int",R.Member(s.Get(@"frameRect"),@"x")))}),R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"rect"),@"y")),R.Cast(@"int",R.Member(s.Get(@"frameRect"),@"y")))})})));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"rect"),@"width")),R.Cast(@"int",R.Member(s.Get(@"frameRect"),@"width")))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"rect"),@"height")),R.Cast(@"int",R.Member(s.Get(@"frameRect"),@"height"))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[FRAME_STALE] the window was resized since frame "+R.Str(s.Get(@"frameId"))+@" was taken ("+R.Str(R.Capture((o328) => {R.Emit(o328,R.Member(s.Get(@"frameRect"),@"width"));}))+@"x"+R.Str(R.Capture((o329) => {R.Emit(o329,R.Member(s.Get(@"frameRect"),@"height"));}))+@" then, "+R.Str(R.Capture((o330) => {R.Emit(o330,R.Member(s.Get(@"rect"),@"width"));}))+@"x"+R.Str(R.Capture((o331) => {R.Emit(o331,R.Member(s.Get(@"rect"),@"height"));}))+@" now), so the pixels in that image no longer sit where they did. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}
s.Set(@"stale",R.Call(s,@"Assert-FrameContentFresh",new Args(new object[]{s.Get(@"frame"),s.Get(@"verifyContent")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"stale")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",s.Get(@"stale")}));}
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"frame",s.Get(@"frame"),@"screen",s.Get(@"false"),@"rect",s.Get(@"rect"),@"windowRect",s.Get(@"frameRect"),@"drift",s.Get(@"drift")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Resolve_FramePoint_332(Scope s,Args a){var o=new List<object>();s.Set(@"frameId",R.Bind(a,0,@"frameId",()=>null,@"string"));
s.Set(@"px",R.Bind(a,1,@"px",()=>null,@"int"));
s.Set(@"py",R.Bind(a,2,@"py",()=>null,@"int"));
s.Set(@"Options",R.Bind(a,3,@"Options",()=>s.Get(@"null"),@"object"));
try{s.Set(@"frame",R.Index(s.Get(@"script:FrameRegistry"),s.Get(@"frameId")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"frame")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[EXPIRED_FRAME] frame '"+R.Str(s.Get(@"frameId"))+@"' is not in this worker's registry: it was taken before the worker restarted, or it has been retired. Take a new capture. (action_sent=false, element_lookup=n/a, recovery=computer_screenshot, auto_reresolve=false)")}));}
s.Set(@"boundW",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")));
s.Set(@"boundH",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"frame"),@"attached"))) && R.Bool(R.Binary(s,@"Ieq",R.Member(R.Member(s.Get(@"frame"),@"attached"),@"reported"),s.Get(@"true")))))){if(R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"attached"),@"width")),0))){s.Set(@"boundW",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"attached"),@"width")));}
if(R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"attached"),@"height")),0))){s.Set(@"boundH",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"attached"),@"height")));}}
s.Set(@"allowWindows",s.Get(@"null"));
s.Set(@"allowActivate",s.Get(@"false"));
s.Set(@"verifyContent",s.Get(@"true"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Options")))){if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Options"),@"allowWindows")))){s.Set(@"allowWindows",R.Member(s.Get(@"Options"),@"allowWindows"));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Options"),@"allowActivate"),s.Get(@"true")))){s.Set(@"allowActivate",s.Get(@"true"));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Options"),@"verifyContent"),s.Get(@"false")))){s.Set(@"verifyContent",s.Get(@"false"));}}
if(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"px"),0)) || R.Bool(R.Binary(s,@"Ilt",s.Get(@"py"),0)))) || R.Bool(R.Binary(s,@"Ige",s.Get(@"px"),s.Get(@"boundW"))))) || R.Bool(R.Binary(s,@"Ige",s.Get(@"py"),s.Get(@"boundH")))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[BAD_REQUEST] ("+R.Str(s.Get(@"px"))+@","+R.Str(s.Get(@"py"))+@") is outside frame "+R.Str(s.Get(@"frameId"))+@", whose image is "+R.Str(s.Get(@"boundW"))+@"x"+R.Str(s.Get(@"boundH"))+@" px. Note the origin: this is a boundary coordinate in the image you were shown, not a screen coordinate. (action_sent=false)")}));}
s.Set(@"projected",R.Call(s,@"Get-FrameTransform",new Args(new object[]{s.Get(@"frame"),R.Cast(@"double",s.Get(@"px")),R.Cast(@"double",s.Get(@"py"))}),null));
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"projected"),@"ok"),s.Get(@"true")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+R.Str(R.Capture((o333) => {R.Emit(o333,R.Member(s.Get(@"projected"),@"error"));})))}));}
s.Set(@"x",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Floor",new object[]{R.Member(s.Get(@"projected"),@"desktopX")})));
s.Set(@"y",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Floor",new object[]{R.Member(s.Get(@"projected"),@"desktopY")})));
s.Set(@"mapping",(""+R.Str(R.Capture((o334) => {R.Emit(o334,R.Member(s.Get(@"projected"),@"mapping"));}))));
s.Set(@"drift",0);
s.Set(@"note",(""+R.Str(R.Capture((o335) => {R.Emit(o335,R.Member(s.Get(@"projected"),@"note"));}))));
s.Set(@"guard",s.Get(@"null"));
s.Set(@"live",R.Call(s,@"Test-FrameLive",new Args(new object[]{s.Get(@"frameId"),s.Get(@"Options")}),null));
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"live"),@"ok"),s.Get(@"true")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+R.Str(R.Capture((o336) => {R.Emit(o336,R.Member(s.Get(@"live"),@"error"));})))}));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"live"),@"screen"),s.Get(@"true")))){s.Set(@"guard",R.Call(s,@"Test-LandingGuard",new Args(new object[]{0,0,s.Get(@"x"),s.Get(@"y"),s.Get(@"null")}),null));
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"x",s.Get(@"x"),@"y",s.Get(@"y"),@"drift",0,@"note",s.Get(@"note"),@"guard",s.Get(@"guard"),@"mapping",s.Get(@"mapping"),@"activated",s.Get(@"false"),@"frame",s.Get(@"frame")}));}
s.Set(@"rect",R.Member(s.Get(@"live"),@"rect"));
s.Set(@"frameRect",R.Member(s.Get(@"live"),@"windowRect"));
s.Set(@"drift",R.Cast(@"int",R.Member(s.Get(@"live"),@"drift")));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"drift"),0))){s.Set(@"x",R.Binary(s,@"Plus",s.Get(@"x"),R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"rect"),@"x")),R.Cast(@"int",R.Member(s.Get(@"frameRect"),@"x")))));
s.Set(@"y",R.Binary(s,@"Plus",s.Get(@"y"),R.Binary(s,@"Minus",R.Cast(@"int",R.Member(s.Get(@"rect"),@"y")),R.Cast(@"int",R.Member(s.Get(@"frameRect"),@"y")))));
s.Set(@"note",(""+@"the window moved "+R.Str(s.Get(@"drift"))+@"px since this frame was taken; the point was re-projected to the window's new position"));}else if(R.Bool(R.Unary(@"Not",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ige",s.Get(@"x"),R.Member(s.Get(@"rect"),@"x"))) && R.Bool(R.Binary(s,@"Ilt",s.Get(@"x"),R.Binary(s,@"Plus",R.Member(s.Get(@"rect"),@"x"),R.Member(s.Get(@"rect"),@"width")))))) && R.Bool(R.Binary(s,@"Ige",s.Get(@"y"),R.Member(s.Get(@"rect"),@"y"))))) && R.Bool(R.Binary(s,@"Ilt",s.Get(@"y"),R.Binary(s,@"Plus",R.Member(s.Get(@"rect"),@"y"),R.Member(s.Get(@"rect"),@"height")))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[FRAME_STALE] ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") -- the projection of image point ("+R.Str(s.Get(@"px"))+@","+R.Str(s.Get(@"py"))+@") -- is not inside hwnd "+R.Str(R.Capture((o337) => {R.Emit(o337,R.Member(s.Get(@"frame"),@"hwnd"));}))+@" (now at "+R.Str(R.Capture((o338) => {R.Emit(o338,R.Member(s.Get(@"rect"),@"x"));}))+@","+R.Str(R.Capture((o339) => {R.Emit(o339,R.Member(s.Get(@"rect"),@"y"));}))+@" "+R.Str(R.Capture((o340) => {R.Emit(o340,R.Member(s.Get(@"rect"),@"width"));}))+@"x"+R.Str(R.Capture((o341) => {R.Emit(o341,R.Member(s.Get(@"rect"),@"height"));}))+@"), although the window has not moved. Take a new capture. (action_sent=false, recovery=computer_screenshot)")}));}
s.Set(@"guard",R.Call(s,@"Test-LandingGuard",new Args(new object[]{R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd")),R.Cast(@"int",R.Member(s.Get(@"frame"),@"pid")),s.Get(@"x"),s.Get(@"y"),s.Get(@"allowWindows")}),null));
s.Set(@"activated",s.Get(@"false"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"guard"),@"ok"),s.Get(@"true"))) && R.Bool(s.Get(@"allowActivate"))))){s.Set(@"brought",s.Get(@"false"));
try{s.Set(@"brought",R.Invoke(R.Type(@"DshNative"),@"ForceForeground",new object[]{R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd")))}));}catch(Exception error342) when (!(error342 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error342}));s.Set(@"brought",s.Get(@"false"));}
if(R.Bool(s.Get(@"brought"))){R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),120}),null));
s.Set(@"second",R.Call(s,@"Test-LandingGuard",new Args(new object[]{R.Cast(@"int64",R.Member(s.Get(@"frame"),@"hwnd")),R.Cast(@"int",R.Member(s.Get(@"frame"),@"pid")),s.Get(@"x"),s.Get(@"y"),s.Get(@"allowWindows")}),null));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"second"),@"ok"),s.Get(@"true")))){s.Set(@"guard",s.Get(@"second"));
s.Set(@"activated",s.Get(@"true"));
s.Set(@"note",R.Invoke((""+R.Str(s.Get(@"note"))+@"; the target window was brought forward once (allow_activate) and the landing point was checked again"),@"TrimStart",new object[]{@";",@" "}));}else{s.Set(@"note",R.Invoke((""+R.Str(s.Get(@"note"))+@"; the target window was brought forward once (allow_activate) and ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") was still over hwnd "+R.Str(R.Capture((o343) => {R.Emit(o343,R.Member(R.Member(s.Get(@"second"),@"hit"),@"hwnd"));}))+@", pid "+R.Str(R.Capture((o344) => {R.Emit(o344,R.Member(R.Member(s.Get(@"second"),@"hit"),@"pid"));}))),@"TrimStart",new object[]{@";",@" "}));}}}
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"guard"),@"ok"),s.Get(@"true")))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+R.Str(R.Capture((o345) => {R.Emit(o345,R.Member(s.Get(@"guard"),@"reason"));})))}));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o346) => {R.Emit(o346,R.Member(s.Get(@"guard"),@"note"));}))),@""))){s.Set(@"note",R.Invoke((""+R.Str(s.Get(@"note"))+@"; "+R.Str(R.Capture((o347) => {R.Emit(o347,R.Member(s.Get(@"guard"),@"note"));}))),@"TrimStart",new object[]{@";",@" "}));}
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"x",s.Get(@"x"),@"y",s.Get(@"y"),@"drift",s.Get(@"drift"),@"note",s.Get(@"note"),@"guard",s.Get(@"guard"),@"mapping",s.Get(@"mapping"),@"activated",s.Get(@"activated"),@"frame",s.Get(@"frame")}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_FrameReceipt_348(Scope s,Args a){var o=new List<object>();s.Set(@"frame",R.Bind(a,0,@"frame",()=>null,@"object"));
s.Set(@"px",R.Bind(a,1,@"px",()=>null,@"int"));
s.Set(@"py",R.Bind(a,2,@"py",()=>null,@"int"));
s.Set(@"x",R.Bind(a,3,@"x",()=>null,@"int"));
s.Set(@"y",R.Bind(a,4,@"y",()=>null,@"int"));
s.Set(@"drift",R.Bind(a,5,@"drift",()=>null,@"int"));
s.Set(@"note",R.Bind(a,6,@"note",()=>null,@"string"));
s.Set(@"guard",R.Bind(a,7,@"guard",()=>s.Get(@"null"),@"object"));
s.Set(@"mapping",R.Bind(a,8,@"mapping",()=>@"",@"string"));
s.Set(@"activated",R.Bind(a,9,@"activated",()=>s.Get(@"false"),@"bool"));
try{s.Set(@"receipt",R.Cast(@"ordered",R.Map(new object[]{@"id",(""+R.Str(R.Capture((o349) => {R.Emit(o349,R.Member(s.Get(@"frame"),@"id"));}))),@"fromImage",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"px"),@"y",s.Get(@"py")})),@"projected",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"x"),@"y",s.Get(@"y")})),@"scale",R.Cast(@"double",R.Member(s.Get(@"frame"),@"effectiveScale")),@"source",(""+R.Str(R.Capture((o350) => {R.Emit(o350,R.Member(s.Get(@"frame"),@"source"));})))})));
if(R.Bool(R.Binary(s,@"Ine",R.Cast(@"double",R.Member(s.Get(@"frame"),@"requestedScale")),R.Cast(@"double",R.Member(s.Get(@"frame"),@"effectiveScale"))))){R.SetMember(s.Get(@"receipt"),@"scaleRequested",R.Cast(@"double",R.Member(s.Get(@"frame"),@"requestedScale")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"mapping"),@""))){R.SetMember(s.Get(@"receipt"),@"mapping",s.Get(@"mapping"));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"drift"),0))){R.SetMember(s.Get(@"receipt"),@"drift",s.Get(@"drift"));}
if(R.Bool(s.Get(@"activated"))){R.SetMember(s.Get(@"receipt"),@"recovered",s.Get(@"true"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"note"),@""))){R.SetMember(s.Get(@"receipt"),@"note",s.Get(@"note"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"guard")))){R.SetMember(s.Get(@"receipt"),@"guard",(""+R.Str(R.Capture((o351) => {R.Emit(o351,R.Member(s.Get(@"guard"),@"how"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"guard"),@"hit")))){R.SetMember(s.Get(@"receipt"),@"landing",R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",R.Member(R.Member(s.Get(@"guard"),@"hit"),@"hwnd")),@"root",R.Cast(@"int64",R.Member(R.Member(s.Get(@"guard"),@"hit"),@"root")),@"pid",R.Cast(@"int",R.Member(R.Member(s.Get(@"guard"),@"hit"),@"pid"))})));}}
throw new ReturnFlow(s.Get(@"receipt"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Click_352(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before the click"}),null));
s.Set(@"x",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"x")));
s.Set(@"y",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"y")));
s.Set(@"frameReceipt",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"fromFrame"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o353) => {R.Emit(o353,R.Member(s.Get(@"Arg"),@"fromFrame"));}))),@""))))){s.Set(@"resolved",R.Call(s,@"Resolve-FramePoint",new Args(new object[]{R.Cast(@"string",R.Member(s.Get(@"Arg"),@"fromFrame")),s.Get(@"x"),s.Get(@"y"),R.Cast(@"ordered",R.Map(new object[]{@"allowActivate",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"allowActivate"),s.Get(@"true")),@"verifyContent",R.Member(s.Get(@"Arg"),@"verifyContent"),@"allowWindows",R.Member(s.Get(@"Arg"),@"allowWindows")}))}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"resolved"),@"ok")))){throw R.Error(R.Member(s.Get(@"resolved"),@"error"));}
s.Set(@"frameReceipt",R.Call(s,@"Get-FrameReceipt",new Args(new object[]{R.Member(s.Get(@"resolved"),@"frame"),s.Get(@"x"),s.Get(@"y"),R.Member(s.Get(@"resolved"),@"x"),R.Member(s.Get(@"resolved"),@"y"),R.Member(s.Get(@"resolved"),@"drift"),R.Member(s.Get(@"resolved"),@"note"),R.Member(s.Get(@"resolved"),@"guard"),R.Member(s.Get(@"resolved"),@"mapping"),R.Member(s.Get(@"resolved"),@"activated")}),null));
s.Set(@"x",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"x")));
s.Set(@"y",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"y")));}
s.Set(@"clicks",1);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"clicks")))){s.Set(@"clicks",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"clicks")));}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"clicks"),1))){s.Set(@"clicks",1);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"clicks"),3))){s.Set(@"clicks",3);}
s.Set(@"button",(""+R.Str(R.Capture((o354) => {R.Emit(o354,R.Member(s.Get(@"Arg"),@"button"));}))));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"button")}))){s.Set(@"button",@"left");}
s.Set(@"modifierChord",(""+R.Str(R.Capture((o355) => {R.Emit(o355,R.Member(s.Get(@"Arg"),@"modifiers"));}))));
s.Set(@"modifierVks",R.Array(R.Capture((o356) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"modifierChord"),@""))){s.Set(@"modifierVks",R.Call(s,@"Get-KeyVkList",new Args(new object[]{s.Get(@"modifierChord")}),null));}
s.Set(@"preferA11y",R.Binary(s,@"Ine",R.Member(s.Get(@"Arg"),@"preferA11y"),s.Get(@"false")));
if(R.Bool((R.Bool((R.Bool((R.Bool(s.Get(@"preferA11y")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"clicks"),1)))) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"button"),@"left")))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"modifierVks"),@"Count"),0))))){s.Set(@"target",s.Get(@"null"));
try{s.Set(@"target",R.Call(s,@"Get-PressableElementAtPoint",new Args(new object[]{s.Get(@"x"),s.Get(@"y")}),null));}catch(Exception error357) when (!(error357 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error357}));s.Set(@"target",s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target")))){s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Invoke(R.Member(s.Get(@"target"),@"element"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.InvokePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})}))){R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.InvokePattern",s.Get(@"p")),@"Invoke",new object[]{}));
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"click (a11y)"}),null));
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),60}),null));
s.Set(@"a11yValue",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"x"),@"y",s.Get(@"y"),@"clicks",1,@"button",@"left",@"events",0,@"via",@"a11y",@"element",R.Cast(@"ordered",R.Map(new object[]{@"name",R.Member(s.Get(@"target"),@"name"),@"controlType",R.Member(s.Get(@"target"),@"controlType"),@"automationId",R.Member(s.Get(@"target"),@"automationId")}))})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"frameReceipt")))){R.SetMember(s.Get(@"a11yValue"),@"frame",s.Get(@"frameReceipt"));}
throw new ReturnFlow(s.Get(@"a11yValue"));}}}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"modifierVks"),@"Count"),0))){R.Emit(o,R.Cast(@"void",R.Call(s,@"Send-Modifiers",new Args(new object[]{s.Get(@"modifierVks"),s.Get(@"true")}),null)));}
try{R.Emit(o,R.Call(s,@"Do-MouseMove",new Args(new object[]{s.Get(@"x"),s.Get(@"y"),s.Get(@"true")}),null));
s.Set(@"flags",R.Call(s,@"Get-ButtonFlags",new Args(new object[]{s.Get(@"button")}),null));
s.Set(@"events",R.Array(R.Capture((o358) => {})));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"clicks")))){try{s.Set(@"events",R.Binary(s,@"Plus",s.Get(@"events"),R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{0,0,0,R.Index(s.Get(@"flags"),0)})));
s.Set(@"events",R.Binary(s,@"Plus",s.Get(@"events"),R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{0,0,0,R.Index(s.Get(@"flags"),1)})));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u359=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u359,1L));return u359;}));}}
s.Set(@"sent",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{s.Get(@"events")}));
s.Set(@"delivery",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sent"),R.Member(s.Get(@"events"),@"Count"),(""+@"the click ("+R.Str(s.Get(@"clicks"))+@" press/release pair(s))"),@"the click"}),null));}finally{if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"modifierVks"),@"Count"),0))){R.Emit(o,R.Cast(@"void",R.Call(s,@"Send-Modifiers",new Args(new object[]{s.Get(@"modifierVks"),s.Get(@"false")}),null)));}}
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"click"}),null));
s.Set(@"value",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"x"),@"y",s.Get(@"y"),@"clicks",s.Get(@"clicks"),@"button",s.Get(@"button"),@"events",s.Get(@"sent"),@"via",@"mouse"})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"modifierChord"),@""))){R.SetMember(s.Get(@"value"),@"modifiers",s.Get(@"modifierChord"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"frameReceipt")))){R.SetMember(s.Get(@"value"),@"frame",s.Get(@"frameReceipt"));}
throw new ReturnFlow(s.Get(@"value"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Drag_360(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before the drag"}),null));
s.Set(@"sx",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"fromX")));
s.Set(@"sy",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"fromY")));
s.Set(@"ex",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"toX")));
s.Set(@"ey",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"toY")));
s.Set(@"fromLast",(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"fromLast"))) && R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"fromLast"),s.Get(@"true"))) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o361) => {R.Emit(o361,R.Member(s.Get(@"Arg"),@"fromLast"));}))),@"true"))))));
s.Set(@"continueFrom",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"continueFrom")))){s.Set(@"continueFrom",(""+R.Str(R.Capture((o362) => {R.Emit(o362,R.Member(s.Get(@"Arg"),@"continueFrom"));}))));}
if(R.Bool((R.Bool(s.Get(@"fromLast")) || R.Bool(R.Binary(s,@"Ine",s.Get(@"continueFrom"),@""))))){s.Set(@"handle",R.Call(s,@"Get-DragHandle",new Args(new object[]{s.Get(@"continueFrom")}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"handle"),@"ok")))){throw R.Error((""+@"["+R.Str(R.Capture((o363) => {R.Emit(o363,R.Member(s.Get(@"handle"),@"code"));}))+@"] cannot continue from the last drag: "+R.Str(R.Capture((o364) => {R.Emit(o364,R.Member(s.Get(@"handle"),@"note"));}))+@". (action_sent=false, recovery=computer_screenshot, auto_reresolve=false)"));}
s.Set(@"sx",R.Cast(@"int",R.Member(R.Member(s.Get(@"handle"),@"handle"),@"x")));
s.Set(@"sy",R.Cast(@"int",R.Member(R.Member(s.Get(@"handle"),@"handle"),@"y")));}
s.Set(@"path",R.Array(R.Capture((o365) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"path")))){foreach(var item366 in R.Array(R.Array(R.Capture((o367) => {R.Emit(o367,R.Member(s.Get(@"Arg"),@"path"));})))){s.Set(@"point",item366);try{s.Set(@"px",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"point"),@"x"}),null));
s.Set(@"py",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"point"),@"y"}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"px"))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"py")))))){throw R.Error(@"[BAD_REQUEST] every point of a drag path needs x and y");}
s.Set(@"path",R.Binary(s,@"Plus",s.Get(@"path"),R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",s.Get(@"px")),@"y",R.Cast(@"int",s.Get(@"py"))}))));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ilt",R.Member(s.Get(@"path"),@"Count"),2))){throw R.Error((""+@"[BAD_REQUEST] a drag path needs at least two points (got "+R.Str(R.Capture((o368) => {R.Emit(o368,R.Member(s.Get(@"path"),@"Count"));}))+@")"));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"path"),@"Count"),64))){throw R.Error((""+@"[BAD_REQUEST] a drag path takes at most 64 points (got "+R.Str(R.Capture((o369) => {R.Emit(o369,R.Member(s.Get(@"path"),@"Count"));}))+@"); simplify it -- a path is sampled smoothly, so vertices every few pixels are not needed"));}
s.Set(@"deduped",R.Array(R.Capture((o370) => {})));
foreach(var item371 in R.Array(s.Get(@"path"))){s.Set(@"point",item371);try{if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"deduped"),@"Count"),0)) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Member(R.Index(s.Get(@"deduped"),R.Binary(s,@"Minus",R.Member(s.Get(@"deduped"),@"Count"),1)),@"x")),R.Cast(@"int",R.Member(s.Get(@"point"),@"x")))))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Member(R.Index(s.Get(@"deduped"),R.Binary(s,@"Minus",R.Member(s.Get(@"deduped"),@"Count"),1)),@"y")),R.Cast(@"int",R.Member(s.Get(@"point"),@"y"))))))){throw new ContinueFlow();}
s.Set(@"deduped",R.Binary(s,@"Plus",s.Get(@"deduped"),s.Get(@"point")));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ilt",R.Member(s.Get(@"deduped"),@"Count"),2))){throw R.Error(@"[BAD_REQUEST] the drag path collapses to one point once consecutive duplicates are removed, so there is nothing to drag");}
s.Set(@"path",s.Get(@"deduped"));}
s.Set(@"durationMs",400);
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"durationMs"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o372) => {R.Emit(o372,R.Member(s.Get(@"Arg"),@"durationMs"));}))),@""))))){s.Set(@"durationMs",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"durationMs")));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"durationMs"),100))){s.Set(@"durationMs",100);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"durationMs"),5000))){s.Set(@"durationMs",5000);}}
s.Set(@"frameReceipt",s.Get(@"null"));
s.Set(@"frameId",@"");
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"path"),@"Count"),0)) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"fromFrame"))))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o373) => {R.Emit(o373,R.Member(s.Get(@"Arg"),@"fromFrame"));}))),@""))))){s.Set(@"projected",R.Array(R.Capture((o374) => {})));
foreach(var item375 in R.Array(s.Get(@"path"))){s.Set(@"point",item375);try{s.Set(@"resolved",R.Call(s,@"Resolve-FramePoint",new Args(new object[]{R.Cast(@"string",R.Member(s.Get(@"Arg"),@"fromFrame")),R.Cast(@"int",R.Member(s.Get(@"point"),@"x")),R.Cast(@"int",R.Member(s.Get(@"point"),@"y")),R.Cast(@"ordered",R.Map(new object[]{@"allowActivate",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"allowActivate"),s.Get(@"true")),@"verifyContent",R.Member(s.Get(@"Arg"),@"verifyContent"),@"allowWindows",R.Member(s.Get(@"Arg"),@"allowWindows")}))}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"resolved"),@"ok")))){throw R.Error(R.Member(s.Get(@"resolved"),@"error"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"frameReceipt")))){s.Set(@"frameReceipt",R.Call(s,@"Get-FrameReceipt",new Args(new object[]{R.Member(s.Get(@"resolved"),@"frame"),R.Cast(@"int",R.Member(s.Get(@"point"),@"x")),R.Cast(@"int",R.Member(s.Get(@"point"),@"y")),R.Cast(@"int",R.Member(s.Get(@"resolved"),@"x")),R.Cast(@"int",R.Member(s.Get(@"resolved"),@"y")),R.Cast(@"int",R.Member(s.Get(@"resolved"),@"drift")),(""+R.Str(R.Capture((o376) => {R.Emit(o376,R.Member(s.Get(@"resolved"),@"note"));}))),R.Member(s.Get(@"resolved"),@"guard"),(""+R.Str(R.Capture((o377) => {R.Emit(o377,R.Member(s.Get(@"resolved"),@"mapping"));}))),R.Cast(@"bool",R.Member(s.Get(@"resolved"),@"activated"))}),null));
s.Set(@"frameId",R.Cast(@"string",R.Member(R.Member(s.Get(@"resolved"),@"frame"),@"id")));}
s.Set(@"projected",R.Binary(s,@"Plus",s.Get(@"projected"),R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"y"))}))));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"path",s.Get(@"projected"));}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"fromFrame"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o378) => {R.Emit(o378,R.Member(s.Get(@"Arg"),@"fromFrame"));}))),@""))))){s.Set(@"start",R.Call(s,@"Resolve-FramePoint",new Args(new object[]{R.Cast(@"string",R.Member(s.Get(@"Arg"),@"fromFrame")),s.Get(@"sx"),s.Get(@"sy"),R.Cast(@"ordered",R.Map(new object[]{@"allowActivate",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"allowActivate"),s.Get(@"true")),@"verifyContent",R.Member(s.Get(@"Arg"),@"verifyContent"),@"allowWindows",R.Member(s.Get(@"Arg"),@"allowWindows")}))}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"start"),@"ok")))){throw R.Error(R.Member(s.Get(@"start"),@"error"));}
s.Set(@"finish",R.Call(s,@"Resolve-FramePoint",new Args(new object[]{R.Cast(@"string",R.Member(s.Get(@"Arg"),@"fromFrame")),s.Get(@"ex"),s.Get(@"ey"),R.Cast(@"ordered",R.Map(new object[]{@"allowActivate",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"allowActivate"),s.Get(@"true")),@"verifyContent",R.Member(s.Get(@"Arg"),@"verifyContent"),@"allowWindows",R.Member(s.Get(@"Arg"),@"allowWindows")}))}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"finish"),@"ok")))){throw R.Error(R.Member(s.Get(@"finish"),@"error"));}
s.Set(@"frameReceipt",R.Call(s,@"Get-FrameReceipt",new Args(new object[]{R.Member(s.Get(@"start"),@"frame"),s.Get(@"sx"),s.Get(@"sy"),R.Member(s.Get(@"start"),@"x"),R.Member(s.Get(@"start"),@"y"),R.Member(s.Get(@"start"),@"drift"),R.Member(s.Get(@"start"),@"note"),R.Member(s.Get(@"start"),@"guard"),R.Member(s.Get(@"start"),@"mapping"),R.Member(s.Get(@"start"),@"activated")}),null));
s.Set(@"frameId",R.Cast(@"string",R.Member(R.Member(s.Get(@"start"),@"frame"),@"id")));
s.Set(@"sx",R.Cast(@"int",R.Member(s.Get(@"start"),@"x")));
s.Set(@"sy",R.Cast(@"int",R.Member(s.Get(@"start"),@"y")));
s.Set(@"ex",R.Cast(@"int",R.Member(s.Get(@"finish"),@"x")));
s.Set(@"ey",R.Cast(@"int",R.Member(s.Get(@"finish"),@"y")));}
s.Set(@"steps",12);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"steps")))){s.Set(@"steps",R.Invoke(R.Type(@"Math"),@"Max",new object[]{2,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"steps"))}));}
s.Set(@"modifierChord",(""+R.Str(R.Capture((o379) => {R.Emit(o379,R.Member(s.Get(@"Arg"),@"modifiers"));}))));
s.Set(@"modifierVks",R.Array(R.Capture((o380) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"modifierChord"),@""))){s.Set(@"modifierVks",R.Call(s,@"Get-KeyVkList",new Args(new object[]{s.Get(@"modifierChord")}),null));}
s.Set(@"waypoints",R.Array(R.Capture((o381) => {})));
s.Set(@"paceMs",12);
s.Set(@"sampleCount",0);
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"path"),@"Count"),1))){s.Set(@"lengths",R.Array(R.Capture((o382) => {})));
s.Set(@"total",0d);
{s.Set(@"i",1);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Member(s.Get(@"path"),@"Count")))){try{s.Set(@"segmentLength",R.Invoke(R.Type(@"Math"),@"Sqrt",new object[]{R.Binary(s,@"Plus",R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),s.Get(@"i")),@"x")),R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),R.Binary(s,@"Minus",s.Get(@"i"),1)),@"x"))),2}),R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),s.Get(@"i")),@"y")),R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),R.Binary(s,@"Minus",s.Get(@"i"),1)),@"y"))),2}))}));
s.Set(@"lengths",R.Binary(s,@"Plus",s.Get(@"lengths"),s.Get(@"segmentLength")));
s.Set(@"total",R.Binary(s,@"Plus",s.Get(@"total"),s.Get(@"segmentLength")));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u383=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u383,1L));return u383;}));}}
s.Set(@"sampleCount",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Ceiling",new object[]{R.Binary(s,@"Divide",s.Get(@"total"),4d)})));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"sampleCount"),R.Binary(s,@"Minus",R.Member(s.Get(@"path"),@"Count"),1)))){s.Set(@"sampleCount",R.Binary(s,@"Minus",R.Member(s.Get(@"path"),@"Count"),1));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"sampleCount"),240))){s.Set(@"sampleCount",240);}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"sampleCount"),2))){s.Set(@"sampleCount",2);}
s.Set(@"stepDistance",0d);
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"sampleCount"),0))){s.Set(@"stepDistance",R.Binary(s,@"Divide",s.Get(@"total"),s.Get(@"sampleCount")));}
s.Set(@"samples",R.Array(R.Capture((o384) => {R.Emit(o384,R.Index(s.Get(@"path"),0));})));
s.Set(@"segment",0);
s.Set(@"walked",0d);
{s.Set(@"i",1);while(R.Bool(R.Binary(s,@"Ile",s.Get(@"i"),s.Get(@"sampleCount")))){try{s.Set(@"target",R.Binary(s,@"Multiply",s.Get(@"stepDistance"),s.Get(@"i")));
while(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"segment"),R.Binary(s,@"Minus",R.Member(s.Get(@"path"),@"Count"),1))) && R.Bool(R.Binary(s,@"Ilt",R.Binary(s,@"Plus",s.Get(@"walked"),R.Index(s.Get(@"lengths"),s.Get(@"segment"))),s.Get(@"target")))))){try{s.Set(@"walked",R.Binary(s,@"Plus",s.Get(@"walked"),R.Index(s.Get(@"lengths"),s.Get(@"segment"))));
R.Eval(()=>R.Eval(()=>{var u385=s.Get(@"segment");s.Set(@"segment",R.Binary(s,@"Plus",u385,1L));return u385;}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"segment"),R.Binary(s,@"Minus",R.Member(s.Get(@"path"),@"Count"),1)))){s.Set(@"samples",R.Binary(s,@"Plus",s.Get(@"samples"),R.Index(s.Get(@"path"),R.Binary(s,@"Minus",R.Member(s.Get(@"path"),@"Count"),1))));
throw new ContinueFlow();}
s.Set(@"into",R.Binary(s,@"Minus",s.Get(@"target"),s.Get(@"walked")));
s.Set(@"ratio",0d);
if(R.Bool(R.Binary(s,@"Igt",R.Index(s.Get(@"lengths"),s.Get(@"segment")),0))){s.Set(@"ratio",R.Binary(s,@"Divide",s.Get(@"into"),R.Index(s.Get(@"lengths"),s.Get(@"segment"))));}
s.Set(@"sampleX",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Plus",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),s.Get(@"segment")),@"x")),R.Binary(s,@"Multiply",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),R.Binary(s,@"Plus",s.Get(@"segment"),1)),@"x")),R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),s.Get(@"segment")),@"x"))),s.Get(@"ratio")))})));
s.Set(@"sampleY",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Plus",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),s.Get(@"segment")),@"y")),R.Binary(s,@"Multiply",R.Binary(s,@"Minus",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),R.Binary(s,@"Plus",s.Get(@"segment"),1)),@"y")),R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),s.Get(@"segment")),@"y"))),s.Get(@"ratio")))})));
s.Set(@"samples",R.Binary(s,@"Plus",s.Get(@"samples"),R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"sampleX"),@"y",s.Get(@"sampleY")}))));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u386=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u386,1L));return u386;}));}}
s.Set(@"waypoints",R.Array(R.Capture((o387) => {R.Emit(o387,R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"Skip",R.Switch),1}),s.Get(@"samples")));})));
s.Set(@"paceMs",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Divide",s.Get(@"durationMs"),R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Member(s.Get(@"samples"),@"Count")}))})})));
s.Set(@"sx",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),0),@"x")));
s.Set(@"sy",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),0),@"y")));
s.Set(@"ex",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),R.Binary(s,@"Minus",R.Member(s.Get(@"path"),@"Count"),1)),@"x")));
s.Set(@"ey",R.Cast(@"int",R.Member(R.Index(s.Get(@"path"),R.Binary(s,@"Minus",R.Member(s.Get(@"path"),@"Count"),1)),@"y")));}else{{s.Set(@"i",1);while(R.Bool(R.Binary(s,@"Ile",s.Get(@"i"),s.Get(@"steps")))){try{s.Set(@"waypoints",R.Binary(s,@"Plus",s.Get(@"waypoints"),R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Binary(s,@"Plus",s.Get(@"sx"),R.Binary(s,@"Divide",R.Binary(s,@"Multiply",R.Binary(s,@"Minus",s.Get(@"ex"),s.Get(@"sx")),s.Get(@"i")),s.Get(@"steps")))),@"y",R.Cast(@"int",R.Binary(s,@"Plus",s.Get(@"sy"),R.Binary(s,@"Divide",R.Binary(s,@"Multiply",R.Binary(s,@"Minus",s.Get(@"ey"),s.Get(@"sy")),s.Get(@"i")),s.Get(@"steps"))))}))));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u388=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u388,1L));return u388;}));}}}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"modifierVks"),@"Count"),0))){R.Emit(o,R.Cast(@"void",R.Call(s,@"Send-Modifiers",new Args(new object[]{s.Get(@"modifierVks"),s.Get(@"true")}),null)));}
try{R.Emit(o,R.Call(s,@"Do-MouseMove",new Args(new object[]{s.Get(@"sx"),s.Get(@"sy"),s.Get(@"true")}),null));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Array(R.Capture((o389) => {R.Emit(o389,R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{0,0,0,R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_LEFTDOWN")}));}))})));
R.Emit(o,R.Call(s,@"Add-HeldButton",new Args(new object[]{R.Cast(@"uint32",R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_LEFTDOWN"))}),null));
try{R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),40}),null));
s.Set(@"travelled",0);
foreach(var item390 in R.Array(s.Get(@"waypoints"))){s.Set(@"waypoint",item390);try{R.Eval(()=>R.Eval(()=>{var u391=s.Get(@"travelled");s.Set(@"travelled",R.Binary(s,@"Plus",u391,1L));return u391;}));
R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{(""+@"during the drag (step "+R.Str(s.Get(@"travelled"))+@" of "+R.Str(R.Capture((o392) => {R.Emit(o392,R.Member(s.Get(@"waypoints"),@"Count"));}))+@")")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"frameId"),@"")) && R.Bool(R.Binary(s,@"Ieq",R.Binary(s,@"Rem",s.Get(@"travelled"),12),0))))){s.Set(@"liveCheck",s.Get(@"null"));
try{s.Set(@"liveCheck",R.Call(s,@"Test-FrameLive",new Args(new object[]{s.Get(@"frameId"),R.Cast(@"ordered",R.Map(new object[]{@"verifyContent",s.Get(@"false"),@"allowWindows",R.Member(s.Get(@"Arg"),@"allowWindows")}))}),null));}catch(Exception error393) when (!(error393 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error393}));s.Set(@"liveCheck",s.Get(@"null"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"liveCheck"))) || R.Bool(R.Unary(@"Not",R.Member(s.Get(@"liveCheck"),@"ok")))))){s.Set(@"why",@"the frame the drag was projected against is no longer usable");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"liveCheck")))){s.Set(@"why",(""+R.Str(R.Capture((o394) => {R.Emit(o394,R.Member(s.Get(@"liveCheck"),@"error"));}))));}
throw R.Error((""+@"[FRAME_STALE] "+R.Str(s.Get(@"why"))+@" -- the drag was stopped at waypoint "+R.Str(s.Get(@"travelled"))+@" of "+R.Str(R.Capture((o395) => {R.Emit(o395,R.Member(s.Get(@"waypoints"),@"Count"));}))+@" rather than continuing onto whatever is behind it. (action_sent=true)"));}}
R.Emit(o,R.Call(s,@"Do-MouseMove",new Args(new object[]{R.Cast(@"int",R.Member(s.Get(@"waypoint"),@"x")),R.Cast(@"int",R.Member(s.Get(@"waypoint"),@"y"))}),null));
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),s.Get(@"paceMs")}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}}}finally{s.Set(@"released",s.Get(@"false"));
try{s.Set(@"released",R.Binary(s,@"Igt",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Array(R.Capture((o396) => {R.Emit(o396,R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{0,0,0,R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_LEFTUP")}));}))}),0));}catch(Exception error397) when (!(error397 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error397}));s.Set(@"released",s.Get(@"false"));}
if(R.Bool(s.Get(@"released"))){R.Emit(o,R.Call(s,@"Remove-HeldButton",new Args(new object[]{R.Cast(@"uint32",R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_LEFTDOWN"))}),null));}}}finally{if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"modifierVks"),@"Count"),0))){R.Emit(o,R.Cast(@"void",R.Call(s,@"Send-Modifiers",new Args(new object[]{s.Get(@"modifierVks"),s.Get(@"false")}),null)));}}
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"drag"}),null));
R.Emit(o,R.Cast(@"void",R.Capture((o398) => {s.Set(@"script:LastDrag",R.Call(s,@"Set-DragHandle",new Args(new object[]{new Named(@"x",R.Switch),s.Get(@"ex"),new Named(@"y",R.Switch),s.Get(@"ey")}),null));})));
s.Set(@"value",R.Cast(@"ordered",R.Map(new object[]{@"from",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"sx"),@"y",s.Get(@"sy")})),@"to",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"ex"),@"y",s.Get(@"ey")})),@"steps",s.Get(@"steps")})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"path"),@"Count"),1))){R.SetIndex(s.Get(@"value"),@"path",R.Cast(@"ordered",R.Map(new object[]{@"points",R.Member(s.Get(@"path"),@"Count"),@"samples",s.Get(@"sampleCount"),@"durationMs",s.Get(@"durationMs"),@"paceMs",s.Get(@"paceMs")})));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"modifierChord"),@""))){R.SetMember(s.Get(@"value"),@"modifiers",s.Get(@"modifierChord"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"frameReceipt")))){R.SetMember(s.Get(@"value"),@"frame",s.Get(@"frameReceipt"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"script:LastDrag")))){R.SetIndex(s.Get(@"value"),@"handle",(""+R.Str(R.Capture((o399) => {R.Emit(o399,R.Member(s.Get(@"script:LastDrag"),@"id"));}))));}
throw new ReturnFlow(s.Get(@"value"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Scroll_400(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before the scroll"}),null));
s.Set(@"horizontal",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"horizontal")))){s.Set(@"horizontal",R.Cast(@"bool",R.Member(s.Get(@"Arg"),@"horizontal")));}
s.Set(@"clicks",3);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"clicks")))){s.Set(@"clicks",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"clicks")));}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"clicks"),0))){s.Set(@"clicks",0);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"clicks"),100))){s.Set(@"clicks",100);}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"clicks"),0))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"direction",(""+R.Str(R.Capture((o401) => {R.Emit(o401,R.Member(s.Get(@"Arg"),@"direction"));}))),@"clicks",0,@"horizontal",s.Get(@"false"),@"delta",0,@"events",0})));}
s.Set(@"dir",(""+R.Str(R.Capture((o402) => {R.Emit(o402,R.Member(s.Get(@"Arg"),@"direction"));}))));
s.Set(@"sign",1);
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"dir"),@"down")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"dir"),@"right")))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"dir"),@"forward"))))){s.Set(@"sign",-1);}
s.Set(@"mx",R.Member(s.Get(@"Arg"),@"x"));
s.Set(@"my",R.Member(s.Get(@"Arg"),@"y"));
s.Set(@"frameReceipt",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"fromFrame"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o403) => {R.Emit(o403,R.Member(s.Get(@"Arg"),@"fromFrame"));}))),@""))))){if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"mx"))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"my")))))){throw R.Error(@"[BAD_REQUEST] a scroll with from_frame needs x and y as image pixels of that frame");}
s.Set(@"resolved",R.Call(s,@"Resolve-FramePoint",new Args(new object[]{R.Cast(@"string",R.Member(s.Get(@"Arg"),@"fromFrame")),R.Cast(@"int",s.Get(@"mx")),R.Cast(@"int",s.Get(@"my")),R.Cast(@"ordered",R.Map(new object[]{@"allowActivate",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"allowActivate"),s.Get(@"true")),@"verifyContent",R.Member(s.Get(@"Arg"),@"verifyContent"),@"allowWindows",R.Member(s.Get(@"Arg"),@"allowWindows")}))}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"resolved"),@"ok")))){throw R.Error(R.Member(s.Get(@"resolved"),@"error"));}
s.Set(@"frameReceipt",R.Call(s,@"Get-FrameReceipt",new Args(new object[]{R.Member(s.Get(@"resolved"),@"frame"),R.Cast(@"int",s.Get(@"mx")),R.Cast(@"int",s.Get(@"my")),R.Member(s.Get(@"resolved"),@"x"),R.Member(s.Get(@"resolved"),@"y"),R.Member(s.Get(@"resolved"),@"drift"),R.Member(s.Get(@"resolved"),@"note"),R.Member(s.Get(@"resolved"),@"guard"),R.Member(s.Get(@"resolved"),@"mapping"),R.Member(s.Get(@"resolved"),@"activated")}),null));
s.Set(@"mx",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"x")));
s.Set(@"my",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"y")));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"mx"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"my")))))){R.Emit(o,R.Call(s,@"Do-MouseMove",new Args(new object[]{R.Cast(@"int",s.Get(@"mx")),R.Cast(@"int",s.Get(@"my")),s.Get(@"true")}),null));}
s.Set(@"delta",R.Cast(@"int",R.Binary(s,@"Multiply",R.Binary(s,@"Multiply",120,s.Get(@"clicks")),s.Get(@"sign"))));
s.Set(@"flag",R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_WHEEL"));
if(R.Bool(s.Get(@"horizontal"))){s.Set(@"flag",R.Member(R.Type(@"DshNative"),@"MOUSEEVENTF_HWHEEL"));}
s.Set(@"events",R.Array(R.Capture((o404) => {})));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"clicks")))){try{s.Set(@"events",R.Binary(s,@"Plus",s.Get(@"events"),R.Invoke(R.Type(@"DshNative"),@"Mouse",new object[]{0,0,R.Cast(@"uint32",R.Binary(s,@"Band",R.Cast(@"int64",R.Binary(s,@"Multiply",120,s.Get(@"sign"))),4294967295L)),s.Get(@"flag")})));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u405=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u405,1L));return u405;}));}}
s.Set(@"sent",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{s.Get(@"events")}));
s.Set(@"delivery",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sent"),R.Member(s.Get(@"events"),@"Count"),(""+@"the scroll ("+R.Str(s.Get(@"clicks"))+@" wheel step(s))"),@"the scroll"}),null));
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"scroll"}),null));
s.Set(@"value",R.Cast(@"ordered",R.Map(new object[]{@"direction",s.Get(@"dir"),@"clicks",s.Get(@"clicks"),@"horizontal",s.Get(@"horizontal"),@"delta",s.Get(@"delta"),@"events",s.Get(@"sent")})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"frameReceipt")))){R.SetMember(s.Get(@"value"),@"frame",s.Get(@"frameReceipt"));}
throw new ReturnFlow(s.Get(@"value"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Type_406(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before typing"}),null));
s.Set(@"text",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"text")));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{s.Get(@"text")}))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"typed",0,@"skipped",R.Array(R.Capture((o407) => {}))})));}
R.Emit(o,R.Call(s,@"Assert-ExpectedForeground",new Args(new object[]{R.Member(s.Get(@"Arg"),@"intoHwnd"),@"typing"}),null));
s.Set(@"foreground",R.Call(s,@"Assert-InjectableForeground",new Args(new object[]{@"typing"}),null));
s.Set(@"delay",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"delayMs")))){s.Set(@"delay",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"delayMs")));}
s.Set(@"events",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[DshNative+INPUT]"}),null));
s.Set(@"count",0);
s.Set(@"skipped",R.Array(R.Capture((o408) => {})));
foreach(var item409 in R.Array(R.Invoke(s.Get(@"text"),@"ToCharArray",new object[]{}))){s.Set(@"ch",item409);try{s.Set(@"code",R.Cast(@"int",R.Cast(@"char",s.Get(@"ch"))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"code"),13))){throw new ContinueFlow();}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"code"),10)) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"code"),9))))){s.Set(@"vk",13);
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"code"),9))){s.Set(@"vk",9);}
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",s.Get(@"vk")),0,0})}));
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",s.Get(@"vk")),0,R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP")})}));
R.Eval(()=>R.Eval(()=>{var u410=s.Get(@"count");s.Set(@"count",R.Binary(s,@"Plus",u410,1L));return u410;}));
throw new ContinueFlow();}
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{0,R.Cast(@"uint16",s.Get(@"code")),R.Member(R.Type(@"DshNative"),@"KEYEVENTF_UNICODE")})}));
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{0,R.Cast(@"uint16",s.Get(@"code")),R.Binary(s,@"Bor",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_UNICODE"),R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP"))})}));
R.Eval(()=>R.Eval(()=>{var u411=s.Get(@"count");s.Set(@"count",R.Binary(s,@"Plus",u411,1L));return u411;}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"count"),0))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"typed",0,@"skipped",s.Get(@"skipped")})));}
s.Set(@"chunk",240);
s.Set(@"all",R.Invoke(s.Get(@"events"),@"ToArray",new object[]{}));
s.Set(@"sent",0);
s.Set(@"expectedEvents",R.Member(s.Get(@"all"),@"Length"));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Member(s.Get(@"all"),@"Length")))){try{R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{(""+@"while typing (character "+R.Str(s.Get(@"i"))+@" of "+R.Str(R.Capture((o412) => {R.Emit(o412,R.Binary(s,@"Divide",R.Member(s.Get(@"all"),@"Length"),2));}))+@")")}),null));
R.Emit(o,R.Call(s,@"Assert-WithinDeadline",new Args(new object[]{(""+@"while typing (character "+R.Str(s.Get(@"i"))+@" of "+R.Str(R.Capture((o413) => {R.Emit(o413,R.Binary(s,@"Divide",R.Member(s.Get(@"all"),@"Length"),2));}))+@")")}),null));
s.Set(@"len",R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"chunk"),R.Binary(s,@"Minus",R.Member(s.Get(@"all"),@"Length"),s.Get(@"i"))}));
s.Set(@"slice",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+INPUT[]",s.Get(@"len")}),null));
R.Emit(o,R.Invoke(R.Type(@"Array"),@"Copy",new object[]{s.Get(@"all"),s.Get(@"i"),s.Get(@"slice"),0,s.Get(@"len")}));
s.Set(@"sent",R.Binary(s,@"Plus",s.Get(@"sent"),R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{s.Get(@"slice")})));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"delay"),0))){R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),s.Get(@"delay")}),null));}}catch(ContinueFlow){}catch(BreakFlow){break;}s.Set(@"i",R.Binary(s,@"Plus",s.Get(@"i"),s.Get(@"chunk")));}}
s.Set(@"delivery",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sent"),s.Get(@"expectedEvents"),(""+@"typing "+R.Str(s.Get(@"count"))+@" character(s)"),@"the typed text"}),null));
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"type",new Named(@"Hwnd",R.Switch),R.Member(s.Get(@"Arg"),@"intoHwnd")}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"typed",s.Get(@"count"),@"events",s.Get(@"sent"),@"expectedEvents",s.Get(@"expectedEvents"),@"skipped",s.Get(@"skipped"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null)})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_416(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Invoke(R.Invoke(s.Get(@"_"),@"Trim",new object[]{}),@"ToLowerInvariant",new object[]{}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_417(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ine",s.Get(@"_"),@""));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_KeyVkList_414(Scope s,Args a){var o=new List<object>();s.Set(@"chord",R.Bind(a,0,@"chord",()=>null,@"string"));
try{if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"chord")}))){throw R.Error(@"a key chord such as 'ctrl+c' is required");}
s.Set(@"parts",R.Array(R.Capture((o415) => {R.Emit(o415,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_417)}),R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_416)}),R.Binary(s,@"Isplit",s.Get(@"chord"),@"\+"))));})));
s.Set(@"vks",R.Array(R.Capture((o418) => {})));
foreach(var item419 in R.Array(s.Get(@"parts"))){s.Set(@"p",item419);try{if(R.Bool(R.Invoke(s.Get(@"VK"),@"ContainsKey",new object[]{s.Get(@"p")}))){s.Set(@"vks",R.Binary(s,@"Plus",s.Get(@"vks"),R.Cast(@"int",R.Index(s.Get(@"VK"),s.Get(@"p")))));
throw new ContinueFlow();}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"p"),@"Length"),1))){s.Set(@"vks",R.Binary(s,@"Plus",s.Get(@"vks"),R.Cast(@"int",R.Cast(@"char",R.Invoke(R.Type(@"char"),@"ToUpperInvariant",new object[]{R.Index(s.Get(@"p"),0)})))));
throw new ContinueFlow();}
throw R.Error((""+@"unknown key name '"+R.Str(s.Get(@"p"))+@"'"));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"vks"),@"Count"),8))){throw R.Error((""+@"a chord holds at most 8 keys; got "+R.Str(R.Capture((o420) => {R.Emit(o420,R.Member(s.Get(@"vks"),@"Count"));}))+@" in '"+R.Str(s.Get(@"chord"))+@"'"));}
throw new ReturnFlow(new object[]{s.Get(@"vks")});}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Send_Modifiers_421(Scope s,Args a){var o=new List<object>();s.Set(@"vks",R.Bind(a,0,@"vks",()=>null,@"int[]"));
s.Set(@"down",R.Bind(a,1,@"down",()=>null,@"bool"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"vks"))) || R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"vks"),@"Count"),0))))){throw new ReturnFlow(0);}
s.Set(@"events",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[DshNative+INPUT]"}),null));
s.Set(@"order",R.Array(R.Capture((o422) => {R.Emit(o422,s.Get(@"vks"));})));
if(R.Bool(R.Unary(@"Not",s.Get(@"down")))){R.Emit(o,R.Invoke(R.Type(@"array"),@"Reverse",new object[]{s.Get(@"order")}));}
foreach(var item423 in R.Array(s.Get(@"order"))){s.Set(@"vk",item423);try{s.Set(@"f",0);
if(R.Bool(R.Unary(@"Not",s.Get(@"down")))){s.Set(@"f",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP"));}
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"EXTENDED"),s.Get(@"vk")))){s.Set(@"f",R.Binary(s,@"Bor",s.Get(@"f"),R.Member(R.Type(@"DshNative"),@"KEYEVENTF_EXTENDEDKEY")));}
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",s.Get(@"vk")),0,R.Cast(@"uint32",s.Get(@"f"))})}));
if(R.Bool(s.Get(@"down"))){R.Emit(o,R.Call(s,@"Add-HeldKey",new Args(new object[]{s.Get(@"vk")}),null));}else{R.Emit(o,R.Call(s,@"Remove-HeldKey",new Args(new object[]{s.Get(@"vk")}),null));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"sent",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{s.Get(@"events")}));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sent"),R.Member(s.Get(@"events"),@"Count"),(""+@"the modifier chord "+R.Str(R.Capture((o424) => {if(R.Bool(s.Get(@"down"))){R.Emit(o424,@"down");}else{R.Emit(o424,@"up");}}))),@"the modifier"}),null)));
throw new ReturnFlow(s.Get(@"sent"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Key_425(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before the key press"}),null));
s.Set(@"chord",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"keys")));
s.Set(@"vks",R.Call(s,@"Get-KeyVkList",new Args(new object[]{s.Get(@"chord")}),null));
R.Emit(o,R.Call(s,@"Assert-ExpectedForeground",new Args(new object[]{R.Member(s.Get(@"Arg"),@"intoHwnd"),(""+@"the key press '"+R.Str(s.Get(@"chord"))+@"'")}),null));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Assert-InjectableForeground",new Args(new object[]{(""+@"the key press '"+R.Str(s.Get(@"chord"))+@"'")}),null)));
s.Set(@"repeat",1);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"repeat")))){s.Set(@"repeat",R.Invoke(R.Type(@"Math"),@"Min",new object[]{100,R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"repeat"))})}));}
s.Set(@"holdMs",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"holdMs")))){s.Set(@"holdMs",R.Invoke(R.Type(@"Math"),@"Min",new object[]{10000,R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"holdMs"))})}));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"holdMs"),0))){s.Set(@"down",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[DshNative+INPUT]"}),null));
foreach(var item426 in R.Array(s.Get(@"vks"))){s.Set(@"vk",item426);try{s.Set(@"f",0);
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"EXTENDED"),s.Get(@"vk")))){s.Set(@"f",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_EXTENDEDKEY"));}
R.Emit(o,R.Invoke(s.Get(@"down"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",s.Get(@"vk")),0,R.Cast(@"uint32",s.Get(@"f"))})}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"up",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[DshNative+INPUT]"}),null));
{s.Set(@"i",R.Binary(s,@"Minus",R.Member(s.Get(@"vks"),@"Count"),1));while(R.Bool(R.Binary(s,@"Ige",s.Get(@"i"),0))){try{s.Set(@"f",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP"));
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"EXTENDED"),R.Index(s.Get(@"vks"),s.Get(@"i"))))){s.Set(@"f",R.Binary(s,@"Bor",s.Get(@"f"),R.Member(R.Type(@"DshNative"),@"KEYEVENTF_EXTENDEDKEY")));}
R.Emit(o,R.Invoke(s.Get(@"up"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",R.Index(s.Get(@"vks"),s.Get(@"i"))),0,R.Cast(@"uint32",s.Get(@"f"))})}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u427=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Minus",u427,1L));return u427;}));}}
s.Set(@"sentDown",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Invoke(s.Get(@"down"),@"ToArray",new object[]{})}));
s.Set(@"deliveryDown",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sentDown"),R.Member(s.Get(@"down"),@"Count"),(""+@"the held key chord '"+R.Str(s.Get(@"chord"))+@"' (down)"),@"the key hold"}),null));
foreach(var item428 in R.Array(s.Get(@"vks"))){s.Set(@"vk",item428);try{R.Emit(o,R.Call(s,@"Add-HeldKey",new Args(new object[]{s.Get(@"vk")}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}}
try{R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{s.Get(@"holdMs")}),null));}finally{s.Set(@"sentUp",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Invoke(s.Get(@"up"),@"ToArray",new object[]{})}));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"sentUp"),0))){foreach(var item429 in R.Array(s.Get(@"vks"))){s.Set(@"vk",item429);try{R.Emit(o,R.Call(s,@"Remove-HeldKey",new Args(new object[]{s.Get(@"vk")}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}}}}
s.Set(@"deliveryUp",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sentUp"),R.Member(s.Get(@"up"),@"Count"),(""+@"the held key chord '"+R.Str(s.Get(@"chord"))+@"' (release)"),@"the key release"}),null));
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"key",new Named(@"Hwnd",R.Switch),R.Member(s.Get(@"Arg"),@"intoHwnd")}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"keys",s.Get(@"chord"),@"repeat",1,@"heldMs",s.Get(@"holdMs"),@"events",R.Binary(s,@"Plus",s.Get(@"sentDown"),s.Get(@"sentUp")),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null)})));}
s.Set(@"events",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[DshNative+INPUT]"}),null));
{s.Set(@"r",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"r"),s.Get(@"repeat")))){try{{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Binary(s,@"Minus",R.Member(s.Get(@"vks"),@"Count"),1)))){try{s.Set(@"f",0);
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"EXTENDED"),R.Index(s.Get(@"vks"),s.Get(@"i"))))){s.Set(@"f",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_EXTENDEDKEY"));}
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",R.Index(s.Get(@"vks"),s.Get(@"i"))),0,R.Cast(@"uint32",s.Get(@"f"))})}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u430=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u430,1L));return u430;}));}}
s.Set(@"last",R.Index(s.Get(@"vks"),R.Binary(s,@"Minus",R.Member(s.Get(@"vks"),@"Count"),1)));
s.Set(@"lf",0);
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"EXTENDED"),s.Get(@"last")))){s.Set(@"lf",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_EXTENDEDKEY"));}
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",s.Get(@"last")),0,R.Cast(@"uint32",s.Get(@"lf"))})}));
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",s.Get(@"last")),0,R.Cast(@"uint32",R.Binary(s,@"Bor",s.Get(@"lf"),R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP")))})}));
{s.Set(@"i",R.Binary(s,@"Minus",R.Member(s.Get(@"vks"),@"Count"),2));while(R.Bool(R.Binary(s,@"Ige",s.Get(@"i"),0))){try{s.Set(@"f",R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP"));
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"EXTENDED"),R.Index(s.Get(@"vks"),s.Get(@"i"))))){s.Set(@"f",R.Binary(s,@"Bor",s.Get(@"f"),R.Member(R.Type(@"DshNative"),@"KEYEVENTF_EXTENDEDKEY")));}
R.Emit(o,R.Invoke(s.Get(@"events"),@"Add",new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{R.Cast(@"uint16",R.Index(s.Get(@"vks"),s.Get(@"i"))),0,R.Cast(@"uint32",s.Get(@"f"))})}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u431=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Minus",u431,1L));return u431;}));}}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u432=s.Get(@"r");s.Set(@"r",R.Binary(s,@"Plus",u432,1L));return u432;}));}}
s.Set(@"sent",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{R.Invoke(s.Get(@"events"),@"ToArray",new object[]{})}));
s.Set(@"delivery",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sent"),R.Member(s.Get(@"events"),@"Count"),(""+@"the key press '"+R.Str(s.Get(@"chord"))+@"'"),@"the key press"}),null));
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"key",new Named(@"Hwnd",R.Switch),R.Member(s.Get(@"Arg"),@"intoHwnd")}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"keys",s.Get(@"chord"),@"repeat",s.Get(@"repeat"),@"heldMs",0,@"events",s.Get(@"sent"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null)})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ClipboardText_433(Scope s,Args a){var o=new List<object>();
try{s.Set(@"last",s.Get(@"null"));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"CLIPBOARD_ATTEMPTS")))){try{try{throw new ReturnFlow(R.Cast(@"string",R.Call(s,@"Get-Clipboard",new Args(new object[]{new Named(@"Raw",R.Switch),new Named(@"ErrorAction",R.Switch),@"Stop"}),null)));}catch(Exception error434) when (!(error434 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error434}));s.Set(@"last",s.Get(@"_"));}
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),s.Get(@"CLIPBOARD_RETRY_MS")}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u435=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u435,1L));return u435;}));}}
throw R.Error((""+@"the clipboard is held open by another application and could not be read ("+R.Str(R.Capture((o436) => {R.Emit(o436,R.Member(R.Member(s.Get(@"last"),@"Exception"),@"Message"));}))+@")"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Set_ClipboardText_437(Scope s,Args a){var o=new List<object>();s.Set(@"text",R.Bind(a,0,@"text",()=>null,@"string"));
try{s.Set(@"last",s.Get(@"null"));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"CLIPBOARD_ATTEMPTS")))){try{try{if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{s.Get(@"text")}))){R.Emit(o,R.Invoke(R.Type(@"System.Windows.Forms.Clipboard"),@"Clear",new object[]{}));}else{R.Emit(o,R.Call(s,@"Set-Clipboard",new Args(new object[]{new Named(@"Value",R.Switch),s.Get(@"text"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));}
throw new ReturnFlow(null);}catch(Exception error438) when (!(error438 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error438}));s.Set(@"last",s.Get(@"_"));}
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),s.Get(@"CLIPBOARD_RETRY_MS")}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u439=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u439,1L));return u439;}));}}
throw R.Error((""+@"the clipboard is held open by another application and could not be written ("+R.Str(R.Capture((o440) => {R.Emit(o440,R.Member(R.Member(s.Get(@"last"),@"Exception"),@"Message"));}))+@")"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Clipboard_441(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"op",(""+R.Str(R.Capture((o442) => {R.Emit(o442,R.Member(s.Get(@"Arg"),@"op"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"op"),@"set"))){s.Set(@"text",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"text")));
R.Emit(o,R.Call(s,@"Set-ClipboardText",new Args(new object[]{s.Get(@"text")}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"op",@"set",@"length",R.Member(s.Get(@"text"),@"Length"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null)})));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"op"),@"get"))){s.Set(@"v",R.Call(s,@"Get-ClipboardText",new Args(new object[]{}),null));
s.Set(@"truncated",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"v"),@"Length"),s.Get(@"CLIPBOARD_MAX_CHARS")))){s.Set(@"v",R.Invoke(s.Get(@"v"),@"Substring",new object[]{0,s.Get(@"CLIPBOARD_MAX_CHARS")}));
s.Set(@"truncated",s.Get(@"true"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"op",@"get",@"text",s.Get(@"v"),@"length",R.Member(s.Get(@"v"),@"Length"),@"truncated",s.Get(@"truncated")})));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"op"),@"clear"))){R.Emit(o,R.Call(s,@"Set-ClipboardText",new Args(new object[]{@""}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"op",@"clear",@"length",0})));}
throw R.Error(@"clipboard op must be 'get', 'set' or 'clear'");}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Send_CtrlV_443(Scope s,Args a){var o=new List<object>();
try{s.Set(@"events",R.Array(R.Capture((o444) => {R.Emit(o444,new object[]{R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{17,0,0}),R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{86,0,0}),R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{86,0,R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP")}),R.Invoke(R.Type(@"DshNative"),@"Key",new object[]{17,0,R.Member(R.Type(@"DshNative"),@"KEYEVENTF_KEYUP")})});})));
s.Set(@"sent",R.Invoke(R.Type(@"DshNative"),@"Send",new object[]{s.Get(@"events")}));
s.Set(@"delivery",R.Call(s,@"Assert-InputDelivered",new Args(new object[]{s.Get(@"sent"),R.Member(s.Get(@"events"),@"Count"),@"the paste (ctrl+v)",@"the paste"}),null));
throw new ReturnFlow(s.Get(@"sent"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_TextFingerprint_445(Scope s,Args a){var o=new List<object>();s.Set(@"text",R.Bind(a,0,@"text",()=>null,@"string"));
try{if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{s.Get(@"text")}))){throw new ReturnFlow(@"");}
s.Set(@"sha",R.Invoke(R.Type(@"System.Security.Cryptography.SHA256"),@"Create",new object[]{}));
try{s.Set(@"bytes",R.Invoke(R.Member(R.Type(@"System.Text.Encoding"),@"UTF8"),@"GetBytes",new object[]{s.Get(@"text")}));
throw new ReturnFlow(R.Invoke(R.Invoke(R.Invoke(R.Invoke(R.Type(@"BitConverter"),@"ToString",new object[]{R.Invoke(s.Get(@"sha"),@"ComputeHash",new object[]{s.Get(@"bytes")})}),@"Replace",new object[]{@"-",@""}),@"Substring",new object[]{0,16}),@"ToLowerInvariant",new object[]{}));}finally{R.Emit(o,R.Invoke(s.Get(@"sha"),@"Dispose",new object[]{}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_449(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"string",s.Get(@"_")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_452(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"_"),@"Text")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"_"),@"UnicodeText")))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"_"),@"System.String")))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"_"),@"Locale"))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ClipboardShape_446(Scope s,Args a){var o=new List<object>();
try{s.Set(@"last",s.Get(@"null"));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"CLIPBOARD_ATTEMPTS")))){try{try{s.Set(@"data",R.Invoke(R.Type(@"System.Windows.Forms.Clipboard"),@"GetDataObject",new object[]{}));
s.Set(@"formats",R.Array(R.Capture((o447) => {})));
s.Set(@"isText",s.Get(@"false"));
s.Set(@"text",@"");
s.Set(@"present",R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"data")));
if(R.Bool(s.Get(@"present"))){s.Set(@"formats",R.Array(R.Capture((o448) => {R.Emit(o448,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_449)}),R.Invoke(s.Get(@"data"),@"GetFormats",new object[]{})));})));
s.Set(@"isText",R.Invoke(R.Type(@"System.Windows.Forms.Clipboard"),@"ContainsText",new object[]{}));
if(R.Bool(s.Get(@"isText"))){s.Set(@"text",R.Cast(@"string",R.Invoke(R.Type(@"System.Windows.Forms.Clipboard"),@"GetText",new object[]{})));}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"present",s.Get(@"present"),@"empty",(R.Bool(R.Unary(@"Not",s.Get(@"present"))) || R.Bool(R.Binary(s,@"Ieq",R.Member(R.Array(R.Capture((o450) => {R.Emit(o450,s.Get(@"formats"));})),@"Count"),0))),@"isText",s.Get(@"isText"),@"text",s.Get(@"text"),@"length",R.Member(s.Get(@"text"),@"Length"),@"fingerprint",R.Call(s,@"Get-TextFingerprint",new Args(new object[]{s.Get(@"text")}),null),@"formats",s.Get(@"formats"),@"unsaveable",R.Array(R.Capture((o451) => {R.Emit(o451,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_452)}),s.Get(@"formats")));})),@"seq",R.Cast(@"int64",R.Invoke(R.Type(@"DshNative"),@"GetClipboardSequenceNumber",new object[]{}))})));}catch(Exception error453) when (!(error453 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error453}));s.Set(@"last",s.Get(@"_"));}
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),s.Get(@"CLIPBOARD_RETRY_MS")}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u454=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u454,1L));return u454;}));}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"present",s.Get(@"false"),@"empty",s.Get(@"false"),@"isText",s.Get(@"false"),@"text",@"",@"length",0,@"fingerprint",@"",@"formats",R.Array(R.Capture((o455) => {})),@"unsaveable",R.Array(R.Capture((o456) => {})),@"seq",R.Cast(@"int64",-1),@"note",(""+@"the clipboard is held open by another application and could not be read ("+R.Str(R.Capture((o457) => {R.Emit(o457,R.Member(R.Member(s.Get(@"last"),@"Exception"),@"Message"));}))+@")")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_PasteVerification_458(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"text",R.Bind(a,1,@"text",()=>null,@"string"));
try{s.Set(@"verify",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),@"verify"}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"verify")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"hwnd",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"verify"),@"hwnd"}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"hwnd"))) || R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",s.Get(@"hwnd")),0))))){s.Set(@"intoHwnd",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),@"intoHwnd"}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"intoHwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",s.Get(@"intoHwnd")),0))))){s.Set(@"hwnd",R.Cast(@"int64",s.Get(@"intoHwnd")));}else{s.Set(@"hwnd",0);}}
s.Set(@"ref",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"verify"),@"ref"}),null));
s.Set(@"selector",R.Cast(@"ordered",R.Map(new object[]{@"automationId",@"",@"name",@"",@"controlType",@"",@"className",@"",@"index",0})));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"ref"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"ref"))),@""))))){s.Set(@"resolved",R.Call(s,@"Resolve-ElementRef",new Args(new object[]{(""+R.Str(s.Get(@"ref")))}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"resolved"),@"ok")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"unknown",@"note",(""+R.Str(R.Capture((o459) => {R.Emit(o459,R.Member(s.Get(@"resolved"),@"error"));})))})));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"hwnd")))){s.Set(@"hwnd",R.Cast(@"int64",R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"hwnd")));}
R.SetIndex(s.Get(@"selector"),@"automationId",(""+R.Str(R.Capture((o460) => {R.Emit(o460,R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"automationId"));}))));
R.SetIndex(s.Get(@"selector"),@"name",(""+R.Str(R.Capture((o461) => {R.Emit(o461,R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"name"));}))));
R.SetIndex(s.Get(@"selector"),@"controlType",(""+R.Str(R.Capture((o462) => {R.Emit(o462,R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"controlType"));}))));
R.SetIndex(s.Get(@"selector"),@"className",(""+R.Str(R.Capture((o463) => {R.Emit(o463,R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"className"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"index")))){R.SetIndex(s.Get(@"selector"),@"index",R.Cast(@"int",R.Member(R.Member(s.Get(@"resolved"),@"selector"),@"index")));}}else{foreach(var item464 in R.Array(R.Array(R.Capture((o465) => {R.Emit(o465,new object[]{R.Array(R.Capture((o466) => {R.Emit(o466,new object[]{@"automationId",@"automation_id"});})),R.Array(R.Capture((o467) => {R.Emit(o467,new object[]{@"name",@"name"});})),R.Array(R.Capture((o468) => {R.Emit(o468,new object[]{@"controlType",@"control_type"});})),R.Array(R.Capture((o469) => {R.Emit(o469,new object[]{@"className",@"class_name"});})),R.Array(R.Capture((o470) => {R.Emit(o470,new object[]{@"index",@"index"});}))});})))){s.Set(@"pair",item464);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"verify"),R.Index(s.Get(@"pair"),0)}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"value")))){s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"verify"),R.Index(s.Get(@"pair"),1)}),null));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"value"))),@""))))){R.SetIndex(s.Get(@"selector"),R.Index(s.Get(@"pair"),0),s.Get(@"value"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),0))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"unknown",@"note",@"no window to verify against: pass verify.hwnd (or into_hwnd) with the control to read back"})));}
s.Set(@"budget",R.Invoke(R.Type(@"Math"),@"Max",new object[]{400,R.Binary(s,@"Plus",R.Member(s.Get(@"text"),@"Length"),128)}));
s.Set(@"record",s.Get(@"null"));
try{s.Set(@"record",R.Invoke(R.Type(@"DshUia.Engine"),@"ReadTextObservation",new object[]{R.Cast(@"int64",s.Get(@"hwnd")),(""+R.Str(R.Capture((o471) => {R.Emit(o471,R.Index(s.Get(@"selector"),@"automationId"));}))),(""+R.Str(R.Capture((o472) => {R.Emit(o472,R.Index(s.Get(@"selector"),@"name"));}))),(""+R.Str(R.Capture((o473) => {R.Emit(o473,R.Index(s.Get(@"selector"),@"controlType"));}))),(""+R.Str(R.Capture((o474) => {R.Emit(o474,R.Index(s.Get(@"selector"),@"className"));}))),R.Cast(@"int",R.Cast(@"int",R.Index(s.Get(@"selector"),@"index"))),s.Get(@"false"),s.Get(@"true"),s.Get(@"false"),s.Get(@"true"),s.Get(@"budget")}));}catch(Exception error475) when (!(error475 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error475}));throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"unknown",@"note",(""+@"the control could not be read back to verify the paste: "+R.Str(R.Capture((o476) => {R.Emit(o476,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));})))})));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o477) => {R.Emit(o477,R.Index(s.Get(@"record"),@"status"));}))),@"ok"))){s.Set(@"note",(""+R.Str(R.Capture((o478) => {R.Emit(o478,R.Index(s.Get(@"record"),@"note"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"note"),@""))){s.Set(@"note",(""+R.Str(R.Capture((o479) => {R.Emit(o479,R.Index(s.Get(@"record"),@"error"));}))));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"unknown",@"note",(""+@"the control could not be read back to verify the paste: "+R.Str(s.Get(@"note")))})));}
s.Set(@"document",(""+R.Str(R.Capture((o480) => {R.Emit(o480,R.Index(s.Get(@"record"),@"document"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o481) => {R.Emit(o481,R.Index(s.Get(@"record"),@"documentStatus"));}))),@"ok")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"document"),@""))))){if(R.Bool(R.Binary(s,@"Ige",R.Invoke(s.Get(@"document"),@"IndexOf",new object[]{s.Get(@"text"),R.Member(R.Type(@"System.StringComparison"),@"Ordinal")}),0))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"verified",@"source",@"document",@"note",@"the pasted text is in the control"})));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"absent",@"source",@"document",@"note",@"the control was read and the pasted text was not in it"})));}
s.Set(@"summary",(""+R.Str(R.Capture((o482) => {R.Emit(o482,R.Index(s.Get(@"record"),@"focusedSummary"));}))));
if(R.Bool(R.Binary(s,@"Ige",R.Invoke(s.Get(@"summary"),@"IndexOf",new object[]{s.Get(@"text"),R.Member(R.Type(@"System.StringComparison"),@"Ordinal")}),0))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"verified",@"source",@"value",@"note",@"the pasted text is in the control value"})));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"status",@"unknown",@"note",@"the control exposes neither a document nor a readable value, so the paste could not be verified: check the result another way"})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Paste_483(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before the paste"}),null));
s.Set(@"text",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"text")));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{s.Get(@"text")}))){throw R.Error(@"paste requires text");}
R.Emit(o,R.Call(s,@"Assert-ExpectedForeground",new Args(new object[]{R.Member(s.Get(@"Arg"),@"intoHwnd"),@"a paste"}),null));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Assert-InjectableForeground",new Args(new object[]{@"a paste"}),null)));
s.Set(@"restore",s.Get(@"true"));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"restore"),s.Get(@"false")))){s.Set(@"restore",s.Get(@"false"));}
s.Set(@"requireRestore",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"requireRestore"),s.Get(@"true")))){s.Set(@"requireRestore",s.Get(@"true"));}
s.Set(@"before",R.Call(s,@"Get-ClipboardShape",new Args(new object[]{}),null));
s.Set(@"unsaveable",R.Array(R.Capture((o484) => {R.Emit(o484,R.Member(s.Get(@"before"),@"unsaveable"));})));
if(R.Bool((R.Bool((R.Bool(s.Get(@"restore")) && R.Bool(R.Unary(@"Not",R.Member(s.Get(@"before"),@"ok"))))) && R.Bool(s.Get(@"requireRestore"))))){throw R.Error(@"[CLIPBOARD_BUSY] the clipboard is held open by another application, so its current content could not be saved, and require_restore was set: nothing was pasted. Retry in a moment, or leave require_restore out to accept that the clipboard will hold the pasted text afterwards.");}
if(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(s.Get(@"restore")) && R.Bool(R.Member(s.Get(@"before"),@"ok")))) && R.Bool(R.Unary(@"Not",R.Member(s.Get(@"before"),@"empty"))))) && R.Bool(R.Unary(@"Not",R.Member(s.Get(@"before"),@"isText"))))) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"unsaveable"),@"Count"),0)))) && R.Bool(s.Get(@"requireRestore"))))){throw R.Error((""+@"[RESTORE_UNSUPPORTED] the clipboard holds "+R.Str(R.Capture((o485) => {R.Emit(o485,R.Binary(s,@"Join",s.Get(@"unsaveable"),@", "));}))+@" and nothing readable as text, so it cannot be put back through this path, and require_restore was set: nothing was pasted. Pass require_restore: false to overwrite it deliberately, type the text with computer_type, or set the control's value with computer_ui_action set_value."));}
s.Set(@"seqAfterWrite",R.Cast(@"int64",-1));
s.Set(@"restoreStatus",@"not_requested");
s.Set(@"restoreNote",@"");
s.Set(@"sent",0);
s.Set(@"verification",s.Get(@"null"));
try{R.Emit(o,R.Call(s,@"Set-ClipboardText",new Args(new object[]{s.Get(@"text")}),null));
s.Set(@"seqAfterWrite",R.Cast(@"int64",R.Invoke(R.Type(@"DshNative"),@"GetClipboardSequenceNumber",new object[]{})));
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),40}),null));
s.Set(@"sent",R.Call(s,@"Send-CtrlV",new Args(new object[]{}),null));
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),180}),null));
s.Set(@"verification",R.Call(s,@"Get-PasteVerification",new Args(new object[]{s.Get(@"Arg"),s.Get(@"text")}),null));}finally{if(R.Bool(R.Unary(@"Not",s.Get(@"restore")))){s.Set(@"restoreStatus",@"not_requested");}else if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"before"),@"ok")))){s.Set(@"restoreStatus",@"failed_busy");
s.Set(@"restoreNote",(""+R.Str(R.Capture((o486) => {R.Emit(o486,R.Member(s.Get(@"before"),@"note"));}))));}else{s.Set(@"now",R.Call(s,@"Get-ClipboardShape",new Args(new object[]{}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"now"),@"ok")))){s.Set(@"restoreStatus",@"failed_busy");
s.Set(@"restoreNote",(""+R.Str(R.Capture((o487) => {R.Emit(o487,R.Member(s.Get(@"now"),@"note"));}))));}else if(R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"now"),@"seq")),s.Get(@"seqAfterWrite")))){if(R.Bool((R.Bool((R.Bool(R.Member(s.Get(@"before"),@"isText")) && R.Bool(R.Unary(@"Not",R.Member(s.Get(@"before"),@"empty"))))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"unsaveable"),@"Count"),0))))){s.Set(@"restoreNote",(""+@"the clipboard changed after this paste (sequence "+R.Str(R.Capture((o488) => {R.Emit(o488,s.Get(@"seqAfterWrite"));}))+@" -> "+R.Str(R.Capture((o489) => {R.Emit(o489,R.Cast(@"int64",R.Member(s.Get(@"now"),@"seq")));}))+@"), so the newer content was left in place instead of restoring what was borrowed"));}else{s.Set(@"restoreNote",(""+@"the clipboard changed after this paste (sequence "+R.Str(R.Capture((o490) => {R.Emit(o490,s.Get(@"seqAfterWrite"));}))+@" -> "+R.Str(R.Capture((o491) => {R.Emit(o491,R.Cast(@"int64",R.Member(s.Get(@"now"),@"seq")));}))+@"), and what was there before could not have been restored in full anyway ("+R.Str(R.Capture((o492) => {R.Emit(o492,R.Binary(s,@"Join",s.Get(@"unsaveable"),@", "));}))+@"); the newer content was left in place"));}
s.Set(@"restoreStatus",@"skipped_external_change");}else if(R.Bool((R.Bool(R.Unary(@"Not",R.Member(s.Get(@"before"),@"isText"))) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"unsaveable"),@"Count"),0))))){s.Set(@"restoreStatus",@"unsupported_original_format");
s.Set(@"restoreNote",(""+@"the clipboard held "+R.Str(R.Capture((o493) => {R.Emit(o493,R.Binary(s,@"Join",s.Get(@"unsaveable"),@", "));}))+@" before this paste and none of it can be written back through this path; the pasted text is there now (pass require_restore: true to have this refused before anything is written)"));}else{try{if(R.Bool(R.Member(s.Get(@"before"),@"empty"))){R.Emit(o,R.Call(s,@"Set-ClipboardText",new Args(new object[]{@""}),null));}else{R.Emit(o,R.Call(s,@"Set-ClipboardText",new Args(new object[]{R.Member(s.Get(@"before"),@"text")}),null));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"unsaveable"),@"Count"),0))){s.Set(@"restoreStatus",@"unsupported_original_format");
s.Set(@"restoreNote",(""+@"the text that was on the clipboard is back, but these formats could not be saved or restored through this path and are gone: "+R.Str(R.Capture((o494) => {R.Emit(o494,R.Binary(s,@"Join",s.Get(@"unsaveable"),@", "));}))));}else{s.Set(@"restoreStatus",@"restored");}}catch(Exception error495) when (!(error495 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error495}));s.Set(@"restoreStatus",@"failed_other");
s.Set(@"restoreNote",(""+R.Str(R.Capture((o496) => {R.Emit(o496,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));}}}}
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"paste",new Named(@"Hwnd",R.Switch),R.Member(s.Get(@"Arg"),@"intoHwnd")}),null));
s.Set(@"receipt",R.Cast(@"ordered",R.Map(new object[]{@"pasted",R.Member(s.Get(@"text"),@"Length"),@"restored",R.Binary(s,@"Ieq",s.Get(@"restoreStatus"),@"restored"),@"savedUser",(R.Bool((R.Bool((R.Bool(s.Get(@"restore")) && R.Bool(R.Member(s.Get(@"before"),@"ok")))) && R.Bool(R.Member(s.Get(@"before"),@"isText")))) && R.Bool(R.Unary(@"Not",R.Member(s.Get(@"before"),@"empty")))),@"restoreStatus",s.Get(@"restoreStatus"),@"eventsSent",s.Get(@"sent"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null),@"clipboard",R.Cast(@"ordered",R.Map(new object[]{@"formatsBefore",R.Array(R.Capture((o497) => {R.Emit(o497,R.Member(s.Get(@"before"),@"formats"));})),@"seqBefore",R.Cast(@"int64",R.Member(s.Get(@"before"),@"seq")),@"seqAfterWrite",R.Cast(@"int64",s.Get(@"seqAfterWrite"))}))})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"restoreNote"),@""))){R.SetIndex(s.Get(@"receipt"),@"restoreNote",s.Get(@"restoreNote"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"verification")))){R.SetIndex(s.Get(@"receipt"),@"pasteVerification",s.Get(@"verification"));}
throw new ReturnFlow(s.Get(@"receipt"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_505(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"ordered",R.Map(new object[]{@"name",(""+R.Str(R.Capture((o506) => {R.Emit(o506,R.Member(s.Get(@"_"),@"BaseName"));}))),@"path",(""+R.Str(R.Capture((o507) => {R.Emit(o507,R.Member(s.Get(@"_"),@"FullName"));})))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_513(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"ordered",R.Map(new object[]{@"name",(""+R.Str(R.Capture((o514) => {R.Emit(o514,R.Member(s.Get(@"_"),@"Name"));}))),@"appId",(""+R.Str(R.Capture((o515) => {R.Emit(o515,R.Member(s.Get(@"_"),@"AppID"));})))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_AppDiscovery_498(Scope s,Args a){var o=new List<object>();s.Set(@"refresh",R.Bind(a,0,@"refresh",()=>s.Get(@"false"),@"bool"));
try{s.Set(@"now",R.Member(R.Type(@"DateTime"),@"UtcNow"));
s.Set(@"state",s.Get(@"script:AppDiscovery"));
if(R.Bool((R.Bool((R.Bool(s.Get(@"refresh")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"state"),@"startMenu"))))) || R.Bool(R.Binary(s,@"Igt",R.Member(R.Binary(s,@"Minus",s.Get(@"now"),R.Member(s.Get(@"state"),@"startMenuAt")),@"TotalSeconds"),60))))){s.Set(@"entries",R.Array(R.Capture((o499) => {})));
foreach(var item500 in R.Array(R.Array(R.Capture((o501) => {R.Emit(o501,new object[]{R.Call(s,@"Join-Path",new Args(new object[]{s.Get(@"env:ProgramData"),@"Microsoft\Windows\Start Menu\Programs"}),null),R.Call(s,@"Join-Path",new Args(new object[]{s.Get(@"env:AppData"),@"Microsoft\Windows\Start Menu\Programs"}),null)});})))){s.Set(@"root",item500);try{if(R.Bool(R.Unary(@"Not",R.Call(s,@"Test-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"root")}),null)))){throw new ContinueFlow();}
try{s.Set(@"entries",R.Binary(s,@"Plus",s.Get(@"entries"),R.Array(R.Capture((o502) => {R.Emit(o502,R.Call(s,@"Get-ChildItem",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"root"),new Named(@"Recurse",R.Switch),new Named(@"Filter",R.Switch),@"*.lnk",new Named(@"ErrorAction",R.Switch),@"SilentlyContinue"}),null));}))));}catch(Exception error503) when (!(error503 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error503}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetMember(s.Get(@"state"),@"startMenu",R.Array(R.Capture((o504) => {R.Emit(o504,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_505)}),s.Get(@"entries")));})));
R.SetMember(s.Get(@"state"),@"startMenuAt",s.Get(@"now"));}
if(R.Bool((R.Bool((R.Bool(s.Get(@"refresh")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"state"),@"startApps"))))) || R.Bool(R.Binary(s,@"Igt",R.Member(R.Binary(s,@"Minus",s.Get(@"now"),R.Member(s.Get(@"state"),@"startAppsAt")),@"TotalSeconds"),60))))){s.Set(@"apps",R.Array(R.Capture((o508) => {})));
try{s.Set(@"apps",R.Array(R.Capture((o509) => {R.Emit(o509,R.Call(s,@"Get-StartApps",new Args(new object[]{new Named(@"ErrorAction",R.Switch),@"Stop"}),null));})));}catch(Exception error510) when (!(error510 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error510}));s.Set(@"apps",R.Array(R.Capture((o511) => {})));}
R.SetMember(s.Get(@"state"),@"startApps",R.Array(R.Capture((o512) => {R.Emit(o512,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_513)}),s.Get(@"apps")));})));
R.SetMember(s.Get(@"state"),@"startAppsAt",s.Get(@"now"));}
if(R.Bool((R.Bool((R.Bool(s.Get(@"refresh")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"state"),@"usage"))))) || R.Bool(R.Binary(s,@"Igt",R.Member(R.Binary(s,@"Minus",s.Get(@"now"),R.Member(s.Get(@"state"),@"usageAt")),@"TotalSeconds"),120))))){s.Set(@"usage",R.Map(new object[]{}));
s.Set(@"known",s.Get(@"false"));
try{s.Set(@"key",@"HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\AppSwitched");
if(R.Bool(R.Call(s,@"Test-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"key")}),null))){s.Set(@"item",R.Call(s,@"Get-ItemProperty",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"key"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));
foreach(var item516 in R.Array(R.Member(R.Member(s.Get(@"item"),@"PSObject"),@"Properties"))){s.Set(@"property",item516);try{if(R.Bool(R.Binary(s,@"Ilike",(""+R.Str(R.Capture((o517) => {R.Emit(o517,R.Member(s.Get(@"property"),@"Name"));}))),@"PS*"))){throw new ContinueFlow();}
s.Set(@"count",0);
if(R.Bool(R.Invoke(R.Type(@"int"),@"TryParse",new object[]{(""+R.Str(R.Capture((o518) => {R.Emit(o518,R.Member(s.Get(@"property"),@"Value"));}))),new Ref(()=>s.Get(@"count"),v=>{s.Set(@"count",v);})}))){R.SetIndex(s.Get(@"usage"),(""+R.Str(R.Capture((o519) => {R.Emit(o519,R.Member(s.Get(@"property"),@"Name"));}))),s.Get(@"count"));
s.Set(@"known",s.Get(@"true"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}}catch(Exception error520) when (!(error520 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error520}));s.Set(@"known",s.Get(@"false"));}
R.SetMember(s.Get(@"state"),@"usage",s.Get(@"usage"));
R.SetMember(s.Get(@"state"),@"usageKnown",s.Get(@"known"));
R.SetMember(s.Get(@"state"),@"usageAt",s.Get(@"now"));}
throw new ReturnFlow(s.Get(@"state"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_RunningProcessMap_521(Scope s,Args a){var o=new List<object>();
try{s.Set(@"now",R.Member(R.Type(@"DateTime"),@"UtcNow"));
s.Set(@"state",s.Get(@"script:AppDiscovery"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"state"),@"processes"))) && R.Bool(R.Binary(s,@"Ilt",R.Member(R.Binary(s,@"Minus",s.Get(@"now"),R.Member(s.Get(@"state"),@"processesAt")),@"TotalSeconds"),2.5d))))){throw new ReturnFlow(R.Member(s.Get(@"state"),@"processes"));}
s.Set(@"map",R.Map(new object[]{}));
try{foreach(var item522 in R.Array(R.Array(R.Capture((o523) => {R.Emit(o523,R.Call(s,@"Get-Process",new Args(new object[]{new Named(@"ErrorAction",R.Switch),@"SilentlyContinue"}),null));})))){s.Set(@"process",item522);try{s.Set(@"name",R.Invoke((""+R.Str(R.Capture((o524) => {R.Emit(o524,R.Member(s.Get(@"process"),@"ProcessName"));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"name"),@""))){throw new ContinueFlow();}
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"map"),@"ContainsKey",new object[]{s.Get(@"name")})))){R.SetIndex(s.Get(@"map"),s.Get(@"name"),R.Array(R.Capture((o525) => {})));}
R.SetIndex(s.Get(@"map"),s.Get(@"name"),R.Binary(s,@"Plus",R.Array(R.Capture((o526) => {R.Emit(o526,R.Index(s.Get(@"map"),s.Get(@"name")));})),R.Array(R.Capture((o527) => {R.Emit(o527,R.Cast(@"int",R.Member(s.Get(@"process"),@"Id")));}))));}catch(ContinueFlow){}catch(BreakFlow){break;}}}catch(Exception error528) when (!(error528 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error528}));}
R.SetMember(s.Get(@"state"),@"processes",s.Get(@"map"));
R.SetMember(s.Get(@"state"),@"processesAt",s.Get(@"now"));
throw new ReturnFlow(s.Get(@"map"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_NameMatchScore_529(Scope s,Args a){var o=new List<object>();s.Set(@"name",R.Bind(a,0,@"name",()=>null,@"string"));
s.Set(@"target",R.Bind(a,1,@"target",()=>null,@"string"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"name"),s.Get(@"target")))){throw new ReturnFlow(100);}
s.Set(@"lowerName",R.Invoke(s.Get(@"name"),@"ToLowerInvariant",new object[]{}));
s.Set(@"lowerTarget",R.Invoke(s.Get(@"target"),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"lowerName"),s.Get(@"lowerTarget")))){throw new ReturnFlow(99);}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"lowerTarget"),@""))){throw new ReturnFlow(0);}
s.Set(@"extra",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Binary(s,@"Minus",R.Member(s.Get(@"name"),@"Length"),R.Member(s.Get(@"target"),@"Length"))}));
if(R.Bool(R.Invoke(s.Get(@"lowerName"),@"StartsWith",new object[]{s.Get(@"lowerTarget")}))){throw new ReturnFlow(R.Binary(s,@"Minus",80,R.Invoke(R.Type(@"Math"),@"Min",new object[]{30,s.Get(@"extra")})));}
if(R.Bool(R.Binary(s,@"Ige",R.Invoke(s.Get(@"lowerName"),@"IndexOf",new object[]{s.Get(@"lowerTarget")}),0))){throw new ReturnFlow(R.Binary(s,@"Minus",55,R.Invoke(R.Type(@"Math"),@"Min",new object[]{25,s.Get(@"extra")})));}
throw new ReturnFlow(0);}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_AppUsageCountFor_530(Scope s,Args a){var o=new List<object>();s.Set(@"exeName",R.Bind(a,0,@"exeName",()=>null,@"string"));
s.Set(@"label",R.Bind(a,1,@"label",()=>null,@"string"));
s.Set(@"discovery",R.Bind(a,2,@"discovery",()=>null,@"object"));
try{s.Set(@"result",R.Map(new object[]{@"count",0,@"known",s.Get(@"false")}));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"discovery"),@"usage"))) || R.Bool(R.Unary(@"Not",R.Member(s.Get(@"discovery"),@"usageKnown")))))){throw new ReturnFlow(s.Get(@"result"));}
s.Set(@"keys",R.Array(R.Capture((o531) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"exeName"),@""))){s.Set(@"keys",R.Binary(s,@"Plus",s.Get(@"keys"),(""+R.Str(s.Get(@"exeName"))+@".exe")));
s.Set(@"keys",R.Binary(s,@"Plus",s.Get(@"keys"),s.Get(@"exeName")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"label"),@""))){s.Set(@"keys",R.Binary(s,@"Plus",s.Get(@"keys"),(""+R.Str(s.Get(@"label"))+@".exe")));
s.Set(@"keys",R.Binary(s,@"Plus",s.Get(@"keys"),s.Get(@"label")));}
foreach(var item532 in R.Array(s.Get(@"keys"))){s.Set(@"key",item532);try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@"")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@".exe"))))){throw new ContinueFlow();}
if(R.Bool(R.Invoke(R.Member(s.Get(@"discovery"),@"usage"),@"ContainsKey",new object[]{s.Get(@"key")}))){R.SetMember(s.Get(@"result"),@"count",R.Cast(@"int",R.Index(R.Member(s.Get(@"discovery"),@"usage"),s.Get(@"key"))));
R.SetMember(s.Get(@"result"),@"known",s.Get(@"true"));
throw new ReturnFlow(s.Get(@"result"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"result"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_LaunchSignals_533(Scope s,Args a){var o=new List<object>();s.Set(@"resolution",R.Bind(a,0,@"resolution",()=>null,@"object"));
s.Set(@"basis",R.Bind(a,1,@"basis",()=>null,@"string"));
s.Set(@"refresh",R.Bind(a,2,@"refresh",()=>s.Get(@"false"),@"bool"));
try{s.Set(@"discovery",R.Call(s,@"Get-AppDiscovery",new Args(new object[]{s.Get(@"refresh")}),null));
s.Set(@"processes",R.Call(s,@"Get-RunningProcessMap",new Args(new object[]{}),null));
s.Set(@"exe",@"");
try{s.Set(@"exe",R.Invoke(R.Type(@"System.IO.Path"),@"GetFileNameWithoutExtension",new object[]{(""+R.Str(R.Capture((o534) => {R.Emit(o534,R.Member(s.Get(@"resolution"),@"file"));})))}));}catch(Exception error535) when (!(error535 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error535}));s.Set(@"exe",@"");}
s.Set(@"label",(""+R.Str(R.Capture((o536) => {R.Emit(o536,R.Member(s.Get(@"resolution"),@"label"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"exe"),@"")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"label"),@""))))){s.Set(@"exe",s.Get(@"label"));}
s.Set(@"running",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"exe"),@""))){s.Set(@"key",R.Invoke(s.Get(@"exe"),@"ToLowerInvariant",new object[]{}));
if(R.Bool((R.Bool(R.Invoke(s.Get(@"processes"),@"ContainsKey",new object[]{s.Get(@"key")})) && R.Bool(R.Binary(s,@"Igt",R.Member(R.Array(R.Capture((o537) => {R.Emit(o537,R.Index(s.Get(@"processes"),s.Get(@"key")));})),@"Count"),0))))){s.Set(@"running",s.Get(@"true"));}
if(R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"running"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"label"),@""))))){s.Set(@"labelKey",R.Invoke(s.Get(@"label"),@"ToLowerInvariant",new object[]{}));
if(R.Bool((R.Bool(R.Invoke(s.Get(@"processes"),@"ContainsKey",new object[]{s.Get(@"labelKey")})) && R.Bool(R.Binary(s,@"Igt",R.Member(R.Array(R.Capture((o538) => {R.Emit(o538,R.Index(s.Get(@"processes"),s.Get(@"labelKey")));})),@"Count"),0))))){s.Set(@"running",s.Get(@"true"));}}}
s.Set(@"usage",R.Call(s,@"Get-AppUsageCountFor",new Args(new object[]{s.Get(@"exe"),s.Get(@"label"),s.Get(@"discovery")}),null));
R.SetIndex(s.Get(@"resolution"),@"source",(""+R.Str(R.Capture((o539) => {R.Emit(o539,R.Member(s.Get(@"resolution"),@"kind"));}))));
R.SetIndex(s.Get(@"resolution"),@"isRunning",s.Get(@"running"));
R.SetIndex(s.Get(@"resolution"),@"useCount",R.Cast(@"int",R.Member(s.Get(@"usage"),@"count")));
R.SetIndex(s.Get(@"resolution"),@"useCountKnown",R.Cast(@"bool",R.Member(s.Get(@"usage"),@"known")));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"basis"),@""))){R.SetIndex(s.Get(@"resolution"),@"matchBasis",s.Get(@"basis"));}
throw new ReturnFlow(s.Get(@"resolution"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_553(Scope s,Args a){var o=new List<object>();
try{s.Set(@"running",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o554) => {R.Emit(o554,R.Member(s.Get(@"_"),@"exe"));}))),@""))){s.Set(@"key",R.Invoke((""+R.Str(R.Capture((o555) => {R.Emit(o555,R.Member(s.Get(@"_"),@"exe"));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Invoke(s.Get(@"processes"),@"ContainsKey",new object[]{s.Get(@"key")}))){s.Set(@"running",R.Binary(s,@"Igt",R.Member(R.Array(R.Capture((o556) => {R.Emit(o556,R.Index(s.Get(@"processes"),s.Get(@"key")));})),@"Count"),0));}}
s.Set(@"usage",R.Call(s,@"Get-AppUsageCountFor",new Args(new object[]{(""+R.Str(R.Capture((o557) => {R.Emit(o557,R.Member(s.Get(@"_"),@"exe"));}))),(""+R.Str(R.Capture((o558) => {R.Emit(o558,R.Member(s.Get(@"_"),@"label"));}))),s.Get(@"discovery")}),null));
R.SetMember(s.Get(@"_"),@"isRunning",s.Get(@"running"));
R.SetMember(s.Get(@"_"),@"useCount",R.Cast(@"int",R.Member(s.Get(@"usage"),@"count")));
R.SetMember(s.Get(@"_"),@"useCountKnown",R.Cast(@"bool",R.Member(s.Get(@"usage"),@"known")));
R.Emit(o,s.Get(@"_"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_559(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"int",R.Index(s.Get(@"_"),@"score")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_560(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"bool",R.Index(s.Get(@"_"),@"isRunning")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_561(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"int",R.Index(s.Get(@"_"),@"useCount")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_562(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(""+R.Str(R.Capture((o563) => {R.Emit(o563,R.Member(s.Get(@"_"),@"label"));}))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_565(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Index(s.Get(@"_"),@"score")),R.Cast(@"int",R.Index(s.Get(@"best"),@"score")))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"bool",R.Index(s.Get(@"_"),@"isRunning")),R.Cast(@"bool",R.Index(s.Get(@"best"),@"isRunning")))))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Index(s.Get(@"_"),@"useCount")),R.Cast(@"int",R.Index(s.Get(@"best"),@"useCount"))))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_566(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(""+@"'"+R.Str(R.Capture((o567) => {R.Emit(o567,R.Member(s.Get(@"_"),@"label"));}))+@"' ("+R.Str(R.Capture((o568) => {R.Emit(o568,R.Member(s.Get(@"_"),@"kind"));}))+@")"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_581(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ine",(""+R.Str(R.Capture((o582) => {R.Emit(o582,R.Member(s.Get(@"_"),@"label"));}))),(""+R.Str(R.Capture((o583) => {R.Emit(o583,R.Member(s.Get(@"best"),@"label"));})))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_584(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"ordered",R.Map(new object[]{@"label",(""+R.Str(R.Capture((o585) => {R.Emit(o585,R.Member(s.Get(@"_"),@"label"));}))),@"source",(""+R.Str(R.Capture((o586) => {R.Emit(o586,R.Member(s.Get(@"_"),@"kind"));}))),@"matchBasis",(""+@"name match (score "+R.Str(R.Capture((o587) => {R.Emit(o587,R.Index(s.Get(@"_"),@"score"));}))+@")"),@"isRunning",R.Cast(@"bool",R.Index(s.Get(@"_"),@"isRunning")),@"useCount",R.Cast(@"int",R.Index(s.Get(@"_"),@"useCount")),@"useCountKnown",R.Cast(@"bool",R.Index(s.Get(@"_"),@"useCountKnown"))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Resolve_LaunchTarget_540(Scope s,Args a){var o=new List<object>();s.Set(@"target",R.Bind(a,0,@"target",()=>null,@"string"));
s.Set(@"refresh",R.Bind(a,1,@"refresh",()=>s.Get(@"false"),@"bool"));
try{if(R.Bool(R.Call(s,@"Test-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"target")}),null))){throw new ReturnFlow(R.Call(s,@"Add-LaunchSignals",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"kind",@"path",@"file",R.Member(R.Call(s,@"Resolve-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"target")}),null),@"Path"),@"label",s.Get(@"target")})),@"explicit path",s.Get(@"refresh")}),null));}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ige",R.Invoke(s.Get(@"target"),@"IndexOf",new object[]{@"\"}),0)) || R.Bool(R.Binary(s,@"Ige",R.Invoke(s.Get(@"target"),@"IndexOf",new object[]{@"/"}),0)))) || R.Bool(R.Binary(s,@"Imatch",s.Get(@"target"),@"\.(exe|bat|cmd|com|lnk|url)$"))))){throw new ReturnFlow(R.Call(s,@"Add-LaunchSignals",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"kind",@"command",@"file",s.Get(@"target"),@"label",s.Get(@"target")})),@"explicit command",s.Get(@"refresh")}),null));}
s.Set(@"cmd",R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"First",R.Switch),1}),R.Call(s,@"Get-Command",new Args(new object[]{new Named(@"Name",R.Switch),s.Get(@"target"),new Named(@"CommandType",R.Switch),@"Application",new Named(@"ErrorAction",R.Switch),@"SilentlyContinue"}),null)));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"cmd")))){throw new ReturnFlow(R.Call(s,@"Add-LaunchSignals",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"kind",@"command",@"file",R.Member(s.Get(@"cmd"),@"Source"),@"label",s.Get(@"target")})),@"on PATH",s.Get(@"refresh")}),null));}
s.Set(@"discovery",R.Call(s,@"Get-AppDiscovery",new Args(new object[]{s.Get(@"refresh")}),null));
s.Set(@"processes",R.Call(s,@"Get-RunningProcessMap",new Args(new object[]{}),null));
s.Set(@"scored",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item541 in R.Array(R.Array(R.Capture((o542) => {R.Emit(o542,R.Member(s.Get(@"discovery"),@"startMenu"));})))){s.Set(@"entry",item541);try{s.Set(@"score",R.Call(s,@"Get-NameMatchScore",new Args(new object[]{(""+R.Str(R.Capture((o543) => {R.Emit(o543,R.Member(s.Get(@"entry"),@"name"));}))),s.Get(@"target")}),null));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"score"),0))){throw new ContinueFlow();}
R.Emit(o,R.Invoke(s.Get(@"scored"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"score",s.Get(@"score"),@"kind",@"shortcut",@"file",(""+R.Str(R.Capture((o544) => {R.Emit(o544,R.Member(s.Get(@"entry"),@"path"));}))),@"label",(""+R.Str(R.Capture((o545) => {R.Emit(o545,R.Member(s.Get(@"entry"),@"name"));}))),@"exe",(""+R.Str(R.Capture((o546) => {R.Emit(o546,R.Member(s.Get(@"entry"),@"name"));})))}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
foreach(var item547 in R.Array(R.Array(R.Capture((o548) => {R.Emit(o548,R.Member(s.Get(@"discovery"),@"startApps"));})))){s.Set(@"entry",item547);try{s.Set(@"score",R.Call(s,@"Get-NameMatchScore",new Args(new object[]{(""+R.Str(R.Capture((o549) => {R.Emit(o549,R.Member(s.Get(@"entry"),@"name"));}))),s.Get(@"target")}),null));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"score"),0))){throw new ContinueFlow();}
R.Emit(o,R.Invoke(s.Get(@"scored"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"score",s.Get(@"score"),@"kind",@"start-app",@"file",(""+R.Str(R.Capture((o550) => {R.Emit(o550,R.Member(s.Get(@"entry"),@"appId"));}))),@"label",(""+R.Str(R.Capture((o551) => {R.Emit(o551,R.Member(s.Get(@"entry"),@"name"));}))),@"exe",@""}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"scored"),@"Count"),0))){throw R.Error((""+@"could not find an application named '"+R.Str(s.Get(@"target"))+@"' (tried a path, PATH, the Start menu, and installed apps)"));}
s.Set(@"ranked",R.Array(R.Capture((o552) => {R.Emit(o552,R.Call(s,@"Sort-Object",new Args(new object[]{new Named(@"Property",R.Switch),new object[]{R.Map(new object[]{@"Expression",new Fn(s,Block_559),@"Descending",s.Get(@"true")}),R.Map(new object[]{@"Expression",new Fn(s,Block_560),@"Descending",s.Get(@"true")}),R.Map(new object[]{@"Expression",new Fn(s,Block_561),@"Descending",s.Get(@"true")}),R.Map(new object[]{@"Expression",new Fn(s,Block_562),@"Descending",s.Get(@"false")})}}),R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_553)}),R.Invoke(s.Get(@"scored"),@"ToArray",new object[]{}))));})));
s.Set(@"best",R.Index(s.Get(@"ranked"),0));
s.Set(@"tied",R.Array(R.Capture((o564) => {R.Emit(o564,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_565)}),s.Get(@"ranked")));})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"tied"),@"Count"),1))){s.Set(@"listed",R.Binary(s,@"Join",R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_566)}),R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"First",R.Switch),4}),s.Get(@"tied"))),@", "));
throw R.Error((""+@"[AMBIGUOUS_MATCH] '"+R.Str(s.Get(@"target"))+@"' matches "+R.Str(R.Capture((o569) => {R.Emit(o569,R.Member(s.Get(@"tied"),@"Count"));}))+@" applications equally well: "+R.Str(s.Get(@"listed"))+@". Pass the exact display name, an executable path, or a command line instead -- the plugin will not guess between them, and the one that has been used most is not the same thing as the one that was meant. (action_sent=false, recovery=computer_launch, auto_reresolve=false)"));}
s.Set(@"resolution",R.Cast(@"ordered",R.Map(new object[]{@"kind",(""+R.Str(R.Capture((o570) => {R.Emit(o570,R.Member(s.Get(@"best"),@"kind"));}))),@"file",(""+R.Str(R.Capture((o571) => {R.Emit(o571,R.Member(s.Get(@"best"),@"file"));}))),@"label",(""+R.Str(R.Capture((o572) => {R.Emit(o572,R.Member(s.Get(@"best"),@"label"));})))})));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"resolution"),@"kind"),@"shortcut"))){s.Set(@"resolution",R.Cast(@"ordered",R.Map(new object[]{@"kind",@"shortcut",@"file",(""+R.Str(R.Capture((o573) => {R.Emit(o573,R.Member(s.Get(@"best"),@"file"));}))),@"label",(""+R.Str(R.Capture((o574) => {R.Emit(o574,R.Member(s.Get(@"best"),@"label"));})))})));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"resolution"),@"kind"),@"start-app"))){s.Set(@"appId",(""+R.Str(R.Capture((o575) => {R.Emit(o575,R.Member(s.Get(@"best"),@"file"));}))));
if(R.Bool(R.Binary(s,@"Imatch",s.Get(@"appId"),@"^(\{[0-9A-Fa-f\-]+\})\\(.+)$"))){s.Set(@"folder",R.Invoke(R.Type(@"DshNative"),@"KnownFolderPath",new object[]{R.Index(s.Get(@"Matches"),1)}));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{s.Get(@"folder")})))){s.Set(@"resolution",R.Cast(@"ordered",R.Map(new object[]{@"kind",@"start-app-path",@"file",R.Call(s,@"Join-Path",new Args(new object[]{s.Get(@"folder"),R.Index(s.Get(@"Matches"),2)}),null),@"label",(""+R.Str(R.Capture((o576) => {R.Emit(o576,R.Member(s.Get(@"best"),@"label"));})))})));}else{s.Set(@"resolution",R.Cast(@"ordered",R.Map(new object[]{@"kind",@"store",@"file",(""+@"shell:AppsFolder\"+R.Str(s.Get(@"appId"))),@"label",(""+R.Str(R.Capture((o577) => {R.Emit(o577,R.Member(s.Get(@"best"),@"label"));})))})));}}else{s.Set(@"resolution",R.Cast(@"ordered",R.Map(new object[]{@"kind",@"store",@"file",(""+@"shell:AppsFolder\"+R.Str(s.Get(@"appId"))),@"label",(""+R.Str(R.Capture((o578) => {R.Emit(o578,R.Member(s.Get(@"best"),@"label"));})))})));}}
s.Set(@"basis",@"name match");
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o579) => {R.Emit(o579,R.Member(s.Get(@"best"),@"label"));}))),s.Get(@"target")))){s.Set(@"basis",@"exact name");}
s.Set(@"resolution",R.Call(s,@"Add-LaunchSignals",new Args(new object[]{s.Get(@"resolution"),s.Get(@"basis"),s.Get(@"refresh")}),null));
s.Set(@"runnersUp",R.Array(R.Capture((o580) => {R.Emit(o580,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_584)}),R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"First",R.Switch),3}),R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_581)}),s.Get(@"ranked")))));})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"runnersUp"),@"Count"),0))){R.SetIndex(s.Get(@"resolution"),@"candidates",s.Get(@"runnersUp"));}
throw new ReturnFlow(s.Get(@"resolution"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_589(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"IntPtr"));
s.Set(@"lParam",R.Bind(a,1,@"lParam",()=>null,@"IntPtr"));
try{if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindowVisible",new object[]{s.Get(@"hwnd")})))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"rect",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+RECT"}),null));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"WindowBounds",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"rect"),v=>{s.Set(@"rect",v);})})))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"w",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Right"),R.Member(s.Get(@"rect"),@"Left")));
s.Set(@"h",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Bottom"),R.Member(s.Get(@"rect"),@"Top")));
if(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"w"),40)) || R.Bool(R.Binary(s,@"Ilt",s.Get(@"h"),40))))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"owner",0);
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetWindowThreadProcessId",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"owner"),v=>{s.Set(@"owner",v);})})));
s.Set(@"name",@"");
try{s.Set(@"name",R.Member(R.Call(s,@"Get-Process",new Args(new object[]{new Named(@"Id",R.Switch),s.Get(@"owner"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null),@"ProcessName"));}catch(Exception error590) when (!(error590 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error590}));s.Set(@"name",@"");}
R.Emit(o,R.Invoke(R.Member(s.Get(@"state"),@"rows"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"hwnd")),@"pid",s.Get(@"owner"),@"process",s.Get(@"name"),@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"hwnd")}),@"area",R.Binary(s,@"Multiply",R.Cast(@"int64",s.Get(@"w")),R.Cast(@"int64",s.Get(@"h")))}))}));
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_VisibleWindows_588(Scope s,Args a){var o=new List<object>();
try{s.Set(@"state",R.Map(new object[]{@"rows",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null)}));
s.Set(@"callback",R.Cast(@"DshNative+EnumWindowsProc",new Fn(s,Block_589)));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"EnumWindows",new object[]{s.Get(@"callback"),R.Member(R.Type(@"IntPtr"),@"Zero")})));
throw new ReturnFlow(R.Array(R.Capture((o591) => {R.Emit(o591,R.Invoke(R.Member(s.Get(@"state"),@"rows"),@"ToArray",new object[]{}));})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_593(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"IntPtr"));
s.Set(@"lParam",R.Bind(a,1,@"lParam",()=>null,@"IntPtr"));
try{if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindowVisible",new object[]{s.Get(@"hwnd")})))){throw new ReturnFlow(s.Get(@"true"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),s.Get(@"exclude")))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"owner",0);
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetWindowThreadProcessId",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"owner"),v=>{s.Set(@"owner",v);})})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"owner"),s.Get(@"procId")))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"rect",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+RECT"}),null));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"WindowBounds",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"rect"),v=>{s.Set(@"rect",v);})})))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"area",R.Binary(s,@"Multiply",R.Cast(@"int64",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Right"),R.Member(s.Get(@"rect"),@"Left"))),R.Cast(@"int64",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Bottom"),R.Member(s.Get(@"rect"),@"Top")))));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"area"),R.Member(s.Get(@"state"),@"area")))){R.SetMember(s.Get(@"state"),@"area",s.Get(@"area"));
R.SetMember(s.Get(@"state"),@"best",s.Get(@"hwnd"));}
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Find_WindowForPid_592(Scope s,Args a){var o=new List<object>();s.Set(@"procId",R.Bind(a,0,@"procId",()=>null,@"int"));
s.Set(@"exclude",R.Bind(a,1,@"exclude",()=>null,@"IntPtr"));
try{s.Set(@"state",R.Map(new object[]{@"best",R.Member(R.Type(@"IntPtr"),@"Zero"),@"area",R.Cast(@"int64",-1)}));
s.Set(@"callback",R.Cast(@"DshNative+EnumWindowsProc",new Fn(s,Block_593)));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"EnumWindows",new object[]{s.Get(@"callback"),R.Member(R.Type(@"IntPtr"),@"Zero")})));
throw new ReturnFlow(R.Member(s.Get(@"state"),@"best"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_597(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"string",s.Get(@"_")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_615(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Unary(@"Not",R.Invoke(s.Get(@"before"),@"ContainsKey",new object[]{R.Cast(@"int64",R.Member(s.Get(@"_"),@"hwnd"))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Launch_594(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"target",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"target")));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"target")}))){throw R.Error(@"launch requires a target");}
s.Set(@"waitSeconds",8d);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"waitSeconds")))){s.Set(@"waitSeconds",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{30,R.Cast(@"double",R.Member(s.Get(@"Arg"),@"waitSeconds"))})}));}
s.Set(@"resolved",R.Call(s,@"Resolve-LaunchTarget",new Args(new object[]{s.Get(@"target"),R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"refresh"),s.Get(@"true"))}),null));
s.Set(@"argumentList",R.Array(R.Capture((o595) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"arguments")))){s.Set(@"argumentList",R.Array(R.Capture((o596) => {R.Emit(o596,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_597)}),R.Member(s.Get(@"Arg"),@"arguments")));})));}
s.Set(@"before",R.Map(new object[]{}));
foreach(var item598 in R.Array(R.Call(s,@"Get-VisibleWindows",new Args(new object[]{}),null))){s.Set(@"row",item598);try{R.SetIndex(s.Get(@"before"),R.Cast(@"int64",R.Member(s.Get(@"row"),@"hwnd")),s.Get(@"true"));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"shellWindow",R.Invoke(R.Type(@"DshNative"),@"GetShellWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"shellWindow"),R.Member(R.Type(@"IntPtr"),@"Zero")))){R.SetIndex(s.Get(@"before"),R.Cast(@"int64",s.Get(@"shellWindow")),s.Get(@"true"));}
s.Set(@"foreground",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
s.Set(@"started",R.Call(s,@"Get-Date",new Args(new object[]{}),null));
s.Set(@"proc",s.Get(@"null"));
s.Set(@"launchEnvSaved",R.Map(new object[]{}));
foreach(var item599 in R.Array(R.Array(R.Capture((o600) => {R.Emit(o600,new object[]{@"ELECTRON_RUN_AS_NODE",@"ELECTRON_NO_ASAR",@"ELECTRON_NO_ATTACH_CONSOLE",@"ELECTRON_FORCE_WINDOW_MENU_BAR",@"NODE_OPTIONS",@"NODE_REPL_EXTERNAL_MODULE"});})))){s.Set(@"envName",item599);try{foreach(var item601 in R.Array(R.Array(R.Capture((o602) => {R.Emit(o602,R.Member(R.Invoke(R.Type(@"System.Environment"),@"GetEnvironmentVariables",new object[]{}),@"Keys"));})))){s.Set(@"key",item601);try{if(R.Bool((R.Bool(s.Get(@"key")) && R.Bool(R.Binary(s,@"Ieq",R.Invoke(s.Get(@"key"),@"ToUpper",new object[]{}),R.Invoke(s.Get(@"envName"),@"ToUpper",new object[]{})))))){R.SetIndex(s.Get(@"launchEnvSaved"),s.Get(@"key"),R.Invoke(R.Type(@"System.Environment"),@"GetEnvironmentVariable",new object[]{s.Get(@"key")}));
R.Emit(o,R.Invoke(R.Type(@"System.Environment"),@"SetEnvironmentVariable",new object[]{s.Get(@"key"),s.Get(@"null")}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}catch(ContinueFlow){}catch(BreakFlow){break;}}
try{if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"resolved"),@"kind"),@"store"))){s.Set(@"proc",R.Call(s,@"Start-Process",new Args(new object[]{new Named(@"FilePath",R.Switch),@"explorer.exe",new Named(@"ArgumentList",R.Switch),R.Array(R.Capture((o603) => {R.Emit(o603,R.Member(s.Get(@"resolved"),@"file"));})),new Named(@"PassThru",R.Switch),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));}else if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"argumentList"),@"Count"),0))){s.Set(@"proc",R.Call(s,@"Start-Process",new Args(new object[]{new Named(@"FilePath",R.Switch),R.Member(s.Get(@"resolved"),@"file"),new Named(@"ArgumentList",R.Switch),s.Get(@"argumentList"),new Named(@"PassThru",R.Switch),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));}else{s.Set(@"proc",R.Call(s,@"Start-Process",new Args(new object[]{new Named(@"FilePath",R.Switch),R.Member(s.Get(@"resolved"),@"file"),new Named(@"PassThru",R.Switch),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));}}catch(Exception error604) when (!(error604 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error604}));throw R.Error((""+@"could not start '"+R.Str(s.Get(@"target"))+@"' (resolved as "+R.Str(R.Capture((o605) => {R.Emit(o605,R.Member(s.Get(@"resolved"),@"kind"));}))+@": "+R.Str(R.Capture((o606) => {R.Emit(o606,R.Member(s.Get(@"resolved"),@"file"));}))+@"): "+R.Str(R.Capture((o607) => {R.Emit(o607,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));}finally{foreach(var item608 in R.Array(R.Member(s.Get(@"launchEnvSaved"),@"Keys"))){s.Set(@"key",item608);try{R.Emit(o,R.Invoke(R.Type(@"System.Environment"),@"SetEnvironmentVariable",new object[]{s.Get(@"key"),R.Index(s.Get(@"launchEnvSaved"),s.Get(@"key"))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"proc")))){throw R.Error((""+@"launching '"+R.Str(s.Get(@"target"))+@"' returned no process (resolved as "+R.Str(R.Capture((o609) => {R.Emit(o609,R.Member(s.Get(@"resolved"),@"kind"));}))+@": "+R.Str(R.Capture((o610) => {R.Emit(o610,R.Member(s.Get(@"resolved"),@"file"));}))+@")"));}
s.Set(@"procId",R.Member(s.Get(@"proc"),@"Id"));
s.Set(@"procName",@"");
try{s.Set(@"procName",R.Member(s.Get(@"proc"),@"ProcessName"));}catch(Exception error611) when (!(error611 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error611}));s.Set(@"procName",@"");}
s.Set(@"deadline",R.Invoke(R.Call(s,@"Get-Date",new Args(new object[]{}),null),@"AddSeconds",new object[]{s.Get(@"waitSeconds")}));
s.Set(@"hwnd",R.Member(R.Type(@"IntPtr"),@"Zero"));
s.Set(@"how",@"");
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"resolved"),@"kind"),@"store"))){while(R.Bool(R.Binary(s,@"Ilt",R.Call(s,@"Get-Date",new Args(new object[]{}),null),s.Get(@"deadline")))){try{s.Set(@"hwnd",R.Call(s,@"Find-WindowForPid",new Args(new object[]{s.Get(@"procId"),s.Get(@"foreground")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"how",@"process");
throw new BreakFlow();}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"procName"),@""))){foreach(var item612 in R.Array(R.Array(R.Capture((o613) => {R.Emit(o613,R.Call(s,@"Get-Process",new Args(new object[]{new Named(@"Name",R.Switch),s.Get(@"procName"),new Named(@"ErrorAction",R.Switch),@"SilentlyContinue"}),null));})))){s.Set(@"sibling",item612);try{if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"sibling"),@"Id"),s.Get(@"procId")))){throw new ContinueFlow();}
s.Set(@"found",R.Call(s,@"Find-WindowForPid",new Args(new object[]{R.Member(s.Get(@"sibling"),@"Id"),s.Get(@"foreground")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"found"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"hwnd",s.Get(@"found"));
s.Set(@"procId",R.Member(s.Get(@"sibling"),@"Id"));
s.Set(@"procName",R.Member(s.Get(@"sibling"),@"ProcessName"));
s.Set(@"how",@"sibling");
throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new BreakFlow();}}
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),120}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){while(R.Bool(R.Binary(s,@"Ilt",R.Call(s,@"Get-Date",new Args(new object[]{}),null),s.Get(@"deadline")))){try{s.Set(@"fresh",R.Array(R.Capture((o614) => {R.Emit(o614,R.Call(s,@"Sort-Object",new Args(new object[]{new Named(@"Property",R.Switch),@"area",new Named(@"Descending",R.Switch)}),R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_615)}),R.Call(s,@"Get-VisibleWindows",new Args(new object[]{}),null))));})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"fresh"),@"Count"),0))){s.Set(@"hwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(R.Index(s.Get(@"fresh"),0),@"hwnd"))));
s.Set(@"procId",R.Member(R.Index(s.Get(@"fresh"),0),@"pid"));
s.Set(@"procName",R.Member(R.Index(s.Get(@"fresh"),0),@"process"));
s.Set(@"how",@"new-window");
throw new BreakFlow();}
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),120}),null));}catch(ContinueFlow){}catch(BreakFlow){break;}}}
s.Set(@"title",@"");
s.Set(@"note",@"");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"note",@"the process started but showed no visible top-level window within the wait; it may be a tray-only app, or it handed control to a process that was already running");}else{s.Set(@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"hwnd")}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"how"),@"new-window"))){s.Set(@"note",@"matched by comparing visible windows before and after the launch, because no window belonged to the launched process itself");}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"how"),@"sibling"))){s.Set(@"note",@"the launch handed off to an already-running instance of the same application");}}
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"launch",new Named(@"Hwnd",R.Switch),s.Get(@"hwnd")}),null));
s.Set(@"reply",R.Cast(@"ordered",R.Map(new object[]{@"resolvedAs",R.Member(s.Get(@"resolved"),@"kind"),@"file",R.Member(s.Get(@"resolved"),@"file"),@"pid",s.Get(@"procId"),@"process",s.Get(@"procName"),@"hwnd",R.Cast(@"int64",s.Get(@"hwnd")),@"title",s.Get(@"title"),@"waitedMs",R.Cast(@"int",R.Member(R.Binary(s,@"Minus",R.Call(s,@"Get-Date",new Args(new object[]{}),null),s.Get(@"started")),@"TotalMilliseconds")),@"matchedBy",s.Get(@"how"),@"note",s.Get(@"note")})));
R.SetIndex(s.Get(@"reply"),@"label",(""+R.Str(R.Capture((o616) => {R.Emit(o616,R.Member(s.Get(@"resolved"),@"label"));}))));
R.SetIndex(s.Get(@"reply"),@"source",(""+R.Str(R.Capture((o617) => {R.Emit(o617,R.Member(s.Get(@"resolved"),@"source"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"resolved"),@"matchBasis")))){R.SetIndex(s.Get(@"reply"),@"matchBasis",(""+R.Str(R.Capture((o618) => {R.Emit(o618,R.Member(s.Get(@"resolved"),@"matchBasis"));}))));}
R.SetIndex(s.Get(@"reply"),@"wasRunning",R.Binary(s,@"Ieq",R.Member(s.Get(@"resolved"),@"isRunning"),s.Get(@"true")));
R.SetIndex(s.Get(@"reply"),@"useCount",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"useCount")));
R.SetIndex(s.Get(@"reply"),@"useCountKnown",R.Binary(s,@"Ieq",R.Member(s.Get(@"resolved"),@"useCountKnown"),s.Get(@"true")));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"resolved"),@"candidates")))){R.SetIndex(s.Get(@"reply"),@"candidates",R.Array(R.Capture((o619) => {R.Emit(o619,R.Member(s.Get(@"resolved"),@"candidates"));})));}
throw new ReturnFlow(s.Get(@"reply"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Release_620(Scope s,Args a){var o=new List<object>();
try{s.Set(@"released",R.Array(R.Capture((o621) => {R.Emit(o621,R.Call(s,@"Release-HeldInput",new Args(new object[]{}),null));})));
s.Set(@"note",@"held input was released");
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"released"),@"Count"),0))){s.Set(@"note",@"nothing was held down");}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"released",s.Get(@"released"),@"count",R.Member(s.Get(@"released"),@"Count"),@"note",s.Get(@"note")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Digest_622(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"rect",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"hwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd")),0))))){s.Set(@"rect",R.Call(s,@"Get-WindowRectInfo",new Args(new object[]{R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd")))}),null));}else if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"region")))){s.Set(@"r",R.Member(s.Get(@"Arg"),@"region"));
s.Set(@"rect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"r"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"r"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"r"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"r"),@"height"))})));}else{s.Set(@"rect",R.Call(s,@"Get-ForegroundRect",new Args(new object[]{}),null));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"rect")))){throw R.Error(@"could not resolve a region to fingerprint");}
s.Set(@"maxSide",320);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"maxSide")))){s.Set(@"maxSide",R.Invoke(R.Type(@"Math"),@"Max",new object[]{16,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"maxSide"))}));}
s.Set(@"digest",R.Call(s,@"Get-RegionDigest",new Args(new object[]{R.Member(s.Get(@"rect"),@"x"),R.Member(s.Get(@"rect"),@"y"),R.Member(s.Get(@"rect"),@"width"),R.Member(s.Get(@"rect"),@"height"),s.Get(@"maxSide")}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"digest",s.Get(@"digest"),@"x",R.Member(s.Get(@"rect"),@"x"),@"y",R.Member(s.Get(@"rect"),@"y"),@"width",R.Member(s.Get(@"rect"),@"width"),@"height",R.Member(s.Get(@"rect"),@"height"),@"maxSide",s.Get(@"maxSide")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_624(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"IntPtr"));
s.Set(@"lParam",R.Bind(a,1,@"lParam",()=>null,@"IntPtr"));
try{if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindowVisible",new object[]{s.Get(@"hwnd")})))){throw new ReturnFlow(s.Get(@"true"));}
if(R.Bool(R.Invoke(R.Type(@"DshNative"),@"IsCloaked",new object[]{s.Get(@"hwnd")}))){throw new ReturnFlow(s.Get(@"true"));}
if(R.Bool(R.Invoke(R.Type(@"DshNative"),@"IsToolWindow",new object[]{s.Get(@"hwnd")}))){throw new ReturnFlow(s.Get(@"true"));}
if(R.Bool(R.Invoke(R.Type(@"DshNative"),@"IsIconic",new object[]{s.Get(@"hwnd")}))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"hwnd")}));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"title")}))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"rect",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+RECT"}),null));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"WindowBounds",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"rect"),v=>{s.Set(@"rect",v);})})))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"w",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Right"),R.Member(s.Get(@"rect"),@"Left")));
s.Set(@"h",R.Binary(s,@"Minus",R.Member(s.Get(@"rect"),@"Bottom"),R.Member(s.Get(@"rect"),@"Top")));
if(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"w"),40)) || R.Bool(R.Binary(s,@"Ilt",s.Get(@"h"),40))))){throw new ReturnFlow(s.Get(@"true"));}
s.Set(@"procId",0);
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetWindowThreadProcessId",new object[]{s.Get(@"hwnd"),new Ref(()=>s.Get(@"procId"),v=>{s.Set(@"procId",v);})})));
s.Set(@"procName",@"");
try{s.Set(@"procName",R.Member(R.Call(s,@"Get-Process",new Args(new object[]{new Named(@"Id",R.Switch),s.Get(@"procId"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null),@"ProcessName"));}catch(Exception error625) when (!(error625 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error625}));s.Set(@"procName",@"");}
if(R.Bool((R.Bool((R.Bool(s.Get(@"needle")) && R.Bool(R.Binary(s,@"Inotmatch",s.Get(@"title"),R.Invoke(R.Type(@"regex"),@"Escape",new object[]{s.Get(@"needle")}))))) && R.Bool(R.Binary(s,@"Inotmatch",s.Get(@"procName"),R.Invoke(R.Type(@"regex"),@"Escape",new object[]{s.Get(@"needle")})))))){throw new ReturnFlow(s.Get(@"true"));}
R.Emit(o,R.Invoke(s.Get(@"rows"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"hwnd")),@"title",s.Get(@"title"),@"process",s.Get(@"procName"),@"pid",s.Get(@"procId"),@"className",R.Invoke(R.Type(@"DshNative"),@"WindowClass",new object[]{s.Get(@"hwnd")}),@"x",R.Member(s.Get(@"rect"),@"Left"),@"y",R.Member(s.Get(@"rect"),@"Top"),@"width",s.Get(@"w"),@"height",s.Get(@"h"),@"foreground",R.Binary(s,@"Ieq",s.Get(@"hwnd"),s.Get(@"fg"))}))}));
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Windows_623(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"needle",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"filter")));
s.Set(@"rows",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
s.Set(@"callback",R.Cast(@"DshNative+EnumWindowsProc",new Fn(s,Block_624)));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"EnumWindows",new object[]{s.Get(@"callback"),R.Member(R.Type(@"IntPtr"),@"Zero")})));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"windows",R.Array(R.Capture((o626) => {R.Emit(o626,R.Invoke(s.Get(@"rows"),@"ToArray",new object[]{}));}))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Focus_627(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{@"before bringing a window forward"}),null));
s.Set(@"hwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd"))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw R.Error(@"focus requires a hwnd");}
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindow",new object[]{s.Get(@"hwnd")})))){throw R.Error((""+@"hwnd "+R.Str(R.Capture((o628) => {R.Emit(o628,R.Member(s.Get(@"Arg"),@"hwnd"));}))+@" is not a window"));}
s.Set(@"visibleBefore",R.Invoke(R.Type(@"DshNative"),@"IsWindowVisible",new object[]{s.Get(@"hwnd")}));
s.Set(@"ok",R.Invoke(R.Type(@"DshNative"),@"ForceForeground",new object[]{s.Get(@"hwnd")}));
R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),120}),null));
s.Set(@"visibleAfter",R.Invoke(R.Type(@"DshNative"),@"IsWindowVisible",new object[]{s.Get(@"hwnd")}));
s.Set(@"result",R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",s.Get(@"hwnd")),@"focused",s.Get(@"ok"),@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"hwnd")}),@"visible",s.Get(@"visibleAfter")})));
if(R.Bool((R.Bool(s.Get(@"visibleBefore")) && R.Bool(R.Unary(@"Not",s.Get(@"visibleAfter")))))){R.SetMember(s.Get(@"result"),@"note",@"the window was visible before this call and is not visible now; ForceForeground is supposed to leave that unchanged, so treat this as a bug report");}
if(R.Bool(R.Unary(@"Not",s.Get(@"ok")))){s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
s.Set(@"info",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"fg")}),null));
R.SetMember(s.Get(@"result"),@"foreground",R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Member(s.Get(@"info"),@"hwnd"),@"title",R.Member(s.Get(@"info"),@"title"),@"process",R.Member(s.Get(@"info"),@"process")})));}
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"focus",new Named(@"Hwnd",R.Switch),R.Member(s.Get(@"Arg"),@"hwnd")}),null));
throw new ReturnFlow(s.Get(@"result"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Cursor_629(Scope s,Args a){var o=new List<object>();
try{s.Set(@"cursor",R.Call(s,@"New-Object",new Args(new object[]{@"DshNative+POINT"}),null));
R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"GetCursorPos",new object[]{new Ref(()=>s.Get(@"cursor"),v=>{s.Set(@"cursor",v);})})));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"x",R.Member(s.Get(@"cursor"),@"X"),@"y",R.Member(s.Get(@"cursor"),@"Y")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_Pattern_630(Scope s,Args a){var o=new List<object>();s.Set(@"element",R.Bind(a,0,@"element",()=>null,@"object"));
s.Set(@"pattern",R.Bind(a,1,@"pattern",()=>null,@"object"));
try{s.Set(@"holder",s.Get(@"null"));
try{throw new ReturnFlow(R.Cast(@"bool",R.Invoke(s.Get(@"element"),@"TryGetCurrentPattern",new object[]{s.Get(@"pattern"),new Ref(()=>s.Get(@"holder"),v=>{s.Set(@"holder",v);})})));}catch(Exception error631) when (!(error631 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error631}));throw new ReturnFlow(s.Get(@"false"));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_ConvertTo_SafeInt_632(Scope s,Args a){var o=new List<object>();s.Set(@"value",R.Bind(a,0,@"value",()=>null,@"double"));
try{if(R.Bool((R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"value")})) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"value")}))))){throw new ReturnFlow(0);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"value"),2147483647))){throw new ReturnFlow(2147483647);}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"value"),-2147483648))){throw new ReturnFlow(-2147483648);}
throw new ReturnFlow(R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"value")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_RectFinite_633(Scope s,Args a){var o=new List<object>();s.Set(@"rect",R.Bind(a,0,@"rect",()=>null,@"object"));
try{foreach(var item634 in R.Array(R.Array(R.Capture((o635) => {R.Emit(o635,new object[]{R.Member(s.Get(@"rect"),@"X"),R.Member(s.Get(@"rect"),@"Y"),R.Member(s.Get(@"rect"),@"Width"),R.Member(s.Get(@"rect"),@"Height")});})))){s.Set(@"v",item634);try{if(R.Bool((R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"v")})) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"v")}))))){throw new ReturnFlow(s.Get(@"false"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_ConvertFrom_ComRows_636(Scope s,Args a){var o=new List<object>();s.Set(@"rows",R.Bind(a,0,@"rows",()=>null,@"object"));
try{s.Set(@"nodes",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item637 in R.Array(s.Get(@"rows"))){s.Set(@"row",item637);try{R.Emit(o,R.Invoke(s.Get(@"nodes"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"depth",R.Cast(@"int",R.Index(s.Get(@"row"),@"depth")),@"name",R.Cast(@"string",R.Index(s.Get(@"row"),@"name")),@"controlType",R.Cast(@"string",R.Index(s.Get(@"row"),@"controlType")),@"automationId",R.Cast(@"string",R.Index(s.Get(@"row"),@"automationId")),@"className",R.Cast(@"string",R.Index(s.Get(@"row"),@"className")),@"enabled",R.Cast(@"bool",R.Index(s.Get(@"row"),@"enabled")),@"offscreen",R.Cast(@"bool",R.Index(s.Get(@"row"),@"offscreen")),@"x",R.Cast(@"int",R.Index(s.Get(@"row"),@"x")),@"y",R.Cast(@"int",R.Index(s.Get(@"row"),@"y")),@"width",R.Cast(@"int",R.Index(s.Get(@"row"),@"width")),@"height",R.Cast(@"int",R.Index(s.Get(@"row"),@"height")),@"patterns",R.Array(R.Capture((o638) => {R.Emit(o638,R.Index(s.Get(@"row"),@"patterns"));}))}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(R.Invoke(s.Get(@"nodes"),@"ToArray",new object[]{}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ComUiTree_639(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
s.Set(@"maxDepth",R.Bind(a,1,@"maxDepth",()=>null,@"int"));
s.Set(@"maxNodes",R.Bind(a,2,@"maxNodes",()=>null,@"int"));
s.Set(@"probePatterns",R.Bind(a,3,@"probePatterns",()=>null,@"bool"));
s.Set(@"skipEmpty",R.Bind(a,4,@"skipEmpty",()=>null,@"bool"));
s.Set(@"Arg",R.Bind(a,5,@"Arg",()=>null,@"object"));
try{s.Set(@"wantName",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")));
s.Set(@"wantType",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")));
s.Set(@"wantId",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")));
s.Set(@"wantFilter",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"filter")));
s.Set(@"findMode",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantName"),@"")) || R.Bool(R.Binary(s,@"Ine",s.Get(@"wantType"),@"")))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"wantId"),@"")))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"wantFilter"),@""))));
s.Set(@"reinit",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"script:WalkLedger")))){R.Emit(o,R.Call(s,@"Reset-WalkCounters",new Args(new object[]{}),null));}
s.Set(@"ledger",s.Get(@"script:WalkLedger"));
R.Emit(o,R.Call(s,@"Add-HealthProbe",new Args(new object[]{s.Get(@"ledger")}),null));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshUia.Engine"),@"ClientHealthy",new object[]{s.Get(@"hwnd")})))){R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Reset",new object[]{}));
R.Emit(o,R.Call(s,@"Add-ClientReset",new Args(new object[]{s.Get(@"ledger")}),null));
s.Set(@"reinit",s.Get(@"true"));}
if(R.Bool(s.Get(@"findMode"))){s.Set(@"rows",s.Get(@"null"));
s.Set(@"truncated",s.Get(@"false"));
R.Emit(o,R.Call(s,@"Add-WalkHit",new Args(new object[]{s.Get(@"ledger")}),null));
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Find",new object[]{s.Get(@"hwnd"),s.Get(@"maxNodes"),s.Get(@"probePatterns"),s.Get(@"wantName"),s.Get(@"wantType"),s.Get(@"wantId"),s.Get(@"wantFilter"),new Ref(()=>s.Get(@"rows"),v=>{s.Set(@"rows",v);}),new Ref(()=>s.Get(@"truncated"),v=>{s.Set(@"truncated",v);})}));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(R.Array(R.Capture((o640) => {R.Emit(o640,s.Get(@"rows"));})),@"Count"),0)) && R.Bool(R.Call(s,@"Test-WalkAllowed",new Args(new object[]{s.Get(@"ledger")}),null))))){R.Emit(o,R.Call(s,@"Add-HealthProbe",new Args(new object[]{s.Get(@"ledger")}),null));
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshUia.Engine"),@"ClientHealthy",new object[]{s.Get(@"hwnd")})))){R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Reset",new object[]{}));
R.Emit(o,R.Call(s,@"Add-ClientReset",new Args(new object[]{s.Get(@"ledger")}),null));
s.Set(@"reinit",s.Get(@"true"));
R.Emit(o,R.Call(s,@"Add-WalkHit",new Args(new object[]{s.Get(@"ledger")}),null));
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Find",new object[]{s.Get(@"hwnd"),s.Get(@"maxNodes"),s.Get(@"probePatterns"),s.Get(@"wantName"),s.Get(@"wantType"),s.Get(@"wantId"),s.Get(@"wantFilter"),new Ref(()=>s.Get(@"rows"),v=>{s.Set(@"rows",v);}),new Ref(()=>s.Get(@"truncated"),v=>{s.Set(@"truncated",v);})}));}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"nodes",R.Array(R.Capture((o641) => {R.Emit(o641,R.Call(s,@"ConvertFrom-ComRows",new Args(new object[]{s.Get(@"rows")}),null));})),@"truncated",s.Get(@"truncated"),@"walked",0,@"skipped",0,@"mode",@"find",@"reinit",s.Get(@"reinit"),@"pushdown",R.Array(R.Capture((o642) => {if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantId"),@""))){R.Emit(o642,@"automationId");}else if(R.Bool(R.Invoke(R.Type(@"DshUia.Engine"),@"IsExactControlType",new object[]{s.Get(@"wantType")}))){R.Emit(o642,@"controlType");}})),@"traversal",R.Cast(@"ordered",R.Map(new object[]{@"visited",0,@"maxQueue",0,@"visitBudget",0,@"traversalTruncated",s.Get(@"false"),@"elapsedMs",0,@"providerSide",s.Get(@"true"),@"walks",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"Walks")),@"healthProbes",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"HealthProbes")),@"resets",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"Resets")),@"walkCap",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"Cap"))}))})));}
s.Set(@"rows",s.Get(@"null"));
s.Set(@"walked",0);
s.Set(@"skipped",0);
s.Set(@"truncated",s.Get(@"false"));
s.Set(@"visitBudget",R.Call(s,@"Get-VisitBudget",new Args(new object[]{s.Get(@"maxNodes"),R.Member(s.Get(@"Arg"),@"maxVisited")}),null));
s.Set(@"traverseTruncated",s.Get(@"false"));
s.Set(@"maxQueue",0);
s.Set(@"traverseWatch",R.Invoke(R.Type(@"System.Diagnostics.Stopwatch"),@"StartNew",new object[]{}));
R.Emit(o,R.Call(s,@"Add-WalkHit",new Args(new object[]{s.Get(@"ledger")}),null));
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Walk",new object[]{s.Get(@"hwnd"),s.Get(@"maxDepth"),s.Get(@"maxNodes"),s.Get(@"probePatterns"),s.Get(@"skipEmpty"),s.Get(@"visitBudget"),new Ref(()=>s.Get(@"rows"),v=>{s.Set(@"rows",v);}),new Ref(()=>s.Get(@"walked"),v=>{s.Set(@"walked",v);}),new Ref(()=>s.Get(@"skipped"),v=>{s.Set(@"skipped",v);}),new Ref(()=>s.Get(@"truncated"),v=>{s.Set(@"truncated",v);}),new Ref(()=>s.Get(@"maxQueue"),v=>{s.Set(@"maxQueue",v);}),new Ref(()=>s.Get(@"traverseTruncated"),v=>{s.Set(@"traverseTruncated",v);})}));
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(R.Array(R.Capture((o643) => {R.Emit(o643,s.Get(@"rows"));})),@"Count"),0)) && R.Bool(R.Binary(s,@"Igt",s.Get(@"walked"),0)))) && R.Bool(R.Call(s,@"Test-WalkAllowed",new Args(new object[]{s.Get(@"ledger")}),null))))){R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Reset",new object[]{}));
R.Emit(o,R.Call(s,@"Add-ClientReset",new Args(new object[]{s.Get(@"ledger")}),null));
s.Set(@"reinit",s.Get(@"true"));
s.Set(@"rows",s.Get(@"null"));
s.Set(@"walked",0);
s.Set(@"skipped",0);
s.Set(@"truncated",s.Get(@"false"));
s.Set(@"traverseTruncated",s.Get(@"false"));
s.Set(@"maxQueue",0);
R.Emit(o,R.Call(s,@"Add-WalkHit",new Args(new object[]{s.Get(@"ledger")}),null));
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Walk",new object[]{s.Get(@"hwnd"),s.Get(@"maxDepth"),s.Get(@"maxNodes"),s.Get(@"probePatterns"),s.Get(@"skipEmpty"),s.Get(@"visitBudget"),new Ref(()=>s.Get(@"rows"),v=>{s.Set(@"rows",v);}),new Ref(()=>s.Get(@"walked"),v=>{s.Set(@"walked",v);}),new Ref(()=>s.Get(@"skipped"),v=>{s.Set(@"skipped",v);}),new Ref(()=>s.Get(@"truncated"),v=>{s.Set(@"truncated",v);}),new Ref(()=>s.Get(@"maxQueue"),v=>{s.Set(@"maxQueue",v);}),new Ref(()=>s.Get(@"traverseTruncated"),v=>{s.Set(@"traverseTruncated",v);})}));}
s.Set(@"legacy",R.Call(s,@"Test-LegacyBridgeRows",new Args(new object[]{s.Get(@"rows")}),null));
if(R.Bool((R.Bool(s.Get(@"legacy")) && R.Bool(R.Call(s,@"Test-WalkAllowed",new Args(new object[]{s.Get(@"ledger")}),null))))){R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Reset",new object[]{}));
R.Emit(o,R.Call(s,@"Add-ClientReset",new Args(new object[]{s.Get(@"ledger")}),null));
s.Set(@"reinit",s.Get(@"true"));
s.Set(@"rows",s.Get(@"null"));
s.Set(@"walked",0);
s.Set(@"skipped",0);
s.Set(@"truncated",s.Get(@"false"));
s.Set(@"traverseTruncated",s.Get(@"false"));
s.Set(@"maxQueue",0);
R.Emit(o,R.Call(s,@"Add-WalkHit",new Args(new object[]{s.Get(@"ledger")}),null));
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Walk",new object[]{s.Get(@"hwnd"),s.Get(@"maxDepth"),s.Get(@"maxNodes"),s.Get(@"probePatterns"),s.Get(@"skipEmpty"),s.Get(@"visitBudget"),new Ref(()=>s.Get(@"rows"),v=>{s.Set(@"rows",v);}),new Ref(()=>s.Get(@"walked"),v=>{s.Set(@"walked",v);}),new Ref(()=>s.Get(@"skipped"),v=>{s.Set(@"skipped",v);}),new Ref(()=>s.Get(@"truncated"),v=>{s.Set(@"truncated",v);}),new Ref(()=>s.Get(@"maxQueue"),v=>{s.Set(@"maxQueue",v);}),new Ref(()=>s.Get(@"traverseTruncated"),v=>{s.Set(@"traverseTruncated",v);})}));
s.Set(@"legacy",R.Call(s,@"Test-LegacyBridgeRows",new Args(new object[]{s.Get(@"rows")}),null));}
R.Emit(o,R.Invoke(s.Get(@"traverseWatch"),@"Stop",new object[]{}));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"nodes",R.Array(R.Capture((o644) => {R.Emit(o644,R.Call(s,@"ConvertFrom-ComRows",new Args(new object[]{s.Get(@"rows")}),null));})),@"truncated",s.Get(@"truncated"),@"walked",s.Get(@"walked"),@"skipped",s.Get(@"skipped"),@"mode",@"tree",@"reinit",s.Get(@"reinit"),@"legacy",s.Get(@"legacy"),@"traversal",R.Cast(@"ordered",R.Map(new object[]{@"visited",R.Cast(@"int",s.Get(@"walked")),@"maxQueue",R.Cast(@"int",s.Get(@"maxQueue")),@"visitBudget",R.Cast(@"int",s.Get(@"visitBudget")),@"traversalTruncated",R.Cast(@"bool",s.Get(@"traverseTruncated")),@"elapsedMs",R.Cast(@"int",R.Member(s.Get(@"traverseWatch"),@"ElapsedMilliseconds")),@"walks",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"Walks")),@"walkCap",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"Cap")),@"healthProbes",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"HealthProbes")),@"resets",R.Cast(@"int",R.Member(s.Get(@"ledger"),@"Resets"))}))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_LegacyBridgeRows_645(Scope s,Args a){var o=new List<object>();s.Set(@"rows",R.Bind(a,0,@"rows",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ilt",R.Member(R.Array(R.Capture((o646) => {R.Emit(o646,s.Get(@"rows"));})),@"Count"),3))){throw new ReturnFlow(s.Get(@"false"));}
s.Set(@"panes",0);
s.Set(@"withPatterns",0);
foreach(var item647 in R.Array(R.Array(R.Capture((o648) => {R.Emit(o648,s.Get(@"rows"));})))){s.Set(@"row",item647);try{s.Set(@"type",(""+R.Str(R.Capture((o649) => {R.Emit(o649,R.Index(s.Get(@"row"),@"controlType"));}))));
s.Set(@"id",(""+R.Str(R.Capture((o650) => {R.Emit(o650,R.Index(s.Get(@"row"),@"automationId"));}))));
s.Set(@"patterns",R.Array(R.Capture((o651) => {R.Emit(o651,R.Index(s.Get(@"row"),@"patterns"));})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"patterns"),@"Count"),0))){R.Eval(()=>R.Eval(()=>{var u652=s.Get(@"withPatterns");s.Set(@"withPatterns",R.Binary(s,@"Plus",u652,1L));return u652;}));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"type"),@"ControlType.Pane")) && R.Bool(R.Binary(s,@"Imatch",s.Get(@"id"),@"^[0-9]+$"))))){R.Eval(()=>R.Eval(()=>{var u653=s.Get(@"panes");s.Set(@"panes",R.Binary(s,@"Plus",u653,1L));return u653;}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow((R.Bool(R.Binary(s,@"Ige",s.Get(@"panes"),2)) && R.Bool(R.Binary(s,@"Ile",s.Get(@"withPatterns"),1))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_VisitBudget_654(Scope s,Args a){var o=new List<object>();s.Set(@"maxNodes",R.Bind(a,0,@"maxNodes",()=>null,@"int"));
s.Set(@"explicit",R.Bind(a,1,@"explicit",()=>null,@"object"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"explicit"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"explicit"))),@""))))){s.Set(@"asked",0);
if(R.Bool(R.Invoke(R.Type(@"int"),@"TryParse",new object[]{(""+R.Str(s.Get(@"explicit"))),new Ref(()=>s.Get(@"asked"),v=>{s.Set(@"asked",v);})}))){if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"asked"),0))){throw new ReturnFlow(0);}
throw new ReturnFlow(s.Get(@"asked"));}}
throw new ReturnFlow(R.Invoke(R.Type(@"Math"),@"Max",new object[]{R.Binary(s,@"Multiply",20,s.Get(@"maxNodes")),5000}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_WalkLedger_655(Scope s,Args a){var o=new List<object>();
try{throw new ReturnFlow(R.Cast(@"pscustomobject",R.Map(new object[]{@"Walks",0,@"Cap",3,@"HealthProbes",0,@"Resets",0})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_WalkAllowed_656(Scope s,Args a){var o=new List<object>();s.Set(@"ledger",R.Bind(a,0,@"ledger",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"ledger")))){throw new ReturnFlow(s.Get(@"true"));}
throw new ReturnFlow(R.Binary(s,@"Ilt",R.Member(s.Get(@"ledger"),@"Walks"),R.Member(s.Get(@"ledger"),@"Cap")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_WalkHit_657(Scope s,Args a){var o=new List<object>();s.Set(@"ledger",R.Bind(a,0,@"ledger",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"ledger")))){R.Eval(()=>R.Eval(()=>{var u658=R.Member(s.Get(@"ledger"),@"Walks");R.SetMember(s.Get(@"ledger"),@"Walks",R.Binary(s,@"Plus",u658,1L));return u658;}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_HealthProbe_659(Scope s,Args a){var o=new List<object>();s.Set(@"ledger",R.Bind(a,0,@"ledger",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"ledger")))){R.Eval(()=>R.Eval(()=>{var u660=R.Member(s.Get(@"ledger"),@"HealthProbes");R.SetMember(s.Get(@"ledger"),@"HealthProbes",R.Binary(s,@"Plus",u660,1L));return u660;}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_ClientReset_661(Scope s,Args a){var o=new List<object>();s.Set(@"ledger",R.Bind(a,0,@"ledger",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"ledger")))){R.Eval(()=>R.Eval(()=>{var u662=R.Member(s.Get(@"ledger"),@"Resets");R.SetMember(s.Get(@"ledger"),@"Resets",R.Binary(s,@"Plus",u662,1L));return u662;}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Reset_WalkCounters_663(Scope s,Args a){var o=new List<object>();
try{s.Set(@"script:WalkLedger",R.Call(s,@"New-WalkLedger",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_NodeToken_664(Scope s,Args a){var o=new List<object>();s.Set(@"node",R.Bind(a,0,@"node",()=>null,@"object"));
try{s.Set(@"id",(""+R.Str(R.Capture((o665) => {R.Emit(o665,R.Index(s.Get(@"node"),@"automationId"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"id"),@""))){throw new ReturnFlow(R.Binary(s,@"Plus",@"i:",s.Get(@"id")));}
s.Set(@"label",(""+R.Str(R.Capture((o666) => {R.Emit(o666,R.Index(s.Get(@"node"),@"name"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"label"),@""))){throw new ReturnFlow(@"");}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"label"),@"Length"),24))){s.Set(@"label",R.Invoke(s.Get(@"label"),@"Substring",new object[]{0,24}));}
throw new ReturnFlow(R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Binary(s,@"Plus",@"t:",(""+R.Str(R.Capture((o667) => {R.Emit(o667,R.Index(s.Get(@"node"),@"controlType"));})))),@"/"),s.Get(@"label")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_RowKey_668(Scope s,Args a){var o=new List<object>();s.Set(@"row",R.Bind(a,0,@"row",()=>null,@"object"));
s.Set(@"path",R.Bind(a,1,@"path",()=>null,@"string"));
try{s.Set(@"id",(""+R.Str(R.Capture((o669) => {R.Emit(o669,R.Index(s.Get(@"row"),@"automationId"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"id"),@""))){throw new ReturnFlow(R.Binary(s,@"Plus",@"id:",s.Get(@"id")));}
throw new ReturnFlow(R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Binary(s,@"Plus",@"p:",s.Get(@"path")),@"|"),(""+R.Str(R.Capture((o670) => {R.Emit(o670,R.Index(s.Get(@"row"),@"controlType"));})))),@"|"),(""+R.Str(R.Capture((o671) => {R.Emit(o671,R.Index(s.Get(@"row"),@"className"));})))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_676(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ine",s.Get(@"_"),@""));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_ElementSnapshot_672(Scope s,Args a){var o=new List<object>();s.Set(@"nodes",R.Bind(a,0,@"nodes",()=>null,@"object"));
s.Set(@"hwnd",R.Bind(a,1,@"hwnd",()=>null,@"int64"));
s.Set(@"ownerPid",R.Bind(a,2,@"ownerPid",()=>null,@"int"));
try{R.Eval(()=>R.Eval(()=>{var u673=s.Get(@"script:SnapshotSeq");s.Set(@"script:SnapshotSeq",R.Binary(s,@"Plus",u673,1L));return u673;}));
s.Set(@"snapshot",(""+@"s"+R.Str(R.Capture((o674) => {R.Emit(o674,s.Get(@"script:BootGen"));}))+R.Str(R.Capture((o675) => {R.Emit(o675,s.Get(@"script:SnapshotSeq"));}))));
s.Set(@"chain",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[string]"}),null));
s.Set(@"keyCounts",R.Map(new object[]{}));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Member(s.Get(@"nodes"),@"Count")))){try{s.Set(@"node",R.Index(s.Get(@"nodes"),s.Get(@"i")));
s.Set(@"depth",R.Cast(@"int",R.Index(s.Get(@"node"),@"depth")));
while(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"chain"),@"Count"),s.Get(@"depth")))){try{R.Emit(o,R.Invoke(s.Get(@"chain"),@"RemoveAt",new object[]{R.Binary(s,@"Minus",R.Member(s.Get(@"chain"),@"Count"),1)}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
while(R.Bool(R.Binary(s,@"Ilt",R.Member(s.Get(@"chain"),@"Count"),s.Get(@"depth")))){try{R.Emit(o,R.Invoke(s.Get(@"chain"),@"Add",new object[]{@""}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"path",R.Binary(s,@"Join",R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_676)}),s.Get(@"chain")),@">"));
s.Set(@"ref",(""+R.Str(s.Get(@"snapshot"))+@"."+R.Str(s.Get(@"i"))));
s.Set(@"baseKey",R.Call(s,@"Get-RowKey",new Args(new object[]{s.Get(@"node"),s.Get(@"path")}),null));
s.Set(@"ordinal",0);
if(R.Bool(R.Invoke(s.Get(@"keyCounts"),@"ContainsKey",new object[]{s.Get(@"baseKey")}))){s.Set(@"ordinal",R.Index(s.Get(@"keyCounts"),s.Get(@"baseKey")));}
R.SetIndex(s.Get(@"keyCounts"),s.Get(@"baseKey"),R.Binary(s,@"Plus",s.Get(@"ordinal"),1));
R.SetIndex(s.Get(@"script:ElementRegistry"),s.Get(@"ref"),R.Cast(@"ordered",R.Map(new object[]{@"snapshot",s.Get(@"snapshot"),@"seq",s.Get(@"script:SnapshotSeq"),@"hwnd",s.Get(@"hwnd"),@"pid",s.Get(@"ownerPid"),@"depth",s.Get(@"depth"),@"path",s.Get(@"path"),@"key",R.Binary(s,@"Plus",R.Binary(s,@"Plus",s.Get(@"baseKey"),@"#"),s.Get(@"ordinal")),@"automationId",(""+R.Str(R.Capture((o677) => {R.Emit(o677,R.Index(s.Get(@"node"),@"automationId"));}))),@"name",(""+R.Str(R.Capture((o678) => {R.Emit(o678,R.Index(s.Get(@"node"),@"name"));}))),@"controlType",(""+R.Str(R.Capture((o679) => {R.Emit(o679,R.Index(s.Get(@"node"),@"controlType"));}))),@"className",(""+R.Str(R.Capture((o680) => {R.Emit(o680,R.Index(s.Get(@"node"),@"className"));}))),@"enabled",R.Cast(@"bool",R.Index(s.Get(@"node"),@"enabled")),@"offscreen",R.Cast(@"bool",R.Index(s.Get(@"node"),@"offscreen")),@"patterns",R.Array(R.Capture((o681) => {R.Emit(o681,R.Index(s.Get(@"node"),@"patterns"));})),@"x",R.Cast(@"int",R.Index(s.Get(@"node"),@"x")),@"y",R.Cast(@"int",R.Index(s.Get(@"node"),@"y")),@"width",R.Cast(@"int",R.Index(s.Get(@"node"),@"width")),@"height",R.Cast(@"int",R.Index(s.Get(@"node"),@"height"))})));
R.SetIndex(s.Get(@"node"),@"ref",s.Get(@"ref"));
s.Set(@"token",R.Call(s,@"Get-NodeToken",new Args(new object[]{s.Get(@"node")}),null));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"chain"),@"Count"),s.Get(@"depth")))){R.Emit(o,R.Invoke(s.Get(@"chain"),@"Add",new object[]{s.Get(@"token")}));}else{R.SetIndex(s.Get(@"chain"),s.Get(@"depth"),s.Get(@"token"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u682=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u682,1L));return u682;}));}}
s.Set(@"floor",R.Binary(s,@"Minus",s.Get(@"script:SnapshotSeq"),s.Get(@"script:SnapshotKeep")));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"floor"),0))){foreach(var item683 in R.Array(R.Array(R.Capture((o684) => {R.Emit(o684,R.Member(s.Get(@"script:ElementRegistry"),@"Keys"));})))){s.Set(@"key",item683);try{s.Set(@"entry",R.Index(s.Get(@"script:ElementRegistry"),s.Get(@"key")));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"entry"))) && R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Member(s.Get(@"entry"),@"seq")),s.Get(@"floor")))))){R.Emit(o,R.Invoke(s.Get(@"script:ElementRegistry"),@"Remove",new object[]{s.Get(@"key")}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
throw new ReturnFlow(s.Get(@"snapshot"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_RowAnonymous_685(Scope s,Args a){var o=new List<object>();s.Set(@"row",R.Bind(a,0,@"row",()=>null,@"object"));
try{throw new ReturnFlow((R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o686) => {R.Emit(o686,R.Index(s.Get(@"row"),@"name"));}))),@"")) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o687) => {R.Emit(o687,R.Index(s.Get(@"row"),@"automationId"));}))),@"")))) && R.Bool(R.Binary(s,@"Ieq",R.Member(R.Array(R.Capture((o688) => {R.Emit(o688,R.Index(s.Get(@"row"),@"patterns"));})),@"Count"),0))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_RowNumericName_689(Scope s,Args a){var o=new List<object>();s.Set(@"name",R.Bind(a,0,@"name",()=>null,@"string"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"name"),@"")) || R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"name"),@"Length"),24))))){throw new ReturnFlow(s.Get(@"false"));}
throw new ReturnFlow(R.Binary(s,@"Imatch",s.Get(@"name"),@"^[0-9][0-9:.\-/ %]*$"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_RowPriority_690(Scope s,Args a){var o=new List<object>();s.Set(@"row",R.Bind(a,0,@"row",()=>null,@"object"));
s.Set(@"maxDepth",R.Bind(a,1,@"maxDepth",()=>null,@"int"));
try{s.Set(@"score",0d);
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o691) => {R.Emit(o691,R.Index(s.Get(@"row"),@"automationId"));}))),@""))){s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),1000));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(R.Array(R.Capture((o692) => {R.Emit(o692,R.Index(s.Get(@"row"),@"patterns"));})),@"Count"),0))){s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),800));}
s.Set(@"type",(""+R.Str(R.Capture((o693) => {R.Emit(o693,R.Index(s.Get(@"row"),@"controlType"));}))));
if(R.Bool(R.Binary(s,@"Imatch",s.Get(@"type"),@"Button|Edit|ListItem|MenuItem|CheckBox|ComboBox|Hyperlink|Tab|Slider|TreeItem|RadioButton|Spinner|SplitButton"))){s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),600));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o694) => {R.Emit(o694,R.Index(s.Get(@"row"),@"name"));}))),@""))){s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),300));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Index(s.Get(@"row"),@"enabled"),s.Get(@"true"))) && R.Bool(R.Binary(s,@"Ine",R.Index(s.Get(@"row"),@"offscreen"),s.Get(@"true")))))){s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),100));}
s.Set(@"area",R.Binary(s,@"Multiply",R.Cast(@"double",R.Index(s.Get(@"row"),@"width")),R.Cast(@"double",R.Index(s.Get(@"row"),@"height"))));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"area"),0))){s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),R.Invoke(R.Type(@"Math"),@"Min",new object[]{200,R.Binary(s,@"Divide",s.Get(@"area"),5000)})));}
s.Set(@"score",R.Binary(s,@"Minus",s.Get(@"score"),R.Binary(s,@"Multiply",60,R.Cast(@"int",R.Index(s.Get(@"row"),@"depth")))));
throw new ReturnFlow(s.Get(@"score"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_RowLeafFlags_695(Scope s,Args a){var o=new List<object>();s.Set(@"rows",R.Bind(a,0,@"rows",()=>null,@"object"));
try{s.Set(@"count",R.Member(s.Get(@"rows"),@"Count"));
s.Set(@"leaf",R.Call(s,@"New-Object",new Args(new object[]{@"bool[]",s.Get(@"count")}),null));
s.Set(@"deepestAfter",-1);
{s.Set(@"i",R.Binary(s,@"Minus",s.Get(@"count"),1));while(R.Bool(R.Binary(s,@"Ige",s.Get(@"i"),0))){try{s.Set(@"d",R.Cast(@"int",R.Index(R.Index(s.Get(@"rows"),s.Get(@"i")),@"depth")));
R.SetIndex(s.Get(@"leaf"),s.Get(@"i"),R.Binary(s,@"Ile",s.Get(@"deepestAfter"),s.Get(@"d")));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"d"),s.Get(@"deepestAfter")))){s.Set(@"deepestAfter",s.Get(@"d"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u696=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Minus",u696,1L));return u696;}));}}
throw new ReturnFlow(s.Get(@"leaf"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_RowTextOnly_697(Scope s,Args a){var o=new List<object>();s.Set(@"row",R.Bind(a,0,@"row",()=>null,@"object"));
s.Set(@"leaf",R.Bind(a,1,@"leaf",()=>null,@"bool"));
try{if(R.Bool(R.Unary(@"Not",s.Get(@"leaf")))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(R.Array(R.Capture((o698) => {R.Emit(o698,R.Index(s.Get(@"row"),@"patterns"));})),@"Count"),0))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Inotmatch",(""+R.Str(R.Capture((o699) => {R.Emit(o699,R.Index(s.Get(@"row"),@"controlType"));}))),@"Text$"))){throw new ReturnFlow(s.Get(@"false"));}
throw new ReturnFlow(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o700) => {R.Emit(o700,R.Index(s.Get(@"row"),@"name"));}))),@""));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_TextRunSeparator_701(Scope s,Args a){var o=new List<object>();
try{throw new ReturnFlow(@" ");}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Merge_UiTextRuns_702(Scope s,Args a){var o=new List<object>();s.Set(@"rows",R.Bind(a,0,@"rows",()=>null,@"object"));
try{s.Set(@"count",R.Member(s.Get(@"rows"),@"Count"));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"count"),2))){throw new ReturnFlow(R.Array(R.Capture((o703) => {R.Emit(o703,s.Get(@"rows"));})));}
s.Set(@"leaf",R.Call(s,@"Get-RowLeafFlags",new Args(new object[]{s.Get(@"rows")}),null));
s.Set(@"out",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"i",0);
while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"count")))){try{if(R.Bool(R.Call(s,@"Test-RowTextOnly",new Args(new object[]{R.Index(s.Get(@"rows"),s.Get(@"i")),R.Index(s.Get(@"leaf"),s.Get(@"i"))}),null))){s.Set(@"depth",R.Cast(@"int",R.Index(R.Index(s.Get(@"rows"),s.Get(@"i")),@"depth")));
s.Set(@"end",s.Get(@"i"));
while(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ilt",R.Binary(s,@"Plus",s.Get(@"end"),1),s.Get(@"count"))) && R.Bool(R.Index(s.Get(@"leaf"),R.Binary(s,@"Plus",s.Get(@"end"),1))))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Index(R.Index(s.Get(@"rows"),R.Binary(s,@"Plus",s.Get(@"end"),1)),@"depth")),s.Get(@"depth"))))) && R.Bool(R.Call(s,@"Test-RowTextOnly",new Args(new object[]{R.Index(s.Get(@"rows"),R.Binary(s,@"Plus",s.Get(@"end"),1)),R.Index(s.Get(@"leaf"),R.Binary(s,@"Plus",s.Get(@"end"),1))}),null))))){try{R.Eval(()=>R.Eval(()=>{var u704=s.Get(@"end");s.Set(@"end",R.Binary(s,@"Plus",u704,1L));return u704;}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"run",R.Binary(s,@"Plus",R.Binary(s,@"Minus",s.Get(@"end"),s.Get(@"i")),1));
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"run"),2))){s.Set(@"separator",R.Call(s,@"Get-TextRunSeparator",new Args(new object[]{}),null));
s.Set(@"parts",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[string]"}),null));
{s.Set(@"k",s.Get(@"i"));while(R.Bool(R.Binary(s,@"Ile",s.Get(@"k"),s.Get(@"end")))){try{R.Emit(o,R.Invoke(s.Get(@"parts"),@"Add",new object[]{(""+R.Str(R.Capture((o705) => {R.Emit(o705,R.Index(R.Index(s.Get(@"rows"),s.Get(@"k")),@"name"));})))}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u706=s.Get(@"k");s.Set(@"k",R.Binary(s,@"Plus",u706,1L));return u706;}));}}
s.Set(@"row",R.Index(s.Get(@"rows"),s.Get(@"i")));
s.Set(@"joined",R.Binary(s,@"Join",s.Get(@"parts"),s.Get(@"separator")));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"joined"),@"Length"),s.Get(@"MAX_MERGED_NAME")))){R.SetIndex(s.Get(@"row"),@"name",R.Binary(s,@"Plus",R.Invoke(s.Get(@"joined"),@"Substring",new object[]{0,s.Get(@"MAX_MERGED_NAME")}),@" ..."));
R.SetIndex(s.Get(@"row"),@"mergedTruncated",s.Get(@"true"));}else{R.SetIndex(s.Get(@"row"),@"name",s.Get(@"joined"));}
R.SetIndex(s.Get(@"row"),@"merged",s.Get(@"run"));
R.Emit(o,R.Invoke(s.Get(@"out"),@"Add",new object[]{s.Get(@"row")}));
s.Set(@"i",R.Binary(s,@"Plus",s.Get(@"end"),1));
throw new ContinueFlow();}}
R.Emit(o,R.Invoke(s.Get(@"out"),@"Add",new object[]{R.Index(s.Get(@"rows"),s.Get(@"i"))}));
R.Eval(()=>R.Eval(()=>{var u707=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u707,1L));return u707;}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"out"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_RowPassThrough_708(Scope s,Args a){var o=new List<object>();s.Set(@"row",R.Bind(a,0,@"row",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o709) => {R.Emit(o709,R.Index(s.Get(@"row"),@"name"));}))),@""))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o710) => {R.Emit(o710,R.Index(s.Get(@"row"),@"automationId"));}))),@""))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(R.Array(R.Capture((o711) => {R.Emit(o711,R.Index(s.Get(@"row"),@"patterns"));})),@"Count"),0))){throw new ReturnFlow(s.Get(@"false"));}
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Collapse_UiPassThroughChains_712(Scope s,Args a){var o=new List<object>();s.Set(@"rows",R.Bind(a,0,@"rows",()=>null,@"object"));
try{s.Set(@"current",s.Get(@"rows"));
{s.Set(@"round",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"round"),16))){try{s.Set(@"count",R.Member(s.Get(@"current"),@"Count"));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"count"),2))){throw new BreakFlow();}
s.Set(@"drop",R.Call(s,@"New-Object",new Args(new object[]{@"bool[]",s.Get(@"count")}),null));
s.Set(@"changed",s.Get(@"false"));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"count")))){try{if(R.Bool(R.Unary(@"Not",R.Call(s,@"Test-RowPassThrough",new Args(new object[]{R.Index(s.Get(@"current"),s.Get(@"i"))}),null)))){throw new ContinueFlow();}
s.Set(@"d",R.Cast(@"int",R.Index(R.Index(s.Get(@"current"),s.Get(@"i")),@"depth")));
s.Set(@"children",0);
{s.Set(@"j",R.Binary(s,@"Plus",s.Get(@"i"),1));while(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"j"),s.Get(@"count"))) && R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Index(R.Index(s.Get(@"current"),s.Get(@"j")),@"depth")),s.Get(@"d")))))){try{if(R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Index(R.Index(s.Get(@"current"),s.Get(@"j")),@"depth")),R.Binary(s,@"Plus",s.Get(@"d"),1)))){R.Eval(()=>R.Eval(()=>{var u713=s.Get(@"children");s.Set(@"children",R.Binary(s,@"Plus",u713,1L));return u713;}));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u714=s.Get(@"j");s.Set(@"j",R.Binary(s,@"Plus",u714,1L));return u714;}));}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"children"),1))){R.SetIndex(s.Get(@"drop"),s.Get(@"i"),s.Get(@"true"));
s.Set(@"changed",s.Get(@"true"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u715=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u715,1L));return u715;}));}}
if(R.Bool(R.Unary(@"Not",s.Get(@"changed")))){throw new BreakFlow();}
s.Set(@"next",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"dropped",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[int]"}),null));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"count")))){try{s.Set(@"d",R.Cast(@"int",R.Index(R.Index(s.Get(@"current"),s.Get(@"i")),@"depth")));
while(R.Bool((R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"dropped"),@"Count"),0)) && R.Bool(R.Binary(s,@"Ige",R.Index(s.Get(@"dropped"),R.Binary(s,@"Minus",R.Member(s.Get(@"dropped"),@"Count"),1)),s.Get(@"d")))))){try{R.Emit(o,R.Invoke(s.Get(@"dropped"),@"RemoveAt",new object[]{R.Binary(s,@"Minus",R.Member(s.Get(@"dropped"),@"Count"),1)}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Index(s.Get(@"drop"),s.Get(@"i")))){R.Emit(o,R.Invoke(s.Get(@"dropped"),@"Add",new object[]{s.Get(@"d")}));
throw new ContinueFlow();}
R.SetIndex(R.Index(s.Get(@"current"),s.Get(@"i")),@"depth",R.Binary(s,@"Minus",s.Get(@"d"),R.Member(s.Get(@"dropped"),@"Count")));
R.Emit(o,R.Invoke(s.Get(@"next"),@"Add",new object[]{R.Index(s.Get(@"current"),s.Get(@"i"))}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u716=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u716,1L));return u716;}));}}
s.Set(@"current",s.Get(@"next"));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u717=s.Get(@"round");s.Set(@"round",R.Binary(s,@"Plus",u717,1L));return u717;}));}}
throw new ReturnFlow(s.Get(@"current"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Optimize_UiRows_718(Scope s,Args a){var o=new List<object>();s.Set(@"rows",R.Bind(a,0,@"rows",()=>null,@"object"));
s.Set(@"maxNodes",R.Bind(a,1,@"maxNodes",()=>null,@"int"));
try{s.Set(@"count",R.Member(s.Get(@"rows"),@"Count"));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"count"),1))){throw new ReturnFlow(R.Map(new object[]{@"nodes",R.Array(R.Capture((o719) => {R.Emit(o719,s.Get(@"rows"));})),@"pruned",0}));}
s.Set(@"leaf",R.Call(s,@"New-Object",new Args(new object[]{@"bool[]",s.Get(@"count")}),null));
s.Set(@"deepestAfter",-1);
{s.Set(@"i",R.Binary(s,@"Minus",s.Get(@"count"),1));while(R.Bool(R.Binary(s,@"Ige",s.Get(@"i"),0))){try{s.Set(@"d",R.Cast(@"int",R.Index(R.Index(s.Get(@"rows"),s.Get(@"i")),@"depth")));
R.SetIndex(s.Get(@"leaf"),s.Get(@"i"),R.Binary(s,@"Ile",s.Get(@"deepestAfter"),s.Get(@"d")));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"d"),s.Get(@"deepestAfter")))){s.Set(@"deepestAfter",s.Get(@"d"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u720=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Minus",u720,1L));return u720;}));}}
s.Set(@"drop",R.Call(s,@"New-Object",new Args(new object[]{@"bool[]",s.Get(@"count")}),null));
{s.Set(@"i",1);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"count")))){try{if(R.Bool((R.Bool(R.Call(s,@"Test-RowAnonymous",new Args(new object[]{R.Index(s.Get(@"rows"),s.Get(@"i"))}),null)) && R.Bool((R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Index(R.Index(s.Get(@"rows"),s.Get(@"i")),@"width")),0)) || R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Index(R.Index(s.Get(@"rows"),s.Get(@"i")),@"height")),0))))))){R.SetIndex(s.Get(@"drop"),s.Get(@"i"),s.Get(@"true"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u721=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u721,1L));return u721;}));}}
s.Set(@"kept",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"flags",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[int]"}),null));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"count")))){try{s.Set(@"d",R.Cast(@"int",R.Index(R.Index(s.Get(@"rows"),s.Get(@"i")),@"depth")));
while(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"flags"),@"Count"),s.Get(@"d")))){try{R.Emit(o,R.Invoke(s.Get(@"flags"),@"RemoveAt",new object[]{R.Binary(s,@"Minus",R.Member(s.Get(@"flags"),@"Count"),1)}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
while(R.Bool(R.Binary(s,@"Ilt",R.Member(s.Get(@"flags"),@"Count"),s.Get(@"d")))){try{R.Emit(o,R.Invoke(s.Get(@"flags"),@"Add",new object[]{0}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"lost",0);
{s.Set(@"k",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"k"),R.Member(s.Get(@"flags"),@"Count")))){try{s.Set(@"lost",R.Binary(s,@"Plus",s.Get(@"lost"),R.Index(s.Get(@"flags"),s.Get(@"k"))));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u722=s.Get(@"k");s.Set(@"k",R.Binary(s,@"Plus",u722,1L));return u722;}));}}
if(R.Bool(R.Index(s.Get(@"drop"),s.Get(@"i")))){if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"flags"),@"Count"),s.Get(@"d")))){R.Emit(o,R.Invoke(s.Get(@"flags"),@"Add",new object[]{1}));}else{R.SetIndex(s.Get(@"flags"),s.Get(@"d"),1);}
throw new ContinueFlow();}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"flags"),@"Count"),s.Get(@"d")))){R.Emit(o,R.Invoke(s.Get(@"flags"),@"Add",new object[]{0}));}else{R.SetIndex(s.Get(@"flags"),s.Get(@"d"),0);}
R.SetIndex(R.Index(s.Get(@"rows"),s.Get(@"i")),@"depth",R.Binary(s,@"Minus",s.Get(@"d"),s.Get(@"lost")));
R.Emit(o,R.Invoke(s.Get(@"kept"),@"Add",new object[]{R.Index(s.Get(@"rows"),s.Get(@"i"))}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u723=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u723,1L));return u723;}));}}
s.Set(@"kept",R.Call(s,@"Merge-UiTextRuns",new Args(new object[]{s.Get(@"kept")}),null));
s.Set(@"kept",R.Call(s,@"Collapse-UiPassThroughChains",new Args(new object[]{s.Get(@"kept")}),null));
s.Set(@"keptCount",R.Member(s.Get(@"kept"),@"Count"));
s.Set(@"keptLeaf",R.Call(s,@"New-Object",new Args(new object[]{@"bool[]",s.Get(@"keptCount")}),null));
s.Set(@"deepestAfter",-1);
{s.Set(@"i",R.Binary(s,@"Minus",s.Get(@"keptCount"),1));while(R.Bool(R.Binary(s,@"Ige",s.Get(@"i"),0))){try{s.Set(@"d",R.Cast(@"int",R.Index(R.Index(s.Get(@"kept"),s.Get(@"i")),@"depth")));
R.SetIndex(s.Get(@"keptLeaf"),s.Get(@"i"),R.Binary(s,@"Ile",s.Get(@"deepestAfter"),s.Get(@"d")));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"d"),s.Get(@"deepestAfter")))){s.Set(@"deepestAfter",s.Get(@"d"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u724=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Minus",u724,1L));return u724;}));}}
s.Set(@"collapsed",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"i",0);
while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"keptCount")))){try{s.Set(@"row",R.Index(s.Get(@"kept"),s.Get(@"i")));
s.Set(@"depth",R.Cast(@"int",R.Index(s.Get(@"row"),@"depth")));
s.Set(@"type",(""+R.Str(R.Capture((o725) => {R.Emit(o725,R.Index(s.Get(@"row"),@"controlType"));}))));
s.Set(@"class",(""+R.Str(R.Capture((o726) => {R.Emit(o726,R.Index(s.Get(@"row"),@"className"));}))));
s.Set(@"w",R.Cast(@"int",R.Index(s.Get(@"row"),@"width")));
s.Set(@"h",R.Cast(@"int",R.Index(s.Get(@"row"),@"height")));
s.Set(@"end",s.Get(@"i"));
while(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ilt",R.Binary(s,@"Plus",s.Get(@"end"),1),s.Get(@"keptCount"))) && R.Bool(R.Index(s.Get(@"keptLeaf"),R.Binary(s,@"Plus",s.Get(@"end"),1))))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Index(R.Index(s.Get(@"kept"),R.Binary(s,@"Plus",s.Get(@"end"),1)),@"depth")),s.Get(@"depth"))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o727) => {R.Emit(o727,R.Index(R.Index(s.Get(@"kept"),R.Binary(s,@"Plus",s.Get(@"end"),1)),@"controlType"));}))),s.Get(@"type"))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o728) => {R.Emit(o728,R.Index(R.Index(s.Get(@"kept"),R.Binary(s,@"Plus",s.Get(@"end"),1)),@"className"));}))),s.Get(@"class"))))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Index(R.Index(s.Get(@"kept"),R.Binary(s,@"Plus",s.Get(@"end"),1)),@"width")),s.Get(@"w"))))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int",R.Index(R.Index(s.Get(@"kept"),R.Binary(s,@"Plus",s.Get(@"end"),1)),@"height")),s.Get(@"h")))))){try{R.Eval(()=>R.Eval(()=>{var u729=s.Get(@"end");s.Set(@"end",R.Binary(s,@"Plus",u729,1L));return u729;}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"run",R.Binary(s,@"Plus",R.Binary(s,@"Minus",s.Get(@"end"),s.Get(@"i")),1));
s.Set(@"collapse",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"run"),4))){s.Set(@"allAnonymous",s.Get(@"true"));
{s.Set(@"k",s.Get(@"i"));while(R.Bool(R.Binary(s,@"Ile",s.Get(@"k"),s.Get(@"end")))){try{if(R.Bool(R.Unary(@"Not",R.Call(s,@"Test-RowAnonymous",new Args(new object[]{R.Index(s.Get(@"kept"),s.Get(@"k"))}),null)))){s.Set(@"allAnonymous",s.Get(@"false"));
throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u730=s.Get(@"k");s.Set(@"k",R.Binary(s,@"Plus",u730,1L));return u730;}));}}
if(R.Bool(s.Get(@"allAnonymous"))){s.Set(@"collapse",s.Get(@"true"));}}
if(R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"collapse"))) && R.Bool(R.Binary(s,@"Ige",s.Get(@"run"),6))))){s.Set(@"allNumeric",s.Get(@"true"));
{s.Set(@"k",s.Get(@"i"));while(R.Bool(R.Binary(s,@"Ile",s.Get(@"k"),s.Get(@"end")))){try{if(R.Bool(R.Unary(@"Not",R.Call(s,@"Test-RowNumericName",new Args(new object[]{(""+R.Str(R.Capture((o731) => {R.Emit(o731,R.Index(R.Index(s.Get(@"kept"),s.Get(@"k")),@"name"));})))}),null)))){s.Set(@"allNumeric",s.Get(@"false"));
throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u732=s.Get(@"k");s.Set(@"k",R.Binary(s,@"Plus",u732,1L));return u732;}));}}
if(R.Bool(s.Get(@"allNumeric"))){s.Set(@"collapse",s.Get(@"true"));}}
if(R.Bool(s.Get(@"collapse"))){R.SetIndex(s.Get(@"row"),@"repeated",s.Get(@"run"));
R.Emit(o,R.Invoke(s.Get(@"collapsed"),@"Add",new object[]{s.Get(@"row")}));
s.Set(@"i",R.Binary(s,@"Plus",s.Get(@"end"),1));}else{R.Emit(o,R.Invoke(s.Get(@"collapsed"),@"Add",new object[]{s.Get(@"row")}));
R.Eval(()=>R.Eval(()=>{var u733=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u733,1L));return u733;}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"final",s.Get(@"collapsed"));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"collapsed"),@"Count"),s.Get(@"maxNodes")))){s.Set(@"scored",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
{s.Set(@"k",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"k"),R.Member(s.Get(@"collapsed"),@"Count")))){try{R.Emit(o,R.Invoke(s.Get(@"scored"),@"Add",new object[]{R.Cast(@"pscustomobject",R.Map(new object[]{@"index",s.Get(@"k"),@"score",R.Call(s,@"Get-RowPriority",new Args(new object[]{R.Index(s.Get(@"collapsed"),s.Get(@"k")),6}),null)}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u734=s.Get(@"k");s.Set(@"k",R.Binary(s,@"Plus",u734,1L));return u734;}));}}
s.Set(@"ranked",R.Array(R.Capture((o735) => {R.Emit(o735,R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"First",R.Switch),s.Get(@"maxNodes")}),R.Call(s,@"Sort-Object",new Args(new object[]{new Named(@"Property",R.Switch),@"score",new Named(@"Descending",R.Switch)}),s.Get(@"scored"))));})));
s.Set(@"keep",R.Call(s,@"New-Object",new Args(new object[]{@"bool[]",R.Member(s.Get(@"collapsed"),@"Count")}),null));
foreach(var item736 in R.Array(s.Get(@"ranked"))){s.Set(@"entry",item736);try{R.SetIndex(s.Get(@"keep"),R.Member(s.Get(@"entry"),@"index"),s.Get(@"true"));}catch(ContinueFlow){}catch(BreakFlow){break;}}
{s.Set(@"k",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"k"),R.Member(s.Get(@"collapsed"),@"Count")))){try{if(R.Bool(R.Unary(@"Not",R.Index(s.Get(@"keep"),s.Get(@"k"))))){throw new ContinueFlow();}
s.Set(@"need",R.Cast(@"int",R.Index(R.Index(s.Get(@"collapsed"),s.Get(@"k")),@"depth")));
{s.Set(@"j",R.Binary(s,@"Minus",s.Get(@"k"),1));while(R.Bool((R.Bool(R.Binary(s,@"Ige",s.Get(@"j"),0)) && R.Bool(R.Binary(s,@"Igt",s.Get(@"need"),0))))){try{s.Set(@"jd",R.Cast(@"int",R.Index(R.Index(s.Get(@"collapsed"),s.Get(@"j")),@"depth")));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"jd"),s.Get(@"need")))){R.SetIndex(s.Get(@"keep"),s.Get(@"j"),s.Get(@"true"));
s.Set(@"need",s.Get(@"jd"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u737=s.Get(@"j");s.Set(@"j",R.Binary(s,@"Minus",u737,1L));return u737;}));}}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u738=s.Get(@"k");s.Set(@"k",R.Binary(s,@"Plus",u738,1L));return u738;}));}}
s.Set(@"final",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
{s.Set(@"k",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"k"),R.Member(s.Get(@"collapsed"),@"Count")))){try{if(R.Bool(R.Index(s.Get(@"keep"),s.Get(@"k")))){R.Emit(o,R.Invoke(s.Get(@"final"),@"Add",new object[]{R.Index(s.Get(@"collapsed"),s.Get(@"k"))}));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u739=s.Get(@"k");s.Set(@"k",R.Binary(s,@"Plus",u739,1L));return u739;}));}}}
throw new ReturnFlow(R.Map(new object[]{@"nodes",R.Array(R.Capture((o740) => {R.Emit(o740,R.Invoke(s.Get(@"final"),@"ToArray",new object[]{}));})),@"pruned",R.Binary(s,@"Minus",s.Get(@"count"),R.Member(s.Get(@"final"),@"Count"))}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_SnapshotEntries_741(Scope s,Args a){var o=new List<object>();s.Set(@"snapshot",R.Bind(a,0,@"snapshot",()=>null,@"string"));
s.Set(@"hwnd",R.Bind(a,1,@"hwnd",()=>null,@"int64"));
try{s.Set(@"entries",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"prefix",(""+R.Str(s.Get(@"snapshot"))+@"."));
foreach(var item742 in R.Array(R.Member(s.Get(@"script:ElementRegistry"),@"Keys"))){s.Set(@"key",item742);try{if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"key"),@"StartsWith",new object[]{s.Get(@"prefix"),R.Member(R.Type(@"System.StringComparison"),@"Ordinal")})))){throw new ContinueFlow();}
s.Set(@"entry",R.Index(s.Get(@"script:ElementRegistry"),s.Get(@"key")));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),0)) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"entry"),@"hwnd")),s.Get(@"hwnd")))))){throw new ContinueFlow();}
R.Emit(o,R.Invoke(s.Get(@"entries"),@"Add",new object[]{s.Get(@"entry")}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"entries"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_778(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o779) => {R.Emit(o779,R.Index(s.Get(@"_"),@"delta"));}))),@"added"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_781(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o782) => {R.Emit(o782,R.Index(s.Get(@"_"),@"delta"));}))),@"moved"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_784(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o785) => {R.Emit(o785,R.Index(s.Get(@"_"),@"delta"));}))),@"changed"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_TreeDelta_743(Scope s,Args a){var o=new List<object>();s.Set(@"nodes",R.Bind(a,0,@"nodes",()=>null,@"object"));
s.Set(@"entries",R.Bind(a,1,@"entries",()=>null,@"object"));
s.Set(@"base",R.Bind(a,2,@"base",()=>null,@"string"));
try{s.Set(@"byKey",R.Map(new object[]{}));
foreach(var item744 in R.Array(s.Get(@"entries"))){s.Set(@"entry",item744);try{if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"byKey"),@"ContainsKey",new object[]{R.Member(s.Get(@"entry"),@"key")})))){R.SetIndex(s.Get(@"byKey"),R.Member(s.Get(@"entry"),@"key"),s.Get(@"entry"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"seen",R.Map(new object[]{}));
s.Set(@"changed",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"same",0);
foreach(var item745 in R.Array(s.Get(@"nodes"))){s.Set(@"node",item745);try{s.Set(@"key",@"");
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o746) => {R.Emit(o746,R.Index(s.Get(@"node"),@"key"));}))),@""))){s.Set(@"key",(""+R.Str(R.Capture((o747) => {R.Emit(o747,R.Index(s.Get(@"node"),@"key"));}))));}else if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o748) => {R.Emit(o748,R.Index(s.Get(@"node"),@"ref"));}))),@""))){s.Set(@"entry",R.Index(s.Get(@"script:ElementRegistry"),(""+R.Str(R.Capture((o749) => {R.Emit(o749,R.Index(s.Get(@"node"),@"ref"));})))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"entry")))){s.Set(@"key",(""+R.Str(R.Capture((o750) => {R.Emit(o750,R.Member(s.Get(@"entry"),@"key"));}))));}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@""))){throw new ContinueFlow();}
R.SetIndex(s.Get(@"seen"),s.Get(@"key"),s.Get(@"true"));
s.Set(@"before",s.Get(@"null"));
if(R.Bool(R.Invoke(s.Get(@"byKey"),@"ContainsKey",new object[]{s.Get(@"key")}))){s.Set(@"before",R.Index(s.Get(@"byKey"),s.Get(@"key")));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"before")))){R.SetIndex(s.Get(@"node"),@"delta",@"added");
R.Emit(o,R.Invoke(s.Get(@"changed"),@"Add",new object[]{s.Get(@"node")}));
throw new ContinueFlow();}
s.Set(@"moved",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"x")),R.Cast(@"int",R.Index(s.Get(@"node"),@"x")))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"y")),R.Cast(@"int",R.Index(s.Get(@"node"),@"y")))))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"width")),R.Cast(@"int",R.Index(s.Get(@"node"),@"width")))))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"height")),R.Cast(@"int",R.Index(s.Get(@"node"),@"height"))))));
s.Set(@"altered",(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o751) => {R.Emit(o751,R.Member(s.Get(@"before"),@"name"));}))),(""+R.Str(R.Capture((o752) => {R.Emit(o752,R.Index(s.Get(@"node"),@"name"));}))))) || R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o753) => {R.Emit(o753,R.Member(s.Get(@"before"),@"className"));}))),(""+R.Str(R.Capture((o754) => {R.Emit(o754,R.Index(s.Get(@"node"),@"className"));}))))))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"bool",R.Member(s.Get(@"before"),@"enabled")),R.Cast(@"bool",R.Index(s.Get(@"node"),@"enabled")))))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"bool",R.Member(s.Get(@"before"),@"offscreen")),R.Cast(@"bool",R.Index(s.Get(@"node"),@"offscreen")))))) || R.Bool(R.Binary(s,@"Ine",R.Binary(s,@"Join",R.Array(R.Capture((o755) => {R.Emit(o755,R.Member(s.Get(@"before"),@"patterns"));})),@","),R.Binary(s,@"Join",R.Array(R.Capture((o756) => {R.Emit(o756,R.Index(s.Get(@"node"),@"patterns"));})),@",")))));
if(R.Bool(s.Get(@"moved"))){R.SetIndex(s.Get(@"node"),@"delta",@"moved");
R.Emit(o,R.Invoke(s.Get(@"changed"),@"Add",new object[]{s.Get(@"node")}));}else if(R.Bool(s.Get(@"altered"))){R.SetIndex(s.Get(@"node"),@"delta",@"changed");
R.Emit(o,R.Invoke(s.Get(@"changed"),@"Add",new object[]{s.Get(@"node")}));}else{R.Eval(()=>R.Eval(()=>{var u757=s.Get(@"same");s.Set(@"same",R.Binary(s,@"Plus",u757,1L));return u757;}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"pendingAdded",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"keptRows",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item758 in R.Array(s.Get(@"changed"))){s.Set(@"node",item758);try{if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o759) => {R.Emit(o759,R.Index(s.Get(@"node"),@"delta"));}))),@"added"))){R.Emit(o,R.Invoke(s.Get(@"pendingAdded"),@"Add",new object[]{s.Get(@"node")}));}else{R.Emit(o,R.Invoke(s.Get(@"keptRows"),@"Add",new object[]{s.Get(@"node")}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"bySig",R.Map(new object[]{}));
foreach(var item760 in R.Array(s.Get(@"entries"))){s.Set(@"entry",item760);try{if(R.Bool(R.Invoke(s.Get(@"seen"),@"ContainsKey",new object[]{R.Member(s.Get(@"entry"),@"key")}))){throw new ContinueFlow();}
s.Set(@"sig",(""+R.Str(R.Capture((o761) => {R.Emit(o761,R.Member(s.Get(@"entry"),@"controlType"));}))+@"|"+R.Str(R.Capture((o762) => {R.Emit(o762,R.Member(s.Get(@"entry"),@"className"));}))+@"|"+R.Str(R.Capture((o763) => {R.Emit(o763,R.Member(s.Get(@"entry"),@"name"));}))));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"bySig"),@"ContainsKey",new object[]{s.Get(@"sig")})))){R.SetIndex(s.Get(@"bySig"),s.Get(@"sig"),R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));}
R.Emit(o,R.Invoke(R.Index(s.Get(@"bySig"),s.Get(@"sig")),@"Add",new object[]{s.Get(@"entry")}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"stillAdded",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item764 in R.Array(s.Get(@"pendingAdded"))){s.Set(@"node",item764);try{s.Set(@"sig",(""+R.Str(R.Capture((o765) => {R.Emit(o765,R.Index(s.Get(@"node"),@"controlType"));}))+@"|"+R.Str(R.Capture((o766) => {R.Emit(o766,R.Index(s.Get(@"node"),@"className"));}))+@"|"+R.Str(R.Capture((o767) => {R.Emit(o767,R.Index(s.Get(@"node"),@"name"));}))));
if(R.Bool((R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"bySig"),@"ContainsKey",new object[]{s.Get(@"sig")}))) || R.Bool(R.Binary(s,@"Ieq",R.Member(R.Index(s.Get(@"bySig"),s.Get(@"sig")),@"Count"),0))))){R.Emit(o,R.Invoke(s.Get(@"stillAdded"),@"Add",new object[]{s.Get(@"node")}));
throw new ContinueFlow();}
s.Set(@"before",R.Index(R.Index(s.Get(@"bySig"),s.Get(@"sig")),0));
R.Emit(o,R.Invoke(R.Index(s.Get(@"bySig"),s.Get(@"sig")),@"RemoveAt",new object[]{0}));
s.Set(@"moved",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"x")),R.Cast(@"int",R.Index(s.Get(@"node"),@"x")))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"y")),R.Cast(@"int",R.Index(s.Get(@"node"),@"y")))))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"width")),R.Cast(@"int",R.Index(s.Get(@"node"),@"width")))))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"before"),@"height")),R.Cast(@"int",R.Index(s.Get(@"node"),@"height"))))));
s.Set(@"altered",(R.Bool((R.Bool(R.Binary(s,@"Ine",R.Cast(@"bool",R.Member(s.Get(@"before"),@"enabled")),R.Cast(@"bool",R.Index(s.Get(@"node"),@"enabled")))) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"bool",R.Member(s.Get(@"before"),@"offscreen")),R.Cast(@"bool",R.Index(s.Get(@"node"),@"offscreen")))))) || R.Bool(R.Binary(s,@"Ine",R.Binary(s,@"Join",R.Array(R.Capture((o768) => {R.Emit(o768,R.Member(s.Get(@"before"),@"patterns"));})),@","),R.Binary(s,@"Join",R.Array(R.Capture((o769) => {R.Emit(o769,R.Index(s.Get(@"node"),@"patterns"));})),@",")))));
if(R.Bool(s.Get(@"moved"))){R.SetIndex(s.Get(@"node"),@"delta",@"moved");
R.Emit(o,R.Invoke(s.Get(@"keptRows"),@"Add",new object[]{s.Get(@"node")}));}else if(R.Bool(s.Get(@"altered"))){R.SetIndex(s.Get(@"node"),@"delta",@"changed");
R.Emit(o,R.Invoke(s.Get(@"keptRows"),@"Add",new object[]{s.Get(@"node")}));}else{R.Eval(()=>R.Eval(()=>{var u770=s.Get(@"same");s.Set(@"same",R.Binary(s,@"Plus",u770,1L));return u770;}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"changed",s.Get(@"keptRows"));
foreach(var item771 in R.Array(s.Get(@"stillAdded"))){s.Set(@"node",item771);try{R.Emit(o,R.Invoke(s.Get(@"changed"),@"Add",new object[]{s.Get(@"node")}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"removed",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item772 in R.Array(s.Get(@"entries"))){s.Set(@"entry",item772);try{if(R.Bool(R.Invoke(s.Get(@"seen"),@"ContainsKey",new object[]{R.Member(s.Get(@"entry"),@"key")}))){throw new ContinueFlow();}
s.Set(@"sig",(""+R.Str(R.Capture((o773) => {R.Emit(o773,R.Member(s.Get(@"entry"),@"controlType"));}))+@"|"+R.Str(R.Capture((o774) => {R.Emit(o774,R.Member(s.Get(@"entry"),@"className"));}))+@"|"+R.Str(R.Capture((o775) => {R.Emit(o775,R.Member(s.Get(@"entry"),@"name"));}))));
if(R.Bool((R.Bool(R.Invoke(s.Get(@"bySig"),@"ContainsKey",new object[]{s.Get(@"sig")})) && R.Bool(R.Binary(s,@"Igt",R.Member(R.Index(s.Get(@"bySig"),s.Get(@"sig")),@"Count"),0))))){throw new ContinueFlow();}
R.Emit(o,R.Invoke(s.Get(@"removed"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"ref",(""+R.Str(R.Capture((o776) => {R.Emit(o776,R.Member(s.Get(@"entry"),@"snapshot"));}))+@".?"),@"name",R.Member(s.Get(@"entry"),@"name"),@"controlType",R.Member(s.Get(@"entry"),@"controlType")}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"counts",R.Cast(@"ordered",R.Map(new object[]{@"base",s.Get(@"base"),@"known",s.Get(@"true"),@"added",R.Member(R.Array(R.Capture((o777) => {R.Emit(o777,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_778)}),s.Get(@"changed")));})),@"Count"),@"moved",R.Member(R.Array(R.Capture((o780) => {R.Emit(o780,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_781)}),s.Get(@"changed")));})),@"Count"),@"altered",R.Member(R.Array(R.Capture((o783) => {R.Emit(o783,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_784)}),s.Get(@"changed")));})),@"Count"),@"removed",R.Member(s.Get(@"removed"),@"Count"),@"same",s.Get(@"same")})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"removed"),@"Count"),0))){R.SetMember(s.Get(@"counts"),@"removedNodes",R.Array(R.Capture((o786) => {R.Emit(o786,R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"First",R.Switch),20}),s.Get(@"removed")));})));}
throw new ReturnFlow(R.Map(new object[]{@"counts",s.Get(@"counts"),@"nodes",R.Array(R.Capture((o787) => {R.Emit(o787,R.Invoke(s.Get(@"changed"),@"ToArray",new object[]{}));}))}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Complete_UiTree_788(Scope s,Args a){var o=new List<object>();s.Set(@"payload",R.Bind(a,0,@"payload",()=>null,@"object"));
s.Set(@"register",R.Bind(a,1,@"register",()=>null,@"bool"));
s.Set(@"prune",R.Bind(a,2,@"prune",()=>s.Get(@"true"),@"bool"));
s.Set(@"since",R.Bind(a,3,@"since",()=>@"",@"string"));
try{if(R.Bool((R.Bool((R.Bool(s.Get(@"prune")) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o789) => {R.Emit(o789,R.Member(s.Get(@"payload"),@"mode"));}))),@"tree")))) && R.Bool(R.Binary(s,@"Igt",R.Member(R.Array(R.Capture((o790) => {R.Emit(o790,R.Member(s.Get(@"payload"),@"nodes"));})),@"Count"),1))))){s.Set(@"optimized",R.Call(s,@"Optimize-UiRows",new Args(new object[]{R.Array(R.Capture((o791) => {R.Emit(o791,R.Member(s.Get(@"payload"),@"nodes"));})),R.Cast(@"int",R.Member(s.Get(@"payload"),@"maxNodes"))}),null));
R.SetMember(s.Get(@"payload"),@"nodes",R.Array(R.Capture((o792) => {R.Emit(o792,R.Member(s.Get(@"optimized"),@"nodes"));})));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"optimized"),@"pruned"),0))){R.SetMember(s.Get(@"payload"),@"pruned",R.Cast(@"int",R.Member(s.Get(@"optimized"),@"pruned")));}}
if(R.Bool(s.Get(@"register"))){s.Set(@"hwnd",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"window")))){s.Set(@"hwnd",R.Cast(@"int64",R.Member(R.Member(s.Get(@"payload"),@"window"),@"hwnd")));}
s.Set(@"ownerPid",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"payload"),@"window")))){s.Set(@"ownerPid",R.Cast(@"int",R.Member(R.Member(s.Get(@"payload"),@"window"),@"pid")));}
R.SetMember(s.Get(@"payload"),@"snapshot",R.Call(s,@"New-ElementSnapshot",new Args(new object[]{R.Array(R.Capture((o793) => {R.Emit(o793,R.Member(s.Get(@"payload"),@"nodes"));})),s.Get(@"hwnd"),s.Get(@"ownerPid")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"since"),@""))){s.Set(@"entries",R.Call(s,@"Get-SnapshotEntries",new Args(new object[]{s.Get(@"since"),s.Get(@"hwnd")}),null));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"entries"),@"Count"),0))){s.Set(@"delta",R.Call(s,@"New-TreeDelta",new Args(new object[]{R.Array(R.Capture((o794) => {R.Emit(o794,R.Member(s.Get(@"payload"),@"nodes"));})),s.Get(@"entries"),s.Get(@"since")}),null));
R.SetMember(s.Get(@"payload"),@"delta",R.Member(s.Get(@"delta"),@"counts"));
R.SetMember(s.Get(@"payload"),@"nodes",R.Array(R.Capture((o795) => {R.Emit(o795,R.Member(s.Get(@"delta"),@"nodes"));})));}else{R.SetMember(s.Get(@"payload"),@"delta",R.Cast(@"ordered",R.Map(new object[]{@"base",s.Get(@"since"),@"known",s.Get(@"false"),@"added",0,@"moved",0,@"altered",0,@"removed",0,@"same",0})));}}}
throw new ReturnFlow(s.Get(@"payload"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ArgMember_796(Scope s,Args a){var o=new List<object>();s.Set(@"Object",R.Bind(a,0,@"Object",()=>null,@"object"));
s.Set(@"Name",R.Bind(a,1,@"Name",()=>null,@"string"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Object")))){throw new ReturnFlow(s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Is",s.Get(@"Object"),R.Type(@"System.Collections.IDictionary")))){if(R.Bool(R.Invoke(s.Get(@"Object"),@"Contains",new object[]{s.Get(@"Name")}))){throw new ReturnFlow(R.Index(s.Get(@"Object"),s.Get(@"Name")));}
throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"property",R.Index(R.Member(R.Member(s.Get(@"Object"),@"PSObject"),@"Properties"),s.Get(@"Name")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"property")))){throw new ReturnFlow(s.Get(@"null"));}
throw new ReturnFlow(R.Member(s.Get(@"property"),@"Value"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_TextObservationConfig_797(Scope s,Args a){var o=new List<object>();s.Set(@"spec",R.Bind(a,0,@"spec",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"spec")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"base",s.Get(@"spec"));
if(R.Bool(R.Binary(s,@"Is",s.Get(@"base"),R.Type(@"System.Management.Automation.PSObject")))){s.Set(@"base",R.Member(R.Member(s.Get(@"base"),@"PSObject"),@"BaseObject"));}
s.Set(@"config",R.Cast(@"ordered",R.Map(new object[]{@"focused",s.Get(@"false"),@"selection",s.Get(@"false"),@"document",s.Get(@"false"),@"selected",s.Get(@"false")})));
s.Set(@"stated",0);
if(R.Bool(R.Binary(s,@"Is",s.Get(@"base"),R.Type(@"bool")))){if(R.Bool(R.Cast(@"bool",s.Get(@"base")))){R.SetIndex(s.Get(@"config"),@"focused",s.Get(@"true"));
R.SetIndex(s.Get(@"config"),@"selection",s.Get(@"true"));}
throw new ReturnFlow(s.Get(@"config"));}
if(R.Bool(R.Binary(s,@"Is",s.Get(@"base"),R.Type(@"string")))){foreach(var item798 in R.Array(R.Array(R.Capture((o799) => {R.Emit(o799,new object[]{@"focused",@"selection",@"document",@"selected"});})))){s.Set(@"name",item798);try{if(R.Bool(R.Binary(s,@"Ieq",R.Invoke((""+R.Str(s.Get(@"base"))),@"ToLowerInvariant",new object[]{}),s.Get(@"name")))){R.SetIndex(s.Get(@"config"),s.Get(@"name"),s.Get(@"true"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"config"));}
foreach(var item800 in R.Array(R.Array(R.Capture((o801) => {R.Emit(o801,new object[]{@"focused",@"selection",@"document",@"selected"});})))){s.Set(@"name",item800);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"spec"),s.Get(@"name")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"value")))){throw new ContinueFlow();}
R.Eval(()=>R.Eval(()=>{var u802=s.Get(@"stated");s.Set(@"stated",R.Binary(s,@"Plus",u802,1L));return u802;}));
R.SetIndex(s.Get(@"config"),s.Get(@"name"),R.Cast(@"bool",s.Get(@"value")));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"stated"),0))){R.SetIndex(s.Get(@"config"),@"focused",s.Get(@"true"));
R.SetIndex(s.Get(@"config"),@"selection",s.Get(@"true"));}
throw new ReturnFlow(s.Get(@"config"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_TextBudget_803(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"max",s.Get(@"script:TextBudgetDefault"));
s.Set(@"requested",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),@"maxTextChars"}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"requested")))){s.Set(@"parsed",0);
if(R.Bool((R.Bool(R.Invoke(R.Type(@"int"),@"TryParse",new object[]{(""+R.Str(s.Get(@"requested"))),new Ref(()=>s.Get(@"parsed"),v=>{s.Set(@"parsed",v);})})) && R.Bool(R.Binary(s,@"Igt",s.Get(@"parsed"),0))))){s.Set(@"max",s.Get(@"parsed"));}}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"max"),s.Get(@"script:TextBudgetMax")))){s.Set(@"max",s.Get(@"script:TextBudgetMax"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"max",s.Get(@"max"),@"used",0,@"truncated",s.Get(@"false")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_BudgetRemaining_804(Scope s,Args a){var o=new List<object>();s.Set(@"budget",R.Bind(a,0,@"budget",()=>null,@"object"));
try{s.Set(@"left",R.Binary(s,@"Minus",R.Cast(@"int",R.Index(s.Get(@"budget"),@"max")),R.Cast(@"int",R.Index(s.Get(@"budget"),@"used"))));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"left"),0))){throw new ReturnFlow(0);}
throw new ReturnFlow(s.Get(@"left"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Split_TextAtBudget_805(Scope s,Args a){var o=new List<object>();s.Set(@"Text",R.Bind(a,0,@"Text",()=>null,@"string"));
s.Set(@"Limit",R.Bind(a,1,@"Limit",()=>null,@"int"));
try{s.Set(@"result",R.Cast(@"ordered",R.Map(new object[]{@"text",@"",@"truncated",s.Get(@"false")})));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Text")))){throw new ReturnFlow(s.Get(@"result"));}
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"Limit"),0))){R.SetIndex(s.Get(@"result"),@"truncated",R.Binary(s,@"Igt",R.Member(s.Get(@"Text"),@"Length"),0));
throw new ReturnFlow(s.Get(@"result"));}
if(R.Bool(R.Binary(s,@"Ile",R.Member(s.Get(@"Text"),@"Length"),s.Get(@"Limit")))){R.SetIndex(s.Get(@"result"),@"text",s.Get(@"Text"));
throw new ReturnFlow(s.Get(@"result"));}
s.Set(@"cut",s.Get(@"Limit"));
if(R.Bool(R.Invoke(R.Type(@"char"),@"IsHighSurrogate",new object[]{R.Index(s.Get(@"Text"),R.Binary(s,@"Minus",s.Get(@"cut"),1))}))){s.Set(@"cut",R.Binary(s,@"Minus",s.Get(@"cut"),1));}
R.SetIndex(s.Get(@"result"),@"text",R.Invoke(s.Get(@"Text"),@"Substring",new object[]{0,s.Get(@"cut")}));
R.SetIndex(s.Get(@"result"),@"truncated",s.Get(@"true"));
throw new ReturnFlow(s.Get(@"result"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_BudgetedText_806(Scope s,Args a){var o=new List<object>();s.Set(@"entry",R.Bind(a,0,@"entry",()=>null,@"object"));
s.Set(@"Text",R.Bind(a,1,@"Text",()=>null,@"string"));
s.Set(@"budget",R.Bind(a,2,@"budget",()=>null,@"object"));
try{s.Set(@"remaining",R.Call(s,@"Get-BudgetRemaining",new Args(new object[]{s.Get(@"budget")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"remaining"),0)) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"Text"),@"Length"),0))))){R.SetIndex(s.Get(@"entry"),@"status",@"budget_exhausted");
R.SetIndex(s.Get(@"entry"),@"note",(""+@"the shared text budget ("+R.Str(R.Capture((o807) => {R.Emit(o807,R.Index(s.Get(@"budget"),@"max"));}))+@" chars) was already spent by the fields before this one"));
R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));
throw new ReturnFlow(s.Get(@"entry"));}
s.Set(@"clip",R.Call(s,@"Split-TextAtBudget",new Args(new object[]{s.Get(@"Text"),s.Get(@"remaining")}),null));
R.SetIndex(s.Get(@"entry"),@"value",R.Index(s.Get(@"clip"),@"text"));
if(R.Bool(R.Index(s.Get(@"clip"),@"truncated"))){R.SetIndex(s.Get(@"entry"),@"truncated",s.Get(@"true"));
R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));}
R.SetIndex(s.Get(@"budget"),@"used",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"budget"),@"used")),R.Member(R.Index(s.Get(@"clip"),@"text"),@"Length")));
throw new ReturnFlow(s.Get(@"entry"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Read_UiaRangeText_808(Scope s,Args a){var o=new List<object>();s.Set(@"range",R.Bind(a,0,@"range",()=>null,@"object"));
s.Set(@"budget",R.Bind(a,1,@"budget",()=>null,@"object"));
try{s.Set(@"remaining",R.Call(s,@"Get-BudgetRemaining",new Args(new object[]{s.Get(@"budget")}),null));
s.Set(@"entry",R.Cast(@"ordered",R.Map(new object[]{@"status",@"ok",@"value",@""})));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"remaining"),0))){R.SetIndex(s.Get(@"entry"),@"status",@"budget_exhausted");
R.SetIndex(s.Get(@"entry"),@"note",(""+@"the shared text budget ("+R.Str(R.Capture((o809) => {R.Emit(o809,R.Index(s.Get(@"budget"),@"max"));}))+@" chars) was already spent by the fields before this one"));
R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));
throw new ReturnFlow(s.Get(@"entry"));}
s.Set(@"raw",@"");
try{s.Set(@"raw",R.Cast(@"string",R.Invoke(s.Get(@"range"),@"GetText",new object[]{R.Binary(s,@"Plus",s.Get(@"remaining"),1)})));}catch(Exception error810) when (!(error810 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error810}));R.SetIndex(s.Get(@"entry"),@"status",@"failed");
R.SetIndex(s.Get(@"entry"),@"note",R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));
throw new ReturnFlow(s.Get(@"entry"));}
throw new ReturnFlow(R.Call(s,@"Add-BudgetedText",new Args(new object[]{s.Get(@"entry"),s.Get(@"raw"),s.Get(@"budget")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_UiaCurrentPattern_811(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"Pattern",R.Bind(a,1,@"Pattern",()=>null,@"object"));
try{s.Set(@"probe",s.Get(@"null"));
try{throw new ReturnFlow(R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{s.Get(@"Pattern"),new Ref(()=>s.Get(@"probe"),v=>{s.Set(@"probe",v);})}));}catch(Exception error812) when (!(error812 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error812}));throw new ReturnFlow(s.Get(@"false"));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaCurrentPattern_813(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"Pattern",R.Bind(a,1,@"Pattern",()=>null,@"object"));
try{s.Set(@"probe",s.Get(@"null"));
try{if(R.Bool(R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{s.Get(@"Pattern"),new Ref(()=>s.Get(@"probe"),v=>{s.Set(@"probe",v);})}))){throw new ReturnFlow(s.Get(@"probe"));}}catch(Exception error814) when (!(error814 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error814}));}
throw new ReturnFlow(s.Get(@"null"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaElementWindowHwnd_815(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
try{try{s.Set(@"walker",R.Member(R.Type(@"System.Windows.Automation.TreeWalker"),@"ControlViewWalker"));
s.Set(@"node",s.Get(@"el"));
{s.Set(@"hop",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"hop"),64))){try{s.Set(@"parent",R.Invoke(s.Get(@"walker"),@"GetParent",new object[]{s.Get(@"node")}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"parent")))){throw new BreakFlow();}
s.Set(@"node",s.Get(@"parent"));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u816=s.Get(@"hop");s.Set(@"hop",R.Binary(s,@"Plus",u816,1L));return u816;}));}}
throw new ReturnFlow(R.Cast(@"int64",R.Member(R.Member(s.Get(@"node"),@"Current"),@"NativeWindowHandle")));}catch(Exception error817) when (!(error817 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error817}));throw new ReturnFlow(R.Cast(@"int64",0));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaElementValueText_818(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
try{s.Set(@"pattern",R.Call(s,@"Get-UiaCurrentPattern",new Args(new object[]{s.Get(@"el"),R.Member(R.Type(@"System.Windows.Automation.ValuePattern"),@"Pattern")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"pattern")))){throw new ReturnFlow(s.Get(@"null"));}
try{throw new ReturnFlow(R.Cast(@"string",R.Member(R.Member(R.Cast(@"System.Windows.Automation.ValuePattern",s.Get(@"pattern")),@"Current"),@"Value")));}catch(Exception error819) when (!(error819 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error819}));throw new ReturnFlow(s.Get(@"null"));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Format_UiaElementLine_820(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
try{try{s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));
s.Set(@"type",R.Invoke((""+R.Str(R.Capture((o821) => {R.Emit(o821,R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName"));}))),@"Replace",new object[]{@"ControlType.",@""}));
s.Set(@"name",(""+R.Str(R.Capture((o822) => {R.Emit(o822,R.Member(s.Get(@"info"),@"Name"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"name"),@""))){throw new ReturnFlow(s.Get(@"type"));}
throw new ReturnFlow((""+R.Str(s.Get(@"type"))+@" · "+R.Str(s.Get(@"name"))));}catch(Exception error823) when (!(error823 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error823}));throw new ReturnFlow(@"");}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaSelectionSummaries_824(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"Max",R.Bind(a,1,@"Max",()=>null,@"int"));
try{s.Set(@"out",R.Cast(@"ordered",R.Map(new object[]{@"status",@"unsupported",@"items",R.Array(R.Capture((o825) => {})),@"count",0,@"truncated",s.Get(@"false"),@"note",@""})));
s.Set(@"pattern",R.Call(s,@"Get-UiaCurrentPattern",new Args(new object[]{s.Get(@"el"),R.Member(R.Type(@"System.Windows.Automation.SelectionPattern"),@"Pattern")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"pattern")))){R.SetIndex(s.Get(@"out"),@"note",@"this control does not implement SelectionPattern, so it has no selected items to list");
throw new ReturnFlow(s.Get(@"out"));}
s.Set(@"items",s.Get(@"null"));
try{s.Set(@"items",R.Invoke(R.Member(R.Cast(@"System.Windows.Automation.SelectionPattern",s.Get(@"pattern")),@"Current"),@"GetSelection",new object[]{}));}catch(Exception error826) when (!(error826 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error826}));R.SetIndex(s.Get(@"out"),@"status",@"failed");
R.SetIndex(s.Get(@"out"),@"note",R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));
throw new ReturnFlow(s.Get(@"out"));}
R.SetIndex(s.Get(@"out"),@"status",@"ok");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"items")))){throw new ReturnFlow(s.Get(@"out"));}
s.Set(@"all",R.Array(R.Capture((o827) => {R.Emit(o827,s.Get(@"items"));})));
R.SetIndex(s.Get(@"out"),@"count",R.Member(s.Get(@"all"),@"Count"));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"all"),@"Count"),s.Get(@"Max")))){R.SetIndex(s.Get(@"out"),@"truncated",s.Get(@"true"));}
s.Set(@"lines",R.Array(R.Capture((o828) => {})));
foreach(var item829 in R.Array(R.Array(R.Capture((o830) => {R.Emit(o830,R.Call(s,@"Select-Object",new Args(new object[]{new Named(@"First",R.Switch),s.Get(@"Max")}),s.Get(@"all")));})))){s.Set(@"item",item829);try{s.Set(@"lines",R.Binary(s,@"Plus",s.Get(@"lines"),R.Call(s,@"Format-UiaElementLine",new Args(new object[]{s.Get(@"item")}),null)));}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetIndex(s.Get(@"out"),@"items",s.Get(@"lines"));
throw new ReturnFlow(s.Get(@"out"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_UiaElementMatchesRow_831(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"row",R.Bind(a,1,@"row",()=>null,@"object"));
try{try{s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o832) => {R.Emit(o832,R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName"));}))),(""+R.Str(R.Capture((o833) => {R.Emit(o833,R.Index(s.Get(@"row"),@"controlType"));})))))){throw new ReturnFlow(s.Get(@"false"));}
s.Set(@"rowId",(""+R.Str(R.Capture((o834) => {R.Emit(o834,R.Index(s.Get(@"row"),@"automationId"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"rowId"),@"")) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o835) => {R.Emit(o835,R.Member(s.Get(@"info"),@"AutomationId"));}))),s.Get(@"rowId")))))){throw new ReturnFlow(s.Get(@"false"));}
s.Set(@"rowName",(""+R.Str(R.Capture((o836) => {R.Emit(o836,R.Index(s.Get(@"row"),@"name"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"rowName"),@"")) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o837) => {R.Emit(o837,R.Member(s.Get(@"info"),@"Name"));}))),s.Get(@"rowName")))))){throw new ReturnFlow(s.Get(@"false"));}}catch(Exception error838) when (!(error838 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error838}));throw new ReturnFlow(s.Get(@"false"));}
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Find_TreeRowForElement_839(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"Rows",R.Bind(a,1,@"Rows",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Rows")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"rows",R.Array(R.Capture((o840) => {R.Emit(o840,s.Get(@"Rows"));})));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"rows"),@"Count"),0))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"automationId",@"");
s.Set(@"name",@"");
s.Set(@"type",@"");
s.Set(@"cx",0);
s.Set(@"cy",0);
try{s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));
s.Set(@"automationId",(""+R.Str(R.Capture((o841) => {R.Emit(o841,R.Member(s.Get(@"info"),@"AutomationId"));}))));
s.Set(@"name",(""+R.Str(R.Capture((o842) => {R.Emit(o842,R.Member(s.Get(@"info"),@"Name"));}))));
s.Set(@"type",(""+R.Str(R.Capture((o843) => {R.Emit(o843,R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName"));}))));
s.Set(@"rect",R.Member(s.Get(@"info"),@"BoundingRectangle"));
s.Set(@"cx",R.Cast(@"int",R.Binary(s,@"Plus",R.Member(s.Get(@"rect"),@"X"),R.Binary(s,@"Divide",R.Member(s.Get(@"rect"),@"Width"),2))));
s.Set(@"cy",R.Cast(@"int",R.Binary(s,@"Plus",R.Member(s.Get(@"rect"),@"Y"),R.Binary(s,@"Divide",R.Member(s.Get(@"rect"),@"Height"),2))));}catch(Exception error844) when (!(error844 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error844}));throw new ReturnFlow(s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"automationId"),@""))){foreach(var item845 in R.Array(s.Get(@"rows"))){s.Set(@"row",item845);try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o846) => {R.Emit(o846,R.Index(s.Get(@"row"),@"automationId"));}))),s.Get(@"automationId"))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o847) => {R.Emit(o847,R.Index(s.Get(@"row"),@"controlType"));}))),s.Get(@"type")))))){throw new ReturnFlow(s.Get(@"row"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"name"),@""))){foreach(var item848 in R.Array(s.Get(@"rows"))){s.Set(@"row",item848);try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o849) => {R.Emit(o849,R.Index(s.Get(@"row"),@"name"));}))),s.Get(@"name"))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o850) => {R.Emit(o850,R.Index(s.Get(@"row"),@"controlType"));}))),s.Get(@"type")))))){throw new ReturnFlow(s.Get(@"row"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
foreach(var item851 in R.Array(s.Get(@"rows"))){s.Set(@"row",item851);try{if(R.Bool((R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Index(s.Get(@"row"),@"width")),0)) || R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Index(s.Get(@"row"),@"height")),0))))){throw new ContinueFlow();}
s.Set(@"rx",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"row"),@"x")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"row"),@"width")),2))));
s.Set(@"ry",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"row"),@"y")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"row"),@"height")),2))));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",s.Get(@"rx"),s.Get(@"cx"))}),3)) && R.Bool(R.Binary(s,@"Ile",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",s.Get(@"ry"),s.Get(@"cy"))}),3))))){throw new ReturnFlow(s.Get(@"row"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"null"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Resolve_TextTarget_852(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"Hwnd",R.Bind(a,1,@"Hwnd",()=>null,@"int64"));
s.Set(@"Rows",R.Bind(a,2,@"Rows",()=>null,@"object"));
try{s.Set(@"result",R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"status",@"target_required",@"el",s.Get(@"null"),@"source",@"",@"ref",@"",@"note",@""})));
s.Set(@"target",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),@"textTarget"}),null));
s.Set(@"ref",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target")))){s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"target"),@"ref"}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value")))){s.Set(@"ref",R.Invoke((""+R.Str(s.Get(@"value"))),@"Trim",new object[]{}));}}
s.Set(@"selector",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target")))){s.Set(@"candidate",R.Cast(@"ordered",R.Map(new object[]{})));
foreach(var item853 in R.Array(R.Array(R.Capture((o854) => {R.Emit(o854,new object[]{R.Array(R.Capture((o855) => {R.Emit(o855,new object[]{@"automationId",@"automation_id"});})),R.Array(R.Capture((o856) => {R.Emit(o856,new object[]{@"name",@"name"});})),R.Array(R.Capture((o857) => {R.Emit(o857,new object[]{@"controlType",@"control_type"});})),R.Array(R.Capture((o858) => {R.Emit(o858,new object[]{@"className",@"class_name"});})),R.Array(R.Capture((o859) => {R.Emit(o859,new object[]{@"index",@"index"});}))});})))){s.Set(@"pair",item853);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"target"),R.Index(s.Get(@"pair"),0)}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"value")))){s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"target"),R.Index(s.Get(@"pair"),1)}),null));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"value"))),@""))))){R.SetIndex(s.Get(@"candidate"),R.Index(s.Get(@"pair"),0),s.Get(@"value"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"candidate"),@"Count"),0))){s.Set(@"selector",s.Get(@"candidate"));}}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"ref"),@"")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"selector")))))){R.SetIndex(s.Get(@"result"),@"note",@"both a ref and a selector were given; the ref is used, because it names one element this session actually read");}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"ref"),@""))){s.Set(@"resolved",R.Call(s,@"Resolve-ElementRef",new Args(new object[]{s.Get(@"ref")}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"resolved"),@"ok")))){R.SetIndex(s.Get(@"result"),@"status",@"unavailable");
R.SetIndex(s.Get(@"result"),@"ref",s.Get(@"ref"));
R.SetIndex(s.Get(@"result"),@"note",(""+R.Str(R.Capture((o860) => {R.Emit(o860,R.Member(s.Get(@"resolved"),@"error"));}))));
throw new ReturnFlow(s.Get(@"result"));}
s.Set(@"selector",R.Member(s.Get(@"resolved"),@"selector"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"selector")))){s.Set(@"findArg",R.Cast(@"ordered",R.Map(new object[]{})));
foreach(var item861 in R.Array(R.Array(R.Capture((o862) => {R.Emit(o862,new object[]{@"automationId",@"name",@"controlType",@"className",@"index"});})))){s.Set(@"key",item861);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"selector"),s.Get(@"key")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value")))){R.SetIndex(s.Get(@"findArg"),s.Get(@"key"),s.Get(@"value"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"namedHwnd",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"target"),@"hwnd"}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"namedHwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",s.Get(@"namedHwnd")),0))))){R.SetIndex(s.Get(@"findArg"),@"hwnd",R.Cast(@"int64",s.Get(@"namedHwnd")));}else{R.SetIndex(s.Get(@"findArg"),@"hwnd",s.Get(@"Hwnd"));}
s.Set(@"el",s.Get(@"null"));
s.Set(@"failure",@"");
try{s.Set(@"el",R.Call(s,@"Find-UiaMatch",new Args(new object[]{R.Call(s,@"Get-UiaRoot",new Args(new object[]{s.Get(@"findArg")}),null),s.Get(@"findArg")}),null));}catch(Exception error863) when (!(error863 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error863}));s.Set(@"el",s.Get(@"null"));
s.Set(@"failure",R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"el")))){R.SetIndex(s.Get(@"result"),@"status",@"unavailable");
R.SetIndex(s.Get(@"result"),@"ref",s.Get(@"ref"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"failure"),@""))){R.SetIndex(s.Get(@"result"),@"note",(""+@"the target named by this request could not be resolved in hwnd "+R.Str(R.Capture((o864) => {R.Emit(o864,R.Index(s.Get(@"findArg"),@"hwnd"));}))+@": "+R.Str(s.Get(@"failure"))));}else{R.SetIndex(s.Get(@"result"),@"note",(""+@"the target named by this request could not be resolved in hwnd "+R.Str(R.Capture((o865) => {R.Emit(o865,R.Index(s.Get(@"findArg"),@"hwnd"));}))));}
throw new ReturnFlow(s.Get(@"result"));}
R.SetIndex(s.Get(@"result"),@"ok",s.Get(@"true"));
R.SetIndex(s.Get(@"result"),@"el",s.Get(@"el"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"ref"),@""))){R.SetIndex(s.Get(@"result"),@"source",@"ref");}else{R.SetIndex(s.Get(@"result"),@"source",@"selector");}
R.SetIndex(s.Get(@"result"),@"ref",s.Get(@"ref"));
throw new ReturnFlow(s.Get(@"result"));}
s.Set(@"focused",s.Get(@"null"));
try{s.Set(@"focused",R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"FocusedElement"));}catch(Exception error866) when (!(error866 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error866}));s.Set(@"focused",s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"focused")))){s.Set(@"ownerHwnd",R.Call(s,@"Get-UiaElementWindowHwnd",new Args(new object[]{s.Get(@"focused")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"ownerHwnd"),0)) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"ownerHwnd"),s.Get(@"Hwnd")))))){R.SetIndex(s.Get(@"result"),@"ok",s.Get(@"true"));
R.SetIndex(s.Get(@"result"),@"el",s.Get(@"focused"));
R.SetIndex(s.Get(@"result"),@"source",@"focused");
throw new ReturnFlow(s.Get(@"result"));}
R.SetIndex(s.Get(@"result"),@"note",(""+@"the focused control belongs to hwnd "+R.Str(s.Get(@"ownerHwnd"))+@", not to this read's window (hwnd "+R.Str(s.Get(@"Hwnd"))+@"), so it was left out"));}
s.Set(@"candidates",R.Array(R.Capture((o867) => {})));
foreach(var item868 in R.Array(R.Array(R.Capture((o869) => {R.Emit(o869,s.Get(@"Rows"));})))){s.Set(@"row",item868);try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"row")))){throw new ContinueFlow();}
if(R.Bool(R.Cast(@"bool",R.Index(s.Get(@"row"),@"offscreen")))){throw new ContinueFlow();}
if(R.Bool(R.Binary(s,@"Icontains",R.Array(R.Capture((o870) => {R.Emit(o870,R.Index(s.Get(@"row"),@"patterns"));})),@"text"))){s.Set(@"candidates",R.Binary(s,@"Plus",s.Get(@"candidates"),s.Get(@"row")));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"candidates"),@"Count"),0))){s.Set(@"chosen",R.Index(s.Get(@"candidates"),0));
s.Set(@"findArg",R.Cast(@"ordered",R.Map(new object[]{@"hwnd",s.Get(@"Hwnd")})));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o871) => {R.Emit(o871,R.Index(s.Get(@"chosen"),@"automationId"));}))),@""))){R.SetIndex(s.Get(@"findArg"),@"automationId",(""+R.Str(R.Capture((o872) => {R.Emit(o872,R.Index(s.Get(@"chosen"),@"automationId"));}))));}else{R.SetIndex(s.Get(@"findArg"),@"controlType",(""+R.Str(R.Capture((o873) => {R.Emit(o873,R.Index(s.Get(@"chosen"),@"controlType"));}))));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o874) => {R.Emit(o874,R.Index(s.Get(@"chosen"),@"className"));}))),@""))){R.SetIndex(s.Get(@"findArg"),@"className",(""+R.Str(R.Capture((o875) => {R.Emit(o875,R.Index(s.Get(@"chosen"),@"className"));}))));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o876) => {R.Emit(o876,R.Index(s.Get(@"chosen"),@"name"));}))),@""))){R.SetIndex(s.Get(@"findArg"),@"name",(""+R.Str(R.Capture((o877) => {R.Emit(o877,R.Index(s.Get(@"chosen"),@"name"));}))));}
s.Set(@"index",0);
foreach(var item878 in R.Array(R.Array(R.Capture((o879) => {R.Emit(o879,s.Get(@"Rows"));})))){s.Set(@"row",item878);try{if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o880) => {R.Emit(o880,R.Index(s.Get(@"row"),@"ref"));}))),(""+R.Str(R.Capture((o881) => {R.Emit(o881,R.Index(s.Get(@"chosen"),@"ref"));})))))){throw new BreakFlow();}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o882) => {R.Emit(o882,R.Index(s.Get(@"row"),@"controlType"));}))),(""+R.Str(R.Capture((o883) => {R.Emit(o883,R.Index(s.Get(@"chosen"),@"controlType"));}))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o884) => {R.Emit(o884,R.Index(s.Get(@"row"),@"className"));}))),(""+R.Str(R.Capture((o885) => {R.Emit(o885,R.Index(s.Get(@"chosen"),@"className"));}))))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o886) => {R.Emit(o886,R.Index(s.Get(@"row"),@"name"));}))),(""+R.Str(R.Capture((o887) => {R.Emit(o887,R.Index(s.Get(@"chosen"),@"name"));})))))))){R.Eval(()=>R.Eval(()=>{var u888=s.Get(@"index");s.Set(@"index",R.Binary(s,@"Plus",u888,1L));return u888;}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"index"),0))){R.SetIndex(s.Get(@"findArg"),@"index",s.Get(@"index"));}}
s.Set(@"el",s.Get(@"null"));
try{s.Set(@"el",R.Call(s,@"Find-UiaMatch",new Args(new object[]{R.Call(s,@"Get-UiaRoot",new Args(new object[]{s.Get(@"findArg")}),null),s.Get(@"findArg")}),null));}catch(Exception error889) when (!(error889 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error889}));s.Set(@"el",s.Get(@"null"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"el"))) && R.Bool(R.Call(s,@"Test-UiaElementMatchesRow",new Args(new object[]{s.Get(@"el"),s.Get(@"chosen")}),null))))){R.SetIndex(s.Get(@"result"),@"ok",s.Get(@"true"));
R.SetIndex(s.Get(@"result"),@"el",s.Get(@"el"));
R.SetIndex(s.Get(@"result"),@"source",@"read-row");
R.SetIndex(s.Get(@"result"),@"ref",(""+R.Str(R.Capture((o890) => {R.Emit(o890,R.Index(s.Get(@"chosen"),@"ref"));}))));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"candidates"),@"Count"),1))){R.SetIndex(s.Get(@"result"),@"note",(""+R.Str(R.Capture((o891) => {R.Emit(o891,R.Member(s.Get(@"candidates"),@"Count"));}))+@" rows of this read expose text; the first one was read - pass text_target to say which control you meant"));}
throw new ReturnFlow(s.Get(@"result"));}
if(R.Bool(R.Binary(s,@"Ieq",R.Index(s.Get(@"result"),@"note"),@""))){R.SetIndex(s.Get(@"result"),@"note",@"the text-providing row of this read could not be re-resolved to the same element, so nothing was read from it");}}
R.SetIndex(s.Get(@"result"),@"status",@"target_required");
if(R.Bool(R.Binary(s,@"Ieq",R.Index(s.Get(@"result"),@"note"),@""))){R.SetIndex(s.Get(@"result"),@"note",@"no text provider could be resolved without scanning the window; pass text_target with a ref from this read (or an exact selector) to say which control to read");}
throw new ReturnFlow(s.Get(@"result"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaTextObservationManaged_892(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"Hwnd",R.Bind(a,1,@"Hwnd",()=>null,@"int64"));
s.Set(@"Rows",R.Bind(a,2,@"Rows",()=>null,@"object"));
s.Set(@"config",R.Bind(a,3,@"config",()=>null,@"object"));
try{s.Set(@"budget",R.Call(s,@"New-TextBudget",new Args(new object[]{s.Get(@"Arg")}),null));
s.Set(@"observation",R.Cast(@"ordered",R.Map(new object[]{})));
s.Set(@"target",R.Call(s,@"Resolve-TextTarget",new Args(new object[]{s.Get(@"Arg"),s.Get(@"Hwnd"),s.Get(@"Rows")}),null));
s.Set(@"targetLine",R.Cast(@"ordered",R.Map(new object[]{@"ok",R.Cast(@"bool",R.Index(s.Get(@"target"),@"ok")),@"source",(""+R.Str(R.Capture((o893) => {R.Emit(o893,R.Index(s.Get(@"target"),@"source"));})))})));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o894) => {R.Emit(o894,R.Index(s.Get(@"target"),@"status"));}))),@"target_required")) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o895) => {R.Emit(o895,R.Index(s.Get(@"target"),@"status"));}))),@"unavailable"))))){R.SetIndex(s.Get(@"targetLine"),@"status",(""+R.Str(R.Capture((o896) => {R.Emit(o896,R.Index(s.Get(@"target"),@"status"));}))));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o897) => {R.Emit(o897,R.Index(s.Get(@"target"),@"ref"));}))),@""))){R.SetIndex(s.Get(@"targetLine"),@"ref",(""+R.Str(R.Capture((o898) => {R.Emit(o898,R.Index(s.Get(@"target"),@"ref"));}))));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o899) => {R.Emit(o899,R.Index(s.Get(@"target"),@"note"));}))),@""))){R.SetIndex(s.Get(@"targetLine"),@"note",(""+R.Str(R.Capture((o900) => {R.Emit(o900,R.Index(s.Get(@"target"),@"note"));}))));}
R.SetIndex(s.Get(@"observation"),@"target",s.Get(@"targetLine"));
if(R.Bool(R.Unary(@"Not",R.Index(s.Get(@"target"),@"ok")))){foreach(var item901 in R.Array(R.Array(R.Capture((o902) => {R.Emit(o902,new object[]{@"focused",@"selection",@"document",@"selected"});})))){s.Set(@"name",item901);try{if(R.Bool(R.Unary(@"Not",R.Index(s.Get(@"config"),s.Get(@"name"))))){throw new ContinueFlow();}
s.Set(@"field",R.Cast(@"ordered",R.Map(new object[]{@"status",(""+R.Str(R.Capture((o903) => {R.Emit(o903,R.Index(s.Get(@"target"),@"status"));})))})));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o904) => {R.Emit(o904,R.Index(s.Get(@"target"),@"note"));}))),@""))){R.SetIndex(s.Get(@"field"),@"note",(""+R.Str(R.Capture((o905) => {R.Emit(o905,R.Index(s.Get(@"target"),@"note"));}))));}
R.SetIndex(s.Get(@"observation"),s.Get(@"name"),s.Get(@"field"));}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetIndex(s.Get(@"observation"),@"budget",R.Cast(@"ordered",R.Map(new object[]{@"max_chars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"max")),@"returned_chars",0,@"truncated",s.Get(@"false")})));
throw new ReturnFlow(s.Get(@"observation"));}
s.Set(@"el",R.Index(s.Get(@"target"),@"el"));
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o906) => {R.Emit(o906,R.Index(s.Get(@"target"),@"ref"));}))),@""))){s.Set(@"row",R.Call(s,@"Find-TreeRowForElement",new Args(new object[]{s.Get(@"el"),s.Get(@"Rows")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"row")))){s.Set(@"rowRef",(""+R.Str(R.Capture((o907) => {R.Emit(o907,R.Index(s.Get(@"row"),@"ref"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"rowRef"),@""))){R.SetIndex(R.Index(s.Get(@"observation"),@"target"),@"ref",s.Get(@"rowRef"));}}}
if(R.Bool(R.Index(s.Get(@"config"),@"focused"))){s.Set(@"entry",R.Cast(@"ordered",R.Map(new object[]{@"status",@"ok",@"summary",@""})));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o908) => {R.Emit(o908,R.Index(R.Index(s.Get(@"observation"),@"target"),@"ref"));}))),@""))){R.SetIndex(s.Get(@"entry"),@"ref",(""+R.Str(R.Capture((o909) => {R.Emit(o909,R.Index(R.Index(s.Get(@"observation"),@"target"),@"ref"));}))));}
s.Set(@"summary",R.Call(s,@"Format-UiaElementLine",new Args(new object[]{s.Get(@"el")}),null));
s.Set(@"value",R.Call(s,@"Get-UiaElementValueText",new Args(new object[]{s.Get(@"el")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"value"),@""))))){s.Set(@"summary",(""+R.Str(s.Get(@"summary"))+@" · 值: "+R.Str(s.Get(@"value"))));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"summary"),@""))){s.Set(@"summary",@"the focused control reports no accessible name");}
s.Set(@"cap",s.Get(@"script:FocusedSummaryDefault"));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"script:FocusedSummaryMax"),s.Get(@"cap")))){s.Set(@"cap",s.Get(@"script:FocusedSummaryMax"));}
s.Set(@"remaining",R.Call(s,@"Get-BudgetRemaining",new Args(new object[]{s.Get(@"budget")}),null));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"remaining"),s.Get(@"cap")))){s.Set(@"cap",s.Get(@"remaining"));}
s.Set(@"clip",R.Call(s,@"Split-TextAtBudget",new Args(new object[]{s.Get(@"summary"),s.Get(@"cap")}),null));
R.SetIndex(s.Get(@"entry"),@"summary",R.Index(s.Get(@"clip"),@"text"));
if(R.Bool(R.Index(s.Get(@"clip"),@"truncated"))){R.SetIndex(s.Get(@"entry"),@"truncated",s.Get(@"true"));
R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));}
R.SetIndex(s.Get(@"budget"),@"used",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"budget"),@"used")),R.Member(R.Index(s.Get(@"clip"),@"text"),@"Length")));
R.SetIndex(s.Get(@"observation"),@"focused",s.Get(@"entry"));}
if(R.Bool(R.Index(s.Get(@"config"),@"selection"))){s.Set(@"entry",R.Cast(@"ordered",R.Map(new object[]{@"status",@"ok",@"value",@""})));
s.Set(@"pattern",R.Call(s,@"Get-UiaCurrentPattern",new Args(new object[]{s.Get(@"el"),R.Member(R.Type(@"System.Windows.Automation.TextPattern"),@"Pattern")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"pattern")))){R.SetIndex(s.Get(@"entry"),@"status",@"unsupported");
R.SetIndex(s.Get(@"entry"),@"note",@"this control does not implement TextPattern, so it cannot report a selection; its value (when it has one) is in `focused`, and get_value reads it directly");
R.SetIndex(s.Get(@"observation"),@"selection",s.Get(@"entry"));}else{s.Set(@"segments",R.Array(R.Capture((o910) => {})));
s.Set(@"failure",@"");
try{s.Set(@"ranges",R.Invoke(R.Cast(@"System.Windows.Automation.TextPattern",s.Get(@"pattern")),@"GetSelection",new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"ranges")))){foreach(var item911 in R.Array(R.Array(R.Capture((o912) => {R.Emit(o912,s.Get(@"ranges"));})))){s.Set(@"range",item911);try{s.Set(@"piece",@"");
try{s.Set(@"piece",R.Cast(@"string",R.Invoke(s.Get(@"range"),@"GetText",new object[]{-1})));}catch(Exception error913) when (!(error913 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error913}));s.Set(@"piece",@"");}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"piece"),@""))){s.Set(@"segments",R.Binary(s,@"Plus",s.Get(@"segments"),s.Get(@"piece")));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}}catch(Exception error914) when (!(error914 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error914}));s.Set(@"failure",R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"failure"),@""))){R.SetIndex(s.Get(@"entry"),@"status",@"failed");
R.SetIndex(s.Get(@"entry"),@"note",s.Get(@"failure"));}else if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"segments"),@"Count"),0))){R.SetIndex(s.Get(@"entry"),@"note",@"nothing is selected in this control (an empty selection is an answer, not a failed read)");}else{R.Emit(o,R.Cast(@"void",R.Call(s,@"Add-BudgetedText",new Args(new object[]{s.Get(@"entry"),R.Binary(s,@"Join",s.Get(@"segments"),@"
"),s.Get(@"budget")}),null)));}
R.SetIndex(s.Get(@"observation"),@"selection",s.Get(@"entry"));}}
if(R.Bool(R.Index(s.Get(@"config"),@"document"))){s.Set(@"pattern",R.Call(s,@"Get-UiaCurrentPattern",new Args(new object[]{s.Get(@"el"),R.Member(R.Type(@"System.Windows.Automation.TextPattern"),@"Pattern")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"pattern")))){R.SetIndex(s.Get(@"observation"),@"document",R.Cast(@"ordered",R.Map(new object[]{@"status",@"unsupported",@"note",@"this control does not implement TextPattern, so its document text cannot be read here; computer_ui_action get_text reads the same control when its provider supports it"})));}else{s.Set(@"range",s.Get(@"null"));
try{s.Set(@"range",R.Member(R.Cast(@"System.Windows.Automation.TextPattern",s.Get(@"pattern")),@"DocumentRange"));}catch(Exception error915) when (!(error915 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error915}));s.Set(@"range",s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"range")))){R.SetIndex(s.Get(@"observation"),@"document",R.Cast(@"ordered",R.Map(new object[]{@"status",@"failed",@"note",@"the control reported no document range"})));}else{R.SetIndex(s.Get(@"observation"),@"document",R.Call(s,@"Read-UiaRangeText",new Args(new object[]{s.Get(@"range"),s.Get(@"budget")}),null));}}}
if(R.Bool(R.Index(s.Get(@"config"),@"selected"))){s.Set(@"max",s.Get(@"script:SelectedItemsDefault"));
s.Set(@"requested",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),@"maxSelected"}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"requested")))){s.Set(@"parsed",0);
if(R.Bool((R.Bool(R.Invoke(R.Type(@"int"),@"TryParse",new object[]{(""+R.Str(s.Get(@"requested"))),new Ref(()=>s.Get(@"parsed"),v=>{s.Set(@"parsed",v);})})) && R.Bool(R.Binary(s,@"Igt",s.Get(@"parsed"),0))))){s.Set(@"max",s.Get(@"parsed"));}}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"max"),s.Get(@"script:SelectedItemsMax")))){s.Set(@"max",s.Get(@"script:SelectedItemsMax"));}
s.Set(@"items",R.Call(s,@"Get-UiaSelectionSummaries",new Args(new object[]{s.Get(@"el"),s.Get(@"max")}),null));
s.Set(@"entry",R.Cast(@"ordered",R.Map(new object[]{@"status",(""+R.Str(R.Capture((o916) => {R.Emit(o916,R.Index(s.Get(@"items"),@"status"));})))})));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o917) => {R.Emit(o917,R.Index(s.Get(@"items"),@"note"));}))),@""))){R.SetIndex(s.Get(@"entry"),@"note",(""+R.Str(R.Capture((o918) => {R.Emit(o918,R.Index(s.Get(@"items"),@"note"));}))));}
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o919) => {R.Emit(o919,R.Index(s.Get(@"items"),@"status"));}))),@"ok"))){R.SetIndex(s.Get(@"entry"),@"count",R.Cast(@"int",R.Index(s.Get(@"items"),@"count")));
if(R.Bool(R.Cast(@"bool",R.Index(s.Get(@"items"),@"truncated")))){R.SetIndex(s.Get(@"entry"),@"truncated",s.Get(@"true"));}
s.Set(@"lines",R.Array(R.Capture((o920) => {})));
foreach(var item921 in R.Array(R.Array(R.Capture((o922) => {R.Emit(o922,R.Index(s.Get(@"items"),@"items"));})))){s.Set(@"line",item921);try{s.Set(@"remaining",R.Call(s,@"Get-BudgetRemaining",new Args(new object[]{s.Get(@"budget")}),null));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"remaining"),0))){R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));
R.SetIndex(s.Get(@"entry"),@"budget_exhausted",s.Get(@"true"));
throw new BreakFlow();}
s.Set(@"clip",R.Call(s,@"Split-TextAtBudget",new Args(new object[]{(""+R.Str(s.Get(@"line"))),s.Get(@"remaining")}),null));
s.Set(@"lines",R.Binary(s,@"Plus",s.Get(@"lines"),R.Index(s.Get(@"clip"),@"text")));
R.SetIndex(s.Get(@"budget"),@"used",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"budget"),@"used")),R.Member(R.Index(s.Get(@"clip"),@"text"),@"Length")));
if(R.Bool(R.Index(s.Get(@"clip"),@"truncated"))){R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));
R.SetIndex(s.Get(@"entry"),@"truncated",s.Get(@"true"));
throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetIndex(s.Get(@"entry"),@"items",s.Get(@"lines"));}
R.SetIndex(s.Get(@"observation"),@"selected",s.Get(@"entry"));}
R.SetIndex(s.Get(@"observation"),@"budget",R.Cast(@"ordered",R.Map(new object[]{@"max_chars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"max")),@"returned_chars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"used")),@"truncated",R.Cast(@"bool",R.Index(s.Get(@"budget"),@"truncated"))})));
throw new ReturnFlow(s.Get(@"observation"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Find_RowForIdentity_923(Scope s,Args a){var o=new List<object>();s.Set(@"Rows",R.Bind(a,0,@"Rows",()=>null,@"object"));
s.Set(@"autoId",R.Bind(a,1,@"autoId",()=>null,@"object"));
s.Set(@"name",R.Bind(a,2,@"name",()=>null,@"object"));
s.Set(@"controlType",R.Bind(a,3,@"controlType",()=>null,@"object"));
s.Set(@"cx",R.Bind(a,4,@"cx",()=>null,@"int"));
s.Set(@"cy",R.Bind(a,5,@"cy",()=>null,@"int"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Rows")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"rows",R.Array(R.Capture((o924) => {R.Emit(o924,s.Get(@"Rows"));})));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"rows"),@"Count"),0))){throw new ReturnFlow(s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"autoId"))),@""))){foreach(var item925 in R.Array(s.Get(@"rows"))){s.Set(@"row",item925);try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o926) => {R.Emit(o926,R.Index(s.Get(@"row"),@"automationId"));}))),(""+R.Str(s.Get(@"autoId"))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o927) => {R.Emit(o927,R.Index(s.Get(@"row"),@"controlType"));}))),(""+R.Str(s.Get(@"controlType")))))))){throw new ReturnFlow(s.Get(@"row"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"name"))),@""))){foreach(var item928 in R.Array(s.Get(@"rows"))){s.Set(@"row",item928);try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o929) => {R.Emit(o929,R.Index(s.Get(@"row"),@"name"));}))),(""+R.Str(s.Get(@"name"))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o930) => {R.Emit(o930,R.Index(s.Get(@"row"),@"controlType"));}))),(""+R.Str(s.Get(@"controlType")))))))){throw new ReturnFlow(s.Get(@"row"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
foreach(var item931 in R.Array(s.Get(@"rows"))){s.Set(@"row",item931);try{if(R.Bool((R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Index(s.Get(@"row"),@"width")),0)) || R.Bool(R.Binary(s,@"Ile",R.Cast(@"int",R.Index(s.Get(@"row"),@"height")),0))))){throw new ContinueFlow();}
s.Set(@"rx",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"row"),@"x")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"row"),@"width")),2))));
s.Set(@"ry",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"row"),@"y")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"row"),@"height")),2))));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",s.Get(@"rx"),s.Get(@"cx"))}),3)) && R.Bool(R.Binary(s,@"Ile",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Binary(s,@"Minus",s.Get(@"ry"),s.Get(@"cy"))}),3))))){throw new ReturnFlow(s.Get(@"row"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"null"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Resolve_TextTargetCom_932(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"Hwnd",R.Bind(a,1,@"Hwnd",()=>null,@"int64"));
s.Set(@"Rows",R.Bind(a,2,@"Rows",()=>null,@"object"));
s.Set(@"skipFocused",R.Bind(a,3,@"skipFocused",()=>s.Get(@"false"),@"bool"));
try{s.Set(@"plan",R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"status",@"target_required",@"source",@"",@"ref",@"",@"note",@"",@"useFocused",s.Get(@"false"),@"selector",s.Get(@"null")})));
s.Set(@"target",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),@"textTarget"}),null));
s.Set(@"ref",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target")))){s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"target"),@"ref"}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value")))){s.Set(@"ref",R.Invoke((""+R.Str(s.Get(@"value"))),@"Trim",new object[]{}));}}
s.Set(@"selector",R.Cast(@"ordered",R.Map(new object[]{})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"target")))){foreach(var item933 in R.Array(R.Array(R.Capture((o934) => {R.Emit(o934,new object[]{R.Array(R.Capture((o935) => {R.Emit(o935,new object[]{@"automationId",@"automation_id"});})),R.Array(R.Capture((o936) => {R.Emit(o936,new object[]{@"name",@"name"});})),R.Array(R.Capture((o937) => {R.Emit(o937,new object[]{@"controlType",@"control_type"});})),R.Array(R.Capture((o938) => {R.Emit(o938,new object[]{@"className",@"class_name"});})),R.Array(R.Capture((o939) => {R.Emit(o939,new object[]{@"index",@"index"});}))});})))){s.Set(@"pair",item933);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"target"),R.Index(s.Get(@"pair"),0)}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"value")))){s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"target"),R.Index(s.Get(@"pair"),1)}),null));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"value"))),@""))))){R.SetIndex(s.Get(@"selector"),R.Index(s.Get(@"pair"),0),s.Get(@"value"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
s.Set(@"hasSelector",R.Binary(s,@"Igt",R.Member(s.Get(@"selector"),@"Count"),0));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"ref"),@"")) && R.Bool(s.Get(@"hasSelector"))))){R.SetIndex(s.Get(@"plan"),@"note",@"both a ref and a selector were given; the ref is used, because it names one element this session actually read");}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"ref"),@""))){s.Set(@"resolved",R.Call(s,@"Resolve-ElementRef",new Args(new object[]{s.Get(@"ref")}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"resolved"),@"ok")))){R.SetIndex(s.Get(@"plan"),@"status",@"unavailable");
R.SetIndex(s.Get(@"plan"),@"ref",s.Get(@"ref"));
R.SetIndex(s.Get(@"plan"),@"note",(""+R.Str(R.Capture((o940) => {R.Emit(o940,R.Member(s.Get(@"resolved"),@"error"));}))));
throw new ReturnFlow(s.Get(@"plan"));}
s.Set(@"selector",R.Cast(@"ordered",R.Map(new object[]{})));
foreach(var item941 in R.Array(R.Array(R.Capture((o942) => {R.Emit(o942,new object[]{@"automationId",@"name",@"controlType",@"className",@"index"});})))){s.Set(@"key",item941);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{R.Member(s.Get(@"resolved"),@"selector"),s.Get(@"key")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"value"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"value"))),@""))))){R.SetIndex(s.Get(@"selector"),s.Get(@"key"),s.Get(@"value"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetIndex(s.Get(@"plan"),@"ok",s.Get(@"true"));
R.SetIndex(s.Get(@"plan"),@"source",@"ref");
R.SetIndex(s.Get(@"plan"),@"ref",s.Get(@"ref"));
R.SetIndex(s.Get(@"plan"),@"selector",s.Get(@"selector"));
throw new ReturnFlow(s.Get(@"plan"));}
if(R.Bool(s.Get(@"hasSelector"))){R.SetIndex(s.Get(@"plan"),@"ok",s.Get(@"true"));
R.SetIndex(s.Get(@"plan"),@"source",@"selector");
R.SetIndex(s.Get(@"plan"),@"selector",s.Get(@"selector"));
throw new ReturnFlow(s.Get(@"plan"));}
if(R.Bool(R.Unary(@"Not",s.Get(@"skipFocused")))){R.SetIndex(s.Get(@"plan"),@"ok",s.Get(@"true"));
R.SetIndex(s.Get(@"plan"),@"source",@"focused");
R.SetIndex(s.Get(@"plan"),@"useFocused",s.Get(@"true"));
throw new ReturnFlow(s.Get(@"plan"));}
s.Set(@"candidates",R.Array(R.Capture((o943) => {})));
foreach(var item944 in R.Array(R.Array(R.Capture((o945) => {R.Emit(o945,s.Get(@"Rows"));})))){s.Set(@"row",item944);try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"row")))){throw new ContinueFlow();}
if(R.Bool(R.Cast(@"bool",R.Index(s.Get(@"row"),@"offscreen")))){throw new ContinueFlow();}
if(R.Bool(R.Binary(s,@"Icontains",R.Array(R.Capture((o946) => {R.Emit(o946,R.Index(s.Get(@"row"),@"patterns"));})),@"text"))){s.Set(@"candidates",R.Binary(s,@"Plus",s.Get(@"candidates"),s.Get(@"row")));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"candidates"),@"Count"),0))){s.Set(@"chosen",R.Index(s.Get(@"candidates"),0));
s.Set(@"rowSelector",R.Cast(@"ordered",R.Map(new object[]{})));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o947) => {R.Emit(o947,R.Index(s.Get(@"chosen"),@"automationId"));}))),@""))){R.SetIndex(s.Get(@"rowSelector"),@"automationId",(""+R.Str(R.Capture((o948) => {R.Emit(o948,R.Index(s.Get(@"chosen"),@"automationId"));}))));}else{R.SetIndex(s.Get(@"rowSelector"),@"controlType",(""+R.Str(R.Capture((o949) => {R.Emit(o949,R.Index(s.Get(@"chosen"),@"controlType"));}))));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o950) => {R.Emit(o950,R.Index(s.Get(@"chosen"),@"className"));}))),@""))){R.SetIndex(s.Get(@"rowSelector"),@"className",(""+R.Str(R.Capture((o951) => {R.Emit(o951,R.Index(s.Get(@"chosen"),@"className"));}))));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o952) => {R.Emit(o952,R.Index(s.Get(@"chosen"),@"name"));}))),@""))){R.SetIndex(s.Get(@"rowSelector"),@"name",(""+R.Str(R.Capture((o953) => {R.Emit(o953,R.Index(s.Get(@"chosen"),@"name"));}))));}
s.Set(@"index",0);
foreach(var item954 in R.Array(R.Array(R.Capture((o955) => {R.Emit(o955,s.Get(@"Rows"));})))){s.Set(@"row",item954);try{if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o956) => {R.Emit(o956,R.Index(s.Get(@"row"),@"ref"));}))),(""+R.Str(R.Capture((o957) => {R.Emit(o957,R.Index(s.Get(@"chosen"),@"ref"));})))))){throw new BreakFlow();}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o958) => {R.Emit(o958,R.Index(s.Get(@"row"),@"controlType"));}))),(""+R.Str(R.Capture((o959) => {R.Emit(o959,R.Index(s.Get(@"chosen"),@"controlType"));}))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o960) => {R.Emit(o960,R.Index(s.Get(@"row"),@"className"));}))),(""+R.Str(R.Capture((o961) => {R.Emit(o961,R.Index(s.Get(@"chosen"),@"className"));}))))))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o962) => {R.Emit(o962,R.Index(s.Get(@"row"),@"name"));}))),(""+R.Str(R.Capture((o963) => {R.Emit(o963,R.Index(s.Get(@"chosen"),@"name"));})))))))){R.Eval(()=>R.Eval(()=>{var u964=s.Get(@"index");s.Set(@"index",R.Binary(s,@"Plus",u964,1L));return u964;}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"index"),0))){R.SetIndex(s.Get(@"rowSelector"),@"index",s.Get(@"index"));}}
R.SetIndex(s.Get(@"plan"),@"ok",s.Get(@"true"));
R.SetIndex(s.Get(@"plan"),@"source",@"read-row");
R.SetIndex(s.Get(@"plan"),@"ref",(""+R.Str(R.Capture((o965) => {R.Emit(o965,R.Index(s.Get(@"chosen"),@"ref"));}))));
R.SetIndex(s.Get(@"plan"),@"selector",s.Get(@"rowSelector"));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"candidates"),@"Count"),1))){R.SetIndex(s.Get(@"plan"),@"note",(""+R.Str(R.Capture((o966) => {R.Emit(o966,R.Member(s.Get(@"candidates"),@"Count"));}))+@" rows of this read expose text; the first one was read - pass text_target to say which control you meant"));}
throw new ReturnFlow(s.Get(@"plan"));}
R.SetIndex(s.Get(@"plan"),@"note",@"no text provider could be resolved without scanning the window; pass text_target with a ref from this read (or an exact selector) to say which control to read");
throw new ReturnFlow(s.Get(@"plan"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_TextFieldEntry_967(Scope s,Args a){var o=new List<object>();s.Set(@"name",R.Bind(a,0,@"name",()=>null,@"object"));
s.Set(@"record",R.Bind(a,1,@"record",()=>null,@"object"));
s.Set(@"budget",R.Bind(a,2,@"budget",()=>null,@"object"));
s.Set(@"valueKey",R.Bind(a,3,@"valueKey",()=>null,@"string"));
s.Set(@"statusKey",R.Bind(a,4,@"statusKey",()=>null,@"string"));
s.Set(@"truncatedKey",R.Bind(a,5,@"truncatedKey",()=>null,@"string"));
try{s.Set(@"entry",R.Cast(@"ordered",R.Map(new object[]{@"status",(""+R.Str(R.Capture((o968) => {R.Emit(o968,R.Index(s.Get(@"record"),s.Get(@"statusKey")));}))),@"value",@""})));
s.Set(@"status",(""+R.Str(R.Capture((o969) => {R.Emit(o969,R.Index(s.Get(@"record"),s.Get(@"statusKey")));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"status"),@""))){R.SetIndex(s.Get(@"entry"),@"status",@"failed");}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"status"),@"unsupported"))){s.Set(@"kind",@"TextPattern");
R.SetIndex(s.Get(@"entry"),@"note",(""+@"this control does not implement "+R.Str(s.Get(@"kind"))+@", so it cannot report "+R.Str(s.Get(@"name"))+@"; its value (when it has one) is in ocused`, and get_value reads it directly"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o970) => {R.Emit(o970,R.Index(s.Get(@"record"),@"note"));}))),@"")) && R.Bool(R.Binary(s,@"Inotmatch",(""+R.Str(R.Capture((o971) => {R.Emit(o971,R.Index(s.Get(@"record"),@"note"));}))),@"TextPattern"))))){R.SetIndex(s.Get(@"entry"),@"note",(""+R.Str(R.Capture((o972) => {R.Emit(o972,R.Index(s.Get(@"record"),@"note"));}))));}
throw new ReturnFlow(s.Get(@"entry"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"status"),@"failed"))){R.SetIndex(s.Get(@"entry"),@"note",R.Capture((o973) => {if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o974) => {R.Emit(o974,R.Index(s.Get(@"record"),@"note"));}))),@""))){R.Emit(o973,(""+R.Str(R.Capture((o975) => {R.Emit(o975,R.Index(s.Get(@"record"),@"note"));}))));}else{R.Emit(o973,@"the provider refused the read");}}));
throw new ReturnFlow(s.Get(@"entry"));}
s.Set(@"text",(""+R.Str(R.Capture((o976) => {R.Emit(o976,R.Index(s.Get(@"record"),s.Get(@"valueKey")));}))));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Add-BudgetedText",new Args(new object[]{s.Get(@"entry"),s.Get(@"text"),s.Get(@"budget")}),null)));
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o977) => {R.Emit(o977,R.Index(s.Get(@"record"),s.Get(@"truncatedKey")));}))),@"True"))){R.SetIndex(s.Get(@"entry"),@"truncated",s.Get(@"true"));
R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"name"),@"selection")) && R.Bool(R.Binary(s,@"Ieq",R.Index(s.Get(@"entry"),@"value"),@"")))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o978) => {R.Emit(o978,R.Index(s.Get(@"entry"),@"status"));}))),@"ok"))))){R.SetIndex(s.Get(@"entry"),@"note",@"nothing is selected in this control (an empty selection is an answer, not a failed read)");}
throw new ReturnFlow(s.Get(@"entry"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaTextObservationCom_979(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"Hwnd",R.Bind(a,1,@"Hwnd",()=>null,@"int64"));
s.Set(@"Rows",R.Bind(a,2,@"Rows",()=>null,@"object"));
s.Set(@"config",R.Bind(a,3,@"config",()=>null,@"object"));
s.Set(@"windowPid",R.Bind(a,4,@"windowPid",()=>null,@"int"));
try{s.Set(@"budget",R.Call(s,@"New-TextBudget",new Args(new object[]{s.Get(@"Arg")}),null));
s.Set(@"maxChars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"max")));
s.Set(@"wantFocused",R.Cast(@"bool",R.Index(s.Get(@"config"),@"focused")));
s.Set(@"wantSelection",R.Cast(@"bool",R.Index(s.Get(@"config"),@"selection")));
s.Set(@"wantDocument",R.Cast(@"bool",R.Index(s.Get(@"config"),@"document")));
s.Set(@"observation",R.Cast(@"ordered",R.Map(new object[]{})));
s.Set(@"plan",R.Call(s,@"Resolve-TextTargetCom",new Args(new object[]{s.Get(@"Arg"),s.Get(@"Hwnd"),s.Get(@"Rows"),s.Get(@"false")}),null));
s.Set(@"record",s.Get(@"null"));
s.Set(@"planNote",(""+R.Str(R.Capture((o980) => {R.Emit(o980,R.Index(s.Get(@"plan"),@"note"));}))));
if(R.Bool((R.Bool(R.Index(s.Get(@"plan"),@"ok")) && R.Bool(R.Index(s.Get(@"plan"),@"useFocused"))))){s.Set(@"record",R.Invoke(R.Type(@"DshUia.Engine"),@"ReadTextObservation",new object[]{s.Get(@"Hwnd"),@"",@"",@"",@"",0,s.Get(@"true"),s.Get(@"wantFocused"),s.Get(@"wantSelection"),s.Get(@"wantDocument"),s.Get(@"maxChars")}));
s.Set(@"recordPid",R.Cast(@"int",R.Index(s.Get(@"record"),@"pid")));
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"recordPid"),0)) && R.Bool(R.Binary(s,@"Ine",s.Get(@"windowPid"),0)))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"recordPid"),s.Get(@"windowPid")))))){s.Set(@"planNote",(""+@"the focused control belongs to pid "+R.Str(s.Get(@"recordPid"))+@", not to this read's window (pid "+R.Str(s.Get(@"windowPid"))+@"), so it was left out"));
s.Set(@"plan",R.Call(s,@"Resolve-TextTargetCom",new Args(new object[]{s.Get(@"Arg"),s.Get(@"Hwnd"),s.Get(@"Rows"),s.Get(@"true")}),null));
s.Set(@"record",s.Get(@"null"));}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"record")))){if(R.Bool(R.Unary(@"Not",R.Index(s.Get(@"plan"),@"ok")))){s.Set(@"status",(""+R.Str(R.Capture((o981) => {R.Emit(o981,R.Index(s.Get(@"plan"),@"status"));}))));
s.Set(@"note",(""+R.Str(R.Capture((o982) => {R.Emit(o982,R.Index(s.Get(@"plan"),@"note"));}))));
R.SetIndex(s.Get(@"observation"),@"target",R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"source",(""+R.Str(R.Capture((o983) => {R.Emit(o983,R.Index(s.Get(@"plan"),@"source"));}))),@"status",s.Get(@"status"),@"note",s.Get(@"note")})));
foreach(var item984 in R.Array(R.Array(R.Capture((o985) => {R.Emit(o985,new object[]{@"focused",@"selection",@"document",@"selected"});})))){s.Set(@"name",item984);try{if(R.Bool(R.Unary(@"Not",R.Index(s.Get(@"config"),s.Get(@"name"))))){throw new ContinueFlow();}
R.SetIndex(s.Get(@"observation"),s.Get(@"name"),R.Cast(@"ordered",R.Map(new object[]{@"status",s.Get(@"status"),@"note",s.Get(@"note")})));}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetIndex(s.Get(@"observation"),@"budget",R.Cast(@"ordered",R.Map(new object[]{@"max_chars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"max")),@"returned_chars",0,@"truncated",s.Get(@"false")})));
throw new ReturnFlow(s.Get(@"observation"));}
s.Set(@"selector",R.Index(s.Get(@"plan"),@"selector"));
s.Set(@"selectorId",@"");
s.Set(@"selectorName",@"");
s.Set(@"selectorType",@"");
s.Set(@"selectorClass",@"");
s.Set(@"selectorIndex",0);
foreach(var item986 in R.Array(R.Array(R.Capture((o987) => {R.Emit(o987,new object[]{@"automationId",@"name",@"controlType",@"className",@"index"});})))){s.Set(@"key",item986);try{s.Set(@"value",R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"selector"),s.Get(@"key")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"value")))){throw new ContinueFlow();}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@"automationId"))){s.Set(@"selectorId",(""+R.Str(s.Get(@"value"))));}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@"name"))){s.Set(@"selectorName",(""+R.Str(s.Get(@"value"))));}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@"controlType"))){s.Set(@"selectorType",(""+R.Str(s.Get(@"value"))));}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@"className"))){s.Set(@"selectorClass",(""+R.Str(s.Get(@"value"))));}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"key"),@"index"))){s.Set(@"selectorIndex",R.Cast(@"int",s.Get(@"value")));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"record",R.Invoke(R.Type(@"DshUia.Engine"),@"ReadTextObservation",new object[]{s.Get(@"Hwnd"),s.Get(@"selectorId"),s.Get(@"selectorName"),s.Get(@"selectorType"),s.Get(@"selectorClass"),s.Get(@"selectorIndex"),s.Get(@"false"),s.Get(@"wantFocused"),s.Get(@"wantSelection"),s.Get(@"wantDocument"),s.Get(@"maxChars")}));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o988) => {R.Emit(o988,R.Index(s.Get(@"record"),@"status"));}))),@"ok"))){s.Set(@"status",(""+R.Str(R.Capture((o989) => {R.Emit(o989,R.Index(s.Get(@"record"),@"status"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"status"),@""))){s.Set(@"status",@"failed");}
s.Set(@"note",(""+R.Str(R.Capture((o990) => {R.Emit(o990,R.Index(s.Get(@"record"),@"note"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"note"),@""))){s.Set(@"note",(""+R.Str(R.Capture((o991) => {R.Emit(o991,R.Index(s.Get(@"record"),@"error"));}))));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"status"),@"unavailable")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"planNote"),@""))))){s.Set(@"note",s.Get(@"planNote"));}
s.Set(@"targetLine",R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"source",(""+R.Str(R.Capture((o992) => {R.Emit(o992,R.Index(s.Get(@"plan"),@"source"));}))),@"status",s.Get(@"status")})));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o993) => {R.Emit(o993,R.Index(s.Get(@"plan"),@"ref"));}))),@""))){R.SetIndex(s.Get(@"targetLine"),@"ref",(""+R.Str(R.Capture((o994) => {R.Emit(o994,R.Index(s.Get(@"plan"),@"ref"));}))));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"note"),@""))){R.SetIndex(s.Get(@"targetLine"),@"note",s.Get(@"note"));}
R.SetIndex(s.Get(@"observation"),@"target",s.Get(@"targetLine"));
foreach(var item995 in R.Array(R.Array(R.Capture((o996) => {R.Emit(o996,new object[]{@"focused",@"selection",@"document",@"selected"});})))){s.Set(@"name",item995);try{if(R.Bool(R.Unary(@"Not",R.Index(s.Get(@"config"),s.Get(@"name"))))){throw new ContinueFlow();}
s.Set(@"field",R.Cast(@"ordered",R.Map(new object[]{@"status",s.Get(@"status")})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"note"),@""))){R.SetIndex(s.Get(@"field"),@"note",s.Get(@"note"));}
R.SetIndex(s.Get(@"observation"),s.Get(@"name"),s.Get(@"field"));}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetIndex(s.Get(@"observation"),@"budget",R.Cast(@"ordered",R.Map(new object[]{@"max_chars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"max")),@"returned_chars",0,@"truncated",s.Get(@"false")})));
throw new ReturnFlow(s.Get(@"observation"));}
s.Set(@"row",R.Call(s,@"Find-RowForIdentity",new Args(new object[]{s.Get(@"Rows"),(""+R.Str(R.Capture((o997) => {R.Emit(o997,R.Index(s.Get(@"record"),@"autoId"));}))),(""+R.Str(R.Capture((o998) => {R.Emit(o998,R.Index(s.Get(@"record"),@"name"));}))),(""+R.Str(R.Capture((o999) => {R.Emit(o999,R.Index(s.Get(@"record"),@"controlType"));}))),R.Cast(@"int",R.Index(s.Get(@"record"),@"cx")),R.Cast(@"int",R.Index(s.Get(@"record"),@"cy"))}),null));
s.Set(@"targetRef",(""+R.Str(R.Capture((o1000) => {R.Emit(o1000,R.Index(s.Get(@"plan"),@"ref"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"targetRef"),@"")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"row")))))){s.Set(@"targetRef",(""+R.Str(R.Capture((o1001) => {R.Emit(o1001,R.Index(s.Get(@"row"),@"ref"));}))));}
s.Set(@"targetLine",R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"source",(""+R.Str(R.Capture((o1002) => {R.Emit(o1002,R.Index(s.Get(@"plan"),@"source"));})))})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"targetRef"),@""))){R.SetIndex(s.Get(@"targetLine"),@"ref",s.Get(@"targetRef"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"planNote"),@""))){R.SetIndex(s.Get(@"targetLine"),@"note",s.Get(@"planNote"));}
R.SetIndex(s.Get(@"observation"),@"target",s.Get(@"targetLine"));
if(R.Bool(s.Get(@"wantFocused"))){s.Set(@"entry",R.Cast(@"ordered",R.Map(new object[]{@"status",@"ok",@"summary",@""})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"targetRef"),@""))){R.SetIndex(s.Get(@"entry"),@"ref",s.Get(@"targetRef"));}
s.Set(@"summary",(""+R.Str(R.Capture((o1003) => {R.Emit(o1003,R.Index(s.Get(@"record"),@"focusedSummary"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"summary"),@""))){s.Set(@"summary",@"the control reports no accessible name");}
s.Set(@"cap",s.Get(@"script:FocusedSummaryDefault"));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"script:FocusedSummaryMax"),s.Get(@"cap")))){s.Set(@"cap",s.Get(@"script:FocusedSummaryMax"));}
s.Set(@"remaining",R.Call(s,@"Get-BudgetRemaining",new Args(new object[]{s.Get(@"budget")}),null));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"remaining"),s.Get(@"cap")))){s.Set(@"cap",s.Get(@"remaining"));}
s.Set(@"clip",R.Call(s,@"Split-TextAtBudget",new Args(new object[]{s.Get(@"summary"),s.Get(@"cap")}),null));
R.SetIndex(s.Get(@"entry"),@"summary",R.Index(s.Get(@"clip"),@"text"));
if(R.Bool(R.Index(s.Get(@"clip"),@"truncated"))){R.SetIndex(s.Get(@"entry"),@"truncated",s.Get(@"true"));
R.SetIndex(s.Get(@"budget"),@"truncated",s.Get(@"true"));}
R.SetIndex(s.Get(@"budget"),@"used",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"budget"),@"used")),R.Member(R.Index(s.Get(@"clip"),@"text"),@"Length")));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"planNote"),@""))){R.SetIndex(s.Get(@"entry"),@"note",s.Get(@"planNote"));}
R.SetIndex(s.Get(@"observation"),@"focused",s.Get(@"entry"));}
if(R.Bool(s.Get(@"wantSelection"))){R.SetIndex(s.Get(@"observation"),@"selection",R.Call(s,@"New-TextFieldEntry",new Args(new object[]{@"selection",s.Get(@"record"),s.Get(@"budget"),@"selection",@"selectionStatus",@"selectionTruncated"}),null));}
if(R.Bool(s.Get(@"wantDocument"))){R.SetIndex(s.Get(@"observation"),@"document",R.Call(s,@"New-TextFieldEntry",new Args(new object[]{@"document",s.Get(@"record"),s.Get(@"budget"),@"document",@"documentStatus",@"documentTruncated"}),null));}
if(R.Bool(R.Index(s.Get(@"config"),@"selected"))){R.SetIndex(s.Get(@"observation"),@"selected",R.Cast(@"ordered",R.Map(new object[]{@"status",@"unsupported",@"note",@"the selected-items list is not read on the COM path yet; read the window with the managed engine (DSH_COMPUTER_UI_ENGINE=managed), or name the list item directly and read it with text_target"})));}
R.SetIndex(s.Get(@"observation"),@"budget",R.Cast(@"ordered",R.Map(new object[]{@"max_chars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"max")),@"returned_chars",R.Cast(@"int",R.Index(s.Get(@"budget"),@"used")),@"truncated",R.Cast(@"bool",R.Index(s.Get(@"budget"),@"truncated"))})));
throw new ReturnFlow(s.Get(@"observation"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaTextObservation_1004(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"Hwnd",R.Bind(a,1,@"Hwnd",()=>null,@"int64"));
s.Set(@"Rows",R.Bind(a,2,@"Rows",()=>null,@"object"));
s.Set(@"engine",R.Bind(a,3,@"engine",()=>null,@"string"));
s.Set(@"windowPid",R.Bind(a,4,@"windowPid",()=>null,@"int"));
try{s.Set(@"config",R.Call(s,@"Get-TextObservationConfig",new Args(new object[]{R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"Arg"),@"text"}),null)}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"config")))){throw new ReturnFlow(s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"engine"),@"com"))){throw new ReturnFlow(R.Call(s,@"Get-UiaTextObservationCom",new Args(new object[]{s.Get(@"Arg"),s.Get(@"Hwnd"),s.Get(@"Rows"),s.Get(@"config"),s.Get(@"windowPid")}),null));}
throw new ReturnFlow(R.Call(s,@"Get-UiaTextObservationManaged",new Args(new object[]{s.Get(@"Arg"),s.Get(@"Hwnd"),s.Get(@"Rows"),s.Get(@"config")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Add_TextObservation_1005(Scope s,Args a){var o=new List<object>();s.Set(@"reply",R.Bind(a,0,@"reply",()=>null,@"object"));
s.Set(@"Arg",R.Bind(a,1,@"Arg",()=>null,@"object"));
s.Set(@"Hwnd",R.Bind(a,2,@"Hwnd",()=>null,@"int64"));
s.Set(@"engine",R.Bind(a,3,@"engine",()=>null,@"string"));
s.Set(@"windowPid",R.Bind(a,4,@"windowPid",()=>null,@"int"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"reply")))){throw new ReturnFlow(s.Get(@"reply"));}
s.Set(@"observation",R.Call(s,@"Get-UiaTextObservation",new Args(new object[]{s.Get(@"Arg"),s.Get(@"Hwnd"),R.Array(R.Capture((o1006) => {R.Emit(o1006,R.Member(s.Get(@"reply"),@"nodes"));})),s.Get(@"engine"),s.Get(@"windowPid")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"observation")))){R.SetIndex(s.Get(@"reply"),@"text",s.Get(@"observation"));}
throw new ReturnFlow(s.Get(@"reply"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiTreeSpec_1007(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"spec",R.Cast(@"ordered",R.Map(new object[]{@"maxDepth",6,@"maxNodes",400,@"probePatterns",s.Get(@"true"),@"skipEmpty",s.Get(@"true"),@"pruneRows",s.Get(@"true"),@"sinceArg",@""})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"maxDepth")))){R.SetMember(s.Get(@"spec"),@"maxDepth",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"maxDepth"))}));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"maxNodes")))){R.SetMember(s.Get(@"spec"),@"maxNodes",R.Invoke(R.Type(@"Math"),@"Max",new object[]{10,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"maxNodes"))}));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"patterns"),s.Get(@"false")))){R.SetMember(s.Get(@"spec"),@"probePatterns",s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"skipEmpty"),s.Get(@"false")))){R.SetMember(s.Get(@"spec"),@"skipEmpty",s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"prune"),s.Get(@"false")))){R.SetMember(s.Get(@"spec"),@"pruneRows",s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"since")))){R.SetMember(s.Get(@"spec"),@"sinceArg",(""+R.Str(R.Capture((o1008) => {R.Emit(o1008,R.Member(s.Get(@"Arg"),@"since"));}))));}
throw new ReturnFlow(s.Get(@"spec"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_UiTree_1009(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"register",R.Bind(a,1,@"register",()=>s.Get(@"true"),@"bool"));
try{s.Set(@"settled",R.Call(s,@"Wait-ForSettle",new Args(new object[]{R.Member(s.Get(@"Arg"),@"settleMs")}),null));
s.Set(@"spec",R.Call(s,@"Get-UiTreeSpec",new Args(new object[]{s.Get(@"Arg")}),null));
s.Set(@"maxDepth",R.Cast(@"int",R.Member(s.Get(@"spec"),@"maxDepth")));
s.Set(@"maxNodes",R.Cast(@"int",R.Member(s.Get(@"spec"),@"maxNodes")));
s.Set(@"probePatterns",R.Cast(@"bool",R.Member(s.Get(@"spec"),@"probePatterns")));
s.Set(@"skipEmpty",R.Cast(@"bool",R.Member(s.Get(@"spec"),@"skipEmpty")));
s.Set(@"pruneRows",R.Cast(@"bool",R.Member(s.Get(@"spec"),@"pruneRows")));
s.Set(@"sinceArg",R.Cast(@"string",R.Member(s.Get(@"spec"),@"sinceArg")));
s.Set(@"engine",@"com");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"env:DSH_COMPUTER_UI_ENGINE"),@"managed"))){s.Set(@"engine",@"managed");}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"engine"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"engine")),@""))))){s.Set(@"engine",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"engine")));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"engine"),@"com")) && R.Bool(R.Unary(@"Not",s.Get(@"script:ComUiaReady")))))){s.Set(@"engine",@"managed");}
s.Set(@"targetHwnd",R.Member(R.Type(@"IntPtr"),@"Zero"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"hwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd")),0))))){s.Set(@"targetHwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd"))));}else{s.Set(@"fgProbe",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"fgProbe"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"targetHwnd",s.Get(@"fgProbe"));}}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"engine"),@"com")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"targetHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))))){s.Set(@"windowInfo",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"targetHwnd")}),null));
s.Set(@"result",R.Call(s,@"Get-ComUiTree",new Args(new object[]{R.Cast(@"int64",s.Get(@"targetHwnd")),s.Get(@"maxDepth"),s.Get(@"maxNodes"),s.Get(@"probePatterns"),s.Get(@"skipEmpty"),s.Get(@"Arg")}),null));
s.Set(@"comReply",R.Call(s,@"Complete-UiTree",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"nodes",R.Array(R.Capture((o1010) => {R.Emit(o1010,R.Member(s.Get(@"result"),@"nodes"));})),@"truncated",R.Cast(@"bool",R.Member(s.Get(@"result"),@"truncated")),@"mode",R.Cast(@"string",R.Member(s.Get(@"result"),@"mode")),@"maxDepth",s.Get(@"maxDepth"),@"maxNodes",s.Get(@"maxNodes"),@"window",s.Get(@"windowInfo"),@"settledMs",s.Get(@"settled"),@"walked",R.Cast(@"int",R.Member(s.Get(@"result"),@"walked")),@"skipped",R.Cast(@"int",R.Member(s.Get(@"result"),@"skipped")),@"legacy",R.Cast(@"bool",R.Member(s.Get(@"result"),@"legacy")),@"reinit",R.Cast(@"bool",R.Member(s.Get(@"result"),@"reinit")),@"cachePatterns",R.Capture((o1011) => {if(R.Bool(s.Get(@"probePatterns"))){R.Emit(o1011,R.Cast(@"int",R.Member(R.Array(R.Capture((o1012) => {R.Emit(o1012,R.Call(s,@"Get-UiaPatternSpecs",new Args(new object[]{}),null));})),@"Count")));}else{R.Emit(o1011,0);}}),@"pushdown",R.Array(R.Capture((o1013) => {R.Emit(o1013,R.Member(s.Get(@"result"),@"pushdown"));})),@"traversal",R.Member(s.Get(@"result"),@"traversal")})),s.Get(@"register"),s.Get(@"pruneRows"),s.Get(@"sinceArg")}),null));
throw new ReturnFlow(R.Call(s,@"Add-TextObservation",new Args(new object[]{s.Get(@"comReply"),s.Get(@"Arg"),R.Cast(@"int64",s.Get(@"targetHwnd")),@"com",R.Cast(@"int",R.Member(s.Get(@"windowInfo"),@"pid"))}),null));}
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationClient"}),null));
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationTypes"}),null));
s.Set(@"root",s.Get(@"null"));
s.Set(@"rootHwnd",R.Member(R.Type(@"IntPtr"),@"Zero"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"hwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd")),0))))){s.Set(@"rootHwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd"))));
s.Set(@"root",R.Call(s,@"Get-UiaRootForHwnd",new Args(new object[]{R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd"))}),null));}else{s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"rootHwnd",s.Get(@"fg"));
s.Set(@"root",R.Call(s,@"Get-UiaRootForHwnd",new Args(new object[]{R.Cast(@"int64",s.Get(@"fg"))}),null));}else{s.Set(@"focused",R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"FocusedElement"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"focused")))){s.Set(@"root",R.Member(s.Get(@"focused"),@"CachedParent"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"root")))){s.Set(@"root",R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"RootElement"));}}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"root")))){throw R.Error(@"could not resolve a UI Automation root element");}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"rootHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))){try{s.Set(@"native",R.Cast(@"int64",R.Member(R.Member(s.Get(@"root"),@"Current"),@"NativeWindowHandle")));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"native"),0))){s.Set(@"rootHwnd",R.Cast(@"IntPtr",s.Get(@"native")));}}catch(Exception error1014) when (!(error1014 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1014}));}}
s.Set(@"windowInfo",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{s.Get(@"rootHwnd")}),null));
s.Set(@"scope",R.Member(R.Type(@"System.Windows.Automation.TreeScope"),@"Children"));
s.Set(@"nodes",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"truncated",s.Get(@"false"));
s.Set(@"wantName",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")));
s.Set(@"wantType",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")));
s.Set(@"wantId",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")));
s.Set(@"wantFilter",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"filter")));
s.Set(@"findMode",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantName"),@"")) || R.Bool(R.Binary(s,@"Ine",s.Get(@"wantType"),@"")))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"wantId"),@"")))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"wantFilter"),@""))));
s.Set(@"walked",0);
s.Set(@"skipped",0);
s.Set(@"cache",R.Call(s,@"New-UiaCacheRequest",new Args(new object[]{s.Get(@"probePatterns")}),null));
if(R.Bool(s.Get(@"probePatterns"))){s.Set(@"specs",R.Call(s,@"Get-UiaPatternSpecs",new Args(new object[]{}),null));}else{s.Set(@"specs",R.Array(R.Capture((o1015) => {})));}
R.Emit(o,R.Invoke(s.Get(@"cache"),@"Push",new object[]{}));
try{if(R.Bool(s.Get(@"findMode"))){s.Set(@"cond",R.Member(R.Type(@"System.Windows.Automation.Condition"),@"TrueCondition"));
s.Set(@"pushedDown",R.Array(R.Capture((o1016) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantId"),@""))){s.Set(@"cond",R.Call(s,@"New-Object",new Args(new object[]{@"System.Windows.Automation.PropertyCondition",new object[]{R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"AutomationIdProperty"),s.Get(@"wantId")}}),null));
s.Set(@"pushedDown",R.Binary(s,@"Plus",s.Get(@"pushedDown"),@"automationId"));}else if(R.Bool(R.Invoke(R.Type(@"DshUia.Engine"),@"IsExactControlType",new object[]{s.Get(@"wantType")}))){try{s.Set(@"shortName",R.Invoke(s.Get(@"wantType"),@"Trim",new object[]{}));
if(R.Bool(R.Invoke(s.Get(@"shortName"),@"StartsWith",new object[]{@"ControlType."}))){s.Set(@"shortName",R.Invoke(s.Get(@"shortName"),@"Substring",new object[]{R.Member(@"ControlType.",@"Length")}));}
s.Set(@"controlTypeObject",R.Member(R.Type(@"System.Windows.Automation.ControlType"),s.Get(@"shortName")));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"controlTypeObject")))){s.Set(@"cond",R.Call(s,@"New-Object",new Args(new object[]{@"System.Windows.Automation.PropertyCondition",new object[]{R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"ControlTypeProperty"),s.Get(@"controlTypeObject")}}),null));
s.Set(@"pushedDown",R.Binary(s,@"Plus",s.Get(@"pushedDown"),@"controlType"));}}catch(Exception error1017) when (!(error1017 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1017}));s.Set(@"cond",R.Member(R.Type(@"System.Windows.Automation.Condition"),@"TrueCondition"));}}
s.Set(@"all",R.Invoke(s.Get(@"root"),@"FindAll",new object[]{R.Member(R.Type(@"System.Windows.Automation.TreeScope"),@"Descendants"),s.Get(@"cond")}));
foreach(var item1018 in R.Array(s.Get(@"all"))){s.Set(@"el",item1018);try{if(R.Bool(R.Binary(s,@"Ige",R.Member(s.Get(@"nodes"),@"Count"),s.Get(@"maxNodes")))){s.Set(@"truncated",s.Get(@"true"));
throw new BreakFlow();}
try{s.Set(@"info",R.Member(s.Get(@"el"),@"Cached"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantName"),@"")) && R.Bool(R.Binary(s,@"Ilt",R.Invoke(R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@"IndexOf",new object[]{s.Get(@"wantName"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0))))){throw new ContinueFlow();}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantType"),@"")) && R.Bool(R.Binary(s,@"Inotmatch",R.Cast(@"string",R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName")),R.Invoke(R.Type(@"regex"),@"Escape",new object[]{s.Get(@"wantType")})))))){throw new ContinueFlow();}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantFilter"),@""))){s.Set(@"hay",R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@" "),R.Cast(@"string",R.Member(s.Get(@"info"),@"AutomationId"))),@" "),R.Cast(@"string",R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName"))));
if(R.Bool(R.Binary(s,@"Ilt",R.Invoke(s.Get(@"hay"),@"IndexOf",new object[]{s.Get(@"wantFilter"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0))){throw new ContinueFlow();}}
s.Set(@"rect",R.Member(s.Get(@"info"),@"BoundingRectangle"));
s.Set(@"rx",R.Member(s.Get(@"rect"),@"X"));
s.Set(@"ry",R.Member(s.Get(@"rect"),@"Y"));
s.Set(@"rw",R.Member(s.Get(@"rect"),@"Width"));
s.Set(@"rh",R.Member(s.Get(@"rect"),@"Height"));
s.Set(@"finite",R.Unary(@"Not",(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"rx")})) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"rx")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"ry")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"ry")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"rw")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"rw")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"rh")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"rh")})))));
if(R.Bool(R.Unary(@"Not",s.Get(@"finite")))){s.Set(@"rx",0);
s.Set(@"ry",0);
s.Set(@"rw",0);
s.Set(@"rh",0);}else{if(R.Bool(R.Binary(s,@"Igt",s.Get(@"rx"),2147483647))){s.Set(@"rx",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"rx"),-2147483648))){s.Set(@"rx",-2147483648);}else{s.Set(@"rx",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"rx")})));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"ry"),2147483647))){s.Set(@"ry",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"ry"),-2147483648))){s.Set(@"ry",-2147483648);}else{s.Set(@"ry",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"ry")})));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"rw"),2147483647))){s.Set(@"rw",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"rw"),-2147483648))){s.Set(@"rw",-2147483648);}else{s.Set(@"rw",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"rw")})));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"rh"),2147483647))){s.Set(@"rh",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"rh"),-2147483648))){s.Set(@"rh",-2147483648);}else{s.Set(@"rh",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"rh")})));}}
s.Set(@"patterns",R.Array(R.Capture((o1019) => {})));
foreach(var item1020 in R.Array(s.Get(@"specs"))){s.Set(@"spec",item1020);try{s.Set(@"obj",s.Get(@"null"));
if(R.Bool(R.Invoke(s.Get(@"el"),@"TryGetCachedPattern",new object[]{R.Index(s.Get(@"spec"),1),new Ref(()=>s.Get(@"obj"),v=>{s.Set(@"obj",v);})}))){s.Set(@"patterns",R.Binary(s,@"Plus",s.Get(@"patterns"),R.Index(s.Get(@"spec"),0)));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.Emit(o,R.Invoke(s.Get(@"nodes"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"depth",0,@"name",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@"controlType",R.Cast(@"string",R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName")),@"automationId",R.Cast(@"string",R.Member(s.Get(@"info"),@"AutomationId")),@"className",R.Cast(@"string",R.Member(s.Get(@"info"),@"ClassName")),@"enabled",R.Cast(@"bool",R.Member(s.Get(@"info"),@"IsEnabled")),@"offscreen",(R.Bool(R.Unary(@"Not",s.Get(@"finite"))) || R.Bool(R.Cast(@"bool",R.Member(s.Get(@"info"),@"IsOffscreen")))),@"x",s.Get(@"rx"),@"y",s.Get(@"ry"),@"width",s.Get(@"rw"),@"height",s.Get(@"rh"),@"patterns",s.Get(@"patterns")}))}));}catch(Exception error1021) when (!(error1021 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1021}));throw new ContinueFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"findReply",R.Call(s,@"Complete-UiTree",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"nodes",R.Array(R.Capture((o1022) => {R.Emit(o1022,R.Invoke(s.Get(@"nodes"),@"ToArray",new object[]{}));})),@"truncated",R.Cast(@"bool",s.Get(@"truncated")),@"mode",@"find",@"maxDepth",s.Get(@"maxDepth"),@"maxNodes",s.Get(@"maxNodes"),@"window",s.Get(@"windowInfo"),@"settledMs",s.Get(@"settled"),@"walked",R.Cast(@"int",s.Get(@"walked")),@"skipped",R.Cast(@"int",s.Get(@"skipped")),@"legacy",s.Get(@"false"),@"reinit",s.Get(@"false"),@"cachePatterns",R.Cast(@"int",s.Get(@"script:UiaCachePatterns")),@"pushdown",R.Array(R.Capture((o1023) => {R.Emit(o1023,s.Get(@"pushedDown"));})),@"traversal",R.Cast(@"ordered",R.Map(new object[]{@"visited",R.Cast(@"int",s.Get(@"walked")),@"maxQueue",R.Cast(@"int",s.Get(@"maxQueue")),@"visitBudget",R.Cast(@"int",s.Get(@"visitBudget")),@"traversalTruncated",R.Cast(@"bool",s.Get(@"traverseTruncated")),@"elapsedMs",0,@"providerSide",s.Get(@"true")}))})),s.Get(@"register"),s.Get(@"pruneRows"),s.Get(@"sinceArg")}),null));
throw new ReturnFlow(R.Call(s,@"Add-TextObservation",new Args(new object[]{s.Get(@"findReply"),s.Get(@"Arg"),R.Cast(@"int64",s.Get(@"rootHwnd")),@"managed",R.Cast(@"int",R.Member(s.Get(@"windowInfo"),@"pid"))}),null));}
s.Set(@"cached",s.Get(@"true"));
s.Set(@"debugTrace",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[string]"}),null));
s.Set(@"queue",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Queue"}),null));
s.Set(@"visitBudget",R.Call(s,@"Get-VisitBudget",new Args(new object[]{s.Get(@"maxNodes"),R.Member(s.Get(@"Arg"),@"maxVisited")}),null));
s.Set(@"maxQueue",1);
s.Set(@"traverseTruncated",s.Get(@"false"));
s.Set(@"traverseWatch",R.Invoke(R.Type(@"System.Diagnostics.Stopwatch"),@"StartNew",new object[]{}));
s.Set(@"rootPair",R.Call(s,@"New-Object",new Args(new object[]{@"object[]",2}),null));
R.SetIndex(s.Get(@"rootPair"),0,s.Get(@"root"));
R.SetIndex(s.Get(@"rootPair"),1,0);
R.Emit(o,R.Invoke(s.Get(@"queue"),@"Enqueue",new object[]{s.Get(@"rootPair")}));
while(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"queue"),@"Count"),0))){try{if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"visitBudget"),0)) && R.Bool(R.Binary(s,@"Ige",s.Get(@"walked"),s.Get(@"visitBudget")))))){s.Set(@"truncated",s.Get(@"true"));
s.Set(@"traverseTruncated",s.Get(@"true"));
throw new BreakFlow();}
s.Set(@"item",R.Invoke(s.Get(@"queue"),@"Dequeue",new object[]{}));
s.Set(@"el",R.Index(s.Get(@"item"),0));
s.Set(@"depth",R.Cast(@"int",R.Index(s.Get(@"item"),1)));
if(R.Bool(R.Binary(s,@"Ige",R.Member(s.Get(@"nodes"),@"Count"),s.Get(@"maxNodes")))){s.Set(@"truncated",s.Get(@"true"));
throw new BreakFlow();}
R.Eval(()=>R.Eval(()=>{var u1024=s.Get(@"walked");s.Set(@"walked",R.Binary(s,@"Plus",u1024,1L));return u1024;}));
s.Set(@"info",s.Get(@"null"));
s.Set(@"useCache",(R.Bool(s.Get(@"cached")) && R.Bool(R.Binary(s,@"Igt",s.Get(@"depth"),0))));
try{if(R.Bool(s.Get(@"useCache"))){s.Set(@"info",R.Member(s.Get(@"el"),@"Cached"));}else{s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));}}catch(Exception error1025) when (!(error1025 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1025}));try{s.Set(@"cached",s.Get(@"false"));
s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));}catch(Exception error1026) when (!(error1026 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1026}));s.Set(@"info",s.Get(@"null"));}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"info")))){R.Emit(o,R.Invoke(s.Get(@"nodes"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"depth",s.Get(@"depth"),@"name",@"",@"controlType",@"ControlType.Unknown",@"automationId",@"",@"className",@"",@"enabled",s.Get(@"false"),@"offscreen",s.Get(@"true"),@"x",0,@"y",0,@"width",0,@"height",0,@"patterns",R.Array(R.Capture((o1027) => {}))}))}));}else{if(R.Bool((R.Bool(s.Get(@"useCache")) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"nodes"),@"Count"),1))))){if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Cast(@"string",R.Member(s.Get(@"info"),@"ControlType")),@"")) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@"")))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"string",R.Member(s.Get(@"info"),@"AutomationId")),@""))))){s.Set(@"cached",s.Get(@"false"));
try{s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));}catch(Exception error1028) when (!(error1028 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1028}));}}}
s.Set(@"rect",R.Member(s.Get(@"info"),@"BoundingRectangle"));
s.Set(@"rx",R.Member(s.Get(@"rect"),@"X"));
s.Set(@"ry",R.Member(s.Get(@"rect"),@"Y"));
s.Set(@"rw",R.Member(s.Get(@"rect"),@"Width"));
s.Set(@"rh",R.Member(s.Get(@"rect"),@"Height"));
s.Set(@"finite",R.Unary(@"Not",(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"rx")})) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"rx")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"ry")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"ry")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"rw")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"rw")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsNaN",new object[]{s.Get(@"rh")})))) || R.Bool(R.Invoke(R.Type(@"double"),@"IsInfinity",new object[]{s.Get(@"rh")})))));
if(R.Bool(R.Unary(@"Not",s.Get(@"finite")))){s.Set(@"rx",0);
s.Set(@"ry",0);
s.Set(@"rw",0);
s.Set(@"rh",0);}else{if(R.Bool(R.Binary(s,@"Igt",s.Get(@"rx"),2147483647))){s.Set(@"rx",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"rx"),-2147483648))){s.Set(@"rx",-2147483648);}else{s.Set(@"rx",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"rx")})));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"ry"),2147483647))){s.Set(@"ry",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"ry"),-2147483648))){s.Set(@"ry",-2147483648);}else{s.Set(@"ry",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"ry")})));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"rw"),2147483647))){s.Set(@"rw",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"rw"),-2147483648))){s.Set(@"rw",-2147483648);}else{s.Set(@"rw",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"rw")})));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"rh"),2147483647))){s.Set(@"rh",2147483647);}else if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"rh"),-2147483648))){s.Set(@"rh",-2147483648);}else{s.Set(@"rh",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"rh")})));}}
s.Set(@"patterns",R.Array(R.Capture((o1029) => {})));
foreach(var item1030 in R.Array(s.Get(@"specs"))){s.Set(@"spec",item1030);try{s.Set(@"obj",s.Get(@"null"));
try{if(R.Bool((R.Bool(s.Get(@"cached")) && R.Bool(R.Binary(s,@"Igt",s.Get(@"depth"),0))))){if(R.Bool(R.Invoke(s.Get(@"el"),@"TryGetCachedPattern",new object[]{R.Index(s.Get(@"spec"),1),new Ref(()=>s.Get(@"obj"),v=>{s.Set(@"obj",v);})}))){s.Set(@"patterns",R.Binary(s,@"Plus",s.Get(@"patterns"),R.Index(s.Get(@"spec"),0)));}}else{if(R.Bool(R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Index(s.Get(@"spec"),1),new Ref(()=>s.Get(@"obj"),v=>{s.Set(@"obj",v);})}))){s.Set(@"patterns",R.Binary(s,@"Plus",s.Get(@"patterns"),R.Index(s.Get(@"spec"),0)));}}}catch(Exception error1031) when (!(error1031 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1031}));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"hasIdentity",(R.Bool((R.Bool(R.Binary(s,@"Ine",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@"")) || R.Bool(R.Binary(s,@"Ine",R.Cast(@"string",R.Member(s.Get(@"info"),@"AutomationId")),@"")))) || R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"patterns"),@"Count"),0))));
if(R.Bool((R.Bool(s.Get(@"hasIdentity")) || R.Bool(R.Unary(@"Not",s.Get(@"skipEmpty")))))){R.Emit(o,R.Invoke(s.Get(@"nodes"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"depth",s.Get(@"depth"),@"name",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@"controlType",R.Cast(@"string",R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName")),@"automationId",R.Cast(@"string",R.Member(s.Get(@"info"),@"AutomationId")),@"className",R.Cast(@"string",R.Member(s.Get(@"info"),@"ClassName")),@"enabled",R.Cast(@"bool",R.Member(s.Get(@"info"),@"IsEnabled")),@"offscreen",(R.Bool(R.Unary(@"Not",s.Get(@"finite"))) || R.Bool(R.Cast(@"bool",R.Member(s.Get(@"info"),@"IsOffscreen")))),@"x",s.Get(@"rx"),@"y",s.Get(@"ry"),@"width",s.Get(@"rw"),@"height",s.Get(@"rh"),@"patterns",s.Get(@"patterns")}))}));}else{R.Eval(()=>R.Eval(()=>{var u1032=s.Get(@"skipped");s.Set(@"skipped",R.Binary(s,@"Plus",u1032,1L));return u1032;}));}}
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"depth"),s.Get(@"maxDepth")))){throw new ContinueFlow();}
try{s.Set(@"children",R.Invoke(s.Get(@"el"),@"FindAll",new object[]{s.Get(@"scope"),R.Member(R.Type(@"System.Windows.Automation.Condition"),@"TrueCondition")}));
foreach(var item1033 in R.Array(s.Get(@"children"))){s.Set(@"child",item1033);try{s.Set(@"pair",R.Call(s,@"New-Object",new Args(new object[]{@"object[]",2}),null));
R.SetIndex(s.Get(@"pair"),0,s.Get(@"child"));
R.SetIndex(s.Get(@"pair"),1,R.Binary(s,@"Plus",s.Get(@"depth"),1));
R.Emit(o,R.Invoke(s.Get(@"queue"),@"Enqueue",new object[]{s.Get(@"pair")}));}catch(ContinueFlow){}catch(BreakFlow){break;}}}catch(Exception error1034) when (!(error1034 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1034}));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"queue"),@"Count"),s.Get(@"maxQueue")))){s.Set(@"maxQueue",R.Member(s.Get(@"queue"),@"Count"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}finally{R.Emit(o,R.Invoke(s.Get(@"cache"),@"Pop",new object[]{}));}
R.Emit(o,R.Invoke(s.Get(@"traverseWatch"),@"Stop",new object[]{}));
s.Set(@"traversal",R.Cast(@"ordered",R.Map(new object[]{@"visited",R.Cast(@"int",s.Get(@"walked")),@"maxQueue",R.Cast(@"int",s.Get(@"maxQueue")),@"visitBudget",R.Cast(@"int",s.Get(@"visitBudget")),@"traversalTruncated",R.Cast(@"bool",s.Get(@"traverseTruncated")),@"elapsedMs",R.Cast(@"int",R.Member(s.Get(@"traverseWatch"),@"ElapsedMilliseconds"))})));
s.Set(@"treeReply",R.Call(s,@"Complete-UiTree",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"nodes",R.Array(R.Capture((o1035) => {R.Emit(o1035,R.Invoke(s.Get(@"nodes"),@"ToArray",new object[]{}));})),@"truncated",s.Get(@"truncated"),@"mode",@"tree",@"maxDepth",s.Get(@"maxDepth"),@"maxNodes",s.Get(@"maxNodes"),@"window",s.Get(@"windowInfo"),@"settledMs",s.Get(@"settled"),@"walked",s.Get(@"walked"),@"skipped",s.Get(@"skipped"),@"cachePatterns",R.Cast(@"int",s.Get(@"script:UiaCachePatterns")),@"traversal",s.Get(@"traversal")})),s.Get(@"register"),s.Get(@"pruneRows"),s.Get(@"sinceArg")}),null));
throw new ReturnFlow(R.Call(s,@"Add-TextObservation",new Args(new object[]{s.Get(@"treeReply"),s.Get(@"Arg"),R.Cast(@"int64",s.Get(@"rootHwnd")),@"managed",R.Cast(@"int",R.Member(s.Get(@"windowInfo"),@"pid"))}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Health_1036(Scope s,Args a){var o=new List<object>();
try{s.Set(@"desk",R.Invoke(R.Type(@"DshNative"),@"OpenInputDesktop",new object[]{0,s.Get(@"false"),R.Member(R.Type(@"DshNative"),@"DESKTOP_READOBJECTS")}));
s.Set(@"interactive",R.Binary(s,@"Ine",s.Get(@"desk"),R.Member(R.Type(@"IntPtr"),@"Zero")));
if(R.Bool(s.Get(@"interactive"))){R.Emit(o,R.Cast(@"void",R.Invoke(R.Type(@"DshNative"),@"CloseDesktop",new object[]{s.Get(@"desk")})));}
s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
s.Set(@"title",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"title",R.Invoke(R.Type(@"DshNative"),@"WindowText",new object[]{s.Get(@"fg")}));}
s.Set(@"note",@"the interactive desktop is reachable");
if(R.Bool(R.Unary(@"Not",s.Get(@"interactive")))){s.Set(@"note",@"the workstation is locked or a secure (UAC) prompt owns the input desktop; SendInput is silently dropped until it is dismissed");}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"note",@"no window currently has the foreground");}
s.Set(@"engine",@"com");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"env:DSH_COMPUTER_UI_ENGINE"),@"managed"))){s.Set(@"engine",@"managed");}else if(R.Bool(R.Unary(@"Not",s.Get(@"script:ComUiaReady")))){s.Set(@"engine",@"managed");}
s.Set(@"engineError",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"script:ComUiaReady"),s.Get(@"true")))){s.Set(@"engineError",(""+R.Str(R.Capture((o1037) => {R.Emit(o1037,s.Get(@"script:ComUiaError"));}))));}
s.Set(@"pacing",R.Call(s,@"Get-PacingConfig",new Args(new object[]{}),null));
s.Set(@"pendingWrite",R.Call(s,@"Get-WriteStampInfo",new Args(new object[]{}),null));
s.Set(@"comObjects",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"engine"),@"com")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"script:ComUiaReady"),s.Get(@"true")))))){try{s.Set(@"comObjects",R.Call(s,@"ConvertFrom-Json",new Args(new object[]{}),R.Invoke(R.Type(@"DshUia.Engine"),@"Census",new object[]{})));}catch(Exception error1038) when (!(error1038 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1038}));s.Set(@"comObjects",s.Get(@"null"));}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"interactive",s.Get(@"interactive"),@"foregroundHwnd",R.Cast(@"int64",s.Get(@"fg")),@"foregroundTitle",s.Get(@"title"),@"note",s.Get(@"note"),@"engine",s.Get(@"engine"),@"engineError",s.Get(@"engineError"),@"comObjects",s.Get(@"comObjects"),@"pacing",s.Get(@"pacing"),@"pendingWrite",s.Get(@"pendingWrite")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Pacing_1039(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"before",R.Call(s,@"Get-PacingConfig",new Args(new object[]{}),null));
s.Set(@"changed",R.Cast(@"ordered",R.Map(new object[]{})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Arg")))){if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"settleMs")))){s.Set(@"script:PostActionMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{5000,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"settleMs"))})}));
R.SetMember(s.Get(@"changed"),@"settleMs",R.Cast(@"int",s.Get(@"script:PostActionMs")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"stabilityMs")))){s.Set(@"script:StabilityCeilingMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:StabilityMaxMs"),R.Cast(@"int",R.Member(s.Get(@"Arg"),@"stabilityMs"))})}));
R.SetMember(s.Get(@"changed"),@"stabilityMs",R.Cast(@"int",s.Get(@"script:StabilityCeilingMs")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"stableMs")))){s.Set(@"script:StabilityStableMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:StabilityMaxMs"),R.Cast(@"int",R.Member(s.Get(@"Arg"),@"stableMs"))})}));
R.SetMember(s.Get(@"changed"),@"stableMs",R.Cast(@"int",s.Get(@"script:StabilityStableMs")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"stabilityPollMs")))){s.Set(@"script:StabilityPollMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{20,R.Invoke(R.Type(@"Math"),@"Min",new object[]{2000,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"stabilityPollMs"))})}));
R.SetMember(s.Get(@"changed"),@"stabilityPollMs",R.Cast(@"int",s.Get(@"script:StabilityPollMs")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"writeTtlMs")))){s.Set(@"script:WriteStampTtlMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{100,R.Invoke(R.Type(@"Math"),@"Min",new object[]{60000,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"writeTtlMs"))})}));
R.SetMember(s.Get(@"changed"),@"writeTtlMs",R.Cast(@"int",s.Get(@"script:WriteStampTtlMs")));}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"before",s.Get(@"before"),@"after",R.Call(s,@"Get-PacingConfig",new Args(new object[]{}),null),@"changed",s.Get(@"changed")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaRootForHwnd_1040(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
try{R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationClient"}),null));
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationTypes"}),null));
s.Set(@"el",s.Get(@"null"));
{s.Set(@"attempt",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"attempt"),2))){try{try{s.Set(@"el",R.Invoke(R.Type(@"System.Windows.Automation.AutomationElement"),@"FromHandle",new object[]{R.Cast(@"IntPtr",s.Get(@"hwnd"))}));}catch(Exception error1041) when (!(error1041 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1041}));s.Set(@"el",s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"el")))){try{s.Set(@"kids",R.Invoke(s.Get(@"el"),@"FindAll",new object[]{R.Member(R.Type(@"System.Windows.Automation.TreeScope"),@"Children"),R.Member(R.Type(@"System.Windows.Automation.Condition"),@"TrueCondition")}));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"kids"),@"Count"),0))){throw new ReturnFlow(s.Get(@"el"));}}catch(Exception error1042) when (!(error1042 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1042}));}}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"attempt"),0))){R.Emit(o,R.Call(s,@"Start-Sleep",new Args(new object[]{new Named(@"Milliseconds",R.Switch),250}),null));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u1043=s.Get(@"attempt");s.Set(@"attempt",R.Binary(s,@"Plus",u1043,1L));return u1043;}));}}
try{s.Set(@"cond",R.Call(s,@"New-Object",new Args(new object[]{@"System.Windows.Automation.PropertyCondition",new object[]{R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"NativeWindowHandleProperty"),R.Cast(@"int",s.Get(@"hwnd"))}}),null));
s.Set(@"alt",R.Invoke(R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"RootElement"),@"FindFirst",new object[]{R.Member(R.Type(@"System.Windows.Automation.TreeScope"),@"Descendants"),s.Get(@"cond")}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"alt")))){s.Set(@"kids",R.Invoke(s.Get(@"alt"),@"FindAll",new object[]{R.Member(R.Type(@"System.Windows.Automation.TreeScope"),@"Children"),R.Member(R.Type(@"System.Windows.Automation.Condition"),@"TrueCondition")}));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"kids"),@"Count"),0))){throw new ReturnFlow(s.Get(@"alt"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"el")))){throw new ReturnFlow(s.Get(@"el"));}
throw new ReturnFlow(s.Get(@"alt"));}}catch(Exception error1044) when (!(error1044 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1044}));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"el")))){throw new ReturnFlow(s.Get(@"el"));}
throw R.Error((""+@"hwnd "+R.Str(s.Get(@"hwnd"))+@" has no usable UI Automation element"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaRoot_1045(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"hwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd")),0))))){throw new ReturnFlow(R.Call(s,@"Get-UiaRootForHwnd",new Args(new object[]{R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd"))}),null));}
s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw R.Error(@"no window currently has the foreground; pass hwnd explicitly");}
throw new ReturnFlow(R.Call(s,@"Get-UiaRootForHwnd",new Args(new object[]{R.Cast(@"int64",s.Get(@"fg"))}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaPatternSpecs_1046(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"script:UiaPatternSpecs")))){R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationClient"}),null));
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationTypes"}),null));
s.Set(@"script:UiaPatternSpecs",R.Array(R.Capture((o1047) => {R.Emit(o1047,new object[]{R.Array(R.Capture((o1048) => {R.Emit(o1048,new object[]{@"invoke",R.Member(R.Type(@"System.Windows.Automation.InvokePattern"),@"Pattern")});}))});
R.Emit(o1047,new object[]{R.Array(R.Capture((o1049) => {R.Emit(o1049,new object[]{@"value",R.Member(R.Type(@"System.Windows.Automation.ValuePattern"),@"Pattern")});}))});
R.Emit(o1047,new object[]{R.Array(R.Capture((o1050) => {R.Emit(o1050,new object[]{@"text",R.Member(R.Type(@"System.Windows.Automation.TextPattern"),@"Pattern")});}))});
R.Emit(o1047,new object[]{R.Array(R.Capture((o1051) => {R.Emit(o1051,new object[]{@"select",R.Member(R.Type(@"System.Windows.Automation.SelectionItemPattern"),@"Pattern")});}))});
R.Emit(o1047,new object[]{R.Array(R.Capture((o1052) => {R.Emit(o1052,new object[]{@"toggle",R.Member(R.Type(@"System.Windows.Automation.TogglePattern"),@"Pattern")});}))});
R.Emit(o1047,new object[]{R.Array(R.Capture((o1053) => {R.Emit(o1053,new object[]{@"expand",R.Member(R.Type(@"System.Windows.Automation.ExpandCollapsePattern"),@"Pattern")});}))});
R.Emit(o1047,new object[]{R.Array(R.Capture((o1054) => {R.Emit(o1054,new object[]{@"scroll_item",R.Member(R.Type(@"System.Windows.Automation.ScrollItemPattern"),@"Pattern")});}))});})));}
throw new ReturnFlow(s.Get(@"script:UiaPatternSpecs"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_UiaCacheRequest_1055(Scope s,Args a){var o=new List<object>();s.Set(@"withPatterns",R.Bind(a,0,@"withPatterns",()=>s.Get(@"true"),@"bool"));
try{s.Set(@"specs",R.Capture((o1056) => {if(R.Bool(s.Get(@"withPatterns"))){R.Emit(o1056,R.Array(R.Capture((o1057) => {R.Emit(o1057,R.Call(s,@"Get-UiaPatternSpecs",new Args(new object[]{}),null));})));}else{R.Emit(o1056,R.Array(R.Capture((o1058) => {})));}}));
s.Set(@"script:UiaCachePatterns",R.Member(s.Get(@"specs"),@"Count"));
s.Set(@"cache",R.Call(s,@"New-Object",new Args(new object[]{@"System.Windows.Automation.CacheRequest"}),null));
foreach(var item1059 in R.Array(R.Array(R.Capture((o1060) => {R.Emit(o1060,new object[]{R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"NameProperty"),R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"ControlTypeProperty"),R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"AutomationIdProperty"),R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"ClassNameProperty"),R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"IsEnabledProperty"),R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"IsOffscreenProperty"),R.Member(R.Type(@"System.Windows.Automation.AutomationElement"),@"BoundingRectangleProperty")});})))){s.Set(@"p",item1059);try{R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"cache"),@"Add",new object[]{s.Get(@"p")})));}catch(ContinueFlow){}catch(BreakFlow){break;}}
foreach(var item1061 in R.Array(s.Get(@"specs"))){s.Set(@"spec",item1061);try{R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"cache"),@"Add",new object[]{R.Index(s.Get(@"spec"),1)})));}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetMember(s.Get(@"cache"),@"TreeScope",R.Member(R.Type(@"System.Windows.Automation.TreeScope"),@"Element"));
throw new ReturnFlow(s.Get(@"cache"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaPatterns_1062(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"cached",R.Bind(a,1,@"cached",()=>null,@"bool"));
try{s.Set(@"patterns",R.Array(R.Capture((o1063) => {})));
foreach(var item1064 in R.Array(R.Call(s,@"Get-UiaPatternSpecs",new Args(new object[]{}),null))){s.Set(@"spec",item1064);try{s.Set(@"hit",s.Get(@"false"));
try{if(R.Bool(s.Get(@"cached"))){s.Set(@"obj",s.Get(@"null"));
s.Set(@"hit",R.Invoke(s.Get(@"el"),@"TryGetCachedPattern",new object[]{R.Index(s.Get(@"spec"),1),new Ref(()=>s.Get(@"obj"),v=>{s.Set(@"obj",v);})}));}else{s.Set(@"obj",s.Get(@"null"));
s.Set(@"hit",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Index(s.Get(@"spec"),1),new Ref(()=>s.Get(@"obj"),v=>{s.Set(@"obj",v);})}));}}catch(Exception error1065) when (!(error1065 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1065}));s.Set(@"hit",s.Get(@"false"));}
if(R.Bool(s.Get(@"hit"))){s.Set(@"patterns",R.Binary(s,@"Plus",s.Get(@"patterns"),R.Index(s.Get(@"spec"),0)));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"patterns"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Read_UiaNode_1066(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"depth",R.Bind(a,1,@"depth",()=>null,@"int"));
s.Set(@"cached",R.Bind(a,2,@"cached",()=>null,@"bool"));
try{s.Set(@"info",s.Get(@"null"));
if(R.Bool(s.Get(@"cached"))){s.Set(@"info",R.Member(s.Get(@"el"),@"Cached"));}else{s.Set(@"info",R.Member(s.Get(@"el"),@"Current"));}
s.Set(@"rect",R.Member(s.Get(@"info"),@"BoundingRectangle"));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"depth",s.Get(@"depth"),@"name",R.Cast(@"string",R.Member(s.Get(@"info"),@"Name")),@"controlType",R.Cast(@"string",R.Member(R.Member(s.Get(@"info"),@"ControlType"),@"ProgrammaticName")),@"automationId",R.Cast(@"string",R.Member(s.Get(@"info"),@"AutomationId")),@"className",R.Cast(@"string",R.Member(s.Get(@"info"),@"ClassName")),@"enabled",R.Cast(@"bool",R.Member(s.Get(@"info"),@"IsEnabled")),@"offscreen",(R.Bool(R.Unary(@"Not",R.Call(s,@"Test-RectFinite",new Args(new object[]{s.Get(@"rect")}),null))) || R.Bool(R.Cast(@"bool",R.Member(s.Get(@"info"),@"IsOffscreen")))),@"x",R.Call(s,@"ConvertTo-SafeInt",new Args(new object[]{R.Member(s.Get(@"rect"),@"X")}),null),@"y",R.Call(s,@"ConvertTo-SafeInt",new Args(new object[]{R.Member(s.Get(@"rect"),@"Y")}),null),@"width",R.Call(s,@"ConvertTo-SafeInt",new Args(new object[]{R.Member(s.Get(@"rect"),@"Width")}),null),@"height",R.Call(s,@"ConvertTo-SafeInt",new Args(new object[]{R.Member(s.Get(@"rect"),@"Height")}),null),@"patterns",R.Call(s,@"Get-UiaPatterns",new Args(new object[]{s.Get(@"el"),s.Get(@"cached")}),null)})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_ConvertTo_Node_1067(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"depth",R.Bind(a,1,@"depth",()=>null,@"int"));
try{throw new ReturnFlow(R.Call(s,@"Read-UiaNode",new Args(new object[]{s.Get(@"el"),s.Get(@"depth"),s.Get(@"false")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Find_UiaMatch_1068(Scope s,Args a){var o=new List<object>();s.Set(@"root",R.Bind(a,0,@"root",()=>null,@"object"));
s.Set(@"Arg",R.Bind(a,1,@"Arg",()=>null,@"object"));
try{s.Set(@"scope",R.Member(R.Type(@"System.Windows.Automation.TreeScope"),@"Subtree"));
s.Set(@"all",R.Invoke(s.Get(@"root"),@"FindAll",new object[]{s.Get(@"scope"),R.Member(R.Type(@"System.Windows.Automation.Condition"),@"TrueCondition")}));
s.Set(@"wantId",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")));
s.Set(@"wantName",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")));
s.Set(@"wantType",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")));
s.Set(@"wantClass",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"className")));
s.Set(@"index",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"index")))){s.Set(@"index",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"index")));}
s.Set(@"found",R.Array(R.Capture((o1069) => {})));
foreach(var item1070 in R.Array(s.Get(@"all"))){s.Set(@"el",item1070);try{s.Set(@"cur",R.Member(s.Get(@"el"),@"Current"));
if(R.Bool((R.Bool(s.Get(@"wantId")) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"string",R.Member(s.Get(@"cur"),@"AutomationId")),s.Get(@"wantId")))))){throw new ContinueFlow();}
if(R.Bool((R.Bool(s.Get(@"wantClass")) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"string",R.Member(s.Get(@"cur"),@"ClassName")),s.Get(@"wantClass")))))){throw new ContinueFlow();}
if(R.Bool((R.Bool(s.Get(@"wantName")) && R.Bool(R.Binary(s,@"Ilt",R.Invoke(R.Cast(@"string",R.Member(s.Get(@"cur"),@"Name")),@"IndexOf",new object[]{s.Get(@"wantName"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0))))){throw new ContinueFlow();}
if(R.Bool((R.Bool(s.Get(@"wantType")) && R.Bool(R.Binary(s,@"Inotmatch",R.Cast(@"string",R.Member(R.Member(s.Get(@"cur"),@"ControlType"),@"ProgrammaticName")),R.Invoke(R.Type(@"regex"),@"Escape",new object[]{s.Get(@"wantType")})))))){throw new ContinueFlow();}
s.Set(@"found",R.Binary(s,@"Plus",s.Get(@"found"),s.Get(@"el")));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"found"),@"Count"),0))){throw R.Error((""+@"no UI Automation element matched (automationId='"+R.Str(s.Get(@"wantId"))+@"' name~='"+R.Str(s.Get(@"wantName"))+@"' controlType='"+R.Str(s.Get(@"wantType"))+@"')"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"index"),0)) || R.Bool(R.Binary(s,@"Ige",s.Get(@"index"),R.Member(s.Get(@"found"),@"Count")))))){throw R.Error((""+@"index "+R.Str(s.Get(@"index"))+@" is out of range; "+R.Str(R.Capture((o1071) => {R.Emit(o1071,R.Member(s.Get(@"found"),@"Count"));}))+@" element(s) matched"));}
throw new ReturnFlow(R.Index(s.Get(@"found"),s.Get(@"index")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaTextPattern_1072(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
try{s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.TextPattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support TextPattern, so its text cannot be read or selected (try ValuePattern through get_value instead)");}
throw new ReturnFlow(s.Get(@"p"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Initialize_UiaTextRangeTypes_1073(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"script:UiaRangeStart")))){throw new ReturnFlow(null);}
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationTypes"}),null));
s.Set(@"script:UiaRangeStart",R.Member(R.Type(@"System.Windows.Automation.Text.TextPatternRangeEndpoint"),@"Start"));
s.Set(@"script:UiaRangeEnd",R.Member(R.Type(@"System.Windows.Automation.Text.TextPatternRangeEndpoint"),@"End"));
s.Set(@"script:UiaTextUnit",R.Member(R.Type(@"System.Windows.Automation.Text.TextUnit"),@"Character"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Find_UiaTextRange_1074(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"text",R.Bind(a,1,@"text",()=>null,@"string"));
s.Set(@"prefix",R.Bind(a,2,@"prefix",()=>null,@"string"));
s.Set(@"suffix",R.Bind(a,3,@"suffix",()=>null,@"string"));
s.Set(@"attempts",R.Bind(a,4,@"attempts",()=>null,@"int"));
try{if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{s.Get(@"text")}))){throw R.Error(@"the text to locate is required");}
s.Set(@"tp",R.Call(s,@"Get-UiaTextPattern",new Args(new object[]{s.Get(@"el")}),null));
R.Emit(o,R.Call(s,@"Initialize-UiaTextRangeTypes",new Args(new object[]{}),null));
s.Set(@"search",R.Member(s.Get(@"tp"),@"DocumentRange"));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),s.Get(@"attempts")))){try{s.Set(@"hit",s.Get(@"null"));
try{s.Set(@"hit",R.Invoke(s.Get(@"search"),@"FindText",new object[]{s.Get(@"text"),s.Get(@"false"),s.Get(@"false")}));}catch(Exception error1075) when (!(error1075 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1075}));s.Set(@"hit",s.Get(@"null"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"hit")))){throw new BreakFlow();}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"prefix"),@"")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"suffix"),@""))))){throw new ReturnFlow(s.Get(@"hit"));}
s.Set(@"probe",R.Invoke(s.Get(@"hit"),@"Clone",new object[]{}));
s.Set(@"before",0);
s.Set(@"after",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"prefix"),@""))){try{s.Set(@"before",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Invoke(s.Get(@"probe"),@"MoveEndpointByUnit",new object[]{s.Get(@"script:UiaRangeStart"),s.Get(@"script:UiaTextUnit"),R.Binary(s,@"Multiply",-1,R.Member(s.Get(@"prefix"),@"Length"))})}));}catch(Exception error1076) when (!(error1076 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1076}));s.Set(@"before",0);}}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"suffix"),@""))){try{s.Set(@"after",R.Invoke(R.Type(@"Math"),@"Abs",new object[]{R.Invoke(s.Get(@"probe"),@"MoveEndpointByUnit",new object[]{s.Get(@"script:UiaRangeEnd"),s.Get(@"script:UiaTextUnit"),R.Member(s.Get(@"suffix"),@"Length")})}));}catch(Exception error1077) when (!(error1077 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1077}));s.Set(@"after",0);}}
s.Set(@"context",@"");
try{s.Set(@"context",R.Cast(@"string",R.Invoke(s.Get(@"probe"),@"GetText",new object[]{-1})));}catch(Exception error1078) when (!(error1078 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1078}));s.Set(@"context",@"");}
s.Set(@"okPrefix",s.Get(@"true"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"prefix"),@""))){s.Set(@"okPrefix",R.Invoke(s.Get(@"context"),@"StartsWith",new object[]{s.Get(@"prefix")}));}
s.Set(@"okSuffix",s.Get(@"true"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"suffix"),@""))){s.Set(@"okSuffix",R.Invoke(s.Get(@"context"),@"EndsWith",new object[]{s.Get(@"suffix")}));}
if(R.Bool((R.Bool(s.Get(@"okPrefix")) && R.Bool(s.Get(@"okSuffix"))))){throw new ReturnFlow(s.Get(@"hit"));}
s.Set(@"search",R.Invoke(R.Member(s.Get(@"tp"),@"DocumentRange"),@"Clone",new object[]{}));
R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"search"),@"MoveEndpointByRange",new object[]{s.Get(@"script:UiaRangeStart"),s.Get(@"hit"),s.Get(@"script:UiaRangeEnd")})));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u1079=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u1079,1L));return u1079;}));}}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"prefix"),@"")) || R.Bool(R.Binary(s,@"Ine",s.Get(@"suffix"),@""))))){if(R.Bool((R.Bool((R.Bool(R.Call(s,@"Test-HasSurrogate",new Args(new object[]{s.Get(@"text")}),null)) || R.Bool(R.Call(s,@"Test-HasSurrogate",new Args(new object[]{s.Get(@"prefix")}),null)))) || R.Bool(R.Call(s,@"Test-HasSurrogate",new Args(new object[]{s.Get(@"suffix")}),null))))){throw R.Error((""+@"the text '"+R.Str(s.Get(@"text"))+@"' was not found with the given prefix/suffix in this element, and one of them contains a character outside the Basic Multilingual Plane (a surrogate pair): this provider's character arithmetic may differ from UTF-16 code units, so the range boundary would fall inside a character. Retry without prefix/suffix, or with a prefix that is plain text; nothing was selected"));}
throw R.Error((""+@"the text '"+R.Str(s.Get(@"text"))+@"' was not found with the given prefix/suffix in this element; nothing was selected"));}
throw R.Error((""+@"the text '"+R.Str(s.Get(@"text"))+@"' was not found in this element"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_HasSurrogate_1080(Scope s,Args a){var o=new List<object>();s.Set(@"value",R.Bind(a,0,@"value",()=>null,@"string"));
try{if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{s.Get(@"value")}))){throw new ReturnFlow(s.Get(@"false"));}
foreach(var item1081 in R.Array(R.Invoke(s.Get(@"value"),@"ToCharArray",new object[]{}))){s.Set(@"ch",item1081);try{if(R.Bool(R.Invoke(R.Type(@"char"),@"IsSurrogate",new object[]{s.Get(@"ch")}))){throw new ReturnFlow(s.Get(@"true"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"false"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Select_UiaText_1082(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"Arg",R.Bind(a,1,@"Arg",()=>null,@"object"));
try{s.Set(@"text",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"text")));
s.Set(@"prefix",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"prefix")))){s.Set(@"prefix",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"prefix")));}
s.Set(@"suffix",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"suffix")))){s.Set(@"suffix",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"suffix")));}
s.Set(@"selectionType",@"text");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"selectionType")))){s.Set(@"selectionType",(""+R.Str(R.Capture((o1083) => {R.Emit(o1083,R.Member(s.Get(@"Arg"),@"selectionType"));}))));}
s.Set(@"attempts",8);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"attempts")))){s.Set(@"attempts",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Invoke(R.Type(@"Math"),@"Min",new object[]{50,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"attempts"))})}));}
s.Set(@"found",R.Call(s,@"Find-UiaTextRange",new Args(new object[]{s.Get(@"el"),s.Get(@"text"),s.Get(@"prefix"),s.Get(@"suffix"),s.Get(@"attempts")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"selectionType"),@"cursor_before"))){R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"found"),@"MoveEndpointByRange",new object[]{s.Get(@"script:UiaRangeEnd"),s.Get(@"found"),s.Get(@"script:UiaRangeStart")})));}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"selectionType"),@"cursor_after"))){R.Emit(o,R.Cast(@"void",R.Invoke(s.Get(@"found"),@"MoveEndpointByRange",new object[]{s.Get(@"script:UiaRangeStart"),s.Get(@"found"),s.Get(@"script:UiaRangeEnd")})));}
R.Emit(o,R.Invoke(s.Get(@"found"),@"Select",new object[]{}));
s.Set(@"selected",@"");
try{s.Set(@"selected",R.Cast(@"string",R.Invoke(s.Get(@"found"),@"GetText",new object[]{-1})));}catch(Exception error1084) when (!(error1084 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1084}));s.Set(@"selected",@"");}
throw new ReturnFlow(s.Get(@"selected"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1090(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"double",R.Member(s.Get(@"_"),@"X")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1091(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"double",R.Member(s.Get(@"_"),@"Y")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1092(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Plus",R.Cast(@"double",R.Member(s.Get(@"_"),@"X")),R.Cast(@"double",R.Member(s.Get(@"_"),@"Width"))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1093(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Plus",R.Cast(@"double",R.Member(s.Get(@"_"),@"Y")),R.Cast(@"double",R.Member(s.Get(@"_"),@"Height"))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaTextRect_1085(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
s.Set(@"Arg",R.Bind(a,1,@"Arg",()=>null,@"object"));
s.Set(@"union",R.Bind(a,2,@"union",()=>s.Get(@"false"),@"bool"));
try{s.Set(@"text",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"text")));
s.Set(@"prefix",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"prefix")))){s.Set(@"prefix",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"prefix")));}
s.Set(@"suffix",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"suffix")))){s.Set(@"suffix",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"suffix")));}
s.Set(@"attempts",8);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"attempts")))){s.Set(@"attempts",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Invoke(R.Type(@"Math"),@"Min",new object[]{50,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"attempts"))})}));}
s.Set(@"found",R.Call(s,@"Find-UiaTextRange",new Args(new object[]{s.Get(@"el"),s.Get(@"text"),s.Get(@"prefix"),s.Get(@"suffix"),s.Get(@"attempts")}),null));
s.Set(@"rects",s.Get(@"null"));
try{s.Set(@"rects",R.Invoke(s.Get(@"found"),@"GetBoundingRectangles",new object[]{}));}catch(Exception error1086) when (!(error1086 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1086}));s.Set(@"rects",s.Get(@"null"));}
s.Set(@"usable",R.Array(R.Capture((o1087) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"rects")))){foreach(var item1088 in R.Array(R.Array(R.Capture((o1089) => {R.Emit(o1089,s.Get(@"rects"));})))){s.Set(@"candidate",item1088);try{if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"candidate"))) && R.Bool(R.Binary(s,@"Igt",R.Cast(@"double",R.Member(s.Get(@"candidate"),@"Width")),0)))) && R.Bool(R.Binary(s,@"Igt",R.Cast(@"double",R.Member(s.Get(@"candidate"),@"Height")),0))))){s.Set(@"usable",R.Binary(s,@"Plus",s.Get(@"usable"),s.Get(@"candidate")));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"usable"),@"Count"),0))){throw R.Error(@"the matched text reported no on-screen rectangle, so there is nothing to click: this provider does not support text geometry");}
s.Set(@"x",R.Cast(@"double",R.Member(R.Index(s.Get(@"usable"),0),@"X")));
s.Set(@"y",R.Cast(@"double",R.Member(R.Index(s.Get(@"usable"),0),@"Y")));
s.Set(@"width",R.Cast(@"double",R.Member(R.Index(s.Get(@"usable"),0),@"Width")));
s.Set(@"height",R.Cast(@"double",R.Member(R.Index(s.Get(@"usable"),0),@"Height")));
if(R.Bool((R.Bool(s.Get(@"union")) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"usable"),@"Count"),1))))){s.Set(@"left",R.Member(R.Call(s,@"Measure-Object",new Args(new object[]{new Named(@"Minimum",R.Switch)}),R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1090)}),s.Get(@"usable"))),@"Minimum"));
s.Set(@"top",R.Member(R.Call(s,@"Measure-Object",new Args(new object[]{new Named(@"Minimum",R.Switch)}),R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1091)}),s.Get(@"usable"))),@"Minimum"));
s.Set(@"right",R.Member(R.Call(s,@"Measure-Object",new Args(new object[]{new Named(@"Maximum",R.Switch)}),R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1092)}),s.Get(@"usable"))),@"Maximum"));
s.Set(@"bottom",R.Member(R.Call(s,@"Measure-Object",new Args(new object[]{new Named(@"Maximum",R.Switch)}),R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1093)}),s.Get(@"usable"))),@"Maximum"));
s.Set(@"x",s.Get(@"left"));
s.Set(@"y",s.Get(@"top"));
s.Set(@"width",R.Binary(s,@"Minus",s.Get(@"right"),s.Get(@"left")));
s.Set(@"height",R.Binary(s,@"Minus",s.Get(@"bottom"),s.Get(@"top")));}
s.Set(@"selected",@"");
try{s.Set(@"selected",R.Cast(@"string",R.Invoke(s.Get(@"found"),@"GetText",new object[]{-1})));}catch(Exception error1094) when (!(error1094 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1094}));s.Set(@"selected",s.Get(@"text"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"text",s.Get(@"selected"),@"x",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"x")})),@"y",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"y")})),@"width",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"width")})),@"height",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"height")}))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaCaret_1095(Scope s,Args a){var o=new List<object>();
try{throw R.Error(@"the caret position needs TextPattern2, which the managed UI Automation wrapper does not expose; the COM engine (the default) can read it");}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Read_UiaText_1096(Scope s,Args a){var o=new List<object>();s.Set(@"el",R.Bind(a,0,@"el",()=>null,@"object"));
try{s.Set(@"tp",R.Call(s,@"Get-UiaTextPattern",new Args(new object[]{s.Get(@"el")}),null));
s.Set(@"doc",R.Member(s.Get(@"tp"),@"DocumentRange"));
s.Set(@"limit",4000);
s.Set(@"text",R.Cast(@"string",R.Invoke(s.Get(@"doc"),@"GetText",new object[]{R.Binary(s,@"Plus",s.Get(@"limit"),1)})));
s.Set(@"truncated",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"text"),@"Length"),s.Get(@"limit")))){s.Set(@"text",R.Invoke(s.Get(@"text"),@"Substring",new object[]{0,s.Get(@"limit")}));
s.Set(@"truncated",s.Get(@"true"));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"text",s.Get(@"text"),@"truncated",s.Get(@"truncated")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ComUiTextAction_1097(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
s.Set(@"Arg",R.Bind(a,1,@"Arg",()=>null,@"object"));
try{s.Set(@"action",R.Invoke((""+R.Str(R.Capture((o1098) => {R.Emit(o1098,R.Member(s.Get(@"Arg"),@"action"));}))),@"ToLowerInvariant",new object[]{}));
s.Set(@"index",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"index")))){s.Set(@"index",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"index")));}
s.Set(@"matched",s.Get(@"null"));
s.Set(@"errorText",@"");
s.Set(@"text",@"");
s.Set(@"truncated",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"get_text"))){R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"ReadText",new object[]{s.Get(@"hwnd"),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"className")),s.Get(@"index"),new Ref(()=>s.Get(@"text"),v=>{s.Set(@"text",v);}),new Ref(()=>s.Get(@"truncated"),v=>{s.Set(@"truncated",v);}),new Ref(()=>s.Get(@"matched"),v=>{s.Set(@"matched",v);}),new Ref(()=>s.Get(@"errorText"),v=>{s.Set(@"errorText",v);})}));}else{s.Set(@"attempts",8);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"attempts")))){s.Set(@"attempts",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Invoke(R.Type(@"Math"),@"Min",new object[]{50,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"attempts"))})}));}
s.Set(@"selectionType",@"text");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"selectionType")))){s.Set(@"selectionType",(""+R.Str(R.Capture((o1099) => {R.Emit(o1099,R.Member(s.Get(@"Arg"),@"selectionType"));}))));}
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"SelectText",new object[]{s.Get(@"hwnd"),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"className")),s.Get(@"index"),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"text")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"prefix")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"suffix")),s.Get(@"selectionType"),s.Get(@"attempts"),new Ref(()=>s.Get(@"text"),v=>{s.Set(@"text",v);}),new Ref(()=>s.Get(@"matched"),v=>{s.Set(@"matched",v);}),new Ref(()=>s.Get(@"errorText"),v=>{s.Set(@"errorText",v);})}));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"errorText"),@""))){throw R.Error(s.Get(@"errorText"));}
s.Set(@"node",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"matched"))) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"matched"),@"Count"),0))))){s.Set(@"node",R.Index(R.Array(R.Capture((o1100) => {R.Emit(o1100,R.Call(s,@"ConvertFrom-ComRows",new Args(new object[]{s.Get(@"matched")}),null));})),0));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"action",s.Get(@"action"),@"value",s.Get(@"text"),@"truncated",s.Get(@"truncated"),@"wrote",s.Get(@"false"),@"matched",s.Get(@"node")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ComUiAct_1101(Scope s,Args a){var o=new List<object>();s.Set(@"hwnd",R.Bind(a,0,@"hwnd",()=>null,@"int64"));
s.Set(@"Arg",R.Bind(a,1,@"Arg",()=>null,@"object"));
try{s.Set(@"action",R.Invoke((""+R.Str(R.Capture((o1102) => {R.Emit(o1102,R.Member(s.Get(@"Arg"),@"action"));}))),@"ToLowerInvariant",new object[]{}));
s.Set(@"index",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"index")))){s.Set(@"index",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"index")));}
s.Set(@"matched",s.Get(@"null"));
s.Set(@"value",@"");
s.Set(@"wrote",s.Get(@"true"));
s.Set(@"errorText",@"");
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Act",new object[]{s.Get(@"hwnd"),s.Get(@"action"),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"className")),s.Get(@"index"),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"value")),new Ref(()=>s.Get(@"matched"),v=>{s.Set(@"matched",v);}),new Ref(()=>s.Get(@"value"),v=>{s.Set(@"value",v);}),new Ref(()=>s.Get(@"wrote"),v=>{s.Set(@"wrote",v);}),new Ref(()=>s.Get(@"errorText"),v=>{s.Set(@"errorText",v);})}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"errorText"),@""))){throw R.Error(s.Get(@"errorText"));}
s.Set(@"node",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"matched"))) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"matched"),@"Count"),0))))){s.Set(@"node",R.Index(R.Array(R.Capture((o1103) => {R.Emit(o1103,R.Call(s,@"ConvertFrom-ComRows",new Args(new object[]{s.Get(@"matched")}),null));})),0));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"action",s.Get(@"action"),@"value",s.Get(@"value"),@"truncated",s.Get(@"false"),@"wrote",s.Get(@"wrote"),@"matched",s.Get(@"node")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_UiAct_1104(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"action",R.Invoke((""+R.Str(R.Capture((o1105) => {R.Emit(o1105,R.Member(s.Get(@"Arg"),@"action"));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"action")}))){throw R.Error(@"uiact requires an action");}
s.Set(@"hasSelector",(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"automationId"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1106) => {R.Emit(o1106,R.Member(s.Get(@"Arg"),@"automationId"));}))),@"")))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"name"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1107) => {R.Emit(o1107,R.Member(s.Get(@"Arg"),@"name"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"controlType"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1108) => {R.Emit(o1108,R.Member(s.Get(@"Arg"),@"controlType"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"className"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1109) => {R.Emit(o1109,R.Member(s.Get(@"Arg"),@"className"));}))),@""))))));
if(R.Bool(R.Unary(@"Not",s.Get(@"hasSelector")))){throw R.Error(@"uiact needs at least one selector: automationId, name, controlType or className");}
s.Set(@"engine",@"com");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"env:DSH_COMPUTER_UI_ENGINE"),@"managed"))){s.Set(@"engine",@"managed");}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"engine"),@"com")) && R.Bool(R.Unary(@"Not",s.Get(@"script:ComUiaReady")))))){s.Set(@"engine",@"managed");}
s.Set(@"textAction",(R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"get_text")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"select_text"))));
s.Set(@"targetHwnd",R.Member(R.Type(@"IntPtr"),@"Zero"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"hwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd")),0))))){s.Set(@"targetHwnd",R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"hwnd"))));}else{s.Set(@"fgProbe",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"fgProbe"),R.Member(R.Type(@"IntPtr"),@"Zero")))){s.Set(@"targetHwnd",s.Get(@"fgProbe"));}}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"engine"),@"com")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"targetHwnd"),R.Member(R.Type(@"IntPtr"),@"Zero")))))){if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"get_caret"))){s.Set(@"active",s.Get(@"false"));
s.Set(@"line",@"");
s.Set(@"matched",s.Get(@"null"));
s.Set(@"errorText",@"");
s.Set(@"caretX",0);
s.Set(@"caretY",0);
s.Set(@"caretW",0);
s.Set(@"caretH",0);
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"ReadCaret",new object[]{R.Cast(@"int64",s.Get(@"targetHwnd")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"className")),s.Get(@"index"),new Ref(()=>s.Get(@"active"),v=>{s.Set(@"active",v);}),new Ref(()=>s.Get(@"line"),v=>{s.Set(@"line",v);}),new Ref(()=>s.Get(@"caretX"),v=>{s.Set(@"caretX",v);}),new Ref(()=>s.Get(@"caretY"),v=>{s.Set(@"caretY",v);}),new Ref(()=>s.Get(@"caretW"),v=>{s.Set(@"caretW",v);}),new Ref(()=>s.Get(@"caretH"),v=>{s.Set(@"caretH",v);}),new Ref(()=>s.Get(@"matched"),v=>{s.Set(@"matched",v);}),new Ref(()=>s.Get(@"errorText"),v=>{s.Set(@"errorText",v);})}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"errorText"),@""))){throw R.Error(s.Get(@"errorText"));}
s.Set(@"node",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"matched"))) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"matched"),@"Count"),0))))){s.Set(@"node",R.Index(R.Array(R.Capture((o1110) => {R.Emit(o1110,R.Call(s,@"ConvertFrom-ComRows",new Args(new object[]{s.Get(@"matched")}),null));})),0));}
s.Set(@"receipt",R.Cast(@"ordered",R.Map(new object[]{@"action",@"get_caret",@"value",s.Get(@"line"),@"truncated",s.Get(@"false"),@"wrote",s.Get(@"false"),@"matched",s.Get(@"node"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null)})));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"caretW"),0)) && R.Bool(R.Binary(s,@"Igt",s.Get(@"caretH"),0))))){R.SetMember(s.Get(@"receipt"),@"rect",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"caretX"),@"y",s.Get(@"caretY"),@"width",s.Get(@"caretW"),@"height",s.Get(@"caretH")})));}
if(R.Bool(R.Unary(@"Not",s.Get(@"active")))){R.SetMember(s.Get(@"receipt"),@"note",@"the element reports no active caret");}
throw new ReturnFlow(s.Get(@"receipt"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"click_text")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"locate_text"))))){s.Set(@"attempts",8);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"attempts")))){s.Set(@"attempts",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Invoke(R.Type(@"Math"),@"Min",new object[]{50,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"attempts"))})}));}
s.Set(@"rectX",0);
s.Set(@"rectY",0);
s.Set(@"rectW",0);
s.Set(@"rectH",0);
s.Set(@"foundText",@"");
s.Set(@"matched",s.Get(@"null"));
s.Set(@"errorText",@"");
R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"LocateText",new object[]{R.Cast(@"int64",s.Get(@"targetHwnd")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"automationId")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"name")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"controlType")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"className")),s.Get(@"index"),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"text")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"prefix")),R.Cast(@"string",R.Member(s.Get(@"Arg"),@"suffix")),s.Get(@"attempts"),new Ref(()=>s.Get(@"rectX"),v=>{s.Set(@"rectX",v);}),new Ref(()=>s.Get(@"rectY"),v=>{s.Set(@"rectY",v);}),new Ref(()=>s.Get(@"rectW"),v=>{s.Set(@"rectW",v);}),new Ref(()=>s.Get(@"rectH"),v=>{s.Set(@"rectH",v);}),new Ref(()=>s.Get(@"foundText"),v=>{s.Set(@"foundText",v);}),new Ref(()=>s.Get(@"matched"),v=>{s.Set(@"matched",v);}),new Ref(()=>s.Get(@"errorText"),v=>{s.Set(@"errorText",v);})}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"errorText"),@""))){throw R.Error(s.Get(@"errorText"));}
s.Set(@"node",s.Get(@"null"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"matched"))) && R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"matched"),@"Count"),0))))){s.Set(@"node",R.Index(R.Array(R.Capture((o1111) => {R.Emit(o1111,R.Call(s,@"ConvertFrom-ComRows",new Args(new object[]{s.Get(@"matched")}),null));})),0));}
s.Set(@"centreX",R.Binary(s,@"Plus",s.Get(@"rectX"),R.Cast(@"int",R.Binary(s,@"Divide",s.Get(@"rectW"),2))));
s.Set(@"centreY",R.Binary(s,@"Plus",s.Get(@"rectY"),R.Cast(@"int",R.Binary(s,@"Divide",s.Get(@"rectH"),2))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"click_text"))){try{R.Emit(o,R.Cast(@"void",R.Call(s,@"Do-Click",new Args(new object[]{R.Map(new object[]{@"x",s.Get(@"centreX"),@"y",s.Get(@"centreY"),@"button",@"left",@"clicks",1})}),null)));}catch(Exception error1112) when (!(error1112 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1112}));throw R.Error((""+R.Str(R.Capture((o1113) => {R.Emit(o1113,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))+@" -- the text was located at "+R.Str(s.Get(@"centreX"))+@","+R.Str(s.Get(@"centreY"))+@" ("+R.Str(R.Capture((o1114) => {R.Emit(o1114,s.Get(@"rectW"));}))+@"x"+R.Str(R.Capture((o1115) => {R.Emit(o1115,s.Get(@"rectH"));}))+@"); click that point with computer_click once input is available"));}}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"click_text")) && R.Bool(R.Binary(s,@"Igt",s.Get(@"script:ReadSettleMs"),0))))){R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{s.Get(@"script:ReadSettleMs")}),null));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"action",s.Get(@"action"),@"value",s.Get(@"foundText"),@"truncated",s.Get(@"false"),@"wrote",R.Binary(s,@"Ieq",s.Get(@"action"),@"click_text"),@"matched",s.Get(@"node"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null),@"rect",R.Cast(@"ordered",R.Map(new object[]{@"x",s.Get(@"rectX"),@"y",s.Get(@"rectY"),@"width",s.Get(@"rectW"),@"height",s.Get(@"rectH")}))})));}
if(R.Bool(s.Get(@"textAction"))){s.Set(@"result",R.Call(s,@"Get-ComUiTextAction",new Args(new object[]{R.Cast(@"int64",s.Get(@"targetHwnd")),s.Get(@"Arg")}),null));}else{s.Set(@"result",R.Call(s,@"Get-ComUiAct",new Args(new object[]{R.Cast(@"int64",s.Get(@"targetHwnd")),s.Get(@"Arg")}),null));}
if(R.Bool(R.Member(s.Get(@"result"),@"wrote"))){R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"uiact",new Named(@"Hwnd",R.Switch),s.Get(@"targetHwnd")}),null));}
if(R.Bool((R.Bool(R.Member(s.Get(@"result"),@"wrote")) && R.Bool(R.Binary(s,@"Igt",s.Get(@"script:ReadSettleMs"),0))))){R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{s.Get(@"script:ReadSettleMs")}),null));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"action",R.Member(s.Get(@"result"),@"action"),@"value",R.Member(s.Get(@"result"),@"value"),@"truncated",R.Member(s.Get(@"result"),@"truncated"),@"wrote",R.Member(s.Get(@"result"),@"wrote"),@"matched",R.Member(s.Get(@"result"),@"matched"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null)})));}
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationClient"}),null));
R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"UIAutomationTypes"}),null));
s.Set(@"root",R.Call(s,@"Get-UiaRoot",new Args(new object[]{s.Get(@"Arg")}),null));
s.Set(@"el",R.Call(s,@"Find-UiaMatch",new Args(new object[]{s.Get(@"root"),s.Get(@"Arg")}),null));
s.Set(@"before",R.Call(s,@"ConvertTo-Node",new Args(new object[]{s.Get(@"el"),0}),null));
s.Set(@"reading",(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"get_value")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"get_text")))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"locate_text")))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"get_caret"))));
if(R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"reading"))) && R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"before"),@"enabled"),s.Get(@"true")))))){throw R.Error((""+@"the matched element is disabled ("+R.Str(R.Capture((o1116) => {R.Emit(o1116,R.Call(s,@"Get-NodeLabel",new Args(new object[]{s.Get(@"before")}),null));}))+@"), so it would ignore the action; nothing was sent"));}
s.Set(@"value",@"");
s.Set(@"truncated",s.Get(@"false"));
s.Set(@"wrote",s.Get(@"true"));
s.Set(@"rect",s.Get(@"null"));
foreach(var switchValue1117 in R.Array(s.Get(@"action"))){try{bool hit1118=false;if(R.SwitchMatch(s,switchValue1117,@"invoke")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.InvokePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support Invoke");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.InvokePattern",s.Get(@"p")),@"Invoke",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"set_value")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.ValuePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support ValuePattern.SetValue");}
s.Set(@"vp",R.Cast(@"System.Windows.Automation.ValuePattern",s.Get(@"p")));
R.Emit(o,R.Invoke(s.Get(@"vp"),@"SetValue",new object[]{R.Cast(@"string",R.Member(s.Get(@"Arg"),@"value"))}));
try{s.Set(@"value",R.Cast(@"string",R.Member(R.Member(s.Get(@"vp"),@"Current"),@"Value")));}catch(Exception error1119) when (!(error1119 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1119}));s.Set(@"value",@"");}}if(R.SwitchMatch(s,switchValue1117,@"get_value")){hit1118=true;s.Set(@"wrote",s.Get(@"false"));
s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.ValuePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support ValuePattern");}
s.Set(@"value",R.Cast(@"string",R.Member(R.Member(R.Cast(@"System.Windows.Automation.ValuePattern",s.Get(@"p")),@"Current"),@"Value")));}if(R.SwitchMatch(s,switchValue1117,@"get_text")){hit1118=true;s.Set(@"wrote",s.Get(@"false"));
s.Set(@"read",R.Call(s,@"Read-UiaText",new Args(new object[]{s.Get(@"el")}),null));
s.Set(@"value",R.Member(s.Get(@"read"),@"text"));
s.Set(@"truncated",R.Member(s.Get(@"read"),@"truncated"));}if(R.SwitchMatch(s,switchValue1117,@"select_text")){hit1118=true;s.Set(@"value",R.Call(s,@"Select-UiaText",new Args(new object[]{s.Get(@"el"),s.Get(@"Arg")}),null));}if(R.SwitchMatch(s,switchValue1117,@"scroll_into_view")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.ScrollItemPattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support ScrollItemPattern.ScrollIntoView (it is not inside a scrollable container)");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.ScrollItemPattern",s.Get(@"p")),@"ScrollIntoView",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"focus")){hit1118=true;R.Emit(o,R.Invoke(s.Get(@"el"),@"SetFocus",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"toggle")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.TogglePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support Toggle");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.TogglePattern",s.Get(@"p")),@"Toggle",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"select")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.SelectionItemPattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support SelectionItem");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.SelectionItemPattern",s.Get(@"p")),@"Select",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"expand")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.ExpandCollapsePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support ExpandCollapse");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.ExpandCollapsePattern",s.Get(@"p")),@"Expand",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"collapse")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.ExpandCollapsePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support ExpandCollapse");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.ExpandCollapsePattern",s.Get(@"p")),@"Collapse",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"close")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.WindowPattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support WindowPattern (close/minimize/maximize/restore)");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.WindowPattern",s.Get(@"p")),@"Close",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"minimize")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.WindowPattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support WindowPattern (close/minimize/maximize/restore)");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.WindowPattern",s.Get(@"p")),@"SetWindowVisualState",new object[]{R.Member(R.Type(@"System.Windows.Automation.WindowVisualState"),@"Minimized")}));}if(R.SwitchMatch(s,switchValue1117,@"maximize")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.WindowPattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support WindowPattern (close/minimize/maximize/restore)");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.WindowPattern",s.Get(@"p")),@"SetWindowVisualState",new object[]{R.Member(R.Type(@"System.Windows.Automation.WindowVisualState"),@"Maximized")}));}if(R.SwitchMatch(s,switchValue1117,@"restore")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.WindowPattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support WindowPattern (close/minimize/maximize/restore)");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.WindowPattern",s.Get(@"p")),@"SetWindowVisualState",new object[]{R.Member(R.Type(@"System.Windows.Automation.WindowVisualState"),@"Normal")}));}if(R.SwitchMatch(s,switchValue1117,@"legacy_action")){hit1118=true;s.Set(@"p",s.Get(@"null"));
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"el"),@"TryGetCurrentPattern",new object[]{R.Member(R.Type(@"System.Windows.Automation.LegacyIAccessiblePattern"),@"Pattern"),new Ref(()=>s.Get(@"p"),v=>{s.Set(@"p",v);})})))){throw R.Error(@"the matched element does not support LegacyIAccessiblePattern.DoDefaultAction");}
R.Emit(o,R.Invoke(R.Cast(@"System.Windows.Automation.LegacyIAccessiblePattern",s.Get(@"p")),@"DoDefaultAction",new object[]{}));}if(R.SwitchMatch(s,switchValue1117,@"locate_text")){hit1118=true;s.Set(@"located",R.Call(s,@"Get-UiaTextRect",new Args(new object[]{s.Get(@"el"),s.Get(@"Arg"),s.Get(@"true")}),null));
s.Set(@"value",R.Member(s.Get(@"located"),@"text"));
s.Set(@"rect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Member(s.Get(@"located"),@"x"),@"y",R.Member(s.Get(@"located"),@"y"),@"width",R.Member(s.Get(@"located"),@"width"),@"height",R.Member(s.Get(@"located"),@"height")})));
s.Set(@"wrote",s.Get(@"false"));}if(R.SwitchMatch(s,switchValue1117,@"click_text")){hit1118=true;s.Set(@"located",R.Call(s,@"Get-UiaTextRect",new Args(new object[]{s.Get(@"el"),s.Get(@"Arg")}),null));
s.Set(@"value",R.Member(s.Get(@"located"),@"text"));
s.Set(@"rect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Member(s.Get(@"located"),@"x"),@"y",R.Member(s.Get(@"located"),@"y"),@"width",R.Member(s.Get(@"located"),@"width"),@"height",R.Member(s.Get(@"located"),@"height")})));
s.Set(@"centreX",R.Binary(s,@"Plus",R.Member(s.Get(@"located"),@"x"),R.Cast(@"int",R.Binary(s,@"Divide",R.Member(s.Get(@"located"),@"width"),2))));
s.Set(@"centreY",R.Binary(s,@"Plus",R.Member(s.Get(@"located"),@"y"),R.Cast(@"int",R.Binary(s,@"Divide",R.Member(s.Get(@"located"),@"height"),2))));
try{R.Emit(o,R.Cast(@"void",R.Call(s,@"Do-Click",new Args(new object[]{R.Map(new object[]{@"x",s.Get(@"centreX"),@"y",s.Get(@"centreY"),@"button",@"left",@"clicks",1})}),null)));}catch(Exception error1120) when (!(error1120 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1120}));throw R.Error((""+R.Str(R.Capture((o1121) => {R.Emit(o1121,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))+@" -- the text was located at "+R.Str(s.Get(@"centreX"))+@","+R.Str(s.Get(@"centreY"))+@" ("+R.Str(R.Capture((o1122) => {R.Emit(o1122,R.Member(s.Get(@"located"),@"width"));}))+@"x"+R.Str(R.Capture((o1123) => {R.Emit(o1123,R.Member(s.Get(@"located"),@"height"));}))+@"); click that point with computer_click once input is available"));}}if(R.SwitchMatch(s,switchValue1117,@"get_caret")){hit1118=true;R.Emit(o,R.Cast(@"void",R.Call(s,@"Get-UiaCaret",new Args(new object[]{}),null)));}if(!hit1118){throw R.Error((""+@"unknown UI Automation action '"+R.Str(s.Get(@"action"))+@"'"));}}catch(BreakFlow){break;}catch(ContinueFlow){}}
if(R.Bool(s.Get(@"wrote"))){R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),s.Get(@"action"),new Named(@"Hwnd",R.Switch),s.Get(@"targetHwnd")}),null));}
if(R.Bool((R.Bool(s.Get(@"wrote")) && R.Bool(R.Binary(s,@"Igt",s.Get(@"script:ReadSettleMs"),0))))){R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{s.Get(@"script:ReadSettleMs")}),null));}
s.Set(@"receipt",R.Cast(@"ordered",R.Map(new object[]{@"action",s.Get(@"action"),@"value",s.Get(@"value"),@"truncated",s.Get(@"truncated"),@"wrote",s.Get(@"wrote"),@"matched",s.Get(@"before"),@"foreground",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null)})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"rect")))){R.SetMember(s.Get(@"receipt"),@"rect",s.Get(@"rect"));}
throw new ReturnFlow(s.Get(@"receipt"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Wait_1124(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"seconds",0d);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"seconds")))){s.Set(@"seconds",R.Cast(@"double",R.Member(s.Get(@"Arg"),@"seconds")));}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"seconds"),0))){s.Set(@"seconds",0);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"seconds"),30))){s.Set(@"seconds",30);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"seconds"),0))){R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{R.Cast(@"int",R.Binary(s,@"Multiply",s.Get(@"seconds"),1000))}),null));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Advance-ObservationEpoch",new Args(new object[]{}),null)));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"seconds",s.Get(@"seconds")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_ConditionField_1125(Scope s,Args a){var o=new List<object>();s.Set(@"spec",R.Bind(a,0,@"spec",()=>null,@"object"));
s.Set(@"name",R.Bind(a,1,@"name",()=>null,@"string"));
s.Set(@"fallback",R.Bind(a,2,@"fallback",()=>s.Get(@"null"),@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"spec")))){throw new ReturnFlow(s.Get(@"fallback"));}
if(R.Bool(R.Binary(s,@"Is",s.Get(@"spec"),R.Type(@"System.Collections.IDictionary")))){if(R.Bool((R.Bool(R.Invoke(s.Get(@"spec"),@"Contains",new object[]{s.Get(@"name")})) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Index(s.Get(@"spec"),s.Get(@"name"))))))){throw new ReturnFlow(R.Index(s.Get(@"spec"),s.Get(@"name")));}
throw new ReturnFlow(s.Get(@"fallback"));}
s.Set(@"property",R.Index(R.Member(R.Member(s.Get(@"spec"),@"PSObject"),@"Properties"),s.Get(@"name")));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"property"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"property"),@"Value")))))){throw new ReturnFlow(R.Member(s.Get(@"property"),@"Value"));}
throw new ReturnFlow(s.Get(@"fallback"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WaitConditionSpec_1126(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"spec",s.Get(@"Arg"));
s.Set(@"nested",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Arg"),@"condition"}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"nested")))){s.Set(@"spec",s.Get(@"nested"));}
s.Set(@"timeout",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Arg"),@"timeout_ms"}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"timeout")))){s.Set(@"timeout",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"timeout_ms"}),null));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"timeout")))){s.Set(@"timeout",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Arg"),@"timeoutMs"}),null));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"timeout")))){s.Set(@"timeout",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"timeoutMs"}),null));}
s.Set(@"ms",s.Get(@"script:WaitMaxMs"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"timeout"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"timeout"))),@""))))){s.Set(@"ms",R.Cast(@"int",s.Get(@"timeout")));}
s.Set(@"ms",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:WaitMaxMs"),s.Get(@"ms")})}));
s.Set(@"source",@"explicit");
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"timeout"))) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"timeout"))),@""))))){s.Set(@"source",@"default");}
s.Set(@"poll",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Arg"),@"poll_ms"}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"poll")))){s.Set(@"poll",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"poll_ms"}),null));}
s.Set(@"pollMs",s.Get(@"script:WaitPollMs"));
if(R.Bool(R.Binary(s,@"Ieq",R.Call(s,@"Get-WaitConditionWeight",new Args(new object[]{s.Get(@"spec")}),null),@"heavy"))){s.Set(@"pollMs",s.Get(@"script:WaitHeavyPollMs"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"poll"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"poll"))),@""))))){s.Set(@"pollMs",R.Cast(@"int",s.Get(@"poll")));}
s.Set(@"pollMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{20,R.Invoke(R.Type(@"Math"),@"Min",new object[]{2000,s.Get(@"pollMs")})}));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"condition",s.Get(@"spec"),@"timeoutMs",s.Get(@"ms"),@"timeoutFrom",s.Get(@"source"),@"pollMs",s.Get(@"pollMs"),@"weight",R.Call(s,@"Get-WaitConditionWeight",new Args(new object[]{s.Get(@"spec")}),null)})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WaitConditionWeight_1127(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"Predicate")))){throw new ReturnFlow(@"light");}
s.Set(@"kind",R.Invoke((""+R.Str(R.Capture((o1128) => {R.Emit(o1128,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"kind",@""}),null));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@""))){if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"every"}),null))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1129) => {R.Emit(o1129,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"every"}),null));}))),@""))))){s.Set(@"kind",@"every");}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"any"}),null))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1130) => {R.Emit(o1130,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"any"}),null));}))),@""))))){s.Set(@"kind",@"any");}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"rect"}),null))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1131) => {R.Emit(o1131,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"rect"}),null));}))),@""))))){s.Set(@"kind",@"region");}else if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1132) => {R.Emit(o1132,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"path",@""}),null));})))})))){s.Set(@"kind",@"file");}else if(R.Bool(R.Binary(s,@"Ieq",R.Invoke((""+R.Str(R.Capture((o1133) => {R.Emit(o1133,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"type",@""}),null));}))),@"ToLowerInvariant",new object[]{}),@"value"))){s.Set(@"kind",@"value");}else if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1134) => {R.Emit(o1134,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"expected",@""}),null));})))})))){s.Set(@"kind",@"value");}else if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1135) => {R.Emit(o1135,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"contains",@""}),null));})))})))){s.Set(@"kind",@"text");}else if(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1136) => {R.Emit(o1136,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"name",@""}),null));})))}))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1137) => {R.Emit(o1137,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automation_id",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1138) => {R.Emit(o1138,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automationId",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1139) => {R.Emit(o1139,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"control_type",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1140) => {R.Emit(o1140,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"className",@""}),null));})))})))))){s.Set(@"kind",@"control");}else{s.Set(@"kind",@"window");}}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@"window")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@"file"))))){throw new ReturnFlow(@"light");}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@"every")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@"any"))))){s.Set(@"legs",R.Array(R.Capture((o1141) => {})));
s.Set(@"list",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),s.Get(@"kind")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"list")))){s.Set(@"legs",R.Array(R.Capture((o1142) => {R.Emit(o1142,s.Get(@"list"));})));}
foreach(var item1143 in R.Array(s.Get(@"legs"))){s.Set(@"leg",item1143);try{if(R.Bool(R.Binary(s,@"Ieq",R.Call(s,@"Get-WaitConditionWeight",new Args(new object[]{s.Get(@"leg")}),null),@"heavy"))){throw new ReturnFlow(@"heavy");}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(@"light");}
throw new ReturnFlow(@"heavy");}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_PredicateResult_1144(Scope s,Args a){var o=new List<object>();
try{throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"what",@"",@"satisfied",s.Get(@"false"),@"status",@"false",@"observed",@"",@"window",s.Get(@"null"),@"control",s.Get(@"null"),@"error",@"",@"stableMs",0})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Set_PredicateStatus_1145(Scope s,Args a){var o=new List<object>();s.Set(@"result",R.Bind(a,0,@"result",()=>null,@"object"));
s.Set(@"status",R.Bind(a,1,@"status",()=>null,@"string"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"result")))){throw new ReturnFlow(s.Get(@"result"));}
R.SetMember(s.Get(@"result"),@"status",(""+R.Str(s.Get(@"status"))));
R.SetMember(s.Get(@"result"),@"satisfied",R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"status"))),@"true"));
throw new ReturnFlow(s.Get(@"result"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_CompositeStatus_1146(Scope s,Args a){var o=new List<object>();s.Set(@"statuses",R.Bind(a,0,@"statuses",()=>null,@"object[]"));
try{s.Set(@"anyTrue",s.Get(@"false"));
s.Set(@"anyFalse",s.Get(@"false"));
s.Set(@"anyUnknown",s.Get(@"false"));
foreach(var item1147 in R.Array(R.Array(R.Capture((o1148) => {R.Emit(o1148,s.Get(@"statuses"));})))){s.Set(@"status",item1147);try{if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"status"))),@"true"))){s.Set(@"anyTrue",s.Get(@"true"));}else if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"status"))),@"false"))){s.Set(@"anyFalse",s.Get(@"true"));}else{s.Set(@"anyUnknown",s.Get(@"true"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"anyTrue",s.Get(@"anyTrue"),@"anyFalse",s.Get(@"anyFalse"),@"anyUnknown",s.Get(@"anyUnknown")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_EnabledWindowInfo_1149(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"hwnd",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"hwnd",0}),null)));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"hwnd"),0))){s.Set(@"fg",R.Invoke(R.Type(@"DshNative"),@"GetForegroundWindow",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"fg"),R.Member(R.Type(@"IntPtr"),@"Zero")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"hwnd",R.Cast(@"int64",s.Get(@"fg")));}
if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"DshNative"),@"IsWindow",new object[]{R.Cast(@"IntPtr",s.Get(@"hwnd"))})))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"info",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{R.Cast(@"IntPtr",s.Get(@"hwnd"))}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"info")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"pid",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"pid",0}),null)));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"pid"),0)) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"info"),@"pid")),s.Get(@"pid")))))){throw new ReturnFlow(s.Get(@"null"));}
throw new ReturnFlow(s.Get(@"info"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionValue_1150(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"result",R.Call(s,@"New-PredicateResult",new Args(new object[]{}),null));
s.Set(@"want",(""+R.Str(R.Capture((o1151) => {R.Emit(o1151,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"expected",@""}),null));}))));
s.Set(@"mode",(""+R.Str(R.Capture((o1152) => {R.Emit(o1152,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"is",@""}),null));}))));
s.Set(@"isNot",R.Binary(s,@"Ieq",s.Get(@"mode"),@"not"));
s.Set(@"match",@"contains");
if(R.Bool(s.Get(@"isNot"))){s.Set(@"match",@"contains");}
s.Set(@"explicitMatch",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"match"}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"explicitMatch"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"explicitMatch"))),@""))))){s.Set(@"match",(""+R.Str(s.Get(@"explicitMatch"))));}
s.Set(@"name",(""+R.Str(R.Capture((o1153) => {R.Emit(o1153,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"name",@""}),null));}))));
s.Set(@"controlType",(""+R.Str(R.Capture((o1154) => {R.Emit(o1154,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"control_type",(""+R.Str(R.Capture((o1155) => {R.Emit(o1155,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"controlType",@""}),null));})))}),null));}))));
s.Set(@"id",(""+R.Str(R.Capture((o1156) => {R.Emit(o1156,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automation_id",(""+R.Str(R.Capture((o1157) => {R.Emit(o1157,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automationId",@""}),null));})))}),null));}))));
s.Set(@"arguments",R.Map(new object[]{@"action",@"get_value",@"hwnd",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"hwnd",0}),null),@"automationId",s.Get(@"id"),@"name",s.Get(@"name"),@"controlType",s.Get(@"controlType"),@"index",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"index",0}),null))}));
s.Set(@"read",s.Get(@"null"));
try{s.Set(@"read",R.Call(s,@"Do-UiAct",new Args(new object[]{s.Get(@"arguments")}),null));}catch(Exception error1158) when (!(error1158 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1158}));R.SetMember(s.Get(@"result"),@"what",@"value");
R.SetMember(s.Get(@"result"),@"error",(""+@"the value could not be read yet: "+R.Str(R.Capture((o1159) => {R.Emit(o1159,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));
R.SetMember(s.Get(@"result"),@"observed",R.Member(s.Get(@"result"),@"error"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
s.Set(@"current",(""+R.Str(R.Capture((o1160) => {R.Emit(o1160,R.Member(s.Get(@"read"),@"value"));}))));
s.Set(@"hit",s.Get(@"false"));
foreach(var switchValue1161 in R.Array(s.Get(@"match"))){try{bool hit1162=false;if(R.SwitchMatch(s,switchValue1161,@"exact")){hit1162=true;s.Set(@"hit",R.Binary(s,@"Ceq",s.Get(@"current"),s.Get(@"want")));}if(R.SwitchMatch(s,switchValue1161,@"equals")){hit1162=true;s.Set(@"hit",R.Binary(s,@"Ieq",s.Get(@"current"),s.Get(@"want")));}if(R.SwitchMatch(s,switchValue1161,@"matches")){hit1162=true;s.Set(@"hit",R.Binary(s,@"Imatch",s.Get(@"current"),s.Get(@"want")));}if(R.SwitchMatch(s,switchValue1161,@"empty")){hit1162=true;s.Set(@"hit",R.Binary(s,@"Ieq",s.Get(@"current"),@""));}if(!hit1162){s.Set(@"hit",R.Binary(s,@"Ige",R.Invoke(s.Get(@"current"),@"IndexOf",new object[]{s.Get(@"want"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0));}}catch(BreakFlow){break;}catch(ContinueFlow){}}
if(R.Bool(s.Get(@"isNot"))){s.Set(@"hit",R.Unary(@"Not",s.Get(@"hit")));}
R.SetMember(s.Get(@"result"),@"what",(""+@"value of "+R.Str(R.Capture((o1163) => {if(R.Bool(R.Binary(s,@"Ine",s.Get(@"name"),@""))){R.Emit(o1163,(""+@"the control named '"+R.Str(s.Get(@"name"))+@"'"));}else{R.Emit(o1163,@"the control");}}))));
R.SetMember(s.Get(@"result"),@"control",R.Member(s.Get(@"read"),@"matched"));
R.SetMember(s.Get(@"result"),@"observed",(""+@"it holds '"+R.Str(s.Get(@"current"))+@"'"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),R.Capture((o1164) => {if(R.Bool(s.Get(@"hit"))){R.Emit(o1164,@"true");}else{R.Emit(o1164,@"false");}})}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionControl_1165(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"result",R.Call(s,@"New-PredicateResult",new Args(new object[]{}),null));
s.Set(@"hwnd",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"hwnd",0}),null)));
s.Set(@"name",(""+R.Str(R.Capture((o1166) => {R.Emit(o1166,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"name",@""}),null));}))));
s.Set(@"controlType",(""+R.Str(R.Capture((o1167) => {R.Emit(o1167,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"control_type",(""+R.Str(R.Capture((o1168) => {R.Emit(o1168,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"controlType",@""}),null));})))}),null));}))));
s.Set(@"id",(""+R.Str(R.Capture((o1169) => {R.Emit(o1169,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automation_id",(""+R.Str(R.Capture((o1170) => {R.Emit(o1170,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automationId",@""}),null));})))}),null));}))));
s.Set(@"cls",(""+R.Str(R.Capture((o1171) => {R.Emit(o1171,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"class_name",(""+R.Str(R.Capture((o1172) => {R.Emit(o1172,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"className",@""}),null));})))}),null));}))));
s.Set(@"wantEnabled",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"enabled"}),null));
s.Set(@"wantVisible",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"visible"}),null));
s.Set(@"hidden",R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1173) => {R.Emit(o1173,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"is",@""}),null));}))),@"absent"));
s.Set(@"label",R.Array(R.Capture((o1174) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"name"),@""))){s.Set(@"label",R.Binary(s,@"Plus",s.Get(@"label"),(""+@"name~'"+R.Str(s.Get(@"name"))+@"'")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"id"),@""))){s.Set(@"label",R.Binary(s,@"Plus",s.Get(@"label"),(""+@"#"+R.Str(s.Get(@"id")))));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"controlType"),@""))){s.Set(@"label",R.Binary(s,@"Plus",s.Get(@"label"),(""+@"type '"+R.Str(s.Get(@"controlType"))+@"'")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"cls"),@""))){s.Set(@"label",R.Binary(s,@"Plus",s.Get(@"label"),(""+@"class '"+R.Str(s.Get(@"cls"))+@"'")));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"label"),@"Count"),0))){s.Set(@"label",R.Array(R.Capture((o1175) => {R.Emit(o1175,@"any control");})));}
R.SetMember(s.Get(@"result"),@"what",(""+@"a control matching "+R.Str(R.Capture((o1176) => {R.Emit(o1176,R.Binary(s,@"Join",s.Get(@"label"),@" "));}))));
s.Set(@"tree",s.Get(@"null"));
try{s.Set(@"tree",R.Call(s,@"Do-UiTree",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",s.Get(@"hwnd"),@"name",s.Get(@"name"),@"controlType",s.Get(@"controlType"),@"automationId",s.Get(@"id"),@"className",s.Get(@"cls"),@"maxDepth",10,@"maxNodes",1500,@"patterns",s.Get(@"false"),@"skipEmpty",s.Get(@"false"),@"prune",s.Get(@"false")})),s.Get(@"false")}),null));}catch(Exception error1177) when (!(error1177 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1177}));R.SetMember(s.Get(@"result"),@"error",(""+@"the tree could not be read: "+R.Str(R.Capture((o1178) => {R.Emit(o1178,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));
R.SetMember(s.Get(@"result"),@"observed",R.Member(s.Get(@"result"),@"error"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
s.Set(@"rows",R.Array(R.Capture((o1179) => {R.Emit(o1179,R.Member(s.Get(@"tree"),@"nodes"));})));
s.Set(@"truncated",R.Binary(s,@"Ieq",R.Member(s.Get(@"tree"),@"truncated"),s.Get(@"true")));
s.Set(@"windowInfo",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"tree"),@"window")))){s.Set(@"windowInfo",R.Member(s.Get(@"tree"),@"window"));}
R.SetMember(s.Get(@"result"),@"window",s.Get(@"windowInfo"));
if(R.Bool(s.Get(@"hidden"))){if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"rows"),@"Count"),0)) && R.Bool(s.Get(@"truncated"))))){R.SetMember(s.Get(@"result"),@"observed",@"the read was truncated before it covered the whole tree, so ""it is gone"" cannot be concluded from it");
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
R.SetMember(s.Get(@"result"),@"observed",R.Capture((o1180) => {if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"rows"),@"Count"),0))){R.Emit(o1180,@"it is not in the tree");}else{R.Emit(o1180,(""+@"it is still there ("+R.Str(R.Capture((o1181) => {R.Emit(o1181,R.Member(s.Get(@"rows"),@"Count"));}))+@" node(s))"));}}));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),R.Capture((o1182) => {if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"rows"),@"Count"),0))){R.Emit(o1182,@"true");}else{R.Emit(o1182,@"false");}})}),null));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"rows"),@"Count"),0))){if(R.Bool(s.Get(@"truncated"))){R.SetMember(s.Get(@"result"),@"observed",@"the read was truncated before it covered the whole tree, so nothing matched *yet* is not the same as nothing is there");
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
R.SetMember(s.Get(@"result"),@"observed",@"no node matched yet");
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"false"}),null));}
s.Set(@"node",R.Index(s.Get(@"rows"),0));
R.SetMember(s.Get(@"result"),@"control",s.Get(@"node"));
s.Set(@"problems",R.Array(R.Capture((o1183) => {})));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"wantEnabled"),s.Get(@"true"))) && R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"node"),@"enabled"),s.Get(@"true")))))){s.Set(@"problems",R.Binary(s,@"Plus",s.Get(@"problems"),@"it is disabled"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"wantVisible"),s.Get(@"true"))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"node"),@"offscreen"),s.Get(@"true")))))){s.Set(@"problems",R.Binary(s,@"Plus",s.Get(@"problems"),@"it is offscreen"));}
R.SetMember(s.Get(@"result"),@"observed",R.Capture((o1184) => {if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"problems"),@"Count"),0))){R.Emit(o1184,@"it is there and usable");}else{R.Emit(o1184,(""+@"it is there but "+R.Str(R.Capture((o1185) => {R.Emit(o1185,R.Binary(s,@"Join",s.Get(@"problems"),@" and "));}))));}}));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),R.Capture((o1186) => {if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"problems"),@"Count"),0))){R.Emit(o1186,@"true");}else{R.Emit(o1186,@"false");}})}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionText_1187(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"result",R.Call(s,@"New-PredicateResult",new Args(new object[]{}),null));
s.Set(@"want",(""+R.Str(R.Capture((o1188) => {R.Emit(o1188,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"contains",(""+R.Str(R.Capture((o1189) => {R.Emit(o1189,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"text",@""}),null));})))}),null));}))));
s.Set(@"hwnd",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"hwnd",0}),null)));
R.SetMember(s.Get(@"result"),@"what",(""+@"the window to contain '"+R.Str(s.Get(@"want"))+@"'"));
s.Set(@"tree",s.Get(@"null"));
try{s.Set(@"tree",R.Call(s,@"Do-UiTree",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",s.Get(@"hwnd"),@"maxDepth",10,@"maxNodes",1500,@"patterns",s.Get(@"false"),@"skipEmpty",s.Get(@"true"),@"prune",s.Get(@"false")})),s.Get(@"false")}),null));}catch(Exception error1190) when (!(error1190 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1190}));R.SetMember(s.Get(@"result"),@"error",(""+@"the window could not be read: "+R.Str(R.Capture((o1191) => {R.Emit(o1191,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));
R.SetMember(s.Get(@"result"),@"observed",R.Member(s.Get(@"result"),@"error"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
s.Set(@"rows",R.Array(R.Capture((o1192) => {R.Emit(o1192,R.Member(s.Get(@"tree"),@"nodes"));})));
s.Set(@"haystack",@"");
foreach(var item1193 in R.Array(s.Get(@"rows"))){s.Set(@"row",item1193);try{s.Set(@"haystack",R.Binary(s,@"Plus",s.Get(@"haystack"),(""+R.Str(R.Capture((o1194) => {R.Emit(o1194,R.Member(s.Get(@"row"),@"name"));}))+@"
"+R.Str(R.Capture((o1195) => {R.Emit(o1195,R.Member(s.Get(@"row"),@"automationId"));}))+@"
")));}catch(ContinueFlow){}catch(BreakFlow){break;}}
R.SetMember(s.Get(@"result"),@"window",R.Member(s.Get(@"tree"),@"window"));
s.Set(@"hit",R.Binary(s,@"Ige",R.Invoke(s.Get(@"haystack"),@"IndexOf",new object[]{s.Get(@"want"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0));
if(R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"hit"))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"tree"),@"truncated"),s.Get(@"true")))))){R.SetMember(s.Get(@"result"),@"observed",(""+R.Str(R.Capture((o1196) => {R.Emit(o1196,R.Member(s.Get(@"rows"),@"Count"));}))+@" node(s) read and none carries that text, but the read was truncated, so its absence is not established"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
R.SetMember(s.Get(@"result"),@"observed",R.Capture((o1197) => {if(R.Bool(s.Get(@"hit"))){R.Emit(o1197,@"the text is there");}else{R.Emit(o1197,(""+R.Str(R.Capture((o1198) => {R.Emit(o1198,R.Member(s.Get(@"rows"),@"Count"));}))+@" node(s) read, and none of them carries that text"));}}));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),R.Capture((o1199) => {if(R.Bool(s.Get(@"hit"))){R.Emit(o1199,@"true");}else{R.Emit(o1199,@"false");}})}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_FileParseable_1200(Scope s,Args a){var o=new List<object>();s.Set(@"path",R.Bind(a,0,@"path",()=>null,@"string"));
s.Set(@"item",R.Bind(a,1,@"item",()=>null,@"object"));
try{s.Set(@"ext",@"");
try{s.Set(@"ext",R.Invoke(R.Invoke(R.Type(@"System.IO.Path"),@"GetExtension",new object[]{s.Get(@"path")}),@"ToLowerInvariant",new object[]{}));}catch(Exception error1201) when (!(error1201 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1201}));s.Set(@"ext",@"");}
s.Set(@"size",R.Cast(@"int64",R.Member(s.Get(@"item"),@"Length")));
foreach(var switchValue1202 in R.Array(s.Get(@"ext"))){try{bool hit1203=false;if(R.SwitchMatch(s,switchValue1202,@".json")){hit1203=true;if(R.Bool(R.Binary(s,@"Igt",s.Get(@"size"),8388608))){throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"note",(""+@"it is too large to parse here ("+R.Str(s.Get(@"size"))+@" bytes)")}));}
try{R.Emit(o,R.Cast(@"void",R.Call(s,@"ConvertFrom-Json",new Args(new object[]{new Named(@"ErrorAction",R.Switch),@"Stop"}),R.Call(s,@"Get-Content",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"path"),new Named(@"Raw",R.Switch),new Named(@"ErrorAction",R.Switch),@"Stop"}),null))));
throw new ReturnFlow(R.Map(new object[]{@"status",@"true",@"note",@"it parses as JSON"}));}catch(Exception error1204) when (!(error1204 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1204}));throw new ReturnFlow(R.Map(new object[]{@"status",@"false",@"note",@"it does not parse as JSON yet"}));}}if(R.SwitchMatch(s,switchValue1202,@".zip")){hit1203=true;try{R.Emit(o,R.Call(s,@"Add-Type",new Args(new object[]{new Named(@"AssemblyName",R.Switch),@"System.IO.Compression.FileSystem",new Named(@"ErrorAction",R.Switch),@"SilentlyContinue"}),null));
s.Set(@"archive",R.Invoke(R.Type(@"System.IO.Compression.ZipFile"),@"OpenRead",new object[]{s.Get(@"path")}));
try{s.Set(@"count",R.Member(R.Array(R.Capture((o1205) => {R.Emit(o1205,R.Member(s.Get(@"archive"),@"Entries"));})),@"Count"));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"count"),0))){throw new ReturnFlow(R.Map(new object[]{@"status",@"false",@"note",@"the archive opens but holds no entries"}));}
throw new ReturnFlow(R.Map(new object[]{@"status",@"true",@"note",(""+@"it opens as a ZIP with "+R.Str(s.Get(@"count"))+@" entries")}));}finally{R.Emit(o,R.Invoke(s.Get(@"archive"),@"Dispose",new object[]{}));}}catch(Exception error1206) when (!(error1206 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1206}));throw new ReturnFlow(R.Map(new object[]{@"status",@"false",@"note",@"it does not open as a ZIP yet"}));}}if(!hit1203){if(R.Bool(R.Binary(s,@"Icontains",R.Array(R.Capture((o1207) => {R.Emit(o1207,new object[]{@".csv",@".txt",@".log",@".md",@".tsv",@""});})),s.Get(@"ext")))){try{s.Set(@"reader",R.Invoke(R.Type(@"System.IO.File"),@"OpenText",new object[]{s.Get(@"path")}));
try{s.Set(@"line",R.Invoke(s.Get(@"reader"),@"ReadLine",new object[]{}));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"line")}))){throw new ReturnFlow(R.Map(new object[]{@"status",@"false",@"note",@"its first line is empty"}));}
throw new ReturnFlow(R.Map(new object[]{@"status",@"true",@"note",@"its first line reads"}));}finally{R.Emit(o,R.Invoke(s.Get(@"reader"),@"Dispose",new object[]{}));}}catch(Exception error1208) when (!(error1208 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1208}));throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"note",@"it could not be read"}));}}
throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"note",(""+@"this backend cannot verify a '"+R.Str(s.Get(@"ext"))+@"' file")}));}}catch(BreakFlow){break;}catch(ContinueFlow){}}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionFile_1209(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"result",R.Call(s,@"New-PredicateResult",new Args(new object[]{}),null));
s.Set(@"path",(""+R.Str(R.Capture((o1210) => {R.Emit(o1210,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"path",@""}),null));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"path"),@""))){throw R.Error(@"[BAD_REQUEST] a file condition needs a path");}
s.Set(@"mode",(""+R.Str(R.Capture((o1211) => {R.Emit(o1211,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"is",@""}),null));}))));
s.Set(@"absent",(R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"absent")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"closed"))));
s.Set(@"minBytes",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"min_bytes",0}),null)));
s.Set(@"stableFor",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"stable_for_ms",0}),null)));
s.Set(@"wantParse",R.Binary(s,@"Ieq",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"parse",s.Get(@"false")}),null),s.Get(@"true")));
s.Set(@"wanted",(""+@"the file '"+R.Str(s.Get(@"path"))+@"'"));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"minBytes"),0))){s.Set(@"wanted",(""+R.Str(s.Get(@"wanted"))+@" to hold at least "+R.Str(s.Get(@"minBytes"))+@" byte(s)"));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"stableFor"),0))){s.Set(@"wanted",(""+R.Str(s.Get(@"wanted"))+@", unchanged for "+R.Str(s.Get(@"stableFor"))+@" ms"));}
if(R.Bool(s.Get(@"wantParse"))){s.Set(@"wanted",(""+R.Str(s.Get(@"wanted"))+@", readable as its own format"));}
R.SetMember(s.Get(@"result"),@"what",s.Get(@"wanted"));
s.Set(@"exists",s.Get(@"false"));
try{s.Set(@"exists",R.Call(s,@"Test-Path",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"path"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));}catch(Exception error1212) when (!(error1212 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1212}));R.SetMember(s.Get(@"result"),@"observed",(""+@"the path could not be looked at: "+R.Str(R.Capture((o1213) => {R.Emit(o1213,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
if(R.Bool(R.Unary(@"Not",s.Get(@"exists")))){if(R.Bool(s.Get(@"absent"))){R.SetMember(s.Get(@"result"),@"observed",@"it is not there");
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"true"}),null));}
R.SetMember(s.Get(@"result"),@"observed",@"it is not there yet");
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"false"}),null));}
if(R.Bool(s.Get(@"absent"))){R.SetMember(s.Get(@"result"),@"observed",@"it is still there");
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"false"}),null));}
s.Set(@"item",s.Get(@"null"));
try{s.Set(@"item",R.Call(s,@"Get-Item",new Args(new object[]{new Named(@"LiteralPath",R.Switch),s.Get(@"path"),new Named(@"ErrorAction",R.Switch),@"Stop"}),null));}catch(Exception error1214) when (!(error1214 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1214}));R.SetMember(s.Get(@"result"),@"observed",(""+@"it is there but could not be read: "+R.Str(R.Capture((o1215) => {R.Emit(o1215,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
s.Set(@"size",R.Cast(@"int64",R.Member(s.Get(@"item"),@"Length")));
if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"minBytes"),0)) && R.Bool(R.Binary(s,@"Ilt",s.Get(@"size"),s.Get(@"minBytes")))))){R.SetMember(s.Get(@"result"),@"observed",(""+@"it is there with "+R.Str(s.Get(@"size"))+@" byte(s), under the "+R.Str(s.Get(@"minBytes"))+@" byte floor"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"false"}),null));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"stableFor"),0))){s.Set(@"ageMs",R.Cast(@"int64",R.Member(R.Binary(s,@"Minus",R.Member(R.Type(@"DateTime"),@"UtcNow"),R.Member(s.Get(@"item"),@"LastWriteTimeUtc")),@"TotalMilliseconds")));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"ageMs"),s.Get(@"stableFor")))){R.SetMember(s.Get(@"result"),@"observed",(""+@"it was written to "+R.Str(s.Get(@"ageMs"))+@" ms ago, less than the "+R.Str(s.Get(@"stableFor"))+@" ms of stillness asked for"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"false"}),null));}}
if(R.Bool(s.Get(@"wantParse"))){s.Set(@"verdict",R.Call(s,@"Test-FileParseable",new Args(new object[]{s.Get(@"path"),s.Get(@"item")}),null));
R.SetMember(s.Get(@"result"),@"observed",(""+R.Str(s.Get(@"size"))+@" byte(s), and "+R.Str(R.Capture((o1216) => {R.Emit(o1216,R.Member(s.Get(@"verdict"),@"note"));}))));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),(""+R.Str(R.Capture((o1217) => {R.Emit(o1217,R.Member(s.Get(@"verdict"),@"status"));})))}),null));}
s.Set(@"written",R.Invoke(R.Member(s.Get(@"item"),@"LastWriteTimeUtc"),@"ToString",new object[]{@"yyyy-MM-dd HH:mm:ssZ"}));
R.SetMember(s.Get(@"result"),@"observed",(""+R.Str(s.Get(@"size"))+@" byte(s), last written "+R.Str(s.Get(@"written"))));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"true"}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionWindow_1218(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"result",R.Call(s,@"New-PredicateResult",new Args(new object[]{}),null));
s.Set(@"wantTitle",(""+R.Str(R.Capture((o1219) => {R.Emit(o1219,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"title",@""}),null));}))));
s.Set(@"wantTitleExact",(""+R.Str(R.Capture((o1220) => {R.Emit(o1220,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"title_exact",@""}),null));}))));
s.Set(@"wantProcess",(""+R.Str(R.Capture((o1221) => {R.Emit(o1221,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"process",@""}),null));}))));
s.Set(@"wantProcessExact",(""+R.Str(R.Capture((o1222) => {R.Emit(o1222,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"process_exact",@""}),null));}))));
s.Set(@"wantPid",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"pid",0}),null)));
s.Set(@"wantHwnd",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"hwnd",0}),null)));
s.Set(@"mode",(""+R.Str(R.Capture((o1223) => {R.Emit(o1223,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"is",@""}),null));}))));
s.Set(@"isGone",(R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"absent")) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"closed"))));
s.Set(@"list",s.Get(@"null"));
try{s.Set(@"list",R.Call(s,@"Do-Windows",new Args(new object[]{R.Map(new object[]{@"filter",@""})}),null));}catch(Exception error1224) when (!(error1224 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1224}));R.SetMember(s.Get(@"result"),@"what",@"a window");
R.SetMember(s.Get(@"result"),@"error",(""+@"the window list could not be enumerated: "+R.Str(R.Capture((o1225) => {R.Emit(o1225,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))));
R.SetMember(s.Get(@"result"),@"observed",R.Member(s.Get(@"result"),@"error"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
s.Set(@"rows",R.Array(R.Capture((o1226) => {R.Emit(o1226,R.Member(s.Get(@"list"),@"windows"));})));
s.Set(@"matched",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item1227 in R.Array(s.Get(@"rows"))){s.Set(@"row",item1227);try{if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantHwnd"),0)) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Index(s.Get(@"row"),@"hwnd")),s.Get(@"wantHwnd")))))){throw new ContinueFlow();}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantPid"),0)) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Index(s.Get(@"row"),@"pid")),s.Get(@"wantPid")))))){throw new ContinueFlow();}
s.Set(@"title",(""+R.Str(R.Capture((o1228) => {R.Emit(o1228,R.Index(s.Get(@"row"),@"title"));}))));
s.Set(@"procName",(""+R.Str(R.Capture((o1229) => {R.Emit(o1229,R.Index(s.Get(@"row"),@"process"));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantTitle"),@"")) && R.Bool(R.Binary(s,@"Ilt",R.Invoke(s.Get(@"title"),@"IndexOf",new object[]{s.Get(@"wantTitle"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0))))){throw new ContinueFlow();}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantTitleExact"),@"")) && R.Bool(R.Unary(@"Not",R.Invoke(R.Invoke(s.Get(@"title"),@"Trim",new object[]{}),@"Equals",new object[]{R.Invoke(s.Get(@"wantTitleExact"),@"Trim",new object[]{}),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")})))))){throw new ContinueFlow();}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"wantProcess"),@"")) && R.Bool(R.Binary(s,@"Ilt",R.Invoke(s.Get(@"procName"),@"IndexOf",new object[]{s.Get(@"wantProcess"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0))))){throw new ContinueFlow();}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantProcessExact"),@""))){s.Set(@"wantName",s.Get(@"wantProcessExact"));
if(R.Bool(R.Invoke(s.Get(@"wantName"),@"EndsWith",new object[]{@".exe",R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}))){s.Set(@"wantName",R.Invoke(s.Get(@"wantName"),@"Substring",new object[]{0,R.Binary(s,@"Minus",R.Member(s.Get(@"wantName"),@"Length"),4)}));}
if(R.Bool(R.Unary(@"Not",R.Invoke(s.Get(@"procName"),@"Equals",new object[]{s.Get(@"wantName"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")})))){throw new ContinueFlow();}}
R.Emit(o,R.Invoke(s.Get(@"matched"),@"Add",new object[]{s.Get(@"row")}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"described",R.Array(R.Capture((o1230) => {})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantHwnd"),0))){s.Set(@"described",R.Binary(s,@"Plus",s.Get(@"described"),(""+@"hwnd "+R.Str(s.Get(@"wantHwnd")))));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantTitle"),@""))){s.Set(@"described",R.Binary(s,@"Plus",s.Get(@"described"),(""+@"title~'"+R.Str(s.Get(@"wantTitle"))+@"'")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantTitleExact"),@""))){s.Set(@"described",R.Binary(s,@"Plus",s.Get(@"described"),(""+@"title='"+R.Str(s.Get(@"wantTitleExact"))+@"'")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantProcess"),@""))){s.Set(@"described",R.Binary(s,@"Plus",s.Get(@"described"),(""+@"process~'"+R.Str(s.Get(@"wantProcess"))+@"'")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantProcessExact"),@""))){s.Set(@"described",R.Binary(s,@"Plus",s.Get(@"described"),(""+@"process='"+R.Str(s.Get(@"wantProcessExact"))+@"'")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"wantPid"),0))){s.Set(@"described",R.Binary(s,@"Plus",s.Get(@"described"),(""+@"pid "+R.Str(s.Get(@"wantPid")))));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"described"),@"Count"),0))){s.Set(@"described",R.Array(R.Capture((o1231) => {R.Emit(o1231,@"any visible window");})));}
R.SetMember(s.Get(@"result"),@"what",(""+@"a window with "+R.Str(R.Capture((o1232) => {R.Emit(o1232,R.Binary(s,@"Join",s.Get(@"described"),@" "));}))));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"matched"),@"Count"),0))){R.SetMember(s.Get(@"result"),@"window",R.Index(s.Get(@"matched"),0));}
if(R.Bool(s.Get(@"isGone"))){R.SetMember(s.Get(@"result"),@"observed",R.Capture((o1233) => {if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"matched"),@"Count"),0))){R.Emit(o1233,@"no such window is open now");}else{R.Emit(o1233,(""+R.Str(R.Capture((o1234) => {R.Emit(o1234,R.Member(s.Get(@"matched"),@"Count"));}))+@" matching window(s) are still open"));}}));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),R.Capture((o1235) => {if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"matched"),@"Count"),0))){R.Emit(o1235,@"true");}else{R.Emit(o1235,@"false");}})}),null));}
R.SetMember(s.Get(@"result"),@"observed",R.Capture((o1236) => {if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"matched"),@"Count"),0))){R.Emit(o1236,(""+@"it is open: '"+R.Str(R.Capture((o1237) => {R.Emit(o1237,R.Index(R.Index(s.Get(@"matched"),0),@"title"));}))+@"' hwnd "+R.Str(R.Capture((o1238) => {R.Emit(o1238,R.Index(R.Index(s.Get(@"matched"),0),@"hwnd"));}))));}else{R.Emit(o1236,@"no such window is open yet");}}));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),R.Capture((o1239) => {if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"matched"),@"Count"),0))){R.Emit(o1239,@"true");}else{R.Emit(o1239,@"false");}})}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1248(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(""+R.Str(R.Capture((o1249) => {R.Emit(o1249,R.Member(s.Get(@"_"),@"status"));}))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1251(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(""+R.Str(R.Capture((o1252) => {R.Emit(o1252,R.Member(s.Get(@"_"),@"what"));}))+@": "+R.Str(R.Capture((o1253) => {R.Emit(o1253,R.Member(s.Get(@"_"),@"observed"));}))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionGroup_1240(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
s.Set(@"mode",R.Bind(a,1,@"mode",()=>null,@"string"));
try{s.Set(@"result",R.Call(s,@"New-PredicateResult",new Args(new object[]{}),null));
R.SetMember(s.Get(@"result"),@"what",R.Capture((o1241) => {if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"any"))){R.Emit(o1241,@"any one of its conditions");}else{R.Emit(o1241,@"every one of its conditions");}}));
s.Set(@"parts",R.Array(R.Capture((o1242) => {R.Emit(o1242,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),s.Get(@"mode"),R.Array(R.Capture((o1243) => {}))}),null));})));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"parts"),@"Count"),0)) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"every"))))){s.Set(@"parts",R.Array(R.Capture((o1244) => {R.Emit(o1244,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"of",R.Array(R.Capture((o1245) => {}))}),null));})));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"parts"),@"Count"),0))){R.SetMember(s.Get(@"result"),@"observed",(""+@"the "+R.Str(s.Get(@"mode"))+@" group carries no conditions, so there is nothing to observe"));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),@"unknown"}),null));}
s.Set(@"rows",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item1246 in R.Array(s.Get(@"parts"))){s.Set(@"part",item1246);try{s.Set(@"one",R.Call(s,@"Test-ConditionPredicate",new Args(new object[]{s.Get(@"part")}),null));
R.Emit(o,R.Invoke(s.Get(@"rows"),@"Add",new object[]{s.Get(@"one")}));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"result"),@"window"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"one"),@"window")))))){R.SetMember(s.Get(@"result"),@"window",R.Member(s.Get(@"one"),@"window"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"result"),@"control"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"one"),@"control")))))){R.SetMember(s.Get(@"result"),@"control",R.Member(s.Get(@"one"),@"control"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"summary",R.Call(s,@"Get-CompositeStatus",new Args(new object[]{R.Array(R.Capture((o1247) => {R.Emit(o1247,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1248)}),s.Get(@"rows")));}))}),null));
s.Set(@"status",@"false");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"any"))){if(R.Bool(R.Member(s.Get(@"summary"),@"anyTrue"))){s.Set(@"status",@"true");}else if(R.Bool(R.Member(s.Get(@"summary"),@"anyUnknown"))){s.Set(@"status",@"unknown");}else{s.Set(@"status",@"false");}}else{if(R.Bool(R.Member(s.Get(@"summary"),@"anyFalse"))){s.Set(@"status",@"false");}else if(R.Bool(R.Member(s.Get(@"summary"),@"anyUnknown"))){s.Set(@"status",@"unknown");}else{s.Set(@"status",@"true");}}
R.SetMember(s.Get(@"result"),@"observed",R.Binary(s,@"Join",R.Array(R.Capture((o1250) => {R.Emit(o1250,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1251)}),s.Get(@"rows")));})),@"; "));
throw new ReturnFlow(R.Call(s,@"Set-PredicateStatus",new Args(new object[]{s.Get(@"result"),s.Get(@"status")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionRegion_1254(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"rect",R.Member(s.Get(@"Predicate"),@"rect"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"rect")))){throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"note",@"the region condition has no rect"}));}
s.Set(@"x",R.Cast(@"int",R.Member(s.Get(@"rect"),@"x")));
s.Set(@"y",R.Cast(@"int",R.Member(s.Get(@"rect"),@"y")));
s.Set(@"w",R.Cast(@"int",R.Member(s.Get(@"rect"),@"width")));
s.Set(@"h",R.Cast(@"int",R.Member(s.Get(@"rect"),@"height")));
if(R.Bool((R.Bool(R.Binary(s,@"Ile",s.Get(@"w"),0)) || R.Bool(R.Binary(s,@"Ile",s.Get(@"h"),0))))){throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"note",@"the region condition has an empty rect"}));}
s.Set(@"mode",(""+R.Str(R.Capture((o1255) => {R.Emit(o1255,R.Member(s.Get(@"Predicate"),@"mode"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@""))){s.Set(@"mode",@"stable");}
s.Set(@"virtual",R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null));
if(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ilt",s.Get(@"x"),R.Cast(@"int",R.Member(s.Get(@"virtual"),@"x")))) || R.Bool(R.Binary(s,@"Ilt",s.Get(@"y"),R.Cast(@"int",R.Member(s.Get(@"virtual"),@"y")))))) || R.Bool(R.Binary(s,@"Igt",R.Binary(s,@"Plus",s.Get(@"x"),s.Get(@"w")),R.Binary(s,@"Plus",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"x")),R.Cast(@"int",R.Member(s.Get(@"virtual"),@"width"))))))) || R.Bool(R.Binary(s,@"Igt",R.Binary(s,@"Plus",s.Get(@"y"),s.Get(@"h")),R.Binary(s,@"Plus",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"y")),R.Cast(@"int",R.Member(s.Get(@"virtual"),@"height")))))))){throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"what",(""+@"the region ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") "+R.Str(s.Get(@"w"))+@"x"+R.Str(s.Get(@"h"))),@"note",(""+@"the region ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") "+R.Str(s.Get(@"w"))+@"x"+R.Str(s.Get(@"h"))+@" is not inside the desktop ("+R.Str(R.Capture((o1256) => {R.Emit(o1256,R.Member(s.Get(@"virtual"),@"x"));}))+@","+R.Str(R.Capture((o1257) => {R.Emit(o1257,R.Member(s.Get(@"virtual"),@"y"));}))+@") "+R.Str(R.Capture((o1258) => {R.Emit(o1258,R.Member(s.Get(@"virtual"),@"width"));}))+@"x"+R.Str(R.Capture((o1259) => {R.Emit(o1259,R.Member(s.Get(@"virtual"),@"height"));}))+@", so it cannot be watched")}));}
s.Set(@"maxSide",160);
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Predicate"),@"max_side"))) && R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(s.Get(@"Predicate"),@"max_side")),0))))){s.Set(@"maxSide",R.Cast(@"int",R.Member(s.Get(@"Predicate"),@"max_side")));}
s.Set(@"digest",@"");
try{s.Set(@"digest",R.Call(s,@"Get-RegionDigest",new Args(new object[]{s.Get(@"x"),s.Get(@"y"),s.Get(@"w"),s.Get(@"h"),s.Get(@"maxSide")}),null));}catch(Exception error1260) when (!(error1260 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1260}));s.Set(@"digest",@"");}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"digest"),@""))){throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"note",(""+@"the region ("+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@") "+R.Str(s.Get(@"w"))+@"x"+R.Str(s.Get(@"h"))+@" could not be read")}));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"matches"))){s.Set(@"expected",(""+R.Str(R.Capture((o1261) => {R.Emit(o1261,R.Member(s.Get(@"Predicate"),@"expected_digest"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"expected"),@""))){throw new ReturnFlow(R.Map(new object[]{@"status",@"unknown",@"note",@"mode matches needs expected_digest"}));}
throw new ReturnFlow(R.Map(new object[]{@"status",R.Binary(s,@"Ieq",s.Get(@"digest"),s.Get(@"expected")),@"digest",s.Get(@"digest"),@"note",(""+@"region fingerprint "+R.Str(s.Get(@"digest")))}));}
s.Set(@"key",(""+R.Str(s.Get(@"x"))+@","+R.Str(s.Get(@"y"))+@","+R.Str(s.Get(@"w"))+@","+R.Str(s.Get(@"h"))+@","+R.Str(s.Get(@"maxSide"))));
s.Set(@"now",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"mode"),@"changed"))){s.Set(@"baseline",R.Index(s.Get(@"script:RegionBaselines"),s.Get(@"key")));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"baseline"))) || R.Bool(R.Binary(s,@"Igt",R.Binary(s,@"Minus",s.Get(@"now"),R.Cast(@"int64",R.Member(s.Get(@"baseline"),@"at"))),600000))))){R.SetIndex(s.Get(@"script:RegionBaselines"),s.Get(@"key"),R.Map(new object[]{@"digest",s.Get(@"digest"),@"at",s.Get(@"now")}));
throw new ReturnFlow(R.Map(new object[]{@"status",s.Get(@"false"),@"digest",s.Get(@"digest"),@"note",@"baseline taken from this sample; a later sample says whether it changed"}));}
throw new ReturnFlow(R.Map(new object[]{@"status",R.Binary(s,@"Ine",s.Get(@"digest"),R.Cast(@"string",R.Member(s.Get(@"baseline"),@"digest"))),@"digest",s.Get(@"digest"),@"note",(""+@"region fingerprint "+R.Str(s.Get(@"digest"))+@" (baseline "+R.Str(R.Capture((o1262) => {R.Emit(o1262,R.Member(s.Get(@"baseline"),@"digest"));}))+@")")}));}
s.Set(@"previous",R.Index(s.Get(@"script:RegionBaselines"),s.Get(@"key")));
R.SetIndex(s.Get(@"script:RegionBaselines"),s.Get(@"key"),R.Map(new object[]{@"digest",s.Get(@"digest"),@"at",s.Get(@"now")}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"previous")))){throw new ReturnFlow(R.Map(new object[]{@"status",s.Get(@"false"),@"digest",s.Get(@"digest"),@"note",@"first sample of this region; the next one decides stability"}));}
throw new ReturnFlow(R.Map(new object[]{@"status",R.Binary(s,@"Ieq",s.Get(@"digest"),R.Cast(@"string",R.Member(s.Get(@"previous"),@"digest"))),@"digest",s.Get(@"digest"),@"note",(""+@"region fingerprint "+R.Str(s.Get(@"digest")))}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ConditionPredicate_1263(Scope s,Args a){var o=new List<object>();s.Set(@"Predicate",R.Bind(a,0,@"Predicate",()=>null,@"object"));
try{s.Set(@"kind",R.Invoke((""+R.Str(R.Capture((o1264) => {R.Emit(o1264,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"kind",@""}),null));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"kind"),@""))){s.Set(@"every",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"every"}),null));
s.Set(@"any",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"any"}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"every"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"every"))),@""))))){s.Set(@"kind",@"every");}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"any"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"any"))),@""))))){s.Set(@"kind",@"any");}else if(R.Bool(R.Binary(s,@"Ieq",R.Invoke((""+R.Str(R.Capture((o1265) => {R.Emit(o1265,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"type",@""}),null));}))),@"ToLowerInvariant",new object[]{}),@"value"))){s.Set(@"kind",@"value");}else if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1266) => {R.Emit(o1266,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"expected",@""}),null));})))})))){s.Set(@"kind",@"value");}else if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1267) => {R.Emit(o1267,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"contains",@""}),null));})))})))){s.Set(@"kind",@"text");}else if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1268) => {R.Emit(o1268,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"path",@""}),null));})))})))){s.Set(@"kind",@"file");}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"rect"}),null))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1269) => {R.Emit(o1269,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"rect"}),null));}))),@""))))){s.Set(@"kind",@"region");}else if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1270) => {R.Emit(o1270,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"control",@""}),null));}))),@"present"))){s.Set(@"kind",@"control");}else if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1271) => {R.Emit(o1271,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"control",@""}),null));}))),@"absent"))){s.Set(@"kind",@"control");}else if(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1272) => {R.Emit(o1272,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"name",@""}),null));})))}))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1273) => {R.Emit(o1273,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automation_id",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1274) => {R.Emit(o1274,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"automationId",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1275) => {R.Emit(o1275,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"control_type",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1276) => {R.Emit(o1276,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"controlType",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1277) => {R.Emit(o1277,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"class_name",@""}),null));})))}))))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1278) => {R.Emit(o1278,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Predicate"),@"className",@""}),null));})))})))))){s.Set(@"kind",@"control");}else{s.Set(@"kind",@"window");}}
foreach(var switchValue1279 in R.Array(s.Get(@"kind"))){try{bool hit1280=false;if(R.SwitchMatch(s,switchValue1279,@"idle")){hit1280=true;throw R.Error(@"[BAD_REQUEST] 'idle' is not a condition: it is a duration, and a duration is what the wait step is for. A condition is something that can become true: window, control, value, text, or an very list of those");}if(R.SwitchMatch(s,switchValue1279,@"text")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionText",new Args(new object[]{s.Get(@"Predicate")}),null));}if(R.SwitchMatch(s,switchValue1279,@"file")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionFile",new Args(new object[]{s.Get(@"Predicate")}),null));}if(R.SwitchMatch(s,switchValue1279,@"control")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionControl",new Args(new object[]{s.Get(@"Predicate")}),null));}if(R.SwitchMatch(s,switchValue1279,@"value")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionValue",new Args(new object[]{s.Get(@"Predicate")}),null));}if(R.SwitchMatch(s,switchValue1279,@"window")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionWindow",new Args(new object[]{s.Get(@"Predicate")}),null));}if(R.SwitchMatch(s,switchValue1279,@"region")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionRegion",new Args(new object[]{s.Get(@"Predicate")}),null));}if(R.SwitchMatch(s,switchValue1279,@"every")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionGroup",new Args(new object[]{s.Get(@"Predicate"),@"every"}),null));}if(R.SwitchMatch(s,switchValue1279,@"any")){hit1280=true;throw new ReturnFlow(R.Call(s,@"Test-ConditionGroup",new Args(new object[]{s.Get(@"Predicate"),@"any"}),null));}if(!hit1280){throw R.Error((""+@"[BAD_REQUEST] unknown wait condition kind '"+R.Str(s.Get(@"kind"))+@"'; known kinds: window, control, value, text, file, region, every, any"));}}catch(BreakFlow){break;}catch(ContinueFlow){}}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_WaitDeadlineMs_1281(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
s.Set(@"Spec",R.Bind(a,1,@"Spec",()=>null,@"object"));
try{s.Set(@"budget",R.Cast(@"int64",R.Member(s.Get(@"Spec"),@"timeoutMs")));
s.Set(@"deadlineAt",s.Get(@"null"));
s.Set(@"raw",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"Arg"),@"deadlineAtMs"}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"raw"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"raw"))),@""))))){s.Set(@"deadlineAt",R.Cast(@"int64",s.Get(@"raw")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"deadlineAt")))){s.Set(@"left",R.Binary(s,@"Minus",R.Cast(@"int64",s.Get(@"deadlineAt")),R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds"))));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"left"),0))){s.Set(@"left",0);}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"left"),s.Get(@"budget")))){s.Set(@"budget",s.Get(@"left"));}}
throw new ReturnFlow(s.Get(@"budget"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Wait_ForCondition_1282(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"spec",R.Call(s,@"Get-WaitConditionSpec",new Args(new object[]{s.Get(@"Arg")}),null));
s.Set(@"condition",R.Member(s.Get(@"spec"),@"condition"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"condition")))){throw R.Error(@"[BAD_REQUEST] waiting for a condition needs a condition");}
s.Set(@"budgetMs",R.Call(s,@"Get-WaitDeadlineMs",new Args(new object[]{s.Get(@"Arg"),s.Get(@"spec")}),null));
s.Set(@"clock",R.Invoke(R.Type(@"System.Diagnostics.Stopwatch"),@"StartNew",new object[]{}));
s.Set(@"polls",0);
s.Set(@"last",s.Get(@"null"));
s.Set(@"trueSince",R.Cast(@"int64",-1));
s.Set(@"heldMs",R.Cast(@"int64",0));
s.Set(@"stableMs",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"condition"),@"stable_ms",0}),null)));
s.Set(@"outcome",@"timeout");
s.Set(@"timeoutKind",@"");
s.Set(@"pollMs",R.Cast(@"int",R.Member(s.Get(@"spec"),@"pollMs")));
s.Set(@"maxPollMs",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Min",new object[]{1000,R.Invoke(R.Type(@"Math"),@"Max",new object[]{R.Binary(s,@"Multiply",s.Get(@"pollMs"),4),500})})));
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1283) => {R.Emit(o1283,R.Member(s.Get(@"spec"),@"weight"));}))),@"heavy"))){s.Set(@"maxPollMs",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Min",new object[]{1200,R.Invoke(R.Type(@"Math"),@"Max",new object[]{R.Binary(s,@"Multiply",s.Get(@"pollMs"),4),800})})));}
s.Set(@"currentPollMs",s.Get(@"pollMs"));
while(R.Bool(s.Get(@"true"))){try{R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{@"during a condition wait"}),null));
s.Set(@"left",R.Binary(s,@"Minus",R.Cast(@"int64",s.Get(@"budgetMs")),R.Cast(@"int64",R.Member(s.Get(@"clock"),@"ElapsedMilliseconds"))));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"left"),0))){s.Set(@"outcome",@"timeout");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"polls"),0))){s.Set(@"timeoutKind",@"budget-spent");
throw new BreakFlow();}
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1284) => {R.Emit(o1284,R.Member(s.Get(@"last"),@"status"));}))),@"unknown"))){s.Set(@"timeoutKind",@"unavailable");}else if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"stableMs"),0)) && R.Bool(R.Binary(s,@"Ige",s.Get(@"trueSince"),0))))){s.Set(@"timeoutKind",@"not-held");}
throw new BreakFlow();}
R.Eval(()=>R.Eval(()=>{var u1285=s.Get(@"polls");s.Set(@"polls",R.Binary(s,@"Plus",u1285,1L));return u1285;}));
s.Set(@"last",R.Call(s,@"Test-ConditionPredicate",new Args(new object[]{s.Get(@"condition")}),null));
s.Set(@"now",R.Cast(@"int64",R.Member(s.Get(@"clock"),@"ElapsedMilliseconds")));
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1286) => {R.Emit(o1286,R.Member(s.Get(@"last"),@"status"));}))),@"true"))){if(R.Bool(R.Binary(s,@"Ile",s.Get(@"stableMs"),0))){s.Set(@"heldMs",R.Cast(@"int64",0));
s.Set(@"outcome",@"satisfied");
throw new BreakFlow();}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"trueSince"),0))){s.Set(@"trueSince",s.Get(@"now"));}
s.Set(@"heldMs",R.Binary(s,@"Minus",s.Get(@"now"),s.Get(@"trueSince")));
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"heldMs"),s.Get(@"stableMs")))){s.Set(@"outcome",@"satisfied");
throw new BreakFlow();}}else{s.Set(@"trueSince",R.Cast(@"int64",-1));
s.Set(@"heldMs",R.Cast(@"int64",0));}
s.Set(@"left",R.Binary(s,@"Minus",R.Cast(@"int64",s.Get(@"budgetMs")),R.Cast(@"int64",R.Member(s.Get(@"clock"),@"ElapsedMilliseconds"))));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"left"),0))){s.Set(@"outcome",@"timeout");
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1287) => {R.Emit(o1287,R.Member(s.Get(@"last"),@"status"));}))),@"unknown"))){s.Set(@"timeoutKind",@"unavailable");}else if(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"stableMs"),0)) && R.Bool(R.Binary(s,@"Ige",s.Get(@"trueSince"),0))))){s.Set(@"timeoutKind",@"not-held");}
throw new BreakFlow();}
s.Set(@"sleep",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Min",new object[]{R.Cast(@"int",s.Get(@"currentPollMs")),R.Cast(@"int",s.Get(@"left"))})));
R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{s.Get(@"sleep")}),null));
s.Set(@"currentPollMs",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"maxPollMs"),R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Max",new object[]{s.Get(@"pollMs"),R.Cast(@"int",R.Binary(s,@"Multiply",s.Get(@"currentPollMs"),2))}))})));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"waited",R.Cast(@"int64",R.Member(s.Get(@"clock"),@"ElapsedMilliseconds")));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Advance-ObservationEpoch",new Args(new object[]{}),null)));
s.Set(@"status",@"false");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"last")))){s.Set(@"status",(""+R.Str(R.Capture((o1288) => {R.Emit(o1288,R.Member(s.Get(@"last"),@"status"));}))));}
s.Set(@"watched",R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"last")));
if(R.Bool(R.Unary(@"Not",s.Get(@"watched")))){s.Set(@"status",@"unknown");}
s.Set(@"budgetFrom",(""+R.Str(R.Capture((o1289) => {R.Emit(o1289,R.Member(s.Get(@"spec"),@"timeoutFrom"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"budgetMs"),R.Cast(@"int64",R.Member(s.Get(@"spec"),@"timeoutMs"))))){s.Set(@"budgetFrom",@"deadline");}
s.Set(@"report",R.Cast(@"ordered",R.Map(new object[]{@"what",R.Capture((o1290) => {if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1291) => {R.Emit(o1291,R.Member(s.Get(@"last"),@"what"));}))),@""))){R.Emit(o1290,(""+R.Str(R.Capture((o1292) => {R.Emit(o1292,R.Member(s.Get(@"last"),@"what"));}))));}else if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1293) => {R.Emit(o1293,R.Member(s.Get(@"last"),@"kind"));}))),@"region"))){R.Emit(o1290,@"a region of the screen");}else{R.Emit(o1290,(""+R.Str(R.Capture((o1294) => {R.Emit(o1294,R.Member(s.Get(@"last"),@"kind"));}))));}}),@"satisfied",R.Binary(s,@"Ieq",s.Get(@"outcome"),@"satisfied"),@"status",s.Get(@"status"),@"outcome",s.Get(@"outcome"),@"waitedMs",R.Cast(@"int",s.Get(@"waited")),@"polls",R.Cast(@"int",s.Get(@"polls")),@"timeoutMs",R.Cast(@"int",s.Get(@"budgetMs")),@"timeoutFrom",s.Get(@"budgetFrom"),@"pollMs",R.Cast(@"int",s.Get(@"pollMs")),@"observed",(""+R.Str(R.Capture((o1295) => {R.Emit(o1295,R.Member(s.Get(@"last"),@"observed"));})))})));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"maxPollMs"),s.Get(@"pollMs")))){R.SetMember(s.Get(@"report"),@"pollBackoffTo",R.Cast(@"int",s.Get(@"maxPollMs")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"timeoutKind"),@""))){R.SetMember(s.Get(@"report"),@"timeoutKind",s.Get(@"timeoutKind"));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"stableMs"),0))){R.SetMember(s.Get(@"report"),@"stableMs",R.Cast(@"int",s.Get(@"stableMs")));
R.SetMember(s.Get(@"report"),@"heldMs",R.Cast(@"int",s.Get(@"heldMs")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"outcome"),@"satisfied"))){R.SetMember(s.Get(@"report"),@"observed",(""+R.Str(R.Capture((o1296) => {R.Emit(o1296,R.Member(s.Get(@"last"),@"observed"));}))+@"; it held for the whole "+R.Str(R.Capture((o1297) => {R.Emit(o1297,s.Get(@"stableMs"));}))+@" ms asked for"));}else if(R.Bool(R.Binary(s,@"Ige",s.Get(@"trueSince"),0))){R.SetMember(s.Get(@"report"),@"observed",(""+R.Str(R.Capture((o1298) => {R.Emit(o1298,R.Member(s.Get(@"last"),@"observed"));}))+@"; it was true for "+R.Str(R.Capture((o1299) => {R.Emit(o1299,s.Get(@"heldMs"));}))+@" ms of the "+R.Str(R.Capture((o1300) => {R.Emit(o1300,s.Get(@"stableMs"));}))+@" ms asked for before the budget ran out, so it did not stay true"));}}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"outcome"),@"timeout")) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"timeoutKind"))),@"unavailable"))))){R.SetMember(s.Get(@"report"),@"observed",(""+R.Str(R.Capture((o1301) => {R.Emit(o1301,R.Member(s.Get(@"report"),@"observed"));}))+@"; the condition could not be observed at all inside the budget, which is not the same statement as its being false"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"last"),@"window")))){R.SetMember(s.Get(@"report"),@"window",R.Member(s.Get(@"last"),@"window"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"last"),@"control")))){R.SetMember(s.Get(@"report"),@"control",R.Member(s.Get(@"last"),@"control"));}
if(R.Bool(R.Unary(@"Not",s.Get(@"watched")))){R.SetMember(s.Get(@"report"),@"what",@"nothing was watched: this call had no budget left when the wait started");
R.SetMember(s.Get(@"report"),@"observed",@"the budget of this call was already spent, so no check was made -- this is not the answer ""the condition is false"". Give the next call more time (deadline_ms / timeout_ms) and ask again.");
R.SetMember(s.Get(@"report"),@"timeoutKind",@"budget-spent");}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"outcome"),@"satisfied")) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1302) => {R.Emit(o1302,R.Member(s.Get(@"last"),@"error"));}))),@""))))){R.SetMember(s.Get(@"report"),@"error",(""+R.Str(R.Capture((o1303) => {R.Emit(o1303,R.Member(s.Get(@"last"),@"error"));}))));}
throw new ReturnFlow(s.Get(@"report"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_NodeLabel_1304(Scope s,Args a){var o=new List<object>();s.Set(@"node",R.Bind(a,0,@"node",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"node")))){throw new ReturnFlow(@"(unknown element)");}
s.Set(@"type",R.Invoke(R.Cast(@"string",R.Member(s.Get(@"node"),@"controlType")),@"Replace",new object[]{@"ControlType.",@""}));
s.Set(@"name",R.Cast(@"string",R.Member(s.Get(@"node"),@"name")));
s.Set(@"id",R.Cast(@"string",R.Member(s.Get(@"node"),@"automationId")));
s.Set(@"label",(""+@"("+R.Str(s.Get(@"type"))+@")"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"name"),@""))){s.Set(@"label",(""+R.Str(s.Get(@"type"))+@" """+R.Str(s.Get(@"name"))+@""""));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"id"),@""))){s.Set(@"label",(""+R.Str(s.Get(@"label"))+@" #"+R.Str(s.Get(@"id"))));}
throw new ReturnFlow(s.Get(@"label"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Invoke_UiaStep_1305(Scope s,Args a){var o=new List<object>();s.Set(@"step",R.Bind(a,0,@"step",()=>null,@"object"));
try{s.Set(@"stepAction",R.Invoke((""+R.Str(R.Capture((o1306) => {R.Emit(o1306,R.Member(s.Get(@"step"),@"action"));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"WRITE_STEP_ACTIONS"),s.Get(@"stepAction")))){R.Emit(o,R.Call(s,@"Assert-CanSend",new Args(new object[]{(""+@"before the '"+R.Str(s.Get(@"stepAction"))+@"' step")}),null));}
s.Set(@"a",R.Map(new object[]{}));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"ref"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1307) => {R.Emit(o1307,R.Member(s.Get(@"step"),@"ref"));}))),@""))))){R.SetMember(s.Get(@"a"),@"ref",(""+R.Str(R.Capture((o1308) => {R.Emit(o1308,R.Member(s.Get(@"step"),@"ref"));}))));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"hwnd")))){R.SetMember(s.Get(@"a"),@"hwnd",R.Member(s.Get(@"step"),@"hwnd"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"automation_id")))){R.SetMember(s.Get(@"a"),@"automationId",R.Member(s.Get(@"step"),@"automation_id"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"name")))){R.SetMember(s.Get(@"a"),@"name",R.Member(s.Get(@"step"),@"name"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"control_type")))){R.SetMember(s.Get(@"a"),@"controlType",R.Member(s.Get(@"step"),@"control_type"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"class_name")))){R.SetMember(s.Get(@"a"),@"className",R.Member(s.Get(@"step"),@"class_name"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"element_index")))){R.SetMember(s.Get(@"a"),@"index",R.Member(s.Get(@"step"),@"element_index"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"value")))){R.SetMember(s.Get(@"a"),@"value",R.Member(s.Get(@"step"),@"value"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"text")))){R.SetMember(s.Get(@"a"),@"text",R.Member(s.Get(@"step"),@"text"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"prefix")))){R.SetMember(s.Get(@"a"),@"prefix",R.Member(s.Get(@"step"),@"prefix"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"suffix")))){R.SetMember(s.Get(@"a"),@"suffix",R.Member(s.Get(@"step"),@"suffix"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"selection_type")))){R.SetMember(s.Get(@"a"),@"selectionType",R.Member(s.Get(@"step"),@"selection_type"));}
R.SetMember(s.Get(@"a"),@"action",(""+R.Str(R.Capture((o1309) => {R.Emit(o1309,R.Member(s.Get(@"step"),@"action"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"a"),@"ref")))){throw new ReturnFlow(R.Call(s,@"Do-UiActByRef",new Args(new object[]{s.Get(@"a")}),null));}
throw new ReturnFlow(R.Call(s,@"Do-UiAct",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_UiaStepLine_1312(Scope s,Args a){var o=new List<object>();s.Set(@"action",R.Bind(a,0,@"action",()=>null,@"string"));
s.Set(@"receipt",R.Bind(a,1,@"receipt",()=>null,@"object"));
try{s.Set(@"label",R.Call(s,@"Get-NodeLabel",new Args(new object[]{R.Member(s.Get(@"receipt"),@"matched")}),null));
foreach(var switchValue1313 in R.Array(s.Get(@"action"))){try{bool hit1314=false;if(R.SwitchMatch(s,switchValue1313,@"get_value")){hit1314=true;throw new ReturnFlow((""+@"get_value "+R.Str(s.Get(@"label"))+@" -> "+R.Str(R.Capture((o1315) => {R.Emit(o1315,R.Member(s.Get(@"receipt"),@"value"));}))));}if(R.SwitchMatch(s,switchValue1313,@"get_text")){hit1314=true;s.Set(@"shown",(""+R.Str(R.Capture((o1316) => {R.Emit(o1316,R.Member(s.Get(@"receipt"),@"value"));}))));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"shown"),@"Length"),2000))){s.Set(@"shown",R.Invoke(s.Get(@"shown"),@"Substring",new object[]{0,2000}));}
throw new ReturnFlow((""+@"get_text "+R.Str(s.Get(@"label"))+@" -> "+R.Str(s.Get(@"shown"))));}if(R.SwitchMatch(s,switchValue1313,@"set_value")){hit1314=true;throw new ReturnFlow((""+@"set_value "+R.Str(s.Get(@"label"))+@" = "+R.Str(R.Capture((o1317) => {R.Emit(o1317,R.Member(s.Get(@"receipt"),@"value"));}))));}if(R.SwitchMatch(s,switchValue1313,@"select_text")){hit1314=true;throw new ReturnFlow((""+@"select_text "+R.Str(s.Get(@"label"))+@" -> '"+R.Str(R.Capture((o1318) => {R.Emit(o1318,R.Member(s.Get(@"receipt"),@"value"));}))+@"'"));}if(R.SwitchMatch(s,switchValue1313,@"click_text")){hit1314=true;throw new ReturnFlow((""+@"click_text '"+R.Str(R.Capture((o1319) => {R.Emit(o1319,R.Member(s.Get(@"receipt"),@"value"));}))+@"' "+R.Str(s.Get(@"label"))));}if(R.SwitchMatch(s,switchValue1313,@"locate_text")){hit1314=true;throw new ReturnFlow((""+@"locate_text '"+R.Str(R.Capture((o1320) => {R.Emit(o1320,R.Member(s.Get(@"receipt"),@"value"));}))+@"' "+R.Str(s.Get(@"label"))));}if(R.SwitchMatch(s,switchValue1313,@"get_caret")){hit1314=true;throw new ReturnFlow((""+@"get_caret line='"+R.Str(R.Capture((o1321) => {R.Emit(o1321,R.Member(s.Get(@"receipt"),@"value"));}))+@"'"));}if(R.SwitchMatch(s,switchValue1313,@"legacy_action")){hit1314=true;throw new ReturnFlow((""+@"legacy_action "+R.Str(s.Get(@"label"))));}if(!hit1314){throw new ReturnFlow((""+R.Str(s.Get(@"action"))+@" "+R.Str(s.Get(@"label"))));}}catch(BreakFlow){break;}catch(ContinueFlow){}}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_ExpectedTransition_1324(Scope s,Args a){var o=new List<object>();s.Set(@"declared",R.Bind(a,0,@"declared",()=>null,@"object"));
s.Set(@"live",R.Bind(a,1,@"live",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"declared")))){throw new ReturnFlow(s.Get(@"null"));}
foreach(var item1325 in R.Array(R.Array(R.Capture((o1326) => {R.Emit(o1326,s.Get(@"declared"));})))){s.Set(@"entry",item1325);try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"entry")))){throw new ContinueFlow();}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"entry"))),@"any")) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(s.Get(@"entry"))),@"*"))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"matchedBy",@"any"})));}
s.Set(@"toRaw",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"entry"),@"to"}),null));
if(R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"toRaw"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"toRaw"))),@"")))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",s.Get(@"toRaw")),0)))) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",R.Member(s.Get(@"live"),@"hwnd")),R.Cast(@"int64",s.Get(@"toRaw"))))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"matchedBy",(""+@"hwnd "+R.Str(s.Get(@"toRaw")))})));}
s.Set(@"title",(""+R.Str(R.Capture((o1327) => {R.Emit(o1327,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"entry"),@"title",@""}),null));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"title"),@"")) && R.Bool(R.Binary(s,@"Ige",R.Invoke((""+R.Str(R.Capture((o1328) => {R.Emit(o1328,R.Member(s.Get(@"live"),@"title"));}))),@"IndexOf",new object[]{s.Get(@"title"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"matchedBy",(""+@"title~'"+R.Str(s.Get(@"title"))+@"'")})));}
s.Set(@"proc",(""+R.Str(R.Capture((o1329) => {R.Emit(o1329,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"entry"),@"process",@""}),null));}))));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"proc"),@"")) && R.Bool(R.Binary(s,@"Ige",R.Invoke((""+R.Str(R.Capture((o1330) => {R.Emit(o1330,R.Member(s.Get(@"live"),@"process"));}))),@"IndexOf",new object[]{s.Get(@"proc"),R.Member(R.Type(@"System.StringComparison"),@"OrdinalIgnoreCase")}),0))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"matchedBy",(""+@"process~'"+R.Str(s.Get(@"proc"))+@"'")})));}
s.Set(@"pidRaw",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"entry"),@"pid"}),null));
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"pidRaw"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"pidRaw"))),@"")))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",s.Get(@"pidRaw")),0))))){s.Set(@"livePid",0);
try{s.Set(@"livePid",R.Cast(@"int",R.Member(R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"live"),@"hwnd")))}),null),@"pid")));}catch(Exception error1331) when (!(error1331 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1331}));s.Set(@"livePid",0);}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"livePid"),0)) && R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",s.Get(@"livePid")),R.Cast(@"int64",s.Get(@"pidRaw"))))))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"matchedBy",(""+@"pid "+R.Str(s.Get(@"pidRaw")))})));}}}catch(ContinueFlow){}catch(BreakFlow){break;}}
throw new ReturnFlow(s.Get(@"null"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_CaptureArgs_1332(Scope s,Args a){var o=new List<object>();s.Set(@"Base",R.Bind(a,0,@"Base",()=>null,@"hashtable"));
s.Set(@"Step",R.Bind(a,1,@"Step",()=>s.Get(@"null"),@"object"));
s.Set(@"Extra",R.Bind(a,2,@"Extra",()=>s.Get(@"null"),@"hashtable"));
try{s.Set(@"capture",R.Map(new object[]{}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Base")))){foreach(var item1333 in R.Array(R.Member(s.Get(@"Base"),@"Keys"))){s.Set(@"key",item1333);try{R.SetIndex(s.Get(@"capture"),s.Get(@"key"),R.Index(s.Get(@"Base"),s.Get(@"key")));}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Step")))){s.Set(@"stepPath",(""+R.Str(R.Capture((o1334) => {R.Emit(o1334,R.Member(s.Get(@"Step"),@"path"));}))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"stepPath"),@""))){R.SetIndex(s.Get(@"capture"),@"path",s.Get(@"stepPath"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"scale")))){R.SetIndex(s.Get(@"capture"),@"scale",R.Cast(@"double",R.Member(s.Get(@"Step"),@"scale")));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"surface"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1335) => {R.Emit(o1335,R.Member(s.Get(@"Step"),@"surface"));}))),@""))))){R.SetIndex(s.Get(@"capture"),@"surface",(""+R.Str(R.Capture((o1336) => {R.Emit(o1336,R.Member(s.Get(@"Step"),@"surface"));}))));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"regionSpace"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1337) => {R.Emit(o1337,R.Member(s.Get(@"Step"),@"regionSpace"));}))),@""))))){R.SetIndex(s.Get(@"capture"),@"regionSpace",(""+R.Str(R.Capture((o1338) => {R.Emit(o1338,R.Member(s.Get(@"Step"),@"regionSpace"));}))));}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"region_space"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1339) => {R.Emit(o1339,R.Member(s.Get(@"Step"),@"region_space"));}))),@""))))){R.SetIndex(s.Get(@"capture"),@"regionSpace",(""+R.Str(R.Capture((o1340) => {R.Emit(o1340,R.Member(s.Get(@"Step"),@"region_space"));}))));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"clip")))){R.SetIndex(s.Get(@"capture"),@"clip",R.Binary(s,@"Ieq",R.Member(s.Get(@"Step"),@"clip"),s.Get(@"true")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"region")))){R.SetIndex(s.Get(@"capture"),@"region",R.Member(s.Get(@"Step"),@"region"));}
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"window"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1341) => {R.Emit(o1341,R.Member(s.Get(@"Step"),@"window"));}))),@"")))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1342) => {R.Emit(o1342,R.Member(s.Get(@"Step"),@"window"));}))),@"0"))))){R.SetIndex(s.Get(@"capture"),@"window",R.Cast(@"int64",R.Member(s.Get(@"Step"),@"window")));
R.SetIndex(s.Get(@"capture"),@"requireWindow",s.Get(@"true"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"display"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1343) => {R.Emit(o1343,R.Member(s.Get(@"Step"),@"display"));}))),@""))))){R.SetIndex(s.Get(@"capture"),@"display",R.Member(s.Get(@"Step"),@"display"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"format"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1344) => {R.Emit(o1344,R.Member(s.Get(@"Step"),@"format"));}))),@""))))){R.SetIndex(s.Get(@"capture"),@"format",R.Invoke((""+R.Str(R.Capture((o1345) => {R.Emit(o1345,R.Member(s.Get(@"Step"),@"format"));}))),@"ToLowerInvariant",new object[]{}));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"quality")))){R.SetIndex(s.Get(@"capture"),@"quality",R.Cast(@"int",R.Member(s.Get(@"Step"),@"quality")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"settle_ms")))){R.SetIndex(s.Get(@"capture"),@"settleMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{5000,R.Cast(@"int",R.Member(s.Get(@"Step"),@"settle_ms"))})}));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"stability_ms")))){R.SetIndex(s.Get(@"capture"),@"stabilityMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:StabilityMaxMs"),R.Cast(@"int",R.Member(s.Get(@"Step"),@"stability_ms"))})}));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Step"),@"stable")))){R.SetIndex(s.Get(@"capture"),@"stable",R.Member(s.Get(@"Step"),@"stable"));}}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"Extra")))){foreach(var item1346 in R.Array(R.Member(s.Get(@"Extra"),@"Keys"))){s.Set(@"key",item1346);try{R.SetIndex(s.Get(@"capture"),s.Get(@"key"),R.Index(s.Get(@"Extra"),s.Get(@"key")));}catch(ContinueFlow){}catch(BreakFlow){break;}}}
throw new ReturnFlow(s.Get(@"capture"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Test_SameCaptureSpec_1347(Scope s,Args a){var o=new List<object>();s.Set(@"A",R.Bind(a,0,@"A",()=>null,@"hashtable"));
s.Set(@"B",R.Bind(a,1,@"B",()=>null,@"hashtable"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"A"))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"B")))))){throw new ReturnFlow(s.Get(@"false"));}
foreach(var item1348 in R.Array(R.Array(R.Capture((o1349) => {R.Emit(o1349,new object[]{@"display",@"regionSpace",@"surface",@"clip",@"scale",@"format",@"quality",@"window",@"requireWindow"});})))){s.Set(@"key",item1348);try{s.Set(@"left",R.Capture((o1350) => {if(R.Bool(R.Invoke(s.Get(@"A"),@"ContainsKey",new object[]{s.Get(@"key")}))){R.Emit(o1350,(""+R.Str(R.Capture((o1351) => {R.Emit(o1351,R.Index(s.Get(@"A"),s.Get(@"key")));}))));}else{R.Emit(o1350,@"");}}));
s.Set(@"right",R.Capture((o1352) => {if(R.Bool(R.Invoke(s.Get(@"B"),@"ContainsKey",new object[]{s.Get(@"key")}))){R.Emit(o1352,(""+R.Str(R.Capture((o1353) => {R.Emit(o1353,R.Index(s.Get(@"B"),s.Get(@"key")));}))));}else{R.Emit(o1352,@"");}}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"left"),s.Get(@"right")))){throw new ReturnFlow(s.Get(@"false"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"leftRegion",R.Capture((o1354) => {if(R.Bool(R.Invoke(s.Get(@"A"),@"ContainsKey",new object[]{@"region"}))){R.Emit(o1354,R.Index(s.Get(@"A"),@"region"));}else{R.Emit(o1354,s.Get(@"null"));}}));
s.Set(@"rightRegion",R.Capture((o1355) => {if(R.Bool(R.Invoke(s.Get(@"B"),@"ContainsKey",new object[]{@"region"}))){R.Emit(o1355,R.Index(s.Get(@"B"),@"region"));}else{R.Emit(o1355,s.Get(@"null"));}}));
if(R.Bool(R.Binary(s,@"Ine",R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"leftRegion")),R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"rightRegion"))))){throw new ReturnFlow(s.Get(@"false"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"leftRegion")))){foreach(var item1356 in R.Array(R.Array(R.Capture((o1357) => {R.Emit(o1357,new object[]{@"x",@"y",@"width",@"height"});})))){s.Set(@"axis",item1356);try{if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1358) => {R.Emit(o1358,R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"leftRegion"),s.Get(@"axis")}),null));}))),(""+R.Str(R.Capture((o1359) => {R.Emit(o1359,R.Call(s,@"Get-ArgMember",new Args(new object[]{s.Get(@"rightRegion"),s.Get(@"axis")}),null));})))))){throw new ReturnFlow(s.Get(@"false"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
throw new ReturnFlow(s.Get(@"true"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_New_BatchProgress_1360(Scope s,Args a){var o=new List<object>();s.Set(@"steps",R.Bind(a,0,@"steps",()=>null,@"object"));
s.Set(@"failedAt",R.Bind(a,1,@"failedAt",()=>null,@"int"));
s.Set(@"failedState",R.Bind(a,2,@"failedState",()=>null,@"string"));
try{s.Set(@"list",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Member(s.Get(@"steps"),@"Count")))){try{s.Set(@"action",R.Invoke((""+R.Str(R.Capture((o1361) => {R.Emit(o1361,R.Member(R.Index(s.Get(@"steps"),s.Get(@"i")),@"action"));}))),@"ToLowerInvariant",new object[]{}));
s.Set(@"state",@"completed");
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"failedAt"),0))){if(R.Bool(R.Binary(s,@"Igt",s.Get(@"i"),s.Get(@"failedAt")))){s.Set(@"state",@"not-run");}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"i"),s.Get(@"failedAt")))){s.Set(@"state",s.Get(@"failedState"));}}
R.Emit(o,R.Invoke(s.Get(@"list"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"step",R.Cast(@"int",s.Get(@"i")),@"action",s.Get(@"action"),@"state",s.Get(@"state")}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u1362=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u1362,1L));return u1362;}));}}
throw new ReturnFlow(R.Invoke(s.Get(@"list"),@"ToArray",new object[]{}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Get_BatchRemainingMs_1374(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ile",s.Get(@"deadlineAtMs"),0))){throw new ReturnFlow(R.Member(R.Type(@"int"),@"MaxValue"));}
s.Set(@"left",R.Binary(s,@"Minus",R.Cast(@"int64",s.Get(@"deadlineAtMs")),R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds"))));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"left"),0))){s.Set(@"left",0);}
throw new ReturnFlow(R.Cast(@"int",s.Get(@"left")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Complete_Evidence_1375(Scope s,Args a){var o=new List<object>();
try{if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"digestRect")))){throw new ReturnFlow(s.Get(@"null"));}
s.Set(@"after",@"");
s.Set(@"reused",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(s.Get(@"evidenceDigest"))),@""))){s.Set(@"after",(""+R.Str(s.Get(@"evidenceDigest"))));
s.Set(@"reused",s.Get(@"true"));}else{s.Set(@"after",R.Call(s,@"Get-RegionDigest",new Args(new object[]{R.Member(s.Get(@"digestRect"),@"x"),R.Member(s.Get(@"digestRect"),@"y"),R.Member(s.Get(@"digestRect"),@"width"),R.Member(s.Get(@"digestRect"),@"height"),320}),null));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"changed",R.Binary(s,@"Ine",s.Get(@"after"),s.Get(@"digestBefore")),@"before",s.Get(@"digestBefore"),@"after",s.Get(@"after"),@"reused",s.Get(@"reused"),@"x",R.Member(s.Get(@"digestRect"),@"x"),@"y",R.Member(s.Get(@"digestRect"),@"y"),@"width",R.Member(s.Get(@"digestRect"),@"width"),@"height",R.Member(s.Get(@"digestRect"),@"height")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Settle_Before_Capture_1376(Scope s,Args a){var o=new List<object>();
try{}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1486(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Icontains",s.Get(@"UIA_STEP_ACTIONS"),s.Get(@"action")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1496(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1497) => {R.Emit(o1497,R.Member(s.Get(@"_"),@"state"));}))),@"partial"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1498(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"int",R.Member(s.Get(@"_"),@"step")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1500(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"int",s.Get(@"_")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1503(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,s.Get(@"_"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1515(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Cast(@"int",s.Get(@"_")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1519(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,s.Get(@"_"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1521(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,s.Get(@"_"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Batch_1363(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"steps",R.Array(R.Capture((o1364) => {R.Emit(o1364,R.Member(s.Get(@"Arg"),@"steps"));})));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"steps"),@"Count"),0))){throw R.Error(@"batch requires at least one step");}
s.Set(@"deadlineMs",R.Cast(@"int64",0));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"deadlineMs"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1365) => {R.Emit(o1365,R.Member(s.Get(@"Arg"),@"deadlineMs"));}))),@""))))){s.Set(@"deadlineMs",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"deadlineMs")));}
s.Set(@"deadlineAtMs",R.Cast(@"int64",0));
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"deadlineMs"),0))){s.Set(@"deadlineAtMs",R.Binary(s,@"Plus",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),s.Get(@"deadlineMs")));}
R.Emit(o,R.Call(s,@"Set-DeadlineAt",new Args(new object[]{s.Get(@"deadlineAtMs")}),null));
s.Set(@"expectedTransitions",R.Member(s.Get(@"Arg"),@"expectedTransitions"));
s.Set(@"transitions",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"outcome",@"ok");
s.Set(@"nextStep",-1);
s.Set(@"wroteSteps",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[int]"}),null));
s.Set(@"settleMs",s.Get(@"script:PostActionMs"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"settleMs")))){s.Set(@"settleMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{5000,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"settleMs"))})}));}
s.Set(@"stabilityMs",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"stabilityMs")))){s.Set(@"stabilityMs",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Invoke(R.Type(@"Math"),@"Min",new object[]{s.Get(@"script:StabilityMaxMs"),R.Cast(@"int",R.Member(s.Get(@"Arg"),@"stabilityMs"))})}));}
s.Set(@"stableFlag",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"stable")))){s.Set(@"stableFlag",R.Member(s.Get(@"Arg"),@"stable"));}
s.Set(@"defaultPath",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"path")));
s.Set(@"display",R.Member(s.Get(@"Arg"),@"display"));
s.Set(@"region",R.Member(s.Get(@"Arg"),@"region"));
s.Set(@"captureWindow",R.Cast(@"int64",0));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"window")))){s.Set(@"captureWindow",R.Cast(@"int64",R.Member(s.Get(@"Arg"),@"window")));}
s.Set(@"requireWindow",(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"requireWindow"),s.Get(@"true"))) || R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"require_window"),s.Get(@"true")))));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"display")))){s.Set(@"display",R.Member(s.Get(@"Arg"),@"display"));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"region")))){s.Set(@"region",R.Member(s.Get(@"Arg"),@"region"));}
s.Set(@"format",@"png");
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"format"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1366) => {R.Emit(o1366,R.Member(s.Get(@"Arg"),@"format"));}))),@""))))){s.Set(@"format",R.Invoke((""+R.Str(R.Capture((o1367) => {R.Emit(o1367,R.Member(s.Get(@"Arg"),@"format"));}))),@"ToLowerInvariant",new object[]{}));}
s.Set(@"quality",85);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"quality")))){s.Set(@"quality",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"quality")));}
s.Set(@"scale",1d);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"scale")))){s.Set(@"scale",R.Cast(@"double",R.Member(s.Get(@"Arg"),@"scale")));}
s.Set(@"captureBase",R.Map(new object[]{@"path",s.Get(@"defaultPath"),@"display",s.Get(@"display"),@"region",s.Get(@"region"),@"regionSpace",(""+R.Str(R.Capture((o1368) => {R.Emit(o1368,R.Member(s.Get(@"Arg"),@"regionSpace"));}))),@"surface",(""+R.Str(R.Capture((o1369) => {R.Emit(o1369,R.Member(s.Get(@"Arg"),@"surface"));}))),@"clip",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"clip"),s.Get(@"true")),@"format",s.Get(@"format"),@"quality",s.Get(@"quality"),@"scale",s.Get(@"scale"),@"settleMs",s.Get(@"settleMs"),@"stabilityMs",s.Get(@"stabilityMs"),@"stable",s.Get(@"stableFlag")}));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"captureWindow"),0))){R.SetIndex(s.Get(@"captureBase"),@"window",s.Get(@"captureWindow"));
R.SetIndex(s.Get(@"captureBase"),@"requireWindow",s.Get(@"requireWindow"));}
s.Set(@"performed",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[string]"}),null));
s.Set(@"shot",s.Get(@"null"));
s.Set(@"waitReports",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
s.Set(@"usefulCapture",s.Get(@"null"));
s.Set(@"index",0);
s.Set(@"stopwatch",R.Invoke(R.Type(@"System.Diagnostics.Stopwatch"),@"StartNew",new object[]{}));
s.Set(@"guardWindows",R.Binary(s,@"Ine",R.Member(s.Get(@"Arg"),@"stopOnWindowChange"),s.Get(@"false")));
s.Set(@"baselineHwnd",R.Cast(@"int64",0));
if(R.Bool(s.Get(@"guardWindows"))){s.Set(@"baselineProbe",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null));
s.Set(@"baselineHwnd",R.Cast(@"int64",R.Member(s.Get(@"baselineProbe"),@"hwnd")));}
s.Set(@"evidence",s.Get(@"null"));
s.Set(@"digestRect",s.Get(@"null"));
s.Set(@"digestBefore",@"");
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"Arg"),@"evidence"),s.Get(@"false")))){foreach(var item1370 in R.Array(s.Get(@"steps"))){s.Set(@"step",item1370);try{if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"WRITE_STEP_ACTIONS"),R.Invoke((""+R.Str(R.Capture((o1371) => {R.Emit(o1371,R.Member(s.Get(@"step"),@"action"));}))),@"ToLowerInvariant",new object[]{})))){s.Set(@"digestRect",R.Call(s,@"Get-ForegroundRect",new Args(new object[]{}),null));
s.Set(@"digestBefore",R.Call(s,@"Get-RegionDigest",new Args(new object[]{R.Member(s.Get(@"digestRect"),@"x"),R.Member(s.Get(@"digestRect"),@"y"),R.Member(s.Get(@"digestRect"),@"width"),R.Member(s.Get(@"digestRect"),@"height"),320}),null));
throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}}}
s.Set(@"lastWriteIndex",-1);
{s.Set(@"writeScan",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"writeScan"),R.Member(s.Get(@"steps"),@"Count")))){try{if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"WRITE_STEP_ACTIONS"),R.Invoke((""+R.Str(R.Capture((o1372) => {R.Emit(o1372,R.Member(R.Index(s.Get(@"steps"),s.Get(@"writeScan")),@"action"));}))),@"ToLowerInvariant",new object[]{})))){s.Set(@"lastWriteIndex",s.Get(@"writeScan"));}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u1373=s.Get(@"writeScan");s.Set(@"writeScan",R.Binary(s,@"Plus",u1373,1L));return u1373;}));}}
s.Set(@"frameStepIndex",-1);
s.Set(@"evidenceRect",s.Get(@"null"));
s.Set(@"evidenceDigest",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"digestRect")))){s.Set(@"evidenceRect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"digestRect"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"digestRect"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"digestRect"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"digestRect"),@"height")),@"maxSide",320})));}
s.Functions[@"Get-BatchRemainingMs"]=new Fn(s,F_Get_BatchRemainingMs_1374);
s.Functions[@"Complete-Evidence"]=new Fn(s,F_Complete_Evidence_1375);
s.Functions[@"Settle-Before-Capture"]=new Fn(s,F_Settle_Before_Capture_1376);
s.Set(@"stepIndex",0);
foreach(var item1377 in R.Array(s.Get(@"steps"))){s.Set(@"candidate",item1377);try{s.Set(@"candidateAction",R.Invoke((""+R.Str(R.Capture((o1378) => {R.Emit(o1378,R.Member(s.Get(@"candidate"),@"action"));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"candidateAction")}))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" has no action"));}
if(R.Bool(R.Unary(@"Not",R.Binary(s,@"Icontains",s.Get(@"STEP_ACTIONS"),s.Get(@"candidateAction"))))){throw R.Error((""+@"[BAD_REQUEST] unknown step action '"+R.Str(s.Get(@"candidateAction"))+@"' at step "+R.Str(s.Get(@"stepIndex"))+@"; known actions: "+R.Str(R.Capture((o1379) => {R.Emit(o1379,R.Binary(s,@"Join",s.Get(@"STEP_ACTIONS"),@", "));}))));}
foreach(var switchValue1380 in R.Array(s.Get(@"candidateAction"))){try{bool hit1381=false;if(R.SwitchMatch(s,switchValue1380,@"move")){hit1381=true;s.Set(@"hasDelta",(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"dx"))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"dy")))));
s.Set(@"hasPoint",(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"x"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"y")))));
s.Set(@"hasFrame",R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1382) => {R.Emit(o1382,R.Member(s.Get(@"candidate"),@"from_frame"));})))})));
if(R.Bool((R.Bool(s.Get(@"hasDelta")) && R.Bool((R.Bool(s.Get(@"hasPoint")) || R.Bool(s.Get(@"hasFrame"))))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a relative move (dx/dy) that also names a point: pass either a delta or a destination"));}
if(R.Bool((R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"hasDelta"))) && R.Bool(R.Unary(@"Not",s.Get(@"hasPoint"))))) && R.Bool(R.Unary(@"Not",s.Get(@"hasFrame")))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a move without x and y (or dx/dy for a relative move)"));}}if(R.SwitchMatch(s,switchValue1380,@"click")){hit1381=true;if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"x"))) && R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1383) => {R.Emit(o1383,R.Member(s.Get(@"candidate"),@"from_frame"));})))}))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a click with neither x/y nor from_frame"));}}if(R.SwitchMatch(s,switchValue1380,@"drag")){hit1381=true;s.Set(@"continues",(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"fromLast"))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1384) => {R.Emit(o1384,R.Member(s.Get(@"candidate"),@"fromLast"));}))),@"true")))) || R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1385) => {R.Emit(o1385,R.Member(s.Get(@"candidate"),@"continueFrom"));})))})))));
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"to_x"))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"to_y")))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a drag without to_x and to_y"));}
if(R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"continues"))) && R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"from_x"))) || R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"from_y")))))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a drag without from_x, from_y, to_x and to_y (or from_last/continue_from for a continued stroke)"));}}if(R.SwitchMatch(s,switchValue1380,@"scroll")){hit1381=true;if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{(""+R.Str(R.Capture((o1386) => {R.Emit(o1386,R.Member(s.Get(@"candidate"),@"direction"));})))}))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a scroll without a direction"));}}if(R.SwitchMatch(s,switchValue1380,@"type")){hit1381=true;if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"text")))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a type without text"));}}if(R.SwitchMatch(s,switchValue1380,@"paste")){hit1381=true;if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1387) => {R.Emit(o1387,R.Member(s.Get(@"candidate"),@"text"));})))}))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a paste without text"));}}if(R.SwitchMatch(s,switchValue1380,@"key")){hit1381=true;if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{(""+R.Str(R.Capture((o1388) => {R.Emit(o1388,R.Member(s.Get(@"candidate"),@"keys"));})))}))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a key press without keys"));}}if(R.SwitchMatch(s,switchValue1380,@"focus")){hit1381=true;if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"hwnd")))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a focus without hwnd"));}}if(R.SwitchMatch(s,switchValue1380,@"wait")){hit1381=true;if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"seconds")))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a wait without seconds"));}}if(R.SwitchMatch(s,switchValue1380,@"wait_for")){hit1381=true;s.Set(@"cond",R.Member(s.Get(@"candidate"),@"condition"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"cond")))){s.Set(@"cond",s.Get(@"candidate"));}
s.Set(@"hasPredicate",(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"cond"),@"kind"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1389) => {R.Emit(o1389,R.Member(s.Get(@"cond"),@"kind"));}))),@"")))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"cond"),@"every"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1390) => {R.Emit(o1390,R.Member(s.Get(@"cond"),@"every"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"cond"),@"any"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1391) => {R.Emit(o1391,R.Member(s.Get(@"cond"),@"any"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"cond"),@"hwnd"))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"cond"),@"hwnd")),0)))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"cond"),@"title"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1392) => {R.Emit(o1392,R.Member(s.Get(@"cond"),@"title"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"cond"),@"control"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1393) => {R.Emit(o1393,R.Member(s.Get(@"cond"),@"control"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"cond"),@"path"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1394) => {R.Emit(o1394,R.Member(s.Get(@"cond"),@"path"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1395) => {R.Emit(o1395,R.Member(s.Get(@"cond"),@"type"));}))),@"value")) && R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1396) => {R.Emit(o1396,R.Member(s.Get(@"cond"),@"expected"));})))})))))));
if(R.Bool(R.Unary(@"Not",s.Get(@"hasPredicate")))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a wait_for with no condition: give it a kind (window/control/value/text/every), or a hwnd/title/control/control_type selector, plus timeout_ms"));}}if(R.SwitchMatch(s,switchValue1380,@"clipboard")){hit1381=true;if(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1397) => {R.Emit(o1397,R.Member(s.Get(@"candidate"),@"op"));}))),@"set")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"text")))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" sets the clipboard without text"));}}if(R.SwitchMatch(s,switchValue1380,@"screenshot")){hit1381=true;if(R.Bool((R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{(""+R.Str(R.Capture((o1398) => {R.Emit(o1398,R.Member(s.Get(@"candidate"),@"path"));})))})) && R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"defaultPath")}))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a screenshot and neither it nor the call carries a path"));}}if(!hit1381){s.Set(@"hasSelector",(R.Bool((R.Bool((R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"ref"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1399) => {R.Emit(o1399,R.Member(s.Get(@"candidate"),@"ref"));}))),@"")))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"automation_id"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1400) => {R.Emit(o1400,R.Member(s.Get(@"candidate"),@"automation_id"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"name"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1401) => {R.Emit(o1401,R.Member(s.Get(@"candidate"),@"name"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"control_type"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1402) => {R.Emit(o1402,R.Member(s.Get(@"candidate"),@"control_type"));}))),@"")))))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"class_name"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1403) => {R.Emit(o1403,R.Member(s.Get(@"candidate"),@"class_name"));}))),@""))))));
if(R.Bool(R.Unary(@"Not",s.Get(@"hasSelector")))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" ("+R.Str(s.Get(@"candidateAction"))+@") needs at least one selector: ref, automation_id, name, control_type, or class_name"));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"candidateAction"),@"set_value")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"candidate"),@"value")))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" is a set_value without a value"));}
if(R.Bool((R.Bool(R.Binary(s,@"Icontains",R.Array(R.Capture((o1404) => {R.Emit(o1404,new object[]{@"select_text",@"click_text",@"locate_text"});})),s.Get(@"candidateAction"))) && R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1405) => {R.Emit(o1405,R.Member(s.Get(@"candidate"),@"text"));})))}))))){throw R.Error((""+@"[BAD_REQUEST] step "+R.Str(s.Get(@"stepIndex"))+@" ("+R.Str(s.Get(@"candidateAction"))+@") needs the text to locate"));}}}catch(BreakFlow){break;}catch(ContinueFlow){}}
s.Set(@"stepIndex",R.Binary(s,@"Plus",s.Get(@"stepIndex"),1));}catch(ContinueFlow){}catch(BreakFlow){break;}}
foreach(var item1406 in R.Array(s.Get(@"steps"))){s.Set(@"step",item1406);try{s.Set(@"action",R.Invoke((""+R.Str(R.Capture((o1407) => {R.Emit(o1407,R.Member(s.Get(@"step"),@"action"));}))),@"ToLowerInvariant",new object[]{}));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"action")}))){throw R.Error((""+@"step "+R.Str(s.Get(@"index"))+@" has no action"));}
try{s.Set(@"leftForStep",R.Call(s,@"Get-BatchRemainingMs",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ile",s.Get(@"leftForStep"),0))){s.Set(@"outcome",@"deadline");
s.Set(@"nextStep",R.Cast(@"int",s.Get(@"index")));
throw R.Error((""+@"[DEADLINE_EXHAUSTED] this call's deadline ran out before step "+R.Str(s.Get(@"index"))+@" ('"+R.Str(s.Get(@"action"))+@"'); the "+R.Str(R.Capture((o1408) => {R.Emit(o1408,R.Member(s.Get(@"performed"),@"Count"));}))+@" step(s) before it did run and nothing after it was started. Observe the result (computer_screenshot, computer_ui, or a `state` step in a new call) before deciding anything else, and give the next call a larger deadline_ms if this sequence needs longer."));}
R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{(""+@"before step "+R.Str(s.Get(@"index"))+@" of "+R.Str(R.Capture((o1409) => {R.Emit(o1409,R.Member(s.Get(@"steps"),@"Count"));}))+@" ('"+R.Str(s.Get(@"action"))+@"')")}),null));
if(R.Bool((R.Bool(s.Get(@"guardWindows")) && R.Bool(R.Binary(s,@"Icontains",s.Get(@"FOREGROUND_STEP_ACTIONS"),s.Get(@"action")))))){s.Set(@"namesWindow",(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"into_hwnd"))) || R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"from_frame"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1410) => {R.Emit(o1410,R.Member(s.Get(@"step"),@"from_frame"));}))),@""))))));
if(R.Bool(R.Unary(@"Not",s.Get(@"namesWindow")))){s.Set(@"live",R.Call(s,@"Get-ForegroundInfo",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ieq",R.Cast(@"int64",R.Member(s.Get(@"live"),@"hwnd")),0))){}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"baselineHwnd"),0))){s.Set(@"baselineHwnd",R.Cast(@"int64",R.Member(s.Get(@"live"),@"hwnd")));}else if(R.Bool(R.Binary(s,@"Ine",R.Cast(@"int64",R.Member(s.Get(@"live"),@"hwnd")),s.Get(@"baselineHwnd")))){s.Set(@"declared",R.Call(s,@"Test-ExpectedTransition",new Args(new object[]{s.Get(@"expectedTransitions"),s.Get(@"live")}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"declared")))){R.Emit(o,R.Invoke(s.Get(@"transitions"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"atStep",R.Cast(@"int",s.Get(@"index")),@"from",R.Cast(@"int64",s.Get(@"baselineHwnd")),@"to",R.Cast(@"int64",R.Member(s.Get(@"live"),@"hwnd")),@"title",(""+R.Str(R.Capture((o1411) => {R.Emit(o1411,R.Member(s.Get(@"live"),@"title"));}))),@"process",(""+R.Str(R.Capture((o1412) => {R.Emit(o1412,R.Member(s.Get(@"live"),@"process"));}))),@"matchedBy",(""+R.Str(R.Capture((o1413) => {R.Emit(o1413,R.Member(s.Get(@"declared"),@"matchedBy"));}))),@"note",@"declared in expectedTransitions, so the batch continued into this window"}))}));
s.Set(@"baselineHwnd",R.Cast(@"int64",R.Member(s.Get(@"live"),@"hwnd")));}else{s.Set(@"nowTitle",(""+R.Str(R.Capture((o1414) => {R.Emit(o1414,R.Member(s.Get(@"live"),@"title"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"nowTitle"),@""))){s.Set(@"nowTitle",@"(untitled)");}
s.Set(@"outcome",@"reobserve-required");
s.Set(@"nextStep",R.Cast(@"int",s.Get(@"index")));
throw R.Error((""+@"the window in front changed during this batch: it was hwnd "+R.Str(s.Get(@"baselineHwnd"))+@" when the batch started and is hwnd "+R.Str(R.Capture((o1415) => {R.Emit(o1415,R.Member(s.Get(@"live"),@"hwnd"));}))+@" ["+R.Str(R.Capture((o1416) => {R.Emit(o1416,R.Member(s.Get(@"live"),@"process"));}))+@"] """+R.Str(s.Get(@"nowTitle"))+@""" before step "+R.Str(s.Get(@"index"))+@" ('"+R.Str(s.Get(@"action"))+@"'). A dialog, a menu or a navigation appeared, so the remaining "+R.Str(R.Capture((o1417) => {R.Emit(o1417,R.Binary(s,@"Minus",R.Member(s.Get(@"steps"),@"Count"),s.Get(@"index")));}))+@" step(s) would go to this window instead of the one you meant. Nothing after step "+R.Str(R.Capture((o1418) => {R.Emit(o1418,R.Binary(s,@"Minus",s.Get(@"index"),1));}))+@" was run: observe again (computer_windows for the window list, computer_ui for the new window's controls), then continue from step "+R.Str(s.Get(@"index"))+@" -- pass expected_transitions to declare a window change this sequence is supposed to make, or stop_on_window_change: false to accept that the rest follows whatever is in front. (action_sent=false for this step; the steps listed as performed did happen)"));}}}}
foreach(var switchValue1419 in R.Array(s.Get(@"action"))){try{bool hit1420=false;if(R.SwitchMatch(s,switchValue1419,@"click")){hit1420=true;s.Set(@"r",R.Call(s,@"Do-Click",new Args(new object[]{R.Map(new object[]{@"x",R.Member(s.Get(@"step"),@"x"),@"y",R.Member(s.Get(@"step"),@"y"),@"fromFrame",R.Member(s.Get(@"step"),@"from_frame"),@"button",R.Member(s.Get(@"step"),@"button"),@"clicks",R.Member(s.Get(@"step"),@"clicks"),@"modifiers",R.Member(s.Get(@"step"),@"modifiers"),@"preferA11y",R.Member(s.Get(@"step"),@"prefer_a11y"),@"allowActivate",R.Member(s.Get(@"step"),@"allow_activate"),@"verifyContent",R.Member(s.Get(@"step"),@"verify_content"),@"allowWindows",R.Member(s.Get(@"step"),@"allow_windows")})}),null));
s.Set(@"via",@"");
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1421) => {R.Emit(o1421,R.Member(s.Get(@"r"),@"via"));}))),@"a11y"))){s.Set(@"via",@" [a11y]");}
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"click ("+R.Str(R.Capture((o1422) => {R.Emit(o1422,R.Member(s.Get(@"r"),@"x"));}))+@","+R.Str(R.Capture((o1423) => {R.Emit(o1423,R.Member(s.Get(@"r"),@"y"));}))+@") x"+R.Str(R.Capture((o1424) => {R.Emit(o1424,R.Member(s.Get(@"r"),@"clicks"));}))+@" "+R.Str(R.Capture((o1425) => {R.Emit(o1425,R.Member(s.Get(@"r"),@"button"));}))+R.Str(s.Get(@"via")))}));}if(R.SwitchMatch(s,switchValue1419,@"move")){hit1420=true;if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"dx"))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"dy")))))){s.Set(@"dx",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"dx")))){s.Set(@"dx",R.Cast(@"int",R.Member(s.Get(@"step"),@"dx")));}
s.Set(@"dy",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"dy")))){s.Set(@"dy",R.Cast(@"int",R.Member(s.Get(@"step"),@"dy")));}
s.Set(@"rel",R.Call(s,@"Do-MouseMoveRelative",new Args(new object[]{s.Get(@"dx"),s.Get(@"dy")}),null));
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"move"}),null));
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"move relative dx="+R.Str(s.Get(@"dx"))+@" dy="+R.Str(s.Get(@"dy"))+@" (observed "+R.Str(R.Capture((o1426) => {R.Emit(o1426,R.Member(R.Member(s.Get(@"rel"),@"observedDelta"),@"dx"));}))+@","+R.Str(R.Capture((o1427) => {R.Emit(o1427,R.Member(R.Member(s.Get(@"rel"),@"observedDelta"),@"dy"));}))+@")")}));}else{if(R.Bool(R.Unary(@"Not",R.Invoke(R.Type(@"string"),@"IsNullOrEmpty",new object[]{(""+R.Str(R.Capture((o1428) => {R.Emit(o1428,R.Member(s.Get(@"step"),@"from_frame"));})))})))){s.Set(@"resolved",R.Call(s,@"Resolve-FramePoint",new Args(new object[]{R.Cast(@"string",R.Member(s.Get(@"step"),@"from_frame")),R.Cast(@"int",R.Member(s.Get(@"step"),@"x")),R.Cast(@"int",R.Member(s.Get(@"step"),@"y")),R.Cast(@"ordered",R.Map(new object[]{@"allowActivate",R.Binary(s,@"Ieq",R.Member(s.Get(@"step"),@"allow_activate"),s.Get(@"true")),@"verifyContent",R.Member(s.Get(@"step"),@"verify_content"),@"allowWindows",R.Member(s.Get(@"step"),@"allow_windows")}))}),null));
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"resolved"),@"ok"),s.Get(@"true")))){throw R.Error((""+R.Str(R.Capture((o1429) => {R.Emit(o1429,R.Member(s.Get(@"resolved"),@"error"));}))));}
s.Set(@"r",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"y")),@"frame",R.Call(s,@"Get-FrameReceipt",new Args(new object[]{R.Member(s.Get(@"resolved"),@"frame"),R.Cast(@"int",R.Member(s.Get(@"step"),@"x")),R.Cast(@"int",R.Member(s.Get(@"step"),@"y")),R.Cast(@"int",R.Member(s.Get(@"resolved"),@"x")),R.Cast(@"int",R.Member(s.Get(@"resolved"),@"y")),R.Cast(@"int",R.Member(s.Get(@"resolved"),@"drift")),(""+R.Str(R.Capture((o1430) => {R.Emit(o1430,R.Member(s.Get(@"resolved"),@"note"));}))),R.Member(s.Get(@"resolved"),@"guard"),(""+R.Str(R.Capture((o1431) => {R.Emit(o1431,R.Member(s.Get(@"resolved"),@"mapping"));}))),R.Cast(@"bool",R.Member(s.Get(@"resolved"),@"activated"))}),null)})));}else{s.Set(@"r",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Member(s.Get(@"step"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"step"),@"y"))})));}
R.Emit(o,R.Call(s,@"Do-MouseMove",new Args(new object[]{R.Cast(@"int",R.Member(s.Get(@"r"),@"x")),R.Cast(@"int",R.Member(s.Get(@"r"),@"y"))}),null));
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"move ("+R.Str(R.Capture((o1432) => {R.Emit(o1432,R.Member(s.Get(@"r"),@"x"));}))+@","+R.Str(R.Capture((o1433) => {R.Emit(o1433,R.Member(s.Get(@"r"),@"y"));}))+@")")}));
R.Emit(o,R.Call(s,@"Set-WriteStamp",new Args(new object[]{new Named(@"What",R.Switch),@"move"}),null));}}if(R.SwitchMatch(s,switchValue1419,@"drag")){hit1420=true;s.Set(@"r",R.Call(s,@"Do-Drag",new Args(new object[]{R.Map(new object[]{@"fromX",R.Member(s.Get(@"step"),@"from_x"),@"fromY",R.Member(s.Get(@"step"),@"from_y"),@"toX",R.Member(s.Get(@"step"),@"to_x"),@"toY",R.Member(s.Get(@"step"),@"to_y"),@"path",R.Member(s.Get(@"step"),@"path"),@"durationMs",R.Member(s.Get(@"step"),@"duration_ms"),@"fromFrame",R.Member(s.Get(@"step"),@"from_frame"),@"modifiers",R.Member(s.Get(@"step"),@"modifiers"),@"allowActivate",R.Member(s.Get(@"step"),@"allow_activate"),@"verifyContent",R.Member(s.Get(@"step"),@"verify_content"),@"allowWindows",R.Member(s.Get(@"step"),@"allow_windows")})}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Index(s.Get(@"r"),@"path")))){R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"drag a "+R.Str(R.Capture((o1434) => {R.Emit(o1434,R.Member(R.Member(s.Get(@"r"),@"path"),@"points"));}))+@"-point path ("+R.Str(R.Capture((o1435) => {R.Emit(o1435,R.Member(R.Member(s.Get(@"r"),@"path"),@"samples"));}))+@" moves, "+R.Str(R.Capture((o1436) => {R.Emit(o1436,R.Member(R.Member(s.Get(@"r"),@"path"),@"durationMs"));}))+@" ms) ("+R.Str(R.Capture((o1437) => {R.Emit(o1437,R.Member(R.Member(s.Get(@"r"),@"from"),@"x"));}))+@","+R.Str(R.Capture((o1438) => {R.Emit(o1438,R.Member(R.Member(s.Get(@"r"),@"from"),@"y"));}))+@")->("+R.Str(R.Capture((o1439) => {R.Emit(o1439,R.Member(R.Member(s.Get(@"r"),@"to"),@"x"));}))+@","+R.Str(R.Capture((o1440) => {R.Emit(o1440,R.Member(R.Member(s.Get(@"r"),@"to"),@"y"));}))+@")")}));}else{R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"drag ("+R.Str(R.Capture((o1441) => {R.Emit(o1441,R.Member(R.Member(s.Get(@"r"),@"from"),@"x"));}))+@","+R.Str(R.Capture((o1442) => {R.Emit(o1442,R.Member(R.Member(s.Get(@"r"),@"from"),@"y"));}))+@")->("+R.Str(R.Capture((o1443) => {R.Emit(o1443,R.Member(R.Member(s.Get(@"r"),@"to"),@"x"));}))+@","+R.Str(R.Capture((o1444) => {R.Emit(o1444,R.Member(R.Member(s.Get(@"r"),@"to"),@"y"));}))+@")")}));}}if(R.SwitchMatch(s,switchValue1419,@"scroll")){hit1420=true;s.Set(@"r",R.Call(s,@"Do-Scroll",new Args(new object[]{R.Map(new object[]{@"direction",R.Member(s.Get(@"step"),@"direction"),@"clicks",R.Member(s.Get(@"step"),@"clicks"),@"x",R.Member(s.Get(@"step"),@"x"),@"y",R.Member(s.Get(@"step"),@"y"),@"fromFrame",R.Member(s.Get(@"step"),@"from_frame"),@"allowActivate",R.Member(s.Get(@"step"),@"allow_activate"),@"verifyContent",R.Member(s.Get(@"step"),@"verify_content"),@"allowWindows",R.Member(s.Get(@"step"),@"allow_windows")})}),null));
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"scroll "+R.Str(R.Capture((o1445) => {R.Emit(o1445,R.Member(s.Get(@"r"),@"direction"));}))+@" x"+R.Str(R.Capture((o1446) => {R.Emit(o1446,R.Member(s.Get(@"r"),@"clicks"));})))}));}if(R.SwitchMatch(s,switchValue1419,@"type")){hit1420=true;s.Set(@"r",R.Call(s,@"Do-Type",new Args(new object[]{R.Map(new object[]{@"text",R.Member(s.Get(@"step"),@"text"),@"delayMs",R.Member(s.Get(@"step"),@"delay_ms"),@"intoHwnd",R.Member(s.Get(@"step"),@"into_hwnd")})}),null));
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"type "+R.Str(R.Capture((o1447) => {R.Emit(o1447,R.Member(s.Get(@"r"),@"typed"));}))+@" char(s)")}));}if(R.SwitchMatch(s,switchValue1419,@"paste")){hit1420=true;s.Set(@"r",R.Call(s,@"Do-Paste",new Args(new object[]{R.Map(new object[]{@"text",R.Member(s.Get(@"step"),@"text"),@"restore",R.Member(s.Get(@"step"),@"restore"),@"requireRestore",R.Member(s.Get(@"step"),@"require_restore"),@"intoHwnd",R.Member(s.Get(@"step"),@"into_hwnd"),@"verify",R.Member(s.Get(@"step"),@"verify")})}),null));
s.Set(@"restoreWord",R.Capture((o1448) => {foreach(var switchValue1449 in R.Array((""+R.Str(R.Capture((o1451) => {R.Emit(o1451,R.Member(s.Get(@"r"),@"restoreStatus"));}))))){try{bool hit1450=false;if(R.SwitchMatch(s,switchValue1449,@"restored")){hit1450=true;R.Emit(o1448,@"the previous clipboard content is back");}if(R.SwitchMatch(s,switchValue1449,@"not_requested")){hit1450=true;R.Emit(o1448,@"the pasted text was left on the clipboard");}if(R.SwitchMatch(s,switchValue1449,@"skipped_external_change")){hit1450=true;R.Emit(o1448,@"the clipboard was NOT restored: something else wrote to it after this paste");}if(R.SwitchMatch(s,switchValue1449,@"unsupported_original_format")){hit1450=true;R.Emit(o1448,@"the previous clipboard content could not be fully restored");}if(R.SwitchMatch(s,switchValue1449,@"failed_busy")){hit1450=true;R.Emit(o1448,@"the previous clipboard content could NOT be restored (it was held open)");}if(R.SwitchMatch(s,switchValue1449,@"failed_other")){hit1450=true;R.Emit(o1448,@"the previous clipboard content could NOT be restored");}if(!hit1450){R.Emit(o1448,(""+R.Str(R.Capture((o1452) => {R.Emit(o1452,R.Member(s.Get(@"r"),@"restoreStatus"));}))));}}catch(BreakFlow){break;}catch(ContinueFlow){}}}));
s.Set(@"verifiedWord",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"r"),@"pasteVerification")))){if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1453) => {R.Emit(o1453,R.Member(R.Member(s.Get(@"r"),@"pasteVerification"),@"status"));}))),@"verified"))){s.Set(@"verifiedWord",@"; verified in the control");}else if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1454) => {R.Emit(o1454,R.Member(R.Member(s.Get(@"r"),@"pasteVerification"),@"status"));}))),@"absent"))){s.Set(@"verifiedWord",@"; NOT verified: the text is not in the control it was read back from");}else{s.Set(@"verifiedWord",@"; the paste could not be verified");}}
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"paste "+R.Str(R.Capture((o1455) => {R.Emit(o1455,R.Member(s.Get(@"r"),@"pasted"));}))+@" char(s) ("+R.Str(s.Get(@"restoreWord"))+R.Str(s.Get(@"verifiedWord"))+@")")}));}if(R.SwitchMatch(s,switchValue1419,@"key")){hit1420=true;s.Set(@"holdMs",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"hold_seconds")))){s.Set(@"holdMs",R.Cast(@"int",R.Binary(s,@"Multiply",R.Invoke(R.Type(@"Math"),@"Min",new object[]{10,R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,R.Cast(@"double",R.Member(s.Get(@"step"),@"hold_seconds"))})}),1000)));}
s.Set(@"r",R.Call(s,@"Do-Key",new Args(new object[]{R.Map(new object[]{@"keys",R.Member(s.Get(@"step"),@"keys"),@"repeat",R.Member(s.Get(@"step"),@"repeat"),@"holdMs",s.Get(@"holdMs"),@"intoHwnd",R.Member(s.Get(@"step"),@"into_hwnd")})}),null));
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"key "+R.Str(R.Capture((o1456) => {R.Emit(o1456,R.Member(s.Get(@"r"),@"keys"));}))+@" x"+R.Str(R.Capture((o1457) => {R.Emit(o1457,R.Member(s.Get(@"r"),@"repeat"));})))}));}if(R.SwitchMatch(s,switchValue1419,@"focus")){hit1420=true;if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"step"),@"hwnd")))){throw R.Error(@"a focus step needs hwnd");}
s.Set(@"r",R.Call(s,@"Do-Focus",new Args(new object[]{R.Map(new object[]{@"hwnd",R.Member(s.Get(@"step"),@"hwnd")})}),null));
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"focus hwnd="+R.Str(R.Capture((o1458) => {R.Emit(o1458,R.Member(s.Get(@"r"),@"hwnd"));}))+@" '"+R.Str(R.Capture((o1459) => {R.Emit(o1459,R.Member(s.Get(@"r"),@"title"));}))+@"'")}));}if(R.SwitchMatch(s,switchValue1419,@"clipboard")){hit1420=true;s.Set(@"op",@"get");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"op")))){s.Set(@"op",(""+R.Str(R.Capture((o1460) => {R.Emit(o1460,R.Member(s.Get(@"step"),@"op"));}))));}
s.Set(@"r",R.Call(s,@"Do-Clipboard",new Args(new object[]{R.Map(new object[]{@"op",s.Get(@"op"),@"text",R.Member(s.Get(@"step"),@"text")})}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"op"),@"get"))){s.Set(@"shown",R.Member(s.Get(@"r"),@"text"));
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"shown"),@"Length"),2000))){s.Set(@"shown",R.Invoke(s.Get(@"shown"),@"Substring",new object[]{0,2000}));}
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"clipboard get -> "+R.Str(R.Capture((o1461) => {R.Emit(o1461,R.Member(s.Get(@"shown"),@"Length"));}))+@" char(s): "+R.Str(s.Get(@"shown")))}));}else{R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"clipboard "+R.Str(s.Get(@"op"))+@" "+R.Str(R.Capture((o1462) => {R.Emit(o1462,R.Member(s.Get(@"r"),@"length"));}))+@" char(s)")}));}}if(R.SwitchMatch(s,switchValue1419,@"wait")){hit1420=true;s.Set(@"seconds",R.Cast(@"double",R.Member(s.Get(@"step"),@"seconds")));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"seconds"),0))){s.Set(@"seconds",0);}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"seconds"),30))){s.Set(@"seconds",30);}
s.Set(@"wanted",R.Cast(@"int",R.Binary(s,@"Multiply",s.Get(@"seconds"),1000)));
s.Set(@"left",R.Call(s,@"Get-BatchRemainingMs",new Args(new object[]{}),null));
s.Set(@"spent",s.Get(@"wanted"));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"left"),R.Member(R.Type(@"int"),@"MaxValue"))) && R.Bool(R.Binary(s,@"Ilt",s.Get(@"left"),s.Get(@"wanted")))))){s.Set(@"spent",R.Cast(@"int",s.Get(@"left")));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"spent"),0))){R.Emit(o,R.Call(s,@"Wait-Cancellable",new Args(new object[]{s.Get(@"spent")}),null));
R.Emit(o,R.Cast(@"void",R.Call(s,@"Advance-ObservationEpoch",new Args(new object[]{}),null)));}
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"spent"),s.Get(@"wanted")))){R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"wait "+R.Str(R.Capture((o1463) => {R.Emit(o1463,R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Binary(s,@"Divide",s.Get(@"spent"),1000d),2}));}))+@"s of the "+R.Str(R.Capture((o1464) => {R.Emit(o1464,R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"seconds"),2}));}))+@"s asked for (this call's deadline is closer)")}));
s.Set(@"outcome",@"deadline-partial");
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"nextStep"),0))){s.Set(@"nextStep",R.Cast(@"int",s.Get(@"index")));}}else{R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"wait "+R.Str(R.Capture((o1465) => {R.Emit(o1465,R.Invoke(R.Type(@"Math"),@"Round",new object[]{s.Get(@"seconds"),2}));}))+@"s")}));}}if(R.SwitchMatch(s,switchValue1419,@"wait_for")){hit1420=true;s.Set(@"waitSpec",s.Get(@"step"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"waitSpec"),@"condition")))){s.Set(@"waitSpec",R.Map(new object[]{@"condition",s.Get(@"step"),@"timeout_ms",R.Member(s.Get(@"step"),@"timeout_ms")}));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"deadlineAtMs"),0))){if(R.Bool(R.Binary(s,@"Is",s.Get(@"waitSpec"),R.Type(@"hashtable")))){R.SetIndex(s.Get(@"waitSpec"),@"deadlineAtMs",s.Get(@"deadlineAtMs"));}else{s.Set(@"waitSpec",R.Map(new object[]{@"condition",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"waitSpec"),@"condition"}),null),@"timeout_ms",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"waitSpec"),@"timeout_ms"}),null),@"poll_ms",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"waitSpec"),@"poll_ms"}),null),@"deadlineAtMs",s.Get(@"deadlineAtMs")}));}}
s.Set(@"r",R.Call(s,@"Wait-ForCondition",new Args(new object[]{s.Get(@"waitSpec")}),null));
s.Set(@"line",(""+@"wait_for "+R.Str(R.Capture((o1466) => {R.Emit(o1466,R.Member(s.Get(@"r"),@"what"));}))+@" -> "+R.Str(R.Capture((o1467) => {if(R.Bool(R.Member(s.Get(@"r"),@"satisfied"))){R.Emit(o1467,@"satisfied");}else{R.Emit(o1467,@"not satisfied");}}))+@" after "+R.Str(R.Capture((o1468) => {R.Emit(o1468,R.Member(s.Get(@"r"),@"waitedMs"));}))+@" ms in "+R.Str(R.Capture((o1469) => {R.Emit(o1469,R.Member(s.Get(@"r"),@"polls"));}))+@" check(s)"));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"r"),@"satisfied")))){s.Set(@"line",(""+R.Str(s.Get(@"line"))+@"; the condition was never true inside the budget"));}
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{s.Get(@"line")}));
R.Emit(o,R.Invoke(s.Get(@"waitReports"),@"Add",new object[]{s.Get(@"r")}));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"r"),@"satisfied")))){s.Set(@"onTimeout",@"stop");
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1470) => {R.Emit(o1470,R.Member(s.Get(@"step"),@"on_timeout"));}))),@""))){s.Set(@"onTimeout",R.Invoke((""+R.Str(R.Capture((o1471) => {R.Emit(o1471,R.Member(s.Get(@"step"),@"on_timeout"));}))),@"ToLowerInvariant",new object[]{}));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"onTimeout"),@"continue"))){R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{@"continuing past the wait_for step because on_timeout is 'continue'"}));}else{s.Set(@"observedStatus",(""+R.Str(R.Capture((o1472) => {R.Emit(o1472,R.Member(s.Get(@"r"),@"status"));}))));
s.Set(@"outcome",@"condition-timeout");
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"observedStatus"),@"unknown"))){s.Set(@"outcome",@"condition-unobservable");}
s.Set(@"nextStep",R.Cast(@"int",s.Get(@"index")));
s.Set(@"how",(""+@"the condition was not satisfied: "+R.Str(R.Capture((o1473) => {R.Emit(o1473,R.Member(s.Get(@"r"),@"what"));}))+@" -- "+R.Str(R.Capture((o1474) => {R.Emit(o1474,R.Member(s.Get(@"r"),@"observed"));}))));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"observedStatus"),@"unknown"))){s.Set(@"how",(""+@"the condition could not be observed at all: "+R.Str(R.Capture((o1475) => {R.Emit(o1475,R.Member(s.Get(@"r"),@"what"));}))+@" -- "+R.Str(R.Capture((o1476) => {R.Emit(o1476,R.Member(s.Get(@"r"),@"observed"));}))));}
throw R.Error((""+@"[CONDITION_TIMEOUT] step "+R.Str(s.Get(@"index"))+@" ('wait_for') stopped this batch: "+R.Str(s.Get(@"how"))+@" ("+R.Str(R.Capture((o1477) => {R.Emit(o1477,R.Member(s.Get(@"r"),@"polls"));}))+@" check(s) over "+R.Str(R.Capture((o1478) => {R.Emit(o1478,R.Member(s.Get(@"r"),@"waitedMs"));}))+@" ms of a "+R.Str(R.Capture((o1479) => {R.Emit(o1479,R.Member(s.Get(@"r"),@"timeoutMs"));}))+@" ms budget). Nothing after step "+R.Str(s.Get(@"index"))+@" was run -- the steps before it did run, and the steps after it were the ones that would have needed this condition to hold. Decide whether to wait longer (raise timeout_ms), look at the window yourself (computer_ui or computer_screenshot), or continue deliberately by putting on_timeout: 'continue' on this step. (action_sent=false for this step; the steps listed as performed did happen)"));}}}if(R.SwitchMatch(s,switchValue1419,@"screenshot")){hit1420=true;R.Emit(o,R.Call(s,@"Settle-Before-Capture",new Args(new object[]{}),null));
s.Set(@"shotArgs",R.Call(s,@"New-CaptureArgs",new Args(new object[]{s.Get(@"captureBase"),s.Get(@"step")}),null));
if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{(""+R.Str(R.Capture((o1480) => {R.Emit(o1480,R.Member(s.Get(@"shotArgs"),@"path"));})))}))){throw R.Error(@"a screenshot step needs a path");}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"evidenceRect"))) && R.Bool(R.Binary(s,@"Igt",s.Get(@"index"),s.Get(@"lastWriteIndex")))))){R.SetMember(s.Get(@"shotArgs"),@"evidenceRect",s.Get(@"evidenceRect"));}
s.Set(@"shot",R.Call(s,@"Do-Screenshot",new Args(new object[]{s.Get(@"shotArgs")}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"shot"),@"evidenceDigest"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1481) => {R.Emit(o1481,R.Member(s.Get(@"shot"),@"evidenceDigest"));}))),@""))))){s.Set(@"evidenceDigest",(""+R.Str(R.Capture((o1482) => {R.Emit(o1482,R.Member(s.Get(@"shot"),@"evidenceDigest"));}))));}
s.Set(@"stepCapture",R.Call(s,@"Get-CaptureStampInfo",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"stepCapture")))){s.Set(@"usefulCapture",R.Cast(@"ordered",R.Map(new object[]{@"shot",s.Get(@"shot"),@"capture",s.Get(@"stepCapture"),@"spec",s.Get(@"shotArgs"),@"stepIndex",R.Cast(@"int",s.Get(@"index"))})));}
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{(""+@"screenshot "+R.Str(R.Capture((o1483) => {R.Emit(o1483,R.Member(s.Get(@"shot"),@"width"));}))+@"x"+R.Str(R.Capture((o1484) => {R.Emit(o1484,R.Member(s.Get(@"shot"),@"height"));}))+@"@"+R.Str(R.Capture((o1485) => {R.Emit(o1485,R.Member(s.Get(@"shot"),@"scale"));})))}));}if(R.SwitchMatch(s,switchValue1419,new Fn(s,Block_1486))){hit1420=true;s.Set(@"r",R.Call(s,@"Invoke-UiaStep",new Args(new object[]{s.Get(@"step")}),null));
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1487) => {R.Emit(o1487,R.Member(s.Get(@"r"),@"canceled"));}))),@"True"))){throw R.Error((""+R.Str(R.Capture((o1488) => {R.Emit(o1488,R.Member(s.Get(@"r"),@"error"));}))));}
R.Emit(o,R.Invoke(s.Get(@"performed"),@"Add",new object[]{R.Call(s,@"Get-UiaStepLine",new Args(new object[]{s.Get(@"action"),s.Get(@"r")}),null)}));}if(!hit1420){throw R.Error((""+@"unknown step action '"+R.Str(s.Get(@"action"))+@"'; known actions: "+R.Str(R.Capture((o1489) => {R.Emit(o1489,R.Binary(s,@"Join",s.Get(@"STEP_ACTIONS"),@", "));}))));}}catch(BreakFlow){break;}catch(ContinueFlow){}}}catch(Exception error1490) when (!(error1490 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1490}));s.Set(@"phrase",R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));
s.Set(@"cancelled",R.Invoke(s.Get(@"phrase"),@"StartsWith",new object[]{@"[CANCELED]",R.Member(R.Type(@"System.StringComparison"),@"Ordinal")}));
s.Set(@"outOfTime",R.Invoke(s.Get(@"phrase"),@"StartsWith",new object[]{@"[DEADLINE_EXHAUSTED]",R.Member(R.Type(@"System.StringComparison"),@"Ordinal")}));
s.Set(@"partialSend",R.Invoke(s.Get(@"phrase"),@"StartsWith",new object[]{@"[PARTIAL_INPUT]",R.Member(R.Type(@"System.StringComparison"),@"Ordinal")}));
s.Set(@"evidence",R.Call(s,@"Complete-Evidence",new Args(new object[]{}),null));
if(R.Bool((R.Bool((R.Bool(s.Get(@"wantedShot")) && R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"defaultPath")})))) && R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"screenshot"),s.Get(@"true")))))){throw R.Error(@"a trailing screenshot needs a path");}
if(R.Bool((R.Bool((R.Bool(s.Get(@"wantedShot")) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"shot"))))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"usefulCapture")))))){s.Set(@"fresher",R.Call(s,@"Test-CaptureReusable",new Args(new object[]{R.Member(s.Get(@"usefulCapture"),@"capture")}),null));
s.Set(@"shot",R.Member(s.Get(@"usefulCapture"),@"shot"));
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"stepIndex",R.Cast(@"int",R.Member(s.Get(@"usefulCapture"),@"stepIndex"))}),null));
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"afterLastWrite",s.Get(@"fresher")}),null));
if(R.Bool(R.Unary(@"Not",s.Get(@"fresher")))){R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"note",(""+@"this frame is from before the step that failed (step "+R.Str(R.Capture((o1491) => {R.Emit(o1491,R.Member(s.Get(@"usefulCapture"),@"stepIndex"));}))+@"), so it shows the state the batch started from")}),null));}}else if(R.Bool((R.Bool((R.Bool(s.Get(@"wantedShot")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"shot"))))) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"shot"),@"afterLastWrite")))))){R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"afterLastWrite",s.Get(@"false")}),null));}
if(R.Bool(s.Get(@"cancelled"))){s.Set(@"outcome",@"cancelled");}else if(R.Bool(s.Get(@"outOfTime"))){s.Set(@"outcome",@"deadline");}else if(R.Bool(s.Get(@"partialSend"))){s.Set(@"outcome",@"partial");}else if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"outcome"),@"ok"))){s.Set(@"outcome",@"step-failed");}
s.Set(@"stepState",@"not-sent");
if(R.Bool(s.Get(@"outOfTime"))){s.Set(@"stepState",@"not-run");}else if(R.Bool(s.Get(@"partialSend"))){s.Set(@"stepState",@"partial");}else if(R.Bool(R.Binary(s,@"Imatch",s.Get(@"phrase"),@"action_sent=true"))){s.Set(@"stepState",@"dispatched");}
s.Set(@"progress",R.Array(R.Capture((o1492) => {R.Emit(o1492,R.Call(s,@"New-BatchProgress",new Args(new object[]{s.Get(@"steps"),s.Get(@"index"),s.Get(@"stepState")}),null));})));
s.Set(@"failure",R.Cast(@"ordered",R.Map(new object[]{@"performed",R.Array(R.Capture((o1493) => {R.Emit(o1493,R.Invoke(s.Get(@"performed"),@"ToArray",new object[]{}));})),@"count",R.Member(s.Get(@"performed"),@"Count"),@"failedAt",s.Get(@"index"),@"error",s.Get(@"phrase"),@"canceled",s.Get(@"cancelled"),@"outOfBudget",s.Get(@"outOfTime"),@"partial",s.Get(@"partialSend"),@"progress",R.Array(R.Capture((o1494) => {R.Emit(o1494,s.Get(@"progress"));})),@"partialSteps",R.Array(R.Capture((o1495) => {R.Emit(o1495,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1498)}),R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_1496)}),s.Get(@"progress"))));})),@"elapsedMs",R.Cast(@"int",R.Member(s.Get(@"stopwatch"),@"ElapsedMilliseconds")),@"outcome",(""+R.Str(s.Get(@"outcome"))),@"action_sent",R.Binary(s,@"Igt",R.Member(s.Get(@"wroteSteps"),@"Count"),0),@"wroteSteps",R.Array(R.Capture((o1499) => {R.Emit(o1499,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1500)}),R.Invoke(s.Get(@"wroteSteps"),@"ToArray",new object[]{})));})),@"shot",s.Get(@"shot"),@"evidence",s.Get(@"evidence"),@"state",s.Get(@"null"),@"waits",R.Array(R.Capture((o1501) => {R.Emit(o1501,R.Invoke(s.Get(@"waitReports"),@"ToArray",new object[]{}));}))})));
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"nextStep"),0))){R.SetIndex(s.Get(@"failure"),@"nextStep",R.Cast(@"int",s.Get(@"nextStep")));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"deadlineMs"),0))){s.Set(@"over",R.Binary(s,@"Minus",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),R.Cast(@"int64",s.Get(@"deadlineAtMs"))));
R.SetIndex(s.Get(@"failure"),@"deadlineMs",R.Cast(@"int",s.Get(@"deadlineMs")));
R.SetIndex(s.Get(@"failure"),@"overDeadlineMs",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,s.Get(@"over")})));
R.SetIndex(s.Get(@"failure"),@"deadlineMet",R.Binary(s,@"Ile",s.Get(@"over"),0));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"transitions"),@"Count"),0))){R.SetIndex(s.Get(@"failure"),@"transitions",R.Array(R.Capture((o1502) => {R.Emit(o1502,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1503)}),s.Get(@"transitions")));})));}
throw new ReturnFlow(s.Get(@"failure"));}
if(R.Bool(R.Binary(s,@"Icontains",s.Get(@"WRITE_STEP_ACTIONS"),s.Get(@"action")))){R.Emit(o,R.Invoke(s.Get(@"wroteSteps"),@"Add",new object[]{R.Cast(@"int",s.Get(@"index"))}));}
if(R.Bool(s.Get(@"guardWindows"))){if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"into_hwnd")))){s.Set(@"baselineHwnd",R.Cast(@"int64",R.Member(s.Get(@"step"),@"into_hwnd")));}else if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"action"),@"focus")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"hwnd")))))){s.Set(@"baselineHwnd",R.Cast(@"int64",R.Member(s.Get(@"step"),@"hwnd")));}else if(R.Bool((R.Bool(R.Binary(s,@"Icontains",s.Get(@"UIA_STEP_ACTIONS"),s.Get(@"action"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"step"),@"hwnd")))))){s.Set(@"baselineHwnd",R.Cast(@"int64",R.Member(s.Get(@"step"),@"hwnd")));}}
s.Set(@"index",R.Binary(s,@"Plus",s.Get(@"index"),1));}catch(ContinueFlow){}catch(BreakFlow){break;}}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"waitFor")))){R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{@"before the batch-level condition wait"}),null));
s.Set(@"batchWait",R.Member(s.Get(@"Arg"),@"waitFor"));
s.Set(@"waitSpec",R.Map(new object[]{}));
if(R.Bool(R.Binary(s,@"Is",s.Get(@"batchWait"),R.Type(@"System.Collections.IDictionary")))){foreach(var item1504 in R.Array(R.Member(s.Get(@"batchWait"),@"Keys"))){s.Set(@"key",item1504);try{R.SetIndex(s.Get(@"waitSpec"),s.Get(@"key"),R.Index(s.Get(@"batchWait"),s.Get(@"key")));}catch(ContinueFlow){}catch(BreakFlow){break;}}}else{foreach(var item1505 in R.Array(R.Member(R.Member(s.Get(@"batchWait"),@"PSObject"),@"Properties"))){s.Set(@"property",item1505);try{R.SetIndex(s.Get(@"waitSpec"),R.Member(s.Get(@"property"),@"Name"),R.Member(s.Get(@"property"),@"Value"));}catch(ContinueFlow){}catch(BreakFlow){break;}}}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"deadlineAtMs"),0))){R.SetIndex(s.Get(@"waitSpec"),@"deadlineAtMs",s.Get(@"deadlineAtMs"));}
s.Set(@"batchReport",R.Call(s,@"Wait-ForCondition",new Args(new object[]{s.Get(@"waitSpec")}),null));
R.Emit(o,R.Invoke(s.Get(@"waitReports"),@"Add",new object[]{s.Get(@"batchReport")}));
if(R.Bool((R.Bool(R.Unary(@"Not",R.Member(s.Get(@"batchReport"),@"satisfied"))) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"outcome"),@"ok"))))){s.Set(@"outcome",@"condition-timeout");
if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1506) => {R.Emit(o1506,R.Member(s.Get(@"batchReport"),@"status"));}))),@"unknown"))){s.Set(@"outcome",@"condition-unobservable");}}}
s.Set(@"shotReuse",@"");
s.Set(@"wantedShot",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"screenshot"),s.Get(@"true")));
s.Set(@"observation",s.Get(@"null"));
s.Set(@"trailingArgs",R.Call(s,@"New-CaptureArgs",new Args(new object[]{s.Get(@"captureBase")}),null));
if(R.Bool((R.Bool(s.Get(@"wantedShot")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"usefulCapture")))))){s.Set(@"sameRequest",R.Call(s,@"Test-SameCaptureSpec",new Args(new object[]{R.Member(s.Get(@"usefulCapture"),@"spec"),s.Get(@"trailingArgs")}),null));
if(R.Bool((R.Bool(s.Get(@"sameRequest")) && R.Bool(R.Call(s,@"Test-CaptureReusable",new Args(new object[]{R.Member(s.Get(@"usefulCapture"),@"capture")}),null))))){s.Set(@"shotReuse",@"step");
s.Set(@"shot",R.Member(s.Get(@"usefulCapture"),@"shot"));
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"stepIndex",R.Cast(@"int",R.Member(s.Get(@"usefulCapture"),@"stepIndex"))}),null));
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"afterLastWrite",s.Get(@"true")}),null));}else if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"defaultPath")}))){s.Set(@"shotReuse",@"step-stale");
s.Set(@"shot",R.Member(s.Get(@"usefulCapture"),@"shot"));
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"afterLastWrite",s.Get(@"false")}),null));
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"stepIndex",R.Cast(@"int",R.Member(s.Get(@"usefulCapture"),@"stepIndex"))}),null));
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"note",@"the only capture this call took came before its last write, so this frame shows the state before the steps finished; pass screenshot: true with a save_path (or add a screenshot step) to get a frame of the state after them"}),null));}else{s.Set(@"shotReuse",@"retaken");}}
if(R.Bool((R.Bool((R.Bool(s.Get(@"wantedShot")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"shotReuse"),@"step")))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"shotReuse"),@"step-stale"))))){if(R.Bool(R.Invoke(R.Type(@"string"),@"IsNullOrWhiteSpace",new object[]{s.Get(@"defaultPath")}))){throw R.Error(@"a trailing screenshot needs a path");}
R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{@"before the trailing screenshot"}),null));
R.Emit(o,R.Call(s,@"Settle-Before-Capture",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"evidenceRect")))){R.SetMember(s.Get(@"trailingArgs"),@"evidenceRect",s.Get(@"evidenceRect"));}
try{s.Set(@"shot",R.Call(s,@"Do-Screenshot",new Args(new object[]{s.Get(@"trailingArgs")}),null));}catch(Exception error1507) when (!(error1507 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1507}));s.Set(@"shot",s.Get(@"null"));
s.Set(@"shotReuse",@"");
s.Set(@"observation",R.Cast(@"ordered",R.Map(new object[]{@"failed",s.Get(@"true"),@"what",@"capture",@"error",(""+R.Str(R.Capture((o1508) => {R.Emit(o1508,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))),@"note",@"the steps in this call did run; it is the capture at the end that failed, so take it yourself with computer_screenshot and read the window again"})));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"shot")))){if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"shot"),@"evidenceDigest"))) && R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1509) => {R.Emit(o1509,R.Member(s.Get(@"shot"),@"evidenceDigest"));}))),@""))))){s.Set(@"evidenceDigest",(""+R.Str(R.Capture((o1510) => {R.Emit(o1510,R.Member(s.Get(@"shot"),@"evidenceDigest"));}))));}
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"afterLastWrite",s.Get(@"true")}),null));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"shotReuse"),@"retaken"))){R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"note",@"a screenshot step earlier in this batch had already produced a frame, but a write came after it, so this capture was taken to return the state after the last step rather than a picture of the state before it"}),null));}}}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"shot"))) && R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"shot"),@"afterLastWrite")))))){s.Set(@"fresh",s.Get(@"true"));
s.Set(@"liveStamp",R.Call(s,@"Get-CaptureStampInfo",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"liveStamp")))){s.Set(@"fresh",R.Call(s,@"Test-CaptureAfterWrite",new Args(new object[]{s.Get(@"liveStamp")}),null));}
R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"afterLastWrite",s.Get(@"fresh")}),null));
if(R.Bool(R.Unary(@"Not",s.Get(@"fresh")))){R.Emit(o,R.Call(s,@"Set-PayloadField",new Args(new object[]{s.Get(@"shot"),@"note",@"this frame was taken before the last write in this call, so it shows the state before the steps finished"}),null));}}
s.Set(@"evidence",R.Call(s,@"Complete-Evidence",new Args(new object[]{}),null));
s.Set(@"state",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"state")))){R.Emit(o,R.Call(s,@"Assert-NotCancelled",new Args(new object[]{@"before the trailing accessibility read"}),null));
s.Set(@"s",R.Member(s.Get(@"Arg"),@"state"));
try{s.Set(@"state",R.Call(s,@"Do-UiTree",new Args(new object[]{R.Map(new object[]{@"hwnd",R.Member(s.Get(@"s"),@"hwnd"),@"filter",R.Member(s.Get(@"s"),@"filter"),@"name",R.Member(s.Get(@"s"),@"name"),@"controlType",R.Member(s.Get(@"s"),@"control_type"),@"automationId",R.Member(s.Get(@"s"),@"automation_id"),@"patterns",R.Member(s.Get(@"s"),@"patterns"),@"maxDepth",R.Member(s.Get(@"s"),@"max_depth"),@"maxNodes",R.Member(s.Get(@"s"),@"max_nodes"),@"prune",R.Member(s.Get(@"s"),@"prune"),@"since",R.Member(s.Get(@"s"),@"since"),@"settleMs",s.Get(@"settleMs"),@"text",R.Member(s.Get(@"s"),@"text"),@"textTarget",R.Member(s.Get(@"s"),@"text_target"),@"maxTextChars",R.Member(s.Get(@"s"),@"max_text_chars"),@"maxSelected",R.Member(s.Get(@"s"),@"max_selected")})}),null));}catch(Exception error1511) when (!(error1511 is Flow)){s.Set("_",R.Map(new object[]{"Exception",error1511}));s.Set(@"observation",R.Cast(@"ordered",R.Map(new object[]{@"failed",s.Get(@"true"),@"what",@"state",@"error",(""+R.Str(R.Capture((o1512) => {R.Emit(o1512,R.Member(R.Member(s.Get(@"_"),@"Exception"),@"Message"));}))),@"note",@"the steps in this call did run; it is the read at the end that failed, so read that window again before deciding anything else"})));}}
s.Set(@"reply",R.Cast(@"ordered",R.Map(new object[]{@"performed",R.Array(R.Capture((o1513) => {R.Emit(o1513,R.Invoke(s.Get(@"performed"),@"ToArray",new object[]{}));})),@"count",R.Member(s.Get(@"performed"),@"Count"),@"failedAt",-1,@"error",@"",@"canceled",s.Get(@"false"),@"elapsedMs",R.Cast(@"int",R.Member(s.Get(@"stopwatch"),@"ElapsedMilliseconds")),@"outcome",(""+R.Str(s.Get(@"outcome"))),@"action_sent",R.Binary(s,@"Igt",R.Member(s.Get(@"wroteSteps"),@"Count"),0),@"wroteSteps",R.Array(R.Capture((o1514) => {R.Emit(o1514,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1515)}),R.Invoke(s.Get(@"wroteSteps"),@"ToArray",new object[]{})));})),@"shot",s.Get(@"shot"),@"evidence",s.Get(@"evidence"),@"state",s.Get(@"state"),@"progress",R.Array(R.Capture((o1516) => {R.Emit(o1516,R.Call(s,@"New-BatchProgress",new Args(new object[]{s.Get(@"steps"),@"-1",@""}),null));})),@"partialSteps",R.Array(R.Capture((o1517) => {}))})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"observation")))){R.SetIndex(s.Get(@"reply"),@"observation",s.Get(@"observation"));}
if(R.Bool(R.Binary(s,@"Ige",s.Get(@"nextStep"),0))){R.SetIndex(s.Get(@"reply"),@"nextStep",R.Cast(@"int",s.Get(@"nextStep")));}
if(R.Bool(R.Binary(s,@"Igt",s.Get(@"deadlineMs"),0))){s.Set(@"over",R.Binary(s,@"Minus",R.Cast(@"int64",R.Member(s.Get(@"script:Clock"),@"ElapsedMilliseconds")),R.Cast(@"int64",s.Get(@"deadlineAtMs"))));
R.SetIndex(s.Get(@"reply"),@"deadlineMs",R.Cast(@"int",s.Get(@"deadlineMs")));
R.SetIndex(s.Get(@"reply"),@"overDeadlineMs",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Max",new object[]{0,s.Get(@"over")})));
R.SetIndex(s.Get(@"reply"),@"deadlineMet",R.Binary(s,@"Ile",s.Get(@"over"),0));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"transitions"),@"Count"),0))){R.SetIndex(s.Get(@"reply"),@"transitions",R.Array(R.Capture((o1518) => {R.Emit(o1518,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1519)}),s.Get(@"transitions")));})));}
if(R.Bool(R.Binary(s,@"Igt",R.Member(s.Get(@"waitReports"),@"Count"),0))){R.SetIndex(s.Get(@"reply"),@"waits",R.Array(R.Capture((o1520) => {R.Emit(o1520,R.Call(s,@"ForEach-Object",new Args(new object[]{new Fn(s,Block_1521)}),s.Get(@"waitReports")));})));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"shotReuse"),@""))){s.Set(@"captureUsed",R.Cast(@"ordered",R.Map(new object[]{@"from",(""+R.Str(s.Get(@"shotReuse"))),@"stepIndex",R.Cast(@"int",s.Get(@"frameStepIndex")),@"afterLastWrite",s.Get(@"true")})));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"shot"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"shot"),@"afterLastWrite")))))){R.SetIndex(s.Get(@"captureUsed"),@"afterLastWrite",R.Cast(@"bool",R.Member(s.Get(@"shot"),@"afterLastWrite")));}
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"shot"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"shot"),@"stepIndex")))))){R.SetIndex(s.Get(@"captureUsed"),@"stepIndex",R.Cast(@"int",R.Member(s.Get(@"shot"),@"stepIndex")));}
R.SetIndex(s.Get(@"captureUsed"),@"note",R.Capture((o1522) => {foreach(var switchValue1523 in R.Array(s.Get(@"shotReuse"))){try{bool hit1524=false;if(R.SwitchMatch(s,switchValue1523,@"step")){hit1524=true;R.Emit(o1522,@"returned the frame a screenshot step in this batch already took, because it is newer than the last write; no second capture was taken");}if(R.SwitchMatch(s,switchValue1523,@"step-stale")){hit1524=true;R.Emit(o1522,@"returned the frame a screenshot step took, although it predates the last write, because this call has no path to write a new one to");}if(R.SwitchMatch(s,switchValue1523,@"retaken")){hit1524=true;R.Emit(o1522,@"a screenshot step earlier in the batch had already taken a frame, but a write came after it, so a fresh capture was taken to return the state after the last step");}if(!hit1524){R.Emit(o1522,@"");}}catch(BreakFlow){break;}catch(ContinueFlow){}}}));
R.SetIndex(s.Get(@"reply"),@"captureUsed",s.Get(@"captureUsed"));}
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"env:DSH_COMPUTER_USE_DEBUG"),@"1"))){s.Set(@"facts",R.Cast(@"ordered",R.Map(new object[]{@"writeSeq",R.Cast(@"int64",s.Get(@"script:WriteSeq")),@"shotReuse",(""+R.Str(s.Get(@"shotReuse"))),@"shotStepIndex",R.Cast(@"int",s.Get(@"frameStepIndex")),@"afterLastWrite",R.Capture((o1525) => {if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"shot"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"shot"),@"afterLastWrite")))))){R.Emit(o1525,(""+R.Str(R.Capture((o1526) => {R.Emit(o1526,R.Member(s.Get(@"shot"),@"afterLastWrite"));}))));}else{R.Emit(o1525,@"n/a");}})})));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"shot")))){s.Set(@"live",R.Call(s,@"Get-CaptureStampInfo",new Args(new object[]{}),null));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"live")))){R.SetMember(s.Get(@"facts"),@"shotAgeMs",R.Cast(@"int",R.Member(s.Get(@"live"),@"ageMs")));
R.SetMember(s.Get(@"facts"),@"shotWriteSeq",R.Cast(@"int64",R.Member(s.Get(@"live"),@"writeSeq")));}}
R.SetMember(s.Get(@"facts"),@"writeStamp",R.Call(s,@"Get-WriteStampInfo",new Args(new object[]{}),null));
if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"usefulCapture"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"usefulCapture"),@"capture")))))){R.SetMember(s.Get(@"facts"),@"stepCaptureSeq",R.Cast(@"int",R.Member(R.Member(s.Get(@"usefulCapture"),@"capture"),@"seq")));
R.SetMember(s.Get(@"facts"),@"stepCaptureWriteSeq",R.Cast(@"int64",R.Member(R.Member(s.Get(@"usefulCapture"),@"capture"),@"writeSeq")));
R.SetMember(s.Get(@"facts"),@"stepCaptureAtMs",R.Cast(@"int64",R.Member(R.Member(s.Get(@"usefulCapture"),@"capture"),@"atMs")));}
R.SetIndex(s.Get(@"reply"),@"debug",s.Get(@"facts"));}
R.Emit(o,R.Call(s,@"Clear-Deadline",new Args(new object[]{}),null));
throw new ReturnFlow(s.Get(@"reply"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1542(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1543) => {R.Emit(o1543,R.Index(s.Get(@"_"),@"automationId"));}))),R.Member(s.Get(@"entry"),@"automationId")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1545(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1546) => {R.Emit(o1546,R.Index(s.Get(@"_"),@"controlType"));}))),R.Member(s.Get(@"entry"),@"controlType"))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1547) => {R.Emit(o1547,R.Index(s.Get(@"_"),@"name"));}))),R.Member(s.Get(@"entry"),@"name")))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1549(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1550) => {R.Emit(o1550,R.Index(s.Get(@"_"),@"controlType"));}))),R.Member(s.Get(@"entry"),@"controlType"))) && R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1551) => {R.Emit(o1551,R.Index(s.Get(@"_"),@"className"));}))),R.Member(s.Get(@"entry"),@"className")))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1558(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1559) => {R.Emit(o1559,R.Index(s.Get(@"_"),@"automationId"));}))),R.Member(s.Get(@"selector"),@"automationId")));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1566(Scope s,Args a){var o=new List<object>();
try{R.Emit(o,(R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1567) => {R.Emit(o1567,R.Index(s.Get(@"_"),@"controlType"));}))),R.Member(s.Get(@"selector"),@"controlType"))) && R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1568) => {R.Emit(o1568,R.Member(s.Get(@"selector"),@"className"));}))),@"")) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1569) => {R.Emit(o1569,R.Index(s.Get(@"_"),@"className"));}))),R.Member(s.Get(@"selector"),@"className"))))))) && R.Bool((R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1570) => {R.Emit(o1570,R.Member(s.Get(@"selector"),@"name"));}))),@"")) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1571) => {R.Emit(o1571,R.Index(s.Get(@"_"),@"name"));}))),R.Member(s.Get(@"selector"),@"name")))))));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Resolve_ElementRef_1527(Scope s,Args a){var o=new List<object>();s.Set(@"ref",R.Bind(a,0,@"ref",()=>null,@"string"));
try{s.Set(@"entry",R.Index(s.Get(@"script:ElementRegistry"),s.Get(@"ref")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"entry")))){s.Set(@"number",0);
s.Set(@"generation",@"");
s.Set(@"parsed",s.Get(@"false"));
s.Set(@"legacy",s.Get(@"false"));
if(R.Bool(R.Binary(s,@"Imatch",s.Get(@"ref"),@"^s([0-9a-z]{4})(\d+)\."))){s.Set(@"generation",(""+R.Str(R.Capture((o1528) => {R.Emit(o1528,R.Index(s.Get(@"Matches"),1));}))));
s.Set(@"number",R.Cast(@"int",R.Index(s.Get(@"Matches"),2)));
s.Set(@"parsed",s.Get(@"true"));}else if(R.Bool(R.Binary(s,@"Imatch",s.Get(@"ref"),@"^s(\d+)\."))){s.Set(@"number",R.Cast(@"int",R.Index(s.Get(@"Matches"),1)));
s.Set(@"legacy",s.Get(@"true"));}
s.Set(@"cause",@"not in this registry");
if(R.Bool((R.Bool(R.Unary(@"Not",s.Get(@"parsed"))) && R.Bool(R.Unary(@"Not",s.Get(@"legacy")))))){s.Set(@"cause",@"malformed");}else if(R.Bool((R.Bool(s.Get(@"parsed")) && R.Bool(R.Binary(s,@"Ine",s.Get(@"generation"),s.Get(@"script:BootGen")))))){s.Set(@"cause",(""+@"minted by a previous worker generation ("+R.Str(s.Get(@"generation"))+@"; this worker is "+R.Str(R.Capture((o1529) => {R.Emit(o1529,s.Get(@"script:BootGen"));}))+@") -- the per-worker counter restarts at 1, so this ref could otherwise hit an unrelated element that now sits in the same slot"));}else if(R.Bool(R.Binary(s,@"Igt",s.Get(@"number"),s.Get(@"script:SnapshotSeq")))){s.Set(@"cause",@"never issued in this session");}else if(R.Bool(s.Get(@"legacy"))){s.Set(@"cause",@"minted by an older worker build, before refs carried a worker generation");}else if(R.Bool(R.Binary(s,@"Ile",s.Get(@"number"),R.Binary(s,@"Minus",s.Get(@"script:SnapshotSeq"),s.Get(@"script:SnapshotKeep"))))){s.Set(@"cause",@"retired when older observations were pruned");}
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[STALE_REF] ref '"+R.Str(s.Get(@"ref"))+@"' ("+R.Str(s.Get(@"cause"))+@"). This does not mean the element disappeared. Read the tree again with computer_ui and use a ref from that fresh read. (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)")}));}
s.Set(@"live",R.Call(s,@"Get-WindowInfoForHwnd",new Args(new object[]{R.Cast(@"IntPtr",R.Cast(@"int64",R.Member(s.Get(@"entry"),@"hwnd")))}),null));
if(R.Bool((R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"live"))) && R.Bool(R.Binary(s,@"Igt",R.Cast(@"int",R.Member(s.Get(@"entry"),@"pid")),0)))) && R.Bool(R.Binary(s,@"Ine",R.Cast(@"int",R.Member(s.Get(@"live"),@"pid")),R.Cast(@"int",R.Member(s.Get(@"entry"),@"pid"))))))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[TARGET_CHANGED] hwnd "+R.Str(R.Capture((o1530) => {R.Emit(o1530,R.Member(s.Get(@"entry"),@"hwnd"));}))+@" belonged to pid "+R.Str(R.Capture((o1531) => {R.Emit(o1531,R.Member(s.Get(@"entry"),@"pid"));}))+@" when the ref was read and belongs to pid "+R.Str(R.Capture((o1532) => {R.Emit(o1532,R.Member(s.Get(@"live"),@"pid"));}))+@" now: the handle has been recycled, so this ref does not name the window it was read from. Read the tree again with computer_ui. (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)")}));}
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"entry"),@"automationId"),@""))){s.Set(@"probe",R.Call(s,@"Do-UiTree",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Member(s.Get(@"entry"),@"hwnd"),@"automationId",R.Member(s.Get(@"entry"),@"automationId"),@"maxDepth",1,@"maxNodes",40,@"patterns",s.Get(@"false"),@"skipEmpty",s.Get(@"false"),@"prune",s.Get(@"false")})),s.Get(@"false")}),null));
s.Set(@"probeRows",R.Array(R.Capture((o1533) => {R.Emit(o1533,R.Member(s.Get(@"probe"),@"nodes"));})));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"probeRows"),@"Count"),0))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[ELEMENT_UNAVAILABLE] the element the ref named (#"+R.Str(R.Capture((o1534) => {R.Emit(o1534,R.Member(s.Get(@"entry"),@"automationId"));}))+@") is no longer in hwnd "+R.Str(R.Capture((o1535) => {R.Emit(o1535,R.Member(s.Get(@"entry"),@"hwnd"));}))+@". (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)")}));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"probeRows"),@"Count"),1))){s.Set(@"only",R.Index(s.Get(@"probeRows"),0));
s.Set(@"cx",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"only"),@"x")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"only"),@"width")),2))));
s.Set(@"cy",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"only"),@"y")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"only"),@"height")),2))));
s.Set(@"wantX",R.Binary(s,@"Plus",R.Member(s.Get(@"entry"),@"x"),R.Cast(@"int",R.Binary(s,@"Divide",R.Member(s.Get(@"entry"),@"width"),2))));
s.Set(@"wantY",R.Binary(s,@"Plus",R.Member(s.Get(@"entry"),@"y"),R.Cast(@"int",R.Binary(s,@"Divide",R.Member(s.Get(@"entry"),@"height"),2))));
s.Set(@"drift",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Invoke(R.Type(@"Math"),@"Sqrt",new object[]{R.Binary(s,@"Plus",R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",s.Get(@"cx"),s.Get(@"wantX")),2}),R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",s.Get(@"cy"),s.Get(@"wantY")),2}))})})));
s.Set(@"reresolved",(R.Bool(R.Binary(s,@"Igt",s.Get(@"drift"),2)) || R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1536) => {R.Emit(o1536,R.Index(s.Get(@"only"),@"name"));}))),R.Member(s.Get(@"entry"),@"name")))));
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"selector",R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",R.Member(s.Get(@"entry"),@"hwnd")),@"automationId",(""+R.Str(R.Capture((o1537) => {R.Emit(o1537,R.Index(s.Get(@"only"),@"automationId"));}))),@"index",0})),@"reresolved",s.Get(@"reresolved"),@"drift",s.Get(@"drift"),@"entry",s.Get(@"entry"),@"node",s.Get(@"only"),@"path",@"",@"via",@"automation-id"}));}}
s.Set(@"tree",R.Call(s,@"Do-UiTree",new Args(new object[]{R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Member(s.Get(@"entry"),@"hwnd"),@"maxDepth",12,@"maxNodes",1500,@"patterns",s.Get(@"false"),@"skipEmpty",s.Get(@"false"),@"prune",s.Get(@"false")})),s.Get(@"false")}),null));
s.Set(@"nodes",R.Array(R.Capture((o1538) => {R.Emit(o1538,R.Member(s.Get(@"tree"),@"nodes"));})));
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"nodes"),@"Count"),0))){throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[ELEMENT_UNAVAILABLE] the window the ref was read from (hwnd "+R.Str(R.Capture((o1539) => {R.Emit(o1539,R.Member(s.Get(@"entry"),@"hwnd"));}))+@") has no readable UI Automation tree any more. (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)")}));}
s.Set(@"candidates",R.Array(R.Capture((o1540) => {})));
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"entry"),@"automationId"),@""))){s.Set(@"candidates",R.Array(R.Capture((o1541) => {R.Emit(o1541,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_1542)}),s.Get(@"nodes")));})));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"candidates"),@"Count"),0)) && R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"entry"),@"name"),@""))))){s.Set(@"candidates",R.Array(R.Capture((o1544) => {R.Emit(o1544,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_1545)}),s.Get(@"nodes")));})));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"candidates"),@"Count"),0)) && R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"entry"),@"className"),@""))))){s.Set(@"candidates",R.Array(R.Capture((o1548) => {R.Emit(o1548,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_1549)}),s.Get(@"nodes")));})));}
if(R.Bool(R.Binary(s,@"Ieq",R.Member(s.Get(@"candidates"),@"Count"),0))){s.Set(@"label",R.Member(s.Get(@"entry"),@"automationId"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"label"),@""))){s.Set(@"label",R.Binary(s,@"Plus",R.Binary(s,@"Plus",R.Member(s.Get(@"entry"),@"controlType"),@" "),R.Member(s.Get(@"entry"),@"name")));}
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+@"[ELEMENT_UNAVAILABLE] the element the ref named ("+R.Str(s.Get(@"label"))+@") is no longer in hwnd "+R.Str(R.Capture((o1552) => {R.Emit(o1552,R.Member(s.Get(@"entry"),@"hwnd"));}))+@". (action_sent=false, element_lookup=not_found, recovery=computer_ui, auto_reresolve=false)")}));}
s.Set(@"wantX",R.Binary(s,@"Plus",R.Member(s.Get(@"entry"),@"x"),R.Cast(@"int",R.Binary(s,@"Divide",R.Member(s.Get(@"entry"),@"width"),2))));
s.Set(@"wantY",R.Binary(s,@"Plus",R.Member(s.Get(@"entry"),@"y"),R.Cast(@"int",R.Binary(s,@"Divide",R.Member(s.Get(@"entry"),@"height"),2))));
s.Set(@"best",s.Get(@"null"));
s.Set(@"bestScore",R.Member(R.Type(@"double"),@"MaxValue"));
s.Set(@"bestPath",@"");
foreach(var item1553 in R.Array(s.Get(@"candidates"))){s.Set(@"candidate",item1553);try{s.Set(@"candidateEntry",R.Index(s.Get(@"script:ElementRegistry"),(""+R.Str(R.Capture((o1554) => {R.Emit(o1554,R.Index(s.Get(@"candidate"),@"ref"));})))));
s.Set(@"path",@"");
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"candidateEntry")))){s.Set(@"path",R.Member(s.Get(@"candidateEntry"),@"path"));}
s.Set(@"score",0d);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"path"),R.Member(s.Get(@"entry"),@"path")))){s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),100000));}
s.Set(@"cx",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"candidate"),@"x")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"candidate"),@"width")),2))));
s.Set(@"cy",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"candidate"),@"y")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"candidate"),@"height")),2))));
s.Set(@"score",R.Binary(s,@"Plus",s.Get(@"score"),R.Invoke(R.Type(@"Math"),@"Sqrt",new object[]{R.Binary(s,@"Plus",R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",s.Get(@"cx"),s.Get(@"wantX")),2}),R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",s.Get(@"cy"),s.Get(@"wantY")),2}))})));
if(R.Bool(R.Binary(s,@"Ilt",s.Get(@"score"),s.Get(@"bestScore")))){s.Set(@"bestScore",s.Get(@"score"));
s.Set(@"best",s.Get(@"candidate"));
s.Set(@"bestPath",s.Get(@"path"));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"selector",R.Cast(@"ordered",R.Map(new object[]{@"hwnd",R.Cast(@"int64",R.Member(s.Get(@"entry"),@"hwnd")),@"index",0})));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1555) => {R.Emit(o1555,R.Index(s.Get(@"best"),@"automationId"));}))),@""))){R.SetMember(s.Get(@"selector"),@"automationId",(""+R.Str(R.Capture((o1556) => {R.Emit(o1556,R.Index(s.Get(@"best"),@"automationId"));}))));
s.Set(@"same",R.Array(R.Capture((o1557) => {R.Emit(o1557,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_1558)}),s.Get(@"nodes")));})));}else{R.SetMember(s.Get(@"selector"),@"controlType",(""+R.Str(R.Capture((o1560) => {R.Emit(o1560,R.Index(s.Get(@"best"),@"controlType"));}))));
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1561) => {R.Emit(o1561,R.Index(s.Get(@"best"),@"className"));}))),@""))){R.SetMember(s.Get(@"selector"),@"className",(""+R.Str(R.Capture((o1562) => {R.Emit(o1562,R.Index(s.Get(@"best"),@"className"));}))));}
if(R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1563) => {R.Emit(o1563,R.Index(s.Get(@"best"),@"name"));}))),@""))){R.SetMember(s.Get(@"selector"),@"name",(""+R.Str(R.Capture((o1564) => {R.Emit(o1564,R.Index(s.Get(@"best"),@"name"));}))));}
s.Set(@"same",R.Array(R.Capture((o1565) => {R.Emit(o1565,R.Call(s,@"Where-Object",new Args(new object[]{new Fn(s,Block_1566)}),s.Get(@"nodes")));})));}
{s.Set(@"i",0);while(R.Bool(R.Binary(s,@"Ilt",s.Get(@"i"),R.Member(s.Get(@"same"),@"Count")))){try{if(R.Bool(R.Invoke(R.Type(@"object"),@"ReferenceEquals",new object[]{R.Index(s.Get(@"same"),s.Get(@"i")),s.Get(@"best")}))){R.SetMember(s.Get(@"selector"),@"index",s.Get(@"i"));
throw new BreakFlow();}}catch(ContinueFlow){}catch(BreakFlow){break;}R.Eval(()=>R.Eval(()=>{var u1572=s.Get(@"i");s.Set(@"i",R.Binary(s,@"Plus",u1572,1L));return u1572;}));}}
s.Set(@"cx2",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"best"),@"x")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"best"),@"width")),2))));
s.Set(@"cy2",R.Binary(s,@"Plus",R.Cast(@"int",R.Index(s.Get(@"best"),@"y")),R.Cast(@"int",R.Binary(s,@"Divide",R.Cast(@"int",R.Index(s.Get(@"best"),@"height")),2))));
s.Set(@"drift",R.Cast(@"int",R.Invoke(R.Type(@"Math"),@"Round",new object[]{R.Invoke(R.Type(@"Math"),@"Sqrt",new object[]{R.Binary(s,@"Plus",R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",s.Get(@"cx2"),s.Get(@"wantX")),2}),R.Invoke(R.Type(@"Math"),@"Pow",new object[]{R.Binary(s,@"Minus",s.Get(@"cy2"),s.Get(@"wantY")),2}))})})));
s.Set(@"reresolved",(R.Bool((R.Bool(R.Binary(s,@"Igt",s.Get(@"drift"),2)) || R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1573) => {R.Emit(o1573,R.Index(s.Get(@"best"),@"automationId"));}))),R.Member(s.Get(@"entry"),@"automationId"))))) || R.Bool(R.Binary(s,@"Ine",(""+R.Str(R.Capture((o1574) => {R.Emit(o1574,R.Index(s.Get(@"best"),@"name"));}))),R.Member(s.Get(@"entry"),@"name")))));
throw new ReturnFlow(R.Map(new object[]{@"ok",s.Get(@"true"),@"selector",s.Get(@"selector"),@"reresolved",s.Get(@"reresolved"),@"drift",s.Get(@"drift"),@"entry",s.Get(@"entry"),@"node",s.Get(@"best"),@"path",s.Get(@"bestPath"),@"via",@"tree-walk"}));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_UiActByRef_1575(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"ref"))) || R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1576) => {R.Emit(o1576,R.Member(s.Get(@"Arg"),@"ref"));}))),@""))))){throw new ReturnFlow(R.Call(s,@"Do-UiAct",new Args(new object[]{s.Get(@"Arg")}),null));}
s.Set(@"resolved",R.Call(s,@"Resolve-ElementRef",new Args(new object[]{R.Cast(@"string",R.Member(s.Get(@"Arg"),@"ref"))}),null));
if(R.Bool(R.Unary(@"Not",R.Member(s.Get(@"resolved"),@"ok")))){throw R.Error(R.Member(s.Get(@"resolved"),@"error"));}
s.Set(@"merged",R.Cast(@"ordered",R.Map(new object[]{})));
if(R.Bool(R.Binary(s,@"Is",s.Get(@"Arg"),R.Type(@"System.Collections.IDictionary")))){foreach(var item1577 in R.Array(R.Array(R.Capture((o1578) => {R.Emit(o1578,R.Member(s.Get(@"Arg"),@"Keys"));})))){s.Set(@"key",item1577);try{R.SetIndex(s.Get(@"merged"),R.Cast(@"string",s.Get(@"key")),R.Index(s.Get(@"Arg"),s.Get(@"key")));}catch(ContinueFlow){}catch(BreakFlow){break;}}}else{foreach(var item1579 in R.Array(R.Member(R.Member(s.Get(@"Arg"),@"PSObject"),@"Properties"))){s.Set(@"property",item1579);try{R.SetIndex(s.Get(@"merged"),R.Member(s.Get(@"property"),@"Name"),R.Member(s.Get(@"property"),@"Value"));}catch(ContinueFlow){}catch(BreakFlow){break;}}}
foreach(var item1580 in R.Array(R.Array(R.Capture((o1581) => {R.Emit(o1581,new object[]{@"hwnd",@"automationId",@"name",@"controlType",@"className",@"index"});})))){s.Set(@"key",item1580);try{if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Index(R.Member(s.Get(@"resolved"),@"selector"),s.Get(@"key"))))){R.SetIndex(s.Get(@"merged"),s.Get(@"key"),R.Index(R.Member(s.Get(@"resolved"),@"selector"),s.Get(@"key")));}}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"receipt",R.Call(s,@"Do-UiAct",new Args(new object[]{s.Get(@"merged")}),null));
R.SetMember(s.Get(@"receipt"),@"ref",R.Cast(@"string",R.Member(s.Get(@"Arg"),@"ref")));
R.SetMember(s.Get(@"receipt"),@"reresolved",R.Cast(@"bool",R.Member(s.Get(@"resolved"),@"reresolved")));
R.SetMember(s.Get(@"receipt"),@"drift",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"drift")));
R.SetMember(s.Get(@"receipt"),@"resolvedVia",R.Cast(@"string",R.Member(s.Get(@"resolved"),@"via")));
throw new ReturnFlow(s.Get(@"receipt"));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Prune_1582(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"rows",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item1583 in R.Array(R.Array(R.Capture((o1584) => {R.Emit(o1584,R.Member(s.Get(@"Arg"),@"nodes"));})))){s.Set(@"node",item1583);try{R.Emit(o,R.Invoke(s.Get(@"rows"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"depth",R.Cast(@"int",R.Member(s.Get(@"node"),@"depth")),@"name",R.Cast(@"string",R.Member(s.Get(@"node"),@"name")),@"controlType",R.Cast(@"string",R.Member(s.Get(@"node"),@"controlType")),@"automationId",R.Cast(@"string",R.Member(s.Get(@"node"),@"automationId")),@"className",R.Cast(@"string",R.Member(s.Get(@"node"),@"className")),@"enabled",R.Cast(@"bool",R.Member(s.Get(@"node"),@"enabled")),@"offscreen",R.Cast(@"bool",R.Member(s.Get(@"node"),@"offscreen")),@"x",R.Cast(@"int",R.Member(s.Get(@"node"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"node"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"node"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"node"),@"height")),@"patterns",R.Array(R.Capture((o1585) => {R.Emit(o1585,R.Member(s.Get(@"node"),@"patterns"));}))}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"maxNodes",250);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"maxNodes")))){s.Set(@"maxNodes",R.Invoke(R.Type(@"Math"),@"Max",new object[]{1,R.Cast(@"int",R.Member(s.Get(@"Arg"),@"maxNodes"))}));}
s.Set(@"optimized",R.Call(s,@"Optimize-UiRows",new Args(new object[]{s.Get(@"rows"),s.Get(@"maxNodes")}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"nodes",R.Array(R.Capture((o1586) => {R.Emit(o1586,R.Member(s.Get(@"optimized"),@"nodes"));})),@"pruned",R.Cast(@"int",R.Member(s.Get(@"optimized"),@"pruned")),@"input",R.Member(s.Get(@"rows"),@"Count")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_Delta_1587(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"nodes",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item1588 in R.Array(R.Array(R.Capture((o1589) => {R.Emit(o1589,R.Member(s.Get(@"Arg"),@"nodes"));})))){s.Set(@"node",item1588);try{R.Emit(o,R.Invoke(s.Get(@"nodes"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"key",(""+R.Str(R.Capture((o1590) => {R.Emit(o1590,R.Member(s.Get(@"node"),@"key"));}))),@"ref",(""+R.Str(R.Capture((o1591) => {R.Emit(o1591,R.Member(s.Get(@"node"),@"ref"));}))),@"name",R.Cast(@"string",R.Member(s.Get(@"node"),@"name")),@"controlType",R.Cast(@"string",R.Member(s.Get(@"node"),@"controlType")),@"className",R.Cast(@"string",R.Member(s.Get(@"node"),@"className")),@"enabled",R.Cast(@"bool",R.Member(s.Get(@"node"),@"enabled")),@"offscreen",R.Cast(@"bool",R.Member(s.Get(@"node"),@"offscreen")),@"patterns",R.Array(R.Capture((o1592) => {R.Emit(o1592,R.Member(s.Get(@"node"),@"patterns"));})),@"x",R.Cast(@"int",R.Member(s.Get(@"node"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"node"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"node"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"node"),@"height"))}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"entries",R.Call(s,@"New-Object",new Args(new object[]{@"System.Collections.Generic.List[object]"}),null));
foreach(var item1593 in R.Array(R.Array(R.Capture((o1594) => {R.Emit(o1594,R.Member(s.Get(@"Arg"),@"entries"));})))){s.Set(@"entry",item1593);try{R.Emit(o,R.Invoke(s.Get(@"entries"),@"Add",new object[]{R.Cast(@"ordered",R.Map(new object[]{@"key",(""+R.Str(R.Capture((o1595) => {R.Emit(o1595,R.Member(s.Get(@"entry"),@"key"));}))),@"snapshot",(""+R.Str(R.Capture((o1596) => {R.Emit(o1596,R.Member(s.Get(@"entry"),@"snapshot"));}))),@"name",R.Cast(@"string",R.Member(s.Get(@"entry"),@"name")),@"controlType",R.Cast(@"string",R.Member(s.Get(@"entry"),@"controlType")),@"className",R.Cast(@"string",R.Member(s.Get(@"entry"),@"className")),@"enabled",R.Cast(@"bool",R.Member(s.Get(@"entry"),@"enabled")),@"offscreen",R.Cast(@"bool",R.Member(s.Get(@"entry"),@"offscreen")),@"patterns",R.Array(R.Capture((o1597) => {R.Emit(o1597,R.Member(s.Get(@"entry"),@"patterns"));})),@"x",R.Cast(@"int",R.Member(s.Get(@"entry"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"entry"),@"y")),@"width",R.Cast(@"int",R.Member(s.Get(@"entry"),@"width")),@"height",R.Cast(@"int",R.Member(s.Get(@"entry"),@"height"))}))}));}catch(ContinueFlow){}catch(BreakFlow){break;}}
s.Set(@"result",R.Call(s,@"New-TreeDelta",new Args(new object[]{s.Get(@"nodes"),s.Get(@"entries"),(""+R.Str(R.Capture((o1598) => {R.Emit(o1598,R.Member(s.Get(@"Arg"),@"base"));})))}),null));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"counts",R.Member(s.Get(@"result"),@"counts"),@"nodes",R.Array(R.Capture((o1599) => {R.Emit(o1599,R.Member(s.Get(@"result"),@"nodes"));}))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_ConvertTo_FrameRecord_1600(Scope s,Args a){var o=new List<object>();s.Set(@"spec",R.Bind(a,0,@"spec",()=>null,@"object"));
try{s.Set(@"surfaceIn",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"surface"}),null));
s.Set(@"cropIn",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"crop"}),null));
s.Set(@"encodedIn",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"encoded"}),null));
s.Set(@"attachedIn",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"attached"}),null));
s.Set(@"windowIn",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"windowRect"}),null));
s.Set(@"hwnd",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"hwnd",0}),null)));
s.Set(@"ownerPid",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"pid",0}),null)));
s.Set(@"virtual",R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null));
s.Set(@"surface",R.Cast(@"ordered",R.Map(new object[]{@"kind",(""+R.Str(R.Capture((o1601) => {R.Emit(o1601,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"surfaceIn"),@"kind",@"screen"}),null));}))),@"x",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"surfaceIn"),@"x",0}),null)),@"y",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"surfaceIn"),@"y",0}),null)),@"width",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"surfaceIn"),@"width",1}),null)),@"height",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"surfaceIn"),@"height",1}),null))})));
s.Set(@"crop",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"cropIn"),@"x",0}),null)),@"y",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"cropIn"),@"y",0}),null)),@"width",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"cropIn"),@"width",R.Member(s.Get(@"surface"),@"width")}),null)),@"height",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"cropIn"),@"height",R.Member(s.Get(@"surface"),@"height")}),null))})));
s.Set(@"encoded",R.Cast(@"ordered",R.Map(new object[]{@"width",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"encodedIn"),@"width",R.Member(s.Get(@"crop"),@"width")}),null)),@"height",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"encodedIn"),@"height",R.Member(s.Get(@"crop"),@"height")}),null))})));
s.Set(@"attached",R.Cast(@"ordered",R.Map(new object[]{@"width",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"attachedIn"),@"width",0}),null)),@"height",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"attachedIn"),@"height",0}),null)),@"transformKnown",(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"attachedIn"))) && R.Bool(R.Binary(s,@"Ieq",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"attachedIn"),@"transformKnown",s.Get(@"false")}),null),s.Get(@"true")))),@"reported",R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"attachedIn"))})));
s.Set(@"windowRect",s.Get(@"null"));
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),s.Get(@"windowIn")))){s.Set(@"windowRect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"windowIn"),@"x",0}),null)),@"y",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"windowIn"),@"y",0}),null)),@"width",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"windowIn"),@"width",0}),null)),@"height",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"windowIn"),@"height",0}),null))})));}
if(R.Bool((R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"windowRect"))) && R.Bool(R.Binary(s,@"Ine",s.Get(@"hwnd"),0))))){s.Set(@"windowRect",R.Cast(@"ordered",R.Map(new object[]{@"x",R.Member(s.Get(@"surface"),@"x"),@"y",R.Member(s.Get(@"surface"),@"y"),@"width",R.Member(s.Get(@"surface"),@"width"),@"height",R.Member(s.Get(@"surface"),@"height")})));}
s.Set(@"scale",R.Cast(@"double",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"effectiveScale",1d}),null)));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"id",@"__probe__",@"schemaVersion",2,@"hwnd",s.Get(@"hwnd"),@"pid",s.Get(@"ownerPid"),@"dpi",R.Cast(@"int",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"dpi",0}),null)),@"processStart",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"processStart",0}),null)),@"rootHwnd",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"rootHwnd",0}),null)),@"surfaceDigest",(""+R.Str(R.Capture((o1602) => {R.Emit(o1602,R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"surfaceDigest",@""}),null));}))),@"frameAgeMs",R.Cast(@"int64",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"ageMs",0}),null)),@"windowRect",s.Get(@"windowRect"),@"surface",s.Get(@"surface"),@"crop",s.Get(@"crop"),@"encoded",s.Get(@"encoded"),@"attached",s.Get(@"attached"),@"requestedScale",R.Cast(@"double",R.Call(s,@"Get-ConditionField",new Args(new object[]{s.Get(@"spec"),@"requestedScale",1d}),null)),@"effectiveScale",s.Get(@"scale"),@"source",@"probe",@"surfaceKind",(""+R.Str(R.Capture((o1603) => {R.Emit(o1603,R.Member(s.Get(@"surface"),@"kind"));}))),@"epoch",R.Cast(@"int64",s.Get(@"script:ObservationEpoch")),@"writeSeq",R.Cast(@"int64",s.Get(@"script:WriteSeq")),@"specKey",@"",@"width",R.Member(s.Get(@"surface"),@"width"),@"height",R.Member(s.Get(@"surface"),@"height"),@"x",R.Member(s.Get(@"surface"),@"x"),@"y",R.Member(s.Get(@"surface"),@"y"),@"imageWidth",R.Member(s.Get(@"encoded"),@"width"),@"imageHeight",R.Member(s.Get(@"encoded"),@"height"),@"scale",s.Get(@"scale"),@"vx",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"x")),@"vy",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"y")),@"vwidth",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"width")),@"vheight",R.Cast(@"int",R.Member(s.Get(@"virtual"),@"height"))})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_FrameAttach_1604(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"id",(""+R.Str(R.Capture((o1605) => {R.Emit(o1605,R.Member(s.Get(@"Arg"),@"frame"));}))));
s.Set(@"frame",R.Index(s.Get(@"script:FrameRegistry"),s.Get(@"id")));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"frame")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"frame",s.Get(@"id"),@"known",s.Get(@"false"),@"error",(""+@"frame '"+R.Str(s.Get(@"id"))+@"' is not in this worker's registry any more")})));}
s.Set(@"width",0);
s.Set(@"height",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"width")))){s.Set(@"width",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"width")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"height")))){s.Set(@"height",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"height")));}
s.Set(@"knownFlag",R.Binary(s,@"Ine",R.Member(s.Get(@"Arg"),@"transformKnown"),s.Get(@"false")));
R.SetMember(s.Get(@"frame"),@"attached",R.Cast(@"ordered",R.Map(new object[]{@"width",s.Get(@"width"),@"height",s.Get(@"height"),@"transformKnown",(R.Bool((R.Bool(s.Get(@"knownFlag")) && R.Bool(R.Binary(s,@"Igt",s.Get(@"width"),0)))) && R.Bool(R.Binary(s,@"Igt",s.Get(@"height"),0))),@"reported",s.Get(@"true")})));
s.Set(@"note",@"");
if(R.Bool(R.Binary(s,@"Ine",R.Member(R.Member(s.Get(@"frame"),@"attached"),@"transformKnown"),s.Get(@"true")))){s.Set(@"note",@"the delivered image has an unknown transform, so coordinates measured in it will be refused rather than projected");}else if(R.Bool((R.Bool(R.Binary(s,@"Ine",s.Get(@"width"),R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")))) || R.Bool(R.Binary(s,@"Ine",s.Get(@"height"),R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height"))))))){s.Set(@"note",(""+@"the host delivered a "+R.Str(s.Get(@"width"))+@"x"+R.Str(s.Get(@"height"))+@" image for a "+R.Str(R.Capture((o1606) => {R.Emit(o1606,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")));}))+@"x"+R.Str(R.Capture((o1607) => {R.Emit(o1607,R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height")));}))+@" frame; the inverse scale is recorded and will be applied when projecting"));}else{s.Set(@"note",@"the delivered image is the encoded one, pixel for pixel");}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"frame",s.Get(@"id"),@"known",R.Cast(@"bool",R.Member(R.Member(s.Get(@"frame"),@"attached"),@"transformKnown")),@"encoded",R.Cast(@"ordered",R.Map(new object[]{@"width",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"width")),@"height",R.Cast(@"int",R.Member(R.Member(s.Get(@"frame"),@"encoded"),@"height"))})),@"attached",R.Cast(@"ordered",R.Map(new object[]{@"width",s.Get(@"width"),@"height",s.Get(@"height")})),@"note",s.Get(@"note")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object F_Do_FrameProject_1608(Scope s,Args a){var o=new List<object>();s.Set(@"Arg",R.Bind(a,0,@"Arg",()=>null,@"object"));
try{s.Set(@"spec",R.Member(s.Get(@"Arg"),@"frame"));
if(R.Bool(R.Binary(s,@"Ieq",s.Get(@"null"),s.Get(@"spec")))){throw R.Error(@"[BAD_REQUEST] frameproject needs a frame spec");}
s.Set(@"record",R.Call(s,@"ConvertTo-FrameRecord",new Args(new object[]{s.Get(@"spec")}),null));
s.Set(@"id",(""+R.Str(R.Capture((o1609) => {R.Emit(o1609,R.Member(s.Get(@"record"),@"id"));}))));
R.SetIndex(s.Get(@"script:FrameRegistry"),s.Get(@"id"),s.Get(@"record"));
try{s.Set(@"px",0);
s.Set(@"py",0);
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"x")))){s.Set(@"px",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"x")));}
if(R.Bool(R.Binary(s,@"Ine",s.Get(@"null"),R.Member(s.Get(@"Arg"),@"y")))){s.Set(@"py",R.Cast(@"int",R.Member(s.Get(@"Arg"),@"y")));}
s.Set(@"resolved",R.Call(s,@"Resolve-FramePoint",new Args(new object[]{s.Get(@"id"),s.Get(@"px"),s.Get(@"py"),R.Cast(@"ordered",R.Map(new object[]{@"verifyContent",R.Member(s.Get(@"Arg"),@"verifyContent"),@"allowActivate",R.Binary(s,@"Ieq",R.Member(s.Get(@"Arg"),@"allowActivate"),s.Get(@"true")),@"allowWindows",R.Member(s.Get(@"Arg"),@"allowWindows")}))}),null));
s.Set(@"transform",R.Call(s,@"Get-FrameTransform",new Args(new object[]{s.Get(@"record"),R.Cast(@"double",s.Get(@"px")),R.Cast(@"double",s.Get(@"py"))}),null));
if(R.Bool(R.Binary(s,@"Ine",R.Member(s.Get(@"resolved"),@"ok"),s.Get(@"true")))){throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"false"),@"error",(""+R.Str(R.Capture((o1610) => {R.Emit(o1610,R.Member(s.Get(@"resolved"),@"error"));}))),@"transform",s.Get(@"transform")})));}
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"ok",s.Get(@"true"),@"x",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"x")),@"y",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"y")),@"drift",R.Cast(@"int",R.Member(s.Get(@"resolved"),@"drift")),@"mapping",(""+R.Str(R.Capture((o1611) => {R.Emit(o1611,R.Member(s.Get(@"resolved"),@"mapping"));}))),@"guard",(""+R.Str(R.Capture((o1612) => {R.Emit(o1612,R.Member(R.Member(s.Get(@"resolved"),@"guard"),@"how"));}))),@"recovered",R.Binary(s,@"Ieq",R.Member(s.Get(@"resolved"),@"activated"),s.Get(@"true"))})));}finally{R.Emit(o,R.Invoke(s.Get(@"script:FrameRegistry"),@"Remove",new object[]{s.Get(@"id")}));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1613(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Cast(@"ordered",R.Map(new object[]{@"ready",s.Get(@"true"),@"dpi",s.Get(@"dpiMode"),@"dpiActual",s.Get(@"dpiActual"),@"screens",R.Array(R.Capture((o1614) => {R.Emit(o1614,R.Call(s,@"Get-ScreenList",new Args(new object[]{}),null));})),@"virtual",R.Call(s,@"Get-VirtualBounds",new Args(new object[]{}),null),@"cursor",R.Call(s,@"Do-Cursor",new Args(new object[]{}),null)})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1615(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{if(R.Bool(R.Binary(s,@"Ieq",(""+R.Str(R.Capture((o1616) => {R.Emit(o1616,R.Member(s.Get(@"a"),@"captures"));}))),@"related"))){R.Emit(o,R.Call(s,@"Do-ScreenshotRelated",new Args(new object[]{s.Get(@"a")}),null));}else{R.Emit(o,R.Call(s,@"Do-Screenshot",new Args(new object[]{s.Get(@"a")}),null));}}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1617(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Batch",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1618(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Cursor",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1619(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Click",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1620(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Wait",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1621(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Wait-ForCondition",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1622(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Drag",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1623(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Scroll",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1624(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Type",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1625(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Key",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1626(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Clipboard",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1627(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Paste",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1628(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Launch",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1629(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Release",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1630(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Digest",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1631(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Windows",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1632(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Focus",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1633(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Invoke(R.Type(@"DshUia.Engine"),@"Reset",new object[]{}));
throw new ReturnFlow(R.Cast(@"ordered",R.Map(new object[]{@"reset",s.Get(@"true")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1634(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Reset-WalkCounters",new Args(new object[]{}),null));
R.Emit(o,R.Call(s,@"Do-UiTree",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1635(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-UiActByRef",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1636(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Health",new Args(new object[]{}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1637(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Pacing",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1638(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Prune",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1639(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-Delta",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1640(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-FrameProject",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1641(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Call(s,@"Do-FrameAttach",new Args(new object[]{s.Get(@"a")}),null));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
static object Block_1642(Scope s,Args a){var o=new List<object>();s.Set(@"a",R.Bind(a,0,@"a",()=>null,@"object"));
try{R.Emit(o,R.Cast(@"ordered",R.Map(new object[]{@"bye",s.Get(@"true")})));}catch(ReturnFlow r){R.Emit(o,r.Value);}return R.Pack(o);}
}}

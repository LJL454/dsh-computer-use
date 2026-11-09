using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
namespace DshWorker {
partial class Program {
 static string BuildHash(){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(Assembly.GetExecutingAssembly().Location))).Replace("-","").ToLowerInvariant().Substring(0,16);}
 static readonly string[] Capabilities={"capture.spec","capture.crop","frame.v2","guard.landing","wait.three-valued","wait.held","batch.deadline","batch.expected-transitions","observe.epoch","text.observe","reply.traversal","reply.pushdown","input.partial","deadline.enforced","release.independent"};
 [STAThread] static int Main(string[] args){
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  try{
   if(args.Length>0&&args[0]=="--inspect-windows")return InspectWindows(args.Skip(1).ToArray());
   // Explicit references retain the same WinForms, Drawing and managed UIA implementations.
   GC.KeepAlive(typeof(System.Windows.Forms.Clipboard));GC.KeepAlive(typeof(System.Drawing.Bitmap));GC.KeepAlive(typeof(System.Windows.Automation.AutomationElement));GC.KeepAlive(typeof(System.Windows.Automation.TextPattern));GC.KeepAlive(typeof(System.Windows.Rect));
   if(args.Length>0&&args[0]=="--release-input")return ReleaseInput(args.Skip(1).ToArray());
   var s=new Scope();Register(s);string hash=BuildHash();
   var info=R.Map(new object[]{"dpi",s.Get("dpiMode"),"dpiActual",s.Get("dpiActual"),"screens",R.Array(R.Call(s,"Get-ScreenList",new Args(new object[0]))),"virtual",R.Call(s,"Get-VirtualBounds",new Args(new object[0])),"pid",Process.GetCurrentProcess().Id,"version","native-dotnet-framework/1.50.1","backend","native","generation",s.Get("BootGen"),"protocol",2,"frameProtocol",s.Get("FrameProtocol"),"build",hash,"releaseBuild",hash,"capabilities",Capabilities,"actions",R.Array(s.Get("STEP_ACTIONS")),"uiaActions",R.Array(s.Get("UIA_STEP_ACTIONS")),"cancelFile",s.Get("CancelFile"),"pacing",R.Call(s,"Get-PacingConfig",new Args(new object[0]))});
   Console.Out.WriteLine(R.Serialize(R.Map(new object[]{"ready",true,"info",info})));
   try{string line;while((line=Console.ReadLine())!=null){if(string.IsNullOrWhiteSpace(line))continue;object id=0;try{var req=R.Parse(line);id=R.Member(req,"id");s.Set("RequestSeq",Convert.ToInt32(s.Get("RequestSeq"))+1);string cmd=R.Str(R.Member(req,"cmd"));var handler=R.Index(s.Get("handler"),cmd);if(handler==null)throw new InvalidOperationException("unknown command '"+cmd+"'");var result=R.Call(s,handler,new Args(new[]{R.Member(req,"args")}));Console.Out.WriteLine(R.Serialize(R.Map(new object[]{"id",id,"ok",true,"result",result})));if(cmd=="shutdown")break;}catch(Exception e){Console.Out.WriteLine(R.Serialize(R.Map(new object[]{"id",id,"ok",false,"error",e.Message,"canceled",e.Message.StartsWith("[CANCELED]",StringComparison.Ordinal)})));if(Environment.GetEnvironmentVariable("DSH_NATIVE_DEBUG")=="1")Console.Error.WriteLine(e);}finally{R.Call(s,"Clear-CancelRequest",new Args(new object[0]));R.Call(s,"Clear-Deadline",new Args(new object[0]));}}}finally{try{R.Call(s,"Release-HeldInput",new Args(new object[0]));}catch(Exception e){Console.Error.WriteLine(e.Message);}}return 0;
  }catch(Exception e){Console.Error.WriteLine(e);return 1;}
 }
 static int InspectWindows(string[] args){
  int pid=args.Length>0?int.Parse(args[0],System.Globalization.CultureInfo.InvariantCulture):0;
  string name=args.Length>1?args[1]:"";long since=args.Length>2?long.Parse(args[2],System.Globalization.CultureInfo.InvariantCulture):0;
  var rows=new Dictionary<int,IDictionary>();
  Action<Process,string> add=(p,source)=>{try{if(!rows.ContainsKey(p.Id))rows[p.Id]=R.Map(new object[]{"pid",p.Id,"name",p.ProcessName,"title",p.MainWindowTitle,"source",source});}catch{}};
  if(pid>0){try{using(var p=Process.GetProcessById(pid))add(p,"pid");}catch(ArgumentException){}}
  if(name.Length>0||since>0){DateTime cutoff=since>0?DateTimeOffset.FromUnixTimeMilliseconds(since).LocalDateTime:DateTime.MinValue;foreach(var p in Process.GetProcesses()){using(p){try{if(name.Length>0&&p.ProcessName.Equals(name,StringComparison.OrdinalIgnoreCase))add(p,"name");if(since>0&&p.MainWindowTitle.Length>0&&p.StartTime>=cutoff)add(p,"started");}catch{}}}}
  var unique=rows.OrderBy(p=>p.Key).Select(p=>(object)p.Value).ToArray();
  Console.WriteLine(R.Serialize(R.Map(new object[]{"launchedAlive",rows.ContainsKey(pid),"processes",unique,"windows",unique.Where(p=>R.Str(R.Member(p,"title")).Length>0).ToArray()})));return 0;
 }
 static int ReleaseInput(string[] args){if(args.Length==0)throw new ArgumentException("--release-input requires a state file");string path=args[0];bool keep=args.Contains("--keep-state");var delivered=new List<string>();if(!File.Exists(path)){Console.WriteLine(R.Serialize(R.Map(new object[]{"ok",true,"released",delivered,"note","no held input was recorded"})));return 0;}object state;try{state=R.Parse(File.ReadAllText(path));}catch(Exception e){Console.WriteLine(R.Serialize(R.Map(new object[]{"ok",false,"released",delivered,"error","the held-input record could not be read: "+e.Message})));return 2;}
 var inputs=new List<DshNative.INPUT>();var labels=new List<string>();var extended=new HashSet<int>(new[]{0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x2D,0x2E,0x5B,0x5C,0x5D,0x6F,0x0D,0xA3,0xA5});foreach(var k in R.Array(R.Member(state,"keys"))){int vk=Convert.ToInt32(k);if(vk<0||vk>255)throw new InvalidDataException("Invalid recorded key");var i=new DshNative.INPUT();i.type=1;i.U.ki.wVk=(ushort)vk;i.U.ki.dwFlags=(uint)(2|(extended.Contains(vk)?1:0));inputs.Add(i);labels.Add("key:"+vk);}foreach(var b in R.Array(R.Member(state,"buttons"))){int flag=Convert.ToInt32(b);if(flag!=2&&flag!=8&&flag!=32)throw new InvalidDataException("Invalid recorded button");var i=new DshNative.INPUT();i.type=0;i.U.mi.dwFlags=(uint)(flag*2);inputs.Add(i);labels.Add(flag==2?"mouse:left":flag==8?"mouse:right":"mouse:middle");}
 int sent=inputs.Count==0?0:(int)DshNative.Send(inputs.ToArray());bool ok=sent==inputs.Count;delivered.AddRange(labels.Take(Math.Max(0,sent)));if(ok&&!keep)File.Delete(path);Console.WriteLine(R.Serialize(R.Map(new object[]{"ok",ok,"released",delivered,"pid",R.Member(state,"pid"),"error",ok?"":"SendInput did not deliver all recorded releases"})));return ok?0:3;
 }
}
}

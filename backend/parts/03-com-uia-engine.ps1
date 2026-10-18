# ------------------------------------------------------------- COM UIA engine
#
# The managed System.Windows.Automation wrapper marshals every property through a
# managed object and cannot reach TextPattern2, WindowPattern or the legacy pattern
# at all. This block talks to IUIAutomation directly instead.
#
# Two rules govern the declarations below, both learned the hard way:
#   1. A [ComImport] interface is positional. CompareElements/CompareRuntimeIds lead
#      IUIAutomation's vtable; leaving them out shifts every later slot by two, and a
#      shifted slot does not fail loudly -- it calls a different function and the
#      QueryInterface for the declared return type fails with E_NOINTERFACE.
#   2. GUIDs come from the Windows SDK's UIAutomationClient.idl, never from memory.
#      Two of five IIDs written from memory were wrong, and a wrong method order
#      calls the wrong function outright.
#
# Only the prefix each feature needs is declared: properties are read through
# GetCurrentPropertyValue/GetCachedPropertyValue, so the 29 individual property
# getters and their 29 cached twins never have to be spelled out.

$uiaComSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace DshUia
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [ComImport, Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomation
    {
        [PreserveSig] int CompareElements(IUIAutomationElement first, IUIAutomationElement second, out int areSame);
        [PreserveSig] int CompareRuntimeIds([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_I4)] int[] first, [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_I4)] int[] second, out int areSame);
        [PreserveSig] int GetRootElement([MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement root);
        [PreserveSig] int ElementFromHandle(IntPtr hwnd, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int ElementFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetFocusedElement([MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetRootElementBuildCache(IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement root);
        [PreserveSig] int ElementFromHandleBuildCache(IntPtr hwnd, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int ElementFromPointBuildCache(POINT pt, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetFocusedElementBuildCache(IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int CreateTreeWalker(IUIAutomationCondition condition, out IntPtr walker);
        IntPtr ControlViewWalker { get; }
        IntPtr ContentViewWalker { get; }
        IntPtr RawViewWalker { get; }
        IUIAutomationCondition RawViewCondition { get; }
        IUIAutomationCondition ControlViewCondition { get; }
        IUIAutomationCondition ContentViewCondition { get; }
        [PreserveSig] int CreateCacheRequest([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCacheRequest cacheRequest);
        [PreserveSig] int CreateTrueCondition([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        // Positional filler: CreatePropertyCondition is the next slot, and the IDL has
        // CreateFalseCondition in between.
        [PreserveSig] int CreateFalseCondition([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreatePropertyCondition(int propertyId, [In, MarshalAs(UnmanagedType.Struct)] object value, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        // Positional filler too: the IDL has CreatePropertyConditionEx here, and the three
        // combining calls below follow it. Nothing above them may move -- a wrong slot
        // count for a ComImport interface is not a compile error, it is a call into an
        // unrelated vtable entry at run time.
        [PreserveSig] int CreatePropertyConditionEx(int propertyId, [In, MarshalAs(UnmanagedType.Struct)] object value, int flags, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreateAndCondition(IUIAutomationCondition first, IUIAutomationCondition second, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreateOrCondition(IUIAutomationCondition first, IUIAutomationCondition second, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition condition);
        [PreserveSig] int CreateNotCondition(IUIAutomationCondition condition, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition negated);
    }

    [ComImport, Guid("D22108AA-8AC5-49A5-837B-37BBB3D7591E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationElement
    {
        [PreserveSig] int SetFocus();
        [PreserveSig] int GetRuntimeId(out IntPtr runtimeId);
        [PreserveSig] int FindFirst(int scope, IUIAutomationCondition condition, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement found);
        [PreserveSig] int FindAll(int scope, IUIAutomationCondition condition, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElementArray found);
        [PreserveSig] int FindFirstBuildCache(int scope, IUIAutomationCondition condition, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement found);
        [PreserveSig] int FindAllBuildCache(int scope, IUIAutomationCondition condition, IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElementArray found);
        [PreserveSig] int BuildUpdatedCache(IUIAutomationCacheRequest cacheRequest, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement updated);
        [PreserveSig] int GetCurrentPropertyValue(int propertyId, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCurrentPropertyValueEx(int propertyId, int ignoreDefaultValue, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCachedPropertyValue(int propertyId, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCachedPropertyValueEx(int propertyId, int ignoreDefaultValue, [MarshalAs(UnmanagedType.Struct)] out object value);
        [PreserveSig] int GetCurrentPatternAs(int patternId, ref Guid riid, out IntPtr patternObject);
        [PreserveSig] int GetCachedPatternAs(int patternId, ref Guid riid, out IntPtr patternObject);
        [PreserveSig] int GetCurrentPattern(int patternId, [MarshalAs(UnmanagedType.Interface)] out object patternObject);
        [PreserveSig] int GetCachedPattern(int patternId, [MarshalAs(UnmanagedType.Interface)] out object patternObject);
    }

    [ComImport, Guid("14314595-B4BC-4055-95F2-58F2E42C9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationElementArray
    {
        [PreserveSig] int get_Length(out int length);
        [PreserveSig] int GetElement(int index, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
    }

    [ComImport, Guid("B32A92B5-BC25-4078-9C08-D7EE95C48E03"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationCacheRequest
    {
        [PreserveSig] int AddProperty(int propertyId);
        [PreserveSig] int AddPattern(int patternId);
        [PreserveSig] int Clone([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCacheRequest request);
        [PreserveSig] int get_TreeScope(out int scope);
        [PreserveSig] int put_TreeScope(int scope);
        [PreserveSig] int get_TreeFilter([MarshalAs(UnmanagedType.Interface)] out IUIAutomationCondition filter);
        [PreserveSig] int put_TreeFilter(IUIAutomationCondition filter);
        [PreserveSig] int get_AutomationElementMode(out int mode);
        [PreserveSig] int put_AutomationElementMode(int mode);
    }

    [ComImport, Guid("352FFBA8-0973-437C-A61F-F64CAFD81DF9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationCondition { }

    [ComImport, Guid("FB377FBE-8EA6-46D5-9C73-6499642D3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationInvokePattern
    {
        [PreserveSig] int Invoke();
    }

    [ComImport, Guid("A94CD8B1-0844-4CD6-9D2D-640537AB39E9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationValuePattern
    {
        [PreserveSig] int SetValue([MarshalAs(UnmanagedType.BStr)] string value);
        string CurrentValue { get; }
    }

    [ComImport, Guid("94CF8058-9B8D-4AB9-8BFD-4CD0A33C8C70"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTogglePattern
    {
        [PreserveSig] int Toggle();
    }

    [ComImport, Guid("A8EFA66A-0FDA-421A-9194-38021F3578EA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationSelectionItemPattern
    {
        [PreserveSig] int Select();
    }

    [ComImport, Guid("619BE086-1F4E-4EE4-BAFA-210128738730"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationExpandCollapsePattern
    {
        [PreserveSig] int Expand();
        [PreserveSig] int Collapse();
    }

    [ComImport, Guid("B488300F-D015-4F19-9C29-BB595E3645EF"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationScrollItemPattern
    {
        [PreserveSig] int ScrollIntoView();
    }

    [ComImport, Guid("0FAEF453-9208-43EF-BBB2-3B485177864F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationWindowPattern
    {
        [PreserveSig] int Close();
        // Positional filler: SetWindowVisualState is the third slot, so this one has to
        // be declared even though nothing calls it.
        [PreserveSig] int WaitForInputIdle(int milliseconds, out int ready);
        [PreserveSig] int SetWindowVisualState(int state);
    }

    [ComImport, Guid("32EBA289-3583-42C9-9C59-3B6D9A1E9B6A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextPattern
    {
        // The first four are positional filler: GetDocumentRange is the fifth slot.
        [PreserveSig] int RangeFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int RangeFromChild(IUIAutomationElement child, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int GetSelection([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetVisibleRanges([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetDocumentRange([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
    }

    // TextPattern2 *inherits* TextPattern, so its vtable is the six TextPattern slots
    // followed by its own two. Declaring only the two put RangeFromAnnotation at slot 0
    // -- which is RangeFromPoint, with a completely different signature -- and calling
    // GetCaretRange took the whole worker down with an access violation.
    [ComImport, Guid("506A921A-FCC9-409F-B23B-37EB74106872"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextPattern2
    {
        [PreserveSig] int RangeFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int RangeFromChild(IUIAutomationElement child, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int GetSelection([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetVisibleRanges([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRangeArray ranges);
        [PreserveSig] int GetDocumentRange([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        int SupportedTextSelection { get; }
        [PreserveSig] int RangeFromAnnotation(IUIAutomationElement annotation, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int GetCaretRange(out int isActive, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
    }

    [ComImport, Guid("A543CC6A-F4AE-494B-8239-C814481187A8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextRange
    {
        [PreserveSig] int Clone([MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange range);
        [PreserveSig] int Compare(IUIAutomationTextRange range, out int areSame);
        [PreserveSig] int CompareEndpoints(int endpoint, IUIAutomationTextRange range, int targetEndpoint, out int comparison);
        [PreserveSig] int ExpandToEnclosingUnit(int unit);
        [PreserveSig] int FindAttribute(int attributeId, [MarshalAs(UnmanagedType.Struct)] object value, int backward, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange found);
        [PreserveSig] int FindText([MarshalAs(UnmanagedType.BStr)] string text, int backward, int ignoreCase, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange found);
        [PreserveSig] int GetAttributeValue(int attributeId, [MarshalAs(UnmanagedType.Struct)] out object value);
        // SAFEARRAY(double)*, not VARIANT*: marshalling this as a struct produced an
        // invalid OLE variable and, on the caret path, an access violation.
        [PreserveSig] int GetBoundingRectangles([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_R8)] out double[] rectangles);
        [PreserveSig] int GetEnclosingElement([MarshalAs(UnmanagedType.Interface)] out IUIAutomationElement element);
        [PreserveSig] int GetText(int maxLength, [MarshalAs(UnmanagedType.BStr)] out string text);
        // Move and MoveEndpointByUnit both carry an [out, retval] count in the IDL. A
        // declaration without it is not merely incomplete: the callee writes that int
        // through a pointer the caller never supplied.
        [PreserveSig] int Move(int unit, int count, out int moved);
        [PreserveSig] int MoveEndpointByUnit(int endpoint, int unit, int count, out int moved);
        [PreserveSig] int MoveEndpointByRange(int endpoint, IUIAutomationTextRange range, int targetEndpoint);
        [PreserveSig] int Select();
    }

    [ComImport, Guid("CE4AE76A-E717-4C98-81EA-47371D028EB6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationTextRangeArray
    {
        [PreserveSig] int get_Length(out int length);
        [PreserveSig] int GetElement(int index, [MarshalAs(UnmanagedType.Interface)] out IUIAutomationTextRange element);
    }

    [ComImport, Guid("828055AD-355B-4435-86D5-3B51C14A9B1B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IUIAutomationLegacyIAccessiblePattern
    {
        // Select and SetValue are positional filler: DoDefaultAction is the second slot
        // and the read-only properties start at the fourth.
        [PreserveSig] int Select(int childId);
        [PreserveSig] int DoDefaultAction();
        [PreserveSig] int SetValue([MarshalAs(UnmanagedType.BStr)] string value);
        int CurrentChildId { get; }
        string CurrentName { get; }
        string CurrentValue { get; }
        string CurrentDescription { get; }
    }

    /// The engine. C# owns every COM object; PowerShell passes primitives in and gets
    /// dictionaries out, because a COM interface cannot cross that boundary at all.
    public static class Engine
    {
        public const int TreeScope_Element = 1;
        public const int TreeScope_Children = 2;
        public const int TreeScope_Descendants = 4;
        public const int TreeScope_Subtree = 7;

        public const int Mode_Full = 0;
        public const int Mode_None = 1;

        public const int WindowVisualState_Normal = 0;
        public const int WindowVisualState_Maximized = 1;
        public const int WindowVisualState_Minimized = 2;

        public const int TextPatternRangeEndpoint_Start = 0;
        public const int TextPatternRangeEndpoint_End = 1;
        public const int TextUnit_Character = 0;
        public const int TextUnit_Line = 3;

        public const int UIA_BoundingRectanglePropertyId = 30001;
        public const int UIA_ProcessIdPropertyId = 30002;
        public const int UIA_ControlTypePropertyId = 30003;
        public const int UIA_NamePropertyId = 30005;
        public const int UIA_HasKeyboardFocusPropertyId = 30008;
        public const int UIA_IsKeyboardFocusablePropertyId = 30009;
        public const int UIA_IsEnabledPropertyId = 30010;
        public const int UIA_AutomationIdPropertyId = 30011;
        public const int UIA_ClassNamePropertyId = 30012;
        public const int UIA_NativeWindowHandlePropertyId = 30020;
        public const int UIA_IsOffscreenPropertyId = 30022;

        public const int UIA_InvokePatternId = 10000;
        public const int UIA_ValuePatternId = 10002;
        public const int UIA_ExpandCollapsePatternId = 10005;
        public const int UIA_WindowPatternId = 10009;
        public const int UIA_SelectionItemPatternId = 10010;
        public const int UIA_TextPatternId = 10014;
        public const int UIA_TogglePatternId = 10015;
        public const int UIA_ScrollItemPatternId = 10017;
        public const int UIA_LegacyIAccessiblePatternId = 10018;
        public const int UIA_TextPattern2Id = 10024;

        private static readonly int[] CachedProperties = new int[] {
            UIA_NamePropertyId, UIA_ControlTypePropertyId, UIA_AutomationIdPropertyId,
            UIA_ClassNamePropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId,
            UIA_BoundingRectanglePropertyId, UIA_NativeWindowHandlePropertyId,
            UIA_ProcessIdPropertyId, UIA_HasKeyboardFocusPropertyId,
            UIA_IsKeyboardFocusablePropertyId,
        };

        private static readonly int[] CachedPatternIds = new int[] {
            UIA_InvokePatternId, UIA_ValuePatternId, UIA_TextPatternId,
            UIA_SelectionItemPatternId, UIA_TogglePatternId,
            UIA_ExpandCollapsePatternId, UIA_ScrollItemPatternId,
            UIA_WindowPatternId,
        };

        private static readonly string[] CachedPatternNames = new string[] {
            "invoke", "value", "text", "select", "toggle", "expand", "scroll_item",
            "window",
        };

        private static IUIAutomation automation;
        private static string lastError = "";

        // §7.4 item 7: measure before releasing. Every short-lived COM object this engine hands
        // out is counted, and the ones with a clear scope are released where that scope ends.
        // The point of counting first is that the alternative -- calling ReleaseComObject on
        // everything in sight -- can release an element the ref registry is still holding and
        // turn a working reference into a crash. The counters say whether anything is actually
        // accumulating, and `Reset()` remains the deliberate, wholesale teardown.
        private static int elementsHandedOut = 0;
        private static int arraysCreated = 0;
        private static int arraysReleased = 0;
        private static int resets = 0;

        /// A census of the COM objects this engine has created: what was handed out, what had a
        /// scope and was released at the end of it, and how often the client was rebuilt.
        public static string Census()
        {
            return "{\"elements\":" + elementsHandedOut
                + ",\"arrays\":" + arraysCreated
                + ",\"arraysReleased\":" + arraysReleased
                + ",\"arraysLive\":" + (arraysCreated - arraysReleased)
                + ",\"resets\":" + resets + "}";
        }

        /// Release a transient COM array whose scope ends here.
        ///
        /// Only for objects this engine created for its own use inside one call -- never for an
        /// element handed to the ref registry, which is why the census counts them apart.
        private static void ReleaseTransient(object comObject)
        {
            if (comObject == null) return;
            try
            {
                Marshal.ReleaseComObject(comObject);
                arraysReleased++;
            }
            catch (Exception) { }
        }

        public static string LastError() { return lastError; }

        public static bool Available()
        {
            if (automation != null) return true;
            try
            {
                Init();
                return automation != null;
            }
            catch (Exception error)
            {
                lastError = error.GetType().Name + ": " + error.Message;
                return false;
            }
        }

        public static void Init()
        {
            if (automation != null) return;
            Guid clsid = new Guid("FF48DBA4-60EF-4201-AA87-54103EEF594E");
            object created = Activator.CreateInstance(Type.GetTypeFromCLSID(clsid));
            automation = (IUIAutomation)created;
        }

        /// Drop the UI Automation client and build a new one.
        ///
        /// The client is created once and shared by every call, and it can end up in a state
        /// where every property read comes back with a non-zero HRESULT -- a provider that
        /// stopped answering, or a COM error that leaves the client object unusable. Because
        /// `Property` turns a failed read into "no value", that state is *invisible* in the
        /// output: every row simply comes back anonymous, `skipEmpty` drops it, and the caller
        /// receives a plausible-looking tree with a handful of rows instead of an error.
        ///
        /// Measured: on a long repeated run the probe window's tree went from 16 rows to 6 and
        /// stayed that way for the rest of the process, while a freshly started worker read the
        /// same window fine. That is a client-side state, so the fix is to notice it and start
        /// over rather than to blame the window.
        public static void Reset()
        {
            try { if (automation != null) Marshal.ReleaseComObject(automation); } catch (Exception) { }
            automation = null;
            resets++;
            Init();
        }

        /// Whether the client can still read a window's own properties.
        ///
        /// A window always has a control type, so an anonymous root is a client problem and not
        /// a property of the window. One cached read, called once per tree request.
        public static bool ClientHealthy(long hwnd)
        {
            try
            {
                Init();
                IUIAutomationCacheRequest cache = NewCacheRequest(false, TreeScope_Element, false);
                IUIAutomationElement root = Root(hwnd, cache);
                object controlType = Property(root, UIA_ControlTypePropertyId, false);
                return controlType != null;
            }
            catch (Exception) { return false; }
        }

        private static IUIAutomationCacheRequest NewCacheRequest(bool withPatterns, int treeScope, bool live)
        {
            IUIAutomationCacheRequest request;
            Marshal.ThrowExceptionForHR(automation.CreateCacheRequest(out request));
            foreach (int propertyId in CachedProperties) request.AddProperty(propertyId);
            if (withPatterns)
            {
                foreach (int patternId in CachedPatternIds) request.AddPattern(patternId);
            }
            request.put_TreeScope(treeScope);
            // Mode_None means the element carries no live reference: a cached walk is
            // then one bulk fetch instead of one cross-process call per property.
            request.put_AutomationElementMode(live ? Mode_Full : Mode_None);
            return request;
        }

        private static object Property(IUIAutomationElement element, int propertyId, bool live)
        {
            object value;
            int hr = live ? element.GetCurrentPropertyValue(propertyId, out value) : element.GetCachedPropertyValue(propertyId, out value);
            if (hr != 0) return null;
            if (value == null) return null;
            if (value is int && (int)value == int.MinValue) return null;
            return value;
        }

        private static object Property(IUIAutomationElement element, int propertyId)
        {
            return Property(element, propertyId, false);
        }

        private static string Text(IUIAutomationElement element, int propertyId, bool live)
        {
            return Property(element, propertyId, live) as string ?? string.Empty;
        }

        private static string Text(IUIAutomationElement element, int propertyId)
        {
            return Text(element, propertyId, false);
        }

        private static bool Flag(IUIAutomationElement element, int propertyId, bool live)
        {
            object value = Property(element, propertyId, live);
            if (value is bool) return (bool)value;
            if (value is int) return (int)value != 0;
            return false;
        }

        private static bool Flag(IUIAutomationElement element, int propertyId)
        {
            return Flag(element, propertyId, false);
        }

        private static int Number(IUIAutomationElement element, int propertyId, bool live)
        {
            object value = Property(element, propertyId, live);
            if (value is int) return (int)value;
            if (value is double) return (int)(double)value;
            return 0;
        }

        private static int Number(IUIAutomationElement element, int propertyId)
        {
            return Number(element, propertyId, false);
        }

        private static string[] Patterns(IUIAutomationElement element, bool live)
        {
            List<string> found = new List<string>();
            for (int i = 0; i < CachedPatternIds.Length; i++)
            {
                object pattern;
                int hr = live
                    ? element.GetCurrentPattern(CachedPatternIds[i], out pattern)
                    : element.GetCachedPattern(CachedPatternIds[i], out pattern);
                if (hr == 0 && pattern != null) found.Add(CachedPatternNames[i]);
            }
            return found.ToArray();
        }

        private static string[] Patterns(IUIAutomationElement element)
        {
            return Patterns(element, false);
        }

        /// The programmatic name the tool reports. COM hands out the integer id; the
        /// managed wrapper is what used to turn it into ControlType.Button, so the
        /// mapping has to live here now.
        public static string ControlTypeName(int id)
        {
            switch (id)
            {
                case 50000: return "ControlType.Button";
                case 50001: return "ControlType.Calendar";
                case 50002: return "ControlType.CheckBox";
                case 50003: return "ControlType.ComboBox";
                case 50004: return "ControlType.Edit";
                case 50005: return "ControlType.Hyperlink";
                case 50006: return "ControlType.Image";
                case 50007: return "ControlType.ListItem";
                case 50008: return "ControlType.List";
                case 50009: return "ControlType.Menu";
                case 50010: return "ControlType.MenuBar";
                case 50011: return "ControlType.MenuItem";
                case 50012: return "ControlType.ProgressBar";
                case 50013: return "ControlType.RadioButton";
                case 50014: return "ControlType.ScrollBar";
                case 50015: return "ControlType.Slider";
                case 50016: return "ControlType.Spinner";
                case 50017: return "ControlType.StatusBar";
                case 50018: return "ControlType.Tab";
                case 50019: return "ControlType.TabItem";
                case 50020: return "ControlType.Text";
                case 50021: return "ControlType.ToolBar";
                case 50022: return "ControlType.ToolTip";
                case 50023: return "ControlType.Tree";
                case 50024: return "ControlType.TreeItem";
                case 50025: return "ControlType.Custom";
                case 50026: return "ControlType.Group";
                case 50027: return "ControlType.Thumb";
                case 50028: return "ControlType.DataGrid";
                case 50029: return "ControlType.DataItem";
                case 50030: return "ControlType.Document";
                case 50031: return "ControlType.SplitButton";
                case 50032: return "ControlType.Window";
                case 50033: return "ControlType.Pane";
                case 50034: return "ControlType.Header";
                case 50035: return "ControlType.HeaderItem";
                case 50036: return "ControlType.Table";
                case 50037: return "ControlType.TitleBar";
                case 50038: return "ControlType.Separator";
                case 50039: return "ControlType.SemanticZoom";
                case 50040: return "ControlType.AppBar";
                default: return "ControlType.Unknown";
            }
        }

        private static int Clamp(double value)
        {
            if (double.IsNaN(value)) return 0;
            if (value > 2147483647d) return 2147483647;
            if (value < -2147483648d) return -2147483648;
            return (int)Math.Round(value);
        }

        /// A rectangle as the tool reports it: NaN and infinities collapse to an empty
        /// rectangle and mark the node offscreen, everything else is clamped into
        /// int32 -- an offscreen D3D swap-chain window legitimately reports
        /// coordinates far outside the desktop.
        private static bool SetRect(Dictionary<string, object> row, object bounds)
        {
            double left = 0, top = 0, width = 0, height = 0;
            double[] four = bounds as double[];
            if (four != null && four.Length == 4)
            {
                left = four[0]; top = four[1]; width = four[2]; height = four[3];
            }
            bool finite = !(double.IsNaN(left) || double.IsInfinity(left)
                         || double.IsNaN(top) || double.IsInfinity(top)
                         || double.IsNaN(width) || double.IsInfinity(width)
                         || double.IsNaN(height) || double.IsInfinity(height));
            if (!finite) { left = 0; top = 0; width = 0; height = 0; }
            row["x"] = Clamp(left);
            row["y"] = Clamp(top);
            row["width"] = Clamp(width);
            row["height"] = Clamp(height);
            return finite;
        }

        /// One row per node.
        ///
        /// `live` selects which side of UI Automation the row is read from, and it is
        /// not cosmetic: an element resolved through a cache request has no live
        /// reference and answers only cached reads, while an element resolved with a
        /// plain FindAll has no cache and answers only live reads. Reading the wrong
        /// side yields defaults -- which is how an action receipt reported its matched
        /// window as ControlType.Unknown.
        private static Dictionary<string, object> Row(IUIAutomationElement element, int depth, bool withPatterns, bool live)
        {
            Dictionary<string, object> row = new Dictionary<string, object>();
            row["depth"] = depth;
            row["name"] = Text(element, UIA_NamePropertyId, live);
            row["controlType"] = ControlTypeName(Number(element, UIA_ControlTypePropertyId, live));
            row["automationId"] = Text(element, UIA_AutomationIdPropertyId, live);
            row["className"] = Text(element, UIA_ClassNamePropertyId, live);
            row["enabled"] = Flag(element, UIA_IsEnabledPropertyId, live);
            bool finite = SetRect(row, Property(element, UIA_BoundingRectanglePropertyId, live));
            row["offscreen"] = !finite || Flag(element, UIA_IsOffscreenPropertyId, live);
            row["patterns"] = withPatterns ? Patterns(element, live) : new string[0];
            return row;
        }

        private static Dictionary<string, object> Row(IUIAutomationElement element, int depth, bool withPatterns)
        {
            return Row(element, depth, withPatterns, false);
        }

        /// The identity test the walk uses, unchanged from the managed path: no name,
        /// no automation id and no pattern means the node is scaffolding. A rectangle
        /// or a class name does not qualify a node to be reported.
        private static bool HasIdentity(Dictionary<string, object> row)
        {
            if (((string)row["name"]).Length > 0) return true;
            if (((string)row["automationId"]).Length > 0) return true;
            return ((string[])row["patterns"]).Length > 0;
        }

        private static IUIAutomationElement Root(long hwnd, IUIAutomationCacheRequest cache)
        {
            IUIAutomationElement root;
            int hr = automation.ElementFromHandleBuildCache(new IntPtr(hwnd), cache, out root);
            if (hr != 0 || root == null)
            {
                Marshal.ThrowExceptionForHR(hr != 0 ? hr : unchecked((int)0x80004005));
            }
            elementsHandedOut++;
            return root;
        }

        /// Breadth-first walk over a cached subtree.
        ///
        /// The cache request is Element-scoped and each node costs one
        /// FindAllBuildCache, rather than one Subtree-scoped request up front. That
        /// looks like the slower design and is not: on a Chromium window the
        /// Subtree-scoped walk measured 85 ms against 21 ms for this one, because a
        /// Subtree request makes the provider materialise the whole tree eagerly.
        public static void Walk(long hwnd, int maxDepth, int maxNodes, bool withPatterns, bool skipEmpty,
                                int maxVisited, out object[] outRows, out int outWalked, out int outSkipped,
                                out bool outTruncated, out int outMaxQueue, out bool outTraversalTruncated)
        {
            Init();
            IUIAutomationCacheRequest cache = NewCacheRequest(withPatterns, TreeScope_Element, false);
            IUIAutomationElement root = Root(hwnd, cache);
            IUIAutomationCondition trueCondition;
            Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out trueCondition));

            List<object> rows = new List<object>();
            Queue<object[]> queue = new Queue<object[]>();
            queue.Enqueue(new object[] { root, 0 });
            int walked = 0, skipped = 0;
            int maxQueue = 1;
            bool truncated = false;
            bool traversalTruncated = false;

            while (queue.Count > 0)
            {
                // §7.4 item 2: the output budget and the traversal budget are separate questions.
                // `rows.Count >= maxNodes` only counts rows that were *kept*, so a tree of
                // anonymous nodes -- dropped by skipEmpty, never counted -- used to be walked
                // with no bound of its own. The visit budget is checked here, before a node is
                // visited, and it says so in the reply (`traversalTruncated`) rather than
                // silently returning a short tree; 0 means "no limit" and is what keeps the
                // default behaviour unchanged for every realistic window.
                if (maxVisited > 0 && walked >= maxVisited) { truncated = true; traversalTruncated = true; break; }
                if (rows.Count >= maxNodes) { truncated = true; break; }
                object[] item = queue.Dequeue();
                IUIAutomationElement element = (IUIAutomationElement)item[0];
                int depth = (int)item[1];
                walked++;
                Dictionary<string, object> row = Row(element, depth, withPatterns);
                if (skipEmpty && !HasIdentity(row)) skipped++;
                else rows.Add(row);

                if (depth >= maxDepth) continue;
                IUIAutomationElementArray children;
                if (element.FindAllBuildCache(TreeScope_Children, trueCondition, cache, out children) != 0 || children == null) continue;
                arraysCreated++;
                int count;
                if (children.get_Length(out count) != 0)
                {
                    // The array's scope ends here: its children have been read out and enqueued
                    // (each of those is an element the walk still owns, not this array).
                    ReleaseTransient(children);
                    continue;
                }
                for (int i = 0; i < count; i++)
                {
                    IUIAutomationElement child;
                    if (children.GetElement(i, out child) == 0 && child != null)
                    {
                        elementsHandedOut++;
                        queue.Enqueue(new object[] { child, depth + 1 });
                    }
                }
                // One array per visited node is what a walk of a large window allocates; without
                // this it stays alive until the client is rebuilt (§7.4 item 7).
                ReleaseTransient(children);
                if (queue.Count > maxQueue) maxQueue = queue.Count;
            }

            outRows = rows.ToArray();
            outWalked = walked;
            outSkipped = skipped;
            outTruncated = truncated;
            outMaxQueue = maxQueue;
            outTraversalTruncated = traversalTruncated;
        }

        /// Whether a control-type argument names exactly one UIA control type.
        ///
        /// §7.4 item 3: the tool's matching for a control type is a substring test, so only a
        /// *fully named* type (`ControlType.Button`) may be pushed down as a provider filter;
        /// `Button` -- which the substring test matches -- must not be, because an exact
        /// condition would drop rows the caller would otherwise have got.
        public static bool IsExactControlType(string wantType)
        {
            if (wantType == null) return false;
            string trimmed = wantType.Trim();
            const string prefix = "ControlType.";
            if (trimmed.Length <= prefix.Length) return false;
            if (!trimmed.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
            int id = ControlTypeIdFor(trimmed);
            return id != 0;
        }

        /// The UIA control-type id a fully named control type stands for, or 0 when unknown.
        public static int ControlTypeIdFor(string wantType)
        {
            if (wantType == null) return 0;
            string name = wantType.Trim();
            const string prefix = "ControlType.";
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) name = name.Substring(prefix.Length);
            switch (name.ToLowerInvariant())
            {
                case "button": return 50000;
                case "calendar": return 50001;
                case "checkbox": return 50002;
                case "combobox": return 50003;
                case "edit": return 50004;
                case "hyperlink": return 50005;
                case "image": return 50006;
                case "listitem": return 50007;
                case "list": return 50008;
                case "menu": return 50009;
                case "menubar": return 50010;
                case "menuitem": return 50011;
                case "progressbar": return 50012;
                case "radiobutton": return 50013;
                case "scrollbar": return 50014;
                case "slider": return 50015;
                case "spinner": return 50016;
                case "statusbar": return 50017;
                case "tab": return 50018;
                case "tabitem": return 50019;
                case "text": return 50020;
                case "toolbar": return 50021;
                case "tooltip": return 50022;
                case "tree": return 50023;
                case "treeitem": return 50024;
                case "custom": return 50025;
                case "group": return 50026;
                case "thumb": return 50027;
                case "datagrid": return 50028;
                case "dataitem": return 50029;
                case "document": return 50030;
                case "splitbutton": return 50031;
                case "window": return 50032;
                case "pane": return 50033;
                case "header": return 50034;
                case "headeritem": return 50035;
                case "table": return 50036;
                case "titlebar": return 50037;
                case "separator": return 50038;
                case "semanticzoom": return 50039;
                case "appbar": return 50040;
                default: return 0;
            }
        }

        /// Locate mode: one server-side query, then filter on cached properties only,
        /// so no per-node cross-process read happens while filtering.
        public static void Find(long hwnd, int maxNodes, bool withPatterns,
                                string wantName, string wantType, string wantId, string wantFilter,
                                out object[] outRows, out bool outTruncated)        {            Init();
            IUIAutomationCacheRequest cache = NewCacheRequest(withPatterns, TreeScope_Element, false);
            IUIAutomationElement root = Root(hwnd, cache);

            IUIAutomationCondition condition;
            // §7.4 item 3: only conditions that are *equivalent* when pushed down go to the
            // provider, so the enumeration itself is smaller. `automationId` is exact by
            // definition. A control type is pushed down only when the caller named one in full
            // (`ControlType.Button`); the tool's matching for a partial name is a substring
            // test, and turning that into an exact condition would change what the caller gets
            // -- exactly what the review warns against. The partial case keeps the true
            // condition and filters afterwards, as before.
            if (wantId.Length > 0)
            {
                Marshal.ThrowExceptionForHR(automation.CreatePropertyCondition(UIA_AutomationIdPropertyId, wantId, out condition));
            }
            else if (IsExactControlType(wantType))
            {
                Marshal.ThrowExceptionForHR(automation.CreatePropertyCondition(UIA_ControlTypePropertyId, ControlTypeIdFor(wantType), out condition));
            }
            else
            {
                Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out condition));
            }

            // The fast path is taken only for a *unique* match, and that restriction is the
            // whole proof: with exactly one node the row list has one element whatever order
            // the provider would have used, so any index resolves to the same element the
            // enumeration would have produced.
            //
            // More than one match falls through deliberately. Measured on Notepad: a shared
            // id (`MenuBar`, twice) is a case where the order of the rows is part of the
            // contract, because `index` picks by it -- and a fast path that reorders the same
            // rows is not a faster answer, it is a different one.
            //
            // A provider that fails the query falls through too, and that is the same rule as
            // the rest of this file: the PowerShell layer around this call already knows how
            // to notice a degraded client, re-create it and read again. A new failure mode
            // invented here (this path throwing on a window the walk reads fine) would be a
            // worse trade than the milliseconds it saves, so the failure is swallowed and the
            // enumeration below takes over.
            if (wantId.Length > 0 && wantName.Length == 0 && wantType.Length == 0 && wantFilter.Length == 0)
            {
                IUIAutomationElement first = TryFindUnique(root, condition);
                if (first != null)
                {
                    // Row(..., live: true): this element came from a plain FindFirst, so it
                    // carries no cache -- reading its *cached* properties yields defaults
                    // (an anonymous ControlType.Unknown row), which is exactly the failure
                    // mode that makes a "faster" path worse than no path.
                    outRows = new object[] { Row(first, 0, withPatterns, true) };
                    outTruncated = false;
                    return;
                }
            }

            IUIAutomationElementArray all;
            int hr = root.FindAllBuildCache(TreeScope_Descendants, condition, cache, out all);
            List<object> rows = new List<object>();
            bool truncated = false;
            if (hr == 0 && all != null)
            {
                int count;
                all.get_Length(out count);
                for (int i = 0; i < count; i++)
                {
                    if (rows.Count >= maxNodes) { truncated = true; break; }
                    IUIAutomationElement element;
                    if (all.GetElement(i, out element) != 0 || element == null) continue;
                    // Row(..., live: false) reads the *cached* properties the FindAll was
                    // asked to fetch -- the whole point of this path is that no per-node
                    // cross-process read happens after the query.
                    Dictionary<string, object> row = Row(element, 0, withPatterns, false);
                    string name = (string)row["name"];
                    string type = (string)row["controlType"];
                    string id = (string)row["automationId"];
                    if (wantName.Length > 0 && name.IndexOf(wantName, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (wantType.Length > 0 && type.IndexOf(wantType, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (wantFilter.Length > 0)
                    {
                        string hay = name + " " + id + " " + type;
                        if (hay.IndexOf(wantFilter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    }
                    rows.Add(row);
                }
            }
            outRows = rows.ToArray();
            outTruncated = truncated;
        }

        /// Resolve one element by selector, with the same semantics for every action:
        /// Subtree so the root is a candidate, the same three failure sentences the host
        /// maps to stable codes, and -- the part that matters for latency -- the selector
        /// pushed *into* the UI Automation query instead of applied to a list afterwards.
        ///
        /// This used to be a single FindAll(Subtree, TRUE) over every node of the window
        /// followed by live property reads for the filter, which is one cross-process
        /// call per candidate plus one per property per candidate. It is now staged, and
        /// each stage asks the provider the narrowest question that can answer it:
        ///
        ///   1. an exact AutomationId or ClassName becomes a property condition (ORed
        ///      when both are given), scoped to Descendants -- the root is only a
        ///      candidate when it is the *only* thing that can match;
        ///   2. when one node carries that identity, FindFirst answers and nothing is
        ///      enumerated at all; uniqueness is proved by asking for a second match
        ///      rather than by collecting them;
        ///   3. the name/type substrings, which no property condition can express, are
        ///      then applied to that handful of candidates;
        ///   4. only a selector with no exact property (a bare name substring, say) still
        ///      enumerates a subtree, and then it enumerates Descendants plus the root
        ///      separately instead of a Scope_Subtree FindAll.
        ///
        /// The failure shapes are unchanged on purpose: "matched", "out of range" and
        /// "no element" are what the host turns into its stable codes.
        private static IUIAutomationElement Resolve(long hwnd, string wantId, string wantName, string wantType, string wantClass,
                                                   int index, out object[] matched, out string error)
        {
            matched = new object[0];
            error = "";
            try
            {
                // No cache request on this path, deliberately.
                //
                // FindAllBuildCache fails with E_FAIL for a live element reference
                // (AutomationElementMode_Full) on every provider and every tree scope -- it
                // was measured across six scope/mode combinations, and only Mode_None ever
                // succeeded. An action needs the opposite: a Mode_None element carries no
                // reference to act through. So an action resolves a live element, and the
                // only lever is how few of them it asks for.
                IUIAutomationElement root;
                Marshal.ThrowExceptionForHR(automation.ElementFromHandle(new IntPtr(hwnd), out root));

                List<IUIAutomationElement> found = new List<IUIAutomationElement>();

                if (wantId.Length > 0 || wantClass.Length > 0)
                {
                    IUIAutomationCondition exact = AnyProperty(new string[][] {
                        new string[] { "id", wantId },
                        new string[] { "class", wantClass }
                    });
                    // Stage 1: does exactly one node carry that identity? One
                    // FindFirst answers unless the window has no such node at all,
                    // in which case the count below is zero and the answer is "did
                    // not match" -- the same verdict the old walk produced.
                    IUIAutomationElement first = FindOne(root, TreeScope_Descendants, exact);
                    if (first != null && CountMatches(root, exact) == 1)
                    {
                        if (Qualifies(first, wantId, wantName, wantType, wantClass))
                        {
                            // Stage 2: nothing to disambiguate, so the walk the old code
                            // would have performed produced exactly this answer.
                            matched = new object[] { Row(first, 0, false, true) };
                            return first;
                        }
                    }
                    else
                    {
                        // Several nodes share the identity (real applications do -- Notepad
                        // gives six status-bar cells the same automation id) or none does.
                        // These are the collection stage, and the caller's index picks.
                        IUIAutomationElementArray all;
                        int hr = root.FindAll(TreeScope_Descendants, exact, out all);
                        if (hr == 0 && all != null)
                        {
                            int count;
                            all.get_Length(out count);
                            for (int i = 0; i < count; i++)
                            {
                                IUIAutomationElement element;
                                if (all.GetElement(i, out element) != 0 || element == null) continue;
                                if (Qualifies(element, wantId, wantName, wantType, wantClass)) found.Add(element);
                            }
                        }
                        else
                        {
                            // The narrowing query itself failed. Retrying the broad form once
                            // is what keeps this compatible: a provider that refuses a
                            // property condition but answers a plain enumeration is still
                            // usable, and the caller sees the same three verdicts.
                            EnumerateEverything(root, wantId, wantName, wantType, wantClass, found);
                        }
                        CollectRoot(root, wantId, wantName, wantType, wantClass, found);
                    }
                }
                else
                {
                    // No exact property to ask for: the substrings are evaluated here, on
                    // rows the enumeration already produced.
                    EnumerateEverything(root, wantId, wantName, wantType, wantClass, found);
                }
                // The root is a candidate in every path, and it goes first -- one
                // FindAll(TreeScope_Subtree) produced exactly that order and callers rely on
                // it (see CollectRoot). The `else` path already put it there, so this only
                // has to cover the paths that enumerate without it.
                if (!found.Contains(root)) CollectRoot(root, wantId, wantName, wantType, wantClass, found);

                if (found.Count == 0)
                {
                    error = "no UI Automation element matched (automationId='" + wantId + "' name~='" + wantName + "' controlType='" + wantType + "')";
                    return null;
                }
                TraceResolve(hwnd, wantId, wantName, wantType, wantClass, index, root, found);
                if (index < 0 || index >= found.Count)
                {
                    error = "index " + index + " is out of range; " + found.Count + " element(s) matched";
                    return null;
                }
                IUIAutomationElement target = found[index];
                matched = new object[] { Row(target, 0, false, true) };
                return target;
            }
            catch (Exception failure)
            {
                error = failure.Message;
                return null;
            }
        }

        /// How many nodes the exact condition matches. The second query is only paid when
        /// the first one found something: a window with no such node answers zero, and the
        /// stroll down the whole subtree the old code took is not needed to learn that.
        ///
        /// The count comes from FindAll rather than from a second FindFirst with a "not
        /// this one" condition, because building that condition needs either a runtime-id
        /// comparison (a SAFEARRAY of integers per candidate) or a CompareElements call per
        /// candidate -- both more work than asking for the (already narrow) list once.
        private static int CountMatches(IUIAutomationElement root, IUIAutomationCondition condition)
        {
            IUIAutomationElementArray all;
            if (root.FindAll(TreeScope_Descendants, condition, out all) != 0 || all == null) return 0;
            int count;
            if (all.get_Length(out count) != 0) return 0;
            return count;
        }

        /// The one node the condition matches, or null for "not exactly one" *or* "the
        /// provider would not answer". The caller cannot tell those apart, deliberately:
        /// both mean the enumeration below has to decide.
        private static IUIAutomationElement TryFindUnique(IUIAutomationElement root, IUIAutomationCondition condition)
        {
            try
            {
                IUIAutomationElement first;
                if (root.FindFirst(TreeScope_Descendants, condition, out first) != 0 || first == null) return null;
                IUIAutomationElementArray all;
                if (root.FindAll(TreeScope_Descendants, condition, out all) != 0 || all == null) return null;
                int count;
                if (all.get_Length(out count) != 0) return null;
                return count == 1 ? first : null;
            }
            catch (Exception)
            {
                // A provider in a bad state is exactly when this must not become a new
                // failure: the walk below has the client-health recovery this call does not.
                return null;
            }
        }

        /// One FindFirst, or null. A provider that refuses the query is reported as "no
        /// match" rather than as an exception: the caller falls through to the next stage,
        /// which is where the compatibility lives.
        private static IUIAutomationElement FindOne(IUIAutomationElement root, int scope, IUIAutomationCondition condition)
        {
            IUIAutomationElement found;
            if (root == null || condition == null) return null;
            if (root.FindFirst(scope, condition, out found) != 0) return null;
            return found;
        }

        /// Everything under the root, filtered on identity, silently skipping anything the
        /// provider won't answer for.
        private static void EnumerateEverything(IUIAutomationElement root, string wantId, string wantName, string wantType,
                                                string wantClass, List<IUIAutomationElement> found)
        {
            IUIAutomationCondition everything;
            Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out everything));
            IUIAutomationElementArray all;
            if (root.FindAll(TreeScope_Descendants, everything, out all) != 0 || all == null) return;
            int count;
            all.get_Length(out count);
            for (int i = 0; i < count; i++)
            {
                IUIAutomationElement element;
                if (all.GetElement(i, out element) != 0 || element == null) continue;
                if (Qualifies(element, wantId, wantName, wantType, wantClass)) found.Add(element);
            }
        }

        /// The root element, checked against the selector like every other candidate and
        /// placed first.
        ///
        /// It has to be a candidate: a window's own element is where the WindowPattern
        /// (close / minimize / maximize / restore) lives, and `controlType: 'Window'` is
        /// exactly how a caller asks for it. One FindAll(TreeScope_Subtree) put the root
        /// first, and callers rely on that order -- a version that "optimised" the root away
        /// made `close the window` close a child pane named Window instead, which is how
        /// this rule ended up written down.
        private static void CollectRoot(IUIAutomationElement root, string wantId, string wantName,
                                        string wantType, string wantClass, List<IUIAutomationElement> found)
        {
            if (root == null) return;
            if (Qualifies(root, wantId, wantName, wantType, wantClass)) found.Insert(0, root);
        }

        /// The selector test, unchanged from the enumeration this replaced: substring on
        /// the name and the control type, exact on the id and the class. The live read is
        /// what decides in every case -- the condition stage only narrows what is asked for.
        private static bool Qualifies(IUIAutomationElement element, string wantId, string wantName, string wantType, string wantClass)
        {
            if (element == null) return false;
            if (wantId.Length > 0 && Text(element, UIA_AutomationIdPropertyId, true) != wantId) return false;
            if (wantClass.Length > 0 && Text(element, UIA_ClassNamePropertyId, true) != wantClass) return false;
            if (wantName.Length > 0 && Text(element, UIA_NamePropertyId, true).IndexOf(wantName, StringComparison.OrdinalIgnoreCase) < 0) return false;
            if (wantType.Length > 0 && ControlTypeName(Number(element, UIA_ControlTypePropertyId, true)).IndexOf(wantType, StringComparison.OrdinalIgnoreCase) < 0) return false;
            return true;
        }

        /// OR over the given exact properties, so one query can carry both an
        /// AutomationId and a ClassName without either turning into a full scan.
        private static IUIAutomationCondition AnyProperty(string[][] pairs)
        {
            IUIAutomationCondition union = null;
            List<IUIAutomationCondition> parts = new List<IUIAutomationCondition>();
            foreach (string[] pair in pairs)
            {
                if (pair == null || pair.Length < 2 || pair[1] == null || pair[1].Length == 0) continue;
                int propertyId = pair[0] == "id" ? UIA_AutomationIdPropertyId : UIA_ClassNamePropertyId;
                IUIAutomationCondition part;
                if (automation.CreatePropertyCondition(propertyId, pair[1], out part) != 0 || part == null) continue;
                parts.Add(part);
            }
            if (parts.Count == 0)
            {
                Marshal.ThrowExceptionForHR(automation.CreateTrueCondition(out union));
                return union;
            }
            if (parts.Count == 1) return parts[0];
            IUIAutomationCondition current = parts[0];
            for (int i = 1; i < parts.Count; i++)
            {
                IUIAutomationCondition next;
                Marshal.ThrowExceptionForHR(automation.CreateOrCondition(current, parts[i], out next));
                current = next;
            }
            return current;
        }

        /// Which element a selector resolved to, when DSH_COMPUTER_USE_DEBUG_RESOLVE=1.
        ///
        /// Off by default, and it writes to a file rather than to stderr because the
        /// worker's stderr belongs to the host and a line there has nowhere to land. The
        /// question this answers is the one a failure sentence cannot -- "close the
        /// window" and "the close went to something else" produce the same sentence, and
        /// the difference is this list, in order, with the root shown separately.
        private static void TraceResolve(long hwnd, string wantId, string wantName, string wantType, string wantClass,
                                         int index, IUIAutomationElement root, List<IUIAutomationElement> found)
        {
            if (Environment.GetEnvironmentVariable("DSH_COMPUTER_USE_DEBUG_RESOLVE") != "1") return;
            try
            {
                StringBuilder trace = new StringBuilder();
                trace.Append(DateTime.Now.ToString("HH:mm:ss.fff"));
                trace.Append(" resolve hwnd=" + hwnd + " id='" + wantId + "' name~='" + wantName + "' type~='" + wantType
                    + "' class='" + wantClass + "' index=" + index + " candidates=" + found.Count);
                for (int i = 0; i < found.Count && i < 16; i++)
                {
                    IUIAutomationElement probe = found[i];
                    trace.Append(" | " + i + ":" + Describe(probe));
                }
                trace.Append(" | root:" + Describe(root));
                System.IO.File.AppendAllText(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dsh-computer-use-resolve-trace.log"),
                    trace.ToString() + Environment.NewLine);
            }
            catch (Exception)
            {
                // A diagnostic that can fail a call is worse than no diagnostic.
            }
        }

        /// One line of an element's identity, for the trace above.
        private static string Describe(IUIAutomationElement element)
        {
            if (element == null) return "(none)";
            return ControlTypeName(Number(element, UIA_ControlTypePropertyId, true))
                + " '" + Text(element, UIA_NamePropertyId, true) + "' #" + Text(element, UIA_AutomationIdPropertyId, true);
        }

        /// A control type name as its UIA number, from any spelling the caller may use:
        /// the tool's own "Button", the tree's "ControlType.Button", or the raw value.
        /// Kept for the stages that want a numeric type -- the selector test itself reads
        /// the live property, because that read is what decides.
        private static int ControlTypeValue(string wantType)
        {
            if (wantType == null || wantType.Length == 0) return 0;
            string text = wantType.Trim();
            if (text.StartsWith("ControlType.", StringComparison.OrdinalIgnoreCase)) text = text.Substring("ControlType.".Length);
            int number;
            if (int.TryParse(text, out number)) return number;
            return ControlTypeId(text);
        }

        /// The reverse of ControlTypeName, for the property condition.
        private static int ControlTypeId(string name)
        {
            for (int i = 50000; i <= 50040; i++)
            {
                if (ControlTypeName(i).EndsWith("." + name, StringComparison.OrdinalIgnoreCase)) return i;
            }
            return 0;
        }

        /// Find the range that holds `text`, honouring prefix/suffix context.
        ///
        /// Positioning by character offset is deliberately not offered: walking to an
        /// offset costs one cross-process call per character. Finding the text and then
        /// verifying the context around the hit costs a handful of calls at any offset.
        private static IUIAutomationTextRange FindRange(IUIAutomationTextPattern pattern, string text, string prefix, string suffix,
                                                        int attempts, out string error)
        {
            error = "";
            IUIAutomationTextRange search;
            Marshal.ThrowExceptionForHR(pattern.GetDocumentRange(out search));
            for (int attempt = 0; attempt < attempts; attempt++)
            {
                IUIAutomationTextRange candidate;
                int hr = search.FindText(text, 0, 0, out candidate);
                if (hr != 0 || candidate == null) break;
                if (prefix.Length == 0 && suffix.Length == 0) return candidate;

                // Read a context window around the hit and compare it. The move returns
                // how far it actually moved, which is how much context exists there.
                IUIAutomationTextRange probe;
                Marshal.ThrowExceptionForHR(candidate.Clone(out probe));
                int moved = 0;
                if (prefix.Length > 0)
                {
                    try { probe.MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -prefix.Length, out moved); } catch { }
                }
                if (suffix.Length > 0)
                {
                    try { probe.MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, suffix.Length, out moved); } catch { }
                }
                string context;
                try { probe.GetText(-1, out context); } catch { context = ""; }
                context = context ?? "";
                bool okPrefix = prefix.Length == 0 || context.StartsWith(prefix, StringComparison.Ordinal);
                bool okSuffix = suffix.Length == 0 || context.EndsWith(suffix, StringComparison.Ordinal);
                if (okPrefix && okSuffix) return candidate;

                // Not the right occurrence: restart the search just past this hit.
                Marshal.ThrowExceptionForHR(pattern.GetDocumentRange(out search));
                Marshal.ThrowExceptionForHR(search.Clone(out search));
                Marshal.ThrowExceptionForHR(search.MoveEndpointByRange(TextPatternRangeEndpoint_Start, candidate, TextPatternRangeEndpoint_End));
            }
            // A context that never matches has more than one cause, and the caller's next
            // move depends on which. The one worth naming: a provider may count characters
            // where this code counts UTF-16 code units, and for anything outside the Basic
            // Multilingual Plane -- an emoji, a rare han character -- moving by
            // String.Length lands the boundary between the halves of a surrogate pair.
            // Reporting that as "not found" sends the caller hunting for a text that is
            // right there.
            bool nonBmp = HasSurrogate(text) || HasSurrogate(prefix) || HasSurrogate(suffix);
            if (nonBmp) {
                error = "the text '" + text + "' was not found with the given prefix/suffix in this element, and one of them contains a character outside the Basic Multilingual Plane (a surrogate pair): this provider's character arithmetic may differ from UTF-16 code units, so the range boundary would fall inside a character. Retry without prefix/suffix, or with a prefix that is plain text; nothing was selected";
            } else {
                error = (prefix.Length > 0 || suffix.Length > 0)
                    ? "the text '" + text + "' was not found with the given prefix/suffix in this element; nothing was selected"
                    : "the text '" + text + "' was not found in this element";
            }
            return null;
        }

        /// Whether a string carries a UTF-16 surrogate pair, i.e. a character outside the
        /// Basic Multilingual Plane.
        private static bool HasSurrogate(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            for (int i = 0; i < value.Length; i++)
            {
                if (char.IsSurrogate(value[i])) return true;
            }
            return false;
        }

        /// The first rectangle of a range, in screen coordinates. A range spanning
        /// several lines reports one quadruple per line; the first one is where the
        /// text starts, which is what a click wants.
        private static bool RangeRect(IUIAutomationTextRange range, out int x, out int y, out int width, out int height)
        {
            x = 0; y = 0; width = 0; height = 0;
            double[] rects;
            if (range.GetBoundingRectangles(out rects) != 0) return false;
            if (rects == null || rects.Length < 4) return false;
            x = Clamp(rects[0]);
            y = Clamp(rects[1]);
            width = Clamp(rects[2]);
            height = Clamp(rects[3]);
            return width > 0 && height > 0;
        }

        /// The bounding box of every line the range covers, plus how many lines that is.
        /// Where a wrapped paragraph sits is its extent, not its first line.
        private static bool RangeUnionRect(IUIAutomationTextRange range, out int x, out int y, out int width, out int height, out int lines)
        {
            x = 0; y = 0; width = 0; height = 0; lines = 0;
            double[] rects;
            if (range.GetBoundingRectangles(out rects) != 0) return false;
            if (rects == null || rects.Length < 4) return false;
            int left = int.MaxValue, top = int.MaxValue, right = int.MinValue, bottom = int.MinValue;
            for (int i = 0; i + 3 < rects.Length; i += 4)
            {
                double rectWidth = rects[i + 2];
                double rectHeight = rects[i + 3];
                if (rectWidth <= 0 || rectHeight <= 0) continue;
                int lineLeft = Clamp(rects[i]);
                int lineTop = Clamp(rects[i + 1]);
                int lineRight = Clamp(rects[i] + rectWidth);
                int lineBottom = Clamp(rects[i + 1] + rectHeight);
                if (lineLeft < left) left = lineLeft;
                if (lineTop < top) top = lineTop;
                if (lineRight > right) right = lineRight;
                if (lineBottom > bottom) bottom = lineBottom;
                lines++;
            }
            if (lines == 0) return false;
            x = left; y = top; width = right - left; height = bottom - top;
            return width > 0 && height > 0;
        }

        /// Locate a string inside a text element and report where it is on screen.
        /// This is what lets a caller address something by its text instead of by
        /// coordinates.
        public static void LocateText(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                      string text, string prefix, string suffix, int attempts,
                                      out int outX, out int outY, out int outWidth, out int outHeight,
                                      out string outFound, out object[] outMatched, out string outError)
        {
            outX = 0; outY = 0; outWidth = 0; outHeight = 0;
            outFound = "";
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                if (text == null || text.Length == 0)
                {
                    outError = "click_text requires the text to locate";
                    return;
                }
                prefix = prefix ?? "";
                suffix = suffix ?? "";
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                IUIAutomationTextPattern pattern = Pattern<IUIAutomationTextPattern>(target, UIA_TextPatternId,
                    "TextPattern, so its text cannot be located (try ValuePattern through get_value instead)");
                string error;
                IUIAutomationTextRange hit = FindRange(pattern, text, prefix, suffix, attempts, out error);
                if (hit == null) { outError = error; return; }
                string found;
                try { hit.GetText(-1, out found); } catch { found = text; }
                outFound = found ?? text;
                if (!RangeRect(hit, out outX, out outY, out outWidth, out outHeight))
                {
                    outError = "the matched text reported no on-screen rectangle, so there is nothing to click: this provider does not support text geometry";
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Where the caret is, and which line it sits on.
        ///
        /// TextPattern2 is the only way to ask this: TextPattern has no caret accessor
        /// at all, and the managed wrapper does not expose TextPattern2 either. A caret
        /// range is degenerate, so its own rectangle is usually empty -- the enclosing
        /// line is what carries geometry.
        public static void ReadCaret(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                     out bool outActive, out string outLine, out int outX, out int outY, out int outWidth, out int outHeight,
                                     out object[] outMatched, out string outError)
        {
            outActive = false;
            outLine = "";
            outX = 0; outY = 0; outWidth = 0; outHeight = 0;
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                IUIAutomationTextPattern2 pattern = Pattern<IUIAutomationTextPattern2>(target, UIA_TextPattern2Id,
                    "TextPattern2, so the caret position cannot be read (get_text still works through TextPattern)");
                int active;
                IUIAutomationTextRange caret;
                Marshal.ThrowExceptionForHR(pattern.GetCaretRange(out active, out caret));
                outActive = active != 0;
                if (caret == null) return;

                // Geometry: the caret's own rectangle when the provider gives one, the
                // enclosing line otherwise.
                if (!RangeRect(caret, out outX, out outY, out outWidth, out outHeight))
                {
                    IUIAutomationTextRange line;
                    Marshal.ThrowExceptionForHR(caret.Clone(out line));
                    Marshal.ThrowExceptionForHR(line.ExpandToEnclosingUnit(TextUnit_Line));
                    RangeRect(line, out outX, out outY, out outWidth, out outHeight);
                    string lineText;
                    try { line.GetText(-1, out lineText); } catch { lineText = ""; }
                    outLine = Trim(lineText ?? "");
                }
                else
                {
                    IUIAutomationTextRange line;
                    Marshal.ThrowExceptionForHR(caret.Clone(out line));
                    Marshal.ThrowExceptionForHR(line.ExpandToEnclosingUnit(TextUnit_Line));
                    string lineText;
                    try { line.GetText(-1, out lineText); } catch { lineText = ""; }
                    outLine = Trim(lineText ?? "");
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Collapse whitespace and cap the length: this ends up in a receipt.
        private static string Trim(string value)
        {
            string collapsed = value.Replace("\r", " ").Replace("\n", " ").Trim();
            while (collapsed.Contains("  ")) collapsed = collapsed.Replace("  ", " ");
            return collapsed.Length > 120 ? collapsed.Substring(0, 120) : collapsed;
        }

        /// What an older control offers through the MSAA bridge: value, then name,
        /// then description. Empty when it offers none of them.
        private static string LegacyText(IUIAutomationElement element)
        {
            object raw;
            if (element.GetCurrentPattern(UIA_LegacyIAccessiblePatternId, out raw) != 0 || raw == null) return "";
            IUIAutomationLegacyIAccessiblePattern legacy = raw as IUIAutomationLegacyIAccessiblePattern;
            if (legacy == null) return "";
            string value = legacy.CurrentValue ?? "";
            if (value.Length > 0) return value;
            string name = legacy.CurrentName ?? "";
            if (name.Length > 0) return name;
            return legacy.CurrentDescription ?? "";
        }

        /// B1 (8.txt §5): the text a read can carry, read through the client that read the
        // tree.
        ///
        /// It lives here rather than in the managed wrapper because of a measured
        /// difference on the same window: the COM client answered 11 rows with their
        /// automation ids while the managed client answered 2 anonymous rows (a WinForms
        /// window served through the MSAA bridge). A text target resolved through the
        /// managed API therefore reports `target_required` on a window the caller is
        /// plainly looking at. §5 asks for both engines; the managed implementation stays
        /// as the fallback for a host where COM is unavailable.
        ///
        /// Everything is live-read: an element resolved through a plain FindAll has no
        /// cache behind it, and a cached read would answer with defaults.
        public static Dictionary<string, object> ReadTextObservation(long hwnd, string wantId, string wantName, string wantType,
                                                                    string wantClass, int index, bool useFocused,
                                                                    bool wantFocused, bool wantSelection, bool wantDocument,
                                                                    int maxChars)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["status"] = "";
            result["note"] = "";
            result["error"] = "";
            result["autoId"] = "";
            result["name"] = "";
            result["controlType"] = "";
            result["cx"] = 0;
            result["cy"] = 0;
            result["pid"] = 0L;
            result["focusedSummary"] = "";
            result["selection"] = "";
            result["selectionStatus"] = "";
            result["selectionTruncated"] = false;
            result["document"] = "";
            result["documentStatus"] = "";
            result["documentTruncated"] = false;
            result["hasTextPattern"] = false;
            try
            {
                Init();
                IUIAutomationElement target = null;
                if (useFocused)
                {
                    IUIAutomationElement focusedElement;
                    if (automation.GetFocusedElement(out focusedElement) != 0 || focusedElement == null)
                    {
                        result["status"] = "unavailable";
                        result["note"] = "no element currently holds the focus";
                        return result;
                    }
                    target = focusedElement;
                }
                else
                {
                    object[] matched;
                    string resolveError;
                    target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out matched, out resolveError);
                    if (target == null)
                    {
                        result["status"] = "unavailable";
                        result["note"] = resolveError;
                        return result;
                    }
                }
                result["status"] = "ok";
                string automationId = Text(target, UIA_AutomationIdPropertyId, true);
                string elementName = Text(target, UIA_NamePropertyId, true);
                string controlType = ControlTypeName(Number(target, UIA_ControlTypePropertyId, true));
                result["autoId"] = automationId;
                result["name"] = elementName;
                result["controlType"] = controlType;
                result["pid"] = Number(target, UIA_ProcessIdPropertyId, true);
                object bounds = Property(target, UIA_BoundingRectanglePropertyId, true);
                double[] four = bounds as double[];
                if (four != null && four.Length == 4)
                {
                    result["cx"] = Clamp(four[0] + four[2] / 2.0);
                    result["cy"] = Clamp(four[1] + four[3] / 2.0);
                }
                if (wantFocused)
                {
                    string summary = controlType.Replace("ControlType.", "");
                    if (elementName.Length > 0) summary += " \u00b7 " + elementName;
                    object rawValue;
                    if (target.GetCurrentPattern(UIA_ValuePatternId, out rawValue) == 0 && rawValue != null)
                    {
                        IUIAutomationValuePattern valuePattern = rawValue as IUIAutomationValuePattern;
                        if (valuePattern != null)
                        {
                            string value = valuePattern.CurrentValue ?? "";
                            if (value.Length > 0) summary += " \u00b7 value: " + value;
                        }
                    }
                    result["focusedSummary"] = summary;
                }

                object rawText;
                bool hasText = target.GetCurrentPattern(UIA_TextPatternId, out rawText) == 0 && rawText != null;
                IUIAutomationTextPattern textPattern = hasText ? rawText as IUIAutomationTextPattern : null;
                if (textPattern == null) hasText = false;
                result["hasTextPattern"] = hasText;

                if (wantSelection)
                {
                    if (!hasText)
                    {
                        result["selectionStatus"] = "unsupported";
                    }
                    else
                    {
                        try
                        {
                            IUIAutomationTextRangeArray ranges;
                            Marshal.ThrowExceptionForHR(textPattern.GetSelection(out ranges));
                            StringBuilder joined = new StringBuilder();
                            int pieces = 0;
                            if (ranges != null)
                            {
                                int length;
                                if (ranges.get_Length(out length) == 0)
                                {
                                    for (int i = 0; i < length; i++)
                                    {
                                        IUIAutomationTextRange range;
                                        if (ranges.GetElement(i, out range) != 0 || range == null) continue;
                                        string piece;
                                        try { range.GetText(maxChars + 1, out piece); } catch { piece = ""; }
                                        if (string.IsNullOrEmpty(piece)) continue;
                                        if (joined.Length > 0) joined.Append('\n');
                                        joined.Append(piece);
                                        pieces++;
                                        if (joined.Length > maxChars) break;
                                    }
                                }
                            }
                            string selection = joined.ToString();
                            if (selection.Length > maxChars)
                            {
                                selection = CutAt(maxChars, selection);
                                result["selectionTruncated"] = true;
                            }
                            result["selection"] = selection;
                            result["selectionStatus"] = "ok";
                        }
                        catch (Exception selectionError)
                        {
                            result["selectionStatus"] = "failed";
                            result["note"] = selectionError.Message;
                        }
                    }
                }

                if (wantDocument)
                {
                    if (!hasText)
                    {
                        result["documentStatus"] = "unsupported";
                    }
                    else
                    {
                        try
                        {
                            IUIAutomationTextRange document;
                            Marshal.ThrowExceptionForHR(textPattern.GetDocumentRange(out document));
                            string documentText = "";
                            if (document != null)
                            {
                                try { document.GetText(maxChars + 1, out documentText); } catch { documentText = ""; }
                            }
                            documentText = documentText ?? "";
                            if (documentText.Length > maxChars)
                            {
                                documentText = CutAt(maxChars, documentText);
                                result["documentTruncated"] = true;
                            }
                            result["document"] = documentText;
                            result["documentStatus"] = "ok";
                        }
                        catch (Exception documentError)
                        {
                            result["documentStatus"] = "failed";
                            result["note"] = documentError.Message;
                        }
                    }
                }
            }
            catch (Exception error)
            {
                result["error"] = error.Message;
                if (string.IsNullOrEmpty((string)result["status"])) result["status"] = "failed";
            }
            return result;
        }

        /// A cut that never lands between the halves of a character outside the BMP.
        private static string CutAt(int limit, string value)
        {
            if (value == null) return "";
            if (limit <= 0) return "";
            if (value.Length <= limit) return value;
            int cut = limit;
            if (char.IsHighSurrogate(value[cut - 1])) cut--;
            return value.Substring(0, cut);
        }

        /// Read an element's document text. The 4000-character ceiling and the
        /// truncated flag match the managed path exactly: the model gets the same
        /// answer whichever engine produced it.
        public static void ReadText(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                    out string outText, out bool outTruncated, out object[] outMatched, out string outError)
        {
            outText = "";
            outTruncated = false;
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                object rawPattern;
                if (target.GetCurrentPattern(UIA_TextPatternId, out rawPattern) != 0 || !(rawPattern is IUIAutomationTextPattern))
                {
                    // No text provider. Older controls still carry their content in the
                    // MSAA bridge, and a read the caller asked for is worth answering
                    // from there rather than failing.
                    outText = LegacyText(target);
                    if (outText.Length == 0)
                    {
                        outError = "the matched element does not support TextPattern, so its text cannot be read or selected (try ValuePattern through get_value instead)";
                    }
                    return;
                }
                IUIAutomationTextPattern pattern = (IUIAutomationTextPattern)rawPattern;
                IUIAutomationTextRange document;
                Marshal.ThrowExceptionForHR(pattern.GetDocumentRange(out document));
                string text;
                Marshal.ThrowExceptionForHR(document.GetText(4001, out text));
                text = text ?? "";
                if (text.Length > 4000)
                {
                    outText = text.Substring(0, 4000);
                    outTruncated = true;
                }
                else
                {
                    outText = text;
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Locate a string inside a text element and select it -- or collapse onto one
        /// of its edges to place the caret.
        ///
        /// Positioning by character offset is deliberately not offered: walking to an
        /// offset costs one cross-process call per character. Finding the text and then
        /// verifying the context around the hit costs a handful of calls at any offset.
        public static void SelectText(long hwnd, string wantId, string wantName, string wantType, string wantClass, int index,
                                      string text, string prefix, string suffix, string selectionType, int attempts,
                                      out string outSelected, out object[] outMatched, out string outError)
        {
            outSelected = "";
            outMatched = new object[0];
            outError = "";
            try
            {
                Init();
                if (text == null || text.Length == 0)
                {
                    outError = "select_text requires the text to locate";
                    return;
                }
                prefix = prefix ?? "";
                suffix = suffix ?? "";
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;
                IUIAutomationTextPattern pattern = Pattern<IUIAutomationTextPattern>(target, UIA_TextPatternId,
                    "TextPattern, so its text cannot be read or selected (try ValuePattern through get_value instead)");

                string rangeError;
                IUIAutomationTextRange hit = FindRange(pattern, text, prefix, suffix, attempts, out rangeError);
                if (hit == null) { outError = rangeError; return; }

                if (selectionType == "cursor_before")
                {
                    Marshal.ThrowExceptionForHR(hit.MoveEndpointByRange(TextPatternRangeEndpoint_End, hit, TextPatternRangeEndpoint_Start));
                }
                else if (selectionType == "cursor_after")
                {
                    Marshal.ThrowExceptionForHR(hit.MoveEndpointByRange(TextPatternRangeEndpoint_Start, hit, TextPatternRangeEndpoint_End));
                }
                Marshal.ThrowExceptionForHR(hit.Select());
                string selected;
                try { hit.GetText(-1, out selected); } catch { selected = ""; }
                outSelected = selected ?? "";
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Resolve one element and perform an action on it.
        ///
        /// The error strings deliberately reuse the wording the managed path uses:
        /// the host maps a failure to its stable code by matching those phrases, so a
        /// different sentence here would silently turn ELEMENT_UNAVAILABLE into an
        /// uncoded error.
        public static void Act(long hwnd, string action,
                               string wantId, string wantName, string wantType, string wantClass, int index,
                               string value, out object[] outMatched, out string outValue, out bool outWrote, out string outError)
        {
            outMatched = new object[0];
            outValue = "";
            outWrote = true;
            outError = "";
            try
            {
                Init();
                IUIAutomationElement target = Resolve(hwnd, wantId, wantName, wantType, wantClass, index, out outMatched, out outError);
                if (target == null) return;

                bool reading = action == "get_value";
                if (!reading && !Flag(target, UIA_IsEnabledPropertyId, true))
                {
                    Dictionary<string, object> matchedRow = (Dictionary<string, object>)outMatched[0];
                    outError = "the matched element is disabled (" + Label(matchedRow) + "), so it would ignore the action; nothing was sent";
                    return;
                }

                switch (action)
                {
                    case "invoke":
                    {
                        IUIAutomationInvokePattern pattern = Pattern<IUIAutomationInvokePattern>(target, UIA_InvokePatternId, "Invoke");
                        Marshal.ThrowExceptionForHR(pattern.Invoke());
                        break;
                    }
                    case "set_value":
                    {
                        IUIAutomationValuePattern pattern = Pattern<IUIAutomationValuePattern>(target, UIA_ValuePatternId, "ValuePattern.SetValue");
                        Marshal.ThrowExceptionForHR(pattern.SetValue(value));
                        outValue = value;
                        break;
                    }
                    case "get_value":
                    {
                        outWrote = false;
                        object raw;
                        if (target.GetCurrentPattern(UIA_ValuePatternId, out raw) == 0 && raw != null)
                        {
                            IUIAutomationValuePattern pattern = raw as IUIAutomationValuePattern;
                            if (pattern != null) { outValue = pattern.CurrentValue ?? ""; break; }
                        }
                        // Older controls carry their value in the MSAA bridge instead.
                        // Reading it is safe, so a missing ValuePattern falls back
                        // rather than failing a read the user asked for.
                        string legacyValue = LegacyText(target);
                        if (legacyValue.Length > 0) { outValue = legacyValue; break; }
                        outError = "the matched element does not support ValuePattern";
                        break;
                    }
                    case "toggle":
                    {
                        IUIAutomationTogglePattern pattern = Pattern<IUIAutomationTogglePattern>(target, UIA_TogglePatternId, "Toggle");
                        Marshal.ThrowExceptionForHR(pattern.Toggle());
                        break;
                    }
                    case "select":
                    {
                        IUIAutomationSelectionItemPattern pattern = Pattern<IUIAutomationSelectionItemPattern>(target, UIA_SelectionItemPatternId, "SelectionItem");
                        Marshal.ThrowExceptionForHR(pattern.Select());
                        break;
                    }
                    case "expand":
                    case "collapse":
                    {
                        IUIAutomationExpandCollapsePattern pattern = Pattern<IUIAutomationExpandCollapsePattern>(target, UIA_ExpandCollapsePatternId, "ExpandCollapse");
                        Marshal.ThrowExceptionForHR(action == "expand" ? pattern.Expand() : pattern.Collapse());
                        break;
                    }
                    case "scroll_into_view":
                    {
                        IUIAutomationScrollItemPattern pattern = Pattern<IUIAutomationScrollItemPattern>(target, UIA_ScrollItemPatternId, "ScrollItemPattern.ScrollIntoView (it is not inside a scrollable container)");
                        Marshal.ThrowExceptionForHR(pattern.ScrollIntoView());
                        break;
                    }
                    case "focus":
                    {
                        Marshal.ThrowExceptionForHR(target.SetFocus());
                        break;
                    }
                    case "close":
                    {
                        // What alt+f4 does, minus the requirement that the window hold
                        // the foreground and minus any synthesized input.
                        IUIAutomationWindowPattern pattern = Pattern<IUIAutomationWindowPattern>(target, UIA_WindowPatternId, "WindowPattern (close/minimize/maximize/restore)");
                        Marshal.ThrowExceptionForHR(pattern.Close());
                        break;
                    }
                    case "minimize":
                    case "maximize":
                    case "restore":
                    {
                        IUIAutomationWindowPattern pattern = Pattern<IUIAutomationWindowPattern>(target, UIA_WindowPatternId, "WindowPattern (close/minimize/maximize/restore)");
                        int state = action == "minimize" ? WindowVisualState_Minimized : (action == "maximize" ? WindowVisualState_Maximized : WindowVisualState_Normal);
                        Marshal.ThrowExceptionForHR(pattern.SetWindowVisualState(state));
                        break;
                    }
                    case "legacy_action":
                    {
                        IUIAutomationLegacyIAccessiblePattern pattern = Pattern<IUIAutomationLegacyIAccessiblePattern>(target, UIA_LegacyIAccessiblePatternId, "LegacyIAccessiblePattern.DoDefaultAction");
                        Marshal.ThrowExceptionForHR(pattern.DoDefaultAction());
                        break;
                    }
                    default:
                        outError = "unknown UI Automation action '" + action + "'";
                        break;
                }
            }
            catch (Exception error)
            {
                outError = error.Message;
            }
        }

        /// Fetch one pattern and hand it back as its interface, or fail with the
        /// sentence the host maps to ACTION_UNAVAILABLE.
        private static T Pattern<T>(IUIAutomationElement element, int patternId, string label) where T : class
        {
            object raw;
            int hr = element.GetCurrentPattern(patternId, out raw);
            if (hr != 0 || raw == null)
            {
                throw new InvalidOperationException("the matched element does not support " + label);
            }
            T typed = raw as T;
            if (typed == null)
            {
                throw new InvalidOperationException("the matched element does not support " + label);
            }
            return typed;
        }

        /// The label the receipt uses for a matched element.
        private static string Label(Dictionary<string, object> row)
        {
            string type = ((string)row["controlType"]).Replace("ControlType.", "");
            string name = (string)row["name"];
            string id = (string)row["automationId"];
            string label = "(" + type + ")";
            if (name.Length > 0) label = type + " \"" + name + "\"";
            if (id.Length > 0) label = label + " #" + id;
            return label;
        }
    }
}
'@

$script:ComUiaReady = $false
try {
    Add-Type -TypeDefinition $uiaComSource -Language CSharp | Out-Null
    $script:ComUiaReady = [DshUia.Engine]::Available()
    if (-not $script:ComUiaReady) {
        $script:ComUiaError = [DshUia.Engine]::LastError()
    }
} catch {
    $script:ComUiaReady = $false
    $script:ComUiaError = $_.Exception.Message
}

$dpiMode = [DshNative]::EnableDpiAwareness()
# What it actually is, which is what decides whether coordinates are real pixels.
$dpiActual = [DshNative]::ActualDpiAwareness()
if ($dpiActual -ne 'per-monitor' -and $dpiActual -ne 'per-monitor-v2') {
    # Not fatal -- the plugin still works -- but every coordinate on a scaled display may
    # be virtualized, so it is worth saying out loud rather than discovering as "clicks
    # land slightly off".
    [Console]::Error.WriteLine("dsh-computer-use: DPI awareness is '$dpiActual' (asked for '$dpiMode'); on a scaled display screen coordinates may be virtualized")
}


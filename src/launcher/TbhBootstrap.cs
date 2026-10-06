using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using System.Threading;
using System.Security.Principal;
using System.Diagnostics;

[assembly: AssemblyTitle("TBH助手")]
[assembly: AssemblyDescription("TBH助手")]
[assembly: AssemblyProduct("TBH助手")]
[assembly: AssemblyCompany("Awan")]
[assembly: AssemblyVersion("1.3.61.0")]
[assembly: AssemblyFileVersion("1.3.61.0")]

internal static class TbhBootstrap
{
    private const string AppFileName = "TBH-Helper-v1.3.61.jar";
    private const string RuntimeFolder = "runtime";

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetProcAddress(IntPtr module, string name);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void InitArgs(byte tool, byte disableArgFiles);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void ParseArgs(IntPtr commandLine);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int GetArgCount();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr GetArgValues();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int LaunchJava(int argc, IntPtr argv, int jargc, IntPtr jargv,
        int appclassc, IntPtr appclassv, IntPtr fullVersion, IntPtr version,
        IntPtr programName, IntPtr launcherName, byte javaArgs, byte wildcard, byte windowed, int ergonomic);

    [StructLayout(LayoutKind.Sequential)]
    private struct StandardArg { public IntPtr Value; public byte Wildcard; }

    private static T Function<T>(IntPtr module, string name) where T : class
    {
        IntPtr address = GetProcAddress(module, name);
        if (address == IntPtr.Zero) throw new EntryPointNotFoundException(name);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
    }

    /// <summary>助手根目录：安装包内 exe 与 runtime 同级，旧布局则回退到上级目录。</summary>
    private static string AppRoot()
    {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        if (File.Exists(Path.Combine(folder, RuntimeFolder, "bin", "jli.dll"))) return folder;
        if (File.Exists(Path.Combine(folder, "jre", "bin", "jli.dll"))) return folder;
        string parent = Path.GetFullPath(Path.Combine(folder, "..", ".."));
        if (File.Exists(Path.Combine(parent, RuntimeFolder, "bin", "jli.dll"))) return parent;
        if (File.Exists(Path.Combine(parent, "jre", "bin", "jli.dll"))) return parent;
        throw new DirectoryNotFoundException("未找到助手内置运行库，请从完整安装文件夹启动。");
    }

    private static string RuntimeRoot(string root)
    {
        string bundled = Path.Combine(root, RuntimeFolder);
        if (File.Exists(Path.Combine(bundled, "bin", "jli.dll"))) return bundled;
        return Path.Combine(root, "jre");
    }

    private static string AppFile(string root)
    {
        string bundled = Path.Combine(root, AppFileName);
        if (File.Exists(bundled)) return bundled;
        string[] found = Directory.GetFiles(root, "TBH-Helper-v*.jar");
        if (found.Length > 0) { Array.Sort(found, StringComparer.OrdinalIgnoreCase); return found[found.Length - 1]; }
        throw new FileNotFoundException("助手程序文件缺失。", bundled);
    }

    private static string Quote(string value)
    {
        StringBuilder quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            quoted.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            quoted.Append(c);
            slashes = 0;
        }
        quoted.Append('\\', slashes * 2);
        return quoted.Append('"').ToString();
    }

    private static IntPtr NativeString(string value, List<IntPtr> allocated)
    {
        byte[] bytes = Encoding.Default.GetBytes(value + "\0");
        IntPtr pointer = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        allocated.Add(pointer);
        return pointer;
    }

    private static string RuntimeVersion(string runtime, string key, string fallback)
    {
        string release = Path.Combine(runtime, "release");
        if (File.Exists(release))
            foreach (string line in File.ReadAllLines(release))
                if (line.StartsWith(key + "=", StringComparison.Ordinal))
                    return line.Substring(key.Length + 1).Trim('"');
        return fallback;
    }

    /// <summary>已提权时写入 elevated 标记，否则写入 standard，供界面红字提示使用。</summary>
    private static void WriteAdminMarker(string root)
    {
        try
        {
            bool elevated;
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            {
                WindowsPrincipal principal = new WindowsPrincipal(identity);
                elevated = principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            File.WriteAllText(Path.Combine(root, "admin-status.txt"),
                elevated ? "elevated" : "standard", new UTF8Encoding(false));
        }
        catch { }
    }

    private static bool IsElevated()
    {
        try
        {
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            {
                return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            }
        }
        catch { return false; }
    }

    /// <summary>读取 settings.properties，判断防掉线看门狗是否已启用。</summary>
    private static bool WatchdogEnabled(string root)
    {
        try
        {
            string file = Path.Combine(root, "settings.properties");
            if (!File.Exists(file)) return false;
            foreach (string line in File.ReadAllLines(file))
            {
                string trimmed = line.Trim();
                if (trimmed.StartsWith("watchdog_enabled", StringComparison.OrdinalIgnoreCase))
                {
                    int equals = trimmed.IndexOf('=');
                    if (equals < 0) return false;
                    return trimmed.Substring(equals + 1).Trim().Equals("true", StringComparison.OrdinalIgnoreCase);
                }
            }
        }
        catch { }
        return false;
    }

    /// <summary>
    /// 非管理员时尝试用 runas 重新启动自身。返回 true 表示已交给提权后的新进程，
    /// 当前进程应退出；返回 false 表示用户拒绝提权，继续以普通权限运行。
    /// </summary>
    private static bool TryRelaunchElevated()
    {
        if (IsElevated()) return false;
        try
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = Assembly.GetExecutingAssembly().Location;
            info.UseShellExecute = true;
            info.Verb = "runas";
            Process.Start(info);
            return true;
        }
        catch
        {
            return false;
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        string root = null;
        List<IntPtr> allocated = new List<IntPtr>();
        Mutex instance = null;
        bool ownsInstance = false;
        try
        {
            // 仅在启用防掉线时才需要管理员权限：此时先尝试提权。
            // 提权后的新进程会重新获取互斥锁，因此这一步必须在加锁之前。
            root = AppRoot();
            if (WatchdogEnabled(root) && TryRelaunchElevated()) return 0;
            instance = new Mutex(true, @"Local\TBH.Helper.Desktop", out ownsInstance);
            if (!ownsInstance)
            {
                MessageBox.Show("助手已在运行，请从任务栏或托盘打开。", "TBH助手", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            Directory.SetCurrentDirectory(root);
            WriteAdminMarker(root);
            string runtime = RuntimeRoot(root);
            string application = AppFile(root);
            string executable = Assembly.GetExecutingAssembly().Location;
            List<string> command = new List<string>();
            command.Add(executable);
            if (args.Length == 0)
            {
                command.Add("-Dfile.encoding=UTF-8");
                command.Add("-jar");
                command.Add(application);
            }
            else command.AddRange(args);
            string nativeLine = String.Join(" ", command.ConvertAll(Quote).ToArray());
            string jli = Path.Combine(runtime, "bin", "jli.dll");
            IntPtr module = LoadLibraryEx(jli, IntPtr.Zero, 8);
            if (module == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法加载助手运行库。");
            Function<InitArgs>(module, "JLI_InitArgProcessing")(0, 0);
            Function<ParseArgs>(module, "JLI_CmdToArgs")(NativeString(nativeLine, allocated));
            int argc = Function<GetArgCount>(module, "JLI_GetStdArgc")();
            IntPtr values = Function<GetArgValues>(module, "JLI_GetStdArgs")();
            if (argc < 1 || values == IntPtr.Zero) throw new InvalidOperationException("助手启动参数解析失败。");
            IntPtr argv = Marshal.AllocHGlobal((argc + 1) * IntPtr.Size);
            allocated.Add(argv);
            int step = Marshal.SizeOf(typeof(StandardArg));
            for (int i = 0; i < argc; i++) Marshal.WriteIntPtr(argv, i * IntPtr.Size, Marshal.ReadIntPtr(values, i * step));
            Marshal.WriteIntPtr(argv, argc * IntPtr.Size, IntPtr.Zero);
            LaunchJava launch = Function<LaunchJava>(module, "JLI_Launch");
            int result = launch(argc, argv, 0, IntPtr.Zero, 0, IntPtr.Zero,
                NativeString(RuntimeVersion(runtime, "JAVA_RUNTIME_VERSION", "17.0.19+10-LTS"), allocated),
                NativeString(RuntimeVersion(runtime, "JAVA_VERSION", "17.0.19"), allocated),
                NativeString("TBH助手", allocated), NativeString("java", allocated), 0, 1, 1, 0);
            GC.KeepAlive(launch);
            return result;
        }
        catch (Exception ex)
        {
            try { if (root != null) File.AppendAllText(Path.Combine(root, "launcher-error.log"), DateTime.Now.ToString("s") + " " + ex + Environment.NewLine, Encoding.UTF8); }
            catch { }
            MessageBox.Show("助手启动失败：" + ex.Message, "TBH助手", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            foreach (IntPtr pointer in allocated) Marshal.FreeHGlobal(pointer);
            if (instance != null) { if (ownsInstance) instance.ReleaseMutex(); instance.Dispose(); }
        }
    }
}

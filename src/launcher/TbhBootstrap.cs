using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using System.Threading;
using Microsoft.Win32;
using System.Text.RegularExpressions;

[assembly: AssemblyTitle("TBH助手")]
[assembly: AssemblyDescription("TBH助手")]
[assembly: AssemblyProduct("TBH助手")]
[assembly: AssemblyCompany("Awan")]
[assembly: AssemblyVersion("1.3.43.0")]
[assembly: AssemblyFileVersion("1.3.43.0")]

internal static class TbhBootstrap
{
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

    private static string AppRoot()
    {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        if (File.Exists(Path.Combine(folder, "jre", "bin", "jli.dll"))) return folder;
        string parent = Path.GetFullPath(Path.Combine(folder, "..", ".."));
        if (File.Exists(Path.Combine(parent, "jre", "bin", "jli.dll"))) return parent;
        throw new DirectoryNotFoundException("未找到助手内置运行库，请从完整安装文件夹启动。");
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

    private static string RuntimeVersion(string root, string key, string fallback)
    {
        string release = Path.Combine(root, "jre", "release");
        if (File.Exists(release))
            foreach (string line in File.ReadAllLines(release))
                if (line.StartsWith(key + "=", StringComparison.Ordinal))
                    return line.Substring(key.Length + 1).Trim('"');
        return fallback;
    }

    private static string Hash(string path)
    {
        using (SHA256 hash = SHA256.Create())
        using (FileStream stream = File.OpenRead(path))
            return Convert.ToBase64String(hash.ComputeHash(stream));
    }

    private static void SyncPlugin(string root)
    {
        string source = Path.Combine(root, "TBHPlugin-自动腐蚀版.dll");
        string game = FindGameDirectory(root);
        SaveGameDirectory(root, game);
        EnsureBepInEx(root, game);
        string target = Path.Combine(game, "BepInEx", "plugins", "TBHPlugin.dll");
        if (!File.Exists(source)) throw new FileNotFoundException("助手插件文件缺失。", source);
        if (File.Exists(target) && Hash(source) == Hash(target)) return;
        if (Process.GetProcessesByName("TaskBarHero").Length != 0)
            throw new InvalidOperationException("需要更新游戏插件。请正常退出 TaskBarHero 后重新启动助手。");
        if (File.Exists(target)) {
            string backup = Path.Combine(game, "TBH-Backups", DateTime.Now.ToString("yyyyMMdd-HHmmss"), "TBHPlugin.dll");
            Directory.CreateDirectory(Path.GetDirectoryName(backup)); File.Copy(target, backup, true);
        }
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        File.Copy(source, target, true);
    }

    private static bool IsGameDirectory(string folder)
    {
        return !String.IsNullOrWhiteSpace(folder) && File.Exists(Path.Combine(folder, "TaskBarHero.exe"));
    }

    private static string FindGameDirectory(string root)
    {
        string saved = Path.Combine(root, "game-path.txt");
        if (File.Exists(saved)) {
            string path = File.ReadAllText(saved, Encoding.UTF8).Trim();
            if (IsGameDirectory(path)) return Path.GetFullPath(path);
        }
        foreach (Process process in Process.GetProcessesByName("TaskBarHero")) {
            try { string path = Path.GetDirectoryName(process.MainModule.FileName); if (IsGameDirectory(path)) return path; }
            catch (System.ComponentModel.Win32Exception) { }
            catch (InvalidOperationException) { }
            finally { process.Dispose(); }
        }
        HashSet<string> libraries = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string steam = Convert.ToString(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", ""));
        if (String.IsNullOrWhiteSpace(steam)) steam = Convert.ToString(Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", ""));
        if (String.IsNullOrWhiteSpace(steam)) steam = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam");
        if (Directory.Exists(steam)) {
            libraries.Add(steam);
            string vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
            if (File.Exists(vdf)) foreach (Match match in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s*\"([^\"]+)\""))
                libraries.Add(match.Groups[1].Value.Replace(@"\\", @"\"));
        }
        foreach (string library in libraries) {
            string game = Path.Combine(library, "steamapps", "common", "TaskbarHero");
            if (IsGameDirectory(game)) return game;
        }
        using (FolderBrowserDialog picker = new FolderBrowserDialog()) {
            picker.Description = "请选择 TaskBarHero.exe 所在的游戏文件夹";
            picker.ShowNewFolderButton = false;
            if (picker.ShowDialog() != DialogResult.OK) throw new OperationCanceledException("已取消选择游戏目录。");
            if (!IsGameDirectory(picker.SelectedPath)) throw new DirectoryNotFoundException("该文件夹没有 TaskBarHero.exe，请从 Steam 的浏览本地文件找到游戏目录。");
            return Path.GetFullPath(picker.SelectedPath);
        }
    }

    private static void SaveGameDirectory(string root, string game)
    {
        File.WriteAllText(Path.Combine(root, "game-path.txt"), game, new UTF8Encoding(false));
        StringBuilder encoded = new StringBuilder();
        foreach (char c in game) {
            if (c == '\\' || c == ':' || c == '=') encoded.Append('\\').Append(c);
            else if (c > 127) encoded.Append("\\u").Append(((int)c).ToString("x4"));
            else encoded.Append(c);
        }
        string path = Path.Combine(root, "settings.properties");
        List<string> lines = new List<string>();
        if (File.Exists(path)) foreach (string line in File.ReadAllLines(path)) if (!line.StartsWith("game_path=", StringComparison.Ordinal)) lines.Add(line);
        lines.Add("game_path=" + encoded);
        File.WriteAllLines(path, lines.ToArray(), new UTF8Encoding(false));
    }

    private static void EnsureBepInEx(string root, string game)
    {
        string core = Path.Combine(game, "BepInEx", "core", "BepInEx.Unity.IL2CPP.dll");
        if (File.Exists(core) && File.Exists(Path.Combine(game, "winhttp.dll"))) return;
        if (Process.GetProcessesByName("TaskBarHero").Length != 0) throw new InvalidOperationException("首次部署需要退出游戏。请退出后重新打开助手。");
        if (File.Exists(Path.Combine(game, "winhttp.dll")) && !File.Exists(core))
            throw new InvalidOperationException("游戏目录中已有其他加载器，请参照快速上手说明完成 BepInEx IL2CPP 环境安装。");
        string bundle = Path.Combine(root, "BepInExPackage");
        if (!File.Exists(Path.Combine(bundle, "BepInEx", "core", "BepInEx.Unity.IL2CPP.dll")))
            throw new DirectoryNotFoundException("发布包缺少 BepInExPackage，请重新解压完整下载包。");
        string absoluteGame = Path.GetFullPath(game).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string backup = Path.Combine(game, "TBH-Backups", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        foreach (string file in Directory.GetFiles(bundle, "*", SearchOption.AllDirectories)) {
            string relative = file.Substring(bundle.TrimEnd(Path.DirectorySeparatorChar).Length + 1);
            if (relative.StartsWith(@"BepInEx\config\", StringComparison.OrdinalIgnoreCase)
                || relative.StartsWith(@"BepInEx\plugins\", StringComparison.OrdinalIgnoreCase)
                || relative.StartsWith(@"BepInEx\interop\", StringComparison.OrdinalIgnoreCase)) continue;
            string target = Path.GetFullPath(Path.Combine(game, relative));
            if (!target.StartsWith(absoluteGame, StringComparison.OrdinalIgnoreCase)) throw new IOException("部署路径超出游戏目录。");
            if (File.Exists(target)) {
                string previous = Path.Combine(backup, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(previous)); File.Copy(target, previous, true);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(target)); File.Copy(file, target, true);
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
            instance = new Mutex(true, @"Local\TBH.Helper.Desktop", out ownsInstance);
            if (!ownsInstance)
            {
                MessageBox.Show("助手已在运行，请从任务栏或托盘打开。", "TBH助手", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            root = AppRoot();
            Directory.SetCurrentDirectory(root);
            SyncPlugin(root);
            string executable = Assembly.GetExecutingAssembly().Location;
            List<string> command = new List<string>();
            command.Add(executable);
            if (args.Length == 0)
            {
                string app = Path.GetFileName(executable).StartsWith("TBH-Helper-v", StringComparison.OrdinalIgnoreCase)
                    ? executable : Path.Combine(root, "TBH-Helper-v1.3.43.jar");
                if (!File.Exists(app)) throw new FileNotFoundException("助手程序文件缺失。", app);
                command.Add("-Dfile.encoding=UTF-8");
                command.Add("-jar");
                command.Add(app);
            }
            else command.AddRange(args);
            string nativeLine = String.Join(" ", command.ConvertAll(Quote).ToArray());
            string jli = Path.Combine(root, "jre", "bin", "jli.dll");
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
                NativeString(RuntimeVersion(root, "JAVA_RUNTIME_VERSION", "17.0.19+10-LTS"), allocated),
                NativeString(RuntimeVersion(root, "JAVA_VERSION", "17.0.19"), allocated),
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

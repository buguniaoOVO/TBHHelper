package com.lulu.core;

import com.lulu.config.Config;
import com.lulu.gui.I18n;
import com.sun.jna.platform.win32.Kernel32;
import com.sun.jna.platform.win32.Psapi;
import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;
import com.sun.jna.platform.win32.WinNT;
import com.sun.jna.ptr.IntByReference;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Stream;
import javax.swing.JFileChooser;
import javax.swing.JOptionPane;
import javax.swing.UIManager;

/** 把附带的后台运行环境和游戏插件部署到游戏目录。 */
public final class DeployManager {
    private static final String GAME_EXE_NAME = "TaskBarHero.exe";
    private static final String GAME_FOLDER_NAME = "TaskbarHero";
    private static final String PACKAGE_FOLDER = "BepInExPackage";
    private static final String PLUGIN_FILE = "TBHPlugin-自动腐蚀版.dll";

    private DeployManager() {
    }

    public static final class Initialization {
        public final boolean ready;
        public final boolean waitForExit;
        public final String message;
        private Initialization(boolean ready, boolean waitForExit, String message) {
            this.ready = ready; this.waitForExit = waitForExit; this.message = message;
        }
    }

    public static synchronized Initialization initializeOnStartup() {
        try {
            String located = locateGameDirectorySilently();
            if (located == null) return new Initialization(false, false, "请选择游戏目录，助手将自动初始化 DLL。");
            Path game = Paths.get(validateGameDirectory(located));
            if (!game.toString().equals(Config.UserData.GAME_PATH)) Config.UserData.saveGamePath(game.toString());
            Path source = Paths.get(System.getProperty("user.dir"), PLUGIN_FILE);
            if (!Files.isRegularFile(source)) return new Initialization(false, false, "助手安装包缺少游戏插件 DLL，请完整解压新版。");
            Path target = game.resolve("BepInEx/plugins/TBHPlugin.dll");
            boolean matches = Files.isRegularFile(target) && Files.mismatch(source, target) == -1L;
            boolean loaderPresent = Files.isRegularFile(game.resolve("winhttp.dll"))
                    && Files.isRegularFile(game.resolve("BepInEx/core/BepInEx.Unity.IL2CPP.dll"))
                    && Files.isRegularFile(game.resolve("dotnet/coreclr.dll"));
            if (matches && loaderPresent) return new Initialization(true, false, "DLL 初始化完成，与当前助手安装包一致。");
            if (isGameRunning()) return new Initialization(false, true, "游戏正在运行，DLL 更新待执行；退出游戏后助手会自动同步，请随后重启游戏。");
            Path runtime = Paths.get(System.getProperty("user.dir"), PACKAGE_FOLDER);
            if (!Files.isDirectory(runtime)) return new Initialization(false, false, "自动初始化缺少 BepInExPackage，请完整解压新版。");
            copyEnvironment(runtime, game);
            Path plugin = copyPlugin(game);
            verifyDeployment(runtime, game, plugin);
            BepInExConfig.disableConsole(game);
            return new Initialization(true, false, "DLL 初始化完成，与当前助手安装包一致。");
        } catch (Exception ex) { return new Initialization(false, false, "DLL 自动初始化失败：" + ex.getMessage()); }
    }

    public static synchronized boolean checkAndDeploy() {
        if (isGameRunning()) {
            JOptionPane.showMessageDialog(null, "部署会写入游戏目录，请先正常退出 TaskBarHero 再重试。", "游戏仍在运行", JOptionPane.INFORMATION_MESSAGE);
            return false;
        }
        String gamePath = resolveGameDirectory();
        if (gamePath == null) {
            JOptionPane.showMessageDialog(null, "没有找到 TaskBarHero.exe，请在下一步选择游戏目录。", "找不到游戏", JOptionPane.WARNING_MESSAGE);
            return false;
        }
        gamePath = new File(gamePath).getAbsolutePath();
        Config.UserData.saveGamePath(gamePath);
        System.out.println(">>> [环境部署] 游戏目录: " + gamePath);
        File source = new File(System.getProperty("user.dir"), PACKAGE_FOLDER);
        if (!source.isDirectory()) {
            System.out.println("⚠️ [环境部署] 安装目录缺少 " + PACKAGE_FOLDER + "，请重新解压完整下载包。");
            JOptionPane.showMessageDialog(null, "安装目录缺少 " + PACKAGE_FOLDER + " 文件夹，请重新解压完整下载包。", "缺少运行环境", JOptionPane.ERROR_MESSAGE);
            return false;
        }
        try {
            Path game = Paths.get(gamePath).toRealPath();
            copyEnvironment(source.toPath(), game);
            Path plugin = copyPlugin(game);
            verifyDeployment(source.toPath(), game, plugin);
            boolean hidConsole = BepInExConfig.disableConsole(game);
            System.out.println(">>> [环境部署] BepInEx 控制台配置已设为关闭: " + hidConsole);
            System.out.println("✅ [环境部署] winhttp.dll、BepInEx IL2CPP、CoreCLR、Doorstop 配置和 TBH 插件均已核验通过。");
            JOptionPane.showMessageDialog(null,
                    "后台环境与插件已部署并校验通过：\n• winhttp.dll 与安装包一致\n• BepInEx\\core\\BepInEx.Unity.IL2CPP.dll、dotnet\\coreclr.dll 存在且与安装包一致\n• doorstop_config.ini 的 target_assembly 与 coreclr_path 指向正确\n\n请从 Steam 启动游戏，等助手显示“游戏已连接”后再开启自动任务。若显示“插件未连接”，请查看 BepInEx/LogOutput.log。",
                    "部署完成", JOptionPane.INFORMATION_MESSAGE);
            return true;
        } catch (Exception ex) {
            System.out.println("❌ [环境部署] 失败: " + ex.getMessage());
            String reason = ex instanceof java.nio.file.AccessDeniedException
                    ? "\n\n游戏目录没有写入权限。请将助手放到可写目录，并以管理员身份重新启动助手后再部署。"
                    : "";
            JOptionPane.showMessageDialog(null, "部署失败：" + ex.getMessage() + reason, "环境部署", JOptionPane.ERROR_MESSAGE);
            return false;
        }
    }

    public static String validateGameDirectory(String selectedPath) throws IOException {
        if (selectedPath == null || selectedPath.trim().isEmpty()) throw new IOException("请填写游戏安装目录。");
        String normalized = selectedPath.trim();
        if (normalized.length() >= 2 && normalized.startsWith("\"") && normalized.endsWith("\"")) {
            normalized = normalized.substring(1, normalized.length() - 1).trim();
        }
        Path game = Paths.get(normalized).toRealPath();
        if (!Files.isRegularFile(game.resolve(GAME_EXE_NAME))) {
            throw new IOException("该目录中未找到 " + GAME_EXE_NAME + "：" + game);
        }
        return game.toString();
    }

    public static synchronized boolean uninstall(String selectedGamePath) {
        if (isGameRunning()) {
            JOptionPane.showMessageDialog(null, I18n.tr("请先退出 TaskBarHero，再清除游戏插件环境。"), I18n.tr("游戏仍在运行"), JOptionPane.INFORMATION_MESSAGE);
            return false;
        }
        try {
            Path game = Paths.get(validateGameDirectory(selectedGamePath));
            Config.UserData.saveGamePath(game.toString());
            Path packageRoot = Paths.get(System.getProperty("user.dir"), PACKAGE_FOLDER).toRealPath();
            if (!Files.isDirectory(packageRoot) || !Files.isDirectory(packageRoot.resolve("BepInEx"))) {
                throw new IOException("助手目录缺少完整的 BepInExPackage，无法确定需要清除的环境项目。");
            }
            List<Path> entriesToRemove = new ArrayList<Path>();
            try (Stream<Path> entries = Files.list(packageRoot)) {
                for (Path entry : (Iterable<Path>) entries.sorted()::iterator) {
                    String name = entry.getFileName().toString();
                    Path target = game.resolve(name).normalize();
                    if (!target.startsWith(game) || target.equals(game) || !game.equals(target.getParent())) {
                        throw new IOException("环境清理项目超出游戏目录: " + name);
                    }
                    if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) entriesToRemove.add(target);
                }
            }
            int removed = 0;
            for (Path target : entriesToRemove) {
                removed += deleteRecursively(target);
                System.out.println(">>> [环境清理] 已永久删除: " + target);
            }
            String result = removed == 0
                    ? I18n.tr("游戏目录中没有发现已部署的 BepInEx 环境。")
                    : I18n.tr("完整插件环境已永久清除，共移除 ") + removed + I18n.tr(" 个环境项目。");
            System.out.println("✅ [环境清理] " + result);
            JOptionPane.showMessageDialog(null, result, I18n.tr("环境已清除"), JOptionPane.INFORMATION_MESSAGE);
            return true;
        } catch (Exception ex) {
            System.out.println("❌ [环境清理] 失败: " + ex.getMessage());
            StringBuilder detail = new StringBuilder(I18n.tr("清除环境失败：")).append(ex.getMessage());
            for (Throwable suppressed : ex.getSuppressed()) detail.append("\n").append(suppressed.getMessage());
            JOptionPane.showMessageDialog(null, detail.toString(), I18n.tr("TBH助手"), JOptionPane.ERROR_MESSAGE);
            return false;
        }
    }

    private static int deleteRecursively(Path target) throws IOException {
        List<Path> paths = new ArrayList<Path>();
        try (Stream<Path> walk = Files.walk(target)) {
            walk.forEach(paths::add);
        }
        paths.sort((left, right) -> Integer.compare(right.getNameCount(), left.getNameCount()));
        int removed = 0;
        for (Path path : paths) {
            if (Files.deleteIfExists(path)) removed++;
        }
        return removed;
    }

    /** 依次尝试已保存路径、运行中的游戏、Steam 库，最后让用户手动选择。 */
    private static String resolveGameDirectory() {
        String located = locateGameDirectorySilently();
        return located == null ? pickDirectory() : located;
    }

    public static String locateGameDirectorySilently() {
        if (isGameDirectory(Config.UserData.GAME_PATH)) return Config.UserData.GAME_PATH;
        String running = detectByRunningProcess();
        if (running != null) return running;
        int processId = runningGameProcessId();
        if (processId > 0) {
            java.util.Optional<ProcessHandle> process = ProcessHandle.of(processId);
            if (process.isPresent() && process.get().info().command().isPresent()) {
                String folder = new File(process.get().info().command().get()).getParent();
                if (isGameDirectory(folder)) return folder;
            }
        }
        for (String library : steamLibraries()) {
            File candidate = new File(new File(new File(library, "steamapps"), "common"), GAME_FOLDER_NAME);
            if (isGameDirectory(candidate.getAbsolutePath())) return candidate.getAbsolutePath();
        }
        return null;
    }

    private static boolean isGameDirectory(String folder) {
        return folder != null && !folder.trim().isEmpty() && new File(folder, GAME_EXE_NAME).isFile();
    }

    private static String pickDirectory() {
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Exception ignored) {
        }
        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("请选择 TaskBarHero.exe 所在的游戏文件夹");
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        chooser.setAcceptAllFileFilterUsed(false);
        while (true) {
            if (chooser.showOpenDialog(null) != JFileChooser.APPROVE_OPTION) return null;
            String selected = chooser.getSelectedFile().getAbsolutePath();
            if (isGameDirectory(selected) || isGameDirectory(new File(selected, GAME_FOLDER_NAME).getAbsolutePath()))
                return isGameDirectory(selected) ? selected : new File(selected, GAME_FOLDER_NAME).getAbsolutePath();
            JOptionPane.showMessageDialog(null, "该文件夹里没有 " + GAME_EXE_NAME + "，请选择游戏安装目录。", "目录不正确", JOptionPane.WARNING_MESSAGE);
        }
    }

    private static Set<String> steamLibraries() {
        Set<String> libraries = new LinkedHashSet<String>();
        for (String query : new String[]{
                "HKEY_CURRENT_USER\\Software\\Valve\\Steam",
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam"}) {
            String install = registryValue(query, "SteamPath");
            if (install == null) install = registryValue(query, "InstallPath");
            if (install != null) addSteamLibrary(libraries, install);
        }
        for (String guess : new String[]{"C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam", "D:\\Steam", "D:\\SteamLibrary", "E:\\SteamLibrary"}) {
            addSteamLibrary(libraries, guess);
        }
        return libraries;
    }

    private static void addSteamLibrary(Set<String> libraries, String steamRoot) {
        if (steamRoot == null) return;
        File root = new File(steamRoot.replace("\"", ""));
        if (!root.isDirectory()) return;
        libraries.add(root.getAbsolutePath());
        File vdf = new File(new File(root, "steamapps"), "libraryfolders.vdf");
        if (!vdf.isFile()) return;
        try {
            for (String line : Files.readAllLines(vdf.toPath())) {
                int key = line.indexOf("\"path\"");
                if (key < 0) continue;
                int start = line.indexOf('\"', key + 6);
                int end = line.indexOf('\"', start + 1);
                if (start < 0 || end <= start) continue;
                String path = line.substring(start + 1, end).replace("\\\\", "\\");
                if (new File(path).isDirectory()) libraries.add(new File(path).getAbsolutePath());
            }
        } catch (IOException ignored) {
        }
    }

    private static String registryValue(String key, String name) {
        try {
            Process process = Runtime.getRuntime().exec(new String[]{"reg", "query", key, "/v", name});
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), "GBK"))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    int marker = line.toUpperCase(Locale.ROOT).indexOf(name.toUpperCase(Locale.ROOT));
                    if (marker < 0) continue;
                    String[] parts = line.trim().split("\\s{2,}");
                    if (parts.length >= 3) return parts[parts.length - 1].trim();
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static void copyEnvironment(Path source, Path game) throws IOException {
        String prefix = source.toString() + File.separator;
        List<Path> files = new ArrayList<Path>();
        Files.walk(source).forEach(path -> { if (Files.isRegularFile(path)) files.add(path); });
        for (Path path : files) {
            String relative = path.toString().substring(prefix.length());
            String lower = relative.toLowerCase(Locale.ROOT);
            if (lower.startsWith("bepinex" + File.separator + "config")
                    || lower.startsWith("bepinex" + File.separator + "plugins")
                    || lower.startsWith("bepinex" + File.separator + "interop")) {
                continue;
            }
            Path target = game.resolve(relative).normalize();
            if (!target.startsWith(game)) throw new IOException("部署路径超出游戏目录。");
            if (Files.exists(target)) {
                if (Files.mismatch(path, target) == -1L) continue;
                Path backup = game.resolve("TBH-Backups").resolve(relative);
                Files.createDirectories(backup.getParent());
                Files.copy(target, backup, StandardCopyOption.REPLACE_EXISTING);
            }
            Files.createDirectories(target.getParent());
            Files.copy(path, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static Path copyPlugin(Path game) throws IOException {
        Path source = Paths.get(System.getProperty("user.dir"), PLUGIN_FILE);
        if (!Files.isRegularFile(source)) throw new IOException("安装目录缺少 " + PLUGIN_FILE + "。");
        Path target = game.resolve("BepInEx/plugins/TBHPlugin.dll");
        if (Files.exists(target)) {
            if (Files.mismatch(source, target) == -1L) return target;
            Path backup = game.resolve("TBH-Backups").resolve("TBHPlugin-" + System.currentTimeMillis() + ".dll");
            Files.createDirectories(backup.getParent());
            Files.copy(target, backup, StandardCopyOption.REPLACE_EXISTING);
        }
        if (PluginDeployment.synchronize(source, target, isGameRunning()) == PluginDeployment.Result.WAIT_FOR_EXIT)
            throw new IOException("游戏仍在运行，DLL 更新需要退出游戏。");
        return target;
    }

    private static void verifyDeployment(Path source, Path game, Path plugin) throws IOException {
        String[] required = new String[]{
                "winhttp.dll",
                "doorstop_config.ini",
                "BepInEx/core/BepInEx.Core.dll",
                "BepInEx/core/BepInEx.Unity.IL2CPP.dll",
                "dotnet/coreclr.dll"
        };
        for (String relative : required) {
            verifyExactCopy(source.resolve(relative), game.resolve(relative), relative);
        }
        verifyDoorstopConfig(game.resolve("doorstop_config.ini"));
        Path packagedPlugin = Paths.get(System.getProperty("user.dir"), PLUGIN_FILE);
        verifyExactCopy(packagedPlugin, plugin, "BepInEx/plugins/TBHPlugin.dll");
    }

    private static void verifyExactCopy(Path packaged, Path installed, String label) throws IOException {
        if (!Files.isRegularFile(packaged)) throw new IOException("部署包缺少必需文件: " + packaged.getFileName());
        if (!Files.isRegularFile(installed)) throw new IOException("游戏目录缺少必需文件: " + label);
        if (Files.size(packaged) != Files.size(installed) || Files.mismatch(packaged, installed) != -1L) {
            throw new IOException("部署文件与安装包不一致，可能未替换成功: " + label);
        }
        System.out.println("✓ [环境校验] 文件存在且与部署包一致: " + label);
    }

    private static void verifyDoorstopConfig(Path config) throws IOException {
        String section = "";
        String targetAssembly = null;
        String coreClrPath = null;
        for (String line : Files.readAllLines(config, StandardCharsets.UTF_8)) {
            String value = line.trim();
            if (value.startsWith("\uFEFF")) value = value.substring(1).trim();
            if (value.isEmpty() || value.startsWith("#") || value.startsWith(";")) continue;
            if (value.startsWith("[") && value.endsWith("]")) {
                section = value.substring(1, value.length() - 1).trim();
                continue;
            }
            int equals = value.indexOf('=');
            if (equals < 0) continue;
            String key = value.substring(0, equals).trim();
            String setting = value.substring(equals + 1).trim();
            if ("General".equalsIgnoreCase(section) && "target_assembly".equalsIgnoreCase(key)) {
                targetAssembly = setting;
            } else if ("Il2Cpp".equalsIgnoreCase(section) && "coreclr_path".equalsIgnoreCase(key)) {
                coreClrPath = setting;
            }
        }
        if (!"bepinex\\core\\bepinex.unity.il2cpp.dll".equals(normalizeConfigPath(targetAssembly))) {
            throw new IOException("doorstop_config.ini 的 [General] target_assembly 必须指向 BepInEx\\core\\BepInEx.Unity.IL2CPP.dll。");
        }
        if (!"dotnet\\coreclr.dll".equals(normalizeConfigPath(coreClrPath))) {
            throw new IOException("doorstop_config.ini 的 [Il2Cpp] coreclr_path 必须指向 dotnet\\coreclr.dll。");
        }
        System.out.println("✓ [环境校验] doorstop_config.ini 的 target_assembly 与 coreclr_path 指向正确。");
    }

    private static String normalizeConfigPath(String value) {
        if (value == null) return "";
        String normalized = value.trim();
        if (normalized.length() >= 2 && normalized.startsWith("\"") && normalized.endsWith("\"")) {
            normalized = normalized.substring(1, normalized.length() - 1).trim();
        }
        return normalized.replace('/', '\\').toLowerCase(Locale.ROOT);
    }

    private static String detectByRunningProcess() {
        try {
            WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
            if (hwnd == null) return null;
            IntByReference pid = new IntByReference();
            User32.INSTANCE.GetWindowThreadProcessId(hwnd, pid);
            WinNT.HANDLE handle = Kernel32.INSTANCE.OpenProcess(1040, false, pid.getValue());
            if (handle == null) return null;
            try {
                char[] buffer = new char[1024];
                int length = Psapi.INSTANCE.GetModuleFileNameExW(handle, null, buffer, buffer.length);
                if (length <= 0) return null;
                return new File(new String(buffer, 0, length)).getParent();
            } finally {
                Kernel32.INSTANCE.CloseHandle(handle);
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static boolean isGameRunning() {
        return runningGameProcessId() > 0;
    }

    public static int runningGameProcessId() {
        try {
            WinDef.HWND window = User32.INSTANCE.FindWindow(null, "TaskBarHero");
            if (window != null) {
                IntByReference process = new IntByReference();
                User32.INSTANCE.GetWindowThreadProcessId(window, process);
                if (process.getValue() > 0) return process.getValue();
            }
        } catch (Throwable ignored) {
        }
        try (Stream<ProcessHandle> processes = ProcessHandle.allProcesses()) {
            java.util.Optional<ProcessHandle> game = processes.filter(process -> process.info().command().isPresent()
                    && GAME_EXE_NAME.equalsIgnoreCase(new File(process.info().command().get()).getName())).findFirst();
            if (game.isPresent() && game.get().pid() <= Integer.MAX_VALUE) {
                return (int)game.get().pid();
            }
        } catch (Exception ignored) {
        }
        return 0;
    }
}

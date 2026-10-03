package com.lulu.core;

import com.lulu.config.Config;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
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

    public static boolean checkAndDeploy() {
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
            System.out.println("✅ [环境部署] 运行环境与插件已部署，关键文件校验通过: " + plugin);
            JOptionPane.showMessageDialog(null,
                    "后台环境与插件已部署，关键文件校验通过。\n\n请从 Steam 启动游戏，等助手显示“游戏已连接”后再开启自动任务。\n若显示“插件未连接”，请查看游戏目录下 BepInEx/LogOutput.log 的插件启动记录。",
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

    public static boolean uninstall() {
        if (isGameRunning()) {
            JOptionPane.showMessageDialog(null, "请退出游戏后再停用插件。", "游戏仍在运行", JOptionPane.INFORMATION_MESSAGE);
            return false;
        }
        try {
            Path game = Paths.get(Config.UserData.GAME_PATH).toRealPath();
            if (!Files.isRegularFile(game.resolve(GAME_EXE_NAME))) throw new IOException("游戏目录未确认。");
            Path plugin = game.resolve("BepInEx/plugins/TBHPlugin.dll");
            if (!Files.exists(plugin)) {
                JOptionPane.showMessageDialog(null, "本插件当前已停用。", "TBH助手", JOptionPane.INFORMATION_MESSAGE);
                return true;
            }
            plugin = plugin.toRealPath();
            if (!plugin.startsWith(game)) throw new IOException("插件实际路径位于游戏目录之外。");
            Path backup = game.resolve("TBH-Backups").resolve("disabled-" + System.currentTimeMillis()).resolve("TBHPlugin.dll.disabled");
            Files.createDirectories(backup.getParent());
            Files.move(plugin, backup);
            JOptionPane.showMessageDialog(null, "TBH插件已移到备份目录。共享运行环境与其他插件保留；再次点击一键部署会恢复本插件。", "插件已停用", JOptionPane.INFORMATION_MESSAGE);
            return true;
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(null, "停用失败：" + ex.getMessage(), "TBH助手", JOptionPane.ERROR_MESSAGE);
            return false;
        }
    }

    /** 依次尝试已保存路径、运行中的游戏、Steam 库，最后让用户手动选择。 */
    private static String resolveGameDirectory() {
        if (isGameDirectory(Config.UserData.GAME_PATH)) return Config.UserData.GAME_PATH;
        String running = detectByRunningProcess();
        if (running != null) return running;
        for (String library : steamLibraries()) {
            File candidate = new File(new File(new File(library, "steamapps"), "common"), GAME_FOLDER_NAME);
            if (isGameDirectory(candidate.getAbsolutePath())) return candidate.getAbsolutePath();
        }
        return pickDirectory();
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
        Files.createDirectories(target.getParent());
        Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
        return target;
    }

    private static void verifyDeployment(Path source, Path game, Path plugin) throws IOException {
        String[] required = new String[]{
                "winhttp.dll",
                "doorstop_config.ini",
                "BepInEx/core/BepInEx.Core.dll",
                "BepInEx/core/BepInEx.Unity.IL2CPP.dll"
        };
        for (String relative : required) {
            Path packaged = source.resolve(relative);
            Path installed = game.resolve(relative);
            if (!Files.isRegularFile(packaged) || !Files.isRegularFile(installed)
                    || Files.size(packaged) != Files.size(installed)
                    || Files.mismatch(packaged, installed) != -1L) {
                throw new IOException("后台环境文件缺失或校验不符: " + relative);
            }
        }
        Path packagedPlugin = Paths.get(System.getProperty("user.dir"), PLUGIN_FILE);
        if (!Files.isRegularFile(plugin) || Files.size(packagedPlugin) != Files.size(plugin)
                || Files.mismatch(packagedPlugin, plugin) != -1L) {
            throw new IOException("游戏插件未能完整写入: " + plugin);
        }
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
        try {
            if (User32.INSTANCE.FindWindow(null, "TaskBarHero") != null) return true;
        } catch (Throwable ignored) {
        }
        try {
            Process process = Runtime.getRuntime().exec(new String[]{"tasklist", "/FI", "IMAGENAME eq " + GAME_EXE_NAME, "/NH"});
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), "GBK"))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.toLowerCase(Locale.ROOT).contains(GAME_EXE_NAME.toLowerCase(Locale.ROOT))) return true;
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }
}

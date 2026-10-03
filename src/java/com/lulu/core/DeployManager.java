/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.sun.jna.platform.win32.Kernel32
 *  com.sun.jna.platform.win32.Psapi
 *  com.sun.jna.platform.win32.User32
 *  com.sun.jna.platform.win32.WinDef$HWND
 *  com.sun.jna.platform.win32.WinNT$HANDLE
 *  com.sun.jna.ptr.IntByReference
 */
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
import java.nio.file.FileVisitResult;
import java.nio.file.FileVisitor;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileAttribute;
import javax.swing.JOptionPane;

public class DeployManager {
    private static final String GAME_EXE_NAME = "TaskBarHero.exe";

    public static boolean checkAndDeploy() {
        String gamePath = new File(Config.UserData.GAME_PATH, GAME_EXE_NAME).isFile() ? Config.UserData.GAME_PATH : DeployManager.detectGamePath();
        if (gamePath == null) {
            return false;
        }
        Config.UserData.saveGamePath(gamePath);
        System.out.println(">>> [\u73af\u5883\u90e8\u7f72] \u5df2\u81ea\u52a8\u8bb0\u5f55\u6e38\u620f\u7edd\u5bf9\u8def\u5f84: " + gamePath);
        File bepInExFolder = new File(gamePath, "BepInEx");
        File winhttpDll = new File(gamePath, "winhttp.dll");
        File dotnetFolder = new File(gamePath, "dotnet");
        File doorstopIni = new File(gamePath, "doorstop_config.ini");
        if (bepInExFolder.exists() && winhttpDll.exists() && dotnetFolder.exists() && doorstopIni.exists()) {
            System.out.println(">>> [\u73af\u5883\u90e8\u7f72] \u68c0\u6d4b\u5230\u73af\u5883\u5df2\u5b58\u5728\u4e14\u5b8c\u6574\uff0c\u8df3\u8fc7\u5b89\u88c5\u3002");
            JOptionPane.showMessageDialog(null, "\u68c0\u6d4b\u5230\u6e38\u620f\u5df2\u5b89\u88c5\u597d\u540e\u53f0\u81ea\u52a8\u5316\u73af\u5883\uff0c\u65e0\u9700\u91cd\u590d\u5b89\u88c5\uff01", "\u73af\u5883\u5df2\u5c31\u7eea", 1);
            return true;
        }
        System.out.println(">>> [\u73af\u5883\u90e8\u7f72] \u73af\u5883\u7f3a\u5931\u6216\u9700\u9996\u6b21\u5b89\u88c5\uff01\u6b63\u5728\u5c06\u57fa\u7840\u73af\u5883\u91ca\u653e\u81f3: " + gamePath);
        File sourceDir = new File(System.getProperty("user.dir"), "BepInExPackage");
        if (!sourceDir.exists()) {
            System.out.println("\u26a0\ufe0f [\u73af\u5883\u90e8\u7f72] \u81f4\u547d\u9519\u8bef\uff1a\u627e\u4e0d\u5230 BepInExPackage \u5e95\u5305\u6587\u4ef6\u5939\uff01");
            return false;
        }
        try {
            DeployManager.copyDirectory(sourceDir.toPath(), Paths.get(gamePath, new String[0]));
            System.out.println("\u2705 [\u73af\u5883\u90e8\u7f72] 4 \u9879\u6838\u5fc3 API \u73af\u5883\u6587\u4ef6\u91ca\u653e\u6210\u529f\uff01");
            JOptionPane.showMessageDialog(null, "\u9996\u6b21\u540e\u53f0\u8fd0\u884c\u73af\u5883\u914d\u7f6e\u6210\u529f\uff01\n\n\u26a0\ufe0f \u8bf7\u3010\u52a1\u5fc5\u5173\u95ed\u5e76\u91cd\u65b0\u542f\u52a8\u4e00\u6b21\u6e38\u620f\u5ba2\u6237\u7aef\u3011\uff0c\u5426\u5219\u540e\u53f0\u81ea\u52a8\u5316\u529f\u80fd\u5c06\u65e0\u6cd5\u751f\u6548\uff01", "\u73af\u5883\u521d\u59cb\u5316\u5b8c\u6210", 1);
            return true;
        }
        catch (IOException e) {
            System.out.println("\u274c [\u73af\u5883\u90e8\u7f72] \u6587\u4ef6\u91ca\u653e\u5931\u8d25: " + e.getMessage());
            return false;
        }
    }

    public static boolean uninstall() {
        if (DeployManager.isGameRunning()) {
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
            JOptionPane.showMessageDialog(null, "TBH插件已移到备份目录。共享运行环境与其他插件保留；再次启动助手会部署本插件。", "插件已停用", JOptionPane.INFORMATION_MESSAGE);
            return true;
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(null, "停用失败：" + ex.getMessage(), "TBH助手", JOptionPane.ERROR_MESSAGE);
            return false;
        }
    }

    private static String detectGamePath() {
        String path = null;
        System.out.println(">>> [\u73af\u5883\u63a2\u6d4b] \u6b63\u5728\u5c1d\u8bd5 Level 1: JNA \u5185\u5b58\u76f4\u8bfb...");
        path = DeployManager.detectByJNA();
        if (path != null) {
            return path;
        }
        System.out.println(">>> [\u73af\u5883\u63a2\u6d4b] JNA \u8bfb\u53d6\u53d7\u9650\uff0c\u6b63\u5728\u964d\u7ea7\u81f3 Level 2: PowerShell...");
        path = DeployManager.detectByPowerShell();
        if (path != null) {
            return path;
        }
        System.out.println(">>> [\u73af\u5883\u63a2\u6d4b] PowerShell \u6267\u884c\u5931\u8d25\uff0c\u6b63\u5728\u964d\u7ea7\u81f3 Level 3: WMIC\u515c\u5e95...");
        path = DeployManager.detectByWMIC();
        return path;
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     * Enabled aggressive block sorting
     * Enabled unnecessary exception pruning
     * Enabled aggressive exception aggregation
     */
    private static String detectByJNA() {
        try {
            WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
            if (hwnd == null) {
                return null;
            }
            IntByReference pid = new IntByReference();
            User32.INSTANCE.GetWindowThreadProcessId(hwnd, pid);
            WinNT.HANDLE hProcess = Kernel32.INSTANCE.OpenProcess(1040, false, pid.getValue());
            if (hProcess == null) {
                return null;
            }
            try {
                char[] pathBuffer = new char[1024];
                int length = Psapi.INSTANCE.GetModuleFileNameExW(hProcess, null, pathBuffer, pathBuffer.length);
                if (length <= 0) return null;
                String fullExePath = new String(pathBuffer, 0, length);
                String string = new File(fullExePath).getParent();
                return string;
            }
            finally {
                Kernel32.INSTANCE.CloseHandle(hProcess);
            }
        }
        catch (Throwable throwable) {
            // empty catch block
        }
        return null;
    }

    private static String detectByPowerShell() {
        try {
            String line;
            String processName = GAME_EXE_NAME.replace(".exe", "");
            String[] cmd = new String[]{"powershell", "-NoProfile", "-Command", "(Get-Process -Name '" + processName + "' -ErrorAction SilentlyContinue).Path"};
            Process process = Runtime.getRuntime().exec(cmd);
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), "GBK"));
            while ((line = reader.readLine()) != null) {
                if (!(line = line.trim()).toLowerCase().endsWith(GAME_EXE_NAME.toLowerCase())) continue;
                return new File(line).getParent();
            }
        }
        catch (Exception exception) {
            // empty catch block
        }
        return null;
    }

    private static String detectByWMIC() {
        try {
            String line;
            String cmd = "wmic process where \"name='TaskBarHero.exe'\" get ExecutablePath";
            Process process = Runtime.getRuntime().exec(cmd);
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), "GBK"));
            while ((line = reader.readLine()) != null) {
                if (!(line = line.trim()).toLowerCase().endsWith(GAME_EXE_NAME.toLowerCase())) continue;
                return new File(line).getParent();
            }
        }
        catch (Exception exception) {
            // empty catch block
        }
        return null;
    }

    private static boolean isGameRunning() {
        try {
            WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
            if (hwnd != null) {
                return true;
            }
        }
        catch (Throwable hwnd) {
            // empty catch block
        }
        try {
            String line;
            String cmd = "tasklist /FI \"IMAGENAME eq TaskBarHero.exe\" /NH";
            Process process = Runtime.getRuntime().exec(cmd);
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), "GBK"));
            while ((line = reader.readLine()) != null) {
                if (!line.toLowerCase().contains(GAME_EXE_NAME.toLowerCase())) continue;
                return true;
            }
        }
        catch (Exception exception) {
            // empty catch block
        }
        return false;
    }

    private static void copyDirectory(final Path source, final Path target) throws IOException {
        Files.walkFileTree(source, (FileVisitor<? super Path>)new SimpleFileVisitor<Path>(){

            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                Files.createDirectories(target.resolve(source.relativize(dir)), new FileAttribute[0]);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.copy(file, target.resolve(source.relativize(file)), StandardCopyOption.REPLACE_EXISTING);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static void deleteDirectory(File dir) {
        if (dir.exists()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (file.isDirectory()) {
                        DeployManager.deleteDirectory(file);
                        continue;
                    }
                    file.delete();
                }
            }
            dir.delete();
        }
    }
}

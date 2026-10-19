package com.lulu.core;

import com.lulu.api.DllApiClient;
import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Controls the TaskBarHero top-level window without sending mouse input. */
public final class GameWindowController {
    private static final int SW_HIDE = 0;
    private static final int SW_RESTORE = 9;
    private static volatile WinDef.HWND hiddenWindow;
    private static volatile boolean backgroundModeRequested;

    private GameWindowController() { }

    public static boolean isAvailable() {
        return findWindow() != null;
    }

    public static boolean isHidden() {
        WinDef.HWND window = findWindow();
        return window != null && !User32.INSTANCE.IsWindowVisible(window);
    }

    public static String toggle() {
        WinDef.HWND window = findWindow();
        if (window == null) return "FAILED|GAME_NOT_FOUND";
        return User32.INSTANCE.IsWindowVisible(window) ? hide(window) : show(window);
    }

    public static void restoreOnExit() {
        WinDef.HWND window = findWindow();
        boolean wasHidden = window != null && !User32.INSTANCE.IsWindowVisible(window);
        if (wasHidden) {
            User32.INSTANCE.ShowWindow(window, SW_RESTORE);
            User32.INSTANCE.SetForegroundWindow(window);
            hiddenWindow = null;
        }
        if (backgroundModeRequested || wasHidden) {
            requestBackgroundMode(false);
            backgroundModeRequested = false;
        }
    }

    private static String hide(WinDef.HWND window) {
        String status = DllApiClient.getGameStatus();
        if (status == null || !status.startsWith("SUCCESS|")) return "FAILED|PLUGIN_NOT_CONNECTED";
        if (!requestBackgroundMode(true)) return "FAILED|BACKGROUND_MODE_FAILED";
        backgroundModeRequested = true;
        User32.INSTANCE.ShowWindow(window, SW_HIDE);
        if (User32.INSTANCE.IsWindowVisible(window)) {
            requestBackgroundMode(false);
            backgroundModeRequested = false;
            return "FAILED|WINDOW_HIDE_FAILED";
        }
        hiddenWindow = window;
        return "SUCCESS|HIDDEN";
    }

    private static String show(WinDef.HWND window) {
        User32.INSTANCE.ShowWindow(window, SW_RESTORE);
        User32.INSTANCE.SetForegroundWindow(window);
        if (!User32.INSTANCE.IsWindowVisible(window)) return "FAILED|WINDOW_RESTORE_FAILED";
        hiddenWindow = null;
        boolean reset = requestBackgroundMode(false);
        backgroundModeRequested = false;
        return reset ? "SUCCESS|SHOWN" : "SUCCESS|SHOWN|BACKGROUND_RESET_FAILED";
    }

    private static WinDef.HWND findWindow() {
        WinDef.HWND saved = hiddenWindow;
        if (saved != null && User32.INSTANCE.IsWindow(saved)) return saved;
        hiddenWindow = null;
        return User32.INSTANCE.FindWindow(null, "TaskBarHero");
    }

    private static boolean requestBackgroundMode(boolean enabled) {
        HttpURLConnection connection = null;
        try {
            String address = DllApiClient.getApiAddress();
            URL url = new URL("http://" + address + "/api/game/background/" + (enabled ? "enabled" : "disabled"));
            connection = (HttpURLConnection)url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(5000);
            int code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) return false;
            StringBuilder response = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) response.append(line);
            }
            return code == 200 && response.toString().startsWith("SUCCESS|");
        } catch (Exception ex) {
            System.err.println("[游戏窗口] 后台运行状态设置失败: " + ex.getMessage());
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}

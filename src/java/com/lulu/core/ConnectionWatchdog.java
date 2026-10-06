package com.lulu.core;

import com.lulu.api.DllApiClient;
import com.lulu.config.Config;
import com.sun.jna.platform.win32.User32;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * 防掉线看门狗：按设定的分钟数检查游戏进程与插件连接，
 * 检测到异常时结束游戏进程并重新启动。
 */
public final class ConnectionWatchdog {
    private static final int STEAM_APP_ID = 3678970;
    private static final long RELAUNCH_TIMEOUT_MS = 180000L;
    private static final ConnectionWatchdog INSTANCE = new ConnectionWatchdog();

    private volatile boolean enabled;
    private volatile int intervalMinutes = 10;
    private volatile boolean restarting;
    private volatile String status = "防掉线未启用。";
    private volatile int restartCount;
    private Thread thread;

    private ConnectionWatchdog() {
    }

    public static ConnectionWatchdog get() {
        return INSTANCE;
    }

    public void configure(boolean enabled, int minutes) {
        this.enabled = enabled;
        this.intervalMinutes = Math.max(1, Math.min(180, minutes));
        if (!enabled) this.status = "防掉线未启用。";
    }

    public boolean isEnabled() {
        return this.enabled;
    }

    public boolean isRestarting() {
        return this.restarting;
    }

    public String getStatus() {
        return this.status;
    }

    public int getRestartCount() {
        return this.restartCount;
    }

    /** 只启动一次后台线程；是否生效由 configure 的开关决定。 */
    public synchronized void start() {
        if (this.thread != null && this.thread.isAlive()) return;
        this.thread = new Thread(this::loop, "tbh-watchdog");
        this.thread.setDaemon(true);
        this.thread.start();
    }

    private void loop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                long waitMillis = Math.max(1, Math.min(180, this.intervalMinutes)) * 60000L;
                Thread.sleep(waitMillis);
                if (!this.enabled) continue;
                this.checkOnce();
            } catch (InterruptedException ex) {
                return;
            } catch (Exception ex) {
                this.status = "防掉线检查异常：" + ex.getMessage();
            }
        }
    }

    /** 执行一次检查；正常则记录状态，异常则重启游戏。 */
    public void checkOnce() {
        if (!this.enabled) {
            this.status = "防掉线未启用。";
            return;
        }
        boolean gameOpen = User32.INSTANCE.FindWindow(null, "TaskBarHero") != null;
        String pluginStatus = gameOpen ? DllApiClient.getGameStatus() : null;
        boolean connected = pluginStatus != null && pluginStatus.startsWith("SUCCESS|");
        if (gameOpen && connected) {
            this.status = "游戏与插件连接正常（" + time() + "）。";
            return;
        }
        this.status = !gameOpen
                ? "检测到游戏未运行，准备重启（" + time() + "）。"
                : "检测到插件连接异常，准备重启游戏（" + time() + "）。";
        System.out.println(">>> [防掉线] " + this.status);
        this.restartGame();
    }

    private void restartGame() {
        if (this.restarting) return;
        this.restarting = true;
        try {
            int pid = DeployManager.runningGameProcessId();
            killGame(pid);
            Thread.sleep(8000L);
            boolean launched = launchGame();
            this.restartCount++;
            this.status = launched
                    ? "已重启游戏（第 " + this.restartCount + " 次，" + time() + "）。"
                    : "重启游戏失败，请检查游戏目录或 Steam（" + time() + "）。";
            System.out.println(">>> [防掉线] " + this.status);
            if (launched) waitForGame();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } finally {
            this.restarting = false;
        }
    }

    private void killGame(int pid) {
        try {
            if (pid > 0) {
                new ProcessBuilder("taskkill", "/F", "/PID", String.valueOf(pid), "/T")
                        .redirectErrorStream(true).start().waitFor();
            } else {
                new ProcessBuilder("taskkill", "/F", "/IM", "TaskBarHero.exe", "/T")
                        .redirectErrorStream(true).start().waitFor();
            }
        } catch (Exception ex) {
            System.out.println("⚠️ [防掉线] 结束游戏进程失败：" + ex.getMessage());
        }
        long deadline = System.currentTimeMillis() + 15000L;
        while (System.currentTimeMillis() < deadline && DeployManager.runningGameProcessId() > 0) {
            try { Thread.sleep(500L); } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private boolean launchGame() {
        try {
            new ProcessBuilder("cmd", "/c", "start", "", "steam://rungameid/" + STEAM_APP_ID)
                    .redirectErrorStream(true).start();
            return true;
        } catch (Exception ex) {
            System.out.println("⚠️ [防掉线] Steam 启动失败，尝试直接运行游戏：" + ex.getMessage());
        }
        String gamePath = Config.UserData.GAME_PATH;
        if (gamePath != null && !gamePath.isEmpty()) {
            File folder = new File(gamePath);
            File exe = new File(folder, "TaskBarHero.exe");
            if (exe.isFile()) {
                try {
                    new ProcessBuilder(exe.getAbsolutePath()).directory(folder)
                            .redirectErrorStream(true).start();
                    return true;
                } catch (Exception ex) {
                    System.out.println("⚠️ [防掉线] 直接启动游戏失败：" + ex.getMessage());
                }
            }
        }
        return false;
    }

    private void waitForGame() {
        long deadline = System.currentTimeMillis() + RELAUNCH_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (User32.INSTANCE.FindWindow(null, "TaskBarHero") != null) {
                this.status = "游戏已重新启动，等待插件连接（" + time() + "）。";
                return;
            }
            try { Thread.sleep(5000L); } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        this.status = "重启后等待游戏窗口超时，请手动确认（" + time() + "）。";
    }

    private static String time() {
        return new SimpleDateFormat("HH:mm:ss").format(new Date());
    }
}

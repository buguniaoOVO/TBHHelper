package com.lulu.logic.monitor;

import com.lulu.config.Config;

public final class ChestTracker {
    private static final PeriodicSchedule BLUE = new PeriodicSchedule();
    private static final PeriodicSchedule WHITE = new PeriodicSchedule();
    private ChestTracker() { }

    public static synchronized void beginSession() {
        long now = System.currentTimeMillis();
        BLUE.start(now, Config.Chest.COOL_DOWN_BLUE_MS);
        WHITE.start(now, Config.Chest.COOL_DOWN_WHITE_MS);
    }
    public static synchronized boolean canOpenBlue() { return BLUE.due(System.currentTimeMillis(), Config.Chest.COOL_DOWN_BLUE_MS); }
    public static synchronized boolean canOpenWhite() { return WHITE.due(System.currentTimeMillis(), Config.Chest.COOL_DOWN_WHITE_MS); }
    public static synchronized long nextBlueOpenAt() { return BLUE.nextAt(Config.Chest.COOL_DOWN_BLUE_MS); }
    public static synchronized long nextWhiteOpenAt() { return WHITE.nextAt(Config.Chest.COOL_DOWN_WHITE_MS); }
    public static synchronized void markBlueChecked() { BLUE.checked(System.currentTimeMillis(), Config.Chest.COOL_DOWN_BLUE_MS); }
    public static synchronized void markWhiteChecked() { WHITE.checked(System.currentTimeMillis(), Config.Chest.COOL_DOWN_WHITE_MS); }
    public static void markBlueOpened() { System.out.println(">>> [开箱记录] 稀有/BOSS 宝箱本轮已开启。"); }
    public static void markWhiteOpened() { System.out.println(">>> [开箱记录] 普通宝箱本轮已开启。"); }
}

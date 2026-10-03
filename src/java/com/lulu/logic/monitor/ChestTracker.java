/*
 * Decompiled with CFR 0.152.
 */
package com.lulu.logic.monitor;

import com.lulu.config.Config;

public class ChestTracker {
    private static long lastBlueChestTime = 0L;
    private static long lastWhiteChestTime = 0L;

    public static boolean canOpenBlue() {
        return System.currentTimeMillis() - lastBlueChestTime >= Config.Chest.COOL_DOWN_BLUE_MS;
    }

    public static boolean canOpenWhite() {
        return System.currentTimeMillis() - lastWhiteChestTime >= Config.Chest.COOL_DOWN_WHITE_MS;
    }

    public static void markBlueOpened() {
        lastBlueChestTime = System.currentTimeMillis();
        System.out.println(">>> [\u8bb0\u5f55] \u84dd\u5b9d\u7bb1\u5df2\u5f00\u542f\uff0c\u8fdb\u5165 " + Config.Chest.COOL_DOWN_BLUE_MS / 60L / 1000L + " \u5206\u949f\u51b7\u5374");
    }

    public static void markWhiteOpened() {
        lastWhiteChestTime = System.currentTimeMillis();
        System.out.println(">>> [\u8bb0\u5f55] \u767d\u5b9d\u7bb1\u5df2\u5f00\u542f\uff0c\u8fdb\u5165" + Config.Chest.COOL_DOWN_WHITE_MS / 60L / 1000L + "\u5206\u949f\u51b7\u5374");
    }
}

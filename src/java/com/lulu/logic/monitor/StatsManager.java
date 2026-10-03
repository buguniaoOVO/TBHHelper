/*
 * Decompiled with CFR 0.152.
 */
package com.lulu.logic.monitor;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Properties;

public class StatsManager {
    private static final String FILE_NAME = "stats.properties";
    public static int totalBlue = 0;
    public static int totalWhite = 0;
    public static int sessionBlue = 0;
    public static int sessionWhite = 0;

    public static void load() {
        Properties prop = new Properties();
        try (FileInputStream in = new FileInputStream(FILE_NAME);){
            prop.load(in);
            totalBlue = Integer.parseInt(prop.getProperty("total_blue", "0"));
            totalWhite = Integer.parseInt(prop.getProperty("total_white", "0"));
        }
        catch (Exception e) {
            System.out.println(">>> [\u7edf\u8ba1] \u672a\u53d1\u73b0\u5386\u53f2\u6570\u636e\uff0c\u5c06\u4ece\u96f6\u5f00\u59cb\u8bb0\u5f55\u3002");
        }
    }

    public static void save() {
        Properties prop = new Properties();
        prop.setProperty("total_blue", String.valueOf(totalBlue));
        prop.setProperty("total_white", String.valueOf(totalWhite));
        try (FileOutputStream out = new FileOutputStream(FILE_NAME);){
            prop.store(out, "Chest Drop Statistics");
        }
        catch (IOException e) {
            System.err.println("\u274c \u7edf\u8ba1\u4fdd\u5b58\u5931\u8d25: " + e.getMessage());
        }
    }

    public static void addBlue() {
        ++totalBlue;
        ++sessionBlue;
        ActivityStore.recordChest("rare", "背包蓝色宝箱", 1);
        StatsManager.save();
    }

    public static void addWhite() {
        ++totalWhite;
        ++sessionWhite;
        ActivityStore.recordChest("normal", "背包普通宝箱", 1);
        StatsManager.save();
    }

    static {
        StatsManager.load();
    }
}

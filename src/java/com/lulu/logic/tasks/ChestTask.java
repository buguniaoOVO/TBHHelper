package com.lulu.logic.tasks;

import com.lulu.api.DllApiClient;
import com.lulu.logic.BotTask;
import com.lulu.logic.monitor.ChestTracker;
import com.lulu.logic.monitor.StatsManager;

public class ChestTask implements BotTask {
    private long nextBlueAttempt, nextWhiteAttempt;
    @Override public void execute() throws InterruptedException {
        long now = System.currentTimeMillis();
        if (ChestTracker.canOpenBlue() && now >= nextBlueAttempt) {
            nextBlueAttempt = now + 30000L;
            if (DllApiClient.clickBlueChest()) {
                if (!DllApiClient.waitForInventoryReady(90000L)) throw new IllegalStateException("开箱结果尚未稳定，自动任务已暂停。");
                ChestTracker.markBlueOpened();
                StatsManager.addBlue();
                System.out.println(">>> [开箱] 已完成一次蓝色宝箱交互，后续操作继续遵守统一间隔。");
            }
        }
        now = System.currentTimeMillis();
        if (ChestTracker.canOpenWhite() && now >= nextWhiteAttempt) {
            nextWhiteAttempt = now + 30000L;
            if (DllApiClient.clickWhiteChest()) {
                if (!DllApiClient.waitForInventoryReady(90000L)) throw new IllegalStateException("开箱结果尚未稳定，自动任务已暂停。");
                ChestTracker.markWhiteOpened();
                StatsManager.addWhite();
                System.out.println(">>> [开箱] 已完成一次普通宝箱交互，后续操作继续遵守统一间隔。");
            }
        }
    }
}

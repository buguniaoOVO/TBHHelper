package com.lulu.logic.tasks;

import com.lulu.api.DllApiClient;
import com.lulu.api.MonitorStatus;
import com.lulu.config.Config;
import com.lulu.core.AutomationEngine;
import com.lulu.logic.BotTask;

public class StoreTask implements BotTask {
    private static long lastStoreTime;
    private static long lastMissingDataNoticeTime;
    private static long nextStoreAttemptAt;
    private final int[][] pageCoordinates = new int[][]{
            Config.Store.FIRST_PAGE,
            Config.Store.SECOND_PAGE,
            Config.Store.THIRD_PAGE,
            Config.Store.FOURTH_PAGE,
            Config.Store.FIFTH_PAGE,
            Config.Store.SIXTH_PAGE,
            Config.Store.SEVENTH_PAGE
    };

    public boolean isDue() { return System.currentTimeMillis() >= this.nextExecutionAt(); }

    public long nextExecutionAt() {
        long cooldownAt = lastStoreTime == 0L ? 0L : lastStoreTime + Config.Store.COOL_DOWN_STORE_MS;
        return Math.max(cooldownAt, nextStoreAttemptAt);
    }

    @Override
    public void execute() {
        long now = System.currentTimeMillis();
        if (now < this.nextExecutionAt()) return;
        nextStoreAttemptAt = now + 10000L;
        MonitorStatus status = DllApiClient.getMonitorStatus();
        if (!status.isReady() || status.warehousePages < 1) {
            long noticeNow = System.currentTimeMillis();
            if (noticeNow - lastMissingDataNoticeTime >= 60000L) {
                System.out.println("⚠️ [仓库] 仓库格数数据尚未就绪，整理任务暂缓。");
                lastMissingDataNoticeTime = noticeNow;
            }
            return;
        }
        int ownedPages = status.warehousePages;
        System.out.println(">>> [仓库] 智能整理将检查 " + ownedPages + " 个已拥有页面。");
        this.executeBackendApi(ownedPages);
    }

    private void executeBackendApi(int ownedPages) {
        System.out.println(">>> 正在使用 [后台 API 模式] 执行仓库整理。");
        if (!DllApiClient.openStore()) {
            System.out.println("⚠️ 仓库界面未打开，整理任务暂停。");
            return;
        }
        try {
            Thread.sleep(800L);
            DllApiClient.clickStoreSort();
            Thread.sleep(600L);
            for (int page = 1; page <= ownedPages; page++) {
                if (!DllApiClient.clickStorePage(page)) {
                    System.out.println("⚠️ 仓库第 " + page + " 页无法读取，停止整理。");
                    return;
                }
                Thread.sleep(500L);
                if (!DllApiClient.checkStoreIsFull()) {
                    System.out.println("✅ 在仓库第 " + page + " 页发现空位，开始存入物品。");
                    DllApiClient.clickStoreDeposit();
                    lastStoreTime = System.currentTimeMillis();
                    return;
                }
                System.out.println(">>> 仓库第 " + page + "/" + ownedPages + " 页已满。");
            }
            System.out.println("仓库所有已拥有页面均已满。");
            lastStoreTime = System.currentTimeMillis();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            DllApiClient.closeStore();
        }
    }

    private void executeOpenCV(int ownedPages) {
        System.out.println(">>> 正在使用 [前台视觉模式] 整理仓库。");
        int pagesToScan = Math.min(ownedPages, this.pageCoordinates.length);
        if (ownedPages > pagesToScan) {
            System.out.println("⚠️ 前台模式支持扫描 " + pagesToScan + " 页；当前检测到 " + ownedPages + " 页。");
        }
        AutomationEngine.click(this.pageCoordinates[0]);
        if (!this.sleepSafe(800L)) {
            return;
        }
        AutomationEngine.click(Config.Store.SORT_BUT);
        if (!this.sleepSafe(1500L)) {
            return;
        }
        for (int pageIndex = 0; pageIndex < pagesToScan; pageIndex++) {
            boolean hasEmptySlot = AutomationEngine.exists("empty_slot.png",
                    Config.Store.END_SLOT_X, Config.Store.END_SLOT_Y,
                    Config.Store.END_SLOT_W, Config.Store.END_SLOT_H);
            if (hasEmptySlot) {
                System.out.println("✅ 在仓库第 " + (pageIndex + 1) + " 页发现空位，开始存入物品。");
                AutomationEngine.click(Config.Store.DEPOSIT_BUT);
                lastStoreTime = System.currentTimeMillis();
                return;
            }
            if (pageIndex + 1 >= pagesToScan) {
                System.out.println("仓库已拥有的 " + pagesToScan + " 页均已满。");
                lastStoreTime = System.currentTimeMillis();
                return;
            }
            if (!this.tryTurnToNextPage(pageIndex)) {
                System.out.println("⚠️ 无法翻到仓库第 " + (pageIndex + 2) + " 页。");
                return;
            }
            if (!this.sleepSafe(500L)) {
                return;
            }
        }
    }

    private boolean tryTurnToNextPage(int currentPageIndex) {
        int nextPageIndex = currentPageIndex + 1;
        return nextPageIndex < this.pageCoordinates.length
                && AutomationEngine.click(this.pageCoordinates[nextPageIndex]);
    }

    private boolean sleepSafe(long millis) {
        try {
            Thread.sleep(millis);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }
}

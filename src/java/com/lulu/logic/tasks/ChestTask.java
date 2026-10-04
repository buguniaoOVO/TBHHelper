package com.lulu.logic.tasks;

import com.lulu.api.DllApiClient;
import com.lulu.config.Config;
import com.lulu.logic.BotTask;
import com.lulu.logic.monitor.ChestTracker;
import com.lulu.logic.monitor.StatsManager;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public class ChestTask implements BotTask {
    private static final String[] WHITE_KINDS = {"normal", "plague-normal"};
    private static final String[] BLUE_KINDS = {"boss", "plague-boss", "actboss", "plague-actboss"};

    public ChestTask() { ChestTracker.beginSession(); }
    public boolean isBlueDue() { return ChestTracker.canOpenBlue(); }
    public boolean isWhiteDue() { return ChestTracker.canOpenWhite(); }
    public long nextBlueExecutionAt() { return ChestTracker.nextBlueOpenAt(); }
    public long nextWhiteExecutionAt() { return ChestTracker.nextWhiteOpenAt(); }

    public void executeBlue() throws InterruptedException {
        if (!isBlueDue()) return;
        ChestTracker.markBlueChecked();
        openKinds(BLUE_KINDS, true);
    }
    public void executeWhite() throws InterruptedException {
        if (!isWhiteDue()) return;
        ChestTracker.markWhiteChecked();
        openKinds(WHITE_KINDS, false);
    }

    private void openKinds(String[] orderedKinds, boolean blue) throws InterruptedException {
        Set<String> available = new HashSet<String>(Arrays.asList(DllApiClient.getAvailableChestKinds()));
        long nextKindAt = 0L;
        int opened = 0;
        for (String kind : orderedKinds) {
            if (!available.contains(kind)) continue;
            long remaining = nextKindAt - System.currentTimeMillis();
            if (remaining > 0L) Thread.sleep(remaining);
            String result = DllApiClient.openChestKind(kind);
            System.out.println(">>> [开箱] 类别=" + kind + "，右键批量结果=" + result);
            if ("EMPTY".equals(result)) continue;
            if (result == null || !result.startsWith("SUCCESS|"))
                throw new IllegalStateException("批量开箱状态待确认：" + kind + "，" + result);
            if (!DllApiClient.waitForInventoryReady(600000L))
                throw new IllegalStateException("批量开箱尚未完成，自动任务已暂停。");
            opened++;
            if (blue) { ChestTracker.markBlueOpened(); StatsManager.addBlue(); }
            else { ChestTracker.markWhiteOpened(); StatsManager.addWhite(); }
            nextKindAt = System.currentTimeMillis() + Config.Safety.ACTION_GAP_SECONDS * 1000L;
        }
        if (opened == 0) System.out.println(">>> [开箱] 本轮没有可开启的" + (blue ? "稀有/BOSS" : "普通")
                + "宝箱；下一轮按设置的 CD 检查。");
    }

    @Override public void execute() throws InterruptedException {
        if (isBlueDue()) executeBlue();
        else if (isWhiteDue()) executeWhite();
    }
}

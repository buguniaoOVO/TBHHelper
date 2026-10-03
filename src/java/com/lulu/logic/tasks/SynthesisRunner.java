package com.lulu.logic.tasks;

import com.lulu.api.DllApiClient;

public final class SynthesisRunner {
    private SynthesisRunner() {}

    public static String run(int type, boolean warehouse, int maxGrade, boolean useLevel, String level)
            throws InterruptedException {
        if (!DllApiClient.configureOperationPacing() || !DllApiClient.waitForInventoryReady(90000L))
            throw new IllegalStateException("合成等待库存结算，自动任务已暂停。");
        boolean submitted = false;
        if (!DllApiClient.openSynth()) throw new IllegalStateException("合成魔方未能打开。");
        try {
            if (!DllApiClient.selectSynthOperation("synthesis")) throw new IllegalStateException("未能选中合成菜单。");
            if (!"SUCCESS|operation=synthesis".equals(DllApiClient.getCurrentSynthOperation()))
                throw new IllegalStateException("当前魔方操作不是合成，本轮已取消。");
            if (!DllApiClient.clearSynth() || !DllApiClient.selectSynthType(type))
                throw new IllegalStateException("合成类别未就绪。");
            if (useLevel && !DllApiClient.selectSynthLevel(level)) throw new IllegalStateException("合成配方等级未选中。");
            String fill = DllApiClient.synthAutoFillResult(warehouse, false);
            if (!"SUCCESS".equals(fill)) {
                DllApiClient.clearSynth();
                if (fill != null && fill.startsWith("NOT_ENOUGH")) return "物品不足9件，已退回物品。";
                throw new IllegalStateException("自动填充未完成：" + fill);
            }
            submitted = true;
            String result = DllApiClient.executeSynthAction(maxGrade, false, "synthesis");
            if (!"SUCCESS".equals(result)) {
                if ("EXCEED_MAX_GRADE".equals(result) || "NOT_ENOUGH".equals(result)
                        || "WRONG_OPERATION".equals(result) || "EXPIRED|NOT_EXECUTED".equals(result)) {
                    submitted = false;
                    DllApiClient.clearSynth();
                    return "合成已取消：" + result;
                }
                throw new IllegalStateException("合成提交状态待确认，停止后续操作：" + result);
            }
            long deadline = System.nanoTime() + 90000000000L;
            while (System.nanoTime() < deadline) {
                String status = DllApiClient.getSynthesisActionStatus();
                if ("SUCCESS|COMPLETE".equals(status)) {
                    submitted = false;
                    DllApiClient.clearSynth();
                    return "游戏合成日志已返回，动画已结束。";
                }
                if (status != null && status.startsWith("FAILED|")) throw new IllegalStateException(status);
                Thread.sleep(1000L);
            }
            throw new IllegalStateException("合成结果仍未确认，停止后续操作并保留魔方。");
        } finally {
            if (!submitted && !Thread.currentThread().isInterrupted()) DllApiClient.closeSynth();
        }
    }
}

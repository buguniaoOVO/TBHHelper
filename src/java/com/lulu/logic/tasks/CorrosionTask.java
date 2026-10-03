package com.lulu.logic.tasks;

import com.lulu.api.DllApiClient;
import com.lulu.api.MonitorStatus;
import com.lulu.config.Config;
import com.lulu.core.AutomationEngine;
import com.lulu.logic.BotTask;
import com.lulu.vision.QualityVerifier;
import org.opencv.core.Mat;

public class CorrosionTask implements BotTask {
    private static final String[] GRADE_NAMES = new String[]{"普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙"};
    private static long lastCorrosionTime;
    private static long lastWarehouseSettingNoticeTime;
    private static volatile boolean corrosionRecoveryPending;
    private String lastResultMessage = "尚未执行腐蚀。";

    public void executeOnce() throws InterruptedException {
        if (corrosionRecoveryPending) {
            this.finishPendingCorrosionIfReady();
            return;
        }
        boolean completed = executeBackendApi(Config.Synthesis.corrosionUseWarehouse, null);
        if (completed) {
            lastCorrosionTime = System.currentTimeMillis();
        }
    }

    public String getLastResultMessage() {
        return this.lastResultMessage;
    }

    @Override
    public void execute() throws InterruptedException {
        if (corrosionRecoveryPending) {
            this.finishPendingCorrosionIfReady();
            return;
        }
        if (!Config.Synthesis.isCorrosionEnabled) {
            return;
        }
        MonitorStatus status = DllApiClient.getMonitorStatus();
        int pollutionThreshold = Config.Synthesis.CORROSION_POLLUTION_THRESHOLD;
        int warehouseThreshold = Config.Synthesis.CORROSION_WAREHOUSE_THRESHOLD_PERCENT;
        if (!status.isReady()) {
            this.lastResultMessage = "自动腐蚀等待污染度和全部已解锁仓库页数据。";
            return;
        }
        if (status.targetsMet(pollutionThreshold, warehouseThreshold)) {
            this.lastResultMessage = "已达标：污染度超过" + pollutionThreshold + "，仓库负载低于" + warehouseThreshold + "%。";
            return;
        }
        if (!status.corrosionNeeded(pollutionThreshold, warehouseThreshold)) {
            return;
        }
        if (status.warehousePercent >= warehouseThreshold && !Config.Synthesis.corrosionUseWarehouse) {
            long now = System.currentTimeMillis();
            this.lastResultMessage = "仓库负载已达" + warehouseThreshold + "%，请勾选“包含仓库”后自动腐蚀会继续。";
            if (now - lastWarehouseSettingNoticeTime >= 60000L) {
                System.out.println("⚠️ [自动腐蚀监控] 仓库负载已达 "
                        + String.format(java.util.Locale.ROOT, "%.1f%%", status.warehousePercent)
                        + "，目标阈值为" + warehouseThreshold + "%；请勾选“包含仓库”后继续。");
                lastWarehouseSettingNoticeTime = now;
            }
            return;
        }
        int intervalSeconds = Math.max(120, Config.Synthesis.CORROSION_AUTO_INTERVAL_SEC);
        long currentTime = System.currentTimeMillis();
        if (currentTime - lastCorrosionTime < intervalSeconds * 1000L) {
            return;
        }
        boolean warehouseRequired = status.shouldUseWarehouse(warehouseThreshold);
        boolean includeWarehouse = Config.Synthesis.corrosionUseWarehouse;
        String reason = (status.pollution <= pollutionThreshold ? "污染度不高于" + pollutionThreshold : "")
                + (status.pollution <= pollutionThreshold && warehouseRequired ? "；" : "")
                + (warehouseRequired ? "仓库负载达到" + warehouseThreshold + "%" : "");
        System.out.println(">>> [自动腐蚀监控] " + reason + "；当前污染度=" + status.pollution
                + "，仓库=" + String.format(java.util.Locale.ROOT, "%.1f%%", status.warehousePercent)
                + "；本批间隔=" + intervalSeconds + "秒。");
        executeBackendApi(includeWarehouse, status);
        lastCorrosionTime = System.currentTimeMillis();
    }

    private boolean executeBackendApi(boolean includeWarehouse, MonitorStatus before) throws InterruptedException {
        int maxGrade = Math.max(0, Math.min(GRADE_NAMES.length - 1, Config.Synthesis.corrosionMaxGrade));
        String gradeLimit = getGradeName(maxGrade);
        boolean excludeScrolls = Config.Synthesis.corrosionExcludeInscriptionScrolls;
        System.out.println(">>> [混合腐蚀设置] 物品范围=" + (includeWarehouse ? "背包+仓库" : "仅个人背包")
                + "；最高品质=" + gradeLimit + "；排除铭文卷轴=" + excludeScrolls + "；剔除铭文材料后逐格校验剩余物品，不要求填满9格。");
        if (before != null) {
            System.out.println(">>> [腐蚀前监控] 污染度=" + before.pollution
                    + "，仓库负载=" + String.format(java.util.Locale.ROOT, "%.1f%%", before.warehousePercent) + "。");
        }
        System.out.println(">>> [混合腐蚀] 打开魔方并准备自动填充装备与材料。");
        if (!DllApiClient.configureOperationPacing() || !DllApiClient.waitForInventoryReady(90000L)) {
            this.lastResultMessage = "库存或开箱请求尚未结算，暂停腐蚀并等待游戏连接稳定。";
            throw new IllegalStateException(this.lastResultMessage);
        }
        boolean closeCubeWhenDone = true;
        if (!DllApiClient.openSynth()) {
            this.lastResultMessage = "腐蚀失败：魔方未能打开。";
            System.out.println("⚠️ [混合腐蚀] 打开魔方失败，本轮跳过。");
            return false;
        }
        try {
            Thread.sleep(1000L);
            boolean operationSelected = DllApiClient.selectSynthOperation("corrosion");
            Thread.sleep(1000L);
            if (!operationSelected) {
                this.lastResultMessage = "腐蚀失败：未能选择腐蚀操作。";
                System.out.println("⚠️ [混合腐蚀] 选择腐蚀操作失败，本轮跳过。");
                return false;
            }
            String fillResult = fillEquipmentAndMaterial(includeWarehouse, excludeScrolls);
            if (!"SUCCESS".equals(fillResult)) {
                boolean cleared = DllApiClient.clearSynth();
                Thread.sleep(1000L);
                if (isNotEnough(fillResult)) {
                    int filled = getFilledCount(fillResult);
                    this.lastResultMessage = "未执行腐蚀：剔除后没有可腐蚀物品" + (filled >= 0 ? "（最后检测 " + filled + "/9）" : "") + "。";
                    System.out.println(">>> [混合腐蚀] 装备与材料类别均尝试后没有可腐蚀物品" + (filled >= 0 ? "（最后检测 " + filled + "/9）" : "") + "，已退回已选物品。");
                    return true;
                }
                this.lastResultMessage = "腐蚀失败：自动填充未完成（" + fillResult + "），已" + (cleared ? "清空魔方。" : "尝试清空魔方。");
                System.out.println("⚠️ [混合腐蚀] 自动填充未完成（" + fillResult + "），已清空魔方。");
                return false;
            }
            Thread.sleep(1000L);
            if (excludeScrolls) {
                String purged = DllApiClient.purgeExcludedCorrosionMaterials();
                if (purged != null && purged.startsWith("CORROSION_EMPTY|")) {
                    this.lastResultMessage = "剔除铭文材料后没有可腐蚀物品，本轮跳过。";
                    DllApiClient.clearSynth();
                    return true;
                }
                if (purged == null || !purged.startsWith("CORROSION_READY|"))
                    throw new IllegalStateException("铭文材料退回尚未完成：" + purged);
            }
            if (!DllApiClient.waitForInventoryReady(60000L)) {
                this.lastResultMessage = "库存状态尚未同步，本轮腐蚀取消，已退回物品。";
                DllApiClient.clearSynth();
                throw new IllegalStateException(this.lastResultMessage);
            }
            closeCubeWhenDone = false;
            String result = DllApiClient.executeSynthAction(maxGrade, excludeScrolls, "corrosion");
            for (int retry = 0; "NEEDS_EXCLUSION".equals(result) && retry < 2; retry++) {
                String purged = DllApiClient.purgeExcludedCorrosionMaterials();
                if (purged != null && purged.startsWith("CORROSION_READY|"))
                    result = DllApiClient.executeSynthAction(maxGrade, excludeScrolls, "corrosion");
                else if (purged != null && purged.startsWith("CORROSION_EMPTY|")) result = "NOT_ENOUGH";
                else throw new IllegalStateException("铭文材料退回尚未完成，保持魔方等待：" + purged);
            }
            if (result == null || result.startsWith("PENDING|") || "CORROSION_PENDING".equals(result) || "ACTION_PENDING".equals(result)) {
                closeCubeWhenDone = false;
                corrosionRecoveryPending = true;
                this.lastResultMessage = "腐蚀提交状态待确认，自动任务已停止；保持魔方打开等待游戏结果。";
                throw new IllegalStateException(this.lastResultMessage);
            }
            if ("SUCCESS".equals(result)) {
                corrosionRecoveryPending = true;
                this.lastResultMessage = "腐蚀已触发：等待服务器结果和全部腐蚀动画完成。";
                System.out.println("✅ [混合腐蚀] 当前物品通过品质和排除项检查；等待腐蚀结果及动画结束。");
                String animationStatus = waitForCorrosionAnimationCompletion();
                if ("SUCCESS|COMPLETE".equals(animationStatus)) {
                    corrosionRecoveryPending = false;
                    closeCubeWhenDone = true;
                    this.lastResultMessage = "腐蚀已完成：剩余合格物品，逐件品质≤" + gradeLimit + "。";
                    System.out.println("✅ [混合腐蚀] 游戏结果已返回且腐蚀动画已结束。");
                } else if (animationStatus != null && animationStatus.startsWith("FAILED|COMPLETE")) {
                    closeCubeWhenDone = false;
                    this.lastResultMessage = "服务器拒绝腐蚀，自动任务已停止：" + animationStatus;
                    throw new IllegalStateException(this.lastResultMessage);
                } else {
                    closeCubeWhenDone = false;
                    corrosionRecoveryPending = true;
                    this.lastResultMessage = "腐蚀仍在运行：等待动画完成；暂停下一轮并保持魔方打开。";
                    System.out.println("⚠️ [混合腐蚀] 等待结果超时；保持魔方打开并暂停后续腐蚀，直到检测到动画完成。");
                    throw new IllegalStateException(this.lastResultMessage);
                }
            } else if ("EXCEED_MAX_GRADE".equals(result)) {
                closeCubeWhenDone = true;
                this.lastResultMessage = "已取消腐蚀：存在高于 " + gradeLimit + " 或无法识别的物品。";
                System.out.println("🛑 [混合腐蚀] 安全锁拦截：存在超过 " + gradeLimit + " 或无法识别的物品，正在退回。");
                DllApiClient.clearSynth();
                Thread.sleep(1000L);
            } else if (result != null && result.startsWith("EXCLUDED_ITEM")) {
                closeCubeWhenDone = true;
                this.lastResultMessage = "未执行腐蚀：发现设定排除的铭文卷轴，已退回物品。";
                System.out.println("🛑 [混合腐蚀] 排除项安全锁拦截；该卷轴不会被腐蚀。");
                DllApiClient.clearSynth();
                Thread.sleep(1000L);
            } else if ("NOT_ENOUGH".equals(result)) {
                closeCubeWhenDone = true;
                this.lastResultMessage = "未执行腐蚀：剔除后没有可腐蚀物品。";
                System.out.println(">>> [混合腐蚀] 魔方内没有合格物品，本轮跳过。");
                DllApiClient.clearSynth();
                Thread.sleep(1000L);
            } else {
                if ("WRONG_OPERATION".equals(result) || "EXPIRED|NOT_EXECUTED".equals(result) || "GAME_NOT_READY".equals(result)
                        || (result != null && result.startsWith("THROTTLED|"))) closeCubeWhenDone = true;
                this.lastResultMessage = "未提交腐蚀：游戏或执行检查尚未允许当前批次（" + result + "）。";
                System.out.println(">>> [混合腐蚀] 本轮未提交（" + result + "）。");
                if (closeCubeWhenDone) DllApiClient.clearSynth();
                Thread.sleep(1000L);
                return false;
            }
            return true;
        } finally {
            if (closeCubeWhenDone) {
                Thread.sleep(1000L);
                DllApiClient.closeSynth();
                Thread.sleep(1000L);
            }
            if (this.lastResultMessage.startsWith("腐蚀已完成")) {
                DllApiClient.invalidateMonitorStatus();
                MonitorStatus after = DllApiClient.refreshMonitorStatus();
                if (after.isReady()) {
                    System.out.println(">>> [腐蚀后监控] 污染度=" + after.pollution
                            + "，仓库负载=" + String.format(java.util.Locale.ROOT, "%.1f%%", after.warehousePercent) + "。");
                }
            }
        }
    }

    private String fillEquipmentAndMaterial(boolean includeWarehouse, boolean excludeScrolls) throws InterruptedException {
        int[] types = new int[]{0, 2};
        for (int type : types) {
            if (!DllApiClient.selectSynthType(type)) return "TYPE_SELECT_FAILED";
            String result = DllApiClient.corrosionAutoFillResult(includeWarehouse, excludeScrolls);
            if (result != null && result.startsWith("CORROSION_READY|")) {
                System.out.println(">>> [混合腐蚀] 剔除后" + result + "；本批不要求填满9格。");
                return "SUCCESS";
            }
            if (result == null || !result.startsWith("CORROSION_EMPTY|")) return result;
        }
        return "NOT_ENOUGH_0";
    }

    private static String waitForCorrosionAnimationCompletion() throws InterruptedException {
        long deadline = System.currentTimeMillis() + 90000L;
        String status = "SUCCESS|RUNNING";
        while (System.currentTimeMillis() < deadline) {
            status = DllApiClient.getCorrosionActionStatus();
            if ("SUCCESS|COMPLETE".equals(status) || (status != null && status.startsWith("FAILED|COMPLETE"))) {
                return status;
            }
            Thread.sleep(1000L);
        }
        return status;
    }

    private void finishPendingCorrosionIfReady() throws InterruptedException {
        String status = DllApiClient.getCorrosionActionStatus();
        if (status != null && status.startsWith("FAILED|COMPLETE")) {
            corrosionRecoveryPending = false;
            this.lastResultMessage = "服务器拒绝腐蚀，自动任务已停止：" + status;
            throw new IllegalStateException(this.lastResultMessage);
        }
        if ("SUCCESS|COMPLETE".equals(status)) {
            Thread.sleep(1000L);
            DllApiClient.closeSynth();
            Thread.sleep(1000L);
            corrosionRecoveryPending = false;
            lastCorrosionTime = System.currentTimeMillis();
            this.lastResultMessage = "腐蚀动画已完成，魔方已关闭；自动流程可以继续。";
            System.out.println(">>> [混合腐蚀] 延迟完成状态已确认，魔方安全关闭。");
        } else {
            this.lastResultMessage = "腐蚀仍在运行：等待动画完成；新一轮已暂停。";
        }
    }

    private static boolean isNotEnough(String result) {
        return result != null && ("NOT_ENOUGH".equals(result) || result.startsWith("NOT_ENOUGH_"));
    }

    private static int getFilledCount(String result) {
        if (result == null || !result.startsWith("NOT_ENOUGH_")) {
            return -1;
        }
        try {
            return Integer.parseInt(result.substring("NOT_ENOUGH_".length()));
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private boolean executeOpenCV() throws InterruptedException {
        if (!AutomationEngine.exists(Config.Synthesis.CUBE)) {
            AutomationEngine.click(Config.Synthesis.CUBE_BUT);
            Thread.sleep(800L);
            if (!AutomationEngine.exists(Config.Synthesis.CUBE)) {
                System.out.println("⚠️ [前台混合腐蚀] 魔方界面未打开，本轮跳过。");
                return false;
            }
        }
        try {
            executeOpenCVCore();
        } finally {
            AutomationEngine.click(Config.Synthesis.Back_BUT);
            Thread.sleep(800L);
        }
        return true;
    }

    private void executeOpenCVCore() throws InterruptedException {
        boolean includeWarehouse = Config.Synthesis.corrosionUseWarehouse;
        int maxGrade = Config.Synthesis.corrosionMaxGrade;
        Thread.sleep(800L);
        AutomationEngine.click(Config.Synthesis.Toolbar_BUT);
        Thread.sleep(500L);
        AutomationEngine.click(Config.Synthesis.corrosion_BUT);
        Thread.sleep(500L);
        AutomationEngine.click(1214, 953);

        double checked = AutomationEngine.getMatchScore(
                Config.Synthesis.green_img,
                Config.Synthesis.ROI_X_1, Config.Synthesis.ROI_Y_1,
                Config.Synthesis.ROI_W_1, Config.Synthesis.ROI_H_1);
        double unchecked = AutomationEngine.getMatchScore(
                Config.Synthesis.black_img,
                Config.Synthesis.ROI_X_1, Config.Synthesis.ROI_Y_1,
                Config.Synthesis.ROI_W_1, Config.Synthesis.ROI_H_1);
        if (checked > unchecked && checked > Config.Global.MATCH_THRESHOLD && !includeWarehouse) {
            AutomationEngine.click(Config.Synthesis.point);
        } else if (unchecked > checked && unchecked > Config.Global.MATCH_THRESHOLD && includeWarehouse) {
            AutomationEngine.click(Config.Synthesis.point);
        }

        AutomationEngine.click(Config.Synthesis.AutoFill_BUT);
        Thread.sleep(800L);
        if (AutomationEngine.exists(Config.Synthesis.NotMet_IMG,
                Config.Synthesis.ROI_X, Config.Synthesis.ROI_Y,
                Config.Synthesis.ROI_W, Config.Synthesis.ROI_H)) {
            System.out.println(">>> [前台混合腐蚀] 物品不足 9 件，跳过本轮。");
            return;
        }

        Mat firstItemRoi = AutomationEngine.getRawMat(1124, 565, 1, 51);
        QualityVerifier.ItemQuality qualityLimit = QualityVerifier.ItemQuality.values()[Math.max(0, Math.min(9, maxGrade))];
        if (!QualityVerifier.isSafeToSynthesize(firstItemRoi, qualityLimit)) {
            System.out.println("🛑 [前台混合腐蚀] 安全锁拦截：物品品质超过 " + qualityLimit.getName() + "。");
            return;
        }

        System.out.println("✅ [前台混合腐蚀] 品质检查通过，执行混合腐蚀。");
        AutomationEngine.click(Config.Synthesis.Execute_BUT);
        AutomationEngine.click(1214, 953);
        Thread.sleep(1500L);
        int timeout = 0;
        while (timeout <= 20 && !AutomationEngine.exists(Config.Synthesis.NotMet_IMG,
                Config.Synthesis.ROI_X, Config.Synthesis.ROI_Y,
                Config.Synthesis.ROI_W, Config.Synthesis.ROI_H)) {
            timeout++;
            Thread.sleep(500L);
        }
        if (timeout > 20) {
            System.out.println("⚠️ [前台混合腐蚀] 等待执行结果超时。");
        }
    }

    private String getGradeName(int gradeIndex) {
        return gradeIndex >= 0 && gradeIndex < GRADE_NAMES.length
                ? GRADE_NAMES[gradeIndex] + " (" + gradeIndex + ")"
                : "未知 (" + gradeIndex + ")";
    }
}

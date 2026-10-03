package com.lulu.logic.tasks;

import com.lulu.api.DllApiClient;
import com.lulu.config.Config;
import com.lulu.logic.BotTask;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

public final class PlaguelandsTask implements BotTask {
    private long nextCheckAt;
    private volatile String lastResultMessage = "地图检测等待启动。";

    public String getLastResultMessage() {
        return this.lastResultMessage;
    }

    public static String formatCurrentMap(String response) {
        if (response == null || !response.startsWith("SUCCESS")) {
            return "等待游戏地图数据";
        }
        Map<String, String> values = parse(response);
        String stage = decode(values.get("stage_b64"));
        if (stage.isEmpty()) {
            return "当前地图：等待关卡名称";
        }
        String suffix = "true".equals(values.get("is_plague")) ? "（瘟疫之地）"
                : "false".equals(values.get("is_plague")) ? "（其他地图）" : "（识别中）";
        return "当前地图：" + stage + suffix;
    }

    public static String currentMapName(String response) {
        if (response == null || !response.startsWith("SUCCESS")) {
            return "";
        }
        return decode(parse(response).get("stage_b64"));
    }

    public static boolean isInCombat(String response) {
        return response != null && "true".equals(parse(response).get("in_combat"));
    }

    @Override
    public void execute() {
        if (!Config.Global.AUTO_PLAGUELANDS_ENABLED) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now < this.nextCheckAt) {
            return;
        }
        int intervalMinutes = Math.max(1, Math.min(1440, Config.Global.PLAGUELANDS_CHECK_INTERVAL_MIN));
        this.nextCheckAt = now + intervalMinutes * 60_000L;
        this.checkAndRoute();
    }

    private void checkAndRoute() {
        String response = DllApiClient.getGameStatus();
        if (response == null || !response.startsWith("SUCCESS")) {
            this.lastResultMessage = "地图检测等待游戏数据。";
            return;
        }
        Map<String, String> values = parse(response);
        String stage = decode(values.get("stage_b64"));
        String isPlague = values.getOrDefault("is_plague", "?");
        if ("true".equals(isPlague)) {
            this.lastResultMessage = "当前地图：" + (stage.isEmpty() ? "瘟疫之地" : stage) + "。";
            return;
        }
        if (!"false".equals(isPlague)) {
            this.lastResultMessage = "当前地图尚未识别，等待游戏界面数据。";
            return;
        }
        int level = Math.max(1, Math.min(20, Config.Global.PLAGUELANDS_TARGET_LEVEL));
        String routeResult = DllApiClient.routeToPlaguelands(level);
        if ("SUCCESS".equals(routeResult)) {
            this.lastResultMessage = "当前地图为“" + (stage.isEmpty() ? "未知地图" : stage)
                    + "”，已请求前往瘟疫之地 " + level + "。";
            System.out.println(">>> [瘟疫之地] 当前地图不是瘟疫之地，已请求切换到第 " + level + " 级。");
        } else if (routeResult.startsWith("POLLUTION_TOO_LOW:")) {
            String[] pollutionValues = routeResult.split(":", 3);
            String current = pollutionValues.length > 1 ? pollutionValues[1] : "未知";
            String required = pollutionValues.length > 2 ? pollutionValues[2] : "未知";
            this.lastResultMessage = "污染度不足，当前 " + current + "，进入瘟疫之地需要 " + required + "。";
            System.out.println("⚠️ [瘟疫之地] 暂不切换：污染度 " + current + " / 需要 " + required + "。");
        } else if ("PLAGUE_LOCKED".equals(routeResult) || "STAGE_LOCKED".equals(routeResult)) {
            this.lastResultMessage = "瘟疫之地入口或目标强度仍处于游戏锁定状态。";
            System.out.println("⚠️ [瘟疫之地] 游戏内入口仍锁定，等待解锁后重试。");
        } else if ("LEVEL_UNAVAILABLE".equals(routeResult)) {
            this.lastResultMessage = "游戏当前未提供第 " + level + " 级强度。";
            System.out.println("⚠️ [瘟疫之地] 当前游戏界面没有开放第 " + level + " 级强度。");
        } else {
            this.lastResultMessage = "前往瘟疫之地失败：" + routeResult + "。";
            System.out.println("⚠️ [瘟疫之地] 自动切换失败（" + routeResult + "）。");
        }
    }

    private static Map<String, String> parse(String response) {
        Map<String, String> result = new HashMap<String, String>();
        for (String part : response.split("\\|")) {
            int index = part.indexOf('=');
            if (index > 0) {
                result.put(part.substring(0, index), part.substring(index + 1));
            }
        }
        return result;
    }

    private static String decode(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        try {
            return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ex) {
            return "";
        }
    }
}

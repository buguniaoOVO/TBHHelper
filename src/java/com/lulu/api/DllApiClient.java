/*
 * Decompiled with CFR 0.152.
 */
package com.lulu.api;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.CancellationException;

public class DllApiClient {
    private static final String BASE_URL = "http://127.0.0.1:19090/api";
    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final AtomicLong LAST_API_WARNING_AT = new AtomicLong(0L);
    private static MonitorStatus monitorStatusCache = MonitorStatus.unknown();
    private static long monitorStatusReadAt;
    private static final Object ACTION_LOCK = new Object();
    private static long lastUiActionNanos;
    private static long pacingConfiguredAt;
    private static int pacingConfiguredSeconds;

    public static synchronized boolean configureOperationPacing() {
        int seconds = com.lulu.config.Config.Safety.ACTION_GAP_SECONDS;
        if (seconds == pacingConfiguredSeconds && System.currentTimeMillis() - pacingConfiguredAt < 30000L) return true;
        String result = sendGet("/automation/pacing/" + seconds, 5000);
        if (result == null || !result.startsWith("SUCCESS|")) return false;
        pacingConfiguredSeconds = seconds;
        pacingConfiguredAt = System.currentTimeMillis();
        return true;
    }

    private static String sendAction(String endpoint) {
        boolean serverAction = endpoint.startsWith("/chest/") || endpoint.startsWith("/synth/execute/")
                || endpoint.equals("/store/sort") || endpoint.equals("/store/deposit");
        if (!configureOperationPacing()) throw new IllegalStateException("操作保护接口未连接，请加载匹配的新插件。");
        try {
            if (serverAction && !waitForInventoryReady(90000L))
                throw new IllegalStateException("上一次操作尚未结算或游戏返回错误，自动任务已暂停。");
            synchronized (ACTION_LOCK) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                long wait = 2000000000L - (System.nanoTime() - lastUiActionNanos);
                if (wait > 0) Thread.sleep(Math.max(1L, wait / 1000000L));
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                String result = sendGet(endpoint, endpoint.startsWith("/synth/autofill/") || endpoint.equals("/synth/purge_inscription") ? 60000 : READ_TIMEOUT_MS);
                lastUiActionNanos = System.nanoTime();
                if (serverAction && !endpoint.startsWith("/synth/execute/")
                        && (result == null || result.startsWith("PENDING|") || result.startsWith("THROTTLED|")
                            || result.startsWith("FAILED|") || "ACTION_PENDING".equals(result)))
                    throw new IllegalStateException("操作结果待确认，自动任务已暂停：" + result);
                return result;
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new CancellationException("自动操作已停止");
        }
    }

    private static String sendGet(String endpoint) {
        return DllApiClient.sendGet(endpoint, READ_TIMEOUT_MS);
    }

    private static String sendGet(String endpoint, int readTimeoutMs) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(BASE_URL + endpoint);
            conn = (HttpURLConnection)url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(Math.max(1000, readTimeoutMs));
            int responseCode = conn.getResponseCode();
            if (responseCode == 200 || responseCode == 400) {
                String inputLine;
                BufferedReader in = new BufferedReader(new InputStreamReader(responseCode == 200 ? conn.getInputStream() : conn.getErrorStream(), StandardCharsets.UTF_8));
                StringBuilder response = new StringBuilder();
                while ((inputLine = in.readLine()) != null) {
                    if (response.length() > 0) {
                        response.append('\n');
                    }
                    response.append(inputLine);
                }
                in.close();
                return response.toString();
            }
        }
        catch (Exception e) {
            long now = System.currentTimeMillis();
            long previous = LAST_API_WARNING_AT.get();
            if (now - previous >= 10000L && LAST_API_WARNING_AT.compareAndSet(previous, now)) {
                System.err.println("[API Exception] HTTP \u901a\u4fe1\u5931\u8d25\uff08\u6700\u8fd1 10 \u79d2\u5408\u5e76\uff09: " + e.getMessage());
            }
        }
        finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    public static boolean clickWhiteChest() {
        return "SUCCESS".equals(DllApiClient.sendAction("/chest/white"));
    }

    public static boolean clickBlueChest() {
        return "SUCCESS".equals(DllApiClient.sendAction("/chest/blue"));
    }

    public static boolean openStore() {
        return "SUCCESS".equals(DllApiClient.sendAction("/store/open"));
    }

    public static boolean closeStore() {
        return "SUCCESS".equals(DllApiClient.sendAction("/store/close"));
    }

    public static boolean clickStorePage(int pageNum) {
        return "SUCCESS".equals(DllApiClient.sendAction("/store/page/" + pageNum));
    }

    public static boolean clickStoreSort() {
        return "SUCCESS".equals(DllApiClient.sendAction("/store/sort"));
    }

    public static boolean clickStoreDeposit() {
        return "SUCCESS".equals(DllApiClient.sendAction("/store/deposit"));
    }

    public static boolean checkStoreIsFull() {
        return "FULL".equals(DllApiClient.sendGet("/store/check_full"));
    }

    public static boolean openSynth() {
        return "SUCCESS".equals(DllApiClient.sendAction("/synth/open"));
    }

    public static boolean closeSynth() {
        return "SUCCESS".equals(DllApiClient.sendAction("/synth/close"));
    }

    public static boolean clearSynth() {
        return "SUCCESS".equals(DllApiClient.sendAction("/synth/clear"));
    }

    public static boolean selectSynthType(int typeInt) {
        return "SUCCESS".equals(DllApiClient.sendAction("/synth/type/" + typeInt));
    }

    public static boolean selectSynthOperation(String operation) {
        return "SUCCESS".equals(DllApiClient.sendAction("/synth/operation/" + operation));
    }

    public static boolean selectSynthLevel(String level) {
        return "SUCCESS".equals(DllApiClient.sendAction("/synth/level/" + level));
    }

    public static boolean synthAutoFill(boolean useStorage) {
        return "SUCCESS".equals(DllApiClient.synthAutoFillResult(useStorage));
    }

    public static String synthAutoFillResult(boolean useStorage) {
        return DllApiClient.synthAutoFillResult(useStorage, false);
    }

    public static String synthAutoFillResult(boolean useStorage, boolean excludeInscriptionScrolls) {
        return DllApiClient.sendAction("/synth/autofill/" + useStorage + "/" + excludeInscriptionScrolls);
    }

    public static String corrosionAutoFillResult(boolean useStorage, boolean excludeMaterials) {
        return sendAction("/synth/autofill/" + useStorage + "/" + excludeMaterials + "/corrosion");
    }

    public static String purgeExcludedCorrosionMaterials() {
        return sendAction("/synth/purge_inscription");
    }

    public static String executeSynthAction(int maxGrade) {
        return DllApiClient.executeSynthAction(maxGrade, false);
    }

    public static String executeSynthAction(int maxGrade, boolean excludeInscriptionScrolls) {
        return executeSynthAction(maxGrade, excludeInscriptionScrolls, "synthesis");
    }

    public static String executeSynthAction(int maxGrade, boolean excludeInscriptionScrolls, String operation) {
        return DllApiClient.sendAction("/synth/execute/" + maxGrade + "/" + excludeInscriptionScrolls + "/" + operation);
    }

    public static String getSynthesisActionStatus() {
        return sendGet("/synth/synthesis_status", 5000);
    }

    public static String getCurrentSynthOperation() {
        return sendGet("/synth/current_operation", 5000);
    }

    public static synchronized MonitorStatus getMonitorStatus() {
        long now = System.currentTimeMillis();
        if (now - monitorStatusReadAt < 10000L) {
            return monitorStatusCache;
        }
        return DllApiClient.refreshMonitorStatus();
    }

    public static synchronized MonitorStatus refreshMonitorStatus() {
        String response = DllApiClient.sendGet("/monitor/status");
        if (response != null) {
            monitorStatusCache = MonitorStatus.parse(response);
        } else {
            monitorStatusCache = MonitorStatus.unknown();
        }
        monitorStatusReadAt = System.currentTimeMillis();
        return monitorStatusCache;
    }

    public static synchronized void invalidateMonitorStatus() {
        monitorStatusReadAt = 0L;
    }

    public static String pollGameEvents() {
        return DllApiClient.sendGet("/events/poll", 5000);
    }

    public static String getWarehouseItems() {
        return DllApiClient.sendGet("/store/items", 10000);
    }

    public static String getInventoryReadiness() {
        return DllApiClient.sendGet("/inventory/readiness", 5000);
    }

    public static boolean waitForInventoryReady(long timeoutMillis) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            String result = getInventoryReadiness();
            if ("READY".equals(result)) return true;
            if (result == null || result.startsWith("FAILED|")) return false;
            Thread.sleep(1000L);
        }
        return false;
    }

    public static String refreshNativeGameLogSnapshot() {
        return DllApiClient.sendGet("/events/refresh", 5000);
    }

    public static boolean acknowledgeGameEvents(String response) {
        if (response == null || response.isEmpty() || "EMPTY".equals(response)) {
            return true;
        }
        int count = 0;
        for (String line : response.split("\\r?\\n")) {
            if (line.startsWith("E\t")) count++;
        }
        return count == 0 || "SUCCESS".equals(DllApiClient.sendGet("/events/ack/" + count, 5000));
    }

    public static String getCorrosionActionStatus() {
        return DllApiClient.sendGet("/synth/corrosion_status", 5000);
    }

    public static String getGameStatus() {
        return DllApiClient.sendGet("/game/status");
    }

    public static String routeToPlaguelands(int level) {
        return DllApiClient.sendAction("/plague/route/" + Math.max(1, Math.min(20, level)));
    }
}

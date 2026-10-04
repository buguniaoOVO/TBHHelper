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
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CancellationException;

public class DllApiClient {
    private static final String API_HOST = "127.0.0.1";
    private static volatile String apiAddress = API_HOST + ":19090";
    private static volatile String baseUrl = "http://" + apiAddress + "/api";
    private static volatile BridgeEndpoint discoveredEndpoint;
    private static long endpointReadAt;
    private static volatile boolean initializationReady;
    private static volatile String initializationMessage = "正在初始化游戏 DLL。";
    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final AtomicLong LAST_API_WARNING_AT = new AtomicLong(0L);
    private static final AtomicLong ACTION_SEQUENCE = new AtomicLong(0L);
    private static final AtomicInteger QUEUED_ACTIONS = new AtomicInteger(0);
    private static MonitorStatus monitorStatusCache = MonitorStatus.unknown();
    private static long monitorStatusReadAt;
    private static final Object ACTION_LOCK = new Object();
    private static long lastUiActionNanos;
    private static long pacingConfiguredAt;
    private static int pacingConfiguredSeconds;
    private static long clickPacingConfiguredAt;
    private static int clickPacingConfiguredSeconds;
    private static volatile String activeAction = "";
    private static volatile long nextActionAtMillis;
    private static volatile boolean compatiblePlugin;
    private static volatile boolean pluginUpdateRequired;
    private static volatile long pluginCheckedAt;
    private static volatile String compatibilityMessage = "游戏插件未连接。";
    private static final String EXPECTED_PLUGIN_HASH = packagedPluginHash();

    private static String packagedPluginHash() {
        try {
            java.nio.file.Path plugin = java.nio.file.Paths.get(System.getProperty("user.dir"), "TBHPlugin-自动腐蚀版.dll");
            if (!java.nio.file.Files.isRegularFile(plugin)) return "";
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(plugin));
            StringBuilder hash = new StringBuilder();
            for (byte value : digest) hash.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            return hash.toString();
        } catch (Exception ex) { return ""; }
    }

    public static boolean isPluginUpdateRequired() { return pluginUpdateRequired; }
    public static String getCompatibilityMessage() { return compatibilityMessage; }

    public static String getApiAddress() { return apiAddress; }
    public static boolean isInitializationReady() { return initializationReady; }

    public static void setInitializationState(boolean ready, boolean waitForExit, String message) {
        initializationReady = ready;
        initializationMessage = message;
        if (!ready) {
            compatiblePlugin = false;
            pluginUpdateRequired = waitForExit;
            compatibilityMessage = message;
        }
    }

    private static synchronized void refreshEndpoint() {
        long now = System.currentTimeMillis();
        if (now - endpointReadAt < 1000L) return;
        endpointReadAt = now;
        int processId = com.lulu.core.DeployManager.runningGameProcessId();
        BridgeEndpoint found = null;
        String localAppData = System.getenv("LOCALAPPDATA");
        if (processId > 0 && localAppData != null) {
            found = BridgeEndpoint.read(java.nio.file.Paths.get(localAppData, "TBHHelper", "bridge",
                    "game-" + processId + ".properties"), processId);
        }
        String address = found == null ? API_HOST + ":19090" : found.address();
        boolean changed = !address.equals(apiAddress)
                || (found != null && (discoveredEndpoint == null || !found.instanceId.equals(discoveredEndpoint.instanceId)));
        discoveredEndpoint = found;
        if (changed) {
            apiAddress = address;
            baseUrl = "http://" + address + "/api";
            compatiblePlugin = false;
            pacingConfiguredAt = clickPacingConfiguredAt = 0L;
            System.out.println(">>> [接口发现] 游戏进程=" + processId + "，本机 API=" + address);
        }
    }

    public static synchronized boolean configureOperationPacing() {
        int seconds = com.lulu.config.Config.Safety.ACTION_GAP_SECONDS;
        if (seconds == pacingConfiguredSeconds && System.currentTimeMillis() - pacingConfiguredAt < 30000L) return true;
        String result = sendGet("/automation/pacing/" + seconds, 5000);
        if (result == null || !result.startsWith("SUCCESS|")) return false;
        pacingConfiguredSeconds = seconds;
        pacingConfiguredAt = System.currentTimeMillis();
        return true;
    }

    public static synchronized boolean configureClickPacing() {
        int seconds = com.lulu.config.Config.Safety.CLICK_GAP_SECONDS;
        if (seconds == clickPacingConfiguredSeconds && System.currentTimeMillis() - clickPacingConfiguredAt < 30000L) return true;
        String result = sendGet("/automation/click_pacing/" + seconds, 5000);
        if (result == null || !result.startsWith("SUCCESS|")) return false;
        clickPacingConfiguredSeconds = seconds;
        clickPacingConfiguredAt = System.currentTimeMillis();
        return true;
    }

    public static long getActionSequence() { return ACTION_SEQUENCE.get(); }
    public static int getQueuedActionCount() { return QUEUED_ACTIONS.get(); }
    public static String getActiveAction() { return activeAction; }
    public static long getNextActionAtMillis() { return nextActionAtMillis; }

    private static String sendAction(String endpoint) {
        if (!initializationReady) throw new IllegalStateException(initializationMessage);
        if (System.currentTimeMillis() - pluginCheckedAt > 5000L) getGameStatus();
        if (!compatiblePlugin) throw new IllegalStateException(compatibilityMessage);
        boolean serverAction = endpoint.startsWith("/chest/") || endpoint.startsWith("/synth/execute/")
                || endpoint.startsWith("/synth/purge_excluded/")
                || endpoint.equals("/store/sort") || endpoint.equals("/store/deposit");
        if (!configureOperationPacing() || !configureClickPacing()) throw new IllegalStateException("操作保护接口未连接，请加载匹配的新插件。");
        boolean waiting = true;
        boolean attempted = false;
        QUEUED_ACTIONS.incrementAndGet();
        try {
            synchronized (ACTION_LOCK) {
                QUEUED_ACTIONS.decrementAndGet();
                waiting = false;
                activeAction = actionLabel(endpoint);
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                long minimumGapNanos = com.lulu.config.Config.Safety.CLICK_GAP_SECONDS * 1000000000L;
                long wait = minimumGapNanos - (System.nanoTime() - lastUiActionNanos);
                if (wait > 0) {
                    nextActionAtMillis = System.currentTimeMillis() + (wait + 999999L) / 1000000L;
                    Thread.sleep(Math.max(1L, wait / 1000000L));
                }
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                nextActionAtMillis = 0L;
                if (serverAction && !waitForInventoryReady(90000L))
                    throw new IllegalStateException("上一次操作尚未结算或游戏返回错误，自动任务已暂停。");
                String result = sendGet(endpoint, endpoint.startsWith("/synth/autofill/")
                        || endpoint.equals("/synth/purge_inscription")
                        || endpoint.startsWith("/synth/purge_excluded/") ? 60000 : READ_TIMEOUT_MS);
                attempted = result != null;
                if (result != null && (result.startsWith("SUCCESS") || CubeFillStatus.isFillResponse(result)))
                    ACTION_SEQUENCE.incrementAndGet();
                if (serverAction && !endpoint.startsWith("/synth/execute/")
                        && (result == null || result.startsWith("PENDING|") || result.startsWith("THROTTLED|")
                            || result.startsWith("FAILED|") || "ACTION_PENDING".equals(result)))
                    throw new IllegalStateException("操作结果待确认，自动任务已暂停：" + result);
                return result;
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new CancellationException("自动操作已停止");
        } finally {
            if (waiting) QUEUED_ACTIONS.decrementAndGet();
            if (attempted) {
                lastUiActionNanos = System.nanoTime();
                nextActionAtMillis = System.currentTimeMillis()
                        + com.lulu.config.Config.Safety.CLICK_GAP_SECONDS * 1000L;
            }
            activeAction = "";
        }
    }

    private static String actionLabel(String endpoint) {
        if (endpoint.startsWith("/chest/white")) return "普通宝箱";
        if (endpoint.startsWith("/chest/blue")) return "蓝色宝箱";
        if (endpoint.startsWith("/synth/execute/")) return "腐蚀/合成执行";
        if (endpoint.startsWith("/synth/")) return "魔方操作";
        if (endpoint.startsWith("/store/")) return "仓库操作";
        if (endpoint.startsWith("/plague/")) return "地图切换";
        return "游戏操作";
    }

    private static String sendGet(String endpoint) {
        return DllApiClient.sendGet(endpoint, READ_TIMEOUT_MS);
    }

    private static String sendGet(String endpoint, int readTimeoutMs) {
        HttpURLConnection conn = null;
        try {
            refreshEndpoint();
            if (discoveredEndpoint == null) return null;
            if (!endpoint.equals("/game/status") && (!initializationReady || !compatiblePlugin)) return null;
            URL url = new URL(baseUrl + endpoint);
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
                System.err.println("[API Exception] HTTP \u901a\u4fe1\u5931\u8d25\uff08\u6700\u8fd1 10 \u79d2\u5408\u5e76\uff09: " + e.getMessage() + "；本机接口=" + baseUrl);
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
        return corrosionAutoFillResult(useStorage, excludeMaterials, false);
    }

    public static String corrosionAutoFillResult(boolean useStorage, boolean excludeInscriptionScrolls,
            boolean excludeOfferingCoins) {
        return sendAction("/synth/autofill/" + useStorage + "/" + excludeInscriptionScrolls
                + "/" + excludeOfferingCoins + "/corrosion");
    }

    public static String purgeExcludedCorrosionMaterials() {
        return sendAction("/synth/purge_inscription");
    }

    public static String purgeExcludedCorrosionMaterials(boolean excludeInscriptionScrolls,
            boolean excludeOfferingCoins) {
        return sendAction("/synth/purge_excluded/" + excludeInscriptionScrolls + "/" + excludeOfferingCoins);
    }

    public static String executeSynthAction(int maxGrade) {
        return DllApiClient.executeSynthAction(maxGrade, false);
    }

    public static String executeSynthAction(int maxGrade, boolean excludeInscriptionScrolls) {
        return executeSynthAction(maxGrade, excludeInscriptionScrolls, "synthesis");
    }

    public static String executeSynthAction(int maxGrade, boolean excludeInscriptionScrolls, String operation) {
        return executeSynthAction(maxGrade, excludeInscriptionScrolls, false, operation);
    }

    public static String executeSynthAction(int maxGrade, boolean excludeInscriptionScrolls,
            boolean excludeOfferingCoins, String operation) {
        return DllApiClient.sendAction("/synth/execute/" + maxGrade + "/" + excludeInscriptionScrolls
                + "/" + excludeOfferingCoins + "/" + operation);
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
        if (!initializationReady) return "INITIALIZING|" + initializationMessage;
        String response = DllApiClient.sendGet("/game/status");
        compatibilityMessage = PluginCompatibility.problem(response, EXPECTED_PLUGIN_HASH, com.lulu.config.Config.Global.APP_VERSION);
        BridgeEndpoint endpoint = discoveredEndpoint;
        if (compatibilityMessage.isEmpty() && (endpoint == null || !endpoint.matches(response)))
            compatibilityMessage = "本机接口的游戏进程或实例标识不一致，等待重新发现接口。";
        compatiblePlugin = compatibilityMessage.isEmpty();
        pluginUpdateRequired = response != null && response.startsWith("SUCCESS|") && !compatiblePlugin;
        pluginCheckedAt = System.currentTimeMillis();
        return pluginUpdateRequired ? "INCOMPATIBLE|" + compatibilityMessage : response;
    }

    public static String[] getAvailableChestKinds() {
        String response = sendGet("/chest/catalog", 5000);
        if (response == null || !response.startsWith("SUCCESS|"))
            throw new IllegalStateException("读取宝箱列表失败：" + response);
        String kinds = PluginCompatibility.field(response, "kinds");
        return kinds.isEmpty() ? new String[0] : kinds.split(",");
    }

    public static String openChestKind(String kind) { return sendAction("/chest/open/" + kind); }

    public static String routeToPlaguelands(int level) {
        return DllApiClient.sendAction("/plague/route/" + Math.max(1, Math.min(20, level)));
    }
}

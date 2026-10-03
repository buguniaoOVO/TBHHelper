package com.lulu.logic.monitor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public final class ActivityStore {
    public static final String[] CHEST_KEYS = new String[]{
            "normal", "rare", "boss"
    };
    public static final String[] CHEST_LABELS = new String[]{
            "普通宝箱", "稀有宝箱", "BOSS宝箱"
    };

    public static final class Entry {
        public final String type;
        public final long timeMillis;
        public final String[] fields;

        private Entry(String type, long timeMillis, String[] fields) {
            this.type = type;
            this.timeMillis = timeMillis;
            this.fields = fields;
        }

        public String field(int index) {
            if (index < 0 || index >= this.fields.length || this.fields[index] == null) {
                return "";
            }
            return this.fields[index];
        }
    }

    private static final Path FILE = Paths.get("activity.tsv");
    private static final List<Entry> ENTRIES = new ArrayList<Entry>();
    private static int statsRetentionHours = 24;
    private static int logRetentionHours = 24;
    private static int otherRetentionHours = 24;
    private static boolean otherRecordsPermanent = true;
    private static boolean loaded;

    private ActivityStore() {
    }

    private static synchronized void ensureLoaded() {
        if (loaded) {
            return;
        }
        loaded = true;
        if (Files.exists(FILE)) {
            try {
                for (String line : Files.readAllLines(FILE, StandardCharsets.UTF_8)) {
                    Entry entry = decodeLine(line);
                    if (entry != null) {
                        ENTRIES.add(entry);
                    }
                }
            } catch (IOException ex) {
                System.err.println("[统计] 读取活动记录失败: " + ex.getMessage());
            }
        }
        if (pruneLocked(System.currentTimeMillis())) {
            rewriteLocked();
        }
        if (linkDropDurationsLocked()) {
            rewriteLocked();
        }
    }

    public static synchronized void setRetentionHours(int statsHours, int logsHours) {
        setRetentionHours(statsHours, logsHours, otherRetentionHours, otherRecordsPermanent);
    }

    public static synchronized void setRetentionHours(int statsHours, int logsHours, int otherHours,
            boolean keepOtherRecordsForever) {
        statsRetentionHours = clampHours(statsHours);
        logRetentionHours = clampHours(logsHours);
        otherRetentionHours = Math.max(1, otherHours);
        otherRecordsPermanent = keepOtherRecordsForever;
        ensureLoaded();
        if (pruneLocked(System.currentTimeMillis())) {
            rewriteLocked();
        }
    }

    public static int clampHours(int hours) {
        return Math.max(1, Math.min(720, hours));
    }

    public static synchronized void prune() {
        ensureLoaded();
        if (pruneLocked(System.currentTimeMillis())) {
            rewriteLocked();
        }
    }

    private static boolean pruneLocked(long now) {
        long statsCutoff = now - statsRetentionHours * 60L * 60L * 1000L;
        long logCutoff = now - logRetentionHours * 60L * 60L * 1000L;
        long otherCutoff = otherRecordsPermanent ? Long.MIN_VALUE
                : now - (long)otherRetentionHours * 60L * 60L * 1000L;
        boolean changed = false;
        for (int i = ENTRIES.size() - 1; i >= 0; i--) {
            Entry entry = ENTRIES.get(i);
            if ("marker".equals(entry.type)) {
                continue;
            }
            long cutoff = "log".equals(entry.type) ? logCutoff
                    : "drop".equals(entry.type) ? statsCutoff : otherCutoff;
            if (cutoff != Long.MIN_VALUE && entry.timeMillis < cutoff) {
                ENTRIES.remove(i);
                changed = true;
            }
        }
        return changed;
    }

    public static synchronized void migrateLegacyChestCounts(int normalCount, int rareCount) {
        ensureLoaded();
        if (hasMarker("legacy-chest-v1")) {
            return;
        }
        long now = System.currentTimeMillis();
        if (normalCount > 0) {
            addLocked(new Entry("chest", now, new String[]{"normal", "旧版累计", String.valueOf(normalCount)}));
        }
        if (rareCount > 0) {
            addLocked(new Entry("chest", now, new String[]{"rare", "旧版累计", String.valueOf(rareCount)}));
        }
        addLocked(new Entry("marker", now, new String[]{"legacy-chest-v1"}));
        rewriteLocked();
    }

    private static boolean hasMarker(String marker) {
        for (Entry entry : ENTRIES) {
            if ("marker".equals(entry.type) && marker.equals(entry.field(0))) {
                return true;
            }
        }
        return false;
    }

    public static synchronized void recordChest(String category, String map, int count) {
        recordChest(System.currentTimeMillis(), category, map, count, "");
    }

    public static synchronized void recordChest(long timeMillis, String category, String map, int count,
            String eventKey) {
        if (count <= 0 || !isChestKey(category)) {
            return;
        }
        ensureLoaded();
        long now = timeMillis > 0 ? timeMillis : System.currentTimeMillis();
        String resolvedMap = resolveRecentMapLocked(now, map);
        String key = safe(eventKey);
        for (Entry existing : ENTRIES) {
            if ("chest".equals(existing.type) && existing.timeMillis == now
                    && category.equals(existing.field(0)) && String.valueOf(count).equals(existing.field(2))
                    && !key.isEmpty() && key.equals(existing.field(3))) {
                boolean changed = false;
                if (!isRecognizedMap(existing.field(1)) && isRecognizedMap(resolvedMap)) {
                    existing.fields[1] = resolvedMap;
                    changed = true;
                }
                if (changed) rewriteLocked();
                return;
            }
        }
        append(new Entry("chest", now, new String[]{category, resolvedMap, String.valueOf(count), key}));
        attachToRecentBattle(now, resolvedMap, CHEST_LABELS[chestIndex(category)] + " ×" + count);
        if (linkMissingDropMapsLocked(now, resolvedMap)) {
            rewriteLocked();
        }
    }

    public static synchronized void recordDrop(long timeMillis, String map, String chest, String itemName,
            String quality, int qualityIndex, String itemType, int count) {
        recordDrop(timeMillis, map, chest, itemName, quality, qualityIndex, itemType, count, "");
    }

    public static synchronized void recordDrop(long timeMillis, String map, String chest, String itemName,
            String quality, int qualityIndex, String itemType, int count, String eventKey) {
        if (count <= 0) {
            return;
        }
        ensureLoaded();
        long time = timeMillis > 0 ? timeMillis : System.currentTimeMillis();
        String resolvedMap = resolveRecentMapLocked(time, map);
        String[] fields = new String[]{resolvedMap, safe(chest), safe(itemName), safe(quality),
                String.valueOf(qualityIndex), safe(itemType), String.valueOf(count), "", safe(eventKey)};
        Entry drop = new Entry("drop", time, fields);
        linkDropDurationLocked(drop);
        Entry duplicate = findDuplicateDropLocked(drop);
        if (duplicate != null) {
            boolean changed = false;
            if (!isRecognizedMap(duplicate.field(0)) && isRecognizedMap(drop.field(0))) {
                duplicate.fields[0] = drop.field(0);
                changed = true;
            }
            if (duplicate.field(7).isEmpty() && !drop.field(7).isEmpty()) {
                duplicate.fields[7] = drop.field(7);
                changed = true;
            }
            if (qualityIndex >= 6 && findDuplicateJackpotLocked(drop) == null) {
                append(new Entry("jackpot", time, duplicate.fields.clone()));
            }
            if (changed) rewriteLocked();
            return;
        }
        append(drop);
        if (qualityIndex >= 6) {
            append(new Entry("jackpot", time, fields.clone()));
        }
        attachToRecentBattle(time, drop.field(0), "开箱 " + safe(itemName) + " ×" + count);
        if (linkMissingDropMapsLocked(time, drop.field(0))) {
            rewriteLocked();
        }
    }

    public static synchronized void recordBattle(long timeMillis, String map, long durationSeconds,
            String result, String drops) {
        long eventTime = timeMillis > 0 ? timeMillis : System.currentTimeMillis();
        String finalMap = safe(map);
        String finalDrops = safe(drops);
        if (finalDrops.isEmpty() && isRecognizedMap(finalMap)) {
            finalDrops = collectDropsNearBattle(eventTime, finalMap);
        }
        boolean duplicate = false;
        for (Entry existing : ENTRIES) {
            if ("battle".equals(existing.type) && existing.timeMillis == eventTime
                    && finalMap.equals(existing.field(0))
                    && String.valueOf(Math.max(0L, durationSeconds)).equals(existing.field(1))
                    && safe(result).equals(existing.field(2))) {
                duplicate = true;
                break;
            }
        }
        if (!duplicate) {
            append(new Entry("battle", eventTime,
                    new String[]{finalMap, String.valueOf(Math.max(0L, durationSeconds)), safe(result), finalDrops}));
        }
        if (linkDropDurationsLocked()) {
            rewriteLocked();
        }
    }

    public static synchronized void appendLog(String message) {
        ensureLoaded();
        if (message == null || message.trim().isEmpty()) {
            return;
        }
        String[] lines = message.split("\\r?\\n");
        long now = System.currentTimeMillis();
        for (String line : lines) {
            if (!line.trim().isEmpty()) {
                addLocked(new Entry("log", now, new String[]{line}));
            }
        }
        if (pruneLocked(now)) {
            rewriteLocked();
        } else {
            appendLastLines(lines, now);
        }
    }

    private static void appendLastLines(String[] lines, long time) {
        try {
            StringBuilder out = new StringBuilder();
            for (String line : lines) {
                if (!line.trim().isEmpty()) {
                    out.append(encode(new Entry("log", time, new String[]{line}))).append('\n');
                }
            }
            if (out.length() > 0) {
                Files.write(FILE, out.toString().getBytes(StandardCharsets.UTF_8),
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            }
        } catch (IOException ex) {
            System.err.println("[日志] 写入运行日志失败: " + ex.getMessage());
        }
    }

    public static synchronized void ingestPluginEvents(String response) {
        ingestPluginEvents(response, "", false);
    }

    public static synchronized void ingestPluginEvents(String response, String fallbackMap, boolean inCombat) {
        if (response == null || response.isEmpty()) {
            return;
        }
        String safeFallbackMap = isRecognizedMap(fallbackMap) ? fallbackMap.trim() : "";
        for (String line : response.split("\\r?\\n")) {
            String[] parts = line.split("\\t", -1);
            if (parts.length < 3 || !"E".equals(parts[0])) {
                continue;
            }
            try {
                String type = parts[1];
                long time = Long.parseLong(parts[2]);
                String[] fields = new String[parts.length - 3];
                for (int i = 3; i < parts.length; i++) {
                    fields[i - 3] = decodeField(parts[i]);
                }
                String eventId = fields.length > 0 && fields[fields.length - 1].startsWith("evt:")
                        ? fields[fields.length - 1] : "";
                if ("chest".equals(type) && fields.length >= 3) {
                    if (!isRecognizedMap(fields[1]) && !safeFallbackMap.isEmpty()) {
                        fields[1] = safeFallbackMap;
                    }
                    String eventKey = !eventId.isEmpty() ? eventId : fields.length >= 5 ? fields[3] + "|" + fields[4]
                            : fields.length >= 4 ? fields[3] : "";
                    recordChest(time, fields[0], fields[1], Integer.parseInt(fields[2]), eventKey);
                } else if ("drop".equals(type) && fields.length >= 7) {
                    if (!isRecognizedMap(fields[0]) && !safeFallbackMap.isEmpty()) {
                        fields[0] = safeFallbackMap;
                    }
                    recordDrop(time, fields[0], fields[1], fields[2], fields[3], Integer.parseInt(fields[4]),
                            fields[5], Integer.parseInt(fields[6]), eventId);
                } else if ("battle".equals(type) && fields.length >= 4) {
                    boolean missingMap = !isRecognizedMap(fields[0]);
                    if (missingMap && !safeFallbackMap.isEmpty()) {
                        fields[0] = safeFallbackMap;
                    }
                    long durationSeconds = Long.parseLong(fields[1]);
                    if (missingMap && inCombat && durationSeconds == 0L && "失败".equals(fields[2])) {
                        continue;
                    }
                    recordBattle(time, fields[0], durationSeconds, fields[2], fields[3]);
                }
            } catch (RuntimeException ex) {
                System.err.println("[统计] 忽略格式错误的游戏事件: " + ex.getMessage());
            }
        }
    }

    private static boolean isRecognizedMap(String map) {
        return map != null && !map.trim().isEmpty() && !map.contains("{") && !map.contains("}")
                && !"地图未识别".equals(map.trim());
    }

    private static String resolveRecentMapLocked(long timeMillis, String preferredMap) {
        if (isRecognizedMap(preferredMap)) {
            return preferredMap.trim();
        }
        String nearestMap = "";
        long nearestDelta = 300_001L;
        for (Entry entry : ENTRIES) {
            if (!("battle".equals(entry.type) || "chest".equals(entry.type) || "drop".equals(entry.type))) {
                continue;
            }
            String candidate = "battle".equals(entry.type) ? entry.field(0)
                    : "chest".equals(entry.type) ? entry.field(1) : entry.field(0);
            if (!isRecognizedMap(candidate)) {
                continue;
            }
            long delta = Math.abs(timeMillis - entry.timeMillis);
            if (delta <= 300_000L && delta < nearestDelta) {
                nearestMap = candidate;
                nearestDelta = delta;
            }
        }
        return nearestMap.isEmpty() ? safe(preferredMap) : nearestMap;
    }

    private static boolean linkMissingDropMapsLocked(long timeMillis, String map) {
        if (!isRecognizedMap(map)) {
            return false;
        }
        boolean changed = false;
        for (Entry entry : ENTRIES) {
            if (!("drop".equals(entry.type) || "jackpot".equals(entry.type))
                    || entry.fields.length < 8 || isRecognizedMap(entry.field(0))) {
                continue;
            }
            if (Math.abs(timeMillis - entry.timeMillis) <= 300_000L) {
                entry.fields[0] = map;
                changed = true;
            }
        }
        return changed;
    }

    private static Entry findDuplicateDropLocked(Entry candidate) {
        for (Entry entry : ENTRIES) {
            if (!candidate.field(8).isEmpty()) {
                if ("drop".equals(entry.type) && candidate.field(8).equals(entry.field(8))) return entry;
                continue;
            }
            if ("drop".equals(entry.type) && entry.timeMillis == candidate.timeMillis
                    && entry.field(1).equals(candidate.field(1)) && entry.field(2).equals(candidate.field(2))
                    && entry.field(3).equals(candidate.field(3)) && entry.field(4).equals(candidate.field(4))
                    && entry.field(5).equals(candidate.field(5)) && entry.field(6).equals(candidate.field(6))) {
                return entry;
            }
        }
        return null;
    }

    private static Entry findDuplicateJackpotLocked(Entry candidate) {
        for (Entry entry : ENTRIES) {
            if (!candidate.field(8).isEmpty()) {
                if ("jackpot".equals(entry.type) && candidate.field(8).equals(entry.field(8))) return entry;
                continue;
            }
            if ("jackpot".equals(entry.type) && entry.timeMillis == candidate.timeMillis
                    && entry.field(1).equals(candidate.field(1)) && entry.field(2).equals(candidate.field(2))
                    && entry.field(3).equals(candidate.field(3)) && entry.field(4).equals(candidate.field(4))
                    && entry.field(5).equals(candidate.field(5)) && entry.field(6).equals(candidate.field(6))) {
                return entry;
            }
        }
        return null;
    }

    public static synchronized int[] getChestCounts() {
        ensureLoaded();
        int[] counts = new int[CHEST_KEYS.length];
        for (Entry entry : ENTRIES) {
            if (!"chest".equals(entry.type)) {
                continue;
            }
            int index = chestIndex(entry.field(0));
            if (index >= 0) {
                try {
                    counts[index] += Integer.parseInt(entry.field(2));
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return counts;
    }

    public static synchronized long[] getDropQualityCounts() {
        ensureLoaded();
        long[] counts = new long[11];
        for (Entry entry : ENTRIES) {
            if (!"drop".equals(entry.type)) {
                continue;
            }
            int qualityIndex;
            long quantity;
            try {
                qualityIndex = Integer.parseInt(entry.field(4));
                quantity = Long.parseLong(entry.field(6));
            } catch (NumberFormatException ex) {
                qualityIndex = 10;
                quantity = 1L;
            }
            if (quantity <= 0L || isExcludedQualitySummaryItem(entry.field(2), qualityIndex)) {
                continue;
            }
            int bucket = qualityIndex >= 0 && qualityIndex < 10 ? qualityIndex : 10;
            counts[bucket] += quantity;
        }
        return counts;
    }

    private static boolean isExcludedQualitySummaryItem(String itemName, int qualityIndex) {
        String name = itemName == null ? "" : itemName.trim().toLowerCase(java.util.Locale.ROOT);
        if (name.contains("灵魂石") || name.contains("soul stone") || name.contains("soulstone")) {
            return qualityIndex == 7;
        }
        boolean chineseBoss = name.contains("首领");
        boolean englishBoss = name.contains("boss");
        boolean ticket = name.contains("门票") || name.contains("入场券") || name.contains("票券")
                || name.contains("通行证") || name.contains("ticket") || name.contains("entry pass")
                || name.contains("entry ticket");
        return (chineseBoss || englishBoss) && ticket;
    }

    public static synchronized List<Entry> getRecent(String type, int limit) {
        ensureLoaded();
        List<Entry> result = new ArrayList<Entry>();
        for (Entry entry : ENTRIES) {
            if (type.equals(entry.type) && !("battle".equals(type) && isEmptyPlaceholderBattle(entry))) {
                result.add(entry);
            }
        }
        Collections.sort(result, new Comparator<Entry>() {
            @Override
            public int compare(Entry a, Entry b) {
                return Long.compare(b.timeMillis, a.timeMillis);
            }
        });
        if (result.size() > Math.max(0, limit)) {
            return new ArrayList<Entry>(result.subList(0, Math.max(0, limit)));
        }
        return result;
    }

    public static synchronized void clear(String type) {
        ensureLoaded();
        for (int i = ENTRIES.size() - 1; i >= 0; i--) {
            if (type.equals(ENTRIES.get(i).type)) {
                ENTRIES.remove(i);
            }
        }
        rewriteLocked();
    }

    private static void attachToRecentBattle(long time, String map, String detail) {
        if (map == null || map.isEmpty() || map.contains("{") || detail == null || detail.isEmpty()) {
            return;
        }
        for (int i = ENTRIES.size() - 1; i >= 0; i--) {
            Entry entry = ENTRIES.get(i);
            if (!"battle".equals(entry.type) || !map.equals(entry.field(0))) {
                continue;
            }
            if (!"成功".equals(entry.field(2))) {
                return;
            }
            long elapsed = time - entry.timeMillis;
            if (elapsed < 0L || elapsed > 300_000L) {
                return;
            }
            String existing = entry.field(3);
            if (existing.length() < 500) {
                entry.fields[3] = existing.isEmpty() ? detail : existing + "、" + detail;
                rewriteLocked();
            }
            return;
        }
    }
    private static String collectDropsNearBattle(long battleTime, String map) {
        StringBuilder drops = new StringBuilder();
        for (Entry entry : ENTRIES) {
            long delta = entry.timeMillis - battleTime;
            if (Math.abs(delta) > 300_000L) {
                continue;
            }
            String detail = "";
            if ("drop".equals(entry.type)) {
                if (map.equals(entry.field(0)) || !isRecognizedMap(entry.field(0))) {
                    detail = entry.field(1) + " " + entry.field(2) + " ×" + entry.field(6);
                }
            } else if ("chest".equals(entry.type)) {
                int index = chestIndex(entry.field(0));
                if (index >= 0 && (map.equals(entry.field(1)) || !isRecognizedMap(entry.field(1)))) {
                    detail = CHEST_LABELS[index] + " ×" + entry.field(2);
                }
            }
            if (!detail.isEmpty()) {
                if (drops.length() > 0) {
                    drops.append("、");
                }
                drops.append(detail);
                if (drops.length() >= 500) {
                    return drops.substring(0, 500);
                }
            }
        }
        return drops.toString();
    }

    private static boolean isEmptyPlaceholderBattle(Entry entry) {
        return "失败".equals(entry.field(2))
                && (entry.field(1).isEmpty() || "0".equals(entry.field(1)))
                && !isRecognizedMap(entry.field(0))
                && entry.field(3).isEmpty();
    }

    private static boolean linkDropDurationsLocked() {
        ensureLoaded();
        boolean changed = false;
        for (Entry entry : ENTRIES) {
            if ("drop".equals(entry.type) || "jackpot".equals(entry.type)) {
                changed |= linkDropDurationLocked(entry);
            }
        }
        return changed;
    }

    private static boolean linkDropDurationLocked(Entry drop) {
        if (drop.fields.length < 8 || !drop.field(7).isEmpty()) {
            return false;
        }
        boolean missingMap = !isRecognizedMap(drop.field(0));
        Entry nearest = null;
        long nearestDelta = Long.MAX_VALUE;
        for (Entry battle : ENTRIES) {
            if (!"battle".equals(battle.type) || !"成功".equals(battle.field(2))
                    || !isRecognizedMap(battle.field(0))
                    || (!missingMap && !drop.field(0).equals(battle.field(0)))) {
                continue;
            }
            long seconds;
            try {
                seconds = Long.parseLong(battle.field(1));
            } catch (NumberFormatException ex) {
                continue;
            }
            long delta = Math.abs(drop.timeMillis - battle.timeMillis);
            if (seconds <= 0L || delta > 300_000L || delta >= nearestDelta) {
                continue;
            }
            nearest = battle;
            nearestDelta = delta;
        }
        if (nearest == null) {
            return false;
        }
        if (missingMap) {
            drop.fields[0] = nearest.field(0);
        }
        drop.fields[7] = nearest.field(1);
        return true;
    }

    private static void append(Entry entry) {
        ensureLoaded();
        addLocked(entry);
        if (pruneLocked(System.currentTimeMillis())) {
            rewriteLocked();
        } else {
            try {
                Files.write(FILE, (encode(entry) + "\n").getBytes(StandardCharsets.UTF_8),
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } catch (IOException ex) {
                System.err.println("[统计] 保存活动记录失败: " + ex.getMessage());
            }
        }
    }

    private static void addLocked(Entry entry) {
        ENTRIES.add(entry);
    }

    private static void rewriteLocked() {
        try {
            Path temp = FILE.resolveSibling(FILE.getFileName().toString() + ".tmp");
            StringBuilder contents = new StringBuilder();
            for (Entry entry : ENTRIES) {
                contents.append(encode(entry)).append('\n');
            }
            Files.write(temp, contents.toString().getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            try {
                Files.move(temp, FILE, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                        java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException atomicMoveUnavailable) {
                Files.move(temp, FILE, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException ex) {
            System.err.println("[统计] 整理活动记录失败: " + ex.getMessage());
        }
    }

    private static String encode(Entry entry) {
        StringBuilder line = new StringBuilder("v1\t").append(entry.type).append('\t').append(entry.timeMillis);
        for (String field : entry.fields) {
            line.append('\t').append(Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(safe(field).getBytes(StandardCharsets.UTF_8)));
        }
        return line.toString();
    }

    private static Entry decodeLine(String line) {
        String[] parts = line.split("\\t", -1);
        if (parts.length < 3 || !"v1".equals(parts[0])) {
            return null;
        }
        try {
            String[] fields = new String[parts.length - 3];
            for (int i = 3; i < parts.length; i++) {
                fields[i - 3] = decodeField(parts[i]);
            }
            if (("drop".equals(parts[1]) || "jackpot".equals(parts[1])) && fields.length < 8) {
                fields = Arrays.copyOf(fields, 8);
            }
            return new Entry(parts[1], Long.parseLong(parts[2]), fields);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static String decodeField(String field) {
        return new String(Base64.getUrlDecoder().decode(field), StandardCharsets.UTF_8);
    }

    private static int chestIndex(String key) {
        for (int i = 0; i < CHEST_KEYS.length; i++) {
            if (CHEST_KEYS[i].equals(key)) {
                return i;
            }
        }
        return -1;
    }

    private static boolean isChestKey(String key) {
        return chestIndex(key) >= 0;
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}

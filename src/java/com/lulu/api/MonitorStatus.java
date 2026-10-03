package com.lulu.api;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class MonitorStatus {
    public final boolean pollutionKnown;
    public final long pollution;
    public final boolean warehouseKnown;
    public final int warehouseUsed;
    public final int warehouseCapacity;
    public final double warehousePercent;
    public final int pagesScanned;
    public final int pageTabs;
    public final int warehousePages;
    public final String pollutionSource;
    public final String pollutionUpdatedAt;

    private MonitorStatus(boolean pollutionKnown, long pollution, boolean warehouseKnown,
            int warehouseUsed, int warehouseCapacity, double warehousePercent, int pagesScanned,
            int pageTabs, int warehousePages,
            String pollutionSource, String pollutionUpdatedAt) {
        this.pollutionKnown = pollutionKnown;
        this.pollution = pollution;
        this.warehouseKnown = warehouseKnown;
        this.warehouseUsed = warehouseUsed;
        this.warehouseCapacity = warehouseCapacity;
        this.warehousePercent = warehousePercent;
        this.pagesScanned = pagesScanned;
        this.pageTabs = pageTabs;
        this.warehousePages = warehousePages;
        this.pollutionSource = pollutionSource;
        this.pollutionUpdatedAt = pollutionUpdatedAt;
    }

    public static MonitorStatus unknown() {
        return new MonitorStatus(false, -1L, false, 0, 0, -1.0, 0, 0, 0, "unknown", "");
    }

    public static MonitorStatus parse(String response) {
        if (response == null || response.isEmpty()) {
            return unknown();
        }
        Map<String, String> values = new HashMap<>();
        String[] parts = response.split("\\|");
        for (int i = 1; i < parts.length; i++) {
            int equals = parts[i].indexOf('=');
            if (equals > 0) {
                values.put(parts[i].substring(0, equals), parts[i].substring(equals + 1));
            }
        }
        try {
            String pollutionText = values.get("pollution");
            long pollution = pollutionText == null || "?".equals(pollutionText) ? -1L : Long.parseLong(pollutionText);
            int used = parseInt(values.get("warehouse_used"), 0);
            int capacity = parseInt(values.get("warehouse_capacity"), 0);
            int pages = parseInt(values.get("pages_scanned"), 0);
            int pageTabs = parseInt(values.get("page_tabs"), pages);
            int warehousePages = parseInt(values.get("warehouse_pages"), pages);
            double percent = parseDouble(values.get("warehouse_percent"), -1.0);
            return new MonitorStatus(pollution >= 0L, pollution, capacity > 0 && pageTabs > 0 && pages == pageTabs,
                    used, capacity, percent, pages, pageTabs, warehousePages,
                    values.getOrDefault("pollution_source", "unknown"),
                    values.getOrDefault("pollution_at", ""));
        } catch (RuntimeException ex) {
            return unknown();
        }
    }

    private static int parseInt(String value, int fallback) {
        return value == null || value.isEmpty() ? fallback : Integer.parseInt(value);
    }

    private static double parseDouble(String value, double fallback) {
        return value == null || value.isEmpty() || "?".equals(value)
                ? fallback
                : Double.parseDouble(value);
    }

    public boolean isReady() {
        return this.pollutionKnown && this.warehouseKnown;
    }

    public boolean targetsMet(int pollutionThreshold, double warehouseThresholdPercent) {
        return this.isReady() && this.pollution > pollutionThreshold && this.warehousePercent < warehouseThresholdPercent;
    }

    public boolean corrosionNeeded(int pollutionThreshold, double warehouseThresholdPercent) {
        return this.isReady() && (this.pollution <= pollutionThreshold || this.warehousePercent >= warehouseThresholdPercent);
    }

    public boolean shouldUseWarehouse(double warehouseThresholdPercent) {
        return this.warehouseKnown && this.warehousePercent >= warehouseThresholdPercent;
    }

    public String displayText(int pollutionThreshold, double warehouseThresholdPercent) {
        if (!this.isReady()) {
            return "监控等待数据（污染度 " + (this.pollutionKnown ? this.pollution : "未知")
                    + "；仓库格数读取中）";
        }
        return String.format(Locale.ROOT, "污染度 %d/%d · 仓库 %d/%d格（%.1f%%/%s%%）",
                this.pollution, pollutionThreshold, this.warehouseUsed, this.warehouseCapacity, this.warehousePercent,
                String.format(Locale.ROOT, "%.0f", warehouseThresholdPercent));
    }
}

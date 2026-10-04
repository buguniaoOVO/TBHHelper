package com.lulu.logic.monitor;

public final class PeriodicSchedule {
    private long nextAt = Long.MAX_VALUE;
    private long interval;
    private long anchor;

    public void start(long now, long intervalMillis) {
        interval = Math.max(1L, intervalMillis);
        anchor = now;
        nextAt = now + interval;
    }

    public long nextAt(long intervalMillis) {
        long configured = Math.max(1L, intervalMillis);
        if (nextAt != Long.MAX_VALUE && configured != interval) {
            interval = configured;
            nextAt = anchor + interval;
        }
        return nextAt;
    }

    public boolean due(long now, long intervalMillis) { return now >= nextAt(intervalMillis); }

    public void checked(long now, long intervalMillis) {
        nextAt(intervalMillis);
        if (nextAt == Long.MAX_VALUE) { start(now, intervalMillis); return; }
        if (now >= nextAt) {
            long periods = (now - nextAt) / interval + 1L;
            nextAt += periods * interval;
            anchor = nextAt - interval;
        }
    }
}

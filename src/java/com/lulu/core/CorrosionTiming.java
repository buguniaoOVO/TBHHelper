package com.lulu.core;

public final class CorrosionTiming {
    private CorrosionTiming() { }
    public static int clamp(int seconds) { return Math.max(10, Math.min(120, seconds)); }
}

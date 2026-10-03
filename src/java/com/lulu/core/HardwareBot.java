/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.sun.jna.Library
 *  com.sun.jna.Native
 */
package com.lulu.core;

import com.sun.jna.Library;
import com.sun.jna.Native;

public class HardwareBot {
    private static final int MOUSEEVENTF_LEFTDOWN = 2;
    private static final int MOUSEEVENTF_LEFTUP = 4;

    public static boolean isKeyPressed(int vKey) {
        try {
            short state = User32.INSTANCE.GetAsyncKeyState(vKey);
            return (state & 0x8000) != 0;
        }
        catch (Exception e) {
            return false;
        }
    }

    public static void moveMouse(int x, int y) {
        User32.INSTANCE.SetCursorPos(x, y);
    }

    public static void clickLeftMouse() {
        User32.INSTANCE.mouse_event(2, 0, 0, 0, 0);
        try {
            Thread.sleep((long)(20.0 + Math.random() * 20.0));
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        User32.INSTANCE.mouse_event(4, 0, 0, 0, 0);
    }

    public static void clickAt(int x, int y) {
        HardwareBot.moveMouse(x, y);
        try {
            Thread.sleep(50L);
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        HardwareBot.clickLeftMouse();
    }

    public static void pressKey(int vKey) {
        User32.INSTANCE.keybd_event((byte)vKey, 0, 0, 0);
        try {
            Thread.sleep(50L);
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        User32.INSTANCE.keybd_event((byte)vKey, 0, 2, 0);
    }

    public static void dragTo(int startX, int startY, int endX, int endY) {
        User32.INSTANCE.SetCursorPos(startX, startY);
        User32.INSTANCE.mouse_event(2, 0, 0, 0, 0);
        try {
            Thread.sleep(500L);
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        int steps = 20;
        for (int i = 1; i <= steps; ++i) {
            int midX = startX + (endX - startX) * i / steps;
            int midY = startY + (endY - startY) * i / steps;
            User32.INSTANCE.SetCursorPos(midX, midY);
            try {
                Thread.sleep(20L);
                continue;
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        try {
            Thread.sleep(300L);
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        User32.INSTANCE.mouse_event(4, 0, 0, 0, 0);
    }

    public static void mouseWheel(int delta) {
        User32.INSTANCE.mouse_event(2048, 0, 0, delta, 0);
    }

    public static interface User32
    extends Library {
        public static final User32 INSTANCE = (User32)Native.load((String)"user32", User32.class);

        public short GetAsyncKeyState(int var1);

        public void mouse_event(int var1, int var2, int var3, int var4, int var5);

        public boolean SetCursorPos(int var1, int var2);

        public void keybd_event(byte var1, int var2, int var3, int var4);
    }
}

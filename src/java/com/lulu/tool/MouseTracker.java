/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.sun.jna.platform.win32.User32
 *  com.sun.jna.platform.win32.WinDef$HWND
 *  com.sun.jna.platform.win32.WinDef$POINT
 *  com.sun.jna.platform.win32.WinDef$RECT
 */
package com.lulu.tool;

import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;

public class MouseTracker {
    public static void main(String[] args) throws InterruptedException {
        System.out.println(">>> \u8fde\u7eed\u63a2\u6d4b\u5668\u5df2\u542f\u52a8\uff01");
        System.out.println(">>> \u89c4\u5219\uff1a\u8fde\u7eed\u6309\u4e24\u6b21 F \u952e\u8bb0\u5f55\u4e00\u7ec4 ROI (\u5de6\u4e0a\u89d2 -> \u53f3\u4e0b\u89d2)");
        System.out.println(">>> \u6309 ESC \u952e\u9000\u51fa\u7a0b\u5e8f\u3002");
        int[] x = new int[2];
        int[] y = new int[2];
        int count = 0;
        boolean lastFState = false;
        while (true) {
            WinDef.HWND hwnd;
            boolean isPressed;
            short fState = User32.INSTANCE.GetAsyncKeyState(70);
            short escState = User32.INSTANCE.GetAsyncKeyState(27);
            if ((escState & 0x8000) != 0) break;
            boolean bl = isPressed = fState != 0;
            if (isPressed && !lastFState && (hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero")) != null) {
                WinDef.RECT rect = new WinDef.RECT();
                User32.INSTANCE.GetWindowRect(hwnd, rect);
                WinDef.POINT mouse = new WinDef.POINT();
                User32.INSTANCE.GetCursorPos(mouse);
                x[count] = mouse.x - rect.left;
                y[count] = mouse.y - rect.top;
                System.out.println("\u8bb0\u5f55\u70b9 " + (count + 1) + ": [" + x[count] + ", " + y[count] + "]");
                if (++count == 2) {
                    System.out.println("\n--- ROI \u7ed3\u679c ---");
                    System.out.printf("ROI_X = %d; ROI_Y = %d; ROI_W = %d; ROI_H = %d;\n", x[0], y[0], x[1] - x[0], y[1] - y[0]);
                    System.out.println("----------------\n\u8bf7\u7ee7\u7eed\u8bb0\u5f55\u4e0b\u4e00\u7ec4\uff0c\u6216\u6309 ESC \u9000\u51fa\u3002\n");
                    count = 0;
                }
            }
            lastFState = isPressed;
            Thread.sleep(50L);
        }
        System.out.println(">>> \u7a0b\u5e8f\u5df2\u9000\u51fa\u3002");
    }
}

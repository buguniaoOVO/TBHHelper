/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.sun.jna.platform.win32.User32
 *  com.sun.jna.platform.win32.WinDef$HWND
 */
package com.lulu.logic.tasks;

import com.lulu.config.Config;
import com.lulu.core.AutomationEngine;
import com.lulu.logic.BotTask;
import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;

public class InitTask
implements BotTask {
    @Override
    public void execute() throws InterruptedException {
        Thread.sleep(2000L);
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
        if (hwnd != null) {
            User32.INSTANCE.SetForegroundWindow(hwnd);
            System.out.println("\u6e38\u620f\u7a97\u53e3\u5df2\u6fc0\u6d3b");
            Thread.sleep(500L);
        }
        AutomationEngine.press(9);
        if (AutomationEngine.click("store.png")) {
            Thread.sleep(1500L);
            AutomationEngine.click(Config.Store.FIRST_PAGE);
            Thread.sleep(1500L);
            AutomationEngine.click(Config.Store.SORT_BUT);
            System.out.println("\u4ed3\u5e93\u521d\u59cb\u5316\u6210\u529f");
        } else {
            AutomationEngine.press(9);
            Thread.sleep(1500L);
            if (AutomationEngine.click("store.png")) {
                AutomationEngine.click(Config.Store.FIRST_PAGE);
                Thread.sleep(1500L);
                AutomationEngine.click(Config.Store.SORT_BUT);
                System.out.println("\u4ed3\u5e93\u521d\u59cb\u5316\u6210\u529f");
            } else {
                throw new RuntimeException("\u4ed3\u5e93\u521d\u59cb\u5316\u5931\u8d25\uff0c\u65e0\u6cd5\u7ee7\u7eed\u6267\u884c\u540e\u7eed\u4efb\u52a1\u3002");
            }
        }
    }
}

/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.sun.jna.platform.win32.User32
 *  com.sun.jna.platform.win32.WinDef$HWND
 *  com.sun.jna.platform.win32.WinDef$RECT
 */
package com.lulu.tool;

import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;
import java.awt.AWTException;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.image.BufferedImage;
import java.awt.image.RenderedImage;
import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import javax.imageio.ImageIO;

public class ROICaptureTool {
    public static void main(String[] args) {
        System.setProperty("sun.java2d.uiScale", "1.0");
        int roiX = 1124;
        int roiY = 565;
        int roiW = 1;
        int roiH = 51;
        String qualityName = "\u8d85\u51e1";
        System.out.println(">>> \u51c6\u5907\u622a\u53d6\u76ee\u6807\u533a\u57df...");
        ROICaptureTool.captureGameROI(roiX, roiY, roiW, roiH, qualityName);
    }

    public static void captureGameROI(int relX, int relY, int width, int height, String fileNamePrefix) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
        if (hwnd == null) {
            System.err.println("\u274c \u627e\u4e0d\u5230\u6e38\u620f\u7a97\u53e3\uff0c\u8bf7\u786e\u4fdd\u6e38\u620f\u6b63\u5728\u8fd0\u884c\uff01");
            return;
        }
        User32.INSTANCE.SetForegroundWindow(hwnd);
        try {
            Thread.sleep(500L);
        }
        catch (InterruptedException interruptedException) {
            // empty catch block
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        int absX = rect.left + relX;
        int absY = rect.top + relY;
        try {
            Robot robot = new Robot();
            Rectangle captureRect = new Rectangle(absX, absY, width, height);
            BufferedImage screenCapture = robot.createScreenCapture(captureRect);
            String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss").format(new Date());
            String finalFileName = fileNamePrefix + "_" + timestamp + ".png";
            File outputFile = new File(finalFileName);
            ImageIO.write((RenderedImage)screenCapture, "png", outputFile);
            System.out.println("\u2705 \u622a\u56fe\u6210\u529f\uff01\u6587\u4ef6\u5df2\u4fdd\u5b58\u81f3: " + outputFile.getAbsolutePath());
        }
        catch (AWTException e) {
            System.err.println("\u274c Robot \u521d\u59cb\u5316\u5931\u8d25\uff0c\u622a\u56fe\u73af\u5883\u53d7\u9650: " + e.getMessage());
        }
        catch (IOException e) {
            System.err.println("\u274c \u56fe\u7247\u6587\u4ef6\u4fdd\u5b58\u5931\u8d25: " + e.getMessage());
        }
    }
}

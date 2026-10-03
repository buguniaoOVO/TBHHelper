/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.sun.jna.platform.win32.User32
 *  com.sun.jna.platform.win32.WinDef$HWND
 *  com.sun.jna.platform.win32.WinDef$RECT
 *  org.opencv.core.Mat
 *  org.opencv.core.Size
 *  org.opencv.imgproc.Imgproc
 */
package com.lulu.core;

import com.lulu.config.Config;
import com.lulu.vision.ImageUtils;
import com.lulu.vision.OpenCVVision;
import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;
import org.opencv.core.Mat;
import org.opencv.core.Size;
import org.opencv.imgproc.Imgproc;

public class VisionBot {
    private static final double BASE_SCALE = 1.5;

    private static double getRatio() {
        return Config.Global.GAME_UI_SCALE / 1.5;
    }

    private static Mat captureAndNormalize(int realX, int realY, int realW, int realH, int baseW, int baseH) {
        try {
            Robot robot = new Robot();
            BufferedImage screen = robot.createScreenCapture(new Rectangle(realX, realY, realW, realH));
            Mat scene = ImageUtils.bufferedImageToMat(screen);
            double ratio = VisionBot.getRatio();
            if (Math.abs(ratio - 1.0) > 0.01) {
                Mat resizedScene = new Mat();
                Imgproc.resize((Mat)scene, (Mat)resizedScene, (Size)new Size((double)baseW, (double)baseH));
                return resizedScene;
            }
            return scene;
        }
        catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    public static int[] getTargetPosition(String windowTitle, String imgName) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, windowTitle);
        if (hwnd == null) {
            return null;
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        int realW = rect.right - rect.left;
        int realH = rect.bottom - rect.top;
        double ratio = VisionBot.getRatio();
        int baseW = (int)((double)realW / ratio);
        int baseH = (int)((double)realH / ratio);
        Mat scene = VisionBot.captureAndNormalize(rect.left, rect.top, realW, realH, baseW, baseH);
        return OpenCVVision.findInMat(scene, imgName);
    }

    public static int[] getTargetPositionInRegion(String windowTitle, String imgName, int roiX, int roiY, int roiW, int roiH) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, windowTitle);
        if (hwnd == null) {
            return null;
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        double ratio = VisionBot.getRatio();
        int realX = (int)((double)roiX * ratio);
        int realY = (int)((double)roiY * ratio);
        int realW = (int)((double)roiW * ratio);
        int realH = (int)((double)roiH * ratio);
        Mat scene = VisionBot.captureAndNormalize(rect.left + realX, rect.top + realY, realW, realH, roiW, roiH);
        int[] pos = OpenCVVision.findInMat(scene, imgName);
        if (pos != null) {
            return new int[]{roiX + pos[0], roiY + pos[1]};
        }
        return null;
    }

    public static List<int[]> getAllTargetPositions(String windowTitle, String imgName, double threshold) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, windowTitle);
        if (hwnd == null) {
            return new ArrayList<int[]>();
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        int realW = rect.right - rect.left;
        int realH = rect.bottom - rect.top;
        double ratio = VisionBot.getRatio();
        int baseW = (int)((double)realW / ratio);
        int baseH = (int)((double)realH / ratio);
        Mat scene = VisionBot.captureAndNormalize(rect.left, rect.top, realW, realH, baseW, baseH);
        return OpenCVVision.findAllInMat(scene, imgName, threshold);
    }

    public static List<int[]> getAllTargetPositionsInRegion(String windowTitle, String imgName, double threshold, int roiX, int roiY, int roiW, int roiH) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, windowTitle);
        if (hwnd == null) {
            return new ArrayList<int[]>();
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        double ratio = VisionBot.getRatio();
        int realX = (int)((double)roiX * ratio);
        int realY = (int)((double)roiY * ratio);
        int realW = Math.max(1, (int)((double)roiW * ratio));
        int realH = Math.max(1, (int)((double)roiH * ratio));
        Mat scene = VisionBot.captureAndNormalize(rect.left + realX, rect.top + realY, realW, realH, roiW, roiH);
        List<int[]> posList = OpenCVVision.findAllInMat(scene, imgName, threshold);
        for (int[] pos : posList) {
            pos[0] = pos[0] + roiX;
            pos[1] = pos[1] + roiY;
        }
        return posList;
    }

    public static Mat getSceneMatInRegion(String windowTitle, int roiX, int roiY, int roiW, int roiH) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, windowTitle);
        if (hwnd == null) {
            return null;
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        double ratio = VisionBot.getRatio();
        int realX = (int)((double)roiX * ratio);
        int realY = (int)((double)roiY * ratio);
        int realW = Math.max(1, (int)((double)roiW * ratio));
        int realH = Math.max(1, (int)((double)roiH * ratio));
        return VisionBot.captureAndNormalize(rect.left + realX, rect.top + realY, realW, realH, roiW, roiH);
    }
}

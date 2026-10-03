/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.sun.jna.platform.win32.User32
 *  com.sun.jna.platform.win32.WinDef$HWND
 *  com.sun.jna.platform.win32.WinDef$RECT
 *  org.opencv.core.Mat
 */
package com.lulu.core;

import com.lulu.config.Config;
import com.lulu.core.HardwareBot;
import com.lulu.core.VisionBot;
import com.lulu.vision.OpenCVVision;
import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.util.List;
import javax.swing.JPanel;
import javax.swing.JWindow;
import javax.swing.SwingUtilities;
import org.opencv.core.Mat;

public class AutomationEngine {
    private static double getRatio() {
        return Config.Global.GAME_UI_SCALE / 1.5;
    }

    private static int[] toAbsoluteAndScale(int relX, int relY) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
        if (hwnd == null) {
            return new int[]{(int)((double)relX * AutomationEngine.getRatio()), (int)((double)relY * AutomationEngine.getRatio())};
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        double ratio = AutomationEngine.getRatio();
        int realX = (int)((double)relX * ratio);
        int realY = (int)((double)relY * ratio);
        return new int[]{rect.left + realX, rect.top + realY};
    }

    public static boolean click(String imgName) {
        int[] pos = VisionBot.getTargetPosition("TaskBarHero", imgName);
        return AutomationEngine.click(pos);
    }

    public static boolean click(int relX, int relY) {
        int[] abs = AutomationEngine.toAbsoluteAndScale(relX, relY);
        HardwareBot.clickAt(abs[0], abs[1]);
        System.out.println("\u70b9\u51fb\u5750\u6807 -> \u57fa\u51c6\u76f8\u5bf9:(" + relX + "," + relY + ") \u771f\u5b9e\u7edd\u5bf9:(" + abs[0] + "," + abs[1] + ")");
        return true;
    }

    public static boolean click(int[] pos) {
        if (pos == null || pos.length < 2) {
            return false;
        }
        return AutomationEngine.click(pos[0], pos[1]);
    }

    public static boolean click(String imgName, int roiX, int roiY, int roiW, int roiH) {
        int[] pos = VisionBot.getTargetPositionInRegion("TaskBarHero", imgName, roiX, roiY, roiW, roiH);
        return AutomationEngine.click(pos);
    }

    public static boolean exists(String imgName) {
        return VisionBot.getTargetPosition("TaskBarHero", imgName) != null;
    }

    public static boolean exists(String imgName, int roiX, int roiY, int roiW, int roiH) {
        return VisionBot.getTargetPositionInRegion("TaskBarHero", imgName, roiX, roiY, roiW, roiH) != null;
    }

    public static void press(int vKey) {
        HardwareBot.pressKey(vKey);
    }

    public static void drag(int relX1, int relY1, int relX2, int relY2) {
        int[] start = AutomationEngine.toAbsoluteAndScale(relX1, relY1);
        int[] end = AutomationEngine.toAbsoluteAndScale(relX2, relY2);
        HardwareBot.dragTo(start[0], start[1], end[0], end[1]);
        System.out.println("\u62d6\u62fd\u52a8\u4f5c -> \u57fa\u51c6\u8d77\u70b9:(" + relX1 + "," + relY1 + ") \u57fa\u51c6\u7ec8\u70b9:(" + relX2 + "," + relY2 + ")");
    }

    public static void drag(int[] startPos, int[] endPos) {
        if (startPos == null || endPos == null || startPos.length < 2 || endPos.length < 2) {
            System.err.println("\u274c \u62d6\u62fd\u5750\u6807\u6570\u7ec4\u4e3a\u7a7a\u6216\u957f\u5ea6\u4e0d\u8db3\uff01");
            return;
        }
        AutomationEngine.drag(startPos[0], startPos[1], endPos[0], endPos[1]);
    }

    public static void scroll(int delta) {
        HardwareBot.mouseWheel(delta);
    }

    public static List<int[]> findAll(String imgName) {
        return VisionBot.getAllTargetPositions("TaskBarHero", imgName, Config.Global.MATCH_THRESHOLD);
    }

    public static List<int[]> findAll(String imgName, int roiX, int roiY, int roiW, int roiH) {
        return VisionBot.getAllTargetPositionsInRegion("TaskBarHero", imgName, Config.Global.MATCH_THRESHOLD, roiX, roiY, roiW, roiH);
    }

    public static double getMatchScore(String imgName, int roiX, int roiY, int roiW, int roiH) {
        Mat sceneMat = VisionBot.getSceneMatInRegion("TaskBarHero", roiX, roiY, roiW, roiH);
        if (sceneMat == null) {
            return 0.0;
        }
        return OpenCVVision.getMatchScore(sceneMat, imgName);
    }

    public static Mat getRawMat(int roiX, int roiY, int roiW, int roiH) {
        return VisionBot.getSceneMatInRegion("TaskBarHero", roiX, roiY, roiW, roiH);
    }

    public static void drawDebugROI(int roiX, int roiY, int roiW, int roiH, int durationMs) {
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
        if (hwnd == null) {
            return;
        }
        WinDef.RECT rect = new WinDef.RECT();
        User32.INSTANCE.GetWindowRect(hwnd, rect);
        double ratio = AutomationEngine.getRatio();
        int realX = (int)((double)roiX * ratio);
        int realY = (int)((double)roiY * ratio);
        int realW = (int)((double)roiW * ratio);
        int realH = (int)((double)roiH * ratio);
        int absX = rect.left + realX;
        int absY = rect.top + realY;
        SwingUtilities.invokeLater(() -> {
            JWindow window = new JWindow();
            window.setBounds(absX, absY, realW, realH);
            window.setAlwaysOnTop(true);
            window.setBackground(new Color(0, 0, 0, 0));
            JPanel panel = new JPanel(){

                @Override
                protected void paintComponent(Graphics g) {
                    super.paintComponent(g);
                    Graphics2D g2d = (Graphics2D)g;
                    g2d.setColor(Color.RED);
                    g2d.setStroke(new BasicStroke(4.0f));
                    g2d.drawRect(0, 0, this.getWidth() - 1, this.getHeight() - 1);
                }
            };
            panel.setOpaque(false);
            window.add(panel);
            window.setVisible(true);
            new Thread(() -> {
                try {
                    Thread.sleep(durationMs);
                }
                catch (InterruptedException interruptedException) {
                    // empty catch block
                }
                window.dispose();
            }).start();
        });
    }
}

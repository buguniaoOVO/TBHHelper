package com.lulu.gui;

import com.sun.jna.Native;
import com.sun.jna.WString;
import com.sun.jna.win32.StdCallLibrary;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.Image;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.IOException;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import javax.imageio.ImageIO;
import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;

public final class DesktopSupport {
    private final JFrame window;
    private final BooleanSupplier running;
    private final Runnable exit;
    private final List<Image> icons;
    private TrayIcon trayIcon;
    private boolean closeDialogOpen;

    public interface TaskbarShell extends StdCallLibrary {
        int SetCurrentProcessExplicitAppUserModelID(WString appId);
    }

    public static void initializeTaskbarIdentity() {
        if (!System.getProperty("os.name", "").startsWith("Windows")) {
            return;
        }
        try {
            TaskbarShell shell = Native.load("shell32", TaskbarShell.class);
            int result = shell.SetCurrentProcessExplicitAppUserModelID(new WString("TBH.Helper.Desktop"));
            if (result < 0) {
                System.err.println("[界面] 任务栏标识设置失败：" + result);
            }
        } catch (RuntimeException | LinkageError ex) {
            System.err.println("[界面] 任务栏标识设置失败：" + ex.getMessage());
        }
    }

    public static List<Image> loadIcons() {
        List<Image> result = new ArrayList<Image>();
        for (int size : new int[]{16, 20, 24, 32, 40, 48, 64, 128, 256}) {
            URL resource = DesktopSupport.class.getClassLoader().getResource("imgs/icon-" + size + ".png");
            if (resource != null) {
                try {
                    Image image = ImageIO.read(resource);
                    if (image != null) {
                        result.add(image);
                    }
                } catch (IOException ex) {
                    System.err.println("[界面] 图标读取失败：" + ex.getMessage());
                }
            }
        }
        if (result.isEmpty()) {
            URL logo = DesktopSupport.class.getClassLoader().getResource("imgs/logo.png");
            if (logo != null) {
                result.add(new ImageIcon(logo).getImage());
            }
        }
        return result;
    }

    public DesktopSupport(JFrame window, BooleanSupplier running, Runnable exit) {
        this.window = window;
        this.running = running;
        this.exit = exit;
        this.icons = loadIcons();
        if (!icons.isEmpty()) {
            window.setIconImages(icons);
        }
        window.setDefaultCloseOperation(JFrame.DO_NOTHING_ON_CLOSE);
        window.addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent event) {
                handleClose();
            }

            @Override
            public void windowClosed(WindowEvent event) {
                removeTrayIcon();
            }
        });
    }

    private void handleClose() {
        String action = UiPreferences.closeAction();
        if ("exit".equals(action)) exit.run();
        else if ("tray".equals(action)) minimizeToTray();
        else showCloseDialog();
    }

    public static JPanel closeDialogContent(boolean running) {
        JPanel content = new JPanel(new BorderLayout(0, 10));
        content.setOpaque(false);
        content.setBorder(BorderFactory.createEmptyBorder(4, 2, 8, 14));
        JLabel title = new JLabel(I18n.tr("选择助手的关闭方式"));
        title.setForeground(ModernUI.TEXT);
        JLabel detail = new JLabel(I18n.tr(running ? "最小化后自动任务继续运行；退出助手会停止任务。"
                : "最小化后可从右下角托盘打开助手。"));
        detail.setForeground(ModernUI.MUTED);
        content.add(title, BorderLayout.NORTH);
        content.add(detail, BorderLayout.CENTER);
        return content;
    }

    private void showCloseDialog() {
        if (closeDialogOpen) {
            return;
        }
        closeDialogOpen = true;
        try {
            ImageIcon icon = null;
            for (Image candidate : icons) {
                if (candidate.getWidth(null) == 64) {
                    icon = new ImageIcon(candidate);
                    break;
                }
            }
            int choice = JOptionPane.showOptionDialog(window, closeDialogContent(running.getAsBoolean()),
                    I18n.tr("关闭 TBH助手"), JOptionPane.DEFAULT_OPTION, JOptionPane.PLAIN_MESSAGE, icon,
                    new Object[]{I18n.tr("最小化到托盘"), I18n.tr("退出助手"), I18n.tr("取消")}, I18n.tr("最小化到托盘"));
            if (choice == 0) {
                minimizeToTray();
            } else if (choice == 1) {
                exit.run();
            }
        } finally {
            closeDialogOpen = false;
        }
    }

    private void minimizeToTray() {
        if (!SystemTray.isSupported() || icons.isEmpty()) {
            window.setExtendedState(window.getExtendedState() | JFrame.ICONIFIED);
            System.out.println(I18n.tr("当前系统托盘不可用，助手已最小化到任务栏。"));
            return;
        }
        try {
            if (trayIcon == null) {
                SystemTray tray = SystemTray.getSystemTray();
                Dimension size = tray.getTrayIconSize();
                Image image = icons.get(icons.size() - 1);
                for (Image candidate : icons) {
                    if (candidate.getWidth(null) >= size.width) {
                        image = candidate;
                        break;
                    }
                }
                PopupMenu menu = new PopupMenu();
                MenuItem restore = new MenuItem(I18n.tr("打开 TBH助手"));
                restore.addActionListener(e -> SwingUtilities.invokeLater(this::restoreWindow));
                MenuItem quit = new MenuItem(I18n.tr("退出助手"));
                quit.addActionListener(e -> SwingUtilities.invokeLater(exit));
                menu.add(restore);
                menu.addSeparator();
                menu.add(quit);
                trayIcon = new TrayIcon(image, I18n.tr("TBH助手 · 点击打开"), menu);
                trayIcon.setImageAutoSize(true);
                trayIcon.addActionListener(e -> SwingUtilities.invokeLater(this::restoreWindow));
                trayIcon.addMouseListener(new java.awt.event.MouseAdapter() {
                    @Override
                    public void mouseClicked(java.awt.event.MouseEvent event) {
                        if (event.getButton() == java.awt.event.MouseEvent.BUTTON1) {
                            SwingUtilities.invokeLater(DesktopSupport.this::restoreWindow);
                        }
                    }
                });
                tray.add(trayIcon);
            }
            window.setVisible(false);
            System.out.println(">>> [界面] 助手已最小化到托盘，点击托盘图标可恢复窗口。");
        } catch (Exception ex) {
            removeTrayIcon();
            window.setVisible(true);
            JOptionPane.showMessageDialog(window, I18n.tr("托盘图标创建失败：") + ex.getMessage(),
                    I18n.tr("最小化失败"), JOptionPane.WARNING_MESSAGE);
        }
    }

    private void restoreWindow() {
        window.setVisible(true);
        window.setExtendedState(window.getExtendedState() & ~JFrame.ICONIFIED);
        window.toFront();
        window.requestFocus();
        removeTrayIcon();
    }

    public void removeTrayIcon() {
        if (trayIcon != null) {
            SystemTray.getSystemTray().remove(trayIcon);
            trayIcon = null;
        }
    }
}

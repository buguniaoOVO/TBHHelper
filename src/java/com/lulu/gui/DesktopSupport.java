package com.lulu.gui;

import com.lulu.core.GameWindowController;
import com.sun.jna.Native;
import com.sun.jna.WString;
import com.sun.jna.win32.StdCallLibrary;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Container;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.Image;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.IOException;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import javax.imageio.ImageIO;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.ImageIcon;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPopupMenu;
import javax.swing.SwingUtilities;
import javax.swing.Timer;

public final class DesktopSupport {
    private final JFrame window;
    private final BooleanSupplier running;
    private final Runnable exit;
    private final List<Image> icons;
    private TrayIcon trayIcon;
    private JPopupMenu trayMenu;
    private JButton gameWindowButton;
    private Timer gameWindowRefreshTimer;
    private final AtomicBoolean gameWindowActionRunning = new AtomicBoolean();
    private Runnable notificationAction;
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
                if (gameWindowRefreshTimer != null) gameWindowRefreshTimer.stop();
                removeTrayIcon();
            }
        });
        Runtime.getRuntime().addShutdownHook(new Thread(GameWindowController::restoreOnExit,
                "tbh-game-window-restore"));
        SwingUtilities.invokeLater(this::installGameWindowControl);
    }

    private void installGameWindowControl() {
        JPanel actionRow = findAutomationActionRow(window.getContentPane());
        if (actionRow == null) {
            System.err.println("[游戏窗口] 未找到助手顶部控制栏，隐藏按钮未添加。");
            return;
        }
        JButton startButton = findAutomationButton(actionRow, true);
        gameWindowButton = new ModernUI.ActionButton("隐藏游戏窗口");
        gameWindowButton.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 12));
        gameWindowButton.setToolTipText("隐藏 TaskBarHero；再次点击此处恢复");
        gameWindowButton.addActionListener(event -> toggleGameWindow());
        int index = startButton == null ? actionRow.getComponentCount() : actionRow.getComponentZOrder(startButton);
        actionRow.add(gameWindowButton, Math.max(0, index));
        actionRow.revalidate();
        actionRow.repaint();
        refreshGameWindowControl();
        gameWindowRefreshTimer = new Timer(750, event -> refreshGameWindowControl());
        gameWindowRefreshTimer.start();
    }

    private static JPanel findAutomationActionRow(Container parent) {
        for (Component component : parent.getComponents()) {
            if (component instanceof JPanel) {
                JPanel panel = (JPanel)component;
                if (panel.getLayout() instanceof FlowLayout
                        && findAutomationButton(panel, true) != null
                        && findAutomationButton(panel, false) != null) {
                    return panel;
                }
            }
            if (component instanceof Container) {
                JPanel nested = findAutomationActionRow((Container)component);
                if (nested != null) return nested;
            }
        }
        return null;
    }

    private static JButton findAutomationButton(Container parent, boolean start) {
        for (Component component : parent.getComponents()) {
            if (!(component instanceof JButton)) continue;
            String text = ((JButton)component).getText();
            if (text == null) continue;
            String normalized = text.toLowerCase(java.util.Locale.ROOT);
            if (start ? (text.contains("一键开启") || normalized.contains("start all"))
                    : (text.contains("全部关闭") || normalized.contains("stop all"))) {
                return (JButton)component;
            }
        }
        return null;
    }

    private void refreshGameWindowControl() {
        if (gameWindowButton == null) return;
        boolean available = GameWindowController.isAvailable();
        boolean hidden = available && GameWindowController.isHidden();
        boolean english = I18n.english();
        gameWindowButton.setText(english ? (hidden ? "Show game" : "Hide game")
                : (hidden ? "显示游戏窗口" : "隐藏游戏窗口"));
        gameWindowButton.setToolTipText(english
                ? (hidden ? "Restore the hidden TaskBarHero window" : "Hide TaskBarHero; click again here to restore it")
                : (hidden ? "点击恢复已隐藏的游戏窗口" : "隐藏 TaskBarHero；再次点击此处恢复"));
        gameWindowButton.setEnabled(available && !gameWindowActionRunning.get());
    }

    private void toggleGameWindow() {
        if (!gameWindowActionRunning.compareAndSet(false, true)) return;
        refreshGameWindowControl();
        new Thread(() -> {
            String result = GameWindowController.toggle();
            SwingUtilities.invokeLater(() -> {
                gameWindowActionRunning.set(false);
                refreshGameWindowControl();
                if (!"SUCCESS|HIDDEN".equals(result) && !"SUCCESS|SHOWN".equals(result)) {
                    boolean english = I18n.english();
                    String message;
                    if ("SUCCESS|SHOWN|BACKGROUND_RESET_FAILED".equals(result)) {
                        message = english
                                ? "The game window is visible, but background mode could not be reset. Reconnect the plugin or restart the game."
                                : "游戏窗口已显示，但后台运行状态未恢复；请重新连接插件或重启游戏。";
                    } else if ("FAILED|GAME_NOT_FOUND".equals(result)) {
                        message = english ? "TaskBarHero window was not found." : "未检测到 TaskBarHero 窗口。";
                    } else if ("FAILED|PLUGIN_NOT_CONNECTED".equals(result)) {
                        message = english ? "The game plugin is not connected. The window was not hidden." : "游戏插件未连接，窗口未隐藏。请等待游戏连接后再试。";
                    } else if ("FAILED|BACKGROUND_MODE_FAILED".equals(result)) {
                        message = english ? "Could not enable background execution. The window was not hidden." : "无法启用游戏后台运行，窗口未隐藏。";
                    } else if ("FAILED|WINDOW_HIDE_FAILED".equals(result)) {
                        message = english ? "Could not hide the game window." : "隐藏游戏窗口失败。";
                    } else {
                        message = english ? "Could not restore the game window." : "恢复游戏窗口失败。";
                    }
                    JOptionPane.showMessageDialog(window, message,
                            english ? "Game window" : "游戏窗口", JOptionPane.WARNING_MESSAGE);
                }
            });
        }, "tbh-game-window-toggle").start();
    }

    private void exitAndRestore() {
        GameWindowController.restoreOnExit();
        exit.run();
    }

    private void handleClose() {
        String action = UiPreferences.closeAction();
        if ("exit".equals(action)) exitAndRestore();
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
                exitAndRestore();
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
            ensureTrayIcon();
            window.setVisible(false);
            System.out.println(">>> [界面] 助手已最小化到托盘，点击托盘图标可恢复窗口。");
        } catch (Exception ex) {
            removeTrayIcon();
            window.setVisible(true);
            JOptionPane.showMessageDialog(window, I18n.tr("托盘图标创建失败：") + ex.getMessage(),
                    I18n.tr("最小化失败"), JOptionPane.WARNING_MESSAGE);
        }
    }

    public void showNotification(String title, String message, Runnable action) {
        if (!SwingUtilities.isEventDispatchThread()) {
            SwingUtilities.invokeLater(() -> showNotification(title, message, action));
            return;
        }
        if (!SystemTray.isSupported() || icons.isEmpty()) return;
        try {
            ensureTrayIcon();
            notificationAction = action;
            trayIcon.displayMessage(I18n.tr(title), I18n.tr(message), TrayIcon.MessageType.INFO);
        } catch (Exception ex) {
            System.err.println("[自动更新] 托盘提醒失败：" + ex.getMessage());
        }
    }

    private void ensureTrayIcon() throws java.awt.AWTException {
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
                trayIcon = new TrayIcon(image, I18n.tr("TBH助手 · 点击打开"));
                trayIcon.setImageAutoSize(true);
                trayIcon.addActionListener(event -> SwingUtilities.invokeLater(() -> {
                    Runnable action = notificationAction;
                    notificationAction = null;
                    restoreWindow();
                    if (action != null) action.run();
                }));
                trayIcon.addMouseListener(new java.awt.event.MouseAdapter() {
                    @Override
                    public void mousePressed(java.awt.event.MouseEvent event) {
                        handleTrayMouse(event);
                    }

                    @Override
                    public void mouseReleased(java.awt.event.MouseEvent event) {
                        handleTrayMouse(event);
                    }
                });
                tray.add(trayIcon);
            }
    }

    /**
     * Windows 上 AWT 的 PopupMenu 走原生 Win32 菜单，字体不受 setFont 控制，
     * 缺少中文字形时菜单项会显示成方块。这里改为在托盘图标上手动弹出 Swing 菜单，保证中文正常。
     */
    private void handleTrayMouse(java.awt.event.MouseEvent event) {
        if (event.isPopupTrigger()) {
            showTrayMenu(event.getXOnScreen(), event.getYOnScreen());
        } else if (event.getButton() == java.awt.event.MouseEvent.BUTTON1
                && event.getID() == java.awt.event.MouseEvent.MOUSE_RELEASED) {
            SwingUtilities.invokeLater(this::restoreWindow);
        }
    }

    private void showTrayMenu(int x, int y) {
        SwingUtilities.invokeLater(() -> {
            if (trayMenu != null && trayMenu.isVisible()) {
                return;
            }
            Font menuFont = trayMenuFont();
            JPopupMenu menu = new JPopupMenu();
            menu.setFont(menuFont);
            menu.setFocusable(true);
            JMenuItem restore = new JMenuItem(I18n.tr("打开 TBH助手"));
            restore.setFont(menuFont);
            restore.addActionListener(e -> this.restoreWindow());
            JMenuItem quit = new JMenuItem(I18n.tr("退出助手"));
            quit.setFont(menuFont);
            quit.addActionListener(e -> exitAndRestore());
            menu.add(restore);
            menu.addSeparator();
            menu.add(quit);
            menu.setLocation(x, y);
            menu.setVisible(true);
            java.awt.Window popup = SwingUtilities.getWindowAncestor(menu);
            if (popup != null) {
                popup.setFocusableWindowState(true);
                popup.addWindowFocusListener(new java.awt.event.WindowAdapter() {
                    @Override
                    public void windowLostFocus(java.awt.event.WindowEvent event) {
                        menu.setVisible(false);
                    }
                });
            }
            trayMenu = menu;
        });
    }

    private void restoreWindow() {
        if (trayMenu != null) {
            trayMenu.setVisible(false);
            trayMenu = null;
        }
        window.setVisible(true);
        window.setExtendedState(window.getExtendedState() & ~JFrame.ICONIFIED);
        window.toFront();
        window.requestFocus();
        removeTrayIcon();
    }

    public void removeTrayIcon() {
        if (trayMenu != null) {
            trayMenu.setVisible(false);
            trayMenu = null;
        }
        if (trayIcon != null) {
            SystemTray.getSystemTray().remove(trayIcon);
            trayIcon = null;
        }
        notificationAction = null;
    }

    /** 选择能显示中文的字体，供 Swing 托盘菜单使用。 */
    static Font trayMenuFont() {
        for (String name : new String[]{"Microsoft YaHei UI", "微软雅黑", "Microsoft YaHei", "SimHei", "黑体", "SimSun", "宋体"}) {
            Font candidate = new Font(name, Font.PLAIN, 12);
            if (candidate.canDisplay('中') && candidate.canDisplay('助') && candidate.canDisplay('退')) {
                return candidate;
            }
        }
        return new Font(Font.DIALOG, Font.PLAIN, 12);
    }
}

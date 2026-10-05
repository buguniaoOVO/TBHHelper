/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.formdev.flatlaf.FlatLightLaf
 *  com.sun.jna.platform.win32.User32
 *  com.sun.jna.platform.win32.WinDef$HWND
 *  nu.pattern.OpenCV
 */
package com.lulu;

import com.formdev.flatlaf.FlatLightLaf;
import com.lulu.api.DllApiClient;
import com.lulu.api.MonitorStatus;
import com.lulu.config.Config;
import com.lulu.core.DeployManager;
import com.lulu.core.CorrosionTiming;
import com.lulu.gui.DesktopSupport;
import com.lulu.gui.I18n;
import com.lulu.gui.UiPreferences;
import com.lulu.gui.ModernUI;
import com.lulu.warehouse.WarehousePanel;
import com.lulu.logic.monitor.StatsManager;
import com.lulu.logic.monitor.ChestTracker;
import com.lulu.logic.monitor.ActivityStore;
import com.lulu.logic.tasks.ChestTask;
import com.lulu.logic.tasks.CorrosionTask;
import com.lulu.logic.tasks.EquipmentSynthesisTask;
import com.lulu.logic.tasks.MaterialSynthesisTask;
import com.lulu.logic.tasks.PlaguelandsTask;
import com.lulu.logic.tasks.StoreTask;
import com.lulu.core.UpdateChecker;
import com.sun.jna.platform.win32.User32;
import com.sun.jna.platform.win32.WinDef;
import java.awt.BorderLayout;
import java.awt.BasicStroke;
import java.awt.CardLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Cursor;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.awt.Image;
import java.awt.Insets;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.RoundRectangle2D;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;
import java.text.SimpleDateFormat;
import java.util.Date;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.ImageIcon;
import javax.swing.Icon;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.SwingConstants;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.JTable;
import javax.swing.JTabbedPane;
import javax.swing.JSpinner;
import javax.swing.SpinnerNumberModel;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.table.DefaultTableModel;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.border.EmptyBorder;
import javax.swing.border.LineBorder;
import nu.pattern.OpenCV;

public class MainGUI
extends JFrame {
    private static final String OFFICIAL_RELEASES_URL = "https://github.com/buguniaoOVO/TBHHelper/releases/latest";
    private static final String OFFICIAL_QQ_GROUP_URL = "https://qm.qq.com/q/a4N90riKrY";
    private static final String OPTIONAL_SPONSOR_URL = "https://afdian.com/a/Awan0v0?utm_source=copylink&utm_medium=link";
    private interface AutomationAction { void execute() throws InterruptedException; }
    private static final class AutomationJob {
        final String key;
        final String label;
        final BooleanSupplier due;
        final LongSupplier nextAt;
        final AutomationAction action;
        long dueAt;
        AutomationJob(String key, String label, BooleanSupplier due, LongSupplier nextAt, AutomationAction action) {
            this.key = key; this.label = label; this.due = due; this.nextAt = nextAt; this.action = action;
        }
    }
    public static double APP_SCALE = 1.0;
    private static final long GAME_EVENT_POLL_INTERVAL_MS = 3000L;
    private static final Color APP_BG = ModernUI.BACKGROUND;
    private static final Color SIDEBAR_BG = ModernUI.SIDEBAR;
    private static final Color SURFACE_BG = ModernUI.SURFACE;
    private static final Color SURFACE_ALT = ModernUI.SURFACE_ALT;
    private static final Color BORDER_COLOR = ModernUI.BORDER;
    private static final Color TEXT_COLOR = ModernUI.TEXT;
    private static final Color MUTED_COLOR = ModernUI.MUTED;
    private static final Color GOLD_ACCENT = ModernUI.GOLD;
    private static final Color PURPLE_ACCENT = ModernUI.PURPLE;
    private static final Color CYAN_ACCENT = ModernUI.TEAL;
    private DesktopSupport desktopSupport;
    private JPanel rootPanel;
    private JPanel sidebarNavigation;
    private JPanel pageHost;
    private CardLayout pageLayout;
    private final Map<String, JButton> navigationButtons = new LinkedHashMap<String, JButton>();
    private JLabel pageTitleLabel;
    private JLabel pageSubtitleLabel;
    private JLabel connectionLabel;
    private JLabel initializationLabel;
    private JLabel automationStateLabel;
    private JLabel footerStatusLabel;
    private JLabel overviewConnectionValue;
    private JLabel overviewConnectionHint;
    private JLabel apiAddressLabel;
    private volatile String pluginInitializationStatus = "正在初始化游戏 DLL。";
    private volatile boolean automaticInitializationEnabled = true;
    private volatile boolean gameWindowDetected;
    private volatile boolean pluginApiConnected;
    private volatile int automationQueueSize;
    private volatile long automationNextExecutionAtMillis;
    private volatile String activeAutomationTask = "";
    private volatile String queuedAutomationTask = "";
    private volatile boolean automationQueueWaitActive;
    private volatile long nextBlueChestAt = Long.MAX_VALUE;
    private volatile long nextWhiteChestAt = Long.MAX_VALUE;
    private JLabel overviewAutomationValue;
    private JLabel overviewAutomationHint;
    private JLabel overviewCorrosionValue;
    private JTextField blueCdField;
    private JTextField whiteCdField;
    private JTextField storeCdField;
    private JLabel warehouseCapacityLabel;
    private JCheckBox synthesisEnabledCheck;
    private JCheckBox warehouseCheck;
    private JCheckBox useLevelCheck;
    private JComboBox<String> synthGradeBox;
    private JTextField synthCdField;
    private JComboBox<String> equipMaxGradeBox;
    private JCheckBox materialSynthEnabledCheck;
    private JCheckBox materialWarehouseCheck;
    private JTextField materialSynthCdField;
    private JComboBox<String> materialMaxGradeBox;
    private JCheckBox corrosionEnabledCheck;
    private JCheckBox corrosionWarehouseCheck;
    private JCheckBox corrosionExcludeInscriptionScrollsCheck;
    private JCheckBox corrosionExcludeOfferingCoinsCheck;
    private JComboBox<String> corrosionMaxGradeBox;
    private JSpinner corrosionCdField;
    private JSpinner operationGapSpinner;
    private JSpinner clickGapSpinner;
    private JTextField corrosionPollutionThresholdField;
    private JTextField corrosionWarehouseThresholdField;
    private JLabel corrosionMonitorValue;
    private JCheckBox autoPlagueEnabledCheck;
    private JSpinner plagueTargetSpinner;
    private JSpinner plagueIntervalSpinner;
    private JLabel plaguelandsMonitorValue;
    private volatile String detectedPlaguelandsStatus = "等待游戏地图数据";
    private volatile PlaguelandsTask activePlaguelandsTask;
    private JTextField thresholdField;
    private JComboBox<String> gameScaleBox;
    private JComboBox<String> appScaleBox;
    private JCheckBox useApiCheckBox;
    private JButton deployApiBtn;
    private JButton uninstallApiBtn;
    private JTextField gamePathField;
    private JLabel gamePathStatusLabel;
    private JButton updateCheckBtn;
    private JButton updateNoticeButton;
    private JLabel automaticUpdateStatusLabel;
    private final AtomicBoolean updateCheckRunning = new AtomicBoolean();
    private final AtomicBoolean updateInstallRunning = new AtomicBoolean();
    private final Set<String> notifiedUpdateTags = new HashSet<String>();
    private ScheduledExecutorService automaticUpdateScheduler;
    private UpdateChecker.Release pendingUpdate;
    private volatile String automaticUpdateStatus = "启动后及每隔 6 小时检测 GitHub 版本。";
    private JButton releasePageBtn;
    private JLabel totalBlueLbl;
    private JLabel totalWhiteLbl;
    private JLabel sessionBlueLbl;
    private JLabel sessionWhiteLbl;
    private JTextArea consoleArea;
    private final JLabel[] chestCountLabels = new JLabel[ActivityStore.CHEST_KEYS.length];
    private DefaultTableModel dropTableModel;
    private DefaultTableModel jackpotTableModel;
    private JLabel statsSourceLabel;
    private final Object statsEventLock = new Object();
    private volatile long lastGameEventPollAtMillis;
    private JSpinner statsRetentionSpinner;
    private JSpinner logsRetentionSpinner;
    private JSpinner otherRetentionSpinner;
    private JCheckBox otherRetentionPermanentCheck;
    private int otherRecordRetentionHours = 24;
    private boolean otherRecordsPermanent = true;
    private DefaultTableModel qualitySummaryModel;
    private JLabel qualitySummaryTotalLabel;
    private JButton startBtn;
    private JButton stopBtn;
    private JButton manualCorrosionBtn;
    private volatile boolean isRunning = false;
    private volatile boolean manualCorrosionRunning = false;
    private volatile String lastCorrosionStatus = "就绪 · 等待启动";
    private Thread botThread;

    public MainGUI() {
        this.loadOtherRecordRetentionSettings();
        ActivityStore.setRetentionHours(Config.Global.STATS_RETENTION_HOURS, Config.Global.LOG_RETENTION_HOURS,
                this.otherRecordRetentionHours, this.otherRecordsPermanent);
        ActivityStore.migrateLegacyChestCounts(StatsManager.totalWhite, StatsManager.totalBlue);
        this.initUI();
        I18n.install(this);
        this.updateManualCorrosionButtons();
        this.redirectSystemOut();
        this.startPluginInitialization();
        this.startHotkeyListener();
        this.startStatsRefreshTimer();
        this.startCorrosionMonitor();
        this.startGameEventPoller();
        this.startAutomaticUpdateChecks();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println(">>> [\u7cfb\u7edf] \u76d1\u6d4b\u5230\u7a0b\u5e8f\u5173\u95ed\uff0c\u6b63\u5728\u6e05\u7406\u8d44\u6e90...");
            this.stopBot();
            if (this.automaticUpdateScheduler != null) this.automaticUpdateScheduler.shutdownNow();
            if (this.desktopSupport != null) {
                this.desktopSupport.removeTrayIcon();
            }
        }));
        System.out.println(">>> [\u7cfb\u7edf] TBH\u52a9\u624b\u5df2\u542f\u52a8\u3002");
    }

    private void initUI() {
        this.setTitle(Config.Global.APP_TITLE);
        this.setDefaultCloseOperation(JFrame.DO_NOTHING_ON_CLOSE);
        this.setSize((int)(1240.0 * APP_SCALE), (int)(860.0 * APP_SCALE));
        this.setMinimumSize(new Dimension((int)(1060.0 * APP_SCALE), (int)(720.0 * APP_SCALE)));
        this.setLocationRelativeTo(null);
        this.rootPanel = new ModernUI.BackgroundPanel(new BorderLayout());
        this.rootPanel.setBackground(APP_BG);
        this.setContentPane(this.rootPanel);

        this.totalBlueLbl = new JLabel("0");
        this.totalWhiteLbl = new JLabel("0");
        this.sessionBlueLbl = new JLabel("0");
        this.sessionWhiteLbl = new JLabel("0");
        this.consoleArea = new JTextArea();
        this.consoleArea.putClientProperty(I18n.IGNORE, Boolean.TRUE);
        this.consoleArea.setEditable(false);
        this.consoleArea.setLineWrap(true);
        this.consoleArea.setWrapStyleWord(true);
        this.consoleArea.setBackground(SURFACE_BG);
        this.consoleArea.setForeground(TEXT_COLOR);
        this.consoleArea.setCaretColor(TEXT_COLOR);
        this.consoleArea.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 13));
        this.consoleArea.setBorder(new EmptyBorder(12, 12, 12, 12));

        this.pageTitleLabel = new JLabel();
        this.pageTitleLabel.setForeground(TEXT_COLOR);
        this.pageTitleLabel.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 25));
        this.pageSubtitleLabel = new JLabel();
        this.pageSubtitleLabel.setForeground(MUTED_COLOR);
        this.pageSubtitleLabel.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 13));
        this.connectionLabel = new ModernUI.PillLabel();
        this.automationStateLabel = new ModernUI.PillLabel();
        this.footerStatusLabel = new JLabel("准备就绪");
        this.overviewConnectionValue = new JLabel("未连接");
        this.overviewAutomationValue = new JLabel("已停止");
        this.overviewCorrosionValue = new JLabel("装备 0 · 材料 0");

        this.startBtn = new ModernUI.ActionButton("⚡ 一键开启");
        this.stopBtn = new ModernUI.ActionButton("■ 全部关闭");
        this.stopBtn.setEnabled(false);
        this.styleActionButton(this.startBtn, GOLD_ACCENT, Color.WHITE);
        this.styleActionButton(this.stopBtn, SURFACE_ALT, TEXT_COLOR);
        this.startBtn.addActionListener(e -> {
            try {
                this.startBot();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        });
        this.stopBtn.addActionListener(e -> this.stopBot());

        this.navigationButtons.clear();
        this.sidebarNavigation = new JPanel();
        this.sidebarNavigation.setOpaque(false);
        this.sidebarNavigation.setBorder(new EmptyBorder(0, 12, 0, 12));
        this.sidebarNavigation.setLayout(new BoxLayout(this.sidebarNavigation, BoxLayout.Y_AXIS));
        this.pageLayout = new CardLayout();
        this.pageHost = new JPanel(this.pageLayout);
        this.pageHost.setOpaque(false);
        this.buildPages();

        JPanel workspace = new JPanel(new BorderLayout());
        workspace.setOpaque(false);
        workspace.add(this.buildHeaderPanel(), BorderLayout.NORTH);
        workspace.add(this.pageHost, BorderLayout.CENTER);
        workspace.add(this.buildFooterPanel(), BorderLayout.SOUTH);
        this.rootPanel.add(this.buildSidebar(), BorderLayout.WEST);
        this.rootPanel.add(workspace, BorderLayout.CENTER);
        this.showPage("overview", "概览", "运行状态与常用模块");
        this.updateRuntimeStatus();
        this.desktopSupport = new DesktopSupport(this, () -> this.isRunning || this.manualCorrosionRunning, this::exitApplication);
    }

    private void exitApplication() {
        this.stopBot();
        if (this.automaticUpdateScheduler != null) this.automaticUpdateScheduler.shutdownNow();
        this.desktopSupport.removeTrayIcon();
        this.dispose();
        System.exit(0);
    }

    private JPanel buildSidebar() {
        JPanel sidebar = new JPanel(new BorderLayout());
        sidebar.setBackground(SIDEBAR_BG);
        sidebar.setPreferredSize(new Dimension((int)(218 * APP_SCALE), 0));
        sidebar.setBorder(BorderFactory.createMatteBorder(0, 0, 0, 1, BORDER_COLOR));
        JPanel brand = new JPanel(new BorderLayout(10, 0));
        brand.setOpaque(false);
        brand.setBorder(new EmptyBorder(20, 16, 22, 10));
        JLabel logo = new JLabel();
        URL iconUrl = MainGUI.class.getClassLoader().getResource("imgs/icon-64.png");
        if (iconUrl != null) {
            Image image = new ImageIcon(iconUrl).getImage().getScaledInstance((int)(50 * APP_SCALE), (int)(50 * APP_SCALE), Image.SCALE_SMOOTH);
            logo.setIcon(new ImageIcon(image));
        }
        JPanel brandText = new JPanel();
        brandText.setOpaque(false);
        brandText.setLayout(new BoxLayout(brandText, BoxLayout.Y_AXIS));
        JLabel name = new JLabel("TBH助手");
        name.setForeground(TEXT_COLOR);
        name.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 16));
        JLabel subtitle = new JLabel("TaskBarHero 自动化");
        subtitle.setForeground(MUTED_COLOR);
        subtitle.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 10));
        brandText.add(name);
        brandText.add(Box.createRigidArea(new Dimension(0, 4)));
        brandText.add(subtitle);
        brand.add(logo, BorderLayout.WEST);
        brand.add(brandText, BorderLayout.CENTER);
        sidebar.add(brand, BorderLayout.NORTH);

        JScrollPane navScroll = new JScrollPane(this.sidebarNavigation);
        navScroll.setBorder(null);
        navScroll.setOpaque(false);
        navScroll.getViewport().setOpaque(false);
        navScroll.getVerticalScrollBar().setUnitIncrement(14);
        sidebar.add(navScroll, BorderLayout.CENTER);

        JLabel version = new JLabel("本地自动化工具");
        version.setForeground(MUTED_COLOR);
        version.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        version.setBorder(new EmptyBorder(14, 18, 16, 12));
        sidebar.add(version, BorderLayout.SOUTH);
        return sidebar;
    }

    private JPanel buildHeaderPanel() {
        JPanel header = new JPanel(new BorderLayout(12, 0));
        header.setOpaque(false);
        header.setBorder(new EmptyBorder(22, 26, 16, 26));
        JPanel titles = new JPanel();
        titles.setOpaque(false);
        titles.setLayout(new BoxLayout(titles, BoxLayout.Y_AXIS));
        titles.add(this.pageTitleLabel);
        titles.add(Box.createRigidArea(new Dimension(0, 3)));
        titles.add(this.pageSubtitleLabel);
        this.updateNoticeButton = new ModernUI.ActionButton("发现新版本 · 点击更新");
        this.updateNoticeButton.setVisible(false);
        this.updateNoticeButton.setForeground(GOLD_ACCENT);
        this.updateNoticeButton.addActionListener(e -> this.offerUpdate(this.pendingUpdate));
        titles.add(this.updateNoticeButton);

        JPanel actions = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
        actions.setOpaque(false);
        this.styleStatusPill(this.connectionLabel);
        this.styleStatusPill(this.automationStateLabel);
        JPanel connectionStatus = new JPanel();
        connectionStatus.setOpaque(false);
        connectionStatus.setLayout(new BoxLayout(connectionStatus, BoxLayout.Y_AXIS));
        this.initializationLabel = new ModernUI.PillLabel();
        this.initializationLabel.setText("● DLL 初始化/同步中");
        this.styleStatusPill(this.initializationLabel);
        this.initializationLabel.setForeground(GOLD_ACCENT);
        this.initializationLabel.setBackground(new Color(255, 247, 219));
        connectionStatus.add(this.initializationLabel);
        connectionStatus.add(this.connectionLabel);
        actions.add(connectionStatus);
        actions.add(this.automationStateLabel);
        actions.add(this.startBtn);
        actions.add(this.stopBtn);
        header.add(titles, BorderLayout.WEST);
        header.add(actions, BorderLayout.EAST);
        return header;
    }

    private JPanel buildFooterPanel() {
        JPanel footer = new JPanel(new BorderLayout());
        footer.setOpaque(false);
        footer.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(1, 0, 0, 0, BORDER_COLOR),
                new EmptyBorder(10, 26, 10, 26)));
        this.footerStatusLabel.setForeground(MUTED_COLOR);
        this.footerStatusLabel.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        JLabel version = new JLabel("TBH助手 · " + Config.Global.APP_VERSION);
        version.setForeground(MUTED_COLOR);
        version.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        JPanel credits = new JPanel(new FlowLayout(FlowLayout.RIGHT, 0, 0));
        credits.setOpaque(false);
        JLabel signature = new JLabel("by Awan");
        signature.setFont(scaledFont("Segoe UI", Font.ITALIC, 12));
        signature.setForeground(new Color(93, 106, 124));
        credits.add(version);
        credits.add(Box.createHorizontalStrut((int)Math.round(16 * APP_SCALE)));
        credits.add(signature);
        footer.add(this.footerStatusLabel, BorderLayout.WEST);
        footer.add(credits, BorderLayout.EAST);
        return footer;
    }

    private void buildPages() {
        JPanel overview = this.createPageBody();
        JPanel metrics = new JPanel(new GridLayout(1, 3, 12, 0));
        metrics.setOpaque(false);
        metrics.setMaximumSize(new Dimension(Integer.MAX_VALUE, (int)(132 * APP_SCALE)));
        metrics.setAlignmentX(Component.LEFT_ALIGNMENT);
        metrics.add(this.createMetricCard("游戏状态", this.overviewConnectionValue, "本机接口 " + DllApiClient.getApiAddress(), CYAN_ACCENT));
        metrics.add(this.createMetricCard("自动化", this.overviewAutomationValue, "显示当前任务、下一项任务和排队状态", GOLD_ACCENT));
        metrics.add(this.createMetricCard("腐蚀任务", this.overviewCorrosionValue, "装备与材料混合腐蚀", PURPLE_ACCENT));
        overview.add(metrics);
        overview.add(Box.createRigidArea(new Dimension(0, 14)));
        JPanel quickLinks = new JPanel(new GridLayout(1, 3, 12, 0));
        quickLinks.setOpaque(false);
        quickLinks.setMaximumSize(new Dimension(Integer.MAX_VALUE, (int)(188 * APP_SCALE)));
        quickLinks.setAlignmentX(Component.LEFT_ALIGNMENT);
        quickLinks.add(this.createQuickCard("自动合成", "配置装备和材料的等级、仓库、品质与 CD", "synthesis", "合成", "装备与材料自动合成规则"));
        quickLinks.add(this.createQuickCard("瘟疫之地", "检测当前地图、自动前往并设置腐蚀", "corrosion", "瘟疫之地", "地图检测、自动前往与腐蚀设置"));
        quickLinks.add(this.createQuickCard("仓库", "查看仓库格数并设置宝箱 CD", "warehouse", "仓库", "资源与仓库设置"));
        overview.add(quickLinks);
        overview.add(Box.createRigidArea(new Dimension(0, 14)));
        overview.add(this.createModulePanel("快速开始", this.createOverviewNote()));
        overview.add(Box.createRigidArea(new Dimension(0, 14)));
        overview.add(this.createDisclaimerPanel());
        this.addPage("overview", "概览", "运行概览", "游戏连接、任务状态与常用模块", overview);

        JPanel synthesis = this.createPageBody();
        synthesis.add(this.createModulePanel("自动合成设置", this.createSynthesisPanel()));
        synthesis.add(Box.createRigidArea(new Dimension(0, 10)));
        synthesis.add(this.createModulePanel("统一操作节奏", this.createOperationPacingPanel()));
        synthesis.add(Box.createRigidArea(new Dimension(0, 10)));
        synthesis.add(this.createSettingsConfirmPanel());
        this.addPage("synthesis", "合成", "合成", "装备与材料的自动合成规则", synthesis);

        JPanel corrosion = this.createPageBody();
        corrosion.add(this.createModulePanel("地图检测与自动前往", this.createPlaguelandsPanel()));
        corrosion.add(Box.createRigidArea(new Dimension(0, 12)));
        corrosion.add(this.createModulePanel("自动腐蚀设置", this.createCorrosionPanel()));
        corrosion.add(Box.createRigidArea(new Dimension(0, 10)));
        corrosion.add(this.createSettingsConfirmPanel());
        this.addPage("corrosion", "瘟疫之地", "瘟疫之地", "地图检测、自动前往与腐蚀设置", corrosion);

        JPanel warehouse = this.createPageBody();
        warehouse.add(this.createModulePanel("资源与仓库", this.createResourcePanel()));
        warehouse.add(Box.createRigidArea(new Dimension(0, 10)));
        warehouse.add(this.createSettingsConfirmPanel());
        warehouse.add(Box.createRigidArea(new Dimension(0, 14)));
        warehouse.add(new WarehousePanel());
        this.addPage("warehouse", "仓库", "仓库", "宝箱 CD、仓库格数与负载", warehouse);

        this.addPage("statistics", "统计", "数据统计", "宝箱累计和本次运行记录", this.createStatsPage());
        this.addPage("logs", "日志", "运行日志", "自动化任务与后台接口记录", this.createLogsPage());
        JPanel system = this.createPageBody();
        system.add(this.createModulePanel("系统设置", this.createSystemSettingsPanel()));
        system.add(Box.createRigidArea(new Dimension(0, 10)));
        system.add(this.createSettingsConfirmPanel());
        this.addPage("settings", "设置/setting", "系统设置", "后台连接与界面信息", system);
        this.addPage("help", "说明", "使用说明", "自动化任务的配置与运行方式", this.createHelpPage());
    }

    private void addPage(String id, String navText, String title, String subtitle, JPanel body) {
        JScrollPane scroll = new JScrollPane(body);
        scroll.setBorder(null);
        scroll.setOpaque(false);
        scroll.getViewport().setOpaque(false);
        scroll.getVerticalScrollBar().setUnitIncrement(16);
        this.pageHost.add(scroll, id);
        JButton button = new ModernUI.ActionButton(navText);
        if ("settings".equals(id)) button.putClientProperty(I18n.IGNORE, Boolean.TRUE);
        button.setIcon(new com.lulu.gui.NavigationIcon(id, (int)Math.round(22 * APP_SCALE)));
        button.setIconTextGap((int)Math.round(12 * APP_SCALE));
        button.setToolTipText(title);
        button.setHorizontalAlignment(SwingConstants.LEFT);
        button.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 13));
        button.setForeground(MUTED_COLOR);
        button.setBackground(SIDEBAR_BG);
        button.setOpaque(false);
        button.setFocusPainted(false);
        button.setPreferredSize(new Dimension((int)Math.round(196 * APP_SCALE), (int)Math.round(48 * APP_SCALE)));
        button.setMaximumSize(new Dimension(Integer.MAX_VALUE, (int)Math.round(48 * APP_SCALE)));
        button.setBorder(new EmptyBorder((int)Math.round(11 * APP_SCALE), (int)Math.round(15 * APP_SCALE),
                (int)Math.round(11 * APP_SCALE), (int)Math.round(10 * APP_SCALE)));
        button.addActionListener(e -> this.showPage(id, title, subtitle));
        this.navigationButtons.put(id, button);
        this.sidebarNavigation.add(button);
        this.sidebarNavigation.add(Box.createRigidArea(new Dimension(0, (int)Math.round(5 * APP_SCALE))));
    }

    private void showPage(String id, String title, String subtitle) {
        if (this.pageHost == null || this.pageLayout == null) {
            return;
        }
        this.pageLayout.show(this.pageHost, id);
        I18n.setText(this.pageTitleLabel, title);
        I18n.setText(this.pageSubtitleLabel, subtitle);
        for (Map.Entry<String, JButton> entry : this.navigationButtons.entrySet()) {
            boolean selected = entry.getKey().equals(id);
            JButton button = entry.getValue();
            button.putClientProperty("tbh.nav.selected", selected);
            button.setBackground(selected ? com.lulu.gui.NavigationIcon.selectionBackground(id) : SIDEBAR_BG);
            button.setForeground(selected ? TEXT_COLOR : MUTED_COLOR);
            button.setBorder(BorderFactory.createCompoundBorder(
                    BorderFactory.createMatteBorder(0, (int)Math.round(3 * APP_SCALE), 0, 0,
                            selected ? com.lulu.gui.NavigationIcon.accent(id) : SIDEBAR_BG),
                    new EmptyBorder((int)Math.round(11 * APP_SCALE), (int)Math.round(12 * APP_SCALE),
                            (int)Math.round(11 * APP_SCALE), (int)Math.round(10 * APP_SCALE))));
        }
    }

    private JPanel createPageBody() {
        JPanel body = new JPanel();
        body.setOpaque(false);
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setBorder(new EmptyBorder(10, 26, 24, 26));
        return body;
    }

    private JPanel createDisclaimerPanel() {
        Color warningRed = new Color(190, 38, 48);
        JPanel panel = ModernUI.card(new BorderLayout(0, 7));
        panel.setBackground(new Color(255, 251, 251));
        panel.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(238, 173, 177), 1, true),
                new EmptyBorder(13, 17, 13, 17)));
        panel.setAlignmentX(Component.LEFT_ALIGNMENT);

        JPanel header = new JPanel(new BorderLayout(12, 0));
        header.setOpaque(false);
        JLabel title = new JLabel("免责说明");
        title.setForeground(warningRed);
        title.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 15));
        header.add(title, BorderLayout.WEST);
        header.add(this.createCommunityLinkBar(), BorderLayout.EAST);
        panel.add(header, BorderLayout.NORTH);

        JPanel details = new JPanel();
        details.setOpaque(false);
        details.setLayout(new BoxLayout(details, BoxLayout.Y_AXIS));
        JLabel freeNotice = new JLabel("TBH助手免费下载和使用。Awan维护代码已在 GitHub 开源。");
        freeNotice.setForeground(warningRed);
        freeNotice.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        freeNotice.setAlignmentX(Component.LEFT_ALIGNMENT);
        JLabel downloadNotice = new JLabel("请从官方发布页下载；遇到收费售卖，请勿付款，并先核验版本。");
        downloadNotice.setForeground(warningRed);
        downloadNotice.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        downloadNotice.setAlignmentX(Component.LEFT_ALIGNMENT);
        JLabel riskNotice = new JLabel("自动化操作可能受到游戏或平台规则限制，请先阅读相关规则并自行评估账号风险。");
        riskNotice.setForeground(warningRed);
        riskNotice.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        riskNotice.setAlignmentX(Component.LEFT_ALIGNMENT);
        JLabel qqInfo = new JLabel("QQ群：123777707  ·  验证答案：挂机助手");
        qqInfo.setForeground(warningRed);
        qqInfo.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        qqInfo.setAlignmentX(Component.LEFT_ALIGNMENT);
        details.add(freeNotice);
        details.add(Box.createRigidArea(new Dimension(0, 5)));
        details.add(downloadNotice);
        details.add(Box.createRigidArea(new Dimension(0, 5)));
        details.add(riskNotice);
        details.add(Box.createRigidArea(new Dimension(0, 5)));
        details.add(qqInfo);
        panel.add(details, BorderLayout.CENTER);
        panel.setMaximumSize(new Dimension(Integer.MAX_VALUE, panel.getPreferredSize().height));
        return panel;
    }

    private JPanel createCommunityLinkBar() {
        JPanel bar = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
        bar.setOpaque(false);
        JButton github = this.createCommunityButton("GitHub", new CommunityIcon(CommunityIcon.GITHUB,
                new Color(35, 39, 47)), TEXT_COLOR, "查看 GitHub 官方发布页", OFFICIAL_RELEASES_URL);
        JButton qq = this.createCommunityButton("QQ群", new CommunityIcon(CommunityIcon.QQ,
                new Color(54, 91, 139)), TEXT_COLOR, "加入群聊【Awan的助手群】", OFFICIAL_QQ_GROUP_URL);
        JButton sponsor = this.createCommunityButton("赞助", new CommunityIcon(CommunityIcon.HEART,
                new Color(224, 75, 75)), new Color(115, 48, 48), "自愿赞助 Awan", OPTIONAL_SPONSOR_URL);
        bar.add(github);
        bar.add(qq);
        bar.add(sponsor);
        return bar;
    }

    private JButton createCommunityButton(String label, Icon icon, Color foreground, String tooltip, String url) {
        JButton button = new ModernUI.ActionButton(label);
        this.styleActionButton(button, Color.WHITE, foreground);
        button.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        button.setIcon(icon);
        button.setIconTextGap(7);
        button.setBorderPainted(true);
        button.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(BORDER_COLOR, 1, true), new EmptyBorder(7, 11, 7, 11)));
        button.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        button.setToolTipText(tooltip);
        button.addActionListener(event -> this.openExternalLink(url));
        return button;
    }

    private static final class CommunityIcon implements Icon {
        static final int GITHUB = 1;
        static final int QQ = 2;
        static final int HEART = 3;
        private final int type;
        private final Color color;

        CommunityIcon(int type, Color color) {
            this.type = type;
            this.color = color;
        }

        @Override public int getIconWidth() { return 18; }
        @Override public int getIconHeight() { return 18; }

        @Override
        public void paintIcon(Component component, Graphics graphics, int x, int y) {
            Graphics2D g = (Graphics2D)graphics.create();
            try {
                g.translate(x, y);
                g.scale(18.0 / 24.0, 18.0 / 24.0);
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
                g.setStroke(new BasicStroke(2.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
                if (type == GITHUB) {
                    Path2D cat = new Path2D.Double();
                    cat.moveTo(5.5, 8);
                    cat.lineTo(4, 2.5); cat.curveTo(3.8, 1.6, 4.7, 1.1, 5.5, 1.7);
                    cat.lineTo(10, 5); cat.curveTo(11.3, 4.6, 12.7, 4.6, 14, 5);
                    cat.lineTo(18.5, 1.7); cat.curveTo(19.3, 1.1, 20.2, 1.6, 20, 2.5);
                    cat.lineTo(18.5, 8); cat.curveTo(21.4, 10.5, 21.6, 14.6, 19.2, 17.5);
                    cat.curveTo(17.4, 19.7, 14.8, 20.5, 12, 20.5);
                    cat.curveTo(9.2, 20.5, 6.6, 19.7, 4.8, 17.5);
                    cat.curveTo(2.4, 14.6, 2.6, 10.5, 5.5, 8);
                    cat.closePath();
                    g.setColor(color);
                    g.fill(cat);
                    g.setColor(Color.WHITE);
                    g.fill(new Ellipse2D.Double(7.4, 10.3, 1.6, 2.3));
                    g.fill(new Ellipse2D.Double(15.0, 10.3, 1.6, 2.3));
                    g.setColor(color);
                    g.setStroke(new BasicStroke(2.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
                    Path2D tail = new Path2D.Double();
                    tail.moveTo(18.7, 15.2); tail.curveTo(23, 13.8, 23.2, 18.7, 20.1, 19.2);
                    tail.curveTo(18.4, 19.5, 18.1, 17.7, 19.2, 17.1);
                    g.draw(tail);
                } else if (type == QQ) {
                    g.setColor(color);
                    g.draw(new RoundRectangle2D.Double(2.0, 3.0, 14.0, 11.0, 4.0, 4.0));
                    Path2D firstTail = new Path2D.Double();
                    firstTail.moveTo(5.0, 13.4); firstTail.lineTo(4.0, 17.0); firstTail.lineTo(8.0, 14.0);
                    g.draw(firstTail);
                    g.draw(new RoundRectangle2D.Double(9.0, 9.0, 12.0, 10.0, 4.0, 4.0));
                    Path2D secondTail = new Path2D.Double();
                    secondTail.moveTo(17.0, 18.4); secondTail.lineTo(19.5, 21.0); secondTail.lineTo(19.0, 18.0);
                    g.draw(secondTail);
                } else {
                    Path2D heart = new Path2D.Double();
                    heart.moveTo(12, 21);
                    heart.curveTo(10, 19.2, 3.0, 13.4, 3.0, 8.6);
                    heart.curveTo(3.0, 3.5, 9.1, 2.0, 12, 6.1);
                    heart.curveTo(14.9, 2.0, 21.0, 3.5, 21.0, 8.6);
                    heart.curveTo(21.0, 13.4, 14.0, 19.2, 12, 21);
                    heart.closePath();
                    g.setColor(color);
                    g.fill(heart);
                }
            } finally {
                g.dispose();
            }
        }
    }

    private JPanel createSettingsConfirmPanel() {
        JPanel row = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
        row.setOpaque(false);
        JLabel hint = new JLabel("更改后点击确认，设置会立即保存并应用。");
        hint.setForeground(MUTED_COLOR);
        hint.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        JButton confirm = new ModernUI.ActionButton("确认并应用设置");
        this.styleActionButton(confirm, CYAN_ACCENT, Color.WHITE);
        confirm.addActionListener(e -> this.confirmSettings());
        row.add(hint);
        row.add(confirm);
        row.setAlignmentX(Component.LEFT_ALIGNMENT);
        return row;
    }

    private void confirmSettings() {
        if (this.saveSettings()) {
            I18n.setText(this.footerStatusLabel, "设置已保存并应用");
            String summary = "设置已保存并应用。\n"
                    + "瘟疫之地：" + (Config.Global.AUTO_PLAGUELANDS_ENABLED ? "已启用" : "已关闭")
                    + "；目标等级 " + Config.Global.PLAGUELANDS_TARGET_LEVEL
                    + "；检测间隔 " + Config.Global.PLAGUELANDS_CHECK_INTERVAL_MIN + " 分钟。\n"
                    + "腐蚀阈值：污染度 " + Config.Synthesis.CORROSION_POLLUTION_THRESHOLD
                    + "；仓库负载 " + Config.Synthesis.CORROSION_WAREHOUSE_THRESHOLD_PERCENT + "%。\n"
                    + "记录保留：统计 " + Config.Global.STATS_RETENTION_HOURS
                    + " 小时；其他记录 " + (this.otherRecordsPermanent ? "永久" : this.otherRecordRetentionHours + " 小时")
                    + "；日志 " + Config.Global.LOG_RETENTION_HOURS + " 小时。";
            JOptionPane.showMessageDialog(this, I18n.tr(summary), I18n.tr("设置已更新"), JOptionPane.INFORMATION_MESSAGE);
        } else {
            JOptionPane.showMessageDialog(this, I18n.tr("有设置值无效或保存失败，请检查输入后重试。"), I18n.tr("设置未保存"), JOptionPane.ERROR_MESSAGE);
        }
    }

    private JPanel createMetricCard(String title, JLabel value, String detail, Color accent) {
        JPanel card = ModernUI.card(new BorderLayout(0, 9));
        card.setBackground(SURFACE_BG);
        card.setBorder(new EmptyBorder(17, 18, 17, 18));
        JLabel heading = new JLabel(title);
        heading.setForeground(MUTED_COLOR);
        heading.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 13));
        value.setForeground(accent);
        value.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 25));
        JLabel hint = new JLabel(detail);
        if (value == this.overviewConnectionValue) this.overviewConnectionHint = hint;
        if (value == this.overviewAutomationValue) this.overviewAutomationHint = hint;
        hint.setForeground(MUTED_COLOR);
        hint.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        card.add(heading, BorderLayout.NORTH);
        card.add(value, BorderLayout.CENTER);
        card.add(hint, BorderLayout.SOUTH);
        return card;
    }

    private static Font scaledFont(String family, int style, int baseSize) {
        return new Font(family, style, Math.max(9, (int)Math.round(baseSize * APP_SCALE)));
    }

    private JPanel createQuickCard(String title, String detail, String page, String pageTitle, String pageSubtitle) {
        JPanel card = ModernUI.card(new BorderLayout(0, 10));
        card.setBackground(SURFACE_BG);
        card.setBorder(new EmptyBorder(18, 18, 18, 18));
        JLabel heading = new JLabel(title);
        heading.setForeground(TEXT_COLOR);
        heading.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 15));
        JTextArea description = new JTextArea(detail);
        description.setEditable(false);
        description.setLineWrap(true);
        description.setWrapStyleWord(true);
        description.setOpaque(false);
        description.setForeground(MUTED_COLOR);
        description.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        JButton open = new ModernUI.ActionButton("打开设置  →");
        this.styleActionButton(open, SURFACE_ALT, TEXT_COLOR);
        open.addActionListener(e -> this.showPage(page, pageTitle, pageSubtitle));
        card.add(heading, BorderLayout.NORTH);
        card.add(description, BorderLayout.CENTER);
        card.add(open, BorderLayout.SOUTH);
        return card;
    }

    private JPanel createOverviewNote() {
        JPanel note = new JPanel(new BorderLayout());
        note.setOpaque(false);
        JTextArea text = new JTextArea("启动游戏后点击“一键开启”。腐蚀会混合填充装备与材料，统一使用仓库范围、品质上限和 CD；“手动腐蚀一次”执行一轮。\n后台模式通过本地插件选择腐蚀菜单，并在执行前检查品质上限。");
        text.setEditable(false);
        text.setLineWrap(true);
        text.setWrapStyleWord(true);
        text.setOpaque(false);
        text.setForeground(MUTED_COLOR);
        text.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        note.add(text, BorderLayout.CENTER);
        return note;
    }

    private void loadOtherRecordRetentionSettings() {
        Properties properties = new Properties();
        File file = new File("settings.properties");
        if (!file.exists()) return;
        try (FileInputStream input = new FileInputStream(file)) {
            properties.load(input);
            this.otherRecordRetentionHours = Math.max(1,
                    Integer.parseInt(properties.getProperty("other_record_retention_hours", "24")));
            this.otherRecordsPermanent = Boolean.parseBoolean(
                    properties.getProperty("other_records_permanent", "true"));
        } catch (Exception ex) {
            System.err.println("[统计] 其他记录保留设置读取失败: " + ex.getMessage());
        }
    }

    private JPanel createStatsPage() {
        JPanel body = this.createPageBody();
        JPanel retention = new JPanel();
        retention.setOpaque(false);
        retention.setLayout(new BoxLayout(retention, BoxLayout.Y_AXIS));

        JPanel dropRetention = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 2));
        dropRetention.setOpaque(false);
        dropRetention.add(new JLabel("掉落统计保留："));
        this.statsRetentionSpinner = new JSpinner(new SpinnerNumberModel(Config.Global.STATS_RETENTION_HOURS, 1, 720, 1));
        dropRetention.add(this.statsRetentionSpinner);
        dropRetention.add(new JLabel("小时（1小时–30天）"));
        JButton confirmDropRetention = new ModernUI.ActionButton("确认掉落保留");
        this.styleActionButton(confirmDropRetention, new Color(232, 244, 248), CYAN_ACCENT);
        confirmDropRetention.addActionListener(e -> this.confirmSettings());
        dropRetention.add(confirmDropRetention);

        JPanel otherRetention = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 2));
        otherRetention.setOpaque(false);
        otherRetention.add(new JLabel("其他记录保留："));
        this.otherRetentionSpinner = new JSpinner(new SpinnerNumberModel(this.otherRecordRetentionHours, 1,
                Integer.MAX_VALUE, 1));
        JSpinner.NumberEditor otherRetentionEditor = new JSpinner.NumberEditor(this.otherRetentionSpinner, "#,##0");
        otherRetentionEditor.getTextField().setColumns(10);
        this.otherRetentionSpinner.setEditor(otherRetentionEditor);
        this.otherRetentionSpinner.setEnabled(!this.otherRecordsPermanent);
        otherRetention.add(this.otherRetentionSpinner);
        otherRetention.add(new JLabel("小时"));
        this.otherRetentionPermanentCheck = new JCheckBox("永久保存", this.otherRecordsPermanent);
        this.otherRetentionPermanentCheck.setOpaque(false);
        this.otherRetentionPermanentCheck.setForeground(TEXT_COLOR);
        this.otherRetentionPermanentCheck.addActionListener(e ->
                this.otherRetentionSpinner.setEnabled(!this.otherRetentionPermanentCheck.isSelected()));
        otherRetention.add(this.otherRetentionPermanentCheck);
        JButton confirmOtherRetention = new ModernUI.ActionButton("确认其他记录保留");
        this.styleActionButton(confirmOtherRetention, new Color(232, 244, 248), CYAN_ACCENT);
        confirmOtherRetention.addActionListener(e -> this.confirmSettings());
        otherRetention.add(confirmOtherRetention);
        JButton clearChest = new ModernUI.ActionButton("清除宝箱记录");
        this.styleActionButton(clearChest, new Color(255, 239, 242), new Color(176, 35, 64));
        clearChest.addActionListener(e -> this.confirmAndClearRecords("宝箱记录", "chest"));
        otherRetention.add(clearChest);
        retention.add(dropRetention);
        retention.add(Box.createRigidArea(new Dimension(0, 6)));
        retention.add(otherRetention);
        body.add(this.createModulePanel("记录保留设置", retention));

        this.statsSourceLabel = new JLabel("等待游戏插件事件");
        this.statsSourceLabel.setForeground(CYAN_ACCENT);
        this.statsSourceLabel.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        body.add(Box.createRigidArea(new Dimension(0, 8)));
        body.add(this.statsSourceLabel);

        JTabbedPane tabs = new JTabbedPane();
        tabs.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        tabs.addTab("宝箱", this.createChestStatsPanel());

        this.dropTableModel = new DefaultTableModel(new Object[0][0],
                new Object[]{"时间", "地图", "来源宝箱", "品质", "道具名称"});
        tabs.addTab("掉落", this.createEventTablePanel(this.dropTableModel, "drop", 3, 4, "掉落记录"));

        this.jackpotTableModel = new DefaultTableModel(new Object[0][0],
                new Object[]{"时间", "地图", "来源宝箱", "品质", "道具名称", "数量"});
        tabs.addTab("出货啦", this.createEventTablePanel(this.jackpotTableModel, "jackpot", 3, 4, "出货啦记录"));

        body.add(Box.createRigidArea(new Dimension(0, 10)));
        body.add(tabs);
        this.refreshStatisticsTables();
        return body;
    }

    private JPanel createChestStatsPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 10));
        panel.setOpaque(false);
        JPanel grid = new JPanel(new GridLayout(1, 3, 10, 10));
        grid.setOpaque(false);
        grid.setPreferredSize(new Dimension(0, Math.max(130, (int)Math.round(140 * APP_SCALE))));
        grid.setMinimumSize(new Dimension(0, Math.max(130, (int)Math.round(140 * APP_SCALE))));
        grid.setMaximumSize(new Dimension(Integer.MAX_VALUE, Math.max(130, (int)Math.round(140 * APP_SCALE))));
        Color[] colors = new Color[]{GOLD_ACCENT, CYAN_ACCENT, PURPLE_ACCENT,
                new Color(83, 200, 133), new Color(92, 172, 235), new Color(235, 107, 125)};
        for (int i = 0; i < ActivityStore.CHEST_LABELS.length; i++) {
            this.chestCountLabels[i] = new JLabel("0");
            grid.add(this.createMetricCard(ActivityStore.CHEST_LABELS[i], this.chestCountLabels[i],
                    "保留期内新增", colors[i]));
        }
        JLabel hint = new JLabel("宝箱卡片按普通、稀有和 BOSS 分类累计；下方品质数量与概率按保留期内的掉落物品数量即时计算。");
        hint.setForeground(MUTED_COLOR);
        hint.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));

        this.qualitySummaryModel = new DefaultTableModel(new Object[0][0], new Object[]{"品质", "数量", "概率"}) {
            @Override
            public boolean isCellEditable(int row, int column) {
                return false;
            }
        };
        this.qualitySummaryTotalLabel = new JLabel("已记录掉落：0 件");
        this.qualitySummaryTotalLabel.setForeground(CYAN_ACCENT);
        this.qualitySummaryTotalLabel.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 12));
        JPanel summaryHeader = new JPanel(new BorderLayout());
        summaryHeader.setOpaque(false);
        JLabel summaryTitle = new JLabel("掉落品质汇总");
        summaryTitle.setForeground(TEXT_COLOR);
        summaryTitle.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 14));
        summaryHeader.add(summaryTitle, BorderLayout.WEST);
        summaryHeader.add(this.qualitySummaryTotalLabel, BorderLayout.EAST);

        JTable qualityTable = this.createQualitySummaryTable(this.qualitySummaryModel);
        JScrollPane qualityScroll = new JScrollPane(qualityTable);
        qualityScroll.setBorder(new LineBorder(BORDER_COLOR, 1, true));
        qualityScroll.getViewport().setBackground(SURFACE_BG);
        JPanel qualitySummary = new JPanel(new BorderLayout(0, 8));
        qualitySummary.setOpaque(false);
        qualitySummary.add(summaryHeader, BorderLayout.NORTH);
        qualitySummary.add(qualityScroll, BorderLayout.CENTER);

        panel.add(grid, BorderLayout.NORTH);
        panel.add(qualitySummary, BorderLayout.CENTER);
        panel.add(hint, BorderLayout.SOUTH);
        return panel;
    }

    private JTable createQualitySummaryTable(DefaultTableModel model) {
        JTable table = new JTable(model);
        table.setFillsViewportHeight(true);
        table.setRowHeight(Math.max(28, (int)Math.round(30 * APP_SCALE)));
        table.setBackground(SURFACE_BG);
        table.setForeground(TEXT_COLOR);
        table.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        table.setShowVerticalLines(false);
        table.setShowHorizontalLines(false);
        table.setIntercellSpacing(new Dimension(0, 0));
        table.getTableHeader().setBackground(SURFACE_ALT);
        table.getTableHeader().setForeground(TEXT_COLOR);
        table.getTableHeader().setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 12));
        table.getTableHeader().setPreferredSize(new Dimension(0, Math.max(28, (int)Math.round(30 * APP_SCALE))));
        table.setDefaultRenderer(Object.class, new DefaultTableCellRenderer() {
            @Override
            public Component getTableCellRendererComponent(JTable target, Object value, boolean selected,
                    boolean focused, int row, int column) {
                JLabel label = (JLabel)super.getTableCellRendererComponent(target, value, selected, focused, row, column);
                label.setBorder(new EmptyBorder(0, 10, 0, 10));
                if (!selected) {
                    label.setBackground(row % 2 == 0 ? SURFACE_BG : SURFACE_ALT);
                    label.setForeground(row < 10 ? gradeColor(row) : MUTED_COLOR);
                }
                return label;
            }
        });
        table.getColumnModel().getColumn(0).setPreferredWidth(140);
        table.getColumnModel().getColumn(1).setPreferredWidth(110);
        table.getColumnModel().getColumn(2).setPreferredWidth(110);
        return table;
    }

    private JPanel createEventTablePanel(DefaultTableModel model, String recordType,
            int qualityColumn, int itemNameColumn, String recordLabel) {
        JPanel panel = new JPanel(new BorderLayout(0, 8));
        panel.setOpaque(false);
        JTable table = this.createActivityTable(model, qualityColumn, itemNameColumn);
        JScrollPane scroll = new JScrollPane(table);
        scroll.setBorder(new LineBorder(BORDER_COLOR, 1, true));
        scroll.getViewport().setBackground(SURFACE_BG);
        if ("drop".equals(recordType)) {
            JPanel refreshBar = new JPanel(new BorderLayout());
            refreshBar.setOpaque(false);
            JButton refresh = new ModernUI.ActionButton("刷新");
            this.styleActionButton(refresh, new Color(232, 244, 248), CYAN_ACCENT);
            refresh.addActionListener(e -> this.refreshDropEvents(refresh));
            refreshBar.add(refresh, BorderLayout.EAST);
            panel.add(refreshBar, BorderLayout.NORTH);
        }
        JPanel actions = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
        actions.setOpaque(false);
        JButton clear = new ModernUI.ActionButton("清除" + recordLabel);
        this.styleActionButton(clear, new Color(255, 239, 242), new Color(176, 35, 64));
        clear.addActionListener(e -> this.confirmAndClearRecords(recordLabel, recordType));
        actions.add(clear);
        panel.add(scroll, BorderLayout.CENTER);
        panel.add(actions, BorderLayout.SOUTH);
        return panel;
    }

    private JTable createActivityTable(DefaultTableModel model, final int qualityColumn, final int itemNameColumn) {
        JTable table = new JTable(model);
        table.setFillsViewportHeight(true);
        table.setRowHeight(Math.max(30, (int)Math.round(33 * APP_SCALE)));
        table.setBackground(SURFACE_BG);
        table.setForeground(TEXT_COLOR);
        table.setGridColor(BORDER_COLOR);
        table.setShowVerticalLines(false);
        table.setShowHorizontalLines(false);
        table.setIntercellSpacing(new Dimension(0, 0));
        table.setSelectionBackground(new Color(222, 237, 254));
        table.setSelectionForeground(TEXT_COLOR);
        table.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
        table.getTableHeader().setBackground(SURFACE_ALT);
        table.getTableHeader().setForeground(TEXT_COLOR);
        table.getTableHeader().setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 12));
        table.getTableHeader().setPreferredSize(new Dimension(0, Math.max(34, (int)Math.round(36 * APP_SCALE))));
        table.setDefaultRenderer(Object.class, new DefaultTableCellRenderer() {
            @Override
            public Component getTableCellRendererComponent(JTable target, Object value, boolean selected,
                    boolean focused, int row, int column) {
                JLabel label = (JLabel)super.getTableCellRendererComponent(target, value, selected, focused, row, column);
                label.setBorder(BorderFactory.createEmptyBorder(0, 8, 0, 8));
                int grade = -1;
                if (qualityColumn >= 0 && row < target.getModel().getRowCount()) {
                    Object rawGrade = target.getModel().getValueAt(target.convertRowIndexToModel(row), qualityColumn);
                    grade = gradeIndex(String.valueOf(rawGrade));
                }
                if (column == itemNameColumn && grade >= 0) {
                    String name = String.valueOf(value == null ? "" : value);
                    String mark = grade >= 8 ? "★ " : grade >= 6 ? "☆ " : "";
                    I18n.setText(label, mark + name);
                }
                if (!selected) {
                    label.setBackground(row % 2 == 0 ? SURFACE_BG : SURFACE_ALT);
                    if ((column == qualityColumn || column == itemNameColumn) && grade >= 0) {
                        label.setForeground(gradeColor(grade));
                    } else {
                        label.setForeground(MUTED_COLOR);
                    }
                }
                return label;
            }
        });
        return table;
    }

    private static int gradeIndex(String name) {
        String[] grades = new String[]{"普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙"};
        for (int i = 0; i < grades.length; i++) {
            if (grades[i].equals(name)) {
                return i;
            }
        }
        return -1;
    }

    private static Color gradeColor(int grade) {
        Color[] colors = new Color[]{new Color(71, 85, 105), new Color(21, 128, 61),
                new Color(29, 100, 216), new Color(126, 34, 206), new Color(174, 93, 6),
                new Color(190, 42, 110), new Color(143, 110, 0), new Color(0, 121, 137),
                new Color(205, 32, 73), new Color(75, 65, 52)};
        return colors[Math.max(0, Math.min(colors.length - 1, grade))];
    }

    private JPanel createLogsPage() {
        JPanel body = this.createPageBody();
        JPanel controls = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 2));
        controls.setOpaque(false);
        controls.add(new JLabel("助手日志保留："));
        this.logsRetentionSpinner = new JSpinner(new SpinnerNumberModel(Config.Global.LOG_RETENTION_HOURS, 1, 720, 1));
        controls.add(this.logsRetentionSpinner);
        controls.add(new JLabel("小时（1小时–30天）"));
        JButton confirmRetention = new ModernUI.ActionButton("确认保留时间");
        confirmRetention.addActionListener(e -> this.confirmSettings());
        controls.add(confirmRetention);
        JButton clear = new ModernUI.ActionButton("清除日志");
        clear.addActionListener(e -> this.confirmAndClearRecords("运行日志", "log"));
        controls.add(clear);
        body.add(this.createModulePanel("日志保留设置", controls));
        ActivityStore.prune();
        List<ActivityStore.Entry> oldLogs = ActivityStore.getRecent("log", 500);
        for (int i = oldLogs.size() - 1; i >= 0; i--) {
            ActivityStore.Entry entry = oldLogs.get(i);
            this.consoleArea.append(formatLogTimestamp(entry.timeMillis) + " " + entry.field(0) + "\n");
        }
        JScrollPane scroll = new JScrollPane(this.consoleArea);
        scroll.setBorder(new LineBorder(BORDER_COLOR, 1, true));
        scroll.setPreferredSize(new Dimension(900, 580));
        scroll.getViewport().setBackground(SURFACE_BG);
        JPanel logPanel = new JPanel(new BorderLayout());
        logPanel.setOpaque(false);
        logPanel.add(scroll, BorderLayout.CENTER);
        body.add(logPanel);
        return body;
    }

    private void confirmAndClearRecords(String label, String type) {
        int first = JOptionPane.showConfirmDialog(this, I18n.tr("确定清除“" + label + "”吗？"), I18n.tr("清除确认"), JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE);
        if (first != JOptionPane.YES_OPTION) {
            return;
        }
        int second = JOptionPane.showConfirmDialog(this, I18n.tr("再次确认：清除“" + label + "”后无法恢复。"), I18n.tr("二次确认"), JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE);
        if (second != JOptionPane.YES_OPTION) {
            return;
        }
        ActivityStore.clear(type);
        if ("log".equals(type)) {
            this.consoleArea.setText("");
        }
        this.refreshStatisticsTables();
    }

    private void refreshStatisticsTables() {
        int[] counts = ActivityStore.getChestCounts();
        for (int i = 0; i < this.chestCountLabels.length; i++) {
            if (this.chestCountLabels[i] != null) {
                this.chestCountLabels[i].setText(String.valueOf(counts[i]));
            }
        }
        this.fillDropTable(this.dropTableModel, "drop");
        this.fillDropTable(this.jackpotTableModel, "jackpot");
        this.refreshDropQualitySummary();
    }

    private void refreshDropQualitySummary() {
        if (this.qualitySummaryModel == null) return;
        String[] grades = new String[]{"普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙", "未知"};
        long[] counts = ActivityStore.getDropQualityCounts();
        long total = 0L;
        for (long count : counts) total += count;
        this.qualitySummaryModel.setRowCount(0);
        for (int i = 0; i < grades.length; i++) {
            double chance = total == 0L ? 0d : counts[i] * 100d / total;
            this.qualitySummaryModel.addRow(new Object[]{grades[i], String.valueOf(counts[i]),
                    String.format(java.util.Locale.ROOT, "%.1f%%", chance)});
        }
        if (this.qualitySummaryTotalLabel != null) {
            I18n.setText(this.qualitySummaryTotalLabel, "已记录掉落：" + total + " 件");
        }
    }

    private void refreshDropEvents(JButton button) {
        button.setEnabled(false);
        I18n.setText(button, "刷新中…");
        Thread refresh = new Thread(() -> {
            String statusMessage;
            boolean connected = false;
            try {
                boolean gameOpen = User32.INSTANCE.FindWindow(null, "TaskBarHero") != null;
                String gameStatus = gameOpen ? DllApiClient.getGameStatus() : null;
                if (gameStatus == null || !gameStatus.startsWith("SUCCESS|")) {
                    statusMessage = gameOpen ? "手动刷新失败：本机接口 " + DllApiClient.getApiAddress() + " 未连接。" : "手动刷新失败：未检测到 TaskBarHero。";
                } else {
                    String scan = DllApiClient.refreshNativeGameLogSnapshot();
                    String syncSummary = this.pollAndIngestGameEvents(gameStatus);
                    ActivityStore.prune();
                    connected = true;
                    statusMessage = "手动刷新完成；" + syncSummary;
                    if (scan == null || !scan.startsWith("SUCCESS|")) {
                        statusMessage += " 原生日志重扫未完成，已读取现有事件队列。";
                    }
                }
            } catch (Exception ex) {
                statusMessage = "手动刷新失败：" + ex.getMessage();
                System.err.println("[统计] 手动刷新掉落记录失败: " + ex.getMessage());
            }
            final String finalStatusMessage = statusMessage;
            final boolean finalConnected = connected;
            SwingUtilities.invokeLater(() -> {
                button.setEnabled(true);
                I18n.setText(button, finalConnected ? "已完成" : "重试");
                if (this.statsSourceLabel != null) {
                    I18n.setText(this.statsSourceLabel, finalStatusMessage);
                    this.statsSourceLabel.setForeground(finalConnected ? CYAN_ACCENT : GOLD_ACCENT);
                }
                this.refreshStatisticsTables();
                Timer resetButton = new Timer(1800, event -> I18n.setText(button, "刷新"));
                resetButton.setRepeats(false);
                resetButton.start();
            });
        }, "tbh-drop-manual-refresh");
        refresh.setDaemon(true);
        refresh.start();
    }

    private void fillDropTable(DefaultTableModel model, String type) {
        if (model == null) {
            return;
        }
        model.setRowCount(0);
        List<ActivityStore.Entry> entries = ActivityStore.getRecent(type, 500);
        if ("jackpot".equals(type)) {
            Map<String, Object[]> grouped = new LinkedHashMap<String, Object[]>();
            for (ActivityStore.Entry entry : entries) {
                String itemName = entry.field(2);
                String quality = entry.field(3);
                String key = itemName + "\u001f" + quality;
                Object[] row = grouped.get(key);
                long quantity = parseItemCount(entry.field(6));
                if (row == null) {
                    row = new Object[]{formatTime(entry.timeMillis), displayMap(entry.field(0)),
                            entry.field(1).isEmpty() ? "宝箱未识别" : entry.field(1), quality, itemName,
                            String.valueOf(quantity)};
                    grouped.put(key, row);
                } else {
                    row[5] = String.valueOf(parseItemCount(String.valueOf(row[5])) + quantity);
                }
            }
            for (Object[] row : grouped.values()) {
                model.addRow(row);
            }
        } else {
            for (ActivityStore.Entry entry : entries) {
                model.addRow(new Object[]{formatTime(entry.timeMillis), displayMap(entry.field(0)),
                        entry.field(1).isEmpty() ? "宝箱未识别" : entry.field(1), entry.field(3), entry.field(2)});
            }
        }
    }

    private static long parseItemCount(String value) {
        try {
            return Math.max(1L, Long.parseLong(value));
        } catch (RuntimeException ignored) {
            return 1L;
        }
    }

    private static String displayMap(String stage) {
        return stage == null || stage.isEmpty() || stage.contains("{") ? "地图未识别" : stage;
    }

    private static String formatTime(long timeMillis) {
        return new SimpleDateFormat("MM-dd HH:mm:ss").format(new Date(timeMillis));
    }

    private JPanel createHelpPage() {
        JPanel body = this.createPageBody();
        JTextArea text = new JTextArea("安装与启动\n\n"
                + "1. 完整解压下载包，双击文件夹里的 TBH助手.exe 打开助手。\n"
                + "2. 打开“设置/setting”页，先退出游戏，点“一键部署”。助手会写入后台环境和插件，被覆盖的文件先备份到游戏目录下的 TBH-Backups。\n"
                + "3. 部署完成后，从 Steam 重新启动游戏，等助手顶部显示“游戏已连接”。\n"
                + "4. 首次部署后必须重启游戏，插件才会生效；以后更新助手只需要重新解压并再点一次“一键部署”。\n\n"
                + "日常使用\n\n"
                + "5. 在“合成”页设置合成规则；在“瘟疫之地”页设置地图检测、自动前往和腐蚀选项。\n"
                + "6. 点击“手动腐蚀一次”可以检查装备与材料的混合流程。\n"
                + "7. 点击“一键开启”后，地图监控、统计采集和自动任务按设置运行。\n"
                + "8. 每步点击间隔默认 5 秒；任务完成后按共用间隔排队执行，概览显示下次执行倒计时和排队冲突。日志中的每行也会显示时间。\n"
                + "9. 点击“全部关闭”或按 F8 停止任务。关闭窗口时可选择缩小到托盘，自动任务继续运行。\n\n"
                + "版本更新\n\n"
                + "10. 在“设置/setting”页点“检测更新”，助手会比对 GitHub 最新版本；有新版本时会下载并在助手退出后替换文件、自动重启。\n"
                + "11. 点“打开发布页”可在浏览器查看完整更新说明和下载包。\n\n"
                + "提示：品质上限会拦截超出设置的物品；部署和更新前请先退出游戏。");
        text.setEditable(false);
        text.setLineWrap(true);
        text.setWrapStyleWord(true);
        text.setOpaque(false);
        text.setForeground(TEXT_COLOR);
        text.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 13));
        JPanel card = ModernUI.card(new BorderLayout());
        card.setBackground(SURFACE_BG);
        card.setBorder(new EmptyBorder(18, 18, 18, 18));
        card.add(text, BorderLayout.CENTER);
        body.add(card);
        return body;
    }

    private void styleStatusPill(JLabel label) {
        label.setOpaque(false);
        label.setBackground(SURFACE_ALT);
        label.setForeground(MUTED_COLOR);
        label.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 11));
        label.setHorizontalAlignment(SwingConstants.CENTER);
        label.setBorder(new EmptyBorder(8, 12, 8, 12));
    }

    private void styleActionButton(JButton button, Color background, Color foreground) {
        button.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 13));
        button.setForeground(foreground);
        button.setBackground(background);
        button.setOpaque(false);
        button.setFocusPainted(false);
        button.setBorder(new EmptyBorder(10, 15, 10, 15));
        button.setRolloverEnabled(true);
    }

    private void updateRuntimeStatus() {
        boolean gameOpen = this.gameWindowDetected;
        boolean connected = this.pluginApiConnected;
        boolean updateNeeded = gameOpen && DllApiClient.isPluginUpdateRequired();
        boolean initialized = DllApiClient.isInitializationReady();
        String connectionText = connected ? "● 游戏已连接" : (updateNeeded ? "● 插件需更新" : (gameOpen ? "● 插件未连接" : "● 等待游戏"));
        if (this.connectionLabel != null) {
            I18n.setText(this.connectionLabel, connectionText);
            this.connectionLabel.setForeground(connected ? new Color(12, 123, 68) : (gameOpen ? GOLD_ACCENT : MUTED_COLOR));
            this.connectionLabel.setBackground(connected ? new Color(235, 248, 241) : SURFACE_ALT);
            this.connectionLabel.setToolTipText(updateNeeded ? DllApiClient.getCompatibilityMessage() : DllApiClient.getApiAddress());
        }
        if (this.initializationLabel != null) {
            String initializationText = initialized
                    ? (gameOpen ? "● 初始化完成 · 正在连接" : "● 初始化完成 · 等待游戏")
                    : (DllApiClient.isPluginUpdateRequired() ? "● 等待退出游戏后同步" : "● DLL 初始化/同步中");
            if (!this.automaticInitializationEnabled) initializationText = "● DLL 自动初始化已暂停";
            I18n.setText(this.initializationLabel, initializationText);
            this.initializationLabel.setToolTipText(I18n.tr(this.pluginInitializationStatus));
            this.initializationLabel.setForeground(initialized ? new Color(12, 123, 68) : GOLD_ACCENT);
            this.initializationLabel.setBackground(initialized ? new Color(235, 248, 241) : new Color(255, 247, 219));
            if (this.initializationLabel.isVisible() == connected) {
                this.initializationLabel.setVisible(!connected);
                this.initializationLabel.getParent().revalidate();
            }
        }
        if (this.automationStateLabel != null) {
            I18n.setText(this.automationStateLabel, this.isRunning ? "● 自动化运行中" : "● 自动化已停止");
            this.automationStateLabel.setForeground(this.isRunning ? GOLD_ACCENT : MUTED_COLOR);
            this.automationStateLabel.setBackground(this.isRunning ? new Color(255, 247, 229) : SURFACE_ALT);
        }
        if (this.overviewConnectionValue != null) {
            I18n.setText(this.overviewConnectionValue, connected ? "已连接" : (!initialized ? "DLL 同步中" : (updateNeeded ? "需部署插件" : (gameOpen ? "正在连接" : "等待游戏"))));
            this.overviewConnectionValue.setForeground(connected ? new Color(12, 123, 68) : GOLD_ACCENT);
        }
        if (this.overviewConnectionHint != null) I18n.setText(this.overviewConnectionHint, "本机接口 " + DllApiClient.getApiAddress());
        if (this.apiAddressLabel != null) I18n.setText(this.apiAddressLabel, "后台环境 / Runtime: 本机 API " + DllApiClient.getApiAddress());
        if (this.gamePathStatusLabel != null) I18n.setText(this.gamePathStatusLabel, this.pluginInitializationStatus);
        if (this.automaticUpdateStatusLabel != null) I18n.setText(this.automaticUpdateStatusLabel, this.automaticUpdateStatus);
        if (this.overviewAutomationValue != null) {
            I18n.setText(this.overviewAutomationValue, this.automationOverviewStatus());
            this.overviewAutomationValue.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 12));
            this.overviewAutomationValue.setForeground(this.automationQueueSize > 1
                    ? new Color(180, 88, 0) : GOLD_ACCENT);
            this.overviewAutomationValue.setToolTipText(this.automationQueueStatus());
        }
        if (this.overviewAutomationHint != null) {
            I18n.setText(this.overviewAutomationHint, this.isRunning
                    ? "开箱计划：普通 " + formatScheduledTime(this.nextWhiteChestAt) + " · 稀有 " + formatScheduledTime(this.nextBlueChestAt)
                    : "开箱按 CD 定时，任务冲突时排队");
        }
        if (this.overviewCorrosionValue != null) {
            int enabled = Config.Synthesis.isCorrosionEnabled ? 1 : 0;
            I18n.setText(this.overviewCorrosionValue, "已启用 " + enabled + " 项");
        }
        if (this.plaguelandsMonitorValue != null) {
            PlaguelandsTask task = this.activePlaguelandsTask;
            I18n.setText(this.plaguelandsMonitorValue, this.isRunning && Config.Global.AUTO_PLAGUELANDS_ENABLED && task != null
                    ? task.getLastResultMessage() : this.detectedPlaguelandsStatus);
        }
        if (this.footerStatusLabel != null && !this.manualCorrosionRunning) {
            I18n.setText(this.footerStatusLabel, this.isRunning
                    ? this.automationQueueCompactStatus() + " · F8 可停止"
                    : (DllApiClient.isInitializationReady() ? this.lastCorrosionStatus : this.pluginInitializationStatus));
        }
    }

    private void startPluginInitialization() {
        Thread initializer = new Thread(() -> {
            String lastMessage = "";
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    if (this.automaticInitializationEnabled) {
                        DeployManager.Initialization result = DeployManager.initializeOnStartup();
                        this.pluginInitializationStatus = result.message;
                        DllApiClient.setInitializationState(result.ready, result.waitForExit, result.message);
                        if (this.gamePathField != null
                                && Config.UserData.GAME_PATH != null && !Config.UserData.GAME_PATH.isEmpty()) {
                            SwingUtilities.invokeLater(() -> {
                                if (this.gamePathField.getText().trim().isEmpty()) this.gamePathField.setText(Config.UserData.GAME_PATH);
                            });
                        }
                        if (!lastMessage.equals(result.message)) {
                            System.out.println(">>> [启动初始化] " + result.message);
                            lastMessage = result.message;
                        }
                    }
                    Thread.sleep(3000L);
                } catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
                catch (Exception ex) {
                    this.pluginInitializationStatus = "DLL 自动初始化失败：" + ex.getMessage();
                    DllApiClient.setInitializationState(false, false, this.pluginInitializationStatus);
                }
            }
        }, "tbh-plugin-initializer");
        initializer.setDaemon(true);
        initializer.start();
    }

    private void startCorrosionMonitor() {
        Thread monitor = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    boolean gameOpen = User32.INSTANCE.FindWindow(null, "TaskBarHero") != null;
                    if (gameOpen) {
                        String display;
                        String capacity;
                        String pluginStatus = DllApiClient.getGameStatus();
                        if (pluginStatus == null || !pluginStatus.startsWith("SUCCESS|")) {
                            display = "游戏插件 API " + DllApiClient.getApiAddress() + " 未连接；污染度与仓库数据暂不可用";
                            capacity = "API 未连接";
                        } else {
                            MonitorStatus status = DllApiClient.getMonitorStatus();
                            display = status.displayText(Config.Synthesis.CORROSION_POLLUTION_THRESHOLD,
                                    Config.Synthesis.CORROSION_WAREHOUSE_THRESHOLD_PERCENT);
                            capacity = status.isReady()
                                    ? status.warehouseUsed + "/" + status.warehouseCapacity + "格（" + String.format(java.util.Locale.ROOT, "%.1f%%", status.warehousePercent) + "）"
                                    : "读取中";
                        }
                        SwingUtilities.invokeLater(() -> {
                            if (this.corrosionMonitorValue != null) {
                                I18n.setText(this.corrosionMonitorValue, display);
                            }
                            if (this.warehouseCapacityLabel != null) {
                                I18n.setText(this.warehouseCapacityLabel, capacity);
                            }
                        });
                    } else {
                        SwingUtilities.invokeLater(() -> {
                            if (this.corrosionMonitorValue != null) {
                                I18n.setText(this.corrosionMonitorValue, "监控等待游戏连接");
                            }
                            if (this.warehouseCapacityLabel != null) {
                                I18n.setText(this.warehouseCapacityLabel, "等待游戏连接");
                            }
                        });
                    }
                    Thread.sleep(10000L);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Exception e) {
                    System.err.println("[监控] 状态读取失败: " + e.getMessage());
                    try {
                        Thread.sleep(10000L);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }, "tbh-corrosion-monitor");
        monitor.setDaemon(true);
        monitor.start();
    }

    private void runManualCorrosion() {
        if (this.isRunning || this.manualCorrosionRunning) {
            JOptionPane.showMessageDialog(this, I18n.tr("请先停止自动任务，再执行单次腐蚀。"), I18n.tr("任务正在运行"), JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        if (!this.saveSettings()) {
            JOptionPane.showMessageDialog(this, I18n.tr("保存设置失败，单次腐蚀未启动。"), I18n.tr("设置错误"), JOptionPane.ERROR_MESSAGE);
            return;
        }
        String pluginStatus = DllApiClient.getGameStatus();
        if (pluginStatus == null || !pluginStatus.startsWith("SUCCESS|")) {
            JOptionPane.showMessageDialog(this, I18n.tr("游戏插件 API 未连接。请确认游戏已加载当前插件，并检查 BepInEx 日志中的监听地址与端口冲突。")
                    + "\n本机接口：" + DllApiClient.getApiAddress(), I18n.tr("游戏 API 未连接"), JOptionPane.WARNING_MESSAGE);
            return;
        }
        this.manualCorrosionRunning = true;
        this.updateManualCorrosionButtons();
        this.lastCorrosionStatus = "手动腐蚀中…";
        SwingUtilities.invokeLater(this::updateRuntimeStatus);
        Thread worker = new Thread(() -> {
            CorrosionTask task = new CorrosionTask();
            String outcome = "腐蚀结束，请查看运行日志。";
            try {
                task.executeOnce();
                outcome = task.getLastResultMessage();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                outcome = "腐蚀已中断。";
            } catch (Exception e) {
                System.err.println("[手动混合腐蚀异常] " + e.getMessage());
                outcome = "腐蚀失败：" + e.getMessage();
            } finally {
                String finalOutcome = outcome;
                this.manualCorrosionRunning = false;
                SwingUtilities.invokeLater(() -> {
                    this.lastCorrosionStatus = finalOutcome;
                    this.updateManualCorrosionButtons();
                    this.updateRuntimeStatus();
                });
            }
        }, "tbh-manual-corrosion");
        worker.setDaemon(true);
        worker.start();
    }

    private void updateManualCorrosionButtons() {
        boolean enabled = !this.isRunning && !this.manualCorrosionRunning;
        String tooltip = enabled
                ? "按当前混合腐蚀设置执行一轮。"
                : this.isRunning
                        ? "自动任务正在运行。请点击“全部关闭”或按 F8 停止后再手动腐蚀。"
                        : "单次腐蚀正在执行，请等待完成。";
        if (this.manualCorrosionBtn != null) {
            this.manualCorrosionBtn.setEnabled(enabled);
            this.manualCorrosionBtn.setToolTipText(tooltip);
        }
    }

    private JPanel createModulePanel(String title, JPanel content) {
        content.setOpaque(false);
        JPanel card = ModernUI.card(new BorderLayout(0, 12));
        card.setBackground(SURFACE_BG);
        card.setBorder(new EmptyBorder(19, 20, 20, 20));
        card.setAlignmentX(Component.LEFT_ALIGNMENT);
        JLabel heading = new JLabel(title);
        heading.setForeground(TEXT_COLOR);
        heading.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 15));
        JPanel titleRow = new JPanel(new BorderLayout(11, 0));
        titleRow.setOpaque(false);
        JPanel accent = new JPanel();
        accent.setBackground(CYAN_ACCENT);
        accent.setPreferredSize(new Dimension(Math.max(3, (int)Math.round(3 * APP_SCALE)), Math.max(18, (int)Math.round(18 * APP_SCALE))));
        titleRow.add(accent, BorderLayout.WEST);
        titleRow.add(heading, BorderLayout.CENTER);
        card.add(titleRow, BorderLayout.NORTH);
        card.add(content, BorderLayout.CENTER);
        card.setMaximumSize(new Dimension(Integer.MAX_VALUE, card.getPreferredSize().height));
        return card;
    }

    private JPanel createResourcePanel() {
        JPanel p = new JPanel(new GridLayout(4, 2, 5, 5));
        p.setOpaque(false);
        this.blueCdField = new JTextField(String.valueOf(Config.Chest.COOL_DOWN_BLUE_MS / 60000L));
        this.whiteCdField = new JTextField(String.valueOf(Config.Chest.COOL_DOWN_WHITE_MS / 60000L));
        this.storeCdField = new JTextField(String.valueOf(Config.Store.COOL_DOWN_STORE_MS / 60000L));
        this.warehouseCapacityLabel = new JLabel("读取中");
        p.add(new JLabel("\u84dd\u7bb1CD(\u5206):"));
        p.add(this.blueCdField);
        p.add(new JLabel("\u767d\u7bb1CD(\u5206):"));
        p.add(this.whiteCdField);
        p.add(new JLabel("\u6574\u7406\u4ed3\u5e93CD(\u5206):"));
        p.add(this.storeCdField);
        p.add(new JLabel("\u4ed3\u5e93\u5bb9\u91cf:"));
        p.add(this.warehouseCapacityLabel);
        return p;
    }

    private JPanel createSynthesisPanel() {
        JPanel outerPanel = new JPanel(new GridLayout(1, 2, 0, 0));
        outerPanel.setOpaque(false);
        outerPanel.setBorder(new EmptyBorder(5, 5, 5, 5));
        String[] GRADE_OPTIONS = new String[]{"\u666e\u901a", "\u7f55\u89c1", "\u7a00\u6709", "\u4f20\u8bf4", "\u4e0d\u673d", "\u81f3\u5b9d", "\u8d85\u51e1", "\u5929\u754c", "\u795e\u5723", "\u5b87\u5b99"};
        JPanel equipPanel = new JPanel();
        equipPanel.setOpaque(false);
        equipPanel.setLayout(new BoxLayout(equipPanel, 1));
        equipPanel.setBorder(new EmptyBorder(0, 0, 0, 15));
        this.synthesisEnabledCheck = new JCheckBox("\u3010\u88c5\u5907\u3011\u542f\u7528\u5408\u6210", Config.Synthesis.isAutoSynthesisEnabled);
        this.warehouseCheck = new JCheckBox("\u3010\u88c5\u5907\u3011\u5305\u542b\u4ed3\u5e93", Config.Synthesis.useWarehouse);
        this.useLevelCheck = new JCheckBox("\u3010\u88c5\u5907\u3011\u6307\u5b9a\u7b49\u7ea7", Config.Synthesis.useSynthesisLevel);
        this.synthGradeBox = new JComboBox<String>(new String[]{"1-10", "10-20", "15-30", "20-40", "30-50", "40-65", "50-65", "65-80", "80-90"});
        this.synthGradeBox.setSelectedItem(Config.Synthesis.targetSynthesisGrade);
        this.synthCdField = new JTextField(String.valueOf(Config.Synthesis.COOL_DOWN_SYNTHESIS_MS / 60000L), 5);
        JPanel levelRow = new JPanel(new FlowLayout(0, 0, 0));
        levelRow.setOpaque(false);
        levelRow.add(this.useLevelCheck);
        levelRow.add(Box.createRigidArea(new Dimension(5, 0)));
        levelRow.add(this.synthGradeBox);
        JPanel equipLimitRow = new JPanel(new FlowLayout(0, 0, 0));
        equipLimitRow.setOpaque(false);
        equipLimitRow.add(Box.createRigidArea(new Dimension(4, 0)));
        equipLimitRow.add(new JLabel("\u6700\u9ad8\u6d88\u8017\u54c1\u8d28:"));
        equipLimitRow.add(Box.createRigidArea(new Dimension(5, 0)));
        this.equipMaxGradeBox = new JComboBox<String>(GRADE_OPTIONS);
        int eGrade = Math.max(0, Math.min(9, Config.Synthesis.equipMaxGrade));
        this.equipMaxGradeBox.setSelectedIndex(eGrade);
        equipLimitRow.add(this.equipMaxGradeBox);
        JPanel cdRow = new JPanel(new FlowLayout(0, 0, 0));
        cdRow.setOpaque(false);
        cdRow.add(Box.createRigidArea(new Dimension(4, 0)));
        cdRow.add(new JLabel("\u88c5\u5907\u5408\u6210CD(\u5206):"));
        cdRow.add(Box.createRigidArea(new Dimension(5, 0)));
        cdRow.add(this.synthCdField);
        this.synthesisEnabledCheck.setAlignmentX(0.0f);
        this.warehouseCheck.setAlignmentX(0.0f);
        levelRow.setAlignmentX(0.0f);
        equipLimitRow.setAlignmentX(0.0f);
        cdRow.setAlignmentX(0.0f);
        equipPanel.add(this.synthesisEnabledCheck);
        equipPanel.add(Box.createRigidArea(new Dimension(0, 6)));
        equipPanel.add(this.warehouseCheck);
        equipPanel.add(Box.createRigidArea(new Dimension(0, 6)));
        equipPanel.add(levelRow);
        equipPanel.add(Box.createRigidArea(new Dimension(0, 6)));
        equipPanel.add(equipLimitRow);
        equipPanel.add(Box.createRigidArea(new Dimension(0, 6)));
        equipPanel.add(cdRow);
        equipPanel.add(Box.createVerticalGlue());
        JPanel materialPanel = new JPanel();
        materialPanel.setOpaque(false);
        materialPanel.setLayout(new BoxLayout(materialPanel, 1));
        materialPanel.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createMatteBorder(0, 1, 0, 0, UIManager.getColor("Component.borderColor")), new EmptyBorder(0, 15, 0, 0)));
        this.materialSynthEnabledCheck = new JCheckBox("\u3010\u6750\u6599\u3011\u542f\u7528\u5408\u6210", Config.Synthesis.isMaterialSynthesisEnabled);
        this.materialWarehouseCheck = new JCheckBox("\u3010\u6750\u6599\u3011\u5305\u542b\u4ed3\u5e93", Config.Synthesis.materialUseWarehouse);
        this.materialSynthCdField = new JTextField(String.valueOf(Config.Synthesis.COOL_DOWN_MATERIAL_SYNTHESIS_MS / 60000L), 5);
        JPanel materialLimitRow = new JPanel(new FlowLayout(0, 0, 0));
        materialLimitRow.setOpaque(false);
        materialLimitRow.add(Box.createRigidArea(new Dimension(4, 0)));
        materialLimitRow.add(new JLabel("\u6700\u9ad8\u6d88\u8017\u54c1\u8d28:"));
        materialLimitRow.add(Box.createRigidArea(new Dimension(5, 0)));
        this.materialMaxGradeBox = new JComboBox<String>(GRADE_OPTIONS);
        int mGrade = Math.max(0, Math.min(9, Config.Synthesis.materialMaxGrade));
        this.materialMaxGradeBox.setSelectedIndex(mGrade);
        materialLimitRow.add(this.materialMaxGradeBox);
        JPanel materialCdRow = new JPanel(new FlowLayout(0, 0, 0));
        materialCdRow.setOpaque(false);
        materialCdRow.add(Box.createRigidArea(new Dimension(4, 0)));
        materialCdRow.add(new JLabel("\u6750\u6599\u5408\u6210CD(\u5206):"));
        materialCdRow.add(Box.createRigidArea(new Dimension(5, 0)));
        materialCdRow.add(this.materialSynthCdField);
        this.materialSynthEnabledCheck.setAlignmentX(0.0f);
        this.materialWarehouseCheck.setAlignmentX(0.0f);
        materialLimitRow.setAlignmentX(0.0f);
        materialCdRow.setAlignmentX(0.0f);
        materialPanel.add(this.materialSynthEnabledCheck);
        materialPanel.add(Box.createRigidArea(new Dimension(0, 6)));
        materialPanel.add(this.materialWarehouseCheck);
        materialPanel.add(Box.createRigidArea(new Dimension(0, 6)));
        materialPanel.add(materialLimitRow);
        materialPanel.add(Box.createRigidArea(new Dimension(0, 6)));
        materialPanel.add(materialCdRow);
        materialPanel.add(Box.createVerticalGlue());
        outerPanel.add(equipPanel);
        outerPanel.add(materialPanel);
        return outerPanel;
    }

    private JPanel createOperationPacingPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 8));
        panel.setOpaque(false);
        JPanel rows = new JPanel();
        rows.setOpaque(false);
        rows.setLayout(new BoxLayout(rows, BoxLayout.Y_AXIS));
        JPanel clickRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        clickRow.setOpaque(false);
        clickRow.add(new JLabel("每步点击间隔（秒）："));
        this.clickGapSpinner = new JSpinner(new SpinnerNumberModel(Config.Safety.CLICK_GAP_SECONDS, 1, 300, 1));
        clickRow.add(this.clickGapSpinner);
        JPanel taskRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        taskRow.setOpaque(false);
        taskRow.add(new JLabel("任务完成后的共用排队间隔（秒，最低3秒）："));
        this.operationGapSpinner = new JSpinner(new SpinnerNumberModel(Config.Safety.ACTION_GAP_SECONDS, 3, 300, 1));
        taskRow.add(this.operationGapSpinner);
        rows.add(clickRow);
        rows.add(Box.createRigidArea(new Dimension(0, 6)));
        rows.add(taskRow);
        JLabel note = new JLabel("每项任务完成后才开始共用间隔；开箱、合成、腐蚀等到期任务按队列逐项执行。库存或动画未稳定时会继续等待。");
        note.setForeground(MUTED_COLOR);
        note.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        panel.add(rows, BorderLayout.NORTH);
        panel.add(note, BorderLayout.CENTER);
        return panel;
    }

    private JPanel createPlaguelandsPanel() {
        JPanel panel = new JPanel();
        panel.setOpaque(false);
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        this.autoPlagueEnabledCheck = new JCheckBox("启用地图检测与自动前往");
        this.autoPlagueEnabledCheck.setSelected(Config.Global.AUTO_PLAGUELANDS_ENABLED);
        this.plaguelandsMonitorValue = new JLabel("等待游戏地图数据");
        this.plaguelandsMonitorValue.setForeground(CYAN_ACCENT);
        this.plaguelandsMonitorValue.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 12));

        JPanel settings = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 0));
        settings.setOpaque(false);
        settings.add(new JLabel("目标地图等级：瘟疫之地"));
        this.plagueTargetSpinner = new JSpinner(new SpinnerNumberModel(Config.Global.PLAGUELANDS_TARGET_LEVEL, 1, 20, 1));
        settings.add(this.plagueTargetSpinner);
        settings.add(new JLabel("检测间隔（分钟）："));
        this.plagueIntervalSpinner = new JSpinner(new SpinnerNumberModel(Config.Global.PLAGUELANDS_CHECK_INTERVAL_MIN, 1, 1440, 1));
        settings.add(this.plagueIntervalSpinner);

        JTextArea note = new JTextArea("检测到当前地图不在瘟疫之地时，助手会尝试打开地图并进入所选等级；游戏未提供地图信息时会等待下一轮检测。");
        note.setEditable(false);
        note.setLineWrap(true);
        note.setWrapStyleWord(true);
        note.setOpaque(false);
        note.setForeground(MUTED_COLOR);
        note.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        note.setAlignmentX(Component.LEFT_ALIGNMENT);
        this.autoPlagueEnabledCheck.setAlignmentX(Component.LEFT_ALIGNMENT);
        this.plaguelandsMonitorValue.setAlignmentX(Component.LEFT_ALIGNMENT);
        settings.setAlignmentX(Component.LEFT_ALIGNMENT);
        panel.add(this.autoPlagueEnabledCheck);
        panel.add(Box.createRigidArea(new Dimension(0, 8)));
        panel.add(settings);
        panel.add(Box.createRigidArea(new Dimension(0, 8)));
        panel.add(this.plaguelandsMonitorValue);
        panel.add(Box.createRigidArea(new Dimension(0, 6)));
        panel.add(note);
        return panel;
    }

    private JPanel createCorrosionPanel() {
        JPanel outerPanel = new JPanel(new BorderLayout());
        outerPanel.setOpaque(false);
        outerPanel.setBorder(new EmptyBorder(8, 8, 8, 8));

        JPanel settings = new JPanel();
        settings.setOpaque(false);
        settings.setLayout(new BoxLayout(settings, BoxLayout.Y_AXIS));
        settings.setBorder(new EmptyBorder(0, 0, 0, 15));
        settings.setAlignmentX(Component.LEFT_ALIGNMENT);

        String[] gradeOptions = new String[]{"普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙"};
        this.corrosionEnabledCheck = new JCheckBox("启用污染度/仓库阈值自动腐蚀", Config.Synthesis.isCorrosionEnabled);
        this.corrosionWarehouseCheck = new JCheckBox("包含仓库物品", Config.Synthesis.corrosionUseWarehouse);
        this.corrosionExcludeInscriptionScrollsCheck = new JCheckBox(
                "排除铭刻材料：铭文卷轴（不限品质）", Config.Synthesis.corrosionExcludeInscriptionScrolls);
        this.corrosionExcludeInscriptionScrollsCheck.setToolTipText("仅按道具名称中的“铭文卷轴”识别铭刻材料。");
        this.corrosionExcludeOfferingCoinsCheck = new JCheckBox(
                "排除供奉材料：纪念币（不限品质）", Config.Synthesis.corrosionExcludeOfferingCoins);
        this.corrosionExcludeOfferingCoinsCheck.setToolTipText("仅按道具名称中的“纪念币”识别供奉材料。");
        this.corrosionMonitorValue = new JLabel("监控等待游戏连接");
        this.corrosionMonitorValue.setForeground(CYAN_ACCENT);
        this.corrosionMonitorValue.setFont(scaledFont("Microsoft YaHei UI", Font.BOLD, 12));

        JPanel thresholdRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        thresholdRow.setOpaque(false);
        thresholdRow.add(new JLabel("污染度目标值:"));
        this.corrosionPollutionThresholdField = new JTextField(String.valueOf(Config.Synthesis.CORROSION_POLLUTION_THRESHOLD), 5);
        thresholdRow.add(this.corrosionPollutionThresholdField);
        thresholdRow.add(new JLabel("仓库负载目标(%):"));
        this.corrosionWarehouseThresholdField = new JTextField(String.valueOf(Config.Synthesis.CORROSION_WAREHOUSE_THRESHOLD_PERCENT), 4);
        thresholdRow.add(this.corrosionWarehouseThresholdField);

        JPanel limitRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        limitRow.setOpaque(false);
        limitRow.add(new JLabel("最高消耗品质:"));
        limitRow.add(Box.createRigidArea(new Dimension(5, 0)));
        this.corrosionMaxGradeBox = new JComboBox<String>(gradeOptions);
        this.corrosionMaxGradeBox.setSelectedIndex(Math.max(0, Math.min(9, Config.Synthesis.corrosionMaxGrade)));
        limitRow.add(this.corrosionMaxGradeBox);

        JPanel cdRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        cdRow.setOpaque(false);
        cdRow.add(new JLabel("自动批次间隔（秒，10～120）："));
        cdRow.add(Box.createRigidArea(new Dimension(5, 0)));
        this.corrosionCdField = new JSpinner(new SpinnerNumberModel(CorrosionTiming.clamp(Config.Synthesis.CORROSION_AUTO_INTERVAL_SEC), 10, 120, 1));
        cdRow.add(this.corrosionCdField);

        this.corrosionEnabledCheck.setAlignmentX(Component.LEFT_ALIGNMENT);
        this.corrosionWarehouseCheck.setAlignmentX(Component.LEFT_ALIGNMENT);
        this.corrosionExcludeInscriptionScrollsCheck.setAlignmentX(Component.LEFT_ALIGNMENT);
        this.corrosionExcludeOfferingCoinsCheck.setAlignmentX(Component.LEFT_ALIGNMENT);
        thresholdRow.setAlignmentX(Component.LEFT_ALIGNMENT);
        limitRow.setAlignmentX(Component.LEFT_ALIGNMENT);
        cdRow.setAlignmentX(Component.LEFT_ALIGNMENT);
        settings.add(this.corrosionEnabledCheck);
        settings.add(Box.createRigidArea(new Dimension(0, 8)));
        settings.add(this.corrosionWarehouseCheck);
        settings.add(Box.createRigidArea(new Dimension(0, 8)));
        settings.add(this.corrosionExcludeInscriptionScrollsCheck);
        settings.add(Box.createRigidArea(new Dimension(0, 8)));
        settings.add(this.corrosionExcludeOfferingCoinsCheck);
        settings.add(Box.createRigidArea(new Dimension(0, 8)));
        settings.add(this.corrosionMonitorValue);
        settings.add(Box.createRigidArea(new Dimension(0, 8)));
        settings.add(thresholdRow);
        settings.add(Box.createRigidArea(new Dimension(0, 8)));
        settings.add(limitRow);
        settings.add(Box.createRigidArea(new Dimension(0, 8)));
        settings.add(cdRow);
        settings.add(Box.createRigidArea(new Dimension(0, 14)));
        JTextArea rule = new JTextArea("污染度达到目标值或仓库负载达到目标比例时按间隔腐蚀；污染度高于目标值且仓库负载低于目标比例时暂停。仓库比例按实际已用格数和总格数计算；勾选“包含仓库”后腐蚀会从仓库取物。");
        rule.setEditable(false);
        rule.setLineWrap(true);
        rule.setWrapStyleWord(true);
        rule.setOpaque(false);
        rule.setForeground(MUTED_COLOR);
        rule.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 10));
        rule.setAlignmentX(Component.LEFT_ALIGNMENT);
        rule.setMaximumSize(new Dimension(760, 54));
        settings.add(rule);
        settings.add(Box.createRigidArea(new Dimension(0, 10)));

        this.manualCorrosionBtn = new ModernUI.ActionButton("手动腐蚀一次");
        this.styleActionButton(this.manualCorrosionBtn, CYAN_ACCENT, Color.WHITE);
        this.manualCorrosionBtn.addActionListener(e -> this.runManualCorrosion());
        this.manualCorrosionBtn.setAlignmentX(Component.LEFT_ALIGNMENT);
        settings.add(this.manualCorrosionBtn);
        settings.add(Box.createVerticalGlue());
        outerPanel.add(settings, BorderLayout.NORTH);
        return outerPanel;
    }

    private JPanel createSystemSettingsPanel() {
        JPanel p = new JPanel(new GridBagLayout());
        p.setOpaque(false);
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.fill = 2;
        gbc.insets = new Insets(10, 5, 10, 5);
        gbc.gridx = 0;
        gbc.gridy = 0;
        gbc.weightx = 0.0;
        p.add((Component)new JLabel("\u5168\u5c40\u56fe\u50cf\u8bc6\u522b\u7cbe\u5ea6 (0.5~0.99):"), gbc);
        this.thresholdField = new JTextField(String.valueOf(Config.Global.MATCH_THRESHOLD));
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add((Component)this.thresholdField, gbc);
        gbc.gridx = 0;
        gbc.gridy = 1;
        gbc.weightx = 0.0;
        p.add((Component)new JLabel("\u6e38\u620f\u5185UI\u7f29\u653e\u500d\u7387:"), gbc);
        this.gameScaleBox = new JComboBox<String>(new String[]{"1.0", "1.5", "2.0"});
        this.gameScaleBox.setSelectedItem(String.valueOf(Config.Global.GAME_UI_SCALE));
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add(this.gameScaleBox, gbc);
        gbc.gridx = 0;
        gbc.gridy = 2;
        gbc.weightx = 0.0;
        p.add((Component)new JLabel("\u811a\u672c\u754c\u9762\u5927\u5c0f (\u9700\u91cd\u542f\u754c\u9762):"), gbc);
        this.appScaleBox = new JComboBox<String>(new String[]{"1.0", "1.5", "2.0", "2.5"});
        this.appScaleBox.setSelectedItem(String.valueOf(APP_SCALE));
        this.appScaleBox.addActionListener(e -> {
            if (this.isRunning) {
                SwingUtilities.invokeLater(() -> {
                    JOptionPane.showMessageDialog(this, I18n.tr("\u6302\u673a\u8fd0\u884c\u671f\u95f4\u65e0\u6cd5\u4fee\u6539\u754c\u9762\u5927\u5c0f\uff0c\u8bf7\u5148\u505c\u6b62\uff01"), I18n.tr("\u64cd\u4f5c\u88ab\u62d2\u7edd"), 2);
                    this.appScaleBox.setSelectedItem(String.valueOf(APP_SCALE));
                });
                return;
            }
            String selected = (String)this.appScaleBox.getSelectedItem();
            double newScale = Double.parseDouble(selected);
            if (newScale != APP_SCALE) {
                SwingUtilities.invokeLater(() -> {
                    int choice = JOptionPane.showConfirmDialog(this, I18n.tr("\u786e\u5b9a\u4fee\u6539\u7f29\u653e\u6bd4\u4f8b\u4e3a " + selected + " \u5417\uff1f\n(\u7acb\u523b\u4fdd\u5b58\u5e76\u5237\u65b0)"), I18n.tr("\u4fee\u6539\u754c\u9762\u5927\u5c0f"), 0, 3);
                    if (choice == 0) {
                        APP_SCALE = newScale;
                        this.saveSettings();
                        System.setProperty("flatlaf.uiScale", String.valueOf(APP_SCALE));
                        FlatLightLaf.setup();
                        applyVisualDefaults();
                        this.dispose();
                        SwingUtilities.invokeLater(() -> new MainGUI().setVisible(true));
                    } else {
                        this.appScaleBox.setSelectedItem(String.valueOf(APP_SCALE));
                    }
                });
            }
        });
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add(this.appScaleBox, gbc);
        gbc.gridx = 0;
        gbc.gridy = 3;
        gbc.weightx = 0.0;
        p.add((Component)new JLabel("\u5168\u5c40\u81ea\u52a8\u5316\u5f15\u64ce:"), gbc);
        this.useApiCheckBox = new JCheckBox("\u542f\u7528\u540e\u53f0\u6a21\u5f0f", Config.Global.USE_BACKGROUND);
        this.useApiCheckBox.addActionListener(e -> {
            if (this.useApiCheckBox.isSelected()) {
                String gamePath = Config.UserData.GAME_PATH;
                boolean isDeployed = gamePath != null && !gamePath.isEmpty() && new File(gamePath, "winhttp.dll").exists();
                if (!isDeployed) {
                    JOptionPane.showMessageDialog(this, I18n.tr("\u5c1a\u672a\u68c0\u6d4b\u5230\u540e\u53f0\u5e95\u5c42\u73af\u5883\uff0c\u65e0\u6cd5\u542f\u7528\u540e\u53f0\u6a21\u5f0f\uff01\n\n\ud83d\udc49 \u8bf7\u5148\u786e\u4fdd\u6e38\u620f\u6b63\u5728\u8fd0\u884c\uff0c\u7136\u540e\u70b9\u51fb\u3010\u4e00\u952e\u90e8\u7f72\u3011\u3002"), I18n.tr("\u73af\u5883\u7f3a\u5931"), 2);
                    this.useApiCheckBox.setSelected(false);
                    return;
                }
            }
        });
        if (Config.Global.USE_BACKGROUND) {
            String gamePath = Config.UserData.GAME_PATH;
            boolean isDeployed = gamePath != null && !gamePath.isEmpty() && new File(gamePath, "winhttp.dll").exists();
            if (!isDeployed) {
                this.useApiCheckBox.setSelected(false);
                Config.Global.USE_BACKGROUND = false;
            }
        }
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add((Component)this.useApiCheckBox, gbc);
        // 保存流程使用这些控件的当前值，界面显示引擎和背景信息。
        p.removeAll();
        gbc.gridy = 0;
        gbc.gridx = 0;
        gbc.weightx = 0;
        p.add(new JLabel("语言 / Language"), gbc);
        JComboBox<String> language = new JComboBox<String>(new String[]{"简体中文 / Chinese", "English / 英语"});
        language.putClientProperty(I18n.IGNORE, Boolean.TRUE);
        language.setSelectedIndex("en".equals(UiPreferences.language()) ? 1 : 0);
        gbc.gridx = 1;
        gbc.weightx = 1;
        p.add(language, gbc);
        language.addActionListener(event -> {
            String selected = language.getSelectedIndex() == 1 ? "en" : "zh";
            if (selected.equals(UiPreferences.language())) return;
            try { UiPreferences.setLanguage(selected); }
            catch (java.io.IOException ex) {
                language.setSelectedIndex("en".equals(UiPreferences.language()) ? 1 : 0);
                JOptionPane.showMessageDialog(this, I18n.tr("保存失败 / Save failed: " + ex.getMessage()));
            }
        });
        gbc.gridy = 1;
        gbc.gridx = 0;
        gbc.weightx = 0;
        p.add(new JLabel("关闭按钮 / Close button"), gbc);
        JComboBox<String> close = new JComboBox<String>(new String[]{"缩小至托盘 / Minimize to tray", "直接退出 / Exit immediately", "每次询问 / Ask every time"});
        close.putClientProperty(I18n.IGNORE, Boolean.TRUE);
        String[] closeValues = {"tray", "exit", "ask"};
        close.setSelectedIndex("exit".equals(UiPreferences.closeAction()) ? 1 : "ask".equals(UiPreferences.closeAction()) ? 2 : 0);
        gbc.gridx = 1;
        gbc.weightx = 1;
        p.add(close, gbc);
        close.addActionListener(event -> {
            String selected = closeValues[close.getSelectedIndex()];
            if (selected.equals(UiPreferences.closeAction())) return;
            try { UiPreferences.setCloseAction(selected); }
            catch (java.io.IOException ex) {
                close.setSelectedIndex("exit".equals(UiPreferences.closeAction()) ? 1 : "ask".equals(UiPreferences.closeAction()) ? 2 : 0);
                JOptionPane.showMessageDialog(this, I18n.tr("保存失败 / Save failed: " + ex.getMessage()));
            }
        });
        gbc.gridy = 2;
        gbc.gridx = 0;
        gbc.gridwidth = 2;
        p.add(new JLabel("选择后立即保存，重启后继续使用。"), gbc);
        gbc.gridwidth = 1;
        gbc.gridx = 0;
        gbc.gridy = 3;
        gbc.weightx = 0.0;
        p.add(new JLabel("游戏目录 / Game folder"), gbc);
        this.gamePathField = new JTextField(Config.UserData.GAME_PATH == null ? "" : Config.UserData.GAME_PATH);
        JPanel gamePathPanel = new JPanel(new BorderLayout(8, 0));
        gamePathPanel.setOpaque(false);
        gamePathPanel.add(this.gamePathField, BorderLayout.CENTER);
        JPanel gamePathActions = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 0));
        gamePathActions.setOpaque(false);
        JButton browseGamePath = new ModernUI.ActionButton("浏览 / Browse");
        browseGamePath.addActionListener(event -> {
            javax.swing.JFileChooser chooser = new javax.swing.JFileChooser();
            chooser.setDialogTitle(I18n.tr("选择包含 TaskBarHero.exe 的游戏目录"));
            chooser.setFileSelectionMode(javax.swing.JFileChooser.DIRECTORIES_ONLY);
            chooser.setAcceptAllFileFilterUsed(false);
            String current = this.gamePathField.getText().trim();
            if (!current.isEmpty() && new File(current).isDirectory()) chooser.setCurrentDirectory(new File(current));
            if (chooser.showOpenDialog(this) == javax.swing.JFileChooser.APPROVE_OPTION) {
                this.gamePathField.setText(chooser.getSelectedFile().getAbsolutePath());
                this.saveGamePathFromField(true);
            }
        });
        JButton saveGamePath = new ModernUI.ActionButton("验证并保存");
        saveGamePath.addActionListener(event -> this.saveGamePathFromField(true));
        gamePathActions.add(browseGamePath);
        gamePathActions.add(saveGamePath);
        gamePathPanel.add(gamePathActions, BorderLayout.EAST);
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add(gamePathPanel, gbc);
        this.gamePathField.addActionListener(event -> this.saveGamePathFromField(true));
        gbc.gridx = 0;
        gbc.gridy = 4;
        gbc.gridwidth = 2;
        this.gamePathStatusLabel = new JLabel("请输入或浏览包含 TaskBarHero.exe 的游戏目录；清除前会再次校验。");
        this.gamePathStatusLabel.setForeground(MUTED_COLOR);
        p.add(this.gamePathStatusLabel, gbc);
        gbc.gridwidth = 1;
        gbc.gridx = 0;
        gbc.gridy = 5;
        gbc.weightx = 0.0;
        this.apiAddressLabel = new JLabel("后台环境 / Runtime: 本机 API " + DllApiClient.getApiAddress());
        p.add(this.apiAddressLabel, gbc);
        JPanel deployBtnPanel = new JPanel(new FlowLayout(0, 0, 0));
        deployBtnPanel.setOpaque(false);
        this.deployApiBtn = new ModernUI.ActionButton("\u4e00\u952e\u90e8\u7f72");
        this.deployApiBtn.addActionListener(e -> {
            String typedPath = this.gamePathField.getText().trim();
            if (!typedPath.isEmpty() && !this.saveGamePathFromField(true)) return;
            int choice = JOptionPane.showConfirmDialog(this, I18n.tr("将后台运行环境和插件写入游戏目录。请先退出游戏；已存在的文件会先备份。继续部署？"), I18n.tr("环境部署"), JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE);
            if (choice != 0) {
                return;
            }
            this.deployApiBtn.setEnabled(false);
            I18n.setText(this.deployApiBtn, "\u6b63\u5728\u90e8\u7f72...");
            new Thread(() -> {
                try {
                    boolean success = DeployManager.checkAndDeploy();
                    if (success) this.automaticInitializationEnabled = true;
                    SwingUtilities.invokeLater(() -> {
                        if (!success) {
                            JOptionPane.showMessageDialog(this, I18n.tr("\u90e8\u7f72\u5931\u8d25\uff01\u8bf7\u786e\u8ba4\u6e38\u620f\u5df2\u9000\u51fa\uff0c\u4e14 BepInExPackage \u4e0e\u672c\u8f6f\u4ef6\u5728\u540c\u4e00\u76ee\u5f55\u3002"), I18n.tr("\u9519\u8bef"), 0);
                        }
                    });
                }
                catch (Exception exception) {
                }
                finally {
                    SwingUtilities.invokeLater(() -> {
                        this.deployApiBtn.setEnabled(true);
                        I18n.setText(this.deployApiBtn, "\u4e00\u952e\u90e8\u7f72");
                    });
                }
            }).start();
        });
        this.uninstallApiBtn = new ModernUI.ActionButton("清除完整环境");
        this.uninstallApiBtn.addActionListener(e -> {
            if (!this.saveGamePathFromField(true)) return;
            int choice = JOptionPane.showConfirmDialog(this,
                    I18n.tr("请先退出游戏。此操作会永久删除游戏目录中的完整 BepInEx 环境，包括所有插件、配置、生成文件和启动文件；不会创建备份。继续清除？"),
                    I18n.tr("清除插件环境"), JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE);
            if (choice == 0) {
                this.stopBot();
                this.automaticInitializationEnabled = false;
                this.pluginInitializationStatus = "环境清除中，自动初始化已暂停。";
                DllApiClient.setInitializationState(false, false, this.pluginInitializationStatus);
                this.uninstallApiBtn.setEnabled(false);
                I18n.setText(this.uninstallApiBtn, "正在清除...");
                new Thread(() -> {
                    boolean removed = DeployManager.uninstall(Config.UserData.GAME_PATH);
                    this.pluginInitializationStatus = removed ? "环境已清除，本次会话的自动初始化已暂停。" : "环境清除失败，自动初始化已暂停。";
                    DllApiClient.setInitializationState(false, false, this.pluginInitializationStatus);
                    SwingUtilities.invokeLater(() -> {
                        this.uninstallApiBtn.setEnabled(true);
                        I18n.setText(this.uninstallApiBtn, "清除完整环境");
                    });
                }).start();
            }
        });
        deployBtnPanel.add(this.deployApiBtn);
        deployBtnPanel.add(Box.createRigidArea(new Dimension(10, 0)));
        deployBtnPanel.add(this.uninstallApiBtn);
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add((Component)deployBtnPanel, gbc);
        gbc.gridx = 0;
        gbc.gridy = 6;
        gbc.weightx = 0.0;
        p.add(new JLabel("版本更新 / Version:"), gbc);
        JPanel updatePanel = new JPanel(new FlowLayout(0, 0, 0));
        updatePanel.setOpaque(false);
        this.updateCheckBtn = new ModernUI.ActionButton("检测更新");
        this.updateCheckBtn.addActionListener(e -> this.runUpdateCheck());
        this.releasePageBtn = new ModernUI.ActionButton("打开发布页");
        this.releasePageBtn.addActionListener(e -> this.openReleasePage());
        updatePanel.add(this.updateCheckBtn);
        updatePanel.add(Box.createRigidArea(new Dimension(10, 0)));
        updatePanel.add(this.releasePageBtn);
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add(updatePanel, gbc);
        gbc.gridx = 0;
        gbc.gridy = 7;
        gbc.gridwidth = 2;
        p.add(new JLabel("当前版本 " + Config.Global.APP_VERSION + "；检测到新版本可直接下载并替换。"), gbc);
        gbc.gridwidth = 1;
        gbc.gridx = 0;
        gbc.gridy = 8;
        gbc.gridwidth = 2;
        this.automaticUpdateStatusLabel = new JLabel(this.automaticUpdateStatus);
        this.automaticUpdateStatusLabel.setForeground(MUTED_COLOR);
        this.automaticUpdateStatusLabel.setFont(scaledFont("Microsoft YaHei UI", Font.PLAIN, 11));
        p.add(this.automaticUpdateStatusLabel, gbc);
        gbc.gridwidth = 1;
        gbc.gridy = 9;
        gbc.weightx = 0.0;
        p.add(new JLabel("界面背景："), gbc);
        gbc.gridx = 1;
        gbc.weightx = 1.0;
        p.add(new JLabel("纯白"), gbc);
        return p;
    }

    private int enqueueDueJobs(List<AutomationJob> jobs, ArrayDeque<AutomationJob> queue,
            Set<String> queuedKeys, int startIndex) {
        List<AutomationJob> pending = new ArrayList<AutomationJob>(queue);
        for (AutomationJob job : jobs) {
            if (queuedKeys.contains(job.key) || !job.due.getAsBoolean()) continue;
            job.dueAt = job.nextAt.getAsLong();
            pending.add(job);
            queuedKeys.add(job.key);
        }
        pending.sort((a, b) -> {
            int time = Long.compare(a.dueAt, b.dueAt);
            if (time != 0) return time;
            int priority = Integer.compare(a.key.startsWith("chest-") ? 0 : 1, b.key.startsWith("chest-") ? 0 : 1);
            return priority != 0 ? priority : Integer.compare(jobs.indexOf(a), jobs.indexOf(b));
        });
        queue.clear();
        queue.addAll(pending);
        return 0;
    }

    private long earliestJobTime(List<AutomationJob> jobs) {
        AutomationJob next = earliestJob(jobs, null);
        return next == null ? Long.MAX_VALUE : next.nextAt.getAsLong();
    }

    private AutomationJob earliestJob(List<AutomationJob> jobs, String excludedKey) {
        AutomationJob earliest = null;
        long earliestAt = Long.MAX_VALUE;
        for (AutomationJob job : jobs) {
            if (excludedKey != null && excludedKey.equals(job.key)) continue;
            long at = job.nextAt.getAsLong();
            if (at == Long.MAX_VALUE) continue;
            if (at < earliestAt) {
                earliestAt = at;
                earliest = job;
            }
        }
        return earliest;
    }

    private String automationQueueStatus() {
        if (!this.isRunning) return "已停止";
        String next = this.queuedAutomationTask.isEmpty() ? "等待调度" : this.queuedAutomationTask;
        if (!this.activeAutomationTask.isEmpty()) return "执行中：" + this.activeAutomationTask + "；下一项：" + next
                + (this.automationQueueSize > 0 ? " · 排队" + this.automationQueueSize + "项" : "");
        if (this.automationQueueWaitActive) return "高频风险冲突：下一项：" + next + " · 排队倒计时 "
                + formatCountdown(this.automationNextExecutionAtMillis);
        return "待命；下一项：" + next + " · 计划 " + formatScheduledTime(this.automationNextExecutionAtMillis);
    }

    private String automationQueueCompactStatus() {
        if (!this.isRunning) return "已停止";
        if (!this.activeAutomationTask.isEmpty()) return "执行中：" + this.activeAutomationTask;
        if (this.automationQueueWaitActive) return "排队 · " + formatCountdown(this.automationNextExecutionAtMillis);
        return "待命 · 按计划运行";
    }

    private String automationOverviewStatus() {
        String current = this.activeAutomationTask.isEmpty()
                ? (this.automationQueueWaitActive ? "任务冲突，等待间隔" : "待命") : this.activeAutomationTask;
        String next = this.queuedAutomationTask.isEmpty() ? "等待调度" : this.queuedAutomationTask;
        String detail = "";
        if (!this.activeAutomationTask.isEmpty() && this.automationQueueSize > 0) detail = " · 排队中";
        else if (this.automationQueueWaitActive) detail = " · 排队 " + formatCountdown(this.automationNextExecutionAtMillis);
        else if (!this.queuedAutomationTask.isEmpty()) detail = " · 计划 " + formatScheduledTime(this.automationNextExecutionAtMillis);
        if (!this.isRunning) { current = "已停止"; next = "—"; detail = ""; }
        return "<html><div style='font-size:11pt'><b>当前：</b>" + current + "<br><b>下一项：</b>"
                + next + detail + "</div></html>";
    }

    private static String formatScheduledTime(long time) {
        return time <= 0L || time == Long.MAX_VALUE ? "—" : new SimpleDateFormat("HH:mm:ss").format(new Date(time));
    }

    private static String formatCountdown(long targetMillis) {
        if (targetMillis == Long.MAX_VALUE || targetMillis <= 0L) return "--:--";
        long seconds = Math.max(0L, (targetMillis - System.currentTimeMillis() + 999L) / 1000L);
        long hours = seconds / 3600L;
        long minutes = (seconds % 3600L) / 60L;
        long remainder = seconds % 60L;
        return hours > 0L ? String.format(java.util.Locale.ROOT, "%d:%02d:%02d", hours, minutes, remainder)
                : String.format(java.util.Locale.ROOT, "%02d:%02d", minutes, remainder);
    }

    private boolean saveGamePathFromField(boolean showError) {
        try {
            String validated = DeployManager.validateGameDirectory(this.gamePathField.getText());
            if (!Config.UserData.saveGamePath(validated)) throw new java.io.IOException("settings.properties 保存失败。");
            this.gamePathField.setText(validated);
            I18n.setText(this.gamePathStatusLabel, "游戏目录已验证并保存。");
            this.gamePathStatusLabel.setForeground(new Color(12, 123, 68));
            return true;
        } catch (Exception ex) {
            I18n.setText(this.gamePathStatusLabel, "游戏目录无效：" + ex.getMessage());
            this.gamePathStatusLabel.setForeground(new Color(176, 35, 64));
            if (showError) JOptionPane.showMessageDialog(this, I18n.tr("游戏目录无效：") + ex.getMessage(), I18n.tr("目录未确认"), JOptionPane.WARNING_MESSAGE);
            return false;
        }
    }

    /** 查询 GitHub 最新发布；有更新时询问是否直接替换。 */
    private void runUpdateCheck() {
        this.checkForUpdates(false);
    }

    private void startAutomaticUpdateChecks() {
        this.automaticUpdateScheduler = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "tbh-automatic-update");
            thread.setDaemon(true);
            return thread;
        });
        this.automaticUpdateScheduler.scheduleAtFixedRate(() -> this.checkForUpdates(true),
                2L, TimeUnit.HOURS.toSeconds(6L), TimeUnit.SECONDS);
    }

    private void checkForUpdates(boolean automatic) {
        if (this.updateInstallRunning.get() || !this.updateCheckRunning.compareAndSet(false, true)) return;
        SwingUtilities.invokeLater(() -> {
        this.updateCheckBtn.setEnabled(false);
        I18n.setText(this.updateCheckBtn, "正在检测...");
        });
        this.automaticUpdateStatus = "正在检测 GitHub 版本...";
        new Thread(() -> {
            String message;
            boolean updateAvailable = false;
            UpdateChecker.Release release = null;
            boolean failed = false;
            try {
                release = UpdateChecker.latest();
                updateAvailable = UpdateChecker.hasUpdate(release);
                message = updateAvailable
                        ? "发现新版本 " + release.tag + "（当前 " + Config.Global.APP_VERSION + "）。"
                        : "当前已是最新版本 " + Config.Global.APP_VERSION + "。";
            } catch (Exception ex) {
                failed = true;
                message = "检测更新失败：" + ex.getMessage();
            }
            String checkedAt = new SimpleDateFormat("MM-dd HH:mm").format(new Date());
            this.automaticUpdateStatus = (failed ? "自动检测暂不可用 · " : "上次检测 ") + checkedAt
                    + " · 每隔 6 小时自动检测";
            final String text = message;
            final boolean available = updateAvailable;
            final UpdateChecker.Release found = release;
            SwingUtilities.invokeLater(() -> {
                this.updateCheckRunning.set(false);
                this.updateCheckBtn.setEnabled(true);
                I18n.setText(this.updateCheckBtn, "检测更新");
                if (available && found != null) {
                    this.pendingUpdate = found;
                    I18n.setText(this.updateNoticeButton, "发现新版本 " + found.tag + " · 点击更新");
                    this.updateNoticeButton.setVisible(true);
                    this.updateNoticeButton.getParent().revalidate();
                    if (automatic && this.notifiedUpdateTags.add(found.tag)) {
                        this.desktopSupport.showNotification("TBH助手版本更新", text,
                                () -> this.offerUpdate(this.pendingUpdate));
                    }
                }
                this.updateRuntimeStatus();
                if (automatic) {
                    System.out.println(">>> [自动更新] " + text);
                    return;
                }
                if (!available || found == null) {
                    JOptionPane.showMessageDialog(this, I18n.tr(text), I18n.tr("版本更新"), JOptionPane.INFORMATION_MESSAGE);
                    return;
                }
                this.offerUpdate(found);
            });
        }, "tbh-update-check").start();
    }

    private void offerUpdate(UpdateChecker.Release release) {
        if (release == null || this.updateInstallRunning.get()) return;
        int choice = JOptionPane.showConfirmDialog(this,
                I18n.tr("发现新版本 " + release.tag + "（当前 " + Config.Global.APP_VERSION + "）。"
                        + "\n是否现在下载并更新？更新会在退出助手后替换文件并自动重启。"),
                I18n.tr("版本更新"), JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE);
        if (choice == 0) this.runUpdateApply(release);
    }

    /** 下载发布包并在助手退出后替换安装目录。 */
    private void runUpdateApply(UpdateChecker.Release release) {
        if (!this.updateInstallRunning.compareAndSet(false, true)) return;
        this.updateCheckBtn.setEnabled(false);
        this.updateNoticeButton.setEnabled(false);
        I18n.setText(this.updateCheckBtn, "正在下载...");
        new Thread(() -> {
            String error = null;
            try {
                java.nio.file.Path root = new File(System.getProperty("user.dir")).toPath().toRealPath();
                java.nio.file.Path staged = UpdateChecker.stage(release);
                UpdateChecker.applyAfterExit(root, staged);
            } catch (Exception ex) {
                error = ex.getMessage();
            }
            final String failure = error;
            SwingUtilities.invokeLater(() -> {
                if (failure != null) {
                    this.updateInstallRunning.set(false);
                    this.updateNoticeButton.setEnabled(true);
                    this.updateCheckBtn.setEnabled(true);
                    I18n.setText(this.updateCheckBtn, "检测更新");
                    JOptionPane.showMessageDialog(this, "更新失败：" + failure, I18n.tr("错误"), JOptionPane.ERROR_MESSAGE);
                    return;
                }
                JOptionPane.showMessageDialog(this,
                        "更新包已下载。助手退出后将自动替换文件并重新启动。",
                        I18n.tr("版本更新"), JOptionPane.INFORMATION_MESSAGE);
                this.exitApplication();
            });
        }, "tbh-update-apply").start();
    }

    /** 在系统浏览器打开 GitHub 最新发布页。 */
    private void openReleasePage() {
        this.openExternalLink(OFFICIAL_RELEASES_URL);
    }

    private void openExternalLink(String address) {
        try {
            if (!java.awt.Desktop.isDesktopSupported()
                    || !java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE)) {
                throw new java.io.IOException("当前系统没有可用的网页浏览器接口。");
            }
            if (!address.startsWith("https://")) throw new java.net.URISyntaxException(address, "Only HTTPS links are supported.");
            java.awt.Desktop.getDesktop().browse(java.net.URI.create(address));
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "无法打开浏览器：" + ex.getMessage()
                    + "\n" + address, I18n.tr("错误"), JOptionPane.ERROR_MESSAGE);
        }
    }

    private void startStatsRefreshTimer() {
        new Timer(1000, e -> {
            I18n.setText(this.totalBlueLbl, String.valueOf(StatsManager.totalBlue));
            I18n.setText(this.totalWhiteLbl, String.valueOf(StatsManager.totalWhite));
            I18n.setText(this.sessionBlueLbl, String.valueOf(StatsManager.sessionBlue));
            I18n.setText(this.sessionWhiteLbl, String.valueOf(StatsManager.sessionWhite));
            this.updateRuntimeStatus();
        }).start();
    }

    private void startGameEventPoller() {
        Thread poller = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    boolean gameOpen = User32.INSTANCE.FindWindow(null, "TaskBarHero") != null;
                    String gameStatus = gameOpen ? DllApiClient.getGameStatus() : null;
                    boolean pluginReady = gameStatus != null && gameStatus.startsWith("SUCCESS|");
                    this.gameWindowDetected = gameOpen;
                    this.pluginApiConnected = pluginReady;
                    String sourceStatus;
                    if (!gameOpen) {
                        sourceStatus = "等待游戏连接；新开箱和战斗事件将在连接后记录。";
                        this.detectedPlaguelandsStatus = "等待游戏连接";
                    } else if (!pluginReady) {
                        sourceStatus = DllApiClient.isPluginUpdateRequired() ? DllApiClient.getCompatibilityMessage()
                                : "游戏插件 API 未连接（" + DllApiClient.getApiAddress() + "）：检查插件加载日志和本机监听状态。";
                        this.detectedPlaguelandsStatus = "游戏 API 未连接，地图数据暂不可用";
                    } else {
                        if (System.currentTimeMillis() - this.lastGameEventPollAtMillis
                                >= GAME_EVENT_POLL_INTERVAL_MS) {
                            this.pollAndIngestGameEvents(gameStatus);
                        }
                        this.detectedPlaguelandsStatus = PlaguelandsTask.formatCurrentMap(gameStatus);
                        sourceStatus = "已连接游戏；每3秒同步新宝箱与道具日志，上次同步 "
                                + new SimpleDateFormat("HH:mm:ss").format(new Date(this.lastGameEventPollAtMillis)) + "。";
                    }
                    ActivityStore.prune();
                    String finalSourceStatus = sourceStatus;
                    SwingUtilities.invokeLater(() -> {
                        if (this.statsSourceLabel != null) {
                            I18n.setText(this.statsSourceLabel, finalSourceStatus);
                            this.statsSourceLabel.setForeground(pluginReady ? CYAN_ACCENT : GOLD_ACCENT);
                        }
                        this.refreshStatisticsTables();
                    });
                    Thread.sleep(pluginReady ? GAME_EVENT_POLL_INTERVAL_MS : 10000L);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Exception e) {
                    this.pluginApiConnected = false;
                    System.err.println("[统计] 游戏事件读取失败: " + e.getMessage());
                    try {
                        Thread.sleep(5000L);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }, "tbh-game-event-poller");
        poller.setDaemon(true);
        poller.start();
    }

    private String pollAndIngestGameEvents(String gameStatus) {
        synchronized (this.statsEventLock) {
            int eventCount = 0;
            for (int batch = 0; batch < 4; batch++) {
                String response = DllApiClient.pollGameEvents();
                if (response == null || (!"EMPTY".equals(response) && !response.startsWith("E\t"))) {
                    throw new IllegalStateException("游戏事件接口读取失败");
                }
                int batchCount = 0;
                for (String line : response.split("\\r?\\n")) {
                    if (line.startsWith("E\t")) batchCount++;
                }
                if (batchCount == 0) break;
                ActivityStore.ingestPluginEvents(response,
                        PlaguelandsTask.currentMapName(gameStatus), PlaguelandsTask.isInCombat(gameStatus));
                eventCount += batchCount;
                if (!DllApiClient.acknowledgeGameEvents(response)) {
                    System.err.println("[统计] 游戏事件已写入本地，确认回执暂未送达；下次轮询会重试。");
                    break;
                }
                if (batchCount < 256) break;
            }
            this.lastGameEventPollAtMillis = System.currentTimeMillis();
            return eventCount == 0
                    ? "没有待同步的新事件；已刷新当前统计列表。"
                    : "已同步" + eventCount + "条新事件；掉落与宝箱统计列表已刷新。";
        }
    }

    private boolean saveSettings() {
        try {
            Properties prop = new Properties();
            File file = new File("settings.properties");
            if (file.exists()) {
                try (FileInputStream in = new FileInputStream(file);){
                    prop.load(in);
                }
            }
            int pollutionThreshold = Integer.parseInt(this.corrosionPollutionThresholdField.getText().trim());
            int warehouseThreshold = Integer.parseInt(this.corrosionWarehouseThresholdField.getText().trim());
            this.corrosionCdField.commitEdit();
            int corrosionInterval = ((Number)this.corrosionCdField.getValue()).intValue();
            int clickGap = this.clickGapSpinner == null ? Config.Safety.CLICK_GAP_SECONDS
                    : ((Number)this.clickGapSpinner.getValue()).intValue();
            int operationGap = this.operationGapSpinner == null ? Config.Safety.ACTION_GAP_SECONDS
                    : ((Number)this.operationGapSpinner.getValue()).intValue();
            int blueCd = Integer.parseInt(this.blueCdField.getText().trim());
            int whiteCd = Integer.parseInt(this.whiteCdField.getText().trim());
            int storeCd = Integer.parseInt(this.storeCdField.getText().trim());
            int equipCd = Integer.parseInt(this.synthCdField.getText().trim());
            int materialCd = Integer.parseInt(this.materialSynthCdField.getText().trim());
            double matchThreshold = Double.parseDouble(this.thresholdField.getText().trim());
            if (corrosionInterval < 10 || corrosionInterval > 120 || pollutionThreshold < 0 || warehouseThreshold < 1 || warehouseThreshold > 100
                    || clickGap < 1 || clickGap > 300 || operationGap < 3 || operationGap > 300
                    || blueCd < 1 || blueCd > 1440 || whiteCd < 1 || whiteCd > 1440
                    || storeCd < 1 || storeCd > 1440 || equipCd < 1 || equipCd > 1440
                    || materialCd < 1 || materialCd > 1440 || matchThreshold < 0.5 || matchThreshold > 0.99) {
                return false;
            }
            this.corrosionCdField.setValue(corrosionInterval);
            I18n.setText(this.blueCdField, String.valueOf(blueCd));
            I18n.setText(this.whiteCdField, String.valueOf(whiteCd));
            I18n.setText(this.storeCdField, String.valueOf(storeCd));
            I18n.setText(this.synthCdField, String.valueOf(equipCd));
            I18n.setText(this.materialSynthCdField, String.valueOf(materialCd));
            I18n.setText(this.thresholdField, String.valueOf(matchThreshold));
            prop.remove("app_ui_scale");
            prop.remove("enable_auto_route");
            prop.remove("hero_level");
            prop.remove("fallback_difficulty");
            prop.remove("fallback_stage");
            prop.setProperty("match_threshold", String.valueOf(matchThreshold));
            prop.setProperty("game_ui_scale", (String)this.gameScaleBox.getSelectedItem());
            prop.setProperty("app_ui_scale_v1.3", String.valueOf(APP_SCALE));
            prop.setProperty("blue_chest_cd", String.valueOf(blueCd));
            prop.setProperty("white_chest_cd", String.valueOf(whiteCd));
            prop.setProperty("store_cd", String.valueOf(storeCd));
            prop.remove("store_max_page");
            prop.setProperty("synthesis_enabled", String.valueOf(this.synthesisEnabledCheck.isSelected()));
            prop.setProperty("synthesis_use_warehouse", String.valueOf(this.warehouseCheck.isSelected()));
            prop.setProperty("synthesis_use_level", String.valueOf(this.useLevelCheck.isSelected()));
            prop.setProperty("synthesis_target_grade", (String)this.synthGradeBox.getSelectedItem());
            prop.setProperty("synthesis_cd", String.valueOf(equipCd));
            prop.setProperty("synthesis_equip_max_grade", String.valueOf(this.equipMaxGradeBox.getSelectedIndex()));
            prop.setProperty("material_synthesis_enabled", String.valueOf(this.materialSynthEnabledCheck.isSelected()));
            prop.setProperty("material_use_warehouse", String.valueOf(this.materialWarehouseCheck.isSelected()));
            prop.setProperty("material_synthesis_cd", String.valueOf(materialCd));
            prop.setProperty("synthesis_material_max_grade", String.valueOf(this.materialMaxGradeBox.getSelectedIndex()));
            for (String key : new String[]{"corrosion_equip_enabled", "corrosion_equip_use_warehouse", "corrosion_equip_use_level", "corrosion_equip_target_grade", "corrosion_equip_cd", "corrosion_equip_max_grade", "corrosion_material_enabled", "corrosion_material_use_warehouse", "corrosion_material_cd", "corrosion_material_max_grade"}) {
                prop.remove(key);
            }
            prop.setProperty("corrosion_enabled", String.valueOf(this.corrosionEnabledCheck.isSelected()));
            prop.setProperty("corrosion_use_warehouse", String.valueOf(this.corrosionWarehouseCheck.isSelected()));
            prop.setProperty("corrosion_auto_interval_sec", String.valueOf(corrosionInterval));
            prop.setProperty("operation_gap_seconds", String.valueOf(operationGap));
            prop.setProperty("click_gap_seconds", String.valueOf(clickGap));
            prop.setProperty("corrosion_pollution_threshold", String.valueOf(pollutionThreshold));
            prop.setProperty("corrosion_warehouse_threshold_percent", String.valueOf(warehouseThreshold));
            prop.setProperty("corrosion_max_grade", String.valueOf(this.corrosionMaxGradeBox.getSelectedIndex()));
            prop.setProperty("corrosion_exclude_inscription_scrolls",
                    String.valueOf(this.corrosionExcludeInscriptionScrollsCheck.isSelected()));
            prop.setProperty("corrosion_exclude_offering_coins",
                    String.valueOf(this.corrosionExcludeOfferingCoinsCheck.isSelected()));
            int statsRetention = this.statsRetentionSpinner == null ? Config.Global.STATS_RETENTION_HOURS
                    : ActivityStore.clampHours(((Number)this.statsRetentionSpinner.getValue()).intValue());
            int logRetention = this.logsRetentionSpinner == null ? Config.Global.LOG_RETENTION_HOURS
                    : ActivityStore.clampHours(((Number)this.logsRetentionSpinner.getValue()).intValue());
            int otherRetention = this.otherRetentionSpinner == null ? this.otherRecordRetentionHours
                    : Math.max(1, ((Number)this.otherRetentionSpinner.getValue()).intValue());
            boolean keepOtherRecordsForever = this.otherRetentionPermanentCheck == null
                    ? this.otherRecordsPermanent : this.otherRetentionPermanentCheck.isSelected();
            prop.setProperty("stats_retention_hours", String.valueOf(statsRetention));
            prop.setProperty("log_retention_hours", String.valueOf(logRetention));
            prop.setProperty("other_record_retention_hours", String.valueOf(otherRetention));
            prop.setProperty("other_records_permanent", String.valueOf(keepOtherRecordsForever));
            int plagueTargetLevel = this.plagueTargetSpinner == null ? Config.Global.PLAGUELANDS_TARGET_LEVEL
                    : Math.max(1, Math.min(20, ((Number)this.plagueTargetSpinner.getValue()).intValue()));
            int plagueInterval = this.plagueIntervalSpinner == null ? Config.Global.PLAGUELANDS_CHECK_INTERVAL_MIN
                    : Math.max(1, Math.min(1440, ((Number)this.plagueIntervalSpinner.getValue()).intValue()));
            prop.setProperty("plague_auto_enabled", String.valueOf(this.autoPlagueEnabledCheck != null
                    ? this.autoPlagueEnabledCheck.isSelected() : Config.Global.AUTO_PLAGUELANDS_ENABLED));
            prop.setProperty("plague_target_level", String.valueOf(plagueTargetLevel));
            prop.setProperty("plague_check_interval_min", String.valueOf(plagueInterval));
            prop.remove("plague_check_interval_sec");
            prop.setProperty("use_background", String.valueOf(this.useApiCheckBox.isSelected()));
            if (Config.UserData.GAME_PATH != null && !Config.UserData.GAME_PATH.isEmpty()) {
                prop.setProperty("game_path", Config.UserData.GAME_PATH);
            }
            if (Config.UserData.BG_IMAGE_PATH != null) {
                prop.setProperty("bg_image_path", Config.UserData.BG_IMAGE_PATH);
            }
            try (FileOutputStream out = new FileOutputStream("settings.properties");){
                prop.store(out, null);
            }
            Config.UserData.loadSettings();
            this.otherRecordRetentionHours = otherRetention;
            this.otherRecordsPermanent = keepOtherRecordsForever;
            ActivityStore.setRetentionHours(statsRetention, logRetention, otherRetention, keepOtherRecordsForever);
            return true;
        }
        catch (Exception e) {
            return false;
        }
    }

    private void startBot() throws InterruptedException {
        if (this.manualCorrosionRunning) {
            JOptionPane.showMessageDialog(this, I18n.tr("请等待单次腐蚀结束后再启动自动任务。"), I18n.tr("任务正在运行"), JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        if (!this.saveSettings()) {
            return;
        }
        WinDef.HWND hwnd = User32.INSTANCE.FindWindow(null, "TaskBarHero");
        if (hwnd == null) {
            JOptionPane.showMessageDialog(this, I18n.tr("\u672a\u68c0\u6d4b\u5230\u6e38\u620f\u8fdb\u7a0b\uff0c\u8bf7\u5148\u6253\u5f00\u5ba2\u6237\u7aef\uff01"), I18n.tr("\u542f\u52a8\u5931\u8d25"), 0);
            return;
        }
        String pluginStatus = DllApiClient.getGameStatus();
        if (pluginStatus == null || !pluginStatus.startsWith("SUCCESS|")
                || !DllApiClient.configureOperationPacing() || !DllApiClient.configureClickPacing()) {
            JOptionPane.showMessageDialog(this, I18n.tr(DllApiClient.getCompatibilityMessage())
                    + "\n本机接口：" + DllApiClient.getApiAddress() + "\n请查看游戏目录 BepInEx/LogOutput.log 中的 HTTP 服务启动记录。",
                    I18n.tr("插件未连接"), JOptionPane.WARNING_MESSAGE);
            return;
        }
        this.startBtn.setEnabled(false);
        this.stopBtn.setEnabled(true);
        this.isRunning = true;
        this.automationQueueSize = 0;
        this.activeAutomationTask = "";
        this.queuedAutomationTask = "";
        this.automationNextExecutionAtMillis = 0L;
        this.automationQueueWaitActive = false;
        this.updateManualCorrosionButtons();
        this.updateRuntimeStatus();
        if (this.appScaleBox != null) {
            this.appScaleBox.setEnabled(false);
        }
        this.botThread = new Thread(() -> {
            try {
                ChestTask chest = new ChestTask();
                StoreTask store = new StoreTask();
                EquipmentSynthesisTask synthEquip = new EquipmentSynthesisTask();
                MaterialSynthesisTask synthMaterial = new MaterialSynthesisTask();
                CorrosionTask corrosion = new CorrosionTask();
                PlaguelandsTask plaguelands = new PlaguelandsTask();
                this.activePlaguelandsTask = plaguelands;
                List<AutomationJob> jobs = new ArrayList<AutomationJob>();
                jobs.add(new AutomationJob("chest-blue", "蓝色宝箱", chest::isBlueDue, chest::nextBlueExecutionAt, chest::executeBlue));
                jobs.add(new AutomationJob("chest-white", "普通宝箱", chest::isWhiteDue, chest::nextWhiteExecutionAt, chest::executeWhite));
                jobs.add(new AutomationJob("store", "仓库整理", store::isDue, store::nextExecutionAt, store::execute));
                jobs.add(new AutomationJob("equipment", "装备合成", synthEquip::isDue, synthEquip::nextExecutionAt, synthEquip::execute));
                jobs.add(new AutomationJob("material", "材料合成", synthMaterial::isDue, synthMaterial::nextExecutionAt, synthMaterial::execute));
                jobs.add(new AutomationJob("plague", "地图检测", plaguelands::isDue, plaguelands::nextExecutionAt, plaguelands::execute));
                jobs.add(new AutomationJob("corrosion", "腐蚀", corrosion::isDue, corrosion::nextExecutionAt, corrosion::execute));
                ArrayDeque<AutomationJob> queuedJobs = new ArrayDeque<AutomationJob>();
                Set<String> queuedKeys = new HashSet<String>();
                int priorityCursor = 0;
                long nextSharedExecutionAt = 0L;
                System.out.println("\u4efb\u52a1\u521d\u59cb\u5316\u5b8c\u6210");
                Thread.sleep(2000L);
                System.out.println(">>> [操作保护] 点击间隔=" + Config.Safety.CLICK_GAP_SECONDS + "秒；任务共用排队间隔=" + Config.Safety.ACTION_GAP_SECONDS + "秒。");
                while (this.isRunning && !Thread.currentThread().isInterrupted()) {
                    if (User32.INSTANCE.FindWindow(null, "TaskBarHero") == null) {
                        JOptionPane.showMessageDialog(null, I18n.tr("\u6e38\u620f\u610f\u5916\u5173\u95ed\uff0c\u6302\u673a\u5df2\u81ea\u52a8\u7ec8\u6b62\u3002"), I18n.tr("\u8b66\u544a"), 2);
                        break;
                    }
                    priorityCursor = this.enqueueDueJobs(jobs, queuedJobs, queuedKeys, priorityCursor);
                    long now = System.currentTimeMillis();
                    this.nextBlueChestAt = ChestTracker.nextBlueOpenAt();
                    this.nextWhiteChestAt = ChestTracker.nextWhiteOpenAt();
                    this.automationQueueSize = queuedJobs.size();
                    this.automationQueueWaitActive = !queuedJobs.isEmpty() && now < nextSharedExecutionAt;
                    if (!queuedJobs.isEmpty()) {
                        this.queuedAutomationTask = queuedJobs.peekFirst().label;
                        this.automationNextExecutionAtMillis = Math.max(nextSharedExecutionAt, now);
                    } else {
                        AutomationJob scheduled = this.earliestJob(jobs, null);
                        this.queuedAutomationTask = scheduled == null ? "" : scheduled.label;
                        long scheduledAt = scheduled == null ? Long.MAX_VALUE : scheduled.nextAt.getAsLong();
                        this.automationNextExecutionAtMillis = scheduledAt <= now ? now + 1000L : scheduledAt;
                    }
                    if (corrosion.isRecoveryPending()) {
                        queuedJobs.removeIf(job -> "corrosion".equals(job.key));
                        queuedKeys.remove("corrosion");
                        this.automationQueueSize = queuedJobs.size();
                        AutomationJob next = queuedJobs.isEmpty()
                                ? this.earliestJob(jobs, "corrosion") : queuedJobs.peekFirst();
                        this.queuedAutomationTask = next == null ? "" : next.label;
                        this.activeAutomationTask = "腐蚀动画确认";
                        this.automationNextExecutionAtMillis = queuedJobs.isEmpty()
                                ? (next == null ? Long.MAX_VALUE : next.nextAt.getAsLong())
                                : Math.max(nextSharedExecutionAt, now);
                        if (corrosion.isDue()) {
                            long sequenceBefore = DllApiClient.getActionSequence();
                            corrosion.execute();
                            if (DllApiClient.getActionSequence() > sequenceBefore) {
                                nextSharedExecutionAt = System.currentTimeMillis() + Config.Safety.ACTION_GAP_SECONDS * 1000L;
                            }
                        } else {
                            Thread.sleep(Math.min(500L, Math.max(50L, corrosion.nextExecutionAt() - now)));
                        }
                        this.activeAutomationTask = "";
                        continue;
                    }
                    this.activeAutomationTask = "";
                    if (queuedJobs.isEmpty()) {
                        long nextDue = this.earliestJobTime(jobs);
                        this.automationNextExecutionAtMillis = nextDue <= now ? now + 1000L : nextDue;
                        Thread.sleep(500L);
                        continue;
                    }
                    if (now < nextSharedExecutionAt) {
                        this.automationNextExecutionAtMillis = nextSharedExecutionAt;
                        Thread.sleep(Math.min(500L, Math.max(50L, nextSharedExecutionAt - now)));
                        continue;
                    }
                    AutomationJob job = queuedJobs.removeFirst();
                    queuedKeys.remove(job.key);
                    priorityCursor = (jobs.indexOf(job) + 1) % jobs.size();
                    this.activeAutomationTask = job.label;
                    this.automationQueueSize = queuedJobs.size();
                    AutomationJob next = queuedJobs.isEmpty()
                            ? this.earliestJob(jobs, job.key) : queuedJobs.peekFirst();
                    this.queuedAutomationTask = next == null ? "" : next.label;
                    this.automationNextExecutionAtMillis = queuedJobs.isEmpty()
                            ? (next == null ? Long.MAX_VALUE : next.nextAt.getAsLong())
                            : Math.max(nextSharedExecutionAt, now);
                    long sequenceBefore = DllApiClient.getActionSequence();
                    job.action.execute();
                    if (DllApiClient.getActionSequence() > sequenceBefore) {
                        nextSharedExecutionAt = System.currentTimeMillis() + Config.Safety.ACTION_GAP_SECONDS * 1000L;
                    }
                    this.enqueueDueJobs(jobs, queuedJobs, queuedKeys, 0);
                    this.automationQueueSize = queuedJobs.size();
                    this.automationQueueWaitActive = !queuedJobs.isEmpty() && System.currentTimeMillis() < nextSharedExecutionAt;
                    if (this.automationQueueWaitActive)
                        System.out.println(">>> [任务队列] " + job.label + " 已完成；" + queuedJobs.size() + " 项到期任务等待共用间隔。");
                    this.activeAutomationTask = "";
                    if (queuedJobs.isEmpty()) {
                        AutomationJob scheduled = this.earliestJob(jobs, null);
                        this.queuedAutomationTask = scheduled == null ? "" : scheduled.label;
                        this.automationNextExecutionAtMillis = scheduled == null
                                ? Long.MAX_VALUE : scheduled.nextAt.getAsLong();
                    } else {
                        this.queuedAutomationTask = queuedJobs.peekFirst().label;
                        this.automationNextExecutionAtMillis = Math.max(nextSharedExecutionAt, System.currentTimeMillis());
                    }
                }
            }
            catch (InterruptedException e) {
                System.out.println("\u26a0\ufe0f [\u7d27\u6025\u4e2d\u65ad] \u811a\u672c\u5f53\u524d\u52a8\u4f5c\u5df2\u88ab F8 \u77ac\u95f4\u6253\u65ad\uff01");
            }
            catch (Exception e) {
                e.printStackTrace();
            }
            finally {
                this.stopBot();
                this.resetButtons();
            }
        });
        this.botThread.start();
    }

    private void stopBot() {
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;
        this.activeAutomationTask = "";
        this.queuedAutomationTask = "";
        this.automationQueueSize = 0;
        this.automationNextExecutionAtMillis = Long.MAX_VALUE;
        this.automationQueueWaitActive = false;
        this.nextBlueChestAt = Long.MAX_VALUE;
        this.nextWhiteChestAt = Long.MAX_VALUE;
        if (this.botThread != null && this.botThread.isAlive()) {
            this.botThread.interrupt();
        }
        System.out.println(">>> [\u7cfb\u7edf] \u6302\u673a\u52a8\u4f5c\u5df2\u5168\u9762\u505c\u6b62\u3002");
        this.resetButtons();
        SwingUtilities.invokeLater(this::updateRuntimeStatus);
    }

    private void resetButtons() {
        SwingUtilities.invokeLater(() -> {
            this.startBtn.setEnabled(true);
            this.stopBtn.setEnabled(false);
            if (this.appScaleBox != null) {
                this.appScaleBox.setEnabled(true);
            }
            this.updateManualCorrosionButtons();
        });
    }

    private void startHotkeyListener() {
        Thread t = new Thread(() -> {
            try {
                while (true) {
                    if ((User32.INSTANCE.GetAsyncKeyState(119) & 0x8000) != 0 && this.isRunning) {
                        this.stopBot();
                    }
                    Thread.sleep(100L);
                }
            }
            catch (Exception e) {
                return;
            }
        });
        t.setDaemon(true);
        t.start();
    }

    private void redirectSystemOut() {
        OutputStream out = new OutputStream(){
            private final ByteArrayOutputStream pending = new ByteArrayOutputStream();

            @Override
            public synchronized void write(int b) {
                this.pending.write(b);
                if ((b & 0xFF) == '\n') {
                    this.flushPending();
                }
            }

            @Override
            public synchronized void write(byte[] b, int off, int len) {
                for (int i = off; i < off + len; i++) {
                    this.pending.write(b[i]);
                    if ((b[i] & 0xFF) == '\n') {
                        this.flushPending();
                    }
                }
            }

            @Override
            public synchronized void flush() {
                this.flushPending();
            }

            private void flushPending() {
                if (this.pending.size() == 0) {
                    return;
                }
                byte[] bytes = this.pending.toByteArray();
                this.pending.reset();
                MainGUI.this.updateTextArea(new String(bytes, StandardCharsets.UTF_8));
            }
        };
        PrintStream utf8 = new PrintStream(out, true, StandardCharsets.UTF_8);
        System.setOut(utf8);
        System.setErr(utf8);
    }

    private void updateTextArea(String text) {
        ActivityStore.appendLog(text);
        StringBuilder display = new StringBuilder();
        String[] lines = text.split("\\r?\\n", -1);
        for (int i = 0; i < lines.length; i++) {
            if (i == lines.length - 1 && lines[i].isEmpty()) continue;
            if (lines[i].isEmpty()) display.append('\n');
            else display.append(formatLogTimestamp(System.currentTimeMillis())).append(' ').append(lines[i]).append('\n');
        }
        String timestamped = display.toString();
        SwingUtilities.invokeLater(() -> {
            this.consoleArea.append(timestamped);
            this.consoleArea.setCaretPosition(this.consoleArea.getDocument().getLength());
        });
    }

    private static String formatLogTimestamp(long timeMillis) {
        return "[" + new SimpleDateFormat("MM-dd HH:mm:ss").format(new Date(timeMillis)) + "]";
    }

    private static void applyVisualDefaults() {
        UIManager.put("defaultFont", new Font("Microsoft YaHei UI", Font.PLAIN, Math.max(12, (int)Math.round(13.0 * APP_SCALE))));
        UIManager.put("Component.arc", Math.max(10, (int)Math.round(12.0 * APP_SCALE)));
        UIManager.put("Button.arc", Math.max(9, (int)Math.round(11.0 * APP_SCALE)));
        UIManager.put("TextComponent.arc", Math.max(8, (int)Math.round(9.0 * APP_SCALE)));
        UIManager.put("Panel.background", Color.WHITE);
        UIManager.put("RootPane.background", Color.WHITE);
        UIManager.put("TitlePane.background", Color.WHITE);
        UIManager.put("TitlePane.foreground", TEXT_COLOR);
        UIManager.put("Table.selectionForeground", TEXT_COLOR);
        UIManager.put("Menu.background", Color.WHITE);
        UIManager.put("MenuItem.background", Color.WHITE);
        UIManager.put("PopupMenu.background", Color.WHITE);
        UIManager.put("ToolTip.background", Color.WHITE);
        UIManager.put("ToolTip.foreground", TEXT_COLOR);
        UIManager.put("Label.foreground", TEXT_COLOR);
        UIManager.put("TabbedPane.background", APP_BG);
        UIManager.put("TabbedPane.contentAreaColor", APP_BG);
        UIManager.put("TabbedPane.selectedBackground", SURFACE_ALT);
        UIManager.put("TabbedPane.foreground", MUTED_COLOR);
        UIManager.put("OptionPane.background", SURFACE_BG);
        UIManager.put("OptionPane.messageForeground", TEXT_COLOR);
        UIManager.put("Spinner.background", SURFACE_ALT);
        UIManager.put("Spinner.foreground", TEXT_COLOR);
        UIManager.put("TextArea.background", SURFACE_BG);
        UIManager.put("ScrollPane.background", SURFACE_BG);
        UIManager.put("ScrollBar.track", APP_BG);
        UIManager.put("ScrollBar.thumb", BORDER_COLOR);
        UIManager.put("Component.borderColor", BORDER_COLOR);
        UIManager.put("Component.focusColor", CYAN_ACCENT);
        UIManager.put("TextField.background", SURFACE_ALT);
        UIManager.put("TextField.foreground", TEXT_COLOR);
        UIManager.put("TextField.caretForeground", TEXT_COLOR);
        UIManager.put("ComboBox.background", SURFACE_ALT);
        UIManager.put("ComboBox.foreground", TEXT_COLOR);
        UIManager.put("CheckBox.background", SURFACE_BG);
        UIManager.put("CheckBox.foreground", TEXT_COLOR);
        UIManager.put("Button.background", SURFACE_ALT);
        UIManager.put("Button.foreground", TEXT_COLOR);
        UIManager.put("Button.hoverBackground", new Color(233, 239, 248));
        UIManager.put("Button.pressedBackground", new Color(223, 233, 246));
        UIManager.put("TabbedPane.tabHeight", Math.max(34, (int)Math.round(36.0 * APP_SCALE)));
        UIManager.put("TabbedPane.underlineColor", CYAN_ACCENT);
        UIManager.put("Table.selectionBackground", new Color(222, 237, 254));
        UIManager.put("ScrollBar.width", Math.max(10, (int)Math.round(12.0 * APP_SCALE)));
        UIManager.put("ScrollBar.thumbArc", 999);
        UIManager.put("ScrollBar.trackArc", 999);
    }

    public static void main(String[] args) {
        System.setProperty("sun.java2d.uiScale", "1.0");
        APP_SCALE = 1.0;
        try {
            Properties prop = new Properties();
            prop.load(new FileInputStream("settings.properties"));
            if (prop.containsKey("app_ui_scale_v1.3")) {
                APP_SCALE = Double.parseDouble(prop.getProperty("app_ui_scale_v1.3"));
            }
        }
        catch (Exception e) {
            APP_SCALE = 1.0;
        }
        System.setProperty("flatlaf.uiScale", String.valueOf(APP_SCALE));
        Config.UserData.loadSettings();
        DesktopSupport.initializeTaskbarIdentity();
        OpenCV.loadLocally();
        FlatLightLaf.setup();
        applyVisualDefaults();
        SwingUtilities.invokeLater(() -> new MainGUI().setVisible(true));
    }
}

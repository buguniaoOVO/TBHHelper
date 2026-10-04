package com.lulu.warehouse;

import com.lulu.api.DllApiClient;
import com.lulu.gui.ModernUI;
import com.lulu.gui.I18n;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GridLayout;
import java.awt.Image;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.event.HierarchyEvent;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import javax.swing.Scrollable;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

public final class WarehousePanel extends JPanel {
    private static final long serialVersionUID = 1L;
    private static final String[] GRADES = {"普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙"};
    private final MarketPriceClient prices = new MarketPriceClient();
    private final AtomicBoolean busy = new AtomicBoolean();
    private final AtomicBoolean marketBusy = new AtomicBoolean();
    private final Map<String, Image> images = new HashMap<String, Image>();
    private WarehouseModel model;
    private final JLabel value = new JLabel("—");
    private final JLabel capacity = new JLabel("等待读取");
    private final JLabel groups = new JLabel("—");
    private final JLabel coverage = new JLabel("最低在售参考价 · 人民币按美元报价折算");
    private final JLabel status = new JLabel("打开仓库页后会读取储物箱道具。");
    private final JLabel selection = new JLabel("点击道具查看名称、品质、数量和报价时间。");
    private final JTextField search = new JTextField();
    private final JComboBox<String> grade = new JComboBox<String>(new String[]{"全部品质", "普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙"});
    private final JComboBox<String> type = new JComboBox<String>(new String[]{"全部类型", "装备", "材料"});
    private final JComboBox<String> order = new JComboBox<String>(new String[]{"价格降序", "品质降序", "名称"});
    private final JButton refresh = new ModernUI.ActionButton("刷新储物箱");
    private final JButton refreshPrices = new ModernUI.ActionButton("更新市场报价");
    private final ItemGrid grid = new ItemGrid();

    public WarehousePanel() {
        super(new BorderLayout(0, 12));
        setOpaque(false);
        setPreferredSize(new Dimension(800, 570));
        setMinimumSize(new Dimension(500, 400));
        setMaximumSize(new Dimension(Integer.MAX_VALUE, 660));
        JPanel header = new JPanel(new BorderLayout(0, 10));
        header.setOpaque(false);
        JPanel metrics = new JPanel(new GridLayout(1, 3, 12, 0));
        metrics.setOpaque(false);
        metrics.add(metric("储物箱使用", capacity));
        metrics.add(metric("合并后的道具种类", groups));
        metrics.add(metric("Steam 市场参考总值", value));
        header.add(metrics, BorderLayout.NORTH);
        JPanel controls = new JPanel(new BorderLayout(8, 8));
        controls.setOpaque(false);
        JPanel filters = new JPanel(new GridLayout(1, 4, 8, 0));
        filters.setOpaque(false);
        search.putClientProperty("JTextField.placeholderText", "搜索道具名称");
        filters.add(search);
        filters.add(grade);
        filters.add(type);
        filters.add(order);
        JPanel actions = new JPanel(new GridLayout(1, 2, 8, 0));
        actions.setOpaque(false);
        for (JButton button : new JButton[]{refresh, refreshPrices}) {
            button.setBorder(BorderFactory.createEmptyBorder(9, 12, 9, 12));
            button.setBackground(ModernUI.TEAL);
            button.setForeground(Color.WHITE);
            actions.add(button);
        }
        controls.add(filters, BorderLayout.CENTER);
        controls.add(actions, BorderLayout.EAST);
        controls.add(coverage, BorderLayout.SOUTH);
        coverage.setForeground(ModernUI.MUTED);
        coverage.setFont(new Font("Microsoft YaHei UI", Font.PLAIN, 11));
        header.add(controls, BorderLayout.SOUTH);
        add(header, BorderLayout.NORTH);
        JScrollPane scroll = new JScrollPane(grid);
        scroll.setBorder(BorderFactory.createLineBorder(ModernUI.BORDER));
        scroll.getViewport().setBackground(Color.WHITE);
        scroll.getVerticalScrollBar().setUnitIncrement(24);
        add(scroll, BorderLayout.CENTER);
        JPanel footer = new JPanel(new BorderLayout(0, 5));
        footer.setOpaque(false);
        status.setForeground(ModernUI.MUTED);
        selection.setForeground(ModernUI.TEXT);
        footer.add(selection, BorderLayout.NORTH);
        footer.add(status, BorderLayout.SOUTH);
        add(footer, BorderLayout.SOUTH);
        refresh.addActionListener(e -> refresh(false));
        refreshPrices.addActionListener(e -> refreshMarketPrices());
        grade.addActionListener(e -> render());
        type.addActionListener(e -> render());
        order.addActionListener(e -> render());
        search.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { render(); }
            public void removeUpdate(DocumentEvent e) { render(); }
            public void changedUpdate(DocumentEvent e) { render(); }
        });
        addHierarchyListener(e -> {
            if ((e.getChangeFlags() & HierarchyEvent.SHOWING_CHANGED) != 0 && isShowing() && model == null) refresh(false);
        });
        new Timer(60000, e -> { if (isShowing()) refresh(false); }).start();
    }

    private JPanel metric(String title, JLabel target) {
        JPanel card = ModernUI.card(new BorderLayout(0, 8));
        card.setBorder(BorderFactory.createEmptyBorder(12, 16, 14, 16));
        JLabel label = new JLabel(title);
        label.setForeground(ModernUI.MUTED);
        label.setFont(new Font("Microsoft YaHei UI", Font.PLAIN, 12));
        target.setForeground(ModernUI.TEAL);
        target.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 22));
        card.add(label, BorderLayout.NORTH);
        card.add(target, BorderLayout.CENTER);
        return card;
    }

    public void refresh(boolean forcePrices) {
        if (!busy.compareAndSet(false, true)) return;
        refresh.setEnabled(false);
        I18n.setText(status, "正在读取储物箱道具…");
        Thread thread = new Thread(() -> {
            try {
                String response = DllApiClient.getWarehouseItems();
                if (response == null) throw new IllegalStateException("仓库读取超时");
                WarehouseModel snapshot = WarehouseModel.parse(response);
                SwingUtilities.invokeLater(() -> { model = snapshot; render(); I18n.setText(status, "道具已读取，正在更新市场报价…"); });
                prices.refresh(forcePrices);
                SwingUtilities.invokeLater(() -> {
                    render();
                    I18n.setText(status, prices.error.isEmpty() ? "储物箱每分钟更新一次；市场报价缓存30分钟。" : prices.error + "；显示可用的缓存报价。");
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> I18n.setText(status, "读取失败：" + ex.getMessage()));
            } finally {
                busy.set(false);
                SwingUtilities.invokeLater(() -> refresh.setEnabled(true));
            }
        }, "tbh-warehouse-catalog");
        thread.setDaemon(true);
        thread.start();
    }

    private void refreshMarketPrices() {
        if (!marketBusy.compareAndSet(false, true)) return;
        refreshPrices.setEnabled(false);
        if (!busy.get()) I18n.setText(status, "正在更新市场报价…");
        Thread thread = new Thread(() -> {
            try {
                prices.refresh(true);
                SwingUtilities.invokeLater(() -> {
                    render();
                    if (!busy.get()) {
                        I18n.setText(status, prices.error.isEmpty()
                                ? "市场报价已更新；报价数据由 TBH Index 提供。"
                                : prices.error + "；保留最近可用报价。");
                    }
                });
            } finally {
                marketBusy.set(false);
                SwingUtilities.invokeLater(() -> refreshPrices.setEnabled(true));
            }
        }, "tbh-market-price-refresh");
        thread.setDaemon(true);
        thread.start();
    }

    private void render() {
        if (model == null) return;
        I18n.setText(capacity, model.used + " / " + model.capacity + " 格");
        I18n.setText(groups, String.valueOf(model.items.size()));
        int priced = 0;
        double total = 0;
        for (WarehouseModel.Item item : model.items) {
            double unit = prices.unitValue(item);
            if (item.quantityKnown && Double.isFinite(unit)) { priced++; total += unit * item.quantity; }
        }
        I18n.setText(value, priced > 0 || (model.used == 0 && model.missing == 0) ? money(total) : "暂无报价");
        String fetched = prices.fetchedAt > 0 ? new SimpleDateFormat("MM-dd HH:mm").format(new Date(prices.fetchedAt)) : "尚未读取";
        I18n.setText(coverage, "已报价 " + priced + "/" + model.items.size() + " 组 · 人民币折算最低在售参考价 · "
                + (prices.cached ? "缓存 " : "更新 ") + fetched + (model.missing > 0 ? " · " + model.missing + " 格读取未完成" : ""));
        List<WarehouseModel.Item> visible = new ArrayList<WarehouseModel.Item>();
        String query = search.getText().trim().toLowerCase(Locale.ROOT);
        for (WarehouseModel.Item item : model.items) {
            if (!query.isEmpty() && !item.name.toLowerCase(Locale.ROOT).contains(query)) continue;
            if (grade.getSelectedIndex() > 0 && item.grade != grade.getSelectedIndex() - 1) continue;
            if (type.getSelectedIndex() == 1 && !"GEAR".equals(item.type)) continue;
            if (type.getSelectedIndex() == 2 && !"MATERIAL".equals(item.type)) continue;
            visible.add(item);
        }
        Comparator<WarehouseModel.Item> compare;
        if (order.getSelectedIndex() == 1) compare = (a, b) -> Integer.compare(b.grade, a.grade);
        else if (order.getSelectedIndex() == 2) compare = (a, b) -> a.name.compareTo(b.name);
        else compare = (a, b) -> Double.compare(sortValue(b), sortValue(a));
        Collections.sort(visible, compare);
        grid.removeAll();
        for (WarehouseModel.Item item : visible) grid.add(new ItemTile(item));
        grid.revalidate();
        grid.repaint();
    }

    private double sortValue(WarehouseModel.Item item) {
        double value = prices.unitValue(item);
        return Double.isFinite(value) ? value : -1;
    }

    private static String money(double amount) { return String.format(Locale.ROOT, "¥%.2f", amount); }
    private static String escape(String text) { return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }
    private static Color gradeColor(int grade) {
        Color[] colors = {new Color(71,85,105),new Color(21,128,61),new Color(29,100,216),new Color(126,34,206),
                new Color(174,93,6),new Color(190,42,110),new Color(143,110,0),new Color(0,121,137),new Color(205,32,73),new Color(75,65,52)};
        return colors[Math.max(0, Math.min(9, grade))];
    }

    private final class ItemTile extends JButton {
        private static final long serialVersionUID = 1L;
        private final WarehouseModel.Item item;
        private final Image image;
        ItemTile(WarehouseModel.Item item) {
            this.item = item;
            Image loaded = images.get(item.icon);
            if (loaded == null && !item.icon.isEmpty()) {
                URL url = getClass().getClassLoader().getResource("warehouse/icons/" + item.icon);
                if (url != null) { loaded = new ImageIcon(url).getImage(); images.put(item.icon, loaded); }
            }
            image = loaded;
            setContentAreaFilled(false);
            setBorder(BorderFactory.createEmptyBorder());
            setOpaque(false);
            setFocusable(true);
            MarketPriceClient.Quote quote = prices.get(item.marketHash);
            String quantity = item.quantityKnown ? String.valueOf(item.quantity) : "待确认";
            String quality = item.grade >= 0 && item.grade < GRADES.length ? GRADES[item.grade] : "未知";
            setToolTipText("<html>" + escape(item.name) + "<br>" + quality + " · 等级 " + item.level + "<br>数量 " + quantity
                    + " · 占用 " + item.slots + " 格<br>" + item.pageText + "<br>Steam参考单价 "
                    + (quote == null ? "暂无报价" : money(prices.unitValue(item)))
                    + (quote == null ? "" : "<br>报价时间 " + escape(quote.updatedAt)) + "</html>");
            getAccessibleContext().setAccessibleName(item.name + "，数量" + quantity);
            addActionListener(e -> I18n.setText(selection, item.name + " · " + quality + " · " + item.pageText + " · 数量 " + quantity
                    + " · Steam参考单价 " + (quote == null ? "暂无报价" : money(prices.unitValue(item)))));
        }

        @Override protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D)graphics.create();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            Color border = gradeColor(item.grade);
            g.setColor(getModel().isRollover() ? new Color(243,248,255) : Color.WHITE);
            g.fillRoundRect(1,1,getWidth()-2,getHeight()-2,10,10);
            g.setColor(border);
            g.drawRoundRect(1,1,getWidth()-3,getHeight()-3,10,10);
            g.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 11));
            double unit = prices.unitValue(item);
            String price = Double.isFinite(unit) ? money(unit) : "—";
            g.setColor(ModernUI.TEAL);
            g.drawString(price,(getWidth()-g.getFontMetrics().stringWidth(price))/2,16);
            if (image != null) {
                g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
                g.drawImage(image,(getWidth()-48)/2,22,48,48,this);
            } else {
                g.setColor(ModernUI.MUTED);
                g.drawString("?",getWidth()/2-4,53);
            }
            String count = item.quantityKnown ? "×" + item.quantity : item.slots + (I18n.english() ? " slots" : "格");
            g.setColor(ModernUI.TEXT);
            g.drawString(count,6,83);
            g.setFont(new Font("Microsoft YaHei UI",Font.PLAIN,10));
            String name = item.name;
            while (name.length()>1 && g.getFontMetrics().stringWidth(name)>getWidth()-10) name=name.substring(0,name.length()-1);
            g.setColor(border);
            g.drawString(name,(getWidth()-g.getFontMetrics().stringWidth(name))/2,99);
            g.dispose();
        }
    }

    private static final class ItemGrid extends JPanel implements Scrollable {
        private static final long serialVersionUID = 1L;
        private int columns() { return Math.max(1, ((getParent()==null ? 760 : getParent().getWidth())-12)/94); }
        ItemGrid() { super(null); setBackground(Color.WHITE); }
        @Override public Dimension getPreferredSize() { return new Dimension(600, Math.max(280, 12 + ((getComponentCount()+columns()-1)/columns())*112)); }
        @Override public void doLayout() { int cols=columns(); for(int i=0;i<getComponentCount();i++) getComponent(i).setBounds(6+(i%cols)*94,6+(i/cols)*112,86,104); }
        public Dimension getPreferredScrollableViewportSize() { return new Dimension(760,380); }
        public int getScrollableUnitIncrement(Rectangle r,int o,int d) { return 24; }
        public int getScrollableBlockIncrement(Rectangle r,int o,int d) { return 112; }
        public boolean getScrollableTracksViewportWidth() { return true; }
        public boolean getScrollableTracksViewportHeight() { return false; }
    }
}

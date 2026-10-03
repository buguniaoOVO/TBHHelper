package com.lulu.gui;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.awt.Component;
import java.awt.Container;
import java.awt.Window;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;
import javax.swing.AbstractButton;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JTabbedPane;
import javax.swing.JTable;
import javax.swing.ListCellRenderer;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.border.TitledBorder;
import javax.swing.table.TableCellRenderer;
import javax.swing.table.TableColumn;
import javax.swing.text.JTextComponent;

public final class I18n {
    public static final String IGNORE = "tbh.i18n.ignore";
    private static final Map<String, String> EN = new LinkedHashMap<String, String>();
    private static final List<String> FRAGMENTS = new ArrayList<String>();
    private static final Map<Object, Map<String, Text>> TEXTS = new WeakHashMap<Object, Map<String, Text>>();
    private static final java.util.concurrent.ConcurrentHashMap<String, String> CACHE = new java.util.concurrent.ConcurrentHashMap<String, String>();
    private static Timer timer;
    private static final class Text { String source, rendered, language; Text(String value) { source = value; } }
    static {
        try (InputStream input = I18n.class.getClassLoader().getResourceAsStream("i18n/en.json")) {
            if (input != null) {
                JsonObject values = new JsonParser().parse(new InputStreamReader(input, StandardCharsets.UTF_8)).getAsJsonObject();
                for (Map.Entry<String, JsonElement> entry : values.entrySet()) EN.put(entry.getKey(), entry.getValue().getAsString());
            }
        } catch (Exception ex) { System.err.println("[Language] Could not load English interface: " + ex.getMessage()); }
        for (String key : EN.keySet()) if (key.length() >= 3 && !key.contains("\n")) FRAGMENTS.add(key);
        Collections.sort(FRAGMENTS, Comparator.comparingInt(String::length).reversed());
    }
    private I18n() { }
    public static boolean english() { return "en".equals(UiPreferences.language()); }
    public static Object tr(Object value) { return value instanceof String ? tr((String)value) : value; }
    public static String tr(String text) {
        if (text == null || !english()) return text;
        boolean chinese = false;
        for (int i = 0; i < text.length(); i++) if (text.charAt(i) >= '\u4e00' && text.charAt(i) <= '\u9fff') { chinese = true; break; }
        if (!chinese) return text;
        String exact = EN.get(text);
        if (exact != null) return exact;
        String cached = CACHE.get(text);
        if (cached != null) return cached;
        String result = text;
        for (String fragment : FRAGMENTS) result = result.replace(fragment, EN.get(fragment));
        for (Map.Entry<String, String> entry : EN.entrySet()) {
            if (entry.getKey().length() <= 2 && entry.getKey().matches("[\\u4e00-\\u9fff]+"))
                result = result.replaceAll("(?<![\\u4e00-\\u9fff])" + java.util.regex.Pattern.quote(entry.getKey()) + "(?![\\u4e00-\\u9fff])", java.util.regex.Matcher.quoteReplacement(entry.getValue()));
        }
        result = result.replaceAll("关卡\\s*([0-9]+-[0-9]+)", "Stage $1");
        result = result.replaceAll("第\\s*([0-9]+)\\s*页", "Page $1");
        result = result.replaceAll("([0-9]+)\\s*格", "$1 slots").replaceAll("([0-9]+)\\s*件", "$1 items");
        result = result.replaceAll("([0-9]+)\\s*项", "$1 modules").replaceAll("([0-9]+)\\s*分钟", "$1 min").replaceAll("([0-9]+)\\s*小时", "$1 h");
        result = result.replaceAll("第\\s*([0-9]+)\\s*页", "page $1");
        result = result.replaceAll("([0-9.]+)\\s*秒", "$1 s");
        result = result.replaceAll("逐件品质≤", "each item quality ≤ ");
        result = result.replaceAll("剩余合格物品", "remaining eligible items");
        result = result.replaceAll("已满", "is full").replaceAll("已清空", "cleared").replaceAll("已退回", "returned");
        result = result.replaceAll("仓库", "Warehouse").replaceAll("背包", "Inventory").replaceAll("魔方", "Cube");
        result = result.replace("。", ".").replace("，", ", ").replace("：", ": ").replace("；", "; ")
                .replace("（", " (").replace("）", ") ").replace("！", "!").replace("？", "?");
        if (CACHE.size() > 4096) CACHE.clear();
        CACHE.put(text, result);
        return result;
    }
    private static Text text(Object owner, String key, String value) {
        Map<String, Text> values = TEXTS.get(owner);
        if (values == null) { values = new LinkedHashMap<String, Text>(); TEXTS.put(owner, values); }
        Text entry = values.get(key);
        if (entry == null) { entry = new Text(value); values.put(key, entry); }
        else if (java.util.Objects.equals(value, entry.rendered) && UiPreferences.language().equals(entry.language)) return entry;
        else if (!java.util.Objects.equals(value, entry.rendered)) entry.source = value;
        entry.rendered = tr(entry.source);
        entry.language = UiPreferences.language();
        return entry;
    }
    public static void setText(JComponent component, String value) {
        if (component instanceof JTextComponent && (((JTextComponent)component).isEditable() || Boolean.TRUE.equals(component.getClientProperty(IGNORE)))) {
            ((JTextComponent)component).setText(value); return;
        }
        Map<String, Text> values = TEXTS.get(component);
        if (values == null) { values = new LinkedHashMap<String, Text>(); TEXTS.put(component, values); }
        Text entry = new Text(value); entry.rendered = tr(value); entry.language = UiPreferences.language(); values.put("text", entry);
        if (component instanceof JLabel) ((JLabel)component).setText(entry.rendered);
        else if (component instanceof AbstractButton) ((AbstractButton)component).setText(entry.rendered);
        else if (component instanceof JTextComponent) ((JTextComponent)component).setText(entry.rendered);
    }
    public static void install(JFrame window) {
        apply(window);
        if (timer == null) { timer = new Timer(500, e -> refresh()); timer.start(); }
    }
    public static void refresh() {
        if (!SwingUtilities.isEventDispatchThread()) { SwingUtilities.invokeLater(I18n::refresh); return; }
        UIManager.put("OptionPane.yesButtonText", english() ? "Yes" : "是");
        UIManager.put("OptionPane.noButtonText", english() ? "No" : "否");
        UIManager.put("OptionPane.cancelButtonText", english() ? "Cancel" : "取消");
        UIManager.put("OptionPane.okButtonText", english() ? "OK" : "确定");
        for (Window window : Window.getWindows()) if (window.isDisplayable()) { apply(window); window.repaint(); }
    }
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void apply(Component component) {
        if (component instanceof JComponent && Boolean.TRUE.equals(((JComponent)component).getClientProperty(IGNORE))) return;
        if (component instanceof JFrame) { JFrame frame = (JFrame)component; frame.setTitle(text(frame, "title", frame.getTitle()).rendered); }
        if (component instanceof JDialog) { JDialog dialog = (JDialog)component; dialog.setTitle(text(dialog, "title", dialog.getTitle()).rendered); }
        if (component instanceof JLabel) { JLabel label = (JLabel)component; String value = text(label, "text", label.getText()).rendered; if (!java.util.Objects.equals(value, label.getText())) label.setText(value); }
        else if (component instanceof AbstractButton) { AbstractButton button = (AbstractButton)component; String value = text(button, "text", button.getText()).rendered; if (!java.util.Objects.equals(value, button.getText())) button.setText(value); }
        else if (component instanceof JTextComponent && !((JTextComponent)component).isEditable()) {
            JTextComponent label = (JTextComponent)component; String value = text(label, "text", label.getText()).rendered; if (!java.util.Objects.equals(value, label.getText())) label.setText(value);
        }
        if (component instanceof JComponent) {
            JComponent target = (JComponent)component;
            String tip = target.getToolTipText();
            if (tip != null) target.setToolTipText(text(target, "tip", tip).rendered);
            Object hint = target.getClientProperty("JTextField.placeholderText");
            if (hint instanceof String) target.putClientProperty("JTextField.placeholderText", text(target, "hint", (String)hint).rendered);
            if (target.getBorder() instanceof TitledBorder) {
                TitledBorder border = (TitledBorder)target.getBorder(); border.setTitle(text(border, "title", border.getTitle()).rendered);
            }
        }
        if (component instanceof JComboBox) {
            JComboBox combo = (JComboBox)component; ListCellRenderer original = combo.getRenderer();
            if (!(original instanceof LocalizedListRenderer)) combo.setRenderer(new LocalizedListRenderer(original));
        }
        if (component instanceof JTable) {
            JTable table = (JTable)component;
            for (int c = 0; c < table.getColumnCount(); c++) {
                TableColumn column = table.getColumnModel().getColumn(c);
                column.setHeaderValue(tr(table.getModel().getColumnName(column.getModelIndex())));
            }
            for (Class<?> type : new Class<?>[]{Object.class, String.class}) {
                TableCellRenderer original = table.getDefaultRenderer(type);
                if (original != null && !(original instanceof LocalizedTableRenderer)) table.setDefaultRenderer(type, new LocalizedTableRenderer(original));
            }
            table.getTableHeader().repaint();
        }
        if (component instanceof JTabbedPane) {
            JTabbedPane tabs = (JTabbedPane)component;
            for (int i = 0; i < tabs.getTabCount(); i++) tabs.setTitleAt(i, text(tabs.getComponentAt(i), "tab", tabs.getTitleAt(i)).rendered);
        }
        if (component instanceof Container) for (Component child : ((Container)component).getComponents()) apply(child);
    }
    @SuppressWarnings("rawtypes")
    private static final class LocalizedListRenderer implements ListCellRenderer {
        private final ListCellRenderer delegate;
        LocalizedListRenderer(ListCellRenderer renderer) { delegate = renderer; }
        @SuppressWarnings("unchecked") public Component getListCellRendererComponent(javax.swing.JList list, Object value, int index, boolean selected, boolean focus) {
            Component result = delegate.getListCellRendererComponent(list, value, index, selected, focus);
            if (result instanceof JLabel) ((JLabel)result).setText(tr(((JLabel)result).getText()));
            return result;
        }
    }
    private static final class LocalizedTableRenderer implements TableCellRenderer {
        private final TableCellRenderer delegate;
        LocalizedTableRenderer(TableCellRenderer renderer) { delegate = renderer; }
        public Component getTableCellRendererComponent(JTable table, Object value, boolean selected, boolean focus, int row, int column) {
            Component result = delegate.getTableCellRendererComponent(table, value, selected, focus, row, column);
            String name = table.getModel().getColumnName(table.convertColumnIndexToModel(column));
            if (result instanceof JLabel && !"道具名称".equals(name)) ((JLabel)result).setText(tr(((JLabel)result).getText()));
            return result;
        }
    }
}

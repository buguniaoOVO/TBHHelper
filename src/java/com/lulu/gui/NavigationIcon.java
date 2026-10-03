package com.lulu.gui;

import java.awt.BasicStroke;
import java.awt.Component;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.RoundRectangle2D;
import javax.swing.AbstractButton;
import javax.swing.Icon;
import javax.swing.JComponent;

public final class NavigationIcon implements Icon {
    private final String page;
    private final int size;

    public NavigationIcon(String page, int size) {
        this.page = page;
        this.size = Math.max(16, size);
    }

    @Override public int getIconWidth() { return size; }
    @Override public int getIconHeight() { return size; }

    public static Color accent(String page) {
        switch (page) {
            case "overview": return new Color(158, 113, 38);
            case "synthesis": return new Color(126, 87, 186);
            case "corrosion": return new Color(10, 127, 137);
            case "warehouse": return new Color(166, 105, 42);
            case "statistics": return new Color(57, 110, 179);
            case "logs": return new Color(142, 105, 56);
            case "settings": return new Color(86, 108, 138);
            case "help": return new Color(73, 124, 87);
            default: return ModernUI.TEAL;
        }
    }

    public static Color selectionBackground(String page) {
        return tint(accent(page), 0.085);
    }

    private static Color tint(Color color, double amount) {
        return new Color((int)Math.round(255 + (color.getRed() - 255) * amount),
                (int)Math.round(255 + (color.getGreen() - 255) * amount),
                (int)Math.round(255 + (color.getBlue() - 255) * amount));
    }

    @Override
    public void paintIcon(Component component, Graphics graphics, int x, int y) {
        Graphics2D g = (Graphics2D)graphics.create();
        try {
            g.translate(x, y);
            g.scale(size / 24.0, size / 24.0);
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.setRenderingHint(RenderingHints.KEY_COLOR_RENDERING, RenderingHints.VALUE_COLOR_RENDER_QUALITY);
            g.setStroke(new BasicStroke(1.65f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            boolean selected = component instanceof JComponent
                    && Boolean.TRUE.equals(((JComponent)component).getClientProperty("tbh.nav.selected"));
            boolean hover = component instanceof AbstractButton
                    && ((AbstractButton)component).getModel().isRollover();
            boolean enabled = component == null || component.isEnabled();
            Color color = enabled ? accent(page) : ModernUI.BORDER;
            Color ink = selected || hover ? color.darker() : color;
            Color detail = enabled ? new Color(185, 137, 44) : ModernUI.BORDER;
            g.setColor(ink);
            switch (page) {
                case "overview":
                    Path2D shield = new Path2D.Double();
                    shield.moveTo(4.5, 5);
                    shield.lineTo(12, 2.5);
                    shield.lineTo(19.5, 5);
                    shield.lineTo(19, 12.5);
                    shield.curveTo(18.5, 17, 15.5, 20, 12, 21.5);
                    shield.curveTo(8.5, 20, 5.5, 17, 5, 12.5);
                    shield.closePath();
                    fill(g, shield, color);
                    g.setColor(ink);
                    g.draw(shield);
                    path(g, true, 12, 6, 14, 8.5, 12, 15, 10, 8.5);
                    path(g, false, 8.5, 14, 15.5, 14);
                    path(g, false, 12, 15, 12, 18);
                    break;
                case "synthesis":
                    Path2D cube = shape(true, 12, 2.5, 21, 7.5, 21, 17, 12, 21.5, 3, 17, 3, 7.5);
                    fill(g, cube, color);
                    g.setColor(ink);
                    g.draw(cube);
                    path(g, false, 3, 7.5, 12, 12.5, 21, 7.5);
                    path(g, false, 12, 12.5, 12, 21.5);
                    g.setColor(detail);
                    path(g, true, 12, 5.5, 15, 7.5, 12, 9.5, 9, 7.5);
                    break;
                case "corrosion":
                    Path2D arch = new Path2D.Double();
                    arch.moveTo(4, 20.5);
                    arch.lineTo(4, 9.5);
                    arch.curveTo(4, 5.2, 7.2, 2.5, 12, 2.5);
                    arch.curveTo(16.8, 2.5, 20, 5.2, 20, 9.5);
                    arch.lineTo(20, 20.5);
                    fill(g, arch, color);
                    g.setColor(ink);
                    g.draw(arch);
                    g.draw(new Ellipse2D.Double(7, 5.5, 10, 14));
                    path(g, false, 2.5, 21, 21.5, 21);
                    path(g, false, 4.2, 11.5, 6.7, 11.5);
                    path(g, false, 17.3, 11.5, 19.8, 11.5);
                    Path2D swirl = new Path2D.Double();
                    swirl.moveTo(11, 8.5);
                    swirl.curveTo(15.5, 7.5, 15.5, 16, 12, 16.2);
                    swirl.curveTo(9, 16.4, 9.5, 11.8, 12, 11.7);
                    g.draw(swirl);
                    break;
                case "warehouse":
                    Path2D lid = new Path2D.Double();
                    lid.moveTo(3, 11);
                    lid.lineTo(3, 8.5);
                    lid.curveTo(3, 4.5, 6, 3, 9, 3);
                    lid.lineTo(15, 3);
                    lid.curveTo(18, 3, 21, 4.5, 21, 8.5);
                    lid.lineTo(21, 11);
                    lid.closePath();
                    fill(g, lid, color);
                    g.setColor(ink);
                    g.draw(lid);
                    rectangle(g, 4, 11, 16, 10, 1.6);
                    path(g, false, 7, 4.1, 7, 10.5);
                    path(g, false, 17, 4.1, 17, 10.5);
                    g.setColor(detail);
                    rectangle(g, 10, 9, 4, 6, 0.8);
                    path(g, false, 12, 11.5, 12, 12.7);
                    break;
                case "statistics":
                    path(g, false, 3, 12, 3, 21, 21, 21);
                    rectangle(g, 7, 14, 3, 7, 0.7);
                    rectangle(g, 12.5, 10, 3, 11, 0.7);
                    rectangle(g, 18, 5, 3, 16, 0.7);
                    g.setColor(detail);
                    g.draw(new Ellipse2D.Double(2.5, 3.5, 7, 7));
                    path(g, false, 6, 5.6, 6, 8.4);
                    break;
                case "logs":
                    Path2D scroll = new Path2D.Double();
                    scroll.moveTo(6, 3);
                    scroll.lineTo(18, 3);
                    scroll.lineTo(18, 17);
                    scroll.curveTo(18, 20, 16, 21, 14, 21);
                    scroll.lineTo(4, 21);
                    scroll.curveTo(2, 21, 2, 19.5, 2, 18);
                    scroll.lineTo(2, 17);
                    scroll.lineTo(6, 17);
                    scroll.closePath();
                    fill(g, scroll, color);
                    g.setColor(ink);
                    g.draw(scroll);
                    Path2D curl = new Path2D.Double();
                    curl.moveTo(18, 3);
                    curl.lineTo(20, 3);
                    curl.curveTo(22, 3, 22, 5, 22, 7);
                    curl.lineTo(18, 7);
                    g.draw(curl);
                    path(g, false, 6, 17, 14, 17);
                    path(g, false, 9, 7, 14.5, 7);
                    path(g, false, 9, 10.5, 14.5, 10.5);
                    path(g, false, 9, 14, 12, 14);
                    break;
                case "settings":
                    Path2D gear = new Path2D.Double();
                    for (int i = 0; i < 32; i++) {
                        double angle = Math.PI * 2 * i / 32 - Math.PI / 2;
                        double radius = i % 4 == 1 || i % 4 == 2 ? 9.4 : 7.5;
                        double px = 12 + Math.cos(angle) * radius;
                        double py = 12 + Math.sin(angle) * radius;
                        if (i == 0) gear.moveTo(px, py); else gear.lineTo(px, py);
                    }
                    gear.closePath();
                    g.draw(gear);
                    g.setColor(detail);
                    path(g, true, 12, 8.5, 15.5, 12, 12, 15.5, 8.5, 12);
                    break;
                case "help":
                    Path2D book = new Path2D.Double();
                    book.moveTo(12, 6);
                    book.curveTo(8.5, 3.5, 5, 3, 2.5, 4.5);
                    book.lineTo(2.5, 19.5);
                    book.curveTo(6, 18, 9, 18.5, 12, 21);
                    book.curveTo(15, 18.5, 18, 18, 21.5, 19.5);
                    book.lineTo(21.5, 4.5);
                    book.curveTo(19, 3, 15.5, 3.5, 12, 6);
                    book.closePath();
                    fill(g, book, color);
                    g.setColor(ink);
                    g.draw(book);
                    path(g, false, 12, 6, 12, 21);
                    path(g, false, 5.5, 8, 8.7, 9);
                    path(g, false, 5.5, 12, 8.7, 13);
                    g.setColor(detail);
                    path(g, true, 17, 8, 19, 11, 17, 14, 15, 11);
                    break;
                default:
                    rectangle(g, 3, 3, 18, 18, 3);
                    break;
            }
        } finally {
            g.dispose();
        }
    }

    private static void rectangle(Graphics2D g, double x, double y, double w, double h, double radius) {
        g.draw(new RoundRectangle2D.Double(x, y, w, h, radius * 2, radius * 2));
    }

    private static void path(Graphics2D g, boolean closed, double... points) {
        g.draw(shape(closed, points));
    }

    private static Path2D shape(boolean closed, double... points) {
        Path2D path = new Path2D.Double();
        path.moveTo(points[0], points[1]);
        for (int i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
        if (closed) path.closePath();
        return path;
    }

    private static void fill(Graphics2D g, Path2D path, Color color) {
        g.setPaint(new GradientPaint(0, 3, tint(color, 0.04), 0, 21, tint(color, 0.13)));
        g.fill(path);
    }
}

package com.lulu.gui;

import java.awt.Color;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.LayoutManager;
import java.awt.RenderingHints;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;

public final class ModernUI {
    public static final Color BACKGROUND = Color.WHITE;
    public static final Color SIDEBAR = Color.WHITE;
    public static final Color SURFACE = Color.WHITE;
    public static final Color SURFACE_ALT = new Color(246, 248, 252);
    public static final Color BORDER = new Color(222, 228, 237);
    public static final Color TEXT = new Color(24, 39, 61);
    public static final Color MUTED = new Color(90, 108, 131);
    public static final Color TEAL = new Color(8, 115, 139);
    public static final Color GOLD = new Color(173, 106, 12);
    public static final Color PURPLE = new Color(111, 72, 190);

    private ModernUI() { }

    public static JPanel card(LayoutManager layout) {
        return new CardPanel(layout);
    }

    public static final class BackgroundPanel extends JPanel {
        private static final long serialVersionUID = 1L;
        public BackgroundPanel(LayoutManager layout) {
            super(layout);
            setBackground(BACKGROUND);
        }

        @Override
        protected void paintComponent(Graphics graphics) {
            super.paintComponent(graphics);
            Graphics2D g = (Graphics2D)graphics.create();
            int w = getWidth();
            int h = getHeight();
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, w, h);
            g.dispose();
        }
    }

    private static final class CardPanel extends JPanel {
        private static final long serialVersionUID = 1L;

        private CardPanel(LayoutManager layout) {
            super(layout);
            setBackground(SURFACE);
            setOpaque(false);
        }

        @Override
        protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D)graphics.create();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setColor(new Color(24, 39, 61, 7));
            g.fillRoundRect(1, 3, getWidth() - 2, getHeight() - 4, 20, 20);
            g.setColor(getBackground());
            g.fillRoundRect(0, 0, getWidth() - 1, getHeight() - 3, 20, 20);
            g.setColor(BORDER);
            g.drawRoundRect(0, 0, getWidth() - 1, getHeight() - 3, 20, 20);
            g.dispose();
            super.paintComponent(graphics);
        }
    }

    public static final class PillLabel extends JLabel {
        private static final long serialVersionUID = 1L;

        @Override
        protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D)graphics.create();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setColor(getBackground());
            g.fillRoundRect(0, 0, getWidth(), getHeight(), getHeight(), getHeight());
            g.dispose();
            super.paintComponent(graphics);
        }
    }

    public static final class ActionButton extends JButton {
        private static final long serialVersionUID = 1L;

        public ActionButton(String text) {
            super(text);
            setContentAreaFilled(false);
            setOpaque(false);
            setFocusPainted(false);
            setRolloverEnabled(true);
        }

        @Override
        protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D)graphics.create();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            Color fill = getBackground();
            if (!isEnabled()) {
                fill = blend(fill, SURFACE, 0.65);
            } else if (getModel().isPressed()) {
                fill = blend(fill, Color.BLACK, 0.12);
            } else if (getModel().isRollover()) {
                fill = blend(fill, Color.WHITE, 0.07);
            }
            g.setColor(fill);
            g.fillRoundRect(0, 0, getWidth(), getHeight(), 12, 12);
            if (isFocusOwner()) {
                g.setColor(TEAL);
                g.drawRoundRect(1, 1, getWidth() - 3, getHeight() - 3, 12, 12);
            }
            g.dispose();
            super.paintComponent(graphics);
        }
    }

    private static Color blend(Color a, Color b, double amount) {
        return new Color((int)(a.getRed() * (1 - amount) + b.getRed() * amount),
                (int)(a.getGreen() * (1 - amount) + b.getGreen() * amount),
                (int)(a.getBlue() * (1 - amount) + b.getBlue() * amount));
    }
}

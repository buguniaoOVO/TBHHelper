package com.lulu.gui;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Properties;

public final class UiPreferences {
    private static String language = "zh";
    private static String closeAction = "tray";
    static {
        Properties values = new Properties();
        Path file = Paths.get("settings.properties");
        try (InputStream input = Files.newInputStream(file)) {
            values.load(input);
            language = "en".equals(values.getProperty("ui_language")) ? "en" : "zh";
            String action = values.getProperty("ui_close_action", "tray");
            closeAction = "exit".equals(action) || "ask".equals(action) ? action : "tray";
        } catch (java.io.IOException ignored) { }
    }
    private UiPreferences() { }
    public static synchronized String language() { return language; }
    public static synchronized String closeAction() { return closeAction; }
    public static synchronized void setLanguage(String value) throws java.io.IOException {
        save("ui_language", "en".equals(value) ? "en" : "zh");
        language = "en".equals(value) ? "en" : "zh";
        I18n.refresh();
    }
    public static synchronized void setCloseAction(String value) throws java.io.IOException {
        String action = "exit".equals(value) || "ask".equals(value) ? value : "tray";
        save("ui_close_action", action);
        closeAction = action;
    }
    private static void save(String key, String value) throws java.io.IOException {
        Path file = Paths.get("settings.properties").toAbsolutePath();
        Properties values = new Properties();
        if (Files.exists(file)) try (InputStream input = Files.newInputStream(file)) { values.load(input); }
        values.setProperty(key, value);
        Path temp = Files.createTempFile(file.getParent(), "tbh-ui-", ".properties");
        try {
            try (OutputStream output = Files.newOutputStream(temp)) { values.store(output, "TBH Helper preferences"); }
            try { Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
            catch (java.nio.file.AtomicMoveNotSupportedException ex) { Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING); }
        } finally { Files.deleteIfExists(temp); }
    }
}

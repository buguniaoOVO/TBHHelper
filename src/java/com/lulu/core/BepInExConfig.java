package com.lulu.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * BepInEx 会随游戏启动另外打开一个控制台窗口。
 * 部署时把配置里的 Console 开关关掉，正常使用时只保留助手窗口，日志仍写入 LogOutput.log。
 */
public final class BepInExConfig {
    private static final String SECTION = "[Logging.Console]";

    private BepInExConfig() {
    }

    /** 返回配置是否被修改。文件不存在时保持原样，等待游戏生成后再调用。 */
    public static boolean disableConsole(Path game) {
        Path config = game.resolve("BepInEx").resolve("config").resolve("BepInEx.cfg");
        if (!Files.isRegularFile(config)) return false;
        try {
            List<String> lines = new ArrayList<String>(Files.readAllLines(config, StandardCharsets.UTF_8));
            boolean inSection = false;
            boolean changed = false;
            for (int i = 0; i < lines.size(); i++) {
                String trimmed = lines.get(i).trim();
                if (trimmed.startsWith("[")) {
                    inSection = SECTION.equals(trimmed);
                } else if (inSection && trimmed.startsWith("Enabled") && trimmed.contains("=")) {
                    if (trimmed.equalsIgnoreCase("Enabled = false")) return true;
                    lines.set(i, "Enabled = false");
                    changed = true;
                    break;
                }
            }
            if (changed) Files.write(config, lines, StandardCharsets.UTF_8);
            return changed;
        } catch (IOException ex) {
            return false;
        }
    }
}

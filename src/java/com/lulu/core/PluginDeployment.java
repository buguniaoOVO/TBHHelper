package com.lulu.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class PluginDeployment {
    public enum Result { MATCHED, UPDATED, WAIT_FOR_EXIT }
    private PluginDeployment() { }

    public static Result synchronize(Path source, Path target, boolean gameRunning) throws IOException {
        if (!Files.isRegularFile(source)) throw new IOException("助手安装包缺少游戏插件 DLL。");
        if (Files.isRegularFile(target) && Files.mismatch(source, target) == -1L) return Result.MATCHED;
        if (gameRunning) return Result.WAIT_FOR_EXIT;
        Files.createDirectories(target.getParent());
        Path staged = Files.createTempFile(target.getParent(), "TBHPlugin-", ".tmp");
        try {
            Files.copy(source, staged, StandardCopyOption.REPLACE_EXISTING);
            Files.move(staged, target, StandardCopyOption.REPLACE_EXISTING);
            if (Files.mismatch(source, target) != -1L) throw new IOException("自动初始化后的 DLL 校验失败。");
        } finally { Files.deleteIfExists(staged); }
        return Result.UPDATED;
    }
}

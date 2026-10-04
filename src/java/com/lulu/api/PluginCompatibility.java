package com.lulu.api;

public final class PluginCompatibility {
    public static final int REQUIRED_PROTOCOL = 4;
    private PluginCompatibility() { }

    public static String field(String response, String key) {
        if (response != null) for (String token : response.split("\\|")) {
            if (token.startsWith(key + "=")) return token.substring(key.length() + 1);
        }
        return "";
    }

    public static String problem(String response, String expectedHash) {
        return problem(response, expectedHash, "");
    }

    public static String problem(String response, String expectedHash, String expectedVersion) {
        if (response == null || !response.startsWith("SUCCESS|")) return "游戏插件未连接。";
        int protocol;
        try { protocol = Integer.parseInt(field(response, "api_protocol")); }
        catch (NumberFormatException ex) { protocol = 0; }
        if (protocol < REQUIRED_PROTOCOL) return "游戏仍加载旧插件；请退出游戏，在新版助手中一键部署后重启游戏。";
        String version = expectedVersion == null ? "" : expectedVersion.replaceFirst("^v", "");
        if (!version.isEmpty() && !version.equals(field(response, "plugin_version")))
            return "游戏插件版本与当前助手不一致，等待当前版本 DLL 同步后重启游戏。";
        String actualHash = field(response, "plugin_sha256");
        if (expectedHash != null && !expectedHash.isEmpty() && !expectedHash.equalsIgnoreCase(actualHash))
            return "游戏加载的插件与助手安装包不一致；请退出游戏，一键部署后重启游戏。";
        return "";
    }
}

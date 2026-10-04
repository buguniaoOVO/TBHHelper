package com.lulu.api;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.io.Reader;
import java.util.Properties;

public final class BridgeEndpoint {
    public final int processId;
    public final int port;
    public final String instanceId;
    public final String pluginHash;
    private BridgeEndpoint(int processId, int port, String instanceId, String pluginHash) {
        this.processId = processId; this.port = port; this.instanceId = instanceId; this.pluginHash = pluginHash;
    }

    public static BridgeEndpoint read(Path file, int expectedProcessId) {
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            Properties properties = new Properties(); properties.load(reader);
            int pid = Integer.parseInt(properties.getProperty("game_pid", "0"));
            int port = Integer.parseInt(properties.getProperty("port", "0"));
            String instance = properties.getProperty("instance_id", "");
            String hash = properties.getProperty("plugin_sha256", "");
            if (pid <= 0 || pid != expectedProcessId || port < 1024 || port > 65535
                    || !instance.matches("[a-f0-9]{32}") || !hash.matches("[a-fA-F0-9]{64}")) return null;
            return new BridgeEndpoint(pid, port, instance, hash);
        } catch (Exception ex) { return null; }
    }

    public String address() { return "127.0.0.1:" + port; }

    public boolean matches(String response) {
        return String.valueOf(processId).equals(PluginCompatibility.field(response, "game_pid"))
                && instanceId.equals(PluginCompatibility.field(response, "instance_id"))
                && String.valueOf(port).equals(PluginCompatibility.field(response, "api_port"))
                && pluginHash.equalsIgnoreCase(PluginCompatibility.field(response, "plugin_sha256"));
    }
}

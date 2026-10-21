package com.lulu.api;


public final class BridgeEndpoint {
    public final int processId;
    public final int port;
    public final String instanceId;
    public final String pluginHash;
    private BridgeEndpoint(int processId, int port, String instanceId, String pluginHash) {
        this.processId = processId; this.port = port; this.instanceId = instanceId; this.pluginHash = pluginHash;
    }

    public static BridgeEndpoint fromStatus(String response, int expectedProcessId, int expectedPort) {
        try {
            if (response == null || !response.startsWith("SUCCESS|")) return null;
            int pid = Integer.parseInt(PluginCompatibility.field(response, "game_pid"));
            int port = Integer.parseInt(PluginCompatibility.field(response, "api_port"));
            String instance = PluginCompatibility.field(response, "instance_id");
            String hash = PluginCompatibility.field(response, "plugin_sha256");
            if (pid <= 0 || pid != expectedProcessId || port < 1024 || port > 65535 || port != expectedPort
                    || !instance.matches("[a-fA-F0-9]{32}") || !hash.matches("[a-fA-F0-9]{64}")) return null;
            return new BridgeEndpoint(pid, port, instance.toLowerCase(java.util.Locale.ROOT), hash.toLowerCase(java.util.Locale.ROOT));
        } catch (Exception ex) { return null; }
    }

    public String address() { return "127.0.0.1:" + port; }

    public boolean matches(String response) {
        return String.valueOf(processId).equals(PluginCompatibility.field(response, "game_pid"))
                && instanceId.equalsIgnoreCase(PluginCompatibility.field(response, "instance_id"))
                && String.valueOf(port).equals(PluginCompatibility.field(response, "api_port"))
                && pluginHash.equalsIgnoreCase(PluginCompatibility.field(response, "plugin_sha256"));
    }
}

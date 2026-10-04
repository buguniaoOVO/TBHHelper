import com.lulu.api.CubeFillStatus;
import com.lulu.api.PluginCompatibility;
import com.lulu.api.BridgeEndpoint;
import com.lulu.core.CorrosionTiming;
import com.lulu.core.PluginDeployment;
import com.lulu.logic.monitor.PeriodicSchedule;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;

public final class ProtocolChecks {
    private static void check(boolean value, String description) { if (!value) throw new AssertionError(description); }
    public static void main(String[] args) throws Exception {
        for (String line : Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8)) {
            String[] fields = line.split("\t", 2);
            int expected = Integer.parseInt(fields[0]);
            check(CubeFillStatus.count(fields[1]) == (expected <= 9 ? expected : -1), "C#/Java count contract: " + line);
        }
        check(CubeFillStatus.count("NOT_ENOUGH_4") == 4, "Legacy partial interpreted as empty");
        check(CubeFillStatus.isFillResponse("NOT_ENOUGH_4"), "Legacy partial not recognized");
        check(CubeFillStatus.count("CORROSION_READY|count=bad") == -1, "Malformed count accepted");
        check(!PluginCompatibility.problem("SUCCESS|stage_b64=", "new-hash").isEmpty(), "Old loaded DLL accepted");
        check(!PluginCompatibility.problem("SUCCESS|api_protocol=4|plugin_sha256=old", "new").isEmpty(), "Wrong DLL hash accepted");
        check(PluginCompatibility.problem("SUCCESS|api_protocol=4|plugin_sha256=new", "new").isEmpty(), "Matching plugin rejected");
        check(!PluginCompatibility.problem("SUCCESS|api_protocol=4|plugin_sha256=new|plugin_version=1.3.59", "new", "v1.3.58").isEmpty(), "Different helper/plugin versions accepted");
        check(PluginCompatibility.problem("SUCCESS|api_protocol=4|plugin_sha256=new|plugin_version=1.3.58", "new", "v1.3.58").isEmpty(), "Matching helper/plugin versions rejected");
        java.nio.file.Path discovery = Paths.get(args[0] + ".bridge.properties");
        BridgeEndpoint bridge = BridgeEndpoint.read(discovery, 1234);
        check(bridge != null && bridge.port >= 1024, "C#/Java endpoint discovery failed");
        check(BridgeEndpoint.read(discovery, 9999) == null, "Another game process descriptor accepted");
        java.nio.file.Path invalidPort = discovery.resolveSibling("invalid-port.properties");
        String descriptorText = new String(Files.readAllBytes(discovery), StandardCharsets.UTF_8);
        Files.write(invalidPort, descriptorText.replace("port=" + bridge.port + "\n", "port=65536\n").getBytes(StandardCharsets.UTF_8));
        check(BridgeEndpoint.read(invalidPort, 1234) == null, "Invalid local port accepted");
        String identity = "SUCCESS|game_pid=1234|instance_id=" + bridge.instanceId + "|api_port=" + bridge.port + "|plugin_sha256=" + bridge.pluginHash;
        check(bridge.matches(identity), "Matching API instance rejected");
        check(!bridge.matches(identity.replace(bridge.instanceId, "wrong")), "Stale API instance accepted");
        java.nio.file.Path deployDir = Files.createTempDirectory(discovery.getParent(), "deployment-test-");
        java.nio.file.Path source = deployDir.resolve("source.dll"), target = deployDir.resolve("plugins/TBHPlugin.dll");
        Files.write(source, new byte[]{1, 2, 3});
        Files.createDirectories(target.getParent()); Files.write(target, new byte[]{9});
        check(PluginDeployment.synchronize(source, target, true) == PluginDeployment.Result.WAIT_FOR_EXIT, "Loaded DLL overwritten");
        check(Files.readAllBytes(target)[0] == 9, "Waiting deployment modified target");
        check(PluginDeployment.synchronize(source, target, false) == PluginDeployment.Result.UPDATED, "Authoritative source not installed");
        check(Files.mismatch(source, target) == -1L, "Installed DLL differs from source");
        check(PluginDeployment.synchronize(source, target, true) == PluginDeployment.Result.MATCHED, "Matching running DLL rejected");
        check(CorrosionTiming.clamp(9) == 10 && CorrosionTiming.clamp(10) == 10
                && CorrosionTiming.clamp(120) == 120 && CorrosionTiming.clamp(121) == 120, "Corrosion interval limits failed");
        PeriodicSchedule normal = new PeriodicSchedule();
        normal.start(0L, 240000L);
        check(!normal.due(239999L, 240000L), "Chest opened before configured CD");
        check(normal.due(240000L, 240000L), "Chest deadline missed");
        normal.checked(240000L, 240000L);
        check(normal.nextAt(240000L) == 480000L, "Empty check did not advance by full CD");
        normal.checked(500000L, 240000L);
        check(normal.nextAt(240000L) == 720000L, "Conflict changed scheduled cadence");
        PeriodicSchedule boss = new PeriodicSchedule();
        boss.start(0L, 360000L);
        boss.checked(420000L, 360000L);
        check(boss.nextAt(360000L) == 720000L, "Delayed boss task reset its clock");
        System.out.println("Contracts and clocks: partial batches, stale DLL refusal, configured CD and conflict cadence passed.");
        System.out.println("Startup deployment, discovered process identity and 10-120 second interval limits passed.");
    }
}

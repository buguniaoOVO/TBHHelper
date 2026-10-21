package com.lulu.api;

import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.ptr.IntByReference;
import com.sun.jna.win32.StdCallLibrary;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

/** Finds and verifies the loopback API listener owned by one game process. */
public final class BridgePortDiscovery {
    private static final int AF_INET = 2;
    private static final int TCP_TABLE_OWNER_PID_LISTENER = 3;
    private static final int ERROR_INSUFFICIENT_BUFFER = 122;
    private static final int TCP_ROW_SIZE = 24;
    private static final long DISCOVERY_TIMEOUT_MS = 1800L;
    private static final int PROBE_TIMEOUT_MS = 700;
    private static final int MAX_STATUS_CHARS = 65536;

    private interface IpHlpApi extends StdCallLibrary {
        int GetExtendedTcpTable(Pointer table, IntByReference size, int order, int ipVersion, int tableClass, int reserved);
    }

    private static final IpHlpApi IP_HELPER = loadIpHelper();
    private static final ExecutorService PROBES = Executors.newFixedThreadPool(32, new ThreadFactory() {
        private int nextId;
        @Override public synchronized Thread newThread(Runnable task) {
            Thread thread = new Thread(task, "TBH-port-probe-" + (++nextId));
            thread.setDaemon(true);
            return thread;
        }
    });

    private BridgePortDiscovery() { }

    private static IpHlpApi loadIpHelper() {
        try { return Native.load("iphlpapi", IpHlpApi.class); }
        catch (Throwable ex) { return null; }
    }

    public static BridgeEndpoint findForProcess(int processId) {
        if (processId <= 0) return null;
        Set<Integer> discoveredPorts = nativeListenerPorts(processId);
        if (discoveredPorts == null) discoveredPorts = netstatListenerPorts(processId);
        if (discoveredPorts.isEmpty()) return null;

        List<Integer> ports = new ArrayList<Integer>(discoveredPorts);
        Collections.sort(ports, new Comparator<Integer>() {
            @Override public int compare(Integer left, Integer right) {
                return Integer.compare(portRank(left), portRank(right));
            }
        });

        CompletionService<BridgeEndpoint> completed = new ExecutorCompletionService<BridgeEndpoint>(PROBES);
        List<Future<BridgeEndpoint>> pending = new ArrayList<Future<BridgeEndpoint>>();
        for (final int port : ports) pending.add(completed.submit(() -> probe(processId, port)));

        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DISCOVERY_TIMEOUT_MS);
        try {
            for (int i = 0; i < pending.size(); i++) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0L) break;
                Future<BridgeEndpoint> result = completed.poll(remaining, TimeUnit.NANOSECONDS);
                if (result == null) break;
                try {
                    BridgeEndpoint endpoint = result.get();
                    if (endpoint != null) return endpoint;
                } catch (Exception ignored) { }
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } finally {
            for (Future<BridgeEndpoint> task : pending) if (!task.isDone()) task.cancel(true);
        }
        return null;
    }

    private static int portRank(int port) {
        return port >= 19090 && port <= 19110 ? port - 19090 : 100000 + port;
    }

    /** Returns null only when the native table API failed, so the caller can use netstat. */
    private static Set<Integer> nativeListenerPorts(int processId) {
        if (IP_HELPER == null) return null;
        try {
            IntByReference size = new IntByReference(0);
            int result = IP_HELPER.GetExtendedTcpTable(null, size, 1, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
            if (result != ERROR_INSUFFICIENT_BUFFER && result != 0) return null;
            int required = size.getValue();
            if (required < 4) return result == 0 ? new LinkedHashSet<Integer>() : null;

            for (int attempt = 0; attempt < 2; attempt++) {
                Memory table = new Memory(required);
                try {
                    size.setValue(required);
                    result = IP_HELPER.GetExtendedTcpTable(table, size, 1, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
                    if (result == ERROR_INSUFFICIENT_BUFFER) {
                        required = size.getValue();
                        if (required < 4) return null;
                        continue;
                    }
                    if (result != 0) return null;
                    int count = table.getInt(0);
                    if (count < 0 || 4L + (long) count * TCP_ROW_SIZE > size.getValue()) return null;
                    Set<Integer> ports = new LinkedHashSet<Integer>();
                    for (int index = 0; index < count; index++) {
                        long row = 4L + (long) index * TCP_ROW_SIZE;
                        if (table.getInt(row + 20L) != processId) continue;
                        int networkPort = table.getInt(row + 8L) & 0xffff;
                        int port = Short.toUnsignedInt(Short.reverseBytes((short) networkPort));
                        if (port > 0 && port <= 65535) ports.add(port);
                    }
                    return ports;
                } finally {
                    table.close();
                }
            }
        } catch (Throwable ex) { return null; }
        return null;
    }

    private static Set<Integer> netstatListenerPorts(int processId) {
        Set<Integer> ports = new LinkedHashSet<Integer>();
        Process process = null;
        try {
            process = new ProcessBuilder("netstat.exe", "-ano", "-p", "tcp").redirectErrorStream(true).start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String[] fields = line.trim().split("\\s+");
                    if (fields.length < 5 || !"TCP".equalsIgnoreCase(fields[0])
                            || !"LISTENING".equalsIgnoreCase(fields[3])) continue;
                    int owner;
                    try { owner = Integer.parseInt(fields[4]); }
                    catch (NumberFormatException ex) { continue; }
                    if (owner != processId) continue;
                    int separator = fields[1].lastIndexOf(':');
                    if (separator < 0 || separator + 1 >= fields[1].length()) continue;
                    try {
                        int port = Integer.parseInt(fields[1].substring(separator + 1));
                        if (port > 0 && port <= 65535) ports.add(port);
                    } catch (NumberFormatException ignored) { }
                }
            }
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
        } catch (Exception ignored) {
            if (process != null) process.destroyForcibly();
        }
        return ports;
    }

    private static BridgeEndpoint probe(int processId, int port) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("http://127.0.0.1:" + port + "/api/game/status");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(PROBE_TIMEOUT_MS);
            connection.setReadTimeout(PROBE_TIMEOUT_MS);
            connection.setUseCaches(false);
            int code = connection.getResponseCode();
            if (code != 200 && code != 400) return null;
            java.io.InputStream input = code == 200 ? connection.getInputStream() : connection.getErrorStream();
            if (input == null) return null;
            StringBuilder response = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                char[] buffer = new char[2048];
                int count;
                while ((count = reader.read(buffer)) >= 0) {
                    response.append(buffer, 0, count);
                    if (response.length() > MAX_STATUS_CHARS) return null;
                }
            }
            return BridgeEndpoint.fromStatus(response.toString().trim(), processId, port);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}

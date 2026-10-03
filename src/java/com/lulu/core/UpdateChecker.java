package com.lulu.core;

import com.lulu.config.Config;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 对接 GitHub 发布页：查询最新版本、下载并解压到临时目录，
 * 再生成一个替换脚本，在助手退出后覆盖旧文件并重新启动。
 */
public final class UpdateChecker {
    private static final String OWNER = "buguniaoOVO";
    private static final String REPO = "TBHHelper";
    /** 发布页跳转不需要 API 令牌，也没有未认证限流，比 api.github.com 更稳。 */
    private static final String LATEST_TAG_REDIRECT = "https://github.com/" + OWNER + "/" + REPO + "/releases/latest";
    public static final String RELEASES_PAGE = "https://github.com/" + OWNER + "/" + REPO + "/releases/latest";

    /** 不会被更新覆盖的用户文件。 */
    private static final String[] USER_FILES = {
            "settings.properties", "stats.properties", "activity.tsv", "game-path.txt", "launcher-error.log"
    };

    public static final class Release {
        public String tag = "";
        public String name = "";
        public String assetName = "";
        public String assetUrl = "";
        public String pageUrl = RELEASES_PAGE;
    }

    private UpdateChecker() {
    }

    /** 当前版本是否低于 GitHub 上的最新发布。 */
    public static boolean hasUpdate(Release release) {
        return isNewer(release.tag, Config.Global.APP_VERSION);
    }

    public static Release latest() throws IOException {
        Release release = new Release();
        release.tag = latestTag();
        release.name = release.tag;
        release.pageUrl = "https://github.com/" + OWNER + "/" + REPO + "/releases/tag/" + release.tag;
        release.assetName = "TBHHelper-" + release.tag + "-win-x64.zip";
        release.assetUrl = "https://github.com/" + OWNER + "/" + REPO + "/releases/download/"
                + release.tag + "/" + release.assetName;
        return release;
    }

    /** 读取 releases/latest 的 302 跳转地址，末尾即最新标签。 */
    private static String latestTag() throws IOException {
        HttpURLConnection connection = open(LATEST_TAG_REDIRECT);
        connection.setInstanceFollowRedirects(false);
        try {
            int status = connection.getResponseCode();
            String location = connection.getHeaderField("Location");
            if (location == null || location.isEmpty()) throw new IOException("发布页没有返回跳转地址（HTTP " + status + "）。");
            int marker = location.lastIndexOf("/tag/");
            if (marker < 0) throw new IOException("发布页跳转地址无法解析版本。");
            String tag = location.substring(marker + 5).trim();
            if (tag.isEmpty() || !Character.isDigit(tag.charAt(tag.length() - 1))) throw new IOException("发布页版本号无法解析。");
            return tag;
        } finally {
            connection.disconnect();
        }
    }

    /** 下载并解压。返回可直接覆盖到安装目录的暂存目录。 */
    public static Path stage(Release release) throws IOException {
        if (release.assetUrl.isEmpty()) throw new IOException("最新发布没有找到 Windows 压缩包。");
        Path staging = Files.createTempDirectory("TBHHelper-update-");
        Path archive = staging.resolve("download.zip");
        HttpURLConnection connection = open(release.assetUrl);
        connection.setInstanceFollowRedirects(true);
        try (InputStream input = connection.getInputStream(); OutputStream output = Files.newOutputStream(archive)) {
            copy(input, output);
        } finally {
            connection.disconnect();
        }
        Path extracted = staging.resolve("app");
        Files.createDirectories(extracted);
        extract(archive, extracted);
        Files.deleteIfExists(archive);
        return extracted;
    }

    /**
     * 生成 PowerShell 替换脚本并立即启动。脚本会等当前进程退出，
     * 把暂存目录覆盖到安装目录，然后重新打开助手。
     */
    public static void applyAfterExit(Path root, Path staged) throws IOException {
        Path launcher = resolveLauncher(root);
        Path script = root.resolve("TBH-Update.ps1");
        long pid = ProcessHandle.current().pid();
        List<String> lines = new ArrayList<String>();
        lines.add("$ErrorActionPreference = 'SilentlyContinue'");
        lines.add("while (Get-Process -Id " + pid + " -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }");
        lines.add("Start-Sleep -Milliseconds 800");
        lines.add("Get-ChildItem -LiteralPath " + quote(staged) + " | ForEach-Object { "
                + "Copy-Item -LiteralPath $_.FullName -Destination " + quote(root) + " -Recurse -Force }");
        lines.add("Get-ChildItem -LiteralPath " + quote(root) + " -Filter 'TBH-Helper-v*.jar' -File | Remove-Item -Force");
        lines.add("Start-Process -FilePath " + quote(launcher) + " -WorkingDirectory " + quote(root));
        lines.add("Start-Sleep -Seconds 3");
        lines.add("Remove-Item -LiteralPath " + quote(staged) + " -Recurse -Force");
        lines.add("Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force");
        byte[] body = String.join("\r\n", lines).concat("\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] bom = {(byte)0xEF, (byte)0xBB, (byte)0xBF};
        byte[] content = new byte[bom.length + body.length];
        System.arraycopy(bom, 0, content, 0, bom.length);
        System.arraycopy(body, 0, content, bom.length, body.length);
        Files.write(script, content);
        new ProcessBuilder("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-WindowStyle", "Hidden", "-File", script.toString()).start();
    }

    /** 安装目录里的启动入口。找不到时退回任意 exe。 */
    public static Path resolveLauncher(Path root) throws IOException {
        Path main = root.resolve("TBH助手.exe");
        if (Files.isRegularFile(main)) return main;
        try (java.util.stream.Stream<Path> stream = Files.list(root)) {
            return stream.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().toLowerCase().endsWith(".exe"))
                    .findFirst()
                    .orElseThrow(() -> new IOException("安装目录缺少启动程序。"));
        }
    }

    static boolean isNewer(String candidate, String current) {
        int[] left = parseVersion(candidate);
        int[] right = parseVersion(current);
        int length = Math.max(left.length, right.length);
        for (int i = 0; i < length; i++) {
            int a = i < left.length ? left[i] : 0;
            int b = i < right.length ? right[i] : 0;
            if (a != b) return a > b;
        }
        return false;
    }

    private static int[] parseVersion(String value) {
        if (value == null) return new int[0];
        String trimmed = value.trim();
        if (trimmed.startsWith("v") || trimmed.startsWith("V")) trimmed = trimmed.substring(1);
        List<Integer> numbers = new ArrayList<Integer>();
        for (String part : trimmed.split("[^0-9]+")) {
            if (part.isEmpty()) continue;
            try {
                numbers.add(Integer.parseInt(part));
            } catch (NumberFormatException ignored) {
            }
        }
        int[] result = new int[numbers.size()];
        for (int i = 0; i < result.length; i++) result[i] = numbers.get(i);
        return result;
    }

    private static void extract(Path archive, Path target) throws IOException {
        try (ZipInputStream input = new ZipInputStream(Files.newInputStream(archive))) {
            ZipEntry entry;
            String prefix = null;
            while ((entry = input.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (prefix == null) {
                    int slash = name.indexOf('/');
                    prefix = slash > 0 ? name.substring(0, slash + 1) : "";
                }
                if (!prefix.isEmpty() && name.startsWith(prefix)) name = name.substring(prefix.length());
                if (name.isEmpty() || name.endsWith("/")) continue;
                if (isUserFile(name)) continue;
                Path output = target.resolve(name).normalize();
                if (!output.startsWith(target)) throw new IOException("压缩包包含非法路径：" + name);
                Files.createDirectories(output.getParent());
                try (OutputStream stream = Files.newOutputStream(output)) {
                    copy(input, stream);
                }
            }
        }
    }

    private static boolean isUserFile(String name) {
        for (String user : USER_FILES) if (name.equals(user)) return true;
        return name.startsWith("cache/") || name.startsWith("旧版文件/");
    }

    private static String quote(Path path) {
        return "'" + path.toString().replace("'", "''") + "'";
    }

    private static HttpURLConnection open(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection)new URL(address).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(30000);
        connection.setUseCaches(false);
        connection.setRequestProperty("User-Agent", "TBHHelper/" + Config.Global.APP_VERSION);
        return connection;
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[65536];
        int count;
        while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
    }

}

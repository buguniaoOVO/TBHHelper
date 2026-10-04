package com.lulu.warehouse;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

public final class MarketPriceClient {
    public static final class Quote {
        public double usd;
        public String updatedAt;
    }

    private volatile Map<String, Quote> quotes = new HashMap<String, Quote>();
    public volatile double cnyPerUsd;
    public volatile long fetchedAt;
    public volatile boolean cached;
    public volatile String error = "";
    private static final Path CACHE = Paths.get("cache", "warehouse-market.json");

    public Quote get(String hash) { return quotes.get(hash); }

    public synchronized void refresh(boolean force) {
        if (!force && !quotes.isEmpty() && System.currentTimeMillis() - fetchedAt < 30 * 60 * 1000L) return;
        try {
            JsonObject prices = readUrl("https://api.tbhindex.com/api/items");
            JsonObject rates = readUrl("https://open.er-api.com/v6/latest/USD");
            if (!"success".equals(rates.get("result").getAsString())) throw new IllegalStateException("汇率读取失败");
            JsonObject bundle = new JsonObject();
            bundle.add("prices", prices);
            bundle.addProperty("cny_per_usd", rates.getAsJsonObject("rates").get("CNY").getAsDouble());
            bundle.addProperty("fetched_at", System.currentTimeMillis());
            apply(bundle);
            Files.createDirectories(CACHE.getParent());
            Files.write(CACHE, bundle.toString().getBytes(StandardCharsets.UTF_8));
            cached = false;
            error = "";
        } catch (Exception ex) {
            error = "报价更新失败：" + ex.getMessage();
            if (quotes.isEmpty() && Files.exists(CACHE)) {
                try {
                    apply(new JsonParser().parse(new String(Files.readAllBytes(CACHE), StandardCharsets.UTF_8)).getAsJsonObject());
                    cached = true;
                } catch (Exception ignored) { }
            } else if (!quotes.isEmpty()) {
                cached = true;
            }
        }
    }

    private void apply(JsonObject bundle) {
        Map<String, Quote> loaded = new HashMap<String, Quote>();
        for (JsonElement element : bundle.getAsJsonObject("prices").getAsJsonArray("items")) {
            JsonObject row = element.getAsJsonObject();
            if (!row.has("market_hash_name") || !row.has("lowest_sell_order") || row.get("lowest_sell_order").isJsonNull()) continue;
            double value = row.get("lowest_sell_order").getAsDouble();
            if (!Double.isFinite(value) || value <= 0) continue;
            Quote quote = new Quote();
            quote.usd = value;
            quote.updatedAt = row.has("price_updated_at") ? row.get("price_updated_at").getAsString() : "";
            loaded.put(row.get("market_hash_name").getAsString(), quote);
        }
        double rate = bundle.get("cny_per_usd").getAsDouble();
        if (loaded.isEmpty() || !Double.isFinite(rate) || rate <= 0) throw new IllegalArgumentException("报价或汇率数据无效");
        cnyPerUsd = rate;
        quotes = loaded;
        fetchedAt = bundle.get("fetched_at").getAsLong();
    }

    public double unitValue(WarehouseModel.Item item) {
        Quote quote = get(item.marketHash);
        return quote == null ? Double.NaN : Math.round(quote.usd * cnyPerUsd * 100.0) / 100.0;
    }

    private static JsonObject readUrl(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection)new URL(address).openConnection();
        try {
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(20000);
            connection.setUseCaches(false);
            connection.setRequestProperty("User-Agent", "TBHHelper/" + com.lulu.config.Config.Global.APP_VERSION);
            int responseCode = connection.getResponseCode();
            if (responseCode != 200) throw new IllegalStateException(connection.getURL().getHost() + " HTTP " + responseCode);
            try (InputStreamReader reader = new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8)) {
                return new JsonParser().parse(reader).getAsJsonObject();
            }
        } finally {
            connection.disconnect();
        }
    }
}

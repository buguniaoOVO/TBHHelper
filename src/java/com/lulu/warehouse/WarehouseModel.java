package com.lulu.warehouse;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class WarehouseModel {
    private static JsonObject catalog;
    public final List<Item> items = new ArrayList<Item>();
    public int used;
    public int capacity;
    public int pages;
    public int missing;
    public long readAt;

    public static final class Item {
        public int key;
        public int grade;
        public int level;
        public int slots;
        public long quantity;
        public boolean quantityKnown = true;
        public String name;
        public String type;
        public String icon;
        public String marketHash;
        public String pageText;
    }

    private static synchronized JsonObject catalog() {
        if (catalog == null) {
            try (InputStreamReader reader = new InputStreamReader(WarehouseModel.class.getClassLoader()
                    .getResourceAsStream("warehouse/catalog.json"), StandardCharsets.UTF_8)) {
                catalog = new JsonParser().parse(reader).getAsJsonObject().getAsJsonObject("items");
            } catch (Exception ex) {
                throw new IllegalStateException("道具图片目录读取失败", ex);
            }
        }
        return catalog;
    }

    public static WarehouseModel parse(String response) {
        JsonObject data = new JsonParser().parse(response).getAsJsonObject();
        if (!"SUCCESS".equals(text(data, "status"))) {
            throw new IllegalStateException(text(data, "message").isEmpty() ? "等待仓库道具数据" : text(data, "message"));
        }
        WarehouseModel model = new WarehouseModel();
        model.used = number(data, "used");
        model.capacity = number(data, "capacity");
        model.pages = number(data, "pages");
        model.missing = number(data, "missing");
        model.readAt = data.get("read_at").getAsLong();
        Map<Integer, Item> grouped = new LinkedHashMap<Integer, Item>();
        for (JsonElement element : data.getAsJsonArray("items")) {
            JsonObject raw = element.getAsJsonObject();
            int key = number(raw, "item_key");
            Item item = grouped.get(key);
            if (item == null) {
                item = new Item();
                item.key = key;
                item.name = text(raw, "name");
                item.type = text(raw, "type");
                item.grade = number(raw, "grade");
                item.level = number(raw, "level");
                item.pageText = "";
                JsonObject definition = catalog().has(String.valueOf(key)) ? catalog().getAsJsonObject(String.valueOf(key)) : null;
                item.icon = definition == null ? "" : text(definition, "icon");
                item.marketHash = definition == null ? "" : text(definition, "market_hash");
                grouped.put(key, item);
            }
            item.slots++;
            item.quantity += Math.max(0, number(raw, "quantity"));
            item.quantityKnown &= raw.has("quantity_known") && raw.get("quantity_known").getAsBoolean();
            String page = "第" + number(raw, "page") + "页";
            if (!item.pageText.contains(page)) item.pageText += item.pageText.isEmpty() ? page : "、" + page;
        }
        model.items.addAll(grouped.values());
        return model;
    }

    private static String text(JsonObject data, String key) {
        return data.has(key) && !data.get(key).isJsonNull() ? data.get(key).getAsString() : "";
    }

    private static int number(JsonObject data, String key) {
        return data.has(key) && !data.get(key).isJsonNull() ? data.get(key).getAsInt() : 0;
    }
}

/*
 * Decompiled with CFR 0.152.
 */
package com.lulu.config;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.Properties;

public class Config {
    private Config() {
    }

    public static class UserData {
        public static String BG_IMAGE_PATH = "";
        public static String GAME_PATH = "";

        public static void saveGamePath(String path) {
            GAME_PATH = path;
            try {
                Properties prop = new Properties();
                File file = new File("settings.properties");
                if (file.exists()) {
                    try (FileInputStream in = new FileInputStream(file);){
                        prop.load(in);
                    }
                }
                prop.setProperty("game_path", path);
                try (FileOutputStream out = new FileOutputStream(file);){
                    prop.store(out, null);
                }
            }
            catch (Exception e) {
                System.err.println("\u4fdd\u5b58\u6e38\u620f\u8def\u5f84\u5931\u8d25: " + e.getMessage());
            }
        }

        public static void loadSettings() {
            Properties prop = new Properties();
            try (FileInputStream in = new FileInputStream("settings.properties");){
                prop.load(in);
                if (prop.containsKey("bg_image_path")) {
                    BG_IMAGE_PATH = prop.getProperty("bg_image_path");
                }
                if (prop.containsKey("game_path")) {
                    GAME_PATH = prop.getProperty("game_path");
                }
                if (prop.containsKey("blue_chest_cd")) {
                    Chest.COOL_DOWN_BLUE_MS = Long.parseLong(prop.getProperty("blue_chest_cd")) * 60L * 1000L;
                }
                if (prop.containsKey("white_chest_cd")) {
                    Chest.COOL_DOWN_WHITE_MS = Long.parseLong(prop.getProperty("white_chest_cd")) * 60L * 1000L;
                }
                if (prop.containsKey("store_cd")) {
                    Store.COOL_DOWN_STORE_MS = Long.parseLong(prop.getProperty("store_cd")) * 60L * 1000L;
                }
                if (prop.containsKey("match_threshold")) {
                    Global.MATCH_THRESHOLD = Double.parseDouble(prop.getProperty("match_threshold"));
                }
                if (prop.containsKey("game_ui_scale")) {
                    Global.GAME_UI_SCALE = Double.parseDouble(prop.getProperty("game_ui_scale"));
                }
                if (prop.containsKey("use_background")) {
                    Global.USE_BACKGROUND = Boolean.parseBoolean(prop.getProperty("use_background"));
                }
                if (prop.containsKey("always_on_top")) {
                    Global.ALWAYS_ON_TOP = Boolean.parseBoolean(prop.getProperty("always_on_top"));
                }
                Global.STATS_RETENTION_HOURS = Math.max(1, Math.min(720, Integer.parseInt(prop.getProperty("stats_retention_hours", "24"))));
                Global.LOG_RETENTION_HOURS = Math.max(1, Math.min(720, Integer.parseInt(prop.getProperty("log_retention_hours", "24"))));
                Global.AUTO_PLAGUELANDS_ENABLED = Boolean.parseBoolean(prop.getProperty("plague_auto_enabled", "false"));
                Global.PLAGUELANDS_TARGET_LEVEL = Math.max(1, Math.min(20, Integer.parseInt(prop.getProperty("plague_target_level", "1"))));
                int legacyPlagueSeconds = Integer.parseInt(prop.getProperty("plague_check_interval_sec", "60"));
                int defaultPlagueMinutes = Math.max(1, (legacyPlagueSeconds + 59) / 60);
                Global.PLAGUELANDS_CHECK_INTERVAL_MIN = Math.max(1, Math.min(1440,
                        Integer.parseInt(prop.getProperty("plague_check_interval_min", String.valueOf(defaultPlagueMinutes)))));
                Synthesis.load(prop);
                System.out.println(">>> [\u914d\u7f6e\u52a0\u8f7d] \u5df2\u5e94\u7528\u7528\u6237\u914d\u7f6e");
            }
            catch (Exception e) {
                System.out.println(">>> [\u914d\u7f6e\u52a0\u8f7d] \u4f7f\u7528\u9ed8\u8ba4\u914d\u7f6e");
            }
        }
    }

    public static class Synthesis {
        public static boolean isAutoSynthesisEnabled = false;
        public static boolean useSynthesisLevel = false;
        public static boolean useWarehouse = false;
        public static String targetSynthesisGrade = "1-10";
        public static long COOL_DOWN_SYNTHESIS_MS = 1800000L;
        public static int equipMaxGrade = 4;
        public static boolean isMaterialSynthesisEnabled = false;
        public static boolean materialUseWarehouse = false;
        public static long COOL_DOWN_MATERIAL_SYNTHESIS_MS = 1800000L;
        public static int materialMaxGrade = 3;
        public static boolean isCorrosionEnabled = false;
        public static boolean corrosionUseWarehouse = false;
        public static long COOL_DOWN_CORROSION_MS = 1800000L;
        public static int corrosionMaxGrade = 3;
        public static boolean corrosionExcludeInscriptionScrolls = true;
        public static int CORROSION_AUTO_INTERVAL_SEC = 120;
        public static int CORROSION_POLLUTION_THRESHOLD = 300;
        public static int CORROSION_WAREHOUSE_THRESHOLD_PERCENT = 50;
        public static final String CUBE = "\u9b54\u65b9.png";
        public static final int[] CUBE_BUT = new int[]{816, 964};
        public static final int[] Toolbar_BUT = new int[]{1118, 466};
        public static final int[] synthesis_BUT = new int[]{1118, 502};
        public static final int[] alchemy_BUT = new int[]{1133, 543};
        public static final int[] corrosion_BUT = new int[]{1133, 583};
        public static final int[] AutoFill_BUT = new int[]{1115, 800};
        public static final int[] arrow_BUT = new int[]{1215, 798};
        public static final int[] EquipmentOptions_BUT = new int[]{1135, 846};
        public static final int[] MaterialOptions_BUT = new int[]{1136, 887};
        public static final int[] Execute_BUT = new int[]{1314, 794};
        public static final int[] Back_BUT = new int[]{1096, 718};
        public static final String NotMet_IMG = "\u4e0d\u6ee19\u4ef6.png";
        public static int ROI_X = 1232;
        public static int ROI_Y = 757;
        public static int ROI_W = 167;
        public static int ROI_H = 79;
        public static final int[] level_BUT = new int[]{1330, 459};
        public static final int[] level_1_10_BUT = new int[]{1338, 502};
        public static final int[] level_10_20_BUT = new int[]{1330, 542};
        public static final int[] level_15_30_BUT = new int[]{1330, 582};
        public static final int[] level_20_40_BUT = new int[]{1330, 622};
        public static final int[] level_30_50_BUT = new int[]{1330, 662};
        public static final int[] level_40_65_BUT = new int[]{1330, 702};
        public static final int[] level_50_65_BUT = new int[]{1330, 742};
        public static final int[] level_65_80_BUT = new int[]{1330, 782};
        public static final int[] level_80_90_BUT = new int[]{1330, 822};
        public static final String green_img = "\u5305\u542b\u4ed3\u5e93.png";
        public static final String black_img = "\u4e0d\u5305\u542b\u4ed3\u5e93.png";
        public static int[] point = new int[]{1105, 848};
        public static int ROI_X_1 = 1077;
        public static int ROI_Y_1 = 827;
        public static int ROI_W_1 = 55;
        public static int ROI_H_1 = 45;

        public static void load(Properties prop) {
            isAutoSynthesisEnabled = Boolean.parseBoolean(prop.getProperty("synthesis_enabled", "false"));
            useWarehouse = Boolean.parseBoolean(prop.getProperty("synthesis_use_warehouse", "false"));
            useSynthesisLevel = Boolean.parseBoolean(prop.getProperty("synthesis_use_level", "false"));
            targetSynthesisGrade = prop.getProperty("synthesis_target_grade", "1-10");
            if (prop.containsKey("synthesis_cd")) {
                COOL_DOWN_SYNTHESIS_MS = Long.parseLong(prop.getProperty("synthesis_cd")) * 60L * 1000L;
            }
            if (prop.containsKey("synthesis_equip_max_grade")) {
                equipMaxGrade = Integer.parseInt(prop.getProperty("synthesis_equip_max_grade"));
            }
            isMaterialSynthesisEnabled = Boolean.parseBoolean(prop.getProperty("material_synthesis_enabled", "false"));
            materialUseWarehouse = Boolean.parseBoolean(prop.getProperty("material_use_warehouse", "false"));
            if (prop.containsKey("material_synthesis_cd")) {
                COOL_DOWN_MATERIAL_SYNTHESIS_MS = Long.parseLong(prop.getProperty("material_synthesis_cd")) * 60L * 1000L;
            }
            if (prop.containsKey("synthesis_material_max_grade")) {
                materialMaxGrade = Integer.parseInt(prop.getProperty("synthesis_material_max_grade"));
            }
            boolean legacyEquipmentEnabled = Boolean.parseBoolean(prop.getProperty("corrosion_equip_enabled", "false"));
            boolean legacyMaterialEnabled = Boolean.parseBoolean(prop.getProperty("corrosion_material_enabled", "false"));
            boolean legacyEquipmentWarehouse = Boolean.parseBoolean(prop.getProperty("corrosion_equip_use_warehouse", "false"));
            boolean legacyMaterialWarehouse = Boolean.parseBoolean(prop.getProperty("corrosion_material_use_warehouse", "false"));
            isCorrosionEnabled = Boolean.parseBoolean(prop.getProperty("corrosion_enabled", String.valueOf(legacyEquipmentEnabled || legacyMaterialEnabled)));
            corrosionUseWarehouse = Boolean.parseBoolean(prop.getProperty("corrosion_use_warehouse", String.valueOf(legacyEquipmentWarehouse || legacyMaterialWarehouse)));
            int legacyEquipmentGrade = Integer.parseInt(prop.getProperty("corrosion_equip_max_grade", "4"));
            int legacyMaterialGrade = Integer.parseInt(prop.getProperty("corrosion_material_max_grade", "3"));
            corrosionMaxGrade = Integer.parseInt(prop.getProperty("corrosion_max_grade", String.valueOf(Math.min(legacyEquipmentGrade, legacyMaterialGrade))));
            corrosionExcludeInscriptionScrolls = Boolean.parseBoolean(prop.getProperty("corrosion_exclude_inscription_scrolls", "true"));
            CORROSION_AUTO_INTERVAL_SEC = Math.max(120, Integer.parseInt(prop.getProperty("corrosion_auto_interval_sec", "120")));
            Safety.ACTION_GAP_SECONDS = Math.max(20, Math.min(300, Integer.parseInt(prop.getProperty("operation_gap_seconds", "20"))));
            CORROSION_POLLUTION_THRESHOLD = Math.max(0, Integer.parseInt(prop.getProperty("corrosion_pollution_threshold", "300")));
            CORROSION_WAREHOUSE_THRESHOLD_PERCENT = Math.max(1, Math.min(100, Integer.parseInt(prop.getProperty("corrosion_warehouse_threshold_percent", "50"))));
            long legacyEquipmentCd = Long.parseLong(prop.getProperty("corrosion_equip_cd", "30"));
            long legacyMaterialCd = Long.parseLong(prop.getProperty("corrosion_material_cd", "30"));
            COOL_DOWN_CORROSION_MS = Long.parseLong(prop.getProperty("corrosion_cd", String.valueOf(Math.min(legacyEquipmentCd, legacyMaterialCd)))) * 60L * 1000L;
        }
    }

    public static class Store {
        public static long COOL_DOWN_STORE_MS = 300000L;
        public static final String STORE_IMG = "store.png";
        public static final String DEPOSIT_IMG = "deposit.png";
        public static final int[] DEPOSIT_BUT = new int[]{307, 975};
        public static final int[] FIRST_PAGE = new int[]{52, 461};
        public static final int[] SECOND_PAGE = new int[]{116, 461};
        public static final int[] THIRD_PAGE = new int[]{173, 461};
        public static final int[] FOURTH_PAGE = new int[]{229, 461};
        public static final int[] FIFTH_PAGE = new int[]{296, 461};
        public static final int[] SIXTH_PAGE = new int[]{353, 461};
        public static final int[] SEVENTH_PAGE = new int[]{418, 461};
        public static final int[] SORT_BUT = new int[]{437, 981};
        public static int END_SLOT_X = 394;
        public static int END_SLOT_Y = 865;
        public static int END_SLOT_W = 62;
        public static int END_SLOT_H = 63;
        public static final String EMPTY_IMG = "empty_slot.png";
        public static final String FIRST_IMG = "first_store.png";
        public static final String SECOND_IMG = "second_store.png";
        public static final String THIRD_IMG = "third_store.png";
        public static final String FOURTH_IMG = "fourth_store.png";
        public static final String FIFTH_IMG = "fifth_store.png";
        public static final String SIXTH_IMG = "sixth_store.png";
        public static final String SEVENTH_IMG = "seventh_store.png";
    }

    public static class Chest {
        public static final String BLUE_IMG = "chest_blue.png";
        public static final String WHITE_IMG = "chest_white.png";
        public static long COOL_DOWN_BLUE_MS = 360000L;
        public static long COOL_DOWN_WHITE_MS = 240000L;
        public static int ROI_X = 469;
        public static int ROI_Y = 1046;
        public static int ROI_W = 508;
        public static int ROI_H = 128;
    }

    public static class Global {
        public static final String APP_TITLE = "TBH助手";
        public static final String APP_VERSION = "v1.3.48";
        public static long CHECK_INTERVAL = 500L;
        public static double MATCH_THRESHOLD = 0.8;
        public static double GAME_UI_SCALE = 1.5;
        public static boolean USE_BACKGROUND = false;
        public static boolean ALWAYS_ON_TOP = false;
        public static int STATS_RETENTION_HOURS = 24;
        public static int LOG_RETENTION_HOURS = 24;
        public static boolean AUTO_PLAGUELANDS_ENABLED = false;
        public static int PLAGUELANDS_TARGET_LEVEL = 1;
        public static int PLAGUELANDS_CHECK_INTERVAL_MIN = 1;
    }
    public static class Safety {
        public static int ACTION_GAP_SECONDS = 20;
    }

}

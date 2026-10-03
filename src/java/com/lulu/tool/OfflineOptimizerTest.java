/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.fasterxml.jackson.databind.JsonNode
 *  com.fasterxml.jackson.databind.ObjectMapper
 */
package com.lulu.tool;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.util.ArrayList;

public class OfflineOptimizerTest {
    public static void main(String[] args) {
        String jsonPath = "all_stage_full_data.json";
        int heroLevel = 66;
        String maxCode = "3305";
        String b1 = "1101";
        int t1 = 30;
        String b2 = maxCode;
        int t2 = 240;
        System.out.println(">>> \u6b63\u5728\u542f\u52a8 TBH \u667a\u80fd\u8def\u7ebf\u89c4\u5212\u5668...");
        OfflineOptimizerTest.calculateOptimalRoute(jsonPath, heroLevel, maxCode, b1, t1, b2, t2);
    }

    public static void calculateOptimalRoute(String jsonPath, int heroLvl, String maxCode, String b1, int t1, String b2, int t2) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(new File(jsonPath));
            ArrayList<StageResult> db = new ArrayList<StageResult>();
            int maxCodeNum = Integer.parseInt(maxCode);
            int maxDiff = maxCodeNum / 1000;
            int maxChapter = maxCodeNum / 100 % 10;
            int maxStageNum = maxCodeNum % 100;
            for (JsonNode s : root) {
                int codeNum = s.get("stageCode").asInt();
                int diff = codeNum / 1000;
                int chapter = codeNum / 100 % 10;
                int stageNum = codeNum % 100;
                boolean unlocked = diff < maxDiff ? true : (diff == maxDiff ? (chapter < maxChapter ? true : chapter == maxChapter && stageNum <= maxStageNum) : false);
                if (!unlocked) continue;
                String code = String.valueOf(codeNum);
                int waves = s.get("totalWave").asInt();
                int perWaveCount = s.get("perWaveCount").asInt();
                double hp = s.get("boss").get("hp").asDouble();
                double exp = s.get("boss").get("exp").asDouble();
                for (JsonNode m : s.get("monsters")) {
                    double rate = Double.parseDouble(m.get("spawnRate").asText().replaceAll("[^0-9.]", "")) / 100.0;
                    double count = (double)((waves - 1) * perWaveCount) * rate;
                    hp += m.get("hp").asDouble() * count;
                    exp += m.get("exp").asDouble() * count;
                }
                String diffName = s.get("difficulty").asText();
                int ch = s.get("chapter").asInt();
                int lv = s.get("level").asInt();
                String name = diffName + " " + ch + "-" + lv;
                int stageLv = s.get("stageLevel").asInt();
                db.add(new StageResult(name, code, stageLv, waves, hp, exp));
            }
            StageResult s1 = db.stream().filter(x -> x.code.equals(b1)).findFirst().orElseThrow();
            StageResult s2 = db.stream().filter(x -> x.code.equals(b2)).findFirst().orElseThrow();
            double t_wave = (double)t1 / (double)s1.waves;
            double t_hp = ((double)t2 - (double)s2.waves * t_wave) / s2.totalHp;
            System.out.printf("\u3010\u62df\u5408\u5b8c\u6210\u3011\u6bcf\u6ce2\u8fc7\u573a: %.2fs, \u51fb\u6740\u6548\u7387: %.4f \u79d2/HP\n", t_wave, t_hp);
            for (StageResult s : db) {
                s.estimatedTime = Math.max((double)s.waves * t_wave + s.totalHp * t_hp, (double)s.waves * 2.5);
                s.penalty = OfflineOptimizerTest.getPenalty(heroLvl, s.lvl);
                s.finalExp = s.totalExp * s.penalty;
                s.expPerHour = 3600.0 / s.estimatedTime * s.finalExp;
            }
            db.sort((a, b) -> Double.compare(b.expPerHour, a.expPerHour));
            System.out.printf("\n%-15s | %-6s | %-10s | %-10s\n", "\u5173\u5361\u540d\u79f0", "\u7b49\u7ea7", "\u5355\u6b21\u8017\u65f6", "EXP/\u5c0f\u65f6");
            System.out.println("------------------------------------------------------------");
            for (StageResult r : db) {
                System.out.printf("%-15s | Lv%-4d | %-10.1fs | %,.0f\n", r.name, r.lvl, r.estimatedTime, r.expPerHour);
            }
        }
        catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static double getPenalty(int heroLv, int stageLv) {
        int maxFullU;
        int diff = heroLv - stageLv;
        if (diff >= 0) {
            if (diff <= 2) {
                return 1.0;
            }
            if (diff == 3) {
                return 0.99;
            }
            if (diff == 4) {
                return 0.96;
            }
            if (diff == 5) {
                return 0.91;
            }
            return Math.max(0.8, 0.91 - (double)(diff - 5) * 0.02);
        }
        int U = -diff;
        int n = maxFullU = heroLv >= 60 ? 7 : 6;
        if (U <= maxFullU) {
            return 1.0;
        }
        int N = U - maxFullU;
        double[] commonTable = new double[]{0.99, 0.96, 0.92, 0.85, 0.77, 0.66, 0.54, 0.4};
        if (N <= commonTable.length) {
            return commonTable[N - 1];
        }
        if (heroLv >= 60) {
            int offset = N - commonTable.length - 1;
            double[] highTable = new double[]{0.33, 0.28, 0.23, 0.19, 0.16, 0.13, 0.11, 0.09, 0.08, 0.06};
            if (offset < highTable.length) {
                return highTable[offset];
            }
            return Math.max(0.01, 0.06 - (double)(offset - highTable.length + 1) * 0.01);
        }
        int offset = N - commonTable.length - 1;
        double[] lowTable = new double[]{0.3, 0.23, 0.17, 0.13, 0.1, 0.08};
        if (offset < lowTable.length) {
            return lowTable[offset];
        }
        return Math.max(0.01, 0.08 - (double)(offset - lowTable.length + 1) * 0.015);
    }

    static class StageResult {
        String name;
        String code;
        int lvl;
        int waves;
        double totalHp;
        double totalExp;
        double penalty;
        double finalExp;
        double estimatedTime;
        double expPerHour;

        public StageResult(String name, String code, int lvl, int waves, double hp, double exp) {
            this.name = name;
            this.code = code;
            this.lvl = lvl;
            this.waves = waves;
            this.totalHp = hp;
            this.totalExp = exp;
        }
    }
}

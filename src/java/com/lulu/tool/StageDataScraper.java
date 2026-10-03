/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.fasterxml.jackson.databind.ObjectMapper
 *  com.fasterxml.jackson.databind.SerializationFeature
 *  com.microsoft.playwright.Browser
 *  com.microsoft.playwright.BrowserContext
 *  com.microsoft.playwright.BrowserType$LaunchOptions
 *  com.microsoft.playwright.Locator
 *  com.microsoft.playwright.Page
 *  com.microsoft.playwright.Page$NavigateOptions
 *  com.microsoft.playwright.Playwright
 *  com.microsoft.playwright.Route
 */
package com.lulu.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.Route;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

public class StageDataScraper {
    private static final String BASE_URL_TPL = "https://taskbarhero.wiki/zh-hans/stages/%d";
    private static final ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private static final int LOCATOR_TIMEOUT = 5000;
    private static final int STEP_DELAY = 1200;
    private static final Map<Integer, String> DIFF_MAP = Map.of(1, "\u666e\u901a", 2, "\u5669\u68a6", 3, "\u5730\u72f1", 4, "\u6298\u78e8");

    private static Browser createBrowser(Playwright playwright) {
        BrowserType.LaunchOptions opt = new BrowserType.LaunchOptions();
        opt.setHeadless(true);
        return playwright.chromium().launch(opt);
    }

    public static void main(String[] args) throws InterruptedException {
        ArrayList<StageFullData> allStageData = new ArrayList<StageFullData>();
        ArrayList<Integer> allCodeList = new ArrayList<Integer>();
        for (int diffPrefix : List.of(Integer.valueOf(1), Integer.valueOf(2), Integer.valueOf(3), Integer.valueOf(4))) {
            for (int chapter = 1; chapter <= 3; ++chapter) {
                for (int level = 1; level <= 9; ++level) {
                    int code = diffPrefix * 1000 + chapter * 100 + level;
                    allCodeList.add(code);
                }
            }
        }
        int currentIndex = 0;
        while (currentIndex < allCodeList.size()) {
            try {
                Playwright playwright = Playwright.create();
                try {
                    Browser browser = StageDataScraper.createBrowser(playwright);
                    BrowserContext context = browser.newContext();
                    context.setDefaultTimeout(5000.0);
                    context.route(Pattern.compile(".*(ads|doubleclick|nitropay|analytics|hadronid).*"), Route::abort);
                    Page page = context.newPage();
                    while (currentIndex < allCodeList.size()) {
                        int stageCode = (Integer)allCodeList.get(currentIndex);
                        int diffPrefix = stageCode / 1000;
                        int chapter = stageCode / 100 % 10;
                        int level = stageCode % 100;
                        String diffName = DIFF_MAP.get(diffPrefix);
                        System.out.println("========================================");
                        System.out.printf("\u5f00\u59cb\u722c\u53d6\uff1a%s \u7b2c%d\u7ae0 \u7b2c%d\u5173 | \u7f16\u7801:%d \u8fdb\u5ea6:%d/%d%n", diffName, chapter, level, stageCode, currentIndex + 1, allCodeList.size());
                        String targetUrl = String.format(BASE_URL_TPL, stageCode);
                        try {
                            page.navigate(targetUrl, new Page.NavigateOptions().setTimeout(12000.0));
                            Thread.sleep(1200L);
                            String title = page.title();
                            System.out.println("\u9875\u9762\u6807\u9898\uff1a" + title);
                            int totalWave = 0;
                            int perWaveCount = 0;
                            int stageLevel = 0;
                            try {
                                String xpathWaveTotal = "/html/body/div[1]/div[2]/div[2]/main/div/div[2]/div/div[2]/span[1]";
                                String xpathPerWave = "/html/body/div[1]/div[2]/div[2]/main/div/div[2]/div/div[2]/span[2]";
                                String xpathStageLv = "/html/body/div[1]/div[2]/div[2]/main/div/div[2]/div/div[2]/span[3]";
                                String waveTotalText = page.locator("xpath=" + xpathWaveTotal).textContent();
                                String perWaveText = page.locator("xpath=" + xpathPerWave).textContent();
                                String stageLvText = page.locator("xpath=" + xpathStageLv).textContent();
                                totalWave = StageDataScraper.extractNumber(waveTotalText);
                                perWaveCount = StageDataScraper.extractNumber(perWaveText);
                                stageLevel = StageDataScraper.extractNumber(stageLvText);
                                System.out.printf("\u5173\u5361\u57fa\u7840\u4fe1\u606f\uff1a\u603b\u6ce2\u6570=%d ,\u6bcf\u6ce2\u602a\u7269=%d ,\u5173\u5361\u7b49\u7ea7=%d%n", totalWave, perWaveCount, stageLevel);
                            }
                            catch (Exception e) {
                                System.err.println("\u6293\u53d6\u5173\u5361\u6ce2\u6570/\u7b49\u7ea7\u4fe1\u606f\u5931\u8d25\uff0c\u5168\u90e8\u7f6e0\uff1a" + e.getMessage());
                            }
                            Locator bossPanel = page.locator("xpath=/html/body/div[1]/div[2]/div[2]/main/div/div[2]/div/a[2]/div/div[3]");
                            bossPanel.waitFor();
                            String hpRaw = bossPanel.locator("b.text-immortal").locator("xpath=./parent::span").textContent();
                            int bossHp = StageDataScraper.extractNumber(hpRaw);
                            String goldRaw = bossPanel.locator("img[src*='Icon_Gold']").locator("xpath=./parent::span").textContent();
                            int bossGold = StageDataScraper.extractNumber(goldRaw);
                            String expRaw = bossPanel.locator("b.text-divine").locator("xpath=./parent::span").textContent();
                            int bossExp = StageDataScraper.extractNumber(expRaw);
                            HashMap<String, Integer> bossData = new HashMap<String, Integer>();
                            bossData.put("hp", bossHp);
                            bossData.put("gold", bossGold);
                            bossData.put("exp", bossExp);
                            System.out.println("BOSS\u5c5e\u6027\uff1a" + bossData);
                            String monsterContainerXpath = "/html/body/div[1]/div[2]/div[2]/main/div/div[2]/div/div[3]";
                            Locator monsterContainer = page.locator("xpath=" + monsterContainerXpath);
                            monsterContainer.waitFor();
                            Locator monsterItems = monsterContainer.locator("xpath=.//a[contains(@class,'border-2 border-line')]");
                            int monsterCount = monsterItems.count();
                            ArrayList<MonsterInfo> monsterList = new ArrayList<MonsterInfo>();
                            System.out.println("\u5c0f\u602a\u6570\u91cf\uff1a" + monsterCount);
                            for (int i = 0; i < monsterCount; ++i) {
                                try {
                                    Locator item = monsterItems.nth(i);
                                    item.waitFor();
                                    String monsterName = item.locator("xpath=.//div[contains(@class,'truncate')]").textContent().trim();
                                    String spawnRateText = item.locator("xpath=.//div[contains(@class,'text-faint') and not(.//span)]").textContent().trim();
                                    String mHpText = item.locator("xpath=.//b[normalize-space()='HP']/parent::span").textContent();
                                    int mHp = StageDataScraper.extractNumber(mHpText);
                                    String mGoldText = item.locator("xpath=.//img[contains(@src,'Icon_Gold')]/parent::span").textContent();
                                    int mGold = StageDataScraper.extractNumber(mGoldText);
                                    String mExpText = item.locator("xpath=.//b[normalize-space()='Exp' or normalize-space()='\u7ecf\u9a8c']/parent::span").textContent();
                                    int mExp = StageDataScraper.extractNumber(mExpText);
                                    MonsterInfo info = new MonsterInfo(monsterName, spawnRateText, mHp, mGold, mExp);
                                    monsterList.add(info);
                                    System.out.println("\u6210\u529f\u8bfb\u53d6\u5c0f\u602a\uff1a" + info.toMap());
                                    continue;
                                }
                                catch (Exception monsterErr) {
                                    System.err.printf("\u7b2c%d\u53ea\u5c0f\u602a\u8bfb\u53d6\u5931\u8d25\uff0c\u8df3\u8fc7\uff1a%s%n", i + 1, monsterErr.getMessage());
                                }
                            }
                            StageFullData stageData = new StageFullData();
                            stageData.stageCode = stageCode;
                            stageData.diffName = diffName;
                            stageData.chapter = chapter;
                            stageData.level = level;
                            stageData.totalWave = totalWave;
                            stageData.perWaveCount = perWaveCount;
                            stageData.stageLevel = stageLevel;
                            stageData.boss = bossData;
                            stageData.monsters = monsterList;
                            allStageData.add(stageData);
                            mapper.writerWithDefaultPrettyPrinter().writeValue(new File("all_stage_full_data_2.json"), allStageData.stream().map(StageFullData::toMap).toList());
                            System.out.println("\u2705 \u5f53\u524d\u8fdb\u5ea6\u6570\u636e\u5df2\u5b9e\u65f6\u4fdd\u5b58\u5230\u6587\u4ef6");
                        }
                        catch (Exception pageErr) {
                            System.err.printf("\u5173\u5361 %d \u6293\u53d6\u5931\u8d25\uff0c\u8df3\u8fc7\uff1a%s%n", stageCode, pageErr.getMessage());
                        }
                        Thread.sleep(1200L);
                        ++currentIndex;
                    }
                    browser.close();
                }
                finally {
                    if (playwright == null) continue;
                    playwright.close();
                }
            }
            catch (Exception browserErr) {
                System.err.println("==================== \u6d4f\u89c8\u5668\u5d29\u6e83\uff0c\u7b49\u5f853\u79d2\u540e\u91cd\u542f ====================");
                System.err.println(browserErr.getMessage());
                Thread.sleep(3000L);
            }
        }
        System.out.printf("\n==== \u5168\u90e8\u5173\u5361\u722c\u53d6\u5b8c\u6210\uff0c\u5171\u4fdd\u5b58 %d \u4e2a\u5173\u5361\u6570\u636e ====%n", allStageData.size());
    }

    private static int extractNumber(String text) {
        String numStr = text.replaceAll("[^0-9]", "");
        return numStr.isBlank() ? 0 : Integer.parseInt(numStr);
    }

    static class MonsterInfo {
        String name;
        String spawnRate;
        int hp;
        int gold;
        int exp;

        public MonsterInfo(String name, String spawnRate, int hp, int gold, int exp) {
            this.name = name;
            this.spawnRate = spawnRate;
            this.hp = hp;
            this.gold = gold;
            this.exp = exp;
        }

        public Map<String, Object> toMap() {
            HashMap<String, Object> map = new HashMap<String, Object>();
            map.put("name", this.name);
            map.put("spawnRate", this.spawnRate);
            map.put("hp", this.hp);
            map.put("gold", this.gold);
            map.put("exp", this.exp);
            return map;
        }
    }

    static class StageFullData {
        int stageCode;
        String diffName;
        int chapter;
        int level;
        int totalWave;
        int perWaveCount;
        int stageLevel;
        Map<String, Integer> boss;
        List<MonsterInfo> monsters;

        StageFullData() {
        }

        public Map<String, Object> toMap() {
            HashMap<String, Object> map = new HashMap<String, Object>();
            map.put("stageCode", this.stageCode);
            map.put("difficulty", this.diffName);
            map.put("chapter", this.chapter);
            map.put("level", this.level);
            map.put("totalWave", this.totalWave);
            map.put("perWaveCount", this.perWaveCount);
            map.put("stageLevel", this.stageLevel);
            map.put("boss", this.boss);
            map.put("monsters", this.monsters.stream().map(MonsterInfo::toMap).toList());
            return map;
        }
    }
}

package com.lulu.logic.tasks;

import com.lulu.config.Config;
import com.lulu.logic.BotTask;

public class EquipmentSynthesisTask implements BotTask {
    private static long lastSynthesisTime;
    public boolean isDue() { return Config.Synthesis.isAutoSynthesisEnabled && System.currentTimeMillis() >= this.nextExecutionAt(); }
    public long nextExecutionAt() {
        return Config.Synthesis.isAutoSynthesisEnabled
                ? (lastSynthesisTime == 0L ? 0L : lastSynthesisTime + Math.max(60000L, Config.Synthesis.COOL_DOWN_SYNTHESIS_MS)) : Long.MAX_VALUE;
    }
    @Override public void execute() throws InterruptedException {
        if (!Config.Synthesis.isAutoSynthesisEnabled) return;
        long now = System.currentTimeMillis();
        if (now - lastSynthesisTime < Math.max(60000L, Config.Synthesis.COOL_DOWN_SYNTHESIS_MS)) return;
        lastSynthesisTime = now;
        String outcome = SynthesisRunner.run(0, Config.Synthesis.useWarehouse, Config.Synthesis.equipMaxGrade, Config.Synthesis.useSynthesisLevel, Config.Synthesis.targetSynthesisGrade);
        System.out.println(">>> [自动装备合成] " + outcome);
    }
}

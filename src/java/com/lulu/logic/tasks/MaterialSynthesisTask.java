package com.lulu.logic.tasks;

import com.lulu.config.Config;
import com.lulu.logic.BotTask;

public class MaterialSynthesisTask implements BotTask {
    private static long lastMaterialSynthesisTime;
    public boolean isDue() { return Config.Synthesis.isMaterialSynthesisEnabled && System.currentTimeMillis() >= this.nextExecutionAt(); }
    public long nextExecutionAt() {
        return Config.Synthesis.isMaterialSynthesisEnabled
                ? (lastMaterialSynthesisTime == 0L ? 0L : lastMaterialSynthesisTime + Math.max(60000L, Config.Synthesis.COOL_DOWN_MATERIAL_SYNTHESIS_MS)) : Long.MAX_VALUE;
    }
    @Override public void execute() throws InterruptedException {
        if (!Config.Synthesis.isMaterialSynthesisEnabled) return;
        long now = System.currentTimeMillis();
        if (now - lastMaterialSynthesisTime < Math.max(60000L, Config.Synthesis.COOL_DOWN_MATERIAL_SYNTHESIS_MS)) return;
        lastMaterialSynthesisTime = now;
        String outcome = SynthesisRunner.run(2, Config.Synthesis.materialUseWarehouse, Config.Synthesis.materialMaxGrade, false, "");
        System.out.println(">>> [自动材料合成] " + outcome);
    }
}

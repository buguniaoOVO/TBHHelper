/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  org.opencv.core.Core
 *  org.opencv.core.Mat
 *  org.opencv.core.Scalar
 *  org.opencv.imgproc.Imgproc
 */
package com.lulu.vision;

import org.opencv.core.Core;
import org.opencv.core.Mat;
import org.opencv.core.Scalar;
import org.opencv.imgproc.Imgproc;

public class QualityVerifier {
    public static ItemQuality detectQuality(Mat roiMat, double threshold) {
        if (roiMat == null || roiMat.empty()) {
            return ItemQuality.UNKNOWN;
        }
        Mat hsvMat = new Mat();
        Imgproc.cvtColor((Mat)roiMat, (Mat)hsvMat, (int)40);
        int totalPixels = hsvMat.rows() * hsvMat.cols();
        for (ItemQuality quality : ItemQuality.values()) {
            if (quality == ItemQuality.UNKNOWN || quality.lower1 == null || quality.upper1 == null) continue;
            Mat mask = new Mat();
            Core.inRange((Mat)hsvMat, (Scalar)quality.lower1, (Scalar)quality.upper1, (Mat)mask);
            if (quality.lower2 != null && quality.upper2 != null) {
                Mat mask2 = new Mat();
                Core.inRange((Mat)hsvMat, (Scalar)quality.lower2, (Scalar)quality.upper2, (Mat)mask2);
                Core.bitwise_or((Mat)mask, (Mat)mask2, (Mat)mask);
                mask2.release();
            }
            int matchCount = Core.countNonZero((Mat)mask);
            mask.release();
            double matchRatio = (double)matchCount / (double)totalPixels;
            if (!(matchRatio >= threshold)) continue;
            hsvMat.release();
            return quality;
        }
        hsvMat.release();
        return ItemQuality.UNKNOWN;
    }

    public static boolean isSafeToSynthesize(Mat roiMat, ItemQuality maxSafeQuality) {
        ItemQuality currentQuality = QualityVerifier.detectQuality(roiMat, 0.4);
        System.out.println("\ud83d\udd0d \u89c6\u89c9\u626b\u63cf\u54c1\u8d28\u5224\u5b9a\u7ed3\u679c: [" + currentQuality.getName() + "]");
        if (currentQuality == ItemQuality.UNKNOWN) {
            System.err.println("\u26a0\ufe0f \u5b89\u5168\u9501\u89e6\u53d1: \u54c1\u8d28\u5f02\u5e38\u6216\u4e3a\u6781\u9ad8\u9636\u672a\u77e5\u88c5\u5907\uff0c\u5f3a\u5236\u62e6\u622a\uff01");
            return false;
        }
        if (currentQuality.ordinal() <= maxSafeQuality.ordinal()) {
            return true;
        }
        System.err.println("\u26a0\ufe0f \u5b89\u5168\u9501\u89e6\u53d1: \u5f53\u524d\u7269\u54c1 [" + currentQuality.getName() + "] \u8d85\u51fa\u8bbe\u5b9a\u6d88\u8017\u4e0a\u9650 [" + maxSafeQuality.getName() + "]\uff01");
        return false;
    }

    public static enum ItemQuality {
        NORMAL("\u666e\u901a", new Scalar(0.0, 0.0, 0.0), new Scalar(180.0, 60.0, 80.0)),
        UNCOMMON("\u7f55\u89c1", new Scalar(40.0, 80.0, 50.0), new Scalar(85.0, 255.0, 255.0)),
        RARE("\u7a00\u6709", new Scalar(95.0, 80.0, 50.0), new Scalar(130.0, 255.0, 255.0)),
        LEGENDARY("\u4f20\u8bf4", new Scalar(10.0, 100.0, 80.0), new Scalar(25.0, 255.0, 255.0)),
        IMMORTAL("\u4e0d\u673d", new Scalar(0.0, 100.0, 80.0), new Scalar(10.0, 255.0, 255.0), new Scalar(175.0, 100.0, 80.0), new Scalar(180.0, 255.0, 255.0)),
        ARCANA("\u81f3\u5b9d", new Scalar(130.0, 80.0, 50.0), new Scalar(155.0, 255.0, 255.0)),
        TRANSCENDENT("\u8d85\u51e1", new Scalar(155.0, 80.0, 50.0), new Scalar(175.0, 255.0, 255.0)),
        CELESTIAL("\u5929\u754c", null, null),
        SACRED("\u795e\u5723", null, null),
        COSMIC("\u5b87\u5b99", null, null),
        UNKNOWN("\u672a\u77e5", null, null);

        private final String name;
        private final Scalar lower1;
        private final Scalar upper1;
        private final Scalar lower2;
        private final Scalar upper2;

        private ItemQuality(String name, Scalar lower, Scalar upper) {
            this(name, lower, upper, null, null);
        }

        private ItemQuality(String name, Scalar lower1, Scalar upper1, Scalar lower2, Scalar upper2) {
            this.name = name;
            this.lower1 = lower1;
            this.upper1 = upper1;
            this.lower2 = lower2;
            this.upper2 = upper2;
        }

        public String getName() {
            return this.name;
        }
    }
}

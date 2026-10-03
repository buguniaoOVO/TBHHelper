/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  org.opencv.core.CvType
 *  org.opencv.core.Mat
 */
package com.lulu.vision;

import java.awt.image.BufferedImage;
import java.awt.image.DataBufferByte;
import org.opencv.core.CvType;
import org.opencv.core.Mat;

public class ImageUtils {
    public static Mat bufferedImageToMat(BufferedImage bi) {
        BufferedImage temp = new BufferedImage(bi.getWidth(), bi.getHeight(), 5);
        temp.getGraphics().drawImage(bi, 0, 0, null);
        byte[] pixels = ((DataBufferByte)temp.getRaster().getDataBuffer()).getData();
        Mat mat = new Mat(bi.getHeight(), bi.getWidth(), CvType.CV_8UC3);
        mat.put(0, 0, pixels);
        return mat;
    }
}

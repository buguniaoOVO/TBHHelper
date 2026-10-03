/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  nu.pattern.OpenCV
 *  org.opencv.core.Core
 *  org.opencv.core.Core$MinMaxLocResult
 *  org.opencv.core.Mat
 *  org.opencv.core.MatOfByte
 *  org.opencv.imgcodecs.Imgcodecs
 *  org.opencv.imgproc.Imgproc
 */
package com.lulu.vision;

import com.lulu.config.Config;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import nu.pattern.OpenCV;
import org.opencv.core.Core;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;

public class OpenCVVision {
    /*
     * Enabled aggressive block sorting
     * Enabled unnecessary exception pruning
     * Enabled aggressive exception aggregation
     */
    public static int[] findInMat(Mat sceneMat, String fileName) {
        String resourcePath = "imgs/" + fileName;
        try (InputStream is = OpenCVVision.class.getClassLoader().getResourceAsStream(resourcePath);){
            if (is == null) {
                System.err.println("\u274c [\u81f4\u547d\u9519\u8bef] \u627e\u4e0d\u5230\u56fe\u7247\u6587\u4ef6: " + resourcePath + "\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u540d\u662f\u4e0d\u662f\u62fc\u9519\u4e86\uff01");
                int[] nArray = null;
                return nArray;
            }
            byte[] bytes = is.readAllBytes();
            Mat template = Imgcodecs.imdecode((Mat)new MatOfByte(bytes), (int)1);
            if (template.empty()) {
                System.err.println("\u274c \u5185\u5b58\u89e3\u7801\u6a21\u677f\u5931\u8d25");
                int[] nArray = null;
                return nArray;
            }
            Mat result = new Mat();
            Imgproc.matchTemplate((Mat)sceneMat, (Mat)template, (Mat)result, (int)5);
            Core.MinMaxLocResult mmr = Core.minMaxLoc((Mat)result);
            if (!(mmr.maxVal > Config.Global.MATCH_THRESHOLD)) return null;
            int[] nArray = new int[]{(int)(mmr.maxLoc.x + (double)template.cols() / 2.0), (int)(mmr.maxLoc.y + (double)template.rows() / 2.0)};
            return nArray;
        }
        catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    /*
     * Enabled aggressive block sorting
     * Enabled unnecessary exception pruning
     * Enabled aggressive exception aggregation
     */
    public static List<int[]> findAllInMat(Mat sceneMat, String fileName, double threshold) {
        String resourcePath = "imgs/" + fileName;
        ArrayList<int[]> resultList = new ArrayList<int[]>();
        try (InputStream is = OpenCVVision.class.getClassLoader().getResourceAsStream(resourcePath);){
            if (is == null) {
                ArrayList<int[]> arrayList = resultList;
                return arrayList;
            }
            byte[] bytes = is.readAllBytes();
            Mat template = Imgcodecs.imdecode((Mat)new MatOfByte(bytes), (int)1);
            if (template.empty()) {
                ArrayList<int[]> arrayList = resultList;
                return arrayList;
            }
            Mat result = new Mat();
            Imgproc.matchTemplate((Mat)sceneMat, (Mat)template, (Mat)result, (int)5);
            ArrayList<int[]> rawPoints = new ArrayList<int[]>();
            for (int y = 0; y < result.rows(); ++y) {
                for (int x = 0; x < result.cols(); ++x) {
                    if (!(result.get(y, x)[0] >= threshold)) continue;
                    rawPoints.add(new int[]{(int)((double)x + (double)template.cols() / 2.0), (int)((double)y + (double)template.rows() / 2.0)});
                }
            }
            Iterator iterator = rawPoints.iterator();
            while (iterator.hasNext()) {
                int[] p = (int[])iterator.next();
                boolean isDuplicate = false;
                for (int[] f : resultList) {
                    if (Math.abs(p[0] - f[0]) >= 15 || Math.abs(p[1] - f[1]) >= 15) continue;
                    isDuplicate = true;
                    break;
                }
                if (isDuplicate) continue;
                resultList.add(p);
            }
            return resultList;
        }
        catch (Exception e) {
            e.printStackTrace();
        }
        return resultList;
    }

    /*
     * Exception decompiling
     */
    public static double getMatchScore(Mat sceneMat, String fileName) {
        /*
         * This method has failed to decompile.  When submitting a bug report, please provide this stack trace, and (if you hold appropriate legal rights) the relevant class file.
         * 
         * org.benf.cfr.reader.util.ConfusedCFRException: Started 2 blocks at once
         *     at org.benf.cfr.reader.bytecode.analysis.opgraph.Op04StructuredStatement.getStartingBlocks(Op04StructuredStatement.java:412)
         *     at org.benf.cfr.reader.bytecode.analysis.opgraph.Op04StructuredStatement.buildNestedBlocks(Op04StructuredStatement.java:487)
         *     at org.benf.cfr.reader.bytecode.analysis.opgraph.Op03SimpleStatement.createInitialStructuredBlock(Op03SimpleStatement.java:736)
         *     at org.benf.cfr.reader.bytecode.CodeAnalyser.getAnalysisInner(CodeAnalyser.java:850)
         *     at org.benf.cfr.reader.bytecode.CodeAnalyser.getAnalysisOrWrapFail(CodeAnalyser.java:278)
         *     at org.benf.cfr.reader.bytecode.CodeAnalyser.getAnalysis(CodeAnalyser.java:201)
         *     at org.benf.cfr.reader.entities.attributes.AttributeCode.analyse(AttributeCode.java:94)
         *     at org.benf.cfr.reader.entities.Method.analyse(Method.java:531)
         *     at org.benf.cfr.reader.entities.ClassFile.analyseMid(ClassFile.java:1055)
         *     at org.benf.cfr.reader.entities.ClassFile.analyseTop(ClassFile.java:942)
         *     at org.benf.cfr.reader.Driver.doClass(Driver.java:84)
         *     at org.benf.cfr.reader.CfrDriverImpl.analyse(CfrDriverImpl.java:78)
         *     at org.benf.cfr.reader.Main.main(Main.java:54)
         */
        throw new IllegalStateException("Decompilation failed");
    }

    static {
        OpenCV.loadLocally();
    }
}

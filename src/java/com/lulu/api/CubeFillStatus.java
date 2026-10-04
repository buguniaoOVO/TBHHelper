package com.lulu.api;

public final class CubeFillStatus {
    private CubeFillStatus() { }

    public static int count(String response) {
        if (response == null) return -1;
        String value = null;
        if (response.startsWith("NOT_ENOUGH_")) value = response.substring("NOT_ENOUGH_".length());
        else for (String field : response.split("\\|")) {
            if (field.startsWith("count=")) { value = field.substring(6); break; }
        }
        if (value == null) return -1;
        try {
            int count = Integer.parseInt(value);
            return count >= 0 && count <= 9 ? count : -1;
        } catch (NumberFormatException ex) { return -1; }
    }

    public static boolean isFillResponse(String response) {
        return response != null && (response.startsWith("CORROSION_READY|")
                || response.startsWith("CORROSION_EMPTY|") || response.startsWith("NOT_ENOUGH_"));
    }
}

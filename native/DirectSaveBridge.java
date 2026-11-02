package com.zenni.pokevoid;
import android.os.Build;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONObject;

/** Synchronous Storage API contract: a save returns only after its external record is durable. */
public final class DirectSaveBridge {
    @JavascriptInterface public synchronized String write(String key, String value) {
        return change(key, value);
    }
    @JavascriptInterface public synchronized String remove(String key) { return change(key, null); }
    private String change(String key, String value) {
        File temp = null;
        try {
            if (Build.VERSION.SDK_INT < 30 || !Environment.isExternalStorageManager()) throw new IOException("External storage unavailable");
            if (key == null || key.length() > 512 || !key.matches("^(data_|sessionData(Battle)?[0-4]?_|data_backup_|runHistoryData_|starterPrefs_).*"))
                throw new IOException("Invalid game save key");
            if (value != null && value.length() > 16 * 1024 * 1024) throw new IOException("Save exceeds limit");
            File dir = new File(Environment.getExternalStorageDirectory(), "PokeVoid/Saves");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create Saves folder");
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
            File dest = new File(dir, hex + ".json");
            if (value == null) {
                if (dest.exists() && !dest.delete()) throw new IOException("Cannot delete external save");
            } else {
                temp = File.createTempFile(".pokevoid-", ".tmp", dir);
                JSONObject record = new JSONObject(); record.put("key", key); record.put("value", value);
                try (FileOutputStream out = new FileOutputStream(temp)) {
                    byte[] data = record.toString().getBytes(StandardCharsets.UTF_8);
                    if (data.length > 32 * 1024 * 1024) throw new IOException("Encoded save exceeds limit");
                    out.write(data); out.getFD().sync();
                }
                if (!temp.renameTo(dest)) throw new IOException("Cannot publish external save");
            }
            return "";
        } catch (Exception e) { return e.getMessage() == null ? "External save failed" : e.getMessage(); }
        finally { if (temp != null && temp.exists()) temp.delete(); }
    }
}

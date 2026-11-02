package com.zenni.pokevoid;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "SharedStorage")
public class SharedStoragePlugin extends Plugin {
    private File root() { return new File(Environment.getExternalStorageDirectory(), "PokeVoid"); }

    private boolean allowed() {
        return Build.VERSION.SDK_INT >= 30 ? Environment.isExternalStorageManager()
                : getContext().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", allowed());
        result.put("path", root().getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (allowed()) { call.resolve(); return; }
        if (Build.VERSION.SDK_INT >= 30) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            try { getActivity().startActivity(intent); call.resolve(); }
            catch (Exception e) { call.reject("Cannot open Android storage permission settings", e); }
        } else {
            call.reject("Grant storage permission in Android app settings");
        }
    }

    @PluginMethod
    public void createFolders(PluginCall call) {
        if (!allowed()) { call.reject("All files access is required"); return; }
        try {
            File game = new File(root(), "Game"), saves = new File(root(), "Saves");
            if ((!game.isDirectory() && !game.mkdirs()) || (!saves.isDirectory() && !saves.mkdirs()))
                throw new IOException("Cannot create PokeVoid folders");
            JSObject result = new JSObject();
            result.put("path", root().getAbsolutePath());
            call.resolve(result);
        } catch (Exception e) { call.reject("Cannot create shared folders", e); }
    }

    private File savesDir() throws IOException {
        if (!allowed()) throw new IOException("Shared storage permission not granted");
        File dir = new File(root(), "Saves");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create Saves folder");
        return dir;
    }

    private String filename(String key) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] hash = md.digest(key.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString() + ".json";
    }

    private JSONObject readRecord(File file) throws Exception {
        if (file.length() > 32L * 1024 * 1024) throw new IOException("Save file exceeds limit");
        byte[] data = new byte[(int)file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0, n;
            while (offset < data.length && (n = input.read(data, offset, data.length - offset)) != -1) offset += n;
            if (offset != data.length) throw new IOException("Incomplete save file");
        }
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }

    @PluginMethod
    public void readSaves(PluginCall call) {
        try {
            JSONArray entries = new JSONArray();
            File[] files = savesDir().listFiles((dir, name) -> name.matches("[a-f0-9]{64}\\.json"));
            if (files == null) throw new IOException("Cannot list saves");
            for (File file : files) {
                JSONObject record = readRecord(file);
                String key = record.getString("key");
                if (!filename(key).equals(file.getName())) throw new IOException("Invalid save filename");
                entries.put(record);
            }
            JSObject result = new JSObject();
            result.put("entries", entries);
            call.resolve(result);
        } catch (Exception error) { call.reject("Cannot read external saves", error); }
    }

    @PluginMethod
    public void writeSave(PluginCall call) {
        String key = call.getString("key"), value = call.getString("value");
        if (key == null || value == null || key.length() > 512 || value.length() > 16 * 1024 * 1024) {
            call.reject("Invalid save record"); return;
        }
        try {
            File dir = savesDir();
            File dest = new File(dir, filename(key));
            File temp = File.createTempFile(".pokevoid-", ".tmp", dir);
            try {
                JSONObject record = new JSONObject();
                record.put("key", key);
                record.put("value", value);
                byte[] data = record.toString().getBytes(StandardCharsets.UTF_8);
                if (data.length > 32 * 1024 * 1024) throw new IOException("Encoded save exceeds limit");
                try (FileOutputStream out = new FileOutputStream(temp)) {
                    out.write(data);
                    out.getFD().sync();
                }
                if (!temp.renameTo(dest)) throw new IOException("Cannot atomically save record");
            } finally { if (temp.exists()) temp.delete(); }
            call.resolve();
        } catch (Exception error) { call.reject("External save write failed", error); }
    }

    @PluginMethod
    public void deleteSave(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.length() > 512) { call.reject("Invalid save key"); return; }
        try {
            File dest = new File(savesDir(), filename(key));
            if (dest.exists() && !dest.delete()) throw new IOException("Cannot delete save");
            call.resolve();
        } catch (Exception error) { call.reject("External save delete failed", error); }
    }

}

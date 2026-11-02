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

    /** Copy only verified archives. Never replace an existing user-owned file. */
    public static void mirrorArchive(File verified, String checksum) throws IOException {
        if (Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) return;
        File game = new File(Environment.getExternalStorageDirectory(), "PokeVoid/Game");
        if (!game.isDirectory() && !game.mkdirs()) throw new IOException("Cannot create shared Game folder");
        File dest = new File(game, "pokevoid-" + checksum + ".zip");
        if (dest.exists()) return;
        File temp = new File(game, "." + checksum + ".tmp");
        try {
            try (FileInputStream in = new FileInputStream(verified); FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[65536]; int n;
                while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                out.getFD().sync();
            }
            if (!temp.renameTo(dest)) throw new IOException("Cannot publish archive copy");
        } finally { if (temp.exists()) temp.delete(); }
    }
}

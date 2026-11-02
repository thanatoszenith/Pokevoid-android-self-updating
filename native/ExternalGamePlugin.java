package com.zenni.pokevoid;

import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * External game installer. Keeps all extracted playable assets under
 * /storage/emulated/0/PokeVoid/Game; never extracts into app-private storage.
 * The active directory is left untouched until a complete verified staging
 * directory is ready. Activation is intentionally separate from extraction.
 */
@CapacitorPlugin(name = "ExternalGame")
public class ExternalGamePlugin extends Plugin {
    private File gameRoot() throws IOException {
        if (!Environment.isExternalStorageManager())
            throw new IOException("All files access is required for external game installation");
        File root = new File(Environment.getExternalStorageDirectory(), "PokeVoid/Game");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create external game folder");
        return root;
    }

    @PluginMethod
    public void status(PluginCall call) {
        try {
            File root = gameRoot();
            JSObject result = new JSObject();
            result.put("path", root.getAbsolutePath());
            result.put("installed", new File(root, "current/index.html").isFile());
            call.resolve(result);
        } catch (Exception error) { call.reject("External game storage unavailable", error); }
    }

    /** Stage a previously SHA-256 verified archive from the native downloader. */
    @PluginMethod
    public void stage(PluginCall call) {
        String sha = call.getString("checksum");
        if (sha == null || !sha.matches("[a-fA-F0-9]{64}")) {
            call.reject("Invalid archive checksum"); return;
        }
        String key = sha.toLowerCase(Locale.ROOT);
        new Thread(() -> {
            File staging = null;
            try {
                File root = gameRoot();
                File archive = new File(new File(getContext().getFilesDir(), "resumable-bundles"), key + ".zip");
                if (!archive.isFile() || !matches(archive, key)) throw new IOException("Verified download not available");
                staging = new File(root, ".staging-" + key);
                if (staging.exists()) deleteTree(staging);
                if (!staging.mkdir()) throw new IOException("Cannot create staging directory");
                String base = staging.getCanonicalPath() + File.separator;
                long total = 0;
                int count = 0;
                try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
                    ZipEntry entry;
                    byte[] buffer = new byte[65536];
                    while ((entry = zip.getNextEntry()) != null) {
                        if (++count > 200000) throw new IOException("Archive has too many entries");
                        String name = entry.getName();
                        if (name.startsWith("/") || name.contains("\\") || name.indexOf('\0') >= 0)
                            throw new IOException("Unsafe archive entry");
                        File dest = new File(staging, name);
                        String canonical = dest.getCanonicalPath();
                        if (!canonical.startsWith(base)) throw new IOException("Archive path traversal refused");
                        if (entry.isDirectory()) {
                            if (!dest.isDirectory() && !dest.mkdirs()) throw new IOException("Cannot create game directory");
                        } else {
                            File parent = dest.getParentFile();
                            if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create asset directory");
                            try (FileOutputStream out = new FileOutputStream(dest)) {
                                int n;
                                while ((n = zip.read(buffer)) != -1) {
                                    total += n;
                                    if (total > 4L * 1024 * 1024 * 1024) throw new IOException("Uncompressed game exceeds 4 GiB");
                                    out.write(buffer, 0, n);
                                }
                                out.getFD().sync();
                            }
                        }
                        zip.closeEntry();
                    }
                }
                if (!new File(staging, "index.html").isFile()) throw new IOException("Game entrypoint missing");
                JSObject result = new JSObject();
                result.put("path", staging.getAbsolutePath());
                result.put("bytes", total);
                call.resolve(result);
            } catch (Exception error) {
                if (staging != null) deleteTree(staging);
                call.reject("External game extraction failed", error);
            }
        }, "pokevoid-external-install").start();
    }

    private static boolean matches(File file, String sha) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return sha.equals(hex.toString());
    }

    private static void deleteTree(File root) {
        if (!root.exists()) return;
        File[] children = root.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        root.delete();
    }
}

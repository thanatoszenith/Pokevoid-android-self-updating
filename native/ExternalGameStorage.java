package com.zenni.pokevoid;

import android.os.Environment;
import android.os.Build;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Atomic, versioned external game extraction. No WebView activation until separately verified. */
public final class ExternalGameStorage {
    private ExternalGameStorage() {}
    public static File root() { return new File(Environment.getExternalStorageDirectory(), "PokeVoid/Game"); }
    public static boolean permitted() {
        return Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager();
    }
    private static File releases() { return new File(root(), "releases"); }
    public static File release(String checksum) {
        if (checksum == null || !checksum.matches("[a-fA-F0-9]{64}")) throw new IllegalArgumentException("Invalid checksum");
        return new File(releases(), checksum.toLowerCase(Locale.ROOT));
    }
    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
    }
    private static boolean sameHash(File archive, String expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(archive)) {
            byte[] b = new byte[65536]; int n;
            while ((n = in.read(b)) != -1) digest.update(b, 0, n);
        }
        StringBuilder result = new StringBuilder();
        for (byte b : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString().equalsIgnoreCase(expected);
    }
    public static synchronized File install(File archive, String checksum) throws Exception {
        if (!permitted()) throw new IOException("All files access is required for external game installation");
        if (!sameHash(archive, checksum)) throw new IOException("Game archive SHA-256 mismatch");
        File dest = release(checksum);
        if (new File(dest, "index.html").isFile()) return dest;
        if (!releases().isDirectory() && !releases().mkdirs()) throw new IOException("Cannot create game releases directory");
        File staging = new File(releases(), "." + checksum.toLowerCase(Locale.ROOT) + ".installing");
        if (staging.exists()) removeTree(staging);
        if (!staging.mkdirs()) throw new IOException("Cannot create staging directory");
        try {
            int count = 0;
            long total = 0;
            String base = staging.getCanonicalPath() + File.separator;
            try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    if (++count > 30000) throw new IOException("Too many game archive entries");
                    String name = entry.getName();
                    if (name.startsWith("/") || name.indexOf('\\') >= 0) throw new IOException("Unsafe ZIP path");
                    File output = new File(staging, name);
                    String canonical = output.getCanonicalPath();
                    if (!canonical.startsWith(base)) throw new IOException("ZIP path traversal blocked");
                    if (entry.isDirectory()) {
                        if (!output.isDirectory() && !output.mkdirs()) throw new IOException("Cannot create ZIP directory");
                    } else {
                        File parent = output.getParentFile();
                        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create ZIP parent");
                        try (FileOutputStream file = new FileOutputStream(output)) {
                            byte[] b = new byte[65536]; int n;
                            while ((n = zip.read(b)) != -1) {
                                total += n;
                                if (total > 4L * 1024 * 1024 * 1024) throw new IOException("Game extraction exceeds 4 GiB");
                                file.write(b, 0, n);
                            }
                            file.getFD().sync();
                        }
                    }
                    zip.closeEntry();
                }
            }
            if (!new File(staging, "index.html").isFile()) throw new IOException("Extracted game missing index.html");
            if (dest.exists()) removeTree(dest);
            if (!staging.renameTo(dest)) throw new IOException("Cannot publish verified game directory");
            return dest;
        } finally { if (staging.exists()) removeTree(staging); }
    }
    private static void removeTree(File file) throws IOException {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) removeTree(child);
        if (!file.delete()) throw new IOException("Cannot remove " + file.getName());
    }
}

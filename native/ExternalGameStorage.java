package com.zenni.pokevoid;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Recoverable filesystem transaction; deliberately independent of Android for JVM tests. */
public final class ExternalGameStorage {
    private final File root;
    public ExternalGameStorage(File root) { this.root = root; }
    private File file(String name) { return new File(root, name); }
    public File downloads() throws IOException {
        ensureRoot();
        File downloads = file(".downloads");
        if (!downloads.isDirectory() && !downloads.mkdir()) throw new IOException("Cannot create external download directory");
        if (!downloads.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator))
            throw new IOException("Download directory escapes game storage");
        return downloads;
    }
    public File current() { return file("current"); }
    public boolean installed() { return new File(current(), "index.html").isFile(); }
    public boolean pending() { return file(".pending").exists(); }
    private static String metadata(File file, int limit) throws IOException {
        try (InputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[128]; int n;
            while ((n = in.read(buffer)) != -1) {
                if (n > limit - out.size()) throw new IOException("Game metadata exceeds limit: " + file.getName());
                out.write(buffer, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    public String failedChecksum() throws IOException {
        if (!file(".failed").isFile()) return "";
        String value = metadata(file(".failed"), 64);
        if (!value.matches("[a-fA-F0-9]{64}")) throw new IOException("Invalid failed checksum");
        return value.toLowerCase(Locale.ROOT);
    }
    public String version() throws IOException {
        File meta = new File(current(), ".version");
        if (!meta.isFile()) return "0";
        String value = metadata(meta, 128);
        if (!value.matches("[0-9]+(\\.[0-9]+)*")) throw new IOException("Invalid game version");
        return value;
    }
    private void ensureRoot() throws IOException {
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create external game directory");
    }
    private static void write(File target, String value) throws IOException {
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(value.getBytes(StandardCharsets.UTF_8)); out.getFD().sync();
        }
    }
    public static boolean matches(File archive, String expected) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(archive)) {
            byte[] b = new byte[65536]; int n;
            while ((n = in.read(b)) != -1) md.update(b, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString().equalsIgnoreCase(expected);
    }
    public synchronized void stage(File archive, String sha, String version) throws Exception {
        if (sha == null || !sha.matches("[a-fA-F0-9]{64}") || version == null || version.length() > 128 || !version.matches("[0-9]+(\\.[0-9]+)*"))
            throw new IOException("Invalid game metadata");
        ensureRoot();
        if (pending() || file(".rollback").exists() || file(".confirmed").exists() || file(".previous").exists())
            throw new IOException("Game recovery or confirmation pending");
        if (!matches(archive, sha)) throw new IOException("Game archive SHA-256 mismatch");
        File staging = file(".staging");
        removeTree(staging);
        if (!staging.mkdir()) throw new IOException("Cannot create staging directory");
        try {
            Set<String> names = new HashSet<>(); long total = 0; int count = 0;
            String base = staging.getCanonicalPath() + File.separator;
            try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
                ZipEntry entry; byte[] buffer = new byte[65536];
                while ((entry = zip.getNextEntry()) != null) {
                    String name = entry.getName();
                    if (++count > 200000 || name.startsWith("/") || name.contains("\\") || name.indexOf('\0') >= 0
                        || Arrays.asList(name.split("/", -1)).contains("..")) throw new IOException("Unsafe ZIP entry");
                    File dest = new File(staging, name);
                    String canonical = dest.getCanonicalPath();
                    if (!canonical.startsWith(base) || !names.add(canonical)) throw new IOException("Unsafe or duplicate ZIP path");
                    if (entry.isDirectory()) {
                        if (!dest.isDirectory() && !dest.mkdirs()) throw new IOException("Cannot create ZIP directory");
                    } else {
                        if (!dest.getParentFile().isDirectory() && !dest.getParentFile().mkdirs()) throw new IOException("Cannot create ZIP parent");
                        try (FileOutputStream out = new FileOutputStream(dest)) {
                            int n;
                            while ((n = zip.read(buffer)) != -1) {
                                total += n;
                                if (total > 4L * 1024 * 1024 * 1024) throw new IOException("Game exceeds 4 GiB");
                                out.write(buffer, 0, n);
                            }
                            out.getFD().sync();
                        }
                    }
                    zip.closeEntry();
                }
            }
            if (!new File(staging, "index.html").isFile()) throw new IOException("Game entrypoint missing");
            write(new File(staging, ".version"), version);
            write(new File(staging, ".checksum"), sha.toLowerCase(Locale.ROOT));
        } catch (Exception e) { removeTree(staging); throw e; }
    }
    public synchronized void activate(String sha) throws IOException {
        File staged = file(".staging"), previous = file(".previous");
        File checksum = new File(staged, ".checksum");
        if (!new File(staged, "index.html").isFile() || !checksum.isFile()
            || !metadata(checksum, 64).equalsIgnoreCase(sha))
            throw new IOException("Staged game does not match requested update");
        if (pending() || previous.exists() || file(".confirmed").exists() || file(".rollback").exists()) throw new IOException("Recovery pending");
        write(file(".pending"), current().exists() ? "old" : "new");
        try {
            if (current().exists() && !current().renameTo(previous)) throw new IOException("Cannot preserve current game");
            if (!staged.renameTo(current())) throw new IOException("Cannot promote staged game");
        } catch (IOException e) { recover(); throw e; }
    }
    public synchronized void confirm() throws IOException {
        if (!installed()) throw new IOException("No active game");
        if (pending() && !file(".pending").renameTo(file(".confirmed"))) throw new IOException("Cannot commit launch");
        // Commit must be fast: never recursively delete a multi-gigabyte old game
        // on the launch-critical worker. The durable .confirmed journal means
        // subsequent launches retain current even if cleanup is interrupted.
        // Post-launch maintenance removes .previous and then .confirmed.
    }
    /** Delete retired game files only after the title screen is ready. */
    public synchronized void cleanupConfirmed() throws IOException {
        if (!file(".confirmed").exists()) return;
        if (!installed()) throw new IOException("Cannot clean rollback without a playable game");
        removeTree(file(".previous"));
        removeTree(file(".confirmed"));
    }
    public synchronized void recover() throws IOException {
        recoverInternal(true);
    }
    /** Restore activation journals without walking a potentially huge abandoned ZIP extraction.
     * The next stage replaces .staging, while post-launch maintenance prunes it.
     */
    public synchronized void recoverForLaunch() throws IOException {
        recoverInternal(false);
    }
    private void recoverInternal(boolean pruneStaging) throws IOException {
        ensureRoot();
        File previous = file(".previous");
        if (file(".confirmed").exists()) {
            if (pruneStaging) {
                removeTree(previous); removeTree(file(".confirmed"));
            } else if (!installed() && previous.exists()) {
                // A confirmed version went missing: preserve the last known
                // playable copy. Slow recovery is justified for broken installs.
                removeTree(current());
                if (!previous.renameTo(current())) throw new IOException("Cannot restore previous game");
                removeTree(file(".confirmed"));
            }
            // Normal cold launch keeps the confirmed current game ready while
            // potentially gigabytes of old assets are cleaned after rendering.
        }
        else {
            if (pending()) {
                String kind = metadata(file(".pending"), 3);
                if (!kind.equals("old") && !kind.equals("new")) throw new IOException("Invalid activation journal");
                File checksum = new File(current(), ".checksum");
                if (!file(".staging").exists() && checksum.isFile())
                    write(file(".failed"), metadata(checksum, 64));
                if (!file(".pending").renameTo(file(".rollback"))) throw new IOException("Cannot journal rollback");
            }
            if (file(".rollback").exists()) {
                String kind = metadata(file(".rollback"), 3);
                if (!kind.equals("old") && !kind.equals("new")) throw new IOException("Invalid rollback journal");
                if (previous.exists()) {
                    removeTree(current());
                    if (!previous.renameTo(current())) throw new IOException("Cannot restore previous game");
                } else if (kind.equals("new")) removeTree(current());
                removeTree(file(".rollback"));
            } else if (!current().exists() && previous.exists()) {
                if (!previous.renameTo(current())) throw new IOException("Cannot restore previous game");
            }
        }
        if (pruneStaging) removeTree(file(".staging"));
    }
    public static void removeTree(File target) throws IOException {
        if (!target.exists() && !Files.isSymbolicLink(target.toPath())) return;
        if (!Files.isSymbolicLink(target.toPath())) {
            File[] children = target.listFiles();
            if (target.isDirectory() && children == null) throw new IOException("Cannot list " + target);
            if (children != null) for (File child : children) removeTree(child);
        }
        if (!target.delete()) throw new IOException("Cannot remove " + target);
    }
}

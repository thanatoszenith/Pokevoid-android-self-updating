package com.zenni.pokevoid;
import java.io.*;
import java.util.*;

/** Only downloader-owned names; one resumable archive, at most 4 GiB and 48 hours old. */
public final class DownloadCache {
    private static final Map<String,Integer> held = new HashMap<>();
    public static final class Lease implements AutoCloseable {
        private final String path;
        private boolean closed;
        private Lease(String path) { this.path = path; }
        @Override public void close() {
            synchronized (DownloadCache.class) {
                if (closed) return;
                closed = true;
                int remaining = held.get(path) - 1;
                if (remaining == 0) held.remove(path); else held.put(path, remaining);
            }
        }
    }
    public static synchronized Lease hold(File file) {
        String path = file.getAbsolutePath();
        held.put(path, held.getOrDefault(path, 0) + 1);
        return new Lease(path);
    }
    public static synchronized boolean inUse(File file) { return held.containsKey(file.getAbsolutePath()); }
    public static final long MAX_BYTES = 4L * 1024 * 1024 * 1024;
    public static final long MAX_AGE_MS = 48L * 60 * 60 * 1000;
    /** Avoid rereading a large partial archive after every known-short network response. */
    public static boolean mayBeComplete(long bytes, long total) {
        return bytes > 0 && (total < 0 || bytes == total);
    }
    /** Delete an archive exactly once it is no longer being read or written. Safe to repeat. */
    public static synchronized boolean release(File dir, String checksum) throws IOException {
        if (checksum == null || !checksum.matches("[a-fA-F0-9]{64}")) throw new IOException("Invalid archive checksum");
        String key = checksum.toLowerCase(Locale.ROOT);
        File complete = new File(dir, key + ".zip"), partial = new File(dir, key + ".part");
        if (inUse(complete) || inUse(partial)) return false;
        for (File file : new File[]{complete, partial})
            if (file.exists() && !file.delete()) throw new IOException("Cannot remove consumed download archive");
        return true;
    }
    public static synchronized void clean(File dir, String keep) throws IOException {
        File[] files = dir.listFiles((d, n) -> n.matches("[a-f0-9]{64}\\.(part|zip)"));
        if (files == null) return;
        Arrays.sort(files, (a,b) -> Long.compare(b.lastModified(), a.lastModified()));
        boolean retained = false;
        for (File file : files) {
            if (inUse(file)) continue;
            boolean eligible = keep == null || file.getName().startsWith(keep + ".");
            boolean retain = eligible && !retained && file.length() <= MAX_BYTES
                && System.currentTimeMillis() - file.lastModified() <= MAX_AGE_MS;
            if (retain) retained = true;
            else if (!file.delete()) throw new IOException("Cannot prune download cache");
        }
    }
}

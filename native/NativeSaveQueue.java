package com.zenni.pokevoid;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Reads, migrations and writes remain ordered even when Android recreates the Activity. */
public final class NativeSaveQueue {
    private static final ExecutorService writer = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "pokevoid-save-writer");
        thread.setDaemon(true);
        return thread;
    });
    /** Call on this queue: committed JSON records and user files are never removed. */
    public static void cleanTemporarySaves(File directory) throws IOException {
        File[] files = directory.listFiles((dir, name) -> name.startsWith(".pokevoid-") && name.endsWith(".tmp"));
        if (files == null) throw new IOException("Cannot list temporary saves");
        for (File file : files) {
            if (file.isFile() && !file.delete()) throw new IOException("Cannot remove unfinished save transaction");
        }
    }
    private NativeSaveQueue() {}
    public static void execute(Runnable task) { writer.execute(task); }
}
